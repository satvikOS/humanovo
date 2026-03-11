"""
Parsers for biomedical data formats: OBO, OWL/XML, TSV/CSV, MeSH ASCII.

Each parser yields standardized records suitable for DynamoDB storage
and embedding generation.
"""

import csv
import gzip
import io
import re
from dataclasses import dataclass, field
from typing import Any, Iterator
from xml.etree import ElementTree as ET


@dataclass
class ParsedRecord:
    """Standardized record from any parser."""

    id: str
    name: str
    source_dataset: str
    record_type: str  # term, gene, drug, variant, interaction, pathway
    definition: str = ""
    synonyms: list[str] = field(default_factory=list)
    parents: list[str] = field(default_factory=list)
    children: list[str] = field(default_factory=list)
    relations: list[dict[str, str]] = field(default_factory=list)
    external_ids: dict[str, str] = field(default_factory=dict)
    properties: dict[str, Any] = field(default_factory=dict)
    namespace: str = ""

    def to_text(self) -> str:
        """Generate text representation for embedding and evidence display."""
        parts = [self.name]
        if self.definition:
            parts.append(self.definition)
        if self.synonyms:
            parts.append("Also known as: " + ", ".join(self.synonyms[:10]))
        if self.namespace:
            parts.append(f"Category: {self.namespace}")
        # Include properties for tabular records (e.g., gene-disease associations)
        for key, val in list(self.properties.items())[:5]:
            if val and str(val).strip():
                parts.append(f"{key}: {val}")
        return ". ".join(parts)

    def to_dynamo_item(self) -> dict[str, Any]:
        """Convert to DynamoDB-compatible item."""
        item = {
            "id": self.id,
            "name": self.name,
            "source": self.source_dataset,
            "record_type": self.record_type,
            "content": self.to_text(),
            "embedding_status": "pending",
        }
        if self.definition:
            item["definition"] = self.definition
        if self.synonyms:
            item["synonyms"] = self.synonyms
        if self.parents:
            item["parents"] = self.parents
        if self.external_ids:
            item["external_ids"] = self.external_ids
        if self.namespace:
            item["namespace"] = self.namespace
        if self.relations:
            item["relations"] = self.relations
        if self.properties:
            item["properties"] = {
                k: str(v) for k, v in self.properties.items()
            }
        return item


class OBOParser:
    """
    Parser for OBO format files (Gene Ontology, HPO, Disease Ontology, ChEBI).

    OBO is a simple line-based format where terms are separated by [Term] blocks.
    """

    def __init__(self, source_dataset: str, record_type: str = "term"):
        self.source_dataset = source_dataset
        self.record_type = record_type

    def parse(self, content: str | bytes) -> Iterator[ParsedRecord]:
        """Parse OBO format content and yield records."""
        if isinstance(content, bytes):
            content = content.decode("utf-8", errors="replace")

        current_term: dict[str, Any] = {}
        in_term = False

        for line in content.splitlines():
            line = line.strip()

            if line == "[Term]":
                if in_term and current_term.get("id"):
                    record = self._build_record(current_term)
                    if record:
                        yield record
                current_term = {
                    "synonyms": [],
                    "parents": [],
                    "xrefs": {},
                    "relations": [],
                }
                in_term = True
                continue

            if line.startswith("[") and line.endswith("]"):
                # Another stanza type (Typedef, etc.) — flush current term
                if in_term and current_term.get("id"):
                    record = self._build_record(current_term)
                    if record:
                        yield record
                in_term = False
                current_term = {}
                continue

            if not in_term or not line or line.startswith("!"):
                continue

            # Parse key: value
            if ": " in line:
                key, value = line.split(": ", 1)
                # Remove trailing comments
                if " ! " in value:
                    value = value.split(" ! ")[0].strip()

                if key == "id":
                    current_term["id"] = value
                elif key == "name":
                    current_term["name"] = value
                elif key == "def":
                    # def: "definition text" [source]
                    match = re.match(r'"(.+?)"', value)
                    if match:
                        current_term["definition"] = match.group(1)
                elif key == "synonym":
                    match = re.match(r'"(.+?)"', value)
                    if match:
                        current_term["synonyms"].append(match.group(1))
                elif key == "is_a":
                    current_term["parents"].append(value.strip())
                elif key == "namespace":
                    current_term["namespace"] = value
                elif key == "xref":
                    if ":" in value:
                        xref_db, xref_id = value.split(":", 1)
                        current_term["xrefs"][xref_db.strip()] = xref_id.strip()
                elif key == "relationship":
                    parts = value.split()
                    if len(parts) >= 2:
                        current_term["relations"].append({
                            "type": parts[0],
                            "target": parts[1],
                        })
                elif key == "is_obsolete" and value == "true":
                    current_term["obsolete"] = True

        # Flush last term
        if in_term and current_term.get("id"):
            record = self._build_record(current_term)
            if record:
                yield record

    def _build_record(self, term: dict) -> ParsedRecord | None:
        """Build a ParsedRecord from parsed term data."""
        if term.get("obsolete"):
            return None
        if not term.get("name"):
            return None

        return ParsedRecord(
            id=f"{self.source_dataset}:{term['id']}",
            name=term["name"],
            source_dataset=self.source_dataset,
            record_type=self.record_type,
            definition=term.get("definition", ""),
            synonyms=term.get("synonyms", []),
            parents=term.get("parents", []),
            relations=term.get("relations", []),
            external_ids=term.get("xrefs", {}),
            namespace=term.get("namespace", ""),
        )


