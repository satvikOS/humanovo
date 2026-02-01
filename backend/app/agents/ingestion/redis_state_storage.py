"""
Redis State Storage Backend

Production-ready distributed state storage for agent checkpointing using Redis.
"""

import asyncio

import redis.asyncio as redis
from redis.asyncio.connection import ConnectionPool

from app.agents.ingestion.state_manager import StateStorage
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class RedisStateStorage(StateStorage):
    """
    Redis-based state storage for agent checkpointing.

    Provides fast, distributed state storage with automatic expiration
    and atomic operations for concurrent agent management.

    Features:
    - High-performance read/write operations
    - Distributed storage for multi-worker deployments
    - Automatic key expiration for cleanup
    - Atomic operations for consistency
    - Connection pooling for efficiency
    """

    def __init__(
        self,
        redis_url: str | None = None,
        key_prefix: str = "genup:checkpoints:",
        ttl_seconds: int | None = 86400 * 7,  # 7 days default
        max_connections: int = 10,
    ):
        """
        Initialize Redis state storage.

        Args:
            redis_url: Redis connection URL (uses config default if None)
            key_prefix: Prefix for all Redis keys
            ttl_seconds: Time-to-live for keys (None for no expiration)
            max_connections: Maximum connections in pool
        """
        self.redis_url = redis_url or settings.REDIS_URL
        self.key_prefix = key_prefix
        self.ttl_seconds = ttl_seconds
        self.max_connections = max_connections

        self._pool: ConnectionPool | None = None
        self._client: redis.Redis | None = None

        self.logger = logger

    async def _get_client(self) -> redis.Redis:
        """Get or create Redis client."""
        if self._client is None:
            self._pool = ConnectionPool.from_url(
                self.redis_url,
                max_connections=self.max_connections,
                decode_responses=False,  # We handle bytes
            )
            self._client = redis.Redis(connection_pool=self._pool)

            # Test connection
            try:
                await self._client.ping()
                self.logger.info("Redis state storage connected")
            except redis.ConnectionError as e:
                self.logger.error("Redis connection failed", error=str(e))
                raise

        return self._client

    def _make_key(self, key: str) -> str:
        """Create full Redis key with prefix."""
        return f"{self.key_prefix}{key}"

    async def save(self, key: str, data: bytes) -> None:
        """
        Save data to Redis.

        Args:
            key: Storage key
            data: Binary data to store
        """
        client = await self._get_client()
        full_key = self._make_key(key)

        try:
            if self.ttl_seconds:
                await client.setex(full_key, self.ttl_seconds, data)
            else:
                await client.set(full_key, data)

            self.logger.debug(
                "State saved to Redis",
                key=key,
                size=len(data),
            )
        except redis.RedisError as e:
            self.logger.error(
                "Redis save failed",
                key=key,
                error=str(e),
            )
            raise

    async def load(self, key: str) -> bytes | None:
        """
        Load data from Redis.

        Args:
            key: Storage key

        Returns:
            Stored data or None if not found
        """
        client = await self._get_client()
        full_key = self._make_key(key)

        try:
            data = await client.get(full_key)

            if data:
                self.logger.debug(
                    "State loaded from Redis",
                    key=key,
                    size=len(data),
                )

            return data
        except redis.RedisError as e:
            self.logger.error(
                "Redis load failed",
                key=key,
                error=str(e),
            )
            raise

    async def delete(self, key: str) -> bool:
        """
        Delete a key from Redis.

        Args:
            key: Storage key

        Returns:
            True if deleted, False if not found
        """
        client = await self._get_client()
        full_key = self._make_key(key)

        try:
            result = await client.delete(full_key)
            deleted = result > 0

            if deleted:
                self.logger.debug("State deleted from Redis", key=key)

            return deleted
        except redis.RedisError as e:
            self.logger.error(
                "Redis delete failed",
                key=key,
                error=str(e),
            )
            raise

    async def list_keys(self, prefix: str) -> list[str]:
        """
        List all keys with a given prefix.

        Args:
            prefix: Key prefix to match

        Returns:
            List of matching keys (without the global prefix)
        """
        client = await self._get_client()
        full_prefix = self._make_key(prefix)

        try:
            # Use SCAN for safe iteration over large key sets
            keys = []
            cursor = 0

            while True:
                cursor, partial_keys = await client.scan(
                    cursor=cursor,
                    match=f"{full_prefix}*",
                    count=100,
                )

                for key in partial_keys:
                    # Remove our prefix to return clean key
                    key_str = key.decode("utf-8") if isinstance(key, bytes) else key
                    clean_key = key_str[len(self.key_prefix) :]
                    keys.append(clean_key)

                if cursor == 0:
                    break

            self.logger.debug(
                "Keys listed from Redis",
                prefix=prefix,
                count=len(keys),
            )

            return keys
        except redis.RedisError as e:
            self.logger.error(
                "Redis list_keys failed",
                prefix=prefix,
                error=str(e),
            )
            raise

    async def exists(self, key: str) -> bool:
        """
        Check if a key exists.

        Args:
            key: Storage key

        Returns:
            True if key exists
        """
        client = await self._get_client()
        full_key = self._make_key(key)

        try:
            return await client.exists(full_key) > 0
        except redis.RedisError as e:
            self.logger.error(
                "Redis exists check failed",
                key=key,
                error=str(e),
            )
            raise

    async def get_ttl(self, key: str) -> int | None:
        """
        Get remaining TTL for a key.

        Args:
            key: Storage key

        Returns:
            TTL in seconds, -1 if no expiry, -2 if not found, None on error
        """
        client = await self._get_client()
        full_key = self._make_key(key)

        try:
            ttl = await client.ttl(full_key)
            return ttl
        except redis.RedisError as e:
            self.logger.error(
                "Redis TTL check failed",
                key=key,
                error=str(e),
            )
            return None

    async def extend_ttl(self, key: str, seconds: int | None = None) -> bool:
        """
        Extend the TTL of a key.

        Args:
            key: Storage key
            seconds: New TTL in seconds (uses default if None)

        Returns:
            True if successful
        """
        client = await self._get_client()
        full_key = self._make_key(key)
        ttl = seconds or self.ttl_seconds

        if ttl is None:
            return True  # No TTL configured

        try:
            return await client.expire(full_key, ttl)
        except redis.RedisError as e:
            self.logger.error(
                "Redis TTL extend failed",
                key=key,
                error=str(e),
            )
            return False

    async def save_with_lock(
        self,
        key: str,
        data: bytes,
        lock_timeout: int = 10,
    ) -> bool:
        """
        Save data with a distributed lock for safe concurrent access.

        Args:
            key: Storage key
            data: Binary data to store
            lock_timeout: Lock timeout in seconds

        Returns:
            True if saved successfully with lock
        """
        client = await self._get_client()
        lock_key = f"{self._make_key(key)}:lock"

        try:
            # Try to acquire lock
            lock_acquired = await client.set(
                lock_key,
                b"1",
                nx=True,
                ex=lock_timeout,
            )

            if not lock_acquired:
                self.logger.warning(
                    "Failed to acquire lock for save",
                    key=key,
                )
                return False

            try:
                # Save data while holding lock
                await self.save(key, data)
                return True
            finally:
                # Release lock
                await client.delete(lock_key)

        except redis.RedisError as e:
            self.logger.error(
                "Redis locked save failed",
                key=key,
                error=str(e),
            )
            return False

    async def atomic_update(
        self,
        key: str,
        update_fn,
        max_retries: int = 3,
    ) -> bool:
        """
        Atomically update a value using optimistic locking.

        Args:
            key: Storage key
            update_fn: Function that takes current data and returns new data
            max_retries: Maximum retry attempts on conflict

        Returns:
            True if updated successfully
        """
        client = await self._get_client()
        full_key = self._make_key(key)

        for attempt in range(max_retries):
            try:
                # Watch the key for changes
                async with client.pipeline(transaction=True) as pipe:
                    await pipe.watch(full_key)

                    # Get current value
                    current = await pipe.get(full_key)

                    # Apply update function
                    new_data = update_fn(current)

                    # Execute transaction
                    pipe.multi()
                    if self.ttl_seconds:
                        pipe.setex(full_key, self.ttl_seconds, new_data)
                    else:
                        pipe.set(full_key, new_data)

                    await pipe.execute()
                    return True

            except redis.WatchError:
                # Key was modified by another client, retry
                self.logger.debug(
                    "Atomic update conflict, retrying",
                    key=key,
                    attempt=attempt + 1,
                )
                await asyncio.sleep(0.1 * (attempt + 1))

            except redis.RedisError as e:
                self.logger.error(
                    "Redis atomic update failed",
                    key=key,
                    error=str(e),
                )
                return False

        self.logger.warning(
            "Atomic update failed after max retries",
            key=key,
            max_retries=max_retries,
        )
        return False

    async def get_storage_stats(self) -> dict:
        """Get Redis storage statistics."""
        client = await self._get_client()

        try:
            # Count our keys
            keys = await self.list_keys("")
            total_size = 0

            for key in keys[:100]:  # Sample first 100 keys
                data = await self.load(key)
                if data:
                    total_size += len(data)

            # Get Redis info
            info = await client.info("memory")

            return {
                "total_keys": len(keys),
                "sampled_size_bytes": total_size,
                "redis_used_memory": info.get("used_memory", 0),
                "redis_used_memory_human": info.get("used_memory_human", "unknown"),
            }
        except redis.RedisError as e:
            self.logger.error("Failed to get storage stats", error=str(e))
            return {}

    async def close(self) -> None:
        """Close Redis connection."""
        if self._client:
            await self._client.close()
            self._client = None

        if self._pool:
            await self._pool.disconnect()
            self._pool = None

        self.logger.info("Redis state storage closed")

    async def health_check(self) -> dict:
        """Check Redis connection health."""
        try:
            client = await self._get_client()
            start = asyncio.get_event_loop().time()
            await client.ping()
            latency = (asyncio.get_event_loop().time() - start) * 1000

            return {
                "healthy": True,
                "latency_ms": round(latency, 2),
            }
        except Exception as e:
            return {
                "healthy": False,
                "error": str(e),
            }


# Global instance
_redis_storage: RedisStateStorage | None = None


def get_redis_state_storage() -> RedisStateStorage:
    """Get or create the global Redis state storage instance."""
    global _redis_storage
    if _redis_storage is None:
        _redis_storage = RedisStateStorage()
    return _redis_storage


async def close_redis_state_storage() -> None:
    """Close the global Redis state storage."""
    global _redis_storage
    if _redis_storage:
        await _redis_storage.close()
        _redis_storage = None
