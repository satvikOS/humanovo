"""
BibTeX / RIS / CSL-JSON / EndNote parsers + serializers.

No external parser libraries — these formats are well-enough defined
that a hand-rolled implementation is more portable and keeps the
dependency tree small. The parsers are permissive: unknown fields
pass through to csl_json so nothing is lost on round-trip.

Supported round-trips:
  BibTeX   (.bib)      ⇄ Citation dict
  RIS      (.ris)      ⇄ Citation dict
  CSL-JSON (.json)     ⇄ Citation dict   (CSL is the native format)
  EndNote  (.enw)      → Citation dict   (EndNote XML-based .xml not supported)
"""
from __future__ import annotations

import re
from typing import Any

# ─── BibTeX field mappings ──────────────────────────────────────
# Mendeley / Zotero canonical set. `entry type → citation.type` is
# a best-effort categorization.
_BIBTEX_TYPE_MAP = {
    "article": "journal",
    "inproceedings": "conference",
    "conference": "conference",
    "book": "book",
    "inbook": "book",
    "incollection": "book",
    "phdthesis": "thesis",
    "mastersthesis": "thesis",
    "misc": "website",
    "online": "website",
    "techreport": "preprint",
    "unpublished": "preprint",
}
_BIBTEX_TYPE_REVERSE = {
    "journal": "article",
    "conference": "inproceedings",
    "book": "book",
    "thesis": "phdthesis",
    "website": "misc",
    "preprint": "techreport",
}


def parse_bibtex(text: str) -> list[dict[str, Any]]:
    """
    Parse one or more BibTeX entries. Permissive: stops on the first
    closing brace at the entry's depth, skips comment blocks, handles
    both `{value}` and `"value"` field delimiters.
    """
    citations: list[dict[str, Any]] = []
    i = 0
    text_len = len(text)
    while i < text_len:
        # Skip whitespace and comments.
        while i < text_len and text[i] in " \n\r\t":
            i += 1
        if i >= text_len or text[i] != "@":
            i += 1
            continue
        # Entry starts.
        i += 1
        type_start = i
        while i < text_len and text[i].isalnum():
            i += 1
        entry_type = text[type_start:i].lower()
        while i < text_len and text[i] in " \n\r\t":
            i += 1
        if i >= text_len or text[i] != "{":
            continue
        i += 1
        # Skip `comment` / `preamble` / `string` specials.
        if entry_type in {"comment", "preamble", "string"}:
            depth = 1
            while i < text_len and depth > 0:
                if text[i] == "{": depth += 1
                elif text[i] == "}": depth -= 1
                i += 1
            continue
        # Cite key.
        key_start = i
        while i < text_len and text[i] != ",":
            i += 1
        cite_key = text[key_start:i].strip()
        if i < text_len: i += 1  # skip ,
        # Field loop.
        fields: dict[str, str] = {}
        while i < text_len and text[i] != "}":
            # Field name.
            while i < text_len and text[i] in " \n\r\t,":
                i += 1
            if i >= text_len or text[i] == "}":
                break
            name_start = i
            while i < text_len and text[i] not in "=, \n\r\t":
                i += 1
            name = text[name_start:i].strip().lower()
            while i < text_len and text[i] in " \n\r\t":
                i += 1
            if i >= text_len or text[i] != "=":
                continue
            i += 1
            while i < text_len and text[i] in " \n\r\t":
                i += 1
            # Field value — braces or quotes or bareword.
            value = ""
            if i < text_len and text[i] == "{":
                depth = 1
                i += 1
                val_start = i
                while i < text_len and depth > 0:
                    if text[i] == "{": depth += 1
                    elif text[i] == "}":
                        depth -= 1
                        if depth == 0: break
                    i += 1
                value = text[val_start:i]
                i += 1  # skip closing }
            elif i < text_len and text[i] == '"':
                i += 1
                val_start = i
                while i < text_len and text[i] != '"':
                    i += 1
                value = text[val_start:i]
                if i < text_len: i += 1  # skip "
            else:
                val_start = i
                while i < text_len and text[i] not in ",}":
                    i += 1
                value = text[val_start:i].strip()
            fields[name] = _debrace(value)
        if i < text_len and text[i] == "}":
            i += 1
        citations.append(_bibtex_fields_to_citation(entry_type, cite_key, fields))
    return citations


def _debrace(s: str) -> str:
    # BibTeX often wraps sensitive case with {Braces} — flatten.
    return re.sub(r"[{}]", "", s).strip()


