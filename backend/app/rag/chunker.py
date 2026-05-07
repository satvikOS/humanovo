"""
Document Chunker Module

Intelligent document chunking strategies for optimal RAG performance.
Supports semantic, sentence, and fixed-size chunking with overlap.
"""

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from pydantic import BaseModel

from app.core.logging import LoggerMixin, get_logger

logger = get_logger(__name__)


class ChunkingStrategy(StrEnum):
    """Chunking strategy options."""

    FIXED_SIZE = "fixed_size"
    SENTENCE = "sentence"
    PARAGRAPH = "paragraph"
    SEMANTIC = "semantic"
    RECURSIVE = "recursive"


@dataclass
class ChunkingConfig:
    """Configuration for document chunking."""

    strategy: ChunkingStrategy = ChunkingStrategy.RECURSIVE
    chunk_size: int = 512
    chunk_overlap: int = 50
    min_chunk_size: int = 100
    max_chunk_size: int = 2000

    # Sentence chunking settings
    sentences_per_chunk: int = 5
    sentence_overlap: int = 1

    # Semantic chunking settings
    similarity_threshold: float = 0.7

    # Metadata preservation
    preserve_metadata: bool = True
    include_headers: bool = True


class DocumentChunk(BaseModel):
    """A chunk of a document."""

    id: str
    content: str
    index: int
    start_char: int
    end_char: int

    # Source document info
    document_id: str
    document_title: str | None = None

    # Chunk metadata
    metadata: dict[str, Any] = {}
    token_count: int | None = None

    # Context
    header: str | None = None
    section: str | None = None


class ChunkingResult(BaseModel):
    """Result of chunking a document."""

    document_id: str
    chunks: list[DocumentChunk]
    total_chunks: int
    total_chars: int
    strategy_used: ChunkingStrategy


class BaseChunker(ABC, LoggerMixin):
    """Abstract base class for document chunkers."""

    def __init__(self, config: ChunkingConfig):
        self.config = config

    @abstractmethod
    def chunk(
        self,
        text: str,
        document_id: str,
        metadata: dict[str, Any] = None,
    ) -> list[DocumentChunk]:
        """Chunk a document into smaller pieces."""
        pass


class FixedSizeChunker(BaseChunker):
    """Chunker using fixed character size with overlap."""

    def chunk(
        self,
        text: str,
        document_id: str,
        metadata: dict[str, Any] = None,
    ) -> list[DocumentChunk]:
        """Chunk by fixed character size."""
        chunks = []
        metadata = metadata or {}

        text_length = len(text)
        start = 0
        index = 0

        while start < text_length:
            # Calculate end position
            end = min(start + self.config.chunk_size, text_length)

            # Try to break at word boundary
            if end < text_length:
                # Look for space within last 50 chars
                for i in range(end, max(start, end - 50), -1):
                    if text[i] == " ":
                        end = i
                        break

            chunk_text = text[start:end].strip()

            if len(chunk_text) >= self.config.min_chunk_size:
                chunks.append(
                    DocumentChunk(
                        id=f"{document_id}_chunk_{index}",
                        content=chunk_text,
                        index=index,
                        start_char=start,
                        end_char=end,
                        document_id=document_id,
                        metadata=metadata.copy(),
                    )
                )
                index += 1

            # Move start with overlap
            start = end - self.config.chunk_overlap
            if start <= chunks[-1].start_char if chunks else 0:
                start = end  # Prevent infinite loop

        return chunks


class SentenceChunker(BaseChunker):
    """Chunker that groups sentences together."""

    def chunk(
        self,
        text: str,
        document_id: str,
        metadata: dict[str, Any] = None,
    ) -> list[DocumentChunk]:
        """Chunk by grouping sentences."""
        chunks = []
        metadata = metadata or {}

        # Split into sentences
        sentences = self._split_sentences(text)

        if not sentences:
            return chunks

        index = 0
        i = 0

        while i < len(sentences):
            # Get sentences for this chunk
            end_idx = min(i + self.config.sentences_per_chunk, len(sentences))
            chunk_sentences = sentences[i:end_idx]
            chunk_text = " ".join(chunk_sentences)

            # Find character positions
            start_char = text.find(chunk_sentences[0]) if chunk_sentences else 0
            end_char = start_char + len(chunk_text)

            if len(chunk_text) >= self.config.min_chunk_size:
                chunks.append(
                    DocumentChunk(
                        id=f"{document_id}_chunk_{index}",
                        content=chunk_text,
                        index=index,
                        start_char=start_char,
                        end_char=end_char,
                        document_id=document_id,
                        metadata=metadata.copy(),
                    )
                )
                index += 1

            # Move with overlap
            i = end_idx - self.config.sentence_overlap
            if i <= 0 or i == (end_idx - self.config.sentences_per_chunk):
                i = end_idx  # Prevent infinite loop

        return chunks

    def _split_sentences(self, text: str) -> list[str]:
        """Split text into sentences."""
        # Simple sentence splitting
        pattern = r"(?<=[.!?])\s+"
        sentences = re.split(pattern, text)
        return [s.strip() for s in sentences if s.strip()]


