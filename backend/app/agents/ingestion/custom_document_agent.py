"""
Custom Document Ingestion Agent

Specialized agent for ingesting custom documents including PDFs, Word docs,
and other file formats uploaded by users.

HTTP transport: httpx via the SSRF-allowlisted factory. URL-import paths
that target hosts NOT in app.core.http_allowlist.ALLOWED_DOMAINS will
raise SSRFBlockedError to the user with a clear message — this is
intentional: importing arbitrary user-supplied URLs is a classic SSRF
window we close by default. Add new biomedical sources to the
allowlist (per INTEGRATION_INVENTORY.md) instead of widening here.
"""

import hashlib
import io
import mimetypes
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO

import httpx

from app.agents.ingestion.base import (
    IngestionAgent,
    IngestionConfig,
    IngestionRecord,
    SourceType,
)
from app.core.http_allowlist import make_httpx_client
from app.core.logging import get_logger

logger = get_logger(__name__)


class CustomDocumentConfig(IngestionConfig):
    """Configuration specific to custom document ingestion."""

    # Supported file types
    supported_types: list[str] = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/markdown",
        "text/html",
        "application/xml",
        "text/xml",
    ]

    # File size limits (in bytes)
    max_file_size: int = 50 * 1024 * 1024  # 50 MB

    # PDF-specific settings
    pdf_extract_images: bool = False
    pdf_extract_tables: bool = True
    pdf_ocr_enabled: bool = True
    pdf_ocr_language: str = "eng"

    # Chunking settings for large documents
    chunk_size: int = 4000  # Characters per chunk
    chunk_overlap: int = 200

    # Metadata extraction
    extract_metadata: bool = True
    extract_references: bool = True

    # Storage settings
    store_original: bool = True
    storage_path: str | None = None