def _bibtex_fields_to_citation(entry_type: str, cite_key: str, fields: dict[str, str]) -> dict[str, Any]:
    cite: dict[str, Any] = {
        "type": _BIBTEX_TYPE_MAP.get(entry_type, "journal"),
        "cite_key": cite_key or None,
        "tags": [],
        "starred": False,
    }
    if "title" in fields:
        cite["title"] = fields["title"]
    if "author" in fields:
        cite["authors"] = _split_authors(fields["author"])
    elif "editor" in fields:
        cite["authors"] = _split_authors(fields["editor"])
    else:
        cite["authors"] = []
    for src, dst in (
        ("year", "year"),
        ("journal", "journal"),
        ("volume", "volume"),
        ("number", "issue"),
        ("issue", "issue"),
        ("pages", "pages"),
        ("publisher", "publisher"),
        ("doi", "doi"),
        ("url", "url"),
        ("pmid", "pmid"),
        ("pmcid", "pmcid"),
        ("abstract", "abstract"),
        ("note", "notes"),
        ("isbn", "isbn"),
    ):
        if src in fields and fields[src]:
            v = fields[src]
            if dst == "year":
                try:
                    cite[dst] = int(re.search(r"\d{4}", v).group(0)) if re.search(r"\d{4}", v) else None
                except Exception:
                    cite[dst] = None
            else:
                cite[dst] = v
    # keywords → tags.
    if "keywords" in fields and fields["keywords"]:
        cite["tags"] = [t.strip() for t in re.split(r"[,;]", fields["keywords"]) if t.strip()]
    cite["csl_json"] = {"type": cite["type"], **{k: v for k, v in fields.items()}, "id": cite_key}
    return cite


def _split_authors(s: str) -> list[str]:
    # BibTeX separates authors with " and "; convert "Last, First" → "First Last".
    raw = [a.strip() for a in re.split(r"\s+and\s+", s) if a.strip()]
    out: list[str] = []
    for a in raw:
        if "," in a:
            parts = [p.strip() for p in a.split(",", 1)]
            if len(parts) == 2 and parts[1]:
                out.append(f"{parts[1]} {parts[0]}")
                continue
        out.append(a)
    return out


def serialize_bibtex(citations: list[dict[str, Any]]) -> str:
    """Emit a BibTeX file containing all provided citation dicts."""
    parts: list[str] = []
    for c in citations:
        btype = _BIBTEX_TYPE_REVERSE.get(c.get("type", "journal"), "article")
        key = c.get("cite_key") or _fallback_cite_key(c)
        lines = [f"@{btype}{{{key},"]
        lines.append(_bib_field("title", c.get("title", "")))
        if c.get("authors"):
            lines.append(_bib_field("author", " and ".join(c["authors"])))
        for src, dst in (("year", "year"), ("journal", "journal"), ("volume", "volume"),
                         ("issue", "number"), ("pages", "pages"), ("publisher", "publisher"),
                         ("doi", "doi"), ("url", "url"), ("pmid", "pmid"), ("pmcid", "pmcid"),
                         ("abstract", "abstract"), ("notes", "note"), ("isbn", "isbn")):
            v = c.get(src)
            if v not in (None, ""):
                lines.append(_bib_field(dst, str(v)))
        if c.get("tags"):
            lines.append(_bib_field("keywords", ", ".join(c["tags"])))
        lines.append("}")
        parts.append("\n".join(lines))
    return "\n\n".join(parts)


def _bib_field(key: str, value: str) -> str:
    # Escape stray braces in the value.
    v = value.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
    return f"  {key} = {{{v}}},"


def _fallback_cite_key(c: dict[str, Any]) -> str:
    surname = ""
    if c.get("authors"):
        surname = c["authors"][0].split()[-1].lower()
    year = str(c.get("year") or "")
    first_word = ""
    if c.get("title"):
        for tok in c["title"].split():
            if tok.isalpha() and len(tok) > 3:
                first_word = tok.lower()
                break
    stem = surname + year + first_word
    return re.sub(r"[^a-z0-9]", "", stem) or "ref"


# ─── RIS ─────────────────────────────────────────────────────────
# Tagged-field format: "TY  - JOUR\nAU  - Smith\nER  -".