class ParagraphChunker(BaseChunker):
    """Chunker that splits by paragraphs."""

    def chunk(
        self,
        text: str,
        document_id: str,
        metadata: dict[str, Any] = None,
    ) -> list[DocumentChunk]:
        """Chunk by paragraphs."""
        chunks = []
        metadata = metadata or {}

        # Split by double newlines
        paragraphs = re.split(r"\n\s*\n", text)
        paragraphs = [p.strip() for p in paragraphs if p.strip()]

        current_chunk = []
        current_length = 0
        start_char = 0
        index = 0

        for para in paragraphs:
            para_length = len(para)

            # If adding this paragraph exceeds max size, save current chunk
            if current_length + para_length > self.config.max_chunk_size and current_chunk:
                chunk_text = "\n\n".join(current_chunk)
                end_char = start_char + len(chunk_text)

                chunks.append(
                    DocumentChunk(
                        id=f"{document_id}_chunk_{index}",
                        content=chunk_text,
                        index=index,
                        start_char=start_char,
                        end_char=end_char,
                        document_id=document_id,
                        metadata=metadata.copy(),
                    )
                )
                index += 1

                # Reset
                start_char = end_char + 2  # Account for paragraph break
                current_chunk = []
                current_length = 0

            current_chunk.append(para)
            current_length += para_length

        # Save remaining
        if current_chunk:
            chunk_text = "\n\n".join(current_chunk)
            if len(chunk_text) >= self.config.min_chunk_size:
                chunks.append(
                    DocumentChunk(
                        id=f"{document_id}_chunk_{index}",
                        content=chunk_text,
                        index=index,
                        start_char=start_char,
                        end_char=start_char + len(chunk_text),
                        document_id=document_id,
                        metadata=metadata.copy(),
                    )
                )

        return chunks


class RecursiveChunker(BaseChunker):
    """
    Recursive chunker that tries multiple separators.

    Attempts to split on larger semantic boundaries first,
    then falls back to smaller ones if chunks are too large.
    """

    SEPARATORS = [
        "\n\n\n",  # Major sections
        "\n\n",  # Paragraphs
        "\n",  # Lines
        ". ",  # Sentences
        ", ",  # Clauses
        " ",  # Words
    ]

    def chunk(
        self,
        text: str,
        document_id: str,
        metadata: dict[str, Any] = None,
    ) -> list[DocumentChunk]:
        """Chunk recursively using multiple separators."""
        metadata = metadata or {}

        raw_chunks = self._recursive_split(text, self.SEPARATORS)

        # Merge small chunks, split large chunks
        merged_chunks = self._merge_chunks(raw_chunks)

        # Create DocumentChunk objects
        chunks = []
        char_pos = 0

        for i, chunk_text in enumerate(merged_chunks):
            start_char = text.find(chunk_text, char_pos)
            if start_char == -1:
                start_char = char_pos
            end_char = start_char + len(chunk_text)

            chunks.append(
                DocumentChunk(
                    id=f"{document_id}_chunk_{i}",
                    content=chunk_text,
                    index=i,
                    start_char=start_char,
                    end_char=end_char,
                    document_id=document_id,
                    metadata=metadata.copy(),
                )
            )

            char_pos = end_char

        return chunks

    def _recursive_split(
        self,
        text: str,
        separators: list[str],
    ) -> list[str]:
        """Recursively split text using separators."""
        if not separators:
            return [text] if text.strip() else []

        separator = separators[0]
        remaining_separators = separators[1:]

        splits = text.split(separator)

        chunks = []
        for split in splits:
            split = split.strip()
            if not split:
                continue

            if len(split) <= self.config.chunk_size:
                chunks.append(split)
            else:
                # Recursively split with remaining separators
                sub_chunks = self._recursive_split(split, remaining_separators)
                chunks.extend(sub_chunks)

        return chunks

    def _merge_chunks(self, chunks: list[str]) -> list[str]:
        """Merge small chunks and add overlap."""
        if not chunks:
            return []

        merged = []
        current = []
        current_length = 0

        for chunk in chunks:
            chunk_length = len(chunk)

            if current_length + chunk_length <= self.config.chunk_size:
                current.append(chunk)
                current_length += chunk_length + 1  # +1 for separator
            else:
                if current:
                    merged.append(" ".join(current))

                # Start new chunk, possibly with overlap
                if self.config.chunk_overlap > 0 and current:
                    # Include last part of previous chunk as overlap
                    overlap_text = " ".join(current)[-self.config.chunk_overlap :]
                    current = [overlap_text, chunk]
                    current_length = len(overlap_text) + chunk_length + 1
                else:
                    current = [chunk]
                    current_length = chunk_length

        # Add remaining
        if current:
            merged.append(" ".join(current))

        # Filter by min size
        return [c for c in merged if len(c) >= self.config.min_chunk_size]


