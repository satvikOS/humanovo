"""
Agent Scheduler and Priority Queue System

Implements priority-based task scheduling, rate limiting, and concurrency
control for ingestion agents.
"""

import asyncio
import heapq
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import IntEnum
from typing import Any
from uuid import UUID, uuid4

from app.agents.ingestion.base import SourceType
from app.core.logging import get_logger

logger = get_logger(__name__)


class TaskPriority(IntEnum):
    """Priority levels for ingestion tasks (lower = higher priority)."""

    CRITICAL = 0  # System-critical updates
    HIGH = 1  # User-requested real-time ingestion
    NORMAL = 2  # Scheduled background ingestion
    LOW = 3  # Bulk/batch processing
    IDLE = 4  # Low-priority cleanup tasks


@dataclass(order=True)
class ScheduledTask:
    """A task scheduled for execution with priority ordering."""

    priority: TaskPriority
    scheduled_time: datetime
    task_id: UUID = field(compare=False)
    agent_type: SourceType = field(compare=False)
    query: str = field(compare=False)
    config: dict[str, Any] = field(default_factory=dict, compare=False)
    callback: Callable | None = field(default=None, compare=False)
    retries: int = field(default=0, compare=False)
    max_retries: int = field(default=3, compare=False)
    created_at: datetime = field(default_factory=datetime.utcnow, compare=False)

    def __post_init__(self):
        if self.task_id is None:
            self.task_id = uuid4()


@dataclass
class RateLimitConfig:
    """Rate limiting configuration for a source."""

    requests_per_minute: int = 30
    requests_per_hour: int = 1000
    min_interval_seconds: float = 2.0
    burst_limit: int = 5


@dataclass
class RateLimitState:
    """Current rate limiting state for a source."""

    minute_requests: int = 0
    hour_requests: int = 0
    last_request_time: datetime | None = None
    minute_window_start: datetime | None = None
    hour_window_start: datetime | None = None

    def reset_minute_window(self) -> None:
        self.minute_requests = 0
        self.minute_window_start = datetime.utcnow()

    def reset_hour_window(self) -> None:
        self.hour_requests = 0
        self.hour_window_start = datetime.utcnow()


