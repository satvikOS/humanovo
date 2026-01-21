"""
Graph Store Module

Manages the biomedical knowledge graph using Neo4j.
Supports entity/relationship storage, graph queries, and path finding.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import get_logger, LoggerMixin

logger = get_logger(__name__)

# Global graph store instance
_graph_store: Optional["GraphStore"] = None


class Entity(BaseModel):
    """Biomedical entity in the knowledge graph."""

    id: str
    name: str
    entity_type: str
    aliases: List[str] = []
    description: Optional[str] = None
    external_ids: Dict[str, str] = {}
    properties: Dict[str, Any] = {}
    source_count: int = 0


class Relation(BaseModel):
    """Relationship between entities."""

    id: str
    source_id: str
    source_name: str
    source_type: str
    target_id: str
    target_name: str
    target_type: str
    relation_type: str
    confidence: float = 1.0
    evidence_count: int = 0
    source_references: List[str] = []


class GraphNeighborhood(BaseModel):
    """Subgraph around an entity."""

    center_entity: Entity
    entities: List[Entity]
    relations: List[Relation]
    depth: int


class GraphPath(BaseModel):
    """Path between two entities."""

    source: Entity
    target: Entity
    path: List[Relation]
    path_length: int
    path_confidence: float


class GraphStore(LoggerMixin):
    """Knowledge graph store using Neo4j.

    Stores biomedical entities and their relationships,
    supporting complex queries and path finding for hypothesis generation.
    """

    def __init__(self):
        self._initialized = False
        self._driver = None
        # In-memory fallback for development
        self._entities: Dict[str, Entity] = {}
        self._relations: Dict[str, Relation] = {}
        self._adjacency: Dict[str, List[str]] = {}  # entity_id -> list of relation_ids

    async def initialize(self) -> None:
        """Initialize the graph store connection."""
        if self._initialized:
            return

        self.logger.info("Initializing graph store")

        try:
            await self._init_neo4j()
        except Exception as e:
            self.logger.warning(
                "Neo4j initialization failed, using in-memory fallback",
                error=str(e),
            )

        self._initialized = True
        self.logger.info("Graph store initialized")

    async def _init_neo4j(self) -> None:
        """Initialize Neo4j driver."""
        try:
            from neo4j import AsyncGraphDatabase

            self._driver = AsyncGraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.neo4j_password_value),
            )

            # Test connection
            async with self._driver.session() as session:
                await session.run("RETURN 1")

            self.logger.info("Neo4j connected")
        except ImportError:
            self.logger.warning("neo4j driver not installed")
            raise
        except Exception as e:
            self.logger.error("Neo4j connection failed", error=str(e))
            raise

    async def close(self) -> None:
        """Close the graph store connection."""
        if self._driver:
            await self._driver.close()
            self.logger.info("Neo4j connection closed")

    async def add_entity(self, entity: Entity) -> str:
        """Add an entity to the knowledge graph."""
        if self._driver:
            async with self._driver.session() as session:
                query = """
                MERGE (e:Entity {id: $id})
                SET e.name = $name,
                    e.entity_type = $entity_type,
                    e.aliases = $aliases,
                    e.description = $description,
                    e.external_ids = $external_ids,
                    e.properties = $properties,
                    e.source_count = $source_count
                RETURN e.id
                """
                await session.run(
                    query,
                    id=entity.id,
                    name=entity.name,
                    entity_type=entity.entity_type,
                    aliases=entity.aliases,
                    description=entity.description,
                    external_ids=str(entity.external_ids),
                    properties=str(entity.properties),
                    source_count=entity.source_count,
                )
        else:
            self._entities[entity.id] = entity
            if entity.id not in self._adjacency:
                self._adjacency[entity.id] = []

        self.logger.debug("Entity added", entity_id=entity.id, name=entity.name)
        return entity.id

    async def add_relation(self, relation: Relation) -> str:
        """Add a relationship to the knowledge graph."""
        if self._driver:
            async with self._driver.session() as session:
                query = f"""
                MATCH (source:Entity {{id: $source_id}})
                MATCH (target:Entity {{id: $target_id}})
                MERGE (source)-[r:{relation.relation_type.upper()}]->(target)
                SET r.id = $id,
                    r.confidence = $confidence,
                    r.evidence_count = $evidence_count,
                    r.source_references = $source_references
                RETURN r.id
                """
                await session.run(
                    query,
                    id=relation.id,
                    source_id=relation.source_id,
                    target_id=relation.target_id,
                    confidence=relation.confidence,
                    evidence_count=relation.evidence_count,
                    source_references=relation.source_references,
                )
        else:
            self._relations[relation.id] = relation
            if relation.source_id not in self._adjacency:
                self._adjacency[relation.source_id] = []
            self._adjacency[relation.source_id].append(relation.id)

        self.logger.debug(
            "Relation added",
            relation_id=relation.id,
            type=relation.relation_type,
        )
        return relation.id

    async def get_entity(self, entity_id: str) -> Optional[Entity]:
        """Get an entity by ID."""
        if self._driver:
            async with self._driver.session() as session:
                query = "MATCH (e:Entity {id: $id}) RETURN e"
                result = await session.run(query, id=entity_id)
                record = await result.single()
                if record:
                    node = record["e"]
                    return Entity(
                        id=node["id"],
                        name=node["name"],
                        entity_type=node["entity_type"],
                        aliases=node.get("aliases", []),
                        description=node.get("description"),
                        external_ids=eval(node.get("external_ids", "{}")),
                        properties=eval(node.get("properties", "{}")),
                        source_count=node.get("source_count", 0),
                    )
        else:
            return self._entities.get(entity_id)

        return None

    async def search_entities(
        self,
        query: str,
        entity_types: Optional[List[str]] = None,
        limit: int = 20,
    ) -> List[Entity]:
        """Search for entities by name or alias."""
        query_lower = query.lower()

        if self._driver:
            async with self._driver.session() as session:
                cypher = """
                MATCH (e:Entity)
                WHERE toLower(e.name) CONTAINS $query
                   OR any(alias IN e.aliases WHERE toLower(alias) CONTAINS $query)
                """
                if entity_types:
                    cypher += " AND e.entity_type IN $types"
                cypher += " RETURN e LIMIT $limit"

                result = await session.run(
                    cypher,
                    query=query_lower,
                    types=entity_types,
                    limit=limit,
                )
                entities = []
                async for record in result:
                    node = record["e"]
                    entities.append(
                        Entity(
                            id=node["id"],
                            name=node["name"],
                            entity_type=node["entity_type"],
                            aliases=node.get("aliases", []),
                            description=node.get("description"),
                            source_count=node.get("source_count", 0),
                        )
                    )
                return entities
        else:
            # In-memory search
            results = []
            for entity in self._entities.values():
                if entity_types and entity.entity_type not in entity_types:
                    continue
                if query_lower in entity.name.lower() or any(
                    query_lower in alias.lower() for alias in entity.aliases
                ):
                    results.append(entity)
                    if len(results) >= limit:
                        break
            return results

    async def get_neighborhood(
        self,
        entity_id: str,
        depth: int = 1,
        relation_types: Optional[List[str]] = None,
        limit: int = 50,
    ) -> Optional[GraphNeighborhood]:
        """Get the neighborhood subgraph around an entity."""
        center = await self.get_entity(entity_id)
        if not center:
            return None

        if self._driver:
            async with self._driver.session() as session:
                # Build relationship filter
                rel_filter = ""
                if relation_types:
                    rel_types = "|".join(r.upper() for r in relation_types)
                    rel_filter = f":{rel_types}"

                query = f"""
                MATCH path = (center:Entity {{id: $id}})-[r{rel_filter}*1..{depth}]-(neighbor:Entity)
                WITH center, neighbor, r, path
                LIMIT $limit
                RETURN DISTINCT neighbor, r
                """
                result = await session.run(query, id=entity_id, limit=limit)

                entities = [center]
                relations = []
                seen_entities = {entity_id}

                async for record in result:
                    node = record["neighbor"]
                    if node["id"] not in seen_entities:
                        entities.append(
                            Entity(
                                id=node["id"],
                                name=node["name"],
                                entity_type=node["entity_type"],
                            )
                        )
                        seen_entities.add(node["id"])

                return GraphNeighborhood(
                    center_entity=center,
                    entities=entities,
                    relations=relations,
                    depth=depth,
                )
        else:
            # In-memory neighborhood
            entities = [center]
            relations = []
            visited = {entity_id}

            current_level = [entity_id]
            for _ in range(depth):
                next_level = []
                for eid in current_level:
                    for rel_id in self._adjacency.get(eid, []):
                        rel = self._relations[rel_id]
                        if relation_types and rel.relation_type not in relation_types:
                            continue

                        relations.append(rel)
                        target_id = rel.target_id if rel.source_id == eid else rel.source_id

                        if target_id not in visited:
                            visited.add(target_id)
                            if target_id in self._entities:
                                entities.append(self._entities[target_id])
                                next_level.append(target_id)

                        if len(entities) >= limit:
                            break
                    if len(entities) >= limit:
                        break
                current_level = next_level

            return GraphNeighborhood(
                center_entity=center,
                entities=entities,
                relations=relations,
                depth=depth,
            )

    async def get_relations_between(
        self,
        source_id: str,
        target_id: str,
    ) -> List[Relation]:
        """Get all relations between two entities."""
        if self._driver:
            async with self._driver.session() as session:
                query = """
                MATCH (s:Entity {id: $source})-[r]->(t:Entity {id: $target})
                RETURN type(r) as rel_type, r
                """
                result = await session.run(query, source=source_id, target=target_id)
                relations = []
                async for record in result:
                    rel = record["r"]
                    relations.append(
                        Relation(
                            id=rel.get("id", str(uuid4())),
                            source_id=source_id,
                            source_name="",
                            source_type="",
                            target_id=target_id,
                            target_name="",
                            target_type="",
                            relation_type=record["rel_type"].lower(),
                            confidence=rel.get("confidence", 1.0),
                        )
                    )
                return relations
        else:
            return [
                rel for rel in self._relations.values()
                if (rel.source_id == source_id and rel.target_id == target_id)
                or (rel.source_id == target_id and rel.target_id == source_id)
            ]

    async def find_paths(
        self,
        source_id: str,
        target_id: str,
        max_length: int = 4,
        limit: int = 5,
    ) -> List[GraphPath]:
        """Find paths between two entities."""
        source = await self.get_entity(source_id)
        target = await self.get_entity(target_id)

        if not source or not target:
            return []

        if self._driver:
            async with self._driver.session() as session:
                query = f"""
                MATCH path = shortestPath((s:Entity {{id: $source}})-[*1..{max_length}]-(t:Entity {{id: $target}}))
                RETURN path
                LIMIT $limit
                """
                result = await session.run(
                    query,
                    source=source_id,
                    target=target_id,
                    limit=limit,
                )

                paths = []
                async for record in result:
                    path_data = record["path"]
                    relations = []
                    confidence = 1.0

                    for rel in path_data.relationships:
                        relations.append(
                            Relation(
                                id=str(uuid4()),
                                source_id=str(rel.start_node.id),
                                source_name="",
                                source_type="",
                                target_id=str(rel.end_node.id),
                                target_name="",
                                target_type="",
                                relation_type=rel.type.lower(),
                                confidence=rel.get("confidence", 1.0),
                            )
                        )
                        confidence *= rel.get("confidence", 1.0)

                    paths.append(
                        GraphPath(
                            source=source,
                            target=target,
                            path=relations,
                            path_length=len(relations),
                            path_confidence=confidence,
                        )
                    )

                return paths
        else:
            # Simple BFS for in-memory
            from collections import deque

            queue = deque([(source_id, [])])
            visited = {source_id}

            paths = []
            while queue and len(paths) < limit:
                current_id, path = queue.popleft()

                if len(path) > max_length:
                    continue

                if current_id == target_id and path:
                    confidence = 1.0
                    for rel in path:
                        confidence *= rel.confidence

                    paths.append(
                        GraphPath(
                            source=source,
                            target=target,
                            path=path,
                            path_length=len(path),
                            path_confidence=confidence,
                        )
                    )
                    continue

                for rel_id in self._adjacency.get(current_id, []):
                    rel = self._relations[rel_id]
                    next_id = rel.target_id if rel.source_id == current_id else rel.source_id

                    if next_id not in visited:
                        visited.add(next_id)
                        queue.append((next_id, path + [rel]))

            return paths

    async def execute_query(
        self,
        query: str,
        parameters: Dict[str, Any] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Execute a custom Cypher query."""
        if not self._driver:
            return []

        async with self._driver.session() as session:
            result = await session.run(query, **(parameters or {}))
            records = []
            async for record in result:
                records.append(dict(record))
                if len(records) >= limit:
                    break
            return records

    async def get_stats(self) -> Dict[str, Any]:
        """Get knowledge graph statistics."""
        if self._driver:
            async with self._driver.session() as session:
                # Count entities
                result = await session.run("MATCH (e:Entity) RETURN count(e) as count")
                entity_count = (await result.single())["count"]

                # Count relations
                result = await session.run("MATCH ()-[r]->() RETURN count(r) as count")
                relation_count = (await result.single())["count"]

                # Entity type counts
                result = await session.run(
                    "MATCH (e:Entity) RETURN e.entity_type as type, count(*) as count"
                )
                entity_counts = {}
                async for record in result:
                    entity_counts[record["type"]] = record["count"]

                return {
                    "total_entities": entity_count,
                    "total_relations": relation_count,
                    "entity_counts": entity_counts,
                    "relation_counts": {},
                    "last_updated": datetime.utcnow(),
                }
        else:
            return {
                "total_entities": len(self._entities),
                "total_relations": len(self._relations),
                "entity_counts": {},
                "relation_counts": {},
                "last_updated": datetime.utcnow(),
            }