class SemanticChunker(BaseChunker):
    """
    Semantic chunker using embeddings to find natural break points.

    Groups sentences with similar semantic meaning together.
    """

    def __init__(self, config: ChunkingConfig, embedding_pipeline=None):
        super().__init__(config)
        self._embedding_pipeline = embedding_pipeline

    def chunk(
        self,
        text: str,
        document_id: str,
        metadata: dict[str, Any] = None,
    ) -> list[DocumentChunk]:
        """Chunk based on semantic similarity."""
        metadata = metadata or {}

        # Fall back to sentence chunking if no embedding pipeline
        if not self._embedding_pipeline:
            self.logger.warning("No embedding pipeline, falling back to sentence chunking")
            fallback = SentenceChunker(self.config)
            return fallback.chunk(text, document_id, metadata)

        # Split into sentences
        sentences = self._split_sentences(text)

        if len(sentences) <= 1:
            return [
                DocumentChunk(
                    id=f"{document_id}_chunk_0",
                    content=text,
                    index=0,
                    start_char=0,
                    end_char=len(text),
                    document_id=document_id,
                    metadata=metadata,
                )
            ]

        # This would compute embeddings and find break points
        # For now, use sentence-based fallback
        fallback = SentenceChunker(self.config)
        return fallback.chunk(text, document_id, metadata)

    def _split_sentences(self, text: str) -> list[str]:
        """Split text into sentences."""
        pattern = r"(?<=[.!?])\s+"
        sentences = re.split(pattern, text)
        return [s.strip() for s in sentences if s.strip()]