class DocumentParser:
    """Parser for various document formats."""

    @staticmethod
    async def parse_pdf(
        content: bytes,
        extract_images: bool = False,
        extract_tables: bool = True,
        ocr_enabled: bool = True,
        ocr_language: str = "eng",
    ) -> dict[str, Any]:
        """
        Parse PDF document.

        Returns:
            Dict with text, metadata, tables, and optionally images
        """
        try:
            import fitz  # PyMuPDF
        except ImportError:
            logger.warning("PyMuPDF not installed, using fallback PDF parser")
            return await DocumentParser._parse_pdf_fallback(content)

        result = {
            "text": "",
            "metadata": {},
            "pages": [],
            "tables": [],
            "images": [],
        }

        try:
            doc = fitz.open(stream=content, filetype="pdf")

            # Extract metadata
            result["metadata"] = {
                "title": doc.metadata.get("title", ""),
                "author": doc.metadata.get("author", ""),
                "subject": doc.metadata.get("subject", ""),
                "keywords": doc.metadata.get("keywords", ""),
                "creator": doc.metadata.get("creator", ""),
                "producer": doc.metadata.get("producer", ""),
                "creation_date": doc.metadata.get("creationDate", ""),
                "modification_date": doc.metadata.get("modDate", ""),
                "page_count": len(doc),
            }

            # Extract text from each page
            full_text = []
            for page_num, page in enumerate(doc):
                page_text = page.get_text()

                # OCR if page has no text but has images
                if not page_text.strip() and ocr_enabled:
                    page_text = await DocumentParser._ocr_page(page, ocr_language)

                result["pages"].append(
                    {
                        "page_num": page_num + 1,
                        "text": page_text,
                    }
                )
                full_text.append(page_text)

                # Extract tables if enabled
                if extract_tables:
                    tables = await DocumentParser._extract_tables_from_page(page)
                    result["tables"].extend(tables)

                # Extract images if enabled
                if extract_images:
                    images = await DocumentParser._extract_images_from_page(page)
                    result["images"].extend(images)

            result["text"] = "\n\n".join(full_text)
            doc.close()

        except Exception as e:
            logger.error("PDF parsing failed", error=str(e))
            result["error"] = str(e)

        return result

    @staticmethod
    async def _parse_pdf_fallback(content: bytes) -> dict[str, Any]:
        """Fallback PDF parser using pdfplumber or basic extraction."""
        try:
            import pdfplumber

            result = {
                "text": "",
                "metadata": {},
                "pages": [],
                "tables": [],
            }

            with pdfplumber.open(io.BytesIO(content)) as pdf:
                result["metadata"]["page_count"] = len(pdf.pages)

                full_text = []
                for page_num, page in enumerate(pdf.pages):
                    text = page.extract_text() or ""
                    result["pages"].append(
                        {
                            "page_num": page_num + 1,
                            "text": text,
                        }
                    )
                    full_text.append(text)

                    # Extract tables
                    tables = page.extract_tables()
                    for table in tables:
                        result["tables"].append(
                            {
                                "page": page_num + 1,
                                "data": table,
                            }
                        )

                result["text"] = "\n\n".join(full_text)

            return result

        except ImportError:
            logger.warning("pdfplumber not installed, returning empty result")
            return {"text": "", "metadata": {}, "pages": [], "error": "No PDF parser available"}

    @staticmethod
    async def _ocr_page(page: Any, language: str) -> str:
        """OCR a PDF page using Tesseract."""
        try:
            import fitz  # PyMuPDF - imported here for standalone use
            import pytesseract
            from PIL import Image

            # Render page to image
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # 2x scale for better OCR
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

            # Run OCR
            text = pytesseract.image_to_string(img, lang=language)
            return text

        except ImportError:
            logger.warning("pytesseract not installed, skipping OCR")
            return ""
        except Exception as e:
            logger.warning("OCR failed", error=str(e))
            return ""

    @staticmethod
    async def _extract_tables_from_page(page: Any) -> list[dict[str, Any]]:
        """Extract tables from a PDF page."""
        tables = []
        try:
            # Use PyMuPDF's table detection
            tabs = page.find_tables()
            for i, tab in enumerate(tabs):
                tables.append(
                    {
                        "page": page.number + 1,
                        "table_num": i + 1,
                        "data": tab.extract(),
                    }
                )
        except Exception as e:
            logger.warning("Table extraction failed", error=str(e))
        return tables

    @staticmethod
    async def _extract_images_from_page(page: Any) -> list[dict[str, Any]]:
        """Extract images from a PDF page."""
        images = []
        try:
            image_list = page.get_images()
            for img_index, img in enumerate(image_list):
                xref = img[0]
                base_image = page.parent.extract_image(xref)
                images.append(
                    {
                        "page": page.number + 1,
                        "image_num": img_index + 1,
                        "width": base_image.get("width"),
                        "height": base_image.get("height"),
                        "format": base_image.get("ext"),
                    }
                )
        except Exception as e:
            logger.warning("Image extraction failed", error=str(e))
        return images

    @staticmethod
    async def parse_docx(content: bytes) -> dict[str, Any]:
        """Parse Word document."""
        try:
            from docx import Document

            result = {
                "text": "",
                "metadata": {},
                "paragraphs": [],
                "tables": [],
            }

            doc = Document(io.BytesIO(content))

            # Extract core properties
            core_props = doc.core_properties
            result["metadata"] = {
                "title": core_props.title or "",
                "author": core_props.author or "",
                "subject": core_props.subject or "",
                "keywords": core_props.keywords or "",
                "created": str(core_props.created) if core_props.created else "",
                "modified": str(core_props.modified) if core_props.modified else "",
            }

            # Extract paragraphs
            full_text = []
            for para in doc.paragraphs:
                if para.text.strip():
                    result["paragraphs"].append(para.text)
                    full_text.append(para.text)

            # Extract tables
            for table_idx, table in enumerate(doc.tables):
                table_data = []
                for row in table.rows:
                    row_data = [cell.text for cell in row.cells]
                    table_data.append(row_data)
                result["tables"].append(
                    {
                        "table_num": table_idx + 1,
                        "data": table_data,
                    }
                )

            result["text"] = "\n\n".join(full_text)
            return result

        except ImportError:
            logger.warning("python-docx not installed")
            return {"text": "", "metadata": {}, "error": "DOCX parser not available"}
        except Exception as e:
            logger.error("DOCX parsing failed", error=str(e))
            return {"text": "", "metadata": {}, "error": str(e)}

    @staticmethod
    async def parse_text(content: bytes, encoding: str = "utf-8") -> dict[str, Any]:
        """Parse plain text or markdown."""
        try:
            text = content.decode(encoding)
            return {
                "text": text,
                "metadata": {
                    "encoding": encoding,
                    "length": len(text),
                },
            }
        except UnicodeDecodeError:
            # Try other encodings
            for enc in ["latin-1", "cp1252", "iso-8859-1"]:
                try:
                    text = content.decode(enc)
                    return {
                        "text": text,
                        "metadata": {"encoding": enc, "length": len(text)},
                    }
                except UnicodeDecodeError:
                    continue

            return {"text": "", "metadata": {}, "error": "Failed to decode text"}

    @staticmethod
    async def parse_html(content: bytes) -> dict[str, Any]:
        """Parse HTML document."""
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(content, "html.parser")

            # Extract title
            title = soup.title.string if soup.title else ""

            # Extract text
            for script in soup(["script", "style"]):
                script.decompose()
            text = soup.get_text(separator="\n", strip=True)

            # Extract metadata
            metadata = {"title": title}
            for meta in soup.find_all("meta"):
                name = meta.get("name", meta.get("property", ""))
                content_attr = meta.get("content", "")
                if name and content_attr:
                    metadata[name] = content_attr

            return {
                "text": text,
                "metadata": metadata,
            }

        except ImportError:
            logger.warning("BeautifulSoup not installed")
            return {"text": content.decode("utf-8", errors="ignore"), "metadata": {}}