class AgentScheduler:
    """
    Priority-based scheduler for ingestion agents.

    Features:
    - Priority queue with 5 priority levels
    - Per-source rate limiting
    - Concurrency control
    - Automatic retry with exponential backoff
    - Task deduplication
    - Scheduled/delayed execution
    """

    DEFAULT_RATE_LIMITS = {
        SourceType.PUBMED: RateLimitConfig(
            requests_per_minute=30,
            requests_per_hour=1000,
            min_interval_seconds=2.0,
        ),
        SourceType.CLINICAL_TRIALS: RateLimitConfig(
            requests_per_minute=60,
            requests_per_hour=2000,
            min_interval_seconds=1.0,
        ),
        SourceType.PATENTS: RateLimitConfig(
            requests_per_minute=20,
            requests_per_hour=500,
            min_interval_seconds=3.0,
        ),
        SourceType.PREPRINT: RateLimitConfig(
            requests_per_minute=60,
            requests_per_hour=1500,
            min_interval_seconds=1.0,
        ),
        SourceType.CUSTOM_DOCUMENT: RateLimitConfig(
            requests_per_minute=100,
            requests_per_hour=5000,
            min_interval_seconds=0.5,
        ),
    }

    def __init__(
        self,
        max_concurrent_tasks: int = 5,
        max_concurrent_per_source: int = 2,
        rate_limits: dict[SourceType, RateLimitConfig] | None = None,
    ):
        """
        Initialize the scheduler.

        Args:
            max_concurrent_tasks: Maximum total concurrent tasks
            max_concurrent_per_source: Maximum concurrent tasks per source
            rate_limits: Custom rate limits per source
        """
        self.max_concurrent_tasks = max_concurrent_tasks
        self.max_concurrent_per_source = max_concurrent_per_source
        self.rate_limits = rate_limits or self.DEFAULT_RATE_LIMITS

        # Priority queue (heap)
        self._queue: list[ScheduledTask] = []

        # Task tracking
        self._pending_tasks: dict[UUID, ScheduledTask] = {}
        self._running_tasks: dict[UUID, ScheduledTask] = {}
        self._completed_tasks: dict[UUID, ScheduledTask] = {}
        self._failed_tasks: dict[UUID, ScheduledTask] = {}

        # Per-source tracking
        self._source_running: dict[SourceType, set[UUID]] = {st: set() for st in SourceType}
        self._rate_state: dict[SourceType, RateLimitState] = {
            st: RateLimitState() for st in SourceType
        }

        # Deduplication
        self._task_hashes: set[str] = set()

        # Control
        self._running = False
        self._processor_task: asyncio.Task | None = None
        self._semaphore = asyncio.Semaphore(max_concurrent_tasks)

        self.logger = logger

    def _compute_task_hash(self, task: ScheduledTask) -> str:
        """Compute hash for task deduplication."""
        return f"{task.agent_type.value}:{task.query}:{hash(frozenset(task.config.items()))}"

    async def schedule(
        self,
        agent_type: SourceType,
        query: str,
        priority: TaskPriority = TaskPriority.NORMAL,
        delay_seconds: float = 0,
        config: dict[str, Any] | None = None,
        callback: Callable[[ScheduledTask, Any], Coroutine] | None = None,
        deduplicate: bool = True,
        max_retries: int = 3,
    ) -> UUID:
        """
        Schedule a task for execution.

        Args:
            agent_type: Type of ingestion agent to use
            query: Search query
            priority: Task priority level
            delay_seconds: Delay before execution
            config: Agent configuration
            callback: Async callback on completion
            deduplicate: Whether to skip duplicate tasks
            max_retries: Maximum retry attempts

        Returns:
            Task ID
        """
        task = ScheduledTask(
            priority=priority,
            scheduled_time=datetime.utcnow() + timedelta(seconds=delay_seconds),
            task_id=uuid4(),
            agent_type=agent_type,
            query=query,
            config=config or {},
            callback=callback,
            max_retries=max_retries,
        )

        # Check for duplicates
        if deduplicate:
            task_hash = self._compute_task_hash(task)
            if task_hash in self._task_hashes:
                self.logger.debug(
                    "Skipping duplicate task",
                    task_id=str(task.task_id),
                    agent_type=agent_type.value,
                )
                return task.task_id
            self._task_hashes.add(task_hash)

        # Add to queue
        heapq.heappush(self._queue, task)
        self._pending_tasks[task.task_id] = task

        self.logger.info(
            "Task scheduled",
            task_id=str(task.task_id),
            agent_type=agent_type.value,
            priority=priority.name,
            delay_seconds=delay_seconds,
        )

        return task.task_id

    async def schedule_batch(
        self,
        tasks: list[dict[str, Any]],
        default_priority: TaskPriority = TaskPriority.NORMAL,
    ) -> list[UUID]:
        """
        Schedule multiple tasks at once.

        Args:
            tasks: List of task configs with agent_type, query, and optional priority/config
            default_priority: Default priority for tasks without explicit priority

        Returns:
            List of task IDs
        """
        task_ids = []
        for task_config in tasks:
            task_id = await self.schedule(
                agent_type=task_config["agent_type"],
                query=task_config["query"],
                priority=task_config.get("priority", default_priority),
                config=task_config.get("config"),
                callback=task_config.get("callback"),
            )
            task_ids.append(task_id)
        return task_ids

    async def cancel(self, task_id: UUID) -> bool:
        """
        Cancel a pending task.

        Returns:
            True if task was cancelled, False if not found or already running
        """
        if task_id in self._pending_tasks:
            task = self._pending_tasks.pop(task_id)
            # Remove from queue (O(n) but necessary)
            self._queue = [t for t in self._queue if t.task_id != task_id]
            heapq.heapify(self._queue)

            task_hash = self._compute_task_hash(task)
            self._task_hashes.discard(task_hash)

            self.logger.info("Task cancelled", task_id=str(task_id))
            return True

        return False

    async def reprioritize(self, task_id: UUID, new_priority: TaskPriority) -> bool:
        """
        Change the priority of a pending task.

        Returns:
            True if task was reprioritized, False if not found or already running
        """
        if task_id not in self._pending_tasks:
            return False

        task = self._pending_tasks[task_id]
        old_priority = task.priority

        # Update priority
        task.priority = new_priority

        # Rebuild heap
        heapq.heapify(self._queue)

        self.logger.info(
            "Task reprioritized",
            task_id=str(task_id),
            old_priority=old_priority.name,
            new_priority=new_priority.name,
        )

        return True

    def _check_rate_limit(self, source_type: SourceType) -> tuple[bool, float]:
        """
        Check if a request is allowed under rate limits.

        Returns:
            (is_allowed, wait_seconds)
        """
        config = self.rate_limits.get(source_type, RateLimitConfig())
        state = self._rate_state[source_type]
        now = datetime.utcnow()

        # Reset windows if expired
        if (
            state.minute_window_start is None
            or (now - state.minute_window_start).total_seconds() >= 60
        ):
            state.reset_minute_window()

        if (
            state.hour_window_start is None
            or (now - state.hour_window_start).total_seconds() >= 3600
        ):
            state.reset_hour_window()

        # Check minute limit
        if state.minute_requests >= config.requests_per_minute:
            wait_time = 60 - (now - state.minute_window_start).total_seconds()
            return False, max(0, wait_time)

        # Check hour limit
        if state.hour_requests >= config.requests_per_hour:
            wait_time = 3600 - (now - state.hour_window_start).total_seconds()
            return False, max(0, wait_time)

        # Check minimum interval
        if state.last_request_time is not None:
            elapsed = (now - state.last_request_time).total_seconds()
            if elapsed < config.min_interval_seconds:
                return False, config.min_interval_seconds - elapsed

        return True, 0

    def _record_request(self, source_type: SourceType) -> None:
        """Record a request for rate limiting."""
        state = self._rate_state[source_type]
        state.minute_requests += 1
        state.hour_requests += 1
        state.last_request_time = datetime.utcnow()

    async def start(self) -> None:
        """Start the scheduler processor."""
        if self._running:
            return

        self._running = True
        self._processor_task = asyncio.create_task(self._process_queue())
        self.logger.info("Scheduler started")

    async def stop(self, wait_for_running: bool = True) -> None:
        """
        Stop the scheduler.

        Args:
            wait_for_running: Whether to wait for running tasks to complete
        """
        self._running = False

        if self._processor_task:
            self._processor_task.cancel()
            try:
                await self._processor_task
            except asyncio.CancelledError:
                pass

        if wait_for_running:
            # Wait for running tasks to complete
            while self._running_tasks:
                await asyncio.sleep(0.1)

        self.logger.info("Scheduler stopped")

    async def _process_queue(self) -> None:
        """Main queue processing loop."""
        while self._running:
            try:
                await self._process_next_task()
                await asyncio.sleep(0.1)  # Small delay to prevent busy-waiting
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("Queue processor error", error=str(e))
                await asyncio.sleep(1)

    async def _process_next_task(self) -> None:
        """Process the next available task from the queue."""
        if not self._queue:
            return

        # Check if we can run more tasks
        if len(self._running_tasks) >= self.max_concurrent_tasks:
            return

        now = datetime.utcnow()

        # Find a task that's ready to run
        for i, task in enumerate(self._queue):
            # Check scheduled time
            if task.scheduled_time > now:
                continue

            # Check per-source concurrency
            source_running = len(self._source_running[task.agent_type])
            if source_running >= self.max_concurrent_per_source:
                continue

            # Check rate limits
            allowed, wait_time = self._check_rate_limit(task.agent_type)
            if not allowed:
                # Reschedule
                task.scheduled_time = now + timedelta(seconds=wait_time)
                heapq.heapify(self._queue)
                continue

            # Remove from queue and pending
            self._queue.pop(i)
            heapq.heapify(self._queue)
            self._pending_tasks.pop(task.task_id, None)

            # Mark as running
            self._running_tasks[task.task_id] = task
            self._source_running[task.agent_type].add(task.task_id)
            self._record_request(task.agent_type)

            # Execute task
            asyncio.create_task(self._execute_task(task))
            break

    async def _execute_task(self, task: ScheduledTask) -> None:
        """Execute a single task."""
        self.logger.info(
            "Executing task",
            task_id=str(task.task_id),
            agent_type=task.agent_type.value,
        )

        try:
            async with self._semaphore:
                # Import here to avoid circular imports
                from app.agents.ingestion.orchestrator import IngestionOrchestrator

                orchestrator = IngestionOrchestrator(
                    sources=[task.agent_type],
                    parallel=False,
                )

                result = await orchestrator.ingest(
                    query=task.query,
                    **task.config,
                )

                # Mark as completed
                self._running_tasks.pop(task.task_id, None)
                self._source_running[task.agent_type].discard(task.task_id)
                self._completed_tasks[task.task_id] = task

                # Clean up dedup hash
                task_hash = self._compute_task_hash(task)
                self._task_hashes.discard(task_hash)

                self.logger.info(
                    "Task completed",
                    task_id=str(task.task_id),
                    records=result.get("metrics", {}).get("total_records_indexed", 0),
                )

                # Call completion callback
                if task.callback:
                    try:
                        await task.callback(task, result)
                    except Exception as e:
                        self.logger.error(
                            "Task callback error",
                            task_id=str(task.task_id),
                            error=str(e),
                        )

        except Exception as e:
            self.logger.error(
                "Task execution failed",
                task_id=str(task.task_id),
                error=str(e),
                retries=task.retries,
            )

            # Clean up running state
            self._running_tasks.pop(task.task_id, None)
            self._source_running[task.agent_type].discard(task.task_id)

            # Retry if allowed
            if task.retries < task.max_retries:
                task.retries += 1
                # Exponential backoff
                delay = 2**task.retries * 5  # 10s, 20s, 40s
                task.scheduled_time = datetime.utcnow() + timedelta(seconds=delay)

                heapq.heappush(self._queue, task)
                self._pending_tasks[task.task_id] = task

                self.logger.info(
                    "Task scheduled for retry",
                    task_id=str(task.task_id),
                    retry=task.retries,
                    delay_seconds=delay,
                )
            else:
                # Max retries exceeded
                self._failed_tasks[task.task_id] = task
                task_hash = self._compute_task_hash(task)
                self._task_hashes.discard(task_hash)

                self.logger.error(
                    "Task permanently failed",
                    task_id=str(task.task_id),
                    retries=task.retries,
                )

    def get_queue_stats(self) -> dict[str, Any]:
        """Get current queue statistics."""
        priority_counts = {p.name: 0 for p in TaskPriority}
        source_counts = {st.value: 0 for st in SourceType}

        for task in self._queue:
            priority_counts[task.priority.name] += 1
            source_counts[task.agent_type.value] += 1

        return {
            "pending": len(self._pending_tasks),
            "running": len(self._running_tasks),
            "completed": len(self._completed_tasks),
            "failed": len(self._failed_tasks),
            "queue_size": len(self._queue),
            "by_priority": priority_counts,
            "by_source": source_counts,
            "running_by_source": {
                st.value: len(tasks) for st, tasks in self._source_running.items()
            },
        }

    def get_task_status(self, task_id: UUID) -> dict[str, Any] | None:
        """Get status of a specific task."""
        if task_id in self._pending_tasks:
            task = self._pending_tasks[task_id]
            return {
                "task_id": str(task_id),
                "status": "pending",
                "priority": task.priority.name,
                "agent_type": task.agent_type.value,
                "scheduled_time": task.scheduled_time.isoformat(),
                "retries": task.retries,
            }

        if task_id in self._running_tasks:
            task = self._running_tasks[task_id]
            return {
                "task_id": str(task_id),
                "status": "running",
                "priority": task.priority.name,
                "agent_type": task.agent_type.value,
                "started_at": task.scheduled_time.isoformat(),
            }

        if task_id in self._completed_tasks:
            return {
                "task_id": str(task_id),
                "status": "completed",
            }

        if task_id in self._failed_tasks:
            task = self._failed_tasks[task_id]
            return {
                "task_id": str(task_id),
                "status": "failed",
                "retries": task.retries,
            }

        return None


