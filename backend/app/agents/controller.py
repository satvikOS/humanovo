"""
Controller Agent Module

The Controller (Planner) agent orchestrates other agents,
decomposes complex queries, and aggregates results.
"""

import asyncio
from collections.abc import Callable
from typing import Any

from app.agents.base import (
    AgentContext,
    AgentResult,
    AgentStep,
    AgentType,
    BaseAgent,
    Tool,
)
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class TaskPlan(dict):
    """A plan for executing a complex task."""

    def __init__(
        self,
        tasks: list[dict[str, Any]],
        parallel_groups: list[list[int]] = None,
    ):
        super().__init__()
        self["tasks"] = tasks
        self["parallel_groups"] = parallel_groups or [[i] for i in range(len(tasks))]
        self["completed"] = []
        self["results"] = {}


class ControllerAgent(BaseAgent):
    """Controller agent that orchestrates the multi-agent system.

    Responsibilities:
    - Decompose complex queries into sub-tasks
    - Decide which agents to invoke
    - Coordinate parallel and sequential execution
    - Aggregate and synthesize results
    """

    agent_type = AgentType.CONTROLLER
    description = "Orchestrates other agents and manages task execution"

    def __init__(
        self,
        max_iterations: int = None,
        timeout_seconds: int = None,
    ):
        super().__init__(
            max_iterations=max_iterations or settings.AGENT_MAX_ITERATIONS,
            timeout_seconds=timeout_seconds or settings.AGENT_TIMEOUT_SECONDS,
        )
        self.sub_agents: dict[AgentType, BaseAgent] = {}
        self._progress_callback: Callable | None = None

    def _setup_tools(self) -> None:
        """Set up controller-specific tools."""
        self.register_tool(
            Tool(
                name="decompose_task",
                description="Break down a complex query into sub-tasks",
                handler=self._decompose_task,
            )
        )
        self.register_tool(
            Tool(
                name="select_agents",
                description="Select appropriate agents for sub-tasks",
                handler=self._select_agents,
            )
        )
        self.register_tool(
            Tool(
                name="aggregate_results",
                description="Combine results from multiple agents",
                handler=self._aggregate_results,
            )
        )

    def register_sub_agent(self, agent: BaseAgent) -> None:
        """Register a sub-agent for delegation."""
        self.sub_agents[agent.agent_type] = agent
        self.logger.debug("Sub-agent registered", agent_type=agent.agent_type.value)

    async def execute(
        self,
        query: str = None,
        context: AgentContext = None,
        progress_callback: Callable | None = None,
        **kwargs,
    ) -> AgentResult:
        """Execute the controller's orchestration logic.

        Args:
            query: The main query to process
            context: Shared context (created if not provided)
            progress_callback: Callback for progress updates
            **kwargs: Additional parameters

        Returns:
            Aggregated results from all agents
        """
        import time

        self._progress_callback = progress_callback
        start_time = time.time()

        # Handle both query as positional arg and in context
        if context is None:
            context = AgentContext(query=query or "", **kwargs.get("context", {}))
        elif query:
            context.query = query

        self.logger.info("Controller starting", query=context.query[:100])

        # Step 1: Decompose the query into tasks
        plan = await self._decompose_task(context.query, context)

        self.record_step(
            action="decompose_task",
            input_data={"query": context.query},
            output_data={"tasks": len(plan["tasks"])},
            duration_ms=int((time.time() - start_time) * 1000),
        )

        # Step 2: Execute tasks according to plan
        all_results = {}
        total_tasks = len(plan["tasks"])

        for group_idx, task_group in enumerate(plan["parallel_groups"]):
            # Execute tasks in this group in parallel
            group_tasks = [plan["tasks"][i] for i in task_group if i < len(plan["tasks"])]

            if len(group_tasks) == 1:
                # Single task - execute directly
                task = group_tasks[0]
                result = await self._execute_sub_task(task, context)
                all_results[task["id"]] = result

                # Update progress
                completed = len(all_results)
                if self._progress_callback:
                    step = AgentStep(
                        agent_type=self.agent_type,
                        action=f"completed_{task['type']}",
                        output_data={"task_id": task["id"]},
                    )
                    self._progress_callback(completed / total_tasks, step)

            else:
                # Multiple tasks - execute in parallel
                tasks_coros = [self._execute_sub_task(task, context) for task in group_tasks]
                results = await asyncio.gather(*tasks_coros, return_exceptions=True)

                for task, result in zip(group_tasks, results):
                    if isinstance(result, Exception):
                        all_results[task["id"]] = AgentResult(success=False, error=str(result))
                    else:
                        all_results[task["id"]] = result

                # Update progress
                completed = len(all_results)
                if self._progress_callback:
                    step = AgentStep(
                        agent_type=self.agent_type,
                        action="completed_parallel_group",
                        output_data={"group": group_idx, "tasks": len(group_tasks)},
                    )
                    self._progress_callback(completed / total_tasks, step)

            # Update context with intermediate results
            context = self._update_context(context, all_results)
            context.iteration += 1

            # Check iteration limit
            if context.iteration >= context.max_iterations:
                self.logger.warning("Max iterations reached")
                break

        # Step 3: Aggregate results
        final_result = await self._aggregate_results(all_results, context)

        self.record_step(
            action="aggregate_results",
            input_data={"result_count": len(all_results)},
            output_data={"success": final_result.success},
            duration_ms=int((time.time() - start_time) * 1000),
        )

        return final_result

    async def _decompose_task(
        self,
        query: str,
        context: AgentContext,
    ) -> TaskPlan:
        """Decompose a complex query into sub-tasks.

        Uses heuristics and optionally LLM to determine task breakdown.
        """
        tasks = []
        task_id = 0

        # Determine what types of tasks are needed based on query
        query_lower = query.lower()

        # Always start with search for evidence
        tasks.append(
            {
                "id": f"task_{task_id}",
                "type": "search",
                "agent": AgentType.SEARCH,
                "description": "Search for relevant evidence",
                "params": {"query": query, "max_results": 10},
            }
        )
        task_id += 1

        # Add extraction if query involves specific entities
        if any(kw in query_lower for kw in ["gene", "protein", "drug", "disease", "pathway"]):
            tasks.append(
                {
                    "id": f"task_{task_id}",
                    "type": "extraction",
                    "agent": AgentType.EXTRACTION,
                    "description": "Extract biomedical entities",
                    "params": {"query": query},
                }
            )
            task_id += 1

        # Add reasoning for hypothesis generation
        if any(
            kw in query_lower for kw in ["hypothesis", "suggest", "propose", "mechanism", "why"]
        ):
            tasks.append(
                {
                    "id": f"task_{task_id}",
                    "type": "reasoning",
                    "agent": AgentType.REASONING,
                    "description": "Generate hypotheses",
                    "params": {"query": query},
                    "depends_on": ["task_0"],  # Depends on search results
                }
            )
            task_id += 1

        # Add verification if making claims
        if tasks and any(t["type"] == "reasoning" for t in tasks):
            tasks.append(
                {
                    "id": f"task_{task_id}",
                    "type": "verification",
                    "agent": AgentType.VERIFICATION,
                    "description": "Verify generated hypotheses",
                    "params": {},
                    "depends_on": [f"task_{task_id - 1}"],
                }
            )
            task_id += 1

        # Determine parallel groups based on dependencies
        parallel_groups = self._compute_parallel_groups(tasks)

        self.logger.info(
            "Task decomposition complete",
            total_tasks=len(tasks),
            parallel_groups=len(parallel_groups),
        )

        return TaskPlan(tasks=tasks, parallel_groups=parallel_groups)

    def _compute_parallel_groups(
        self,
        tasks: list[dict[str, Any]],
    ) -> list[list[int]]:
        """Compute which tasks can be run in parallel."""
        groups = []
        completed = set()
        remaining = set(range(len(tasks)))

        while remaining:
            # Find tasks whose dependencies are satisfied
            ready = []
            for i in remaining:
                task = tasks[i]
                deps = task.get("depends_on", [])
                if all(d in completed for d in deps):
                    ready.append(i)

            if not ready:
                # Circular dependency or error - just run remaining sequentially
                ready = [min(remaining)]

            groups.append(ready)
            completed.update(ready)
            remaining -= set(ready)

        return groups

    async def _execute_sub_task(
        self,
        task: dict[str, Any],
        context: AgentContext,
    ) -> AgentResult:
        """Execute a single sub-task using the appropriate agent."""
        agent_type = task["agent"]

        self.logger.debug(
            "Executing sub-task",
            task_id=task["id"],
            agent_type=agent_type.value,
        )

        if agent_type not in self.sub_agents:
            # Create agent on-demand if not registered
            agent = self._create_agent(agent_type)
        else:
            agent = self.sub_agents[agent_type]

        # Execute the agent
        result = await agent.run(
            query=task["params"].get("query", context.query),
            context=context,
            **task["params"],
        )

        self.record_step(
            action=f"execute_{task['type']}",
            input_data={"task": task},
            output_data={"success": result.success},
            tool_calls=[agent_type.value],
        )

        return result

    def _create_agent(self, agent_type: AgentType) -> BaseAgent:
        """Create an agent instance on-demand."""
        from app.agents.hypothesis_agent import HypothesisGenerationAgent
        from app.agents.search_agent import SearchAgent
        from app.agents.verification_agent import VerificationAgent

        agent_classes = {
            AgentType.SEARCH: SearchAgent,
            AgentType.VERIFICATION: VerificationAgent,
            AgentType.REASONING: HypothesisGenerationAgent,
        }

        if agent_type in agent_classes:
            agent = agent_classes[agent_type]()
            self.sub_agents[agent_type] = agent
            return agent

        raise ValueError(f"Unknown agent type: {agent_type}")

    def _update_context(
        self,
        context: AgentContext,
        results: dict[str, AgentResult],
    ) -> AgentContext:
        """Update shared context with results from completed tasks."""
        for task_id, result in results.items():
            if not result.success:
                continue

            # Merge evidence
            if "evidence" in result.data:
                context.evidence.extend(result.data["evidence"])

            # Merge hypotheses
            if "hypotheses" in result.data:
                context.hypotheses.extend(result.data["hypotheses"])

            # Merge entities
            if "entities" in result.data:
                context.entities.extend(result.data["entities"])

            # Merge graph facts
            if "graph_facts" in result.data:
                context.graph_facts.extend(result.data["graph_facts"])

        return context

    async def _aggregate_results(
        self,
        results: dict[str, AgentResult],
        context: AgentContext,
    ) -> AgentResult:
        """Aggregate results from all sub-agents into final output."""
        # Check if any critical failures
        failures = [r for r in results.values() if not r.success]
        if len(failures) == len(results):
            return AgentResult(
                success=False,
                error="All sub-tasks failed",
                data={"failures": [f.error for f in failures]},
            )

        # Compile final data
        aggregated_data = {
            "evidence": context.evidence,
            "hypotheses": context.hypotheses,
            "entities": list(set(context.entities)),
            "graph_facts": context.graph_facts,
            "task_results": {
                task_id: {
                    "success": result.success,
                    "summary": result.data.get("summary", ""),
                }
                for task_id, result in results.items()
            },
        }

        # Generate summary
        aggregated_data["summary"] = self._generate_summary(aggregated_data)

        return AgentResult(
            success=True,
            data=aggregated_data,
            context=context,
        )

    def _generate_summary(self, data: dict[str, Any]) -> str:
        """Generate a human-readable summary of the results."""
        parts = []

        if data["evidence"]:
            parts.append(f"Found {len(data['evidence'])} relevant evidence items.")

        if data["hypotheses"]:
            parts.append(f"Generated {len(data['hypotheses'])} hypotheses.")

        if data["entities"]:
            parts.append(f"Identified {len(data['entities'])} unique entities.")

        return " ".join(parts) if parts else "Analysis complete."

    async def _select_agents(
        self,
        task_type: str,
        context: AgentContext,
    ) -> list[AgentType]:
        """Select which agents to use for a given task type."""
        agent_mapping = {
            "search": [AgentType.SEARCH],
            "extract": [AgentType.EXTRACTION],
            "reason": [AgentType.REASONING],
            "verify": [AgentType.VERIFICATION],
            "simulate": [AgentType.SIMULATION],
            "report": [AgentType.REPORTING],
        }

        return agent_mapping.get(task_type, [AgentType.REASONING])
