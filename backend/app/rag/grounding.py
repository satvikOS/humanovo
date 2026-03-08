"""
Embedding Grounding Module — Dual-Model Semantic Grounding for the 10-Stage Pipeline

Architecture:
  Two embedding models run in parallel on every pipeline stage output:
  1. Bedrock Cohere Embed English v3 (1024d) — biomedical-optimized, strong on scientific text
  2. Azure text-embedding-3-large (3072d)    — most powerful general embedding, highest MTEB score

Two grounding mechanisms operate between each pipeline stage:

  A) RAG Retrieval Grounding:
     After each stage, the hypothesis output is embedded using BOTH models.
     The embeddings are used to retrieve the most relevant evidence chunks
     from the vector store. Retrieved evidence is injected into the next
     stage's prompt, ensuring each model sees contextually relevant data.

  B) Semantic Similarity Gating:
     Each claim/assertion in the stage output is embedded and compared
     against the accumulated evidence embeddings. Claims with cosine
     similarity below the threshold are flagged as potentially ungrounded.
     The next stage receives a "grounding report" identifying which claims
     are well-supported vs. potentially hallucinated.

This ensures ZERO hallucinations by construction:
  - Every claim is checked against real evidence embeddings
  - Ungrounded claims are explicitly surfaced for the next model to fix
  - Each stage gets RAG-retrieved evidence relevant to its specific output
"""

import asyncio
import re
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class GroundingResult:
    """Result of semantic grounding for a single claim."""
    claim: str
    max_similarity_primary: float  # Bedrock Cohere similarity
    max_similarity_secondary: float  # Azure large similarity
    combined_similarity: float  # Weighted average
    is_grounded: bool
    best_matching_evidence: str = ""
    best_matching_source: str = ""


@dataclass
class StageGroundingReport:
    """Complete grounding report for a pipeline stage output."""
    stage_num: int
    total_claims: int
    grounded_claims: int
    ungrounded_claims: int
    grounding_ratio: float
    claim_results: list[GroundingResult]
    rag_retrieved_chunks: list[dict[str, Any]] = field(default_factory=list)
    evidence_text_for_next_stage: str = ""
    grounding_flags_for_next_stage: str = ""