class DocumentChunker(LoggerMixin):
    """
    Main document chunking orchestrator.

    Selects appropriate chunking strategy based on document type
    and content, with support for metadata preservation.
    """

    def __init__(
        self,
        config: ChunkingConfig | None = None,
        embedding_pipeline=None,
    ):
        self.config = config or ChunkingConfig()
        self._embedding_pipeline = embedding_pipeline
        self._chunkers: dict[ChunkingStrategy, BaseChunker] = {}
        self._initialize_chunkers()

    def _initialize_chunkers(self) -> None:
        """Initialize available chunkers."""
        self._chunkers = {
            ChunkingStrategy.FIXED_SIZE: FixedSizeChunker(self.config),
            ChunkingStrategy.SENTENCE: SentenceChunker(self.config),
            ChunkingStrategy.PARAGRAPH: ParagraphChunker(self.config),
            ChunkingStrategy.RECURSIVE: RecursiveChunker(self.config),
            ChunkingStrategy.SEMANTIC: SemanticChunker(
                self.config,
                self._embedding_pipeline,
            ),
        }

    def chunk_document(
        self,
        text: str,
        document_id: str,
        title: str | None = None,
        metadata: dict[str, Any] = None,
        strategy: ChunkingStrategy | None = None,
    ) -> ChunkingResult:
        """
        Chunk a document into smaller pieces.

        Args:
            text: Document text content
            document_id: Unique document identifier
            title: Optional document title
            metadata: Optional metadata to include in chunks
            strategy: Optional strategy override

        Returns:
            ChunkingResult with list of chunks
        """
        strategy = strategy or self.config.strategy
        metadata = metadata or {}

        # Add title to metadata if provided
        if title:
            metadata["document_title"] = title

        # Get appropriate chunker
        chunker = self._chunkers.get(strategy)
        if not chunker:
            self.logger.warning(f"Unknown strategy {strategy}, using recursive")
            chunker = self._chunkers[ChunkingStrategy.RECURSIVE]

        # Preprocess text
        text = self._preprocess_text(text)

        # Extract headers if configured
        headers = []
        if self.config.include_headers:
            headers = self._extract_headers(text)

        # Chunk the document
        chunks = chunker.chunk(text, document_id, metadata)

        # Post-process chunks
        chunks = self._postprocess_chunks(chunks, title, headers)

        # Estimate token counts
        for chunk in chunks:
            chunk.token_count = self._estimate_tokens(chunk.content)

        self.logger.debug(
            "Document chunked",
            document_id=document_id,
            chunks=len(chunks),
            strategy=strategy.value,
        )

        return ChunkingResult(
            document_id=document_id,
            chunks=chunks,
            total_chunks=len(chunks),
            total_chars=len(text),
            strategy_used=strategy,
        )

    def chunk_batch(
        self,
        documents: list[dict[str, Any]],
        strategy: ChunkingStrategy | None = None,
    ) -> list[ChunkingResult]:
        """
        Chunk multiple documents.

        Args:
            documents: List of dicts with 'text', 'id', and optional 'title', 'metadata'
            strategy: Optional strategy override for all documents

        Returns:
            List of ChunkingResult objects
        """
        results = []
        for doc in documents:
            result = self.chunk_document(
                text=doc["text"],
                document_id=doc["id"],
                title=doc.get("title"),
                metadata=doc.get("metadata"),
                strategy=strategy,
            )
            results.append(result)
        return results

    def _preprocess_text(self, text: str) -> str:
        """Preprocess text before chunking."""
        # Normalize whitespace
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"\n\s*\n", "\n\n", text)

        # Remove control characters
        text = "".join(c for c in text if c.isprintable() or c in "\n\t")

        return text.strip()

    def _extract_headers(self, text: str) -> list[tuple[int, str]]:
        """Extract section headers from text."""
        headers = []

        # Match common header patterns
        patterns = [
            r"^#+\s+(.+)$",  # Markdown headers
            r"^([A-Z][A-Z\s]+)$",  # ALL CAPS HEADERS
            r"^(\d+\.?\s+[A-Z].+)$",  # Numbered sections
        ]

        for pattern in patterns:
            for match in re.finditer(pattern, text, re.MULTILINE):
                headers.append((match.start(), match.group(1).strip()))

        # Sort by position
        headers.sort(key=lambda x: x[0])
        return headers

    def _postprocess_chunks(
        self,
        chunks: list[DocumentChunk],
        title: str | None,
        headers: list[tuple[int, str]],
    ) -> list[DocumentChunk]:
        """Post-process chunks with context."""
        for chunk in chunks:
            # Set document title
            chunk.document_title = title

            # Find relevant header for this chunk
            if headers:
                for pos, header in reversed(headers):
                    if pos <= chunk.start_char:
                        chunk.header = header
                        break

        return chunks

    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count (rough approximation)."""
        # Rough estimate: ~4 characters per token for English
        return len(text) // 4

    def get_optimal_strategy(self, text: str) -> ChunkingStrategy:
        """
        Determine optimal chunking strategy for text.

        Args:
            text: Document text

        Returns:
            Recommended ChunkingStrategy
        """
        # Check for structured content
        if re.search(r"^#+\s", text, re.MULTILINE):
            return ChunkingStrategy.PARAGRAPH  # Markdown-like

        # Check for code
        if re.search(r"```|def |class |function ", text):
            return ChunkingStrategy.RECURSIVE

        # Check for scientific content (long paragraphs)
        paragraphs = text.split("\n\n")
        avg_para_length = sum(len(p) for p in paragraphs) / max(len(paragraphs), 1)

        if avg_para_length > 500:
            return ChunkingStrategy.SENTENCE  # Long paragraphs, split by sentence

        return ChunkingStrategy.RECURSIVE  # Default


# Global chunker instance
_chunker: DocumentChunker | None = None


def init_chunker(config: ChunkingConfig | None = None) -> None:
    """Initialize the global document chunker."""
    global _chunker
    _chunker = DocumentChunker(config)


def get_chunker() -> DocumentChunker:
    """Get the global document chunker instance."""
    if _chunker is None:
        init_chunker()
    return _chunker