async def init_graph_store() -> None:
    """Initialize the global graph store."""
    global _graph_store
    _graph_store = GraphStore()
    await _graph_store.initialize()


def get_graph_store() -> GraphStore:
    """Get the global graph store instance."""
    if _graph_store is None:
        raise RuntimeError("Graph store not initialized")
    return _graph_store


# Convenience functions for API endpoints
async def search_entities(
    query: str,
    entity_types: Optional[List[str]] = None,
    limit: int = 20,
) -> List[Entity]:
    """Search entities in the graph."""
    store = get_graph_store()
    return await store.search_entities(query, entity_types, limit)


async def get_entity(entity_id: str) -> Optional[Entity]:
    """Get an entity by ID."""
    store = get_graph_store()
    return await store.get_entity(entity_id)


async def get_neighborhood(
    entity_id: str,
    depth: int = 1,
    relation_types: Optional[List[str]] = None,
    limit: int = 50,
) -> Optional[GraphNeighborhood]:
    """Get neighborhood around an entity."""
    store = get_graph_store()
    return await store.get_neighborhood(entity_id, depth, relation_types, limit)


async def get_relations_between(source_id: str, target_id: str) -> List[Relation]:
    """Get relations between two entities."""
    store = get_graph_store()
    return await store.get_relations_between(source_id, target_id)


async def find_paths(
    source_id: str,
    target_id: str,
    max_length: int = 4,
    limit: int = 5,
) -> List[GraphPath]:
    """Find paths between entities."""
    store = get_graph_store()
    return await store.find_paths(source_id, target_id, max_length, limit)


async def execute_query(
    query: str,
    parameters: Dict[str, Any] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Execute custom Cypher query."""
    store = get_graph_store()
    return await store.execute_query(query, parameters, limit)


async def get_stats() -> Dict[str, Any]:
    """Get graph statistics."""
    store = get_graph_store()
    return await store.get_stats()