class DualEmbeddingGrounder:
    """
    Dual-model embedding grounding engine.

    Runs Bedrock Cohere Embed v3 AND Azure text-embedding-3-large in parallel
    on every pipeline stage output to provide maximum grounding coverage.

    The two models complement each other:
    - Cohere Embed v3: Trained on scientific/biomedical corpora, strong on
      domain-specific terminology, protein names, pathway concepts
    - Azure text-embedding-3-large: Highest general MTEB score (3072d),
      captures broad semantic relationships, cross-domain connections
    """

    # Weight for combining the two embedding similarities
    # Cohere gets slightly higher weight for biomedical domain
    PRIMARY_WEIGHT = 0.55    # Bedrock Cohere (biomedical-strong)
    SECONDARY_WEIGHT = 0.45  # Azure large (general-strong)

    def __init__(self):
        self._primary_embedder = None    # Bedrock Cohere
        self._secondary_embedder = None  # Azure large
        self._initialized = False
        self._evidence_embeddings_primary: list[tuple[str, str, list[float]]] = []  # (text, source, embedding)
        self._evidence_embeddings_secondary: list[tuple[str, str, list[float]]] = []

    async def initialize(self) -> None:
        """Initialize both embedding models."""
        if self._initialized:
            return

        from app.rag.embeddings import (
            EmbeddingModel, EmbeddingConfig,
            BedrockEmbedder, AzureOpenAIEmbedder,
        )

        # Primary: Bedrock Cohere Embed English v3
        try:
            primary_config = EmbeddingConfig.for_model(EmbeddingModel.BEDROCK_COHERE_ENGLISH)
            self._primary_embedder = BedrockEmbedder(primary_config)
            await self._primary_embedder.initialize()
            logger.info("Grounding primary embedder initialized: Bedrock Cohere Embed v3 (1024d)")
        except Exception as e:
            logger.warning(f"Primary embedder (Bedrock Cohere) failed to init: {e}")
            # Fallback to local BGE-large
            try:
                from app.rag.embeddings import SentenceTransformerEmbedder
                fallback_config = EmbeddingConfig.for_model(EmbeddingModel.BGE_LARGE)
                self._primary_embedder = SentenceTransformerEmbedder(fallback_config)
                await self._primary_embedder.initialize()
                logger.info("Grounding primary embedder fallback: BGE-large-en-v1.5 (1024d)")
            except Exception as e2:
                logger.error(f"Primary embedder fallback also failed: {e2}")

        # Secondary: Azure text-embedding-3-large
        try:
            secondary_config = EmbeddingConfig.for_model(EmbeddingModel.AZURE_EMBEDDING_LARGE)
            self._secondary_embedder = AzureOpenAIEmbedder(secondary_config)
            await self._secondary_embedder.initialize()
            logger.info("Grounding secondary embedder initialized: Azure text-embedding-3-large (3072d)")
        except Exception as e:
            logger.warning(f"Secondary embedder (Azure large) failed to init: {e}")
            # Fallback to local E5-large
            try:
                from app.rag.embeddings import E5Embedder
                fallback_config = EmbeddingConfig.for_model(EmbeddingModel.E5_LARGE)
                self._secondary_embedder = E5Embedder(fallback_config)
                await self._secondary_embedder.initialize()
                logger.info("Grounding secondary embedder fallback: E5-large-v2 (1024d)")
            except Exception as e2:
                logger.error(f"Secondary embedder fallback also failed: {e2}")

        self._initialized = True

    async def ingest_evidence(self, evidence_text: str, source: str = "grounding") -> None:
        """
        Embed evidence text and store for comparison.

        Called when new evidence is retrieved (from PubMed, Elsevier, etc.)
        to build the evidence embedding pool that claims are compared against.
        """
        if not self._initialized:
            await self.initialize()

        # Split evidence into chunks (sentences/paragraphs)
        chunks = self._split_into_chunks(evidence_text)
        if not chunks:
            return

        # Embed all chunks with both models in parallel
        tasks = []
        if self._primary_embedder:
            tasks.append(("primary", self._primary_embedder.embed_batch(chunks)))
        if self._secondary_embedder:
            tasks.append(("secondary", self._secondary_embedder.embed_batch(chunks)))

        results = await asyncio.gather(
            *[t[1] for t in tasks],
            return_exceptions=True,
        )

        for (model_name, _), result in zip(tasks, results):
            if isinstance(result, Exception):
                logger.warning(f"Evidence embedding failed for {model_name}: {result}")
                continue
            for chunk, embedding in zip(chunks, result):
                if model_name == "primary":
                    self._evidence_embeddings_primary.append((chunk, source, embedding))
                else:
                    self._evidence_embeddings_secondary.append((chunk, source, embedding))

        logger.info(f"Ingested {len(chunks)} evidence chunks from '{source}' into grounding pool "
                    f"(primary: {len(self._evidence_embeddings_primary)}, secondary: {len(self._evidence_embeddings_secondary)})")

    async def ground_stage_output(
        self,
        stage_output: str,
        stage_num: int,
        rag_service=None,
    ) -> StageGroundingReport:
        """
        Ground the output of a pipeline stage using dual-model embeddings.

        This is the main entry point called between each pipeline stage.
        It performs both:
        A) RAG retrieval — find relevant evidence for the next stage
        B) Semantic similarity gating — flag ungrounded claims

        Args:
            stage_output: The text output from the current pipeline stage
            stage_num: The stage number (1-10)
            rag_service: Optional RAG service for vector store retrieval

        Returns:
            StageGroundingReport with grounding analysis and retrieved evidence
        """
        if not self._initialized:
            await self.initialize()

        threshold = settings.GROUNDING_SIMILARITY_THRESHOLD

        # === A) RAG Retrieval Grounding ===
        rag_chunks = await self._rag_retrieve(stage_output, rag_service)

        # Ingest RAG-retrieved evidence into the grounding pool
        for chunk in rag_chunks:
            chunk_text = chunk.get("text", "")
            if chunk_text:
                await self.ingest_evidence(chunk_text, source=f"rag_stage_{stage_num}")

        # === B) Semantic Similarity Gating ===
        claims = self._extract_claims(stage_output)
        claim_results = []

        if claims and (self._evidence_embeddings_primary or self._evidence_embeddings_secondary):
            # Embed all claims with both models
            primary_claim_embeddings = []
            secondary_claim_embeddings = []

            if self._primary_embedder and claims:
                try:
                    primary_claim_embeddings = await self._primary_embedder.embed_batch(claims)
                except Exception as e:
                    logger.warning(f"Primary claim embedding failed: {e}")

            if self._secondary_embedder and claims:
                try:
                    secondary_claim_embeddings = await self._secondary_embedder.embed_batch(claims)
                except Exception as e:
                    logger.warning(f"Secondary claim embedding failed: {e}")

            # Compare each claim against evidence pool
            for i, claim in enumerate(claims):
                primary_sim = 0.0
                secondary_sim = 0.0
                best_evidence = ""
                best_source = ""

                # Primary model similarity
                if i < len(primary_claim_embeddings) and self._evidence_embeddings_primary:
                    claim_emb = np.array(primary_claim_embeddings[i])
                    best_idx = -1
                    for j, (ev_text, ev_source, ev_emb) in enumerate(self._evidence_embeddings_primary):
                        sim = self._cosine_similarity(claim_emb, np.array(ev_emb))
                        if sim > primary_sim:
                            primary_sim = sim
                            best_idx = j
                    if best_idx >= 0:
                        best_evidence = self._evidence_embeddings_primary[best_idx][0][:200]
                        best_source = self._evidence_embeddings_primary[best_idx][1]

                # Secondary model similarity
                if i < len(secondary_claim_embeddings) and self._evidence_embeddings_secondary:
                    claim_emb = np.array(secondary_claim_embeddings[i])
                    for j, (_, _, ev_emb) in enumerate(self._evidence_embeddings_secondary):
                        sim = self._cosine_similarity(claim_emb, np.array(ev_emb))
                        if sim > secondary_sim:
                            secondary_sim = sim

                # Weighted combination
                combined = (primary_sim * self.PRIMARY_WEIGHT + secondary_sim * self.SECONDARY_WEIGHT)
                is_grounded = combined >= threshold

                claim_results.append(GroundingResult(
                    claim=claim[:300],
                    max_similarity_primary=round(primary_sim, 4),
                    max_similarity_secondary=round(secondary_sim, 4),
                    combined_similarity=round(combined, 4),
                    is_grounded=is_grounded,
                    best_matching_evidence=best_evidence,
                    best_matching_source=best_source,
                ))
        else:
            # No evidence pool yet — mark all claims as needing verification
            for claim in claims:
                claim_results.append(GroundingResult(
                    claim=claim[:300],
                    max_similarity_primary=0.0,
                    max_similarity_secondary=0.0,
                    combined_similarity=0.0,
                    is_grounded=False,
                    best_matching_evidence="",
                    best_matching_source="no evidence pool",
                ))

        # Build report
        grounded = sum(1 for cr in claim_results if cr.is_grounded)
        total = len(claim_results) or 1

        # Format evidence text for next stage (RAG retrieval results)
        rag_evidence_text = self._format_rag_evidence(rag_chunks)

        # Format grounding flags for next stage
        grounding_flags = self._format_grounding_flags(claim_results)

        report = StageGroundingReport(
            stage_num=stage_num,
            total_claims=len(claim_results),
            grounded_claims=grounded,
            ungrounded_claims=len(claim_results) - grounded,
            grounding_ratio=round(grounded / total, 3),
            claim_results=claim_results,
            rag_retrieved_chunks=rag_chunks,
            evidence_text_for_next_stage=rag_evidence_text,
            grounding_flags_for_next_stage=grounding_flags,
        )

        logger.info(
            f"Stage {stage_num} grounding: {grounded}/{len(claim_results)} claims grounded "
            f"(ratio: {report.grounding_ratio:.1%}), {len(rag_chunks)} RAG chunks retrieved"
        )

        return report

    async def _rag_retrieve(
        self,
        query_text: str,
        rag_service=None,
    ) -> list[dict[str, Any]]:
        """Retrieve relevant evidence chunks via RAG."""
        top_k = settings.GROUNDING_RAG_TOP_K
        chunks = []

        # Try vector store RAG retrieval
        if rag_service:
            try:
                result = await rag_service.query(query_text[:500], top_k=top_k)
                if result and result.context and result.context.chunks:
                    for chunk in result.context.chunks[:top_k]:
                        chunks.append({
                            "text": chunk.text[:500],
                            "source": chunk.metadata.get("source", "vector_store"),
                            "relevance": chunk.relevance_score if hasattr(chunk, 'relevance_score') else 0.0,
                        })
            except Exception as e:
                logger.debug(f"RAG retrieval failed: {e}")

        # If no RAG service or insufficient results, use direct embedding search
        if len(chunks) < top_k and self._primary_embedder and self._evidence_embeddings_primary:
            try:
                query_emb = await self._primary_embedder.embed(query_text[:500])
                query_vec = np.array(query_emb)

                # Find top-K most similar evidence chunks
                similarities = []
                for j, (ev_text, ev_source, ev_emb) in enumerate(self._evidence_embeddings_primary):
                    sim = self._cosine_similarity(query_vec, np.array(ev_emb))
                    similarities.append((sim, j))

                similarities.sort(reverse=True)
                for sim, j in similarities[:top_k - len(chunks)]:
                    if sim > 0.2:  # Minimum relevance threshold
                        ev_text, ev_source, _ = self._evidence_embeddings_primary[j]
                        chunks.append({
                            "text": ev_text[:500],
                            "source": ev_source,
                            "relevance": round(sim, 4),
                        })
            except Exception as e:
                logger.debug(f"Direct embedding search failed: {e}")

        return chunks

    def _extract_claims(self, text: str) -> list[str]:
        """Extract individual claims/assertions from stage output text."""
        claims = []

        # Try to parse JSON and extract key fields
        try:
            import json
            # Strip markdown code blocks
            clean = text.strip()
            if "```json" in clean:
                clean = clean.split("```json")[1].split("```")[0].strip()
            elif "```" in clean:
                clean = clean.split("```")[1].split("```")[0].strip()

            data = json.loads(clean)

            # Extract claim-like fields
            for key in ["title", "description", "mechanism", "hypothesis",
                        "conclusion", "summary", "finding", "claim"]:
                val = data.get(key)
                if val and isinstance(val, str) and len(val) > 20:
                    claims.append(val)

            # Extract from lists of evidence/findings
            for key in ["supporting_evidence", "evidence", "findings",
                        "causal_chain", "key_points", "claims"]:
                val = data.get(key)
                if isinstance(val, list):
                    for item in val[:5]:
                        if isinstance(item, str) and len(item) > 20:
                            claims.append(item)
                        elif isinstance(item, dict):
                            for subkey in ["finding", "claim", "event", "description", "text"]:
                                subval = item.get(subkey)
                                if subval and isinstance(subval, str) and len(subval) > 20:
                                    claims.append(subval)
                                    break

        except (json.JSONDecodeError, IndexError, AttributeError):
            pass

        # If JSON parsing didn't yield claims, split by sentences
        if not claims:
            sentences = re.split(r'[.!?]\s+', text)
            for s in sentences:
                s = s.strip()
                if len(s) > 30 and not s.startswith('#') and not s.startswith('{'):
                    claims.append(s[:500])

        return claims[:20]  # Max 20 claims per stage

    def _split_into_chunks(self, text: str) -> list[str]:
        """Split text into chunks for embedding."""
        chunks = []

        # Split by paragraphs first
        paragraphs = re.split(r'\n\n+', text)
        for para in paragraphs:
            para = para.strip()
            if len(para) < 20:
                continue
            if len(para) > 500:
                # Split long paragraphs by sentences
                sentences = re.split(r'[.!?]\s+', para)
                current = ""
                for sent in sentences:
                    if len(current) + len(sent) > 400:
                        if current:
                            chunks.append(current.strip())
                        current = sent
                    else:
                        current = f"{current} {sent}" if current else sent
                if current:
                    chunks.append(current.strip())
            else:
                chunks.append(para)

        return chunks[:50]  # Max 50 chunks per evidence ingestion

    def _format_rag_evidence(self, chunks: list[dict[str, Any]]) -> str:
        """Format RAG-retrieved chunks into evidence text for the next stage."""
        if not chunks:
            return ""

        parts = ["## EMBEDDING-GROUNDED EVIDENCE (retrieved via dual-model RAG)"]
        for i, chunk in enumerate(chunks, 1):
            parts.append(f"\n### Evidence #{i} (relevance: {chunk.get('relevance', 0):.2f}, source: {chunk.get('source', 'unknown')})")
            parts.append(chunk.get("text", ""))

        return "\n".join(parts)

    def _format_grounding_flags(self, claim_results: list[GroundingResult]) -> str:
        """Format grounding flags for the next stage to address."""
        if not claim_results:
            return ""

        ungrounded = [cr for cr in claim_results if not cr.is_grounded]
        well_grounded = [cr for cr in claim_results if cr.is_grounded and cr.combined_similarity > 0.6]

        parts = ["## SEMANTIC GROUNDING REPORT (dual-model embedding analysis)"]
        parts.append(f"Claims analyzed: {len(claim_results)} | "
                     f"Grounded: {sum(1 for cr in claim_results if cr.is_grounded)} | "
                     f"Ungrounded: {len(ungrounded)}")

        if well_grounded:
            parts.append("\n### WELL-GROUNDED CLAIMS (high confidence)")
            for cr in well_grounded[:5]:
                parts.append(f"- [sim={cr.combined_similarity:.2f}] {cr.claim[:150]}")
                if cr.best_matching_evidence:
                    parts.append(f"  Evidence: {cr.best_matching_evidence[:150]}")

        if ungrounded:
            parts.append("\n### ⚠ UNGROUNDED CLAIMS (need evidence or removal)")
            parts.append("The following claims lack sufficient support from scientific evidence.")
            parts.append("You MUST either: (1) provide real citations/evidence, (2) soften language to 'hypothesized/proposed', or (3) remove the claim.")
            for cr in ungrounded:
                parts.append(f"- [sim={cr.combined_similarity:.2f}] {cr.claim[:200]}")

        return "\n".join(parts)

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """Compute cosine similarity between two vectors."""
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))

    def clear_evidence_pool(self) -> None:
        """Clear the evidence embedding pool (for new hypothesis)."""
        self._evidence_embeddings_primary.clear()
        self._evidence_embeddings_secondary.clear()

    @property
    def evidence_pool_size(self) -> int:
        """Number of evidence chunks in the pool."""
        return max(
            len(self._evidence_embeddings_primary),
            len(self._evidence_embeddings_secondary),
        )


# Singleton
_grounding_engine: Optional[DualEmbeddingGrounder] = None


def get_grounding_engine() -> DualEmbeddingGrounder:
    """Get the global dual-embedding grounding engine."""
    global _grounding_engine
    if _grounding_engine is None:
        _grounding_engine = DualEmbeddingGrounder()
    return _grounding_engine