class CustomDocumentIngestionAgent(IngestionAgent):
    """
    Agent for ingesting custom documents (PDFs, Word docs, etc.).

    Supports:
    - PDF parsing with OCR
    - Word document parsing
    - Plain text and markdown
    - HTML documents
    - Metadata extraction
    - Table extraction
    - Chunking for large documents
    """

    source_type = SourceType.CUSTOM_DOCUMENT
    description = "Custom document (PDF, DOCX, etc.) ingestion agent"

    def __init__(
        self,
        config: CustomDocumentConfig | None = None,
        **kwargs,
    ):
        config = config or CustomDocumentConfig()
        super().__init__(config=config, **kwargs)
        self.doc_config: CustomDocumentConfig = config
        self._documents: list[dict[str, Any]] = []  # Queue of documents to process

    def add_document(
        self,
        content: bytes | BinaryIO | str | Path,
        filename: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """
        Add a document to the ingestion queue.

        Args:
            content: Document content (bytes, file object, or path)
            filename: Original filename
            metadata: Optional additional metadata

        Returns:
            Document ID
        """
        # Generate document ID
        if isinstance(content, (str, Path)):
            with open(content, "rb") as f:
                doc_bytes = f.read()
        elif isinstance(content, bytes):
            doc_bytes = content
        else:
            doc_bytes = content.read()

        content_hash = hashlib.sha256(doc_bytes).hexdigest()
        doc_id = f"doc_{content_hash[:16]}"

        # Detect MIME type
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = "application/octet-stream"

        # Check file size
        if len(doc_bytes) > self.doc_config.max_file_size:
            raise ValueError(f"File exceeds maximum size of {self.doc_config.max_file_size} bytes")

        # Check supported type
        if mime_type not in self.doc_config.supported_types:
            raise ValueError(f"Unsupported file type: {mime_type}")

        self._documents.append(
            {
                "id": doc_id,
                "content": doc_bytes,
                "filename": filename,
                "mime_type": mime_type,
                "metadata": metadata or {},
                "size": len(doc_bytes),
            }
        )

        return doc_id

    def add_document_from_url(
        self,
        url: str,
        filename: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """
        Add a document URL to fetch and process.

        Args:
            url: URL to fetch document from
            filename: Optional filename override
            metadata: Optional additional metadata
        """
        self._documents.append(
            {
                "url": url,
                "filename": filename or url.split("/")[-1],
                "metadata": metadata or {},
            }
        )

    async def _fetch_url_document(self, doc_info: dict[str, Any]) -> dict[str, Any] | None:
        """Fetch a document from URL."""
        url = doc_info.get("url")
        if not url:
            return None

        await self._rate_limit()

        async with make_httpx_client(timeout=60.0, follow_redirects=True) as session:
            try:
                response = await session.get(url)
                response.raise_for_status()
                content = response.content

                # Get content type
                content_type = response.headers.get("Content-Type", "")
                mime_type = content_type.split(";")[0].strip()

                # Update doc_info
                content_hash = hashlib.sha256(content).hexdigest()
                doc_info["id"] = f"doc_{content_hash[:16]}"
                doc_info["content"] = content
                doc_info["mime_type"] = mime_type
                doc_info["size"] = len(content)

                self.state.metrics.bytes_downloaded += len(content)
                self.state.metrics.api_calls_made += 1

                return doc_info

            except httpx.HTTPError as e:
                self.logger.error("Failed to fetch document", url=url, error=str(e))
                return None

    async def _parse_document(self, doc_info: dict[str, Any]) -> dict[str, Any]:
        """Parse a document based on its MIME type."""
        content = doc_info["content"]
        mime_type = doc_info.get("mime_type", "")

        if "pdf" in mime_type:
            return await DocumentParser.parse_pdf(
                content,
                extract_images=self.doc_config.pdf_extract_images,
                extract_tables=self.doc_config.pdf_extract_tables,
                ocr_enabled=self.doc_config.pdf_ocr_enabled,
                ocr_language=self.doc_config.pdf_ocr_language,
            )
        elif "word" in mime_type or "document" in mime_type:
            return await DocumentParser.parse_docx(content)
        elif "html" in mime_type:
            return await DocumentParser.parse_html(content)
        elif "text" in mime_type or "markdown" in mime_type:
            return await DocumentParser.parse_text(content)
        else:
            # Try text parsing as fallback
            return await DocumentParser.parse_text(content)

    def _chunk_text(self, text: str) -> list[dict[str, Any]]:
        """Split text into chunks for processing."""
        chunks = []
        chunk_size = self.doc_config.chunk_size
        overlap = self.doc_config.chunk_overlap

        if len(text) <= chunk_size:
            return [{"chunk_num": 0, "text": text, "start": 0, "end": len(text)}]

        start = 0
        chunk_num = 0

        while start < len(text):
            end = start + chunk_size

            # Try to break at sentence boundary
            if end < len(text):
                # Look for sentence end within last 20% of chunk
                search_start = end - int(chunk_size * 0.2)
                for marker in [". ", ".\n", "? ", "?\n", "! ", "!\n"]:
                    last_sentence = text.rfind(marker, search_start, end)
                    if last_sentence != -1:
                        end = last_sentence + len(marker)
                        break

            chunk_text = text[start:end]
            chunks.append(
                {
                    "chunk_num": chunk_num,
                    "text": chunk_text,
                    "start": start,
                    "end": end,
                }
            )

            start = end - overlap
            chunk_num += 1

        return chunks

    def _document_to_record(
        self,
        doc_info: dict[str, Any],
        parsed: dict[str, Any],
    ) -> IngestionRecord:
        """Convert parsed document to IngestionRecord."""
        doc_id = doc_info["id"]
        filename = doc_info["filename"]

        # Extract title from metadata or filename
        title = (
            parsed.get("metadata", {}).get("title")
            or doc_info.get("metadata", {}).get("title")
            or Path(filename).stem
        )

        # Extract author
        authors = []
        author = parsed.get("metadata", {}).get("author")
        if author:
            authors = [a.strip() for a in author.split(",")]

        # Extract keywords
        keywords = []
        kw_str = parsed.get("metadata", {}).get("keywords", "")
        if kw_str:
            keywords = [k.strip() for k in kw_str.split(",")]

        # Build URL (if from URL) or use local path
        url = doc_info.get("url")
        if not url and self.doc_config.storage_path:
            url = f"file://{self.doc_config.storage_path}/{filename}"

        return IngestionRecord(
            record_id=doc_id,
            source_type=SourceType.CUSTOM_DOCUMENT,
            source_id=doc_id,
            title=title,
            abstract=parsed.get("text", "")[:1000],  # First 1000 chars as abstract
            full_text=parsed.get("text"),
            authors=authors,
            publication_date=datetime.now(UTC),  # Use upload time
            url=url,
            keywords=keywords,
            metadata={
                "filename": filename,
                "mime_type": doc_info.get("mime_type"),
                "file_size": doc_info.get("size"),
                "page_count": parsed.get("metadata", {}).get("page_count"),
                "tables_count": len(parsed.get("tables", [])),
                "parse_metadata": parsed.get("metadata", {}),
                "custom_metadata": doc_info.get("metadata", {}),
            },
        )

    async def fetch_batch(
        self,
        query: str,
        offset: int = 0,
        limit: int = 100,
        **kwargs,
    ) -> tuple[list[IngestionRecord], str | None]:
        """
        Process queued documents.

        For custom documents, the query parameter is ignored.
        Documents must be added via add_document() before calling this.

        Args:
            query: Ignored for custom documents
            offset: Starting offset in document queue
            limit: Maximum documents to process

        Returns:
            Tuple of (records, next_cursor)
        """
        records = []
        docs_to_process = self._documents[offset : offset + limit]

        for doc_info in docs_to_process:
            try:
                # Fetch from URL if needed
                if "url" in doc_info and "content" not in doc_info:
                    doc_info = await self._fetch_url_document(doc_info)
                    if not doc_info:
                        continue

                # Parse document
                parsed = await self._parse_document(doc_info)

                if parsed.get("error"):
                    self.logger.warning(
                        "Document parsing failed",
                        filename=doc_info.get("filename"),
                        error=parsed["error"],
                    )
                    self.state.metrics.records_failed += 1
                    continue

                # Convert to record
                record = self._document_to_record(doc_info, parsed)
                records.append(record)

                self.state.metrics.records_fetched += 1

            except Exception as e:
                self.logger.error(
                    "Document processing failed",
                    filename=doc_info.get("filename"),
                    error=str(e),
                )
                self.state.metrics.records_failed += 1

        # Clear processed documents
        self._documents = self._documents[offset + limit :]

        # Determine next cursor
        next_cursor = str(offset + len(records)) if self._documents else None

        return records, next_cursor

    async def fetch_by_id(self, source_id: str) -> IngestionRecord | None:
        """
        Fetch a specific document by ID.

        For custom documents, this looks in the queue or storage.

        Args:
            source_id: Document ID

        Returns:
            IngestionRecord or None
        """
        # Look in current queue
        for doc in self._documents:
            if doc.get("id") == source_id:
                parsed = await self._parse_document(doc)
                return self._document_to_record(doc, parsed)

        return None

    def get_supported_types(self) -> list[str]:
        """Get list of supported MIME types."""
        return self.doc_config.supported_types.copy()

    def clear_queue(self) -> int:
        """Clear the document queue and return count of cleared documents."""
        count = len(self._documents)
        self._documents = []
        return count

    async def close(self) -> None:
        """Close resources."""
        self._documents = []