class MeSHParser:
    """
    Parser for MeSH ASCII format (d20XX.bin files).

    MeSH uses a custom record format with *NEWRECORD delimiters.
    """

    def __init__(self):
        self.source_dataset = "mesh"
        self.record_type = "descriptor"

    def parse(self, content: str | bytes) -> Iterator[ParsedRecord]:
        """Parse MeSH ASCII format."""
        if isinstance(content, bytes):
            content = content.decode("utf-8", errors="replace")

        current: dict[str, Any] = {"synonyms": [], "parents": []}

        for line in content.splitlines():
            line = line.strip()

            if line == "*NEWRECORD":
                if current.get("id") and current.get("name"):
                    yield self._build_record(current)
                current = {"synonyms": [], "parents": []}
                continue

            if " = " not in line:
                continue

            key, value = line.split(" = ", 1)
            key = key.strip()
            value = value.strip()

            if key == "UI":
                current["id"] = value
            elif key == "MH":
                current["name"] = value
            elif key == "MS":
                current["definition"] = value
            elif key == "ENTRY" or key == "PRINT ENTRY":
                # Extract synonym (before the | delimiter if present)
                syn = value.split("|")[0].strip()
                if syn:
                    current["synonyms"].append(syn)
            elif key == "MN":
                # Tree number — indicates hierarchy
                current["parents"].append(value)
            elif key == "ST":
                current["semantic_type"] = value

        # Flush last
        if current.get("id") and current.get("name"):
            yield self._build_record(current)

    def _build_record(self, term: dict) -> ParsedRecord:
        return ParsedRecord(
            id=f"mesh:{term['id']}",
            name=term["name"],
            source_dataset="mesh",
            record_type="descriptor",
            definition=term.get("definition", ""),
            synonyms=term.get("synonyms", []),
            parents=term.get("parents", []),
            properties={"semantic_type": term.get("semantic_type", "")},
        )


class TSVParser:
    """
    Parser for TSV/CSV tabular data files (DisGeNET, ClinVar, HGNC, STRING, etc.).
    """

    def __init__(
        self,
        source_dataset: str,
        record_type: str,
        id_column: str = "",
        name_column: str = "",
        description_column: str = "",
        relation_columns: list[str] | None = None,
        chunk_fields: list[str] | None = None,
        delimiter: str = "\t",
        skip_header: bool = True,
        max_records: int = 0,  # 0 = unlimited
    ):
        self.source_dataset = source_dataset
        self.record_type = record_type
        self.id_column = id_column
        self.name_column = name_column
        self.description_column = description_column
        self.relation_columns = relation_columns or []
        self.chunk_fields = chunk_fields or []
        self.delimiter = delimiter
        self.skip_header = skip_header
        self.max_records = max_records

    def parse(self, content: str | bytes) -> Iterator[ParsedRecord]:
        """Parse TSV/CSV content and yield records."""
        if isinstance(content, bytes):
            content = content.decode("utf-8", errors="replace")

        reader = csv.DictReader(
            io.StringIO(content),
            delimiter=self.delimiter,
        )

        count = 0
        for row in reader:
            if self.max_records and count >= self.max_records:
                break

            record = self._build_record(row, count)
            if record:
                yield record
                count += 1

    def parse_no_header(self, content: str | bytes) -> Iterator[ParsedRecord]:
        """Parse TSV without headers (positional columns)."""
        if isinstance(content, bytes):
            content = content.decode("utf-8", errors="replace")

        count = 0
        for line in content.splitlines():
            if self.max_records and count >= self.max_records:
                break
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            cols = line.split(self.delimiter)
            row = {str(i): v for i, v in enumerate(cols)}

            record = self._build_record(row, count)
            if record:
                yield record
                count += 1

    def _build_record(self, row: dict[str, str], index: int) -> ParsedRecord | None:
        """Build a ParsedRecord from a row."""
        record_id = row.get(self.id_column, str(index)) if self.id_column else str(index)
        name = row.get(self.name_column, "") if self.name_column else ""

        if not name and not record_id:
            return None

        definition = row.get(self.description_column, "") if self.description_column else ""

        # Build relations from configured columns
        relations = []
        if len(self.relation_columns) >= 2:
            relation_data = {col: row.get(col, "") for col in self.relation_columns}
            relations.append(relation_data)

        # Build text from chunk fields
        properties = {}
        for cf in self.chunk_fields:
            val = row.get(cf, "")
            if val:
                properties[cf] = val

        return ParsedRecord(
            id=f"{self.source_dataset}:{record_id}",
            name=name or record_id,
            source_dataset=self.source_dataset,
            record_type=self.record_type,
            definition=definition,
            relations=relations,
            properties=properties,
        )