_RIS_TYPE_MAP = {
    "JOUR": "journal",
    "CONF": "conference",
    "BOOK": "book",
    "CHAP": "book",
    "THES": "thesis",
    "RPRT": "preprint",
    "UNPD": "preprint",
    "ELEC": "website",
    "GEN":  "journal",
}
_RIS_TYPE_REVERSE = {v: k for k, v in _RIS_TYPE_MAP.items() if k != "CHAP"}


def parse_ris(text: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    current: dict[str, list[str]] = {}
    for raw_line in text.splitlines():
        # Match "XX  - value" (two chars, two spaces, dash, space).
        if re.match(r"^[A-Z][A-Z0-9]\s\s-", raw_line):
            tag = raw_line[:2]
            value = raw_line[6:].strip()
            if tag == "ER":
                if current:
                    entries.append(_ris_fields_to_citation(current))
                current = {}
            else:
                current.setdefault(tag, []).append(value)
    if current:
        entries.append(_ris_fields_to_citation(current))
    return entries


def _ris_fields_to_citation(fields: dict[str, list[str]]) -> dict[str, Any]:
    get = lambda k: fields.get(k, [""])[0]
    all_ = lambda k: fields.get(k, [])
    cite: dict[str, Any] = {
        "type": _RIS_TYPE_MAP.get(get("TY"), "journal"),
        "title": get("TI") or get("T1") or get("T2"),
        "authors": all_("AU") or all_("A1") or all_("A2"),
        "journal": get("JO") or get("JF") or get("J2"),
        "volume": get("VL"),
        "issue": get("IS"),
        "pages": f"{get('SP')}-{get('EP')}" if get("SP") else "",
        "publisher": get("PB"),
        "doi": get("DO") or get("DI"),
        "url": get("UR") or get("L3"),
        "pmid": get("AN") if (get("AN") or "").isdigit() else "",
        "abstract": get("AB") or get("N2"),
        "notes": get("N1"),
        "isbn": get("SN"),
        "tags": all_("KW") or [],
        "starred": False,
    }
    y = get("PY") or get("Y1") or get("DA")
    if y:
        m = re.search(r"\d{4}", y)
        if m:
            cite["year"] = int(m.group(0))
    cite["csl_json"] = {"type": cite["type"], "_ris": fields}
    return {k: v for k, v in cite.items() if v not in (None, "")}


def serialize_ris(citations: list[dict[str, Any]]) -> str:
    out_lines: list[str] = []
    for c in citations:
        ty = _RIS_TYPE_REVERSE.get(c.get("type", "journal"), "JOUR")
        out_lines.append(f"TY  - {ty}")
        for a in c.get("authors", []) or []:
            out_lines.append(f"AU  - {a}")
        if c.get("title"):
            out_lines.append(f"TI  - {c['title']}")
        if c.get("journal"):
            out_lines.append(f"JO  - {c['journal']}")
        if c.get("year"):
            out_lines.append(f"PY  - {c['year']}")
        if c.get("volume"):
            out_lines.append(f"VL  - {c['volume']}")
        if c.get("issue"):
            out_lines.append(f"IS  - {c['issue']}")
        if c.get("pages"):
            parts = str(c["pages"]).split("-", 1)
            out_lines.append(f"SP  - {parts[0].strip()}")
            if len(parts) == 2:
                out_lines.append(f"EP  - {parts[1].strip()}")
        if c.get("doi"):
            out_lines.append(f"DO  - {c['doi']}")
        if c.get("url"):
            out_lines.append(f"UR  - {c['url']}")
        if c.get("abstract"):
            out_lines.append(f"AB  - {c['abstract']}")
        if c.get("publisher"):
            out_lines.append(f"PB  - {c['publisher']}")
        if c.get("isbn"):
            out_lines.append(f"SN  - {c['isbn']}")
        for t in c.get("tags", []) or []:
            out_lines.append(f"KW  - {t}")
        out_lines.append("ER  - ")
        out_lines.append("")
    return "\n".join(out_lines)


# ─── CSL-JSON ────────────────────────────────────────────────────


def parse_csl_json(payload: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert CSL-JSON (the Zotero/Citeproc native format) → citations."""
    out: list[dict[str, Any]] = []
    for item in payload:
        csl_type = item.get("type", "article-journal")
        year = None
        issued = item.get("issued") or {}
        date_parts = issued.get("date-parts") if isinstance(issued, dict) else None
        if date_parts and date_parts[0]:
            try:
                year = int(date_parts[0][0])
            except Exception:
                year = None
        # Authors as list of "Given Family".
        authors = []
        for a in item.get("author", []) or []:
            given = a.get("given", "")
            family = a.get("family", "")
            literal = a.get("literal")
            if literal:
                authors.append(literal)
            elif given or family:
                authors.append(f"{given} {family}".strip())
        cite: dict[str, Any] = {
            "type": _CSL_TYPE_MAP.get(csl_type, "journal"),
            "title": item.get("title", ""),
            "authors": authors,
            "year": year,
            "journal": item.get("container-title", ""),
            "volume": item.get("volume"),
            "issue": item.get("issue"),
            "pages": item.get("page"),
            "publisher": item.get("publisher"),
            "doi": item.get("DOI"),
            "pmid": item.get("PMID"),
            "pmcid": item.get("PMCID"),
            "url": item.get("URL"),
            "abstract": item.get("abstract", ""),
            "isbn": item.get("ISBN"),
            "cite_key": item.get("id"),
            "tags": item.get("keyword", "").split(",") if item.get("keyword") else [],
            "starred": False,
            "csl_json": item,
        }
        out.append({k: v for k, v in cite.items() if v not in (None, "")})
    return out


_CSL_TYPE_MAP = {
    "article-journal": "journal",
    "paper-conference": "conference",
    "book": "book",
    "chapter": "book",
    "thesis": "thesis",
    "article": "preprint",
    "webpage": "website",
}
_CSL_TYPE_REVERSE = {v: k for k, v in _CSL_TYPE_MAP.items() if k != "chapter" and k != "article"}


def serialize_csl_json(citations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for c in citations:
        item: dict[str, Any] = {
            "id": c.get("cite_key") or _fallback_cite_key(c),
            "type": _CSL_TYPE_REVERSE.get(c.get("type", "journal"), "article-journal"),
            "title": c.get("title"),
            "container-title": c.get("journal"),
            "volume": c.get("volume"),
            "issue": c.get("issue"),
            "page": c.get("pages"),
            "publisher": c.get("publisher"),
            "DOI": c.get("doi"),
            "PMID": c.get("pmid"),
            "PMCID": c.get("pmcid"),
            "URL": c.get("url"),
            "ISBN": c.get("isbn"),
            "abstract": c.get("abstract"),
        }
        if c.get("authors"):
            item["author"] = [_split_name(n) for n in c["authors"]]
        if c.get("year"):
            item["issued"] = {"date-parts": [[int(c["year"])]]}
        if c.get("tags"):
            item["keyword"] = ", ".join(c["tags"])
        items.append({k: v for k, v in item.items() if v not in (None, "")})
    return items


def _split_name(n: str) -> dict[str, str]:
    parts = n.strip().split()
    if len(parts) == 1:
        return {"literal": parts[0]}
    return {"given": " ".join(parts[:-1]), "family": parts[-1]}


# ─── EndNote (.enw) ──────────────────────────────────────────────
# Tagged like RIS but with `%A`, `%T`, `%J`, `%D`, `%V`, `%N`, `%P`,
# `%R` (DOI), `%U` (URL), `%X` (abstract). Read-only here.


def parse_endnote(text: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    current: dict[str, list[str]] = {}
    for raw in text.splitlines():
        if raw.startswith("%") and len(raw) >= 2:
            tag = raw[1]
            value = raw[2:].strip()
            current.setdefault(tag, []).append(value)
        elif raw.strip() == "" and current:
            entries.append(_endnote_to_citation(current))
            current = {}
    if current:
        entries.append(_endnote_to_citation(current))
    return entries


def _endnote_to_citation(fields: dict[str, list[str]]) -> dict[str, Any]:
    def g(k: str) -> str: return (fields.get(k, [""]) or [""])[0]
    def a(k: str) -> list[str]: return fields.get(k, [])
    cite = {
        "type": "journal",
        "title": g("T"),
        "authors": a("A"),
        "journal": g("J"),
        "volume": g("V"),
        "issue": g("N"),
        "pages": g("P"),
        "doi": g("R"),
        "url": g("U"),
        "abstract": g("X"),
        "tags": a("K"),
        "starred": False,
    }
    year = g("D")
    if year:
        m = re.search(r"\d{4}", year)
        if m: cite["year"] = int(m.group(0))
    cite["csl_json"] = {"_endnote": fields}
    return {k: v for k, v in cite.items() if v not in (None, "")}