class ScheduledIngestionJob:
    """
    Manages recurring ingestion jobs.

    Supports cron-like scheduling for periodic data updates.
    """

    def __init__(
        self,
        scheduler: AgentScheduler,
        job_id: UUID | None = None,
    ):
        self.scheduler = scheduler
        self.job_id = job_id or uuid4()
        self._jobs: dict[UUID, dict[str, Any]] = {}
        self._running = False
        self._job_task: asyncio.Task | None = None
        self.logger = logger

    async def add_recurring_job(
        self,
        agent_type: SourceType,
        query: str,
        interval_seconds: int,
        priority: TaskPriority = TaskPriority.LOW,
        config: dict[str, Any] | None = None,
        start_immediately: bool = True,
    ) -> UUID:
        """
        Add a recurring ingestion job.

        Args:
            agent_type: Type of agent to use
            query: Search query
            interval_seconds: Interval between runs
            priority: Task priority
            config: Agent configuration
            start_immediately: Whether to run immediately

        Returns:
            Job ID
        """
        job_id = uuid4()

        self._jobs[job_id] = {
            "agent_type": agent_type,
            "query": query,
            "interval_seconds": interval_seconds,
            "priority": priority,
            "config": config or {},
            "last_run": None,
            "next_run": datetime.utcnow()
            if start_immediately
            else datetime.utcnow() + timedelta(seconds=interval_seconds),
            "enabled": True,
            "run_count": 0,
        }

        self.logger.info(
            "Recurring job added",
            job_id=str(job_id),
            agent_type=agent_type.value,
            interval_seconds=interval_seconds,
        )

        return job_id

    async def remove_job(self, job_id: UUID) -> bool:
        """Remove a recurring job."""
        if job_id in self._jobs:
            del self._jobs[job_id]
            self.logger.info("Recurring job removed", job_id=str(job_id))
            return True
        return False

    async def pause_job(self, job_id: UUID) -> bool:
        """Pause a recurring job."""
        if job_id in self._jobs:
            self._jobs[job_id]["enabled"] = False
            return True
        return False

    async def resume_job(self, job_id: UUID) -> bool:
        """Resume a paused job."""
        if job_id in self._jobs:
            self._jobs[job_id]["enabled"] = True
            return True
        return False

    async def start(self) -> None:
        """Start the job scheduler."""
        if self._running:
            return

        self._running = True
        self._job_task = asyncio.create_task(self._process_jobs())
        self.logger.info("Job scheduler started")

    async def stop(self) -> None:
        """Stop the job scheduler."""
        self._running = False
        if self._job_task:
            self._job_task.cancel()
            try:
                await self._job_task
            except asyncio.CancelledError:
                pass
        self.logger.info("Job scheduler stopped")

    async def _process_jobs(self) -> None:
        """Process recurring jobs."""
        while self._running:
            try:
                now = datetime.utcnow()

                for job_id, job in self._jobs.items():
                    if not job["enabled"]:
                        continue

                    if job["next_run"] <= now:
                        # Schedule the task
                        await self.scheduler.schedule(
                            agent_type=job["agent_type"],
                            query=job["query"],
                            priority=job["priority"],
                            config=job["config"],
                        )

                        # Update job state
                        job["last_run"] = now
                        job["next_run"] = now + timedelta(seconds=job["interval_seconds"])
                        job["run_count"] += 1

                        self.logger.info(
                            "Recurring job triggered",
                            job_id=str(job_id),
                            run_count=job["run_count"],
                        )

                await asyncio.sleep(1)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("Job processor error", error=str(e))
                await asyncio.sleep(5)

    def get_job_status(self, job_id: UUID) -> dict[str, Any] | None:
        """Get status of a recurring job."""
        if job_id in self._jobs:
            job = self._jobs[job_id]
            return {
                "job_id": str(job_id),
                "agent_type": job["agent_type"].value,
                "query": job["query"],
                "interval_seconds": job["interval_seconds"],
                "enabled": job["enabled"],
                "last_run": job["last_run"].isoformat() if job["last_run"] else None,
                "next_run": job["next_run"].isoformat() if job["next_run"] else None,
                "run_count": job["run_count"],
            }
        return None

    def list_jobs(self) -> list[dict[str, Any]]:
        """List all recurring jobs."""
        return [self.get_job_status(job_id) for job_id in self._jobs]


# Global scheduler instance
_scheduler: AgentScheduler | None = None
_job_scheduler: ScheduledIngestionJob | None = None


def get_scheduler() -> AgentScheduler:
    """Get the global scheduler instance."""
    global _scheduler
    if _scheduler is None:
        _scheduler = AgentScheduler()
    return _scheduler


def get_job_scheduler() -> ScheduledIngestionJob:
    """Get the global job scheduler instance."""
    global _job_scheduler
    if _job_scheduler is None:
        _job_scheduler = ScheduledIngestionJob(get_scheduler())
    return _job_scheduler


async def initialize_schedulers() -> tuple[AgentScheduler, ScheduledIngestionJob]:
    """Initialize and start both schedulers."""
    scheduler = get_scheduler()
    job_scheduler = get_job_scheduler()

    await scheduler.start()
    await job_scheduler.start()

    return scheduler, job_scheduler


async def shutdown_schedulers() -> None:
    """Shutdown both schedulers gracefully."""
    global _scheduler, _job_scheduler

    if _job_scheduler:
        await _job_scheduler.stop()

    if _scheduler:
        await _scheduler.stop()