class OWLParser:
    """
    Parser for OWL/XML format ontologies.

    Handles RDF/XML serialized OWL files. For most biomedical ontologies,
    OBO format is preferred — this parser is for datasets only available as OWL.
    """

    OWL_NS = "http://www.w3.org/2002/07/owl#"
    RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#"
    OBO_NS = "http://purl.obolibrary.org/obo/"
    SKOS_NS = "http://www.w3.org/2004/02/skos/core#"

    def __init__(self, source_dataset: str, record_type: str = "term"):
        self.source_dataset = source_dataset
        self.record_type = record_type

    def parse(self, content: str | bytes) -> Iterator[ParsedRecord]:
        """Parse OWL/XML content and yield records."""
        if isinstance(content, str):
            content = content.encode("utf-8")

        try:
            tree = ET.parse(io.BytesIO(content))
        except ET.ParseError:
            return

        root = tree.getroot()

        # Find all owl:Class elements
        for cls in root.iter(f"{{{self.OWL_NS}}}Class"):
            record = self._parse_class(cls)
            if record:
                yield record

    def _parse_class(self, cls_element: ET.Element) -> ParsedRecord | None:
        """Parse a single owl:Class element."""
        # Get class IRI
        about = cls_element.get(f"{{{self.RDF_NS}}}about", "")
        if not about:
            return None

        # Extract local ID
        class_id = about.rsplit("/", 1)[-1] if "/" in about else about
        class_id = class_id.rsplit("#", 1)[-1] if "#" in class_id else class_id

        # Get label
        label = ""
        label_el = cls_element.find(f"{{{self.RDFS_NS}}}label")
        if label_el is not None and label_el.text:
            label = label_el.text

        if not label:
            return None

        # Get definition
        definition = ""
        for def_tag in [
            f"{{{self.OBO_NS}}}IAO_0000115",  # OBO definition
            f"{{{self.SKOS_NS}}}definition",
            f"{{{self.RDFS_NS}}}comment",
        ]:
            def_el = cls_element.find(def_tag)
            if def_el is not None and def_el.text:
                definition = def_el.text
                break

        # Get synonyms
        synonyms = []
        for syn_tag in [
            f"{{{self.OBO_NS}}}hasExactSynonym",
            f"{{{self.OBO_NS}}}hasRelatedSynonym",
            f"{{{self.SKOS_NS}}}altLabel",
        ]:
            for syn_el in cls_element.findall(syn_tag):
                if syn_el.text:
                    synonyms.append(syn_el.text)

        # Get parent classes
        parents = []
        for parent_el in cls_element.findall(f"{{{self.RDFS_NS}}}subClassOf"):
            parent_ref = parent_el.get(f"{{{self.RDF_NS}}}resource", "")
            if parent_ref:
                parent_id = parent_ref.rsplit("/", 1)[-1]
                parents.append(parent_id)

        return ParsedRecord(
            id=f"{self.source_dataset}:{class_id}",
            name=label,
            source_dataset=self.source_dataset,
            record_type=self.record_type,
            definition=definition,
            synonyms=synonyms,
            parents=parents,
        )


class XMLParser:
    """Generic XML parser for structured biomedical data."""

    def __init__(
        self,
        source_dataset: str,
        record_type: str,
        record_tag: str,
        id_xpath: str,
        name_xpath: str,
        definition_xpath: str = "",
    ):
        self.source_dataset = source_dataset
        self.record_type = record_type
        self.record_tag = record_tag
        self.id_xpath = id_xpath
        self.name_xpath = name_xpath
        self.definition_xpath = definition_xpath

    def parse(self, content: str | bytes) -> Iterator[ParsedRecord]:
        """Parse XML content iteratively."""
        if isinstance(content, str):
            content = content.encode("utf-8")

        try:
            for event, elem in ET.iterparse(io.BytesIO(content), events=("end",)):
                if not elem.tag.endswith(self.record_tag):
                    continue

                record_id = self._get_text(elem, self.id_xpath)
                name = self._get_text(elem, self.name_xpath)

                if not record_id or not name:
                    elem.clear()
                    continue

                definition = ""
                if self.definition_xpath:
                    definition = self._get_text(elem, self.definition_xpath)

                yield ParsedRecord(
                    id=f"{self.source_dataset}:{record_id}",
                    name=name,
                    source_dataset=self.source_dataset,
                    record_type=self.record_type,
                    definition=definition,
                )

                elem.clear()
        except ET.ParseError:
            return

    def _get_text(self, elem: ET.Element, xpath: str) -> str:
        """Get text content from an xpath."""
        found = elem.find(xpath)
        if found is not None and found.text:
            return found.text.strip()
        # Try as attribute
        if xpath.startswith("@"):
            return elem.get(xpath[1:], "")
        return ""


def decompress_gz(data: bytes) -> bytes:
    """Decompress gzipped data."""
    return gzip.decompress(data)
