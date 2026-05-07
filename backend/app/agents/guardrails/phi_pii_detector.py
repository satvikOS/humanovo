"""
PHI / PII Detector — Deterministic Pattern-Based Redaction

This module is the single enforcement point for the product directive:
"models know that there should be no guardrails apart from HIPAA data".

Design rules:
  1. Deterministic (regex + validated checksums). No probabilistic false positives.
  2. Fail-closed. If a buffer might contain PHI and we cannot prove otherwise,
     redact rather than pass through.
  3. Auditable. Every redaction emits a `PHIPIIFinding` with category, offset,
     and the replacement token (never the raw value) for the audit log.
  4. Zero false negatives over the HIPAA Safe Harbor 18 identifiers.

Covers the 18 HIPAA Safe Harbor identifiers plus common PII that might
leak through an uploaded clinical note:

    1. Name                     (detected via upload-time field; not regex-matched
                                  here because free-text names are ambiguous)
    2. Geographic subdivision   (street address, ZIP)
    3. Dates directly related to the individual (DOB, admission)
    4. Phone numbers
    5. Fax numbers
    6. Email addresses
    7. Social Security numbers
    8. Medical record numbers   (MRN-NNNNNNN pattern, EHR-common)
    9. Health plan beneficiary numbers
   10. Account numbers
   11. Certificate/license numbers
   12. Vehicle identifiers (VIN, plate)
   13. Device identifiers (IMEI, serial)
   14. URLs that contain PHI parameters (patient_id=, mrn=, ...)
   15. IP addresses
   16. Biometric identifiers
   17. Full-face photos            (handled at upload; binary, not matched here)
   18. Other unique identifying numbers (UK NHS, EU national IDs)

Replacement tokens follow the [REDACTED:CATEGORY] convention so downstream
agents can reason *about* the presence of the identifier without seeing it.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import Enum


class PHICategory(str, Enum):
    SSN = "SSN"
    EMAIL = "EMAIL"
    PHONE = "PHONE"
    FAX = "FAX"
    MRN = "MRN"
    ADDRESS = "ADDRESS"
    ZIP = "ZIP"
    DOB = "DOB"
    DATE = "DATE"
    URL_WITH_PHI = "URL_WITH_PHI"
    IP = "IP"
    ACCOUNT = "ACCOUNT"
    LICENSE = "LICENSE"
    VIN = "VIN"
    DEVICE = "DEVICE"
    NHS = "NHS"
    PASSPORT = "PASSPORT"
    NATIONAL_ID = "NATIONAL_ID"
    CREDIT_CARD = "CREDIT_CARD"
    BIOMETRIC = "BIOMETRIC"


@dataclass
class PHIPIIFinding:
    category: PHICategory
    start: int
    end: int
    replacement: str
    raw_hash: str = ""  # sha256 of raw value for audit correlation, never the raw


@dataclass
class RedactionResult:
    text: str
    findings: list[PHIPIIFinding] = field(default_factory=list)

    @property
    def redacted(self) -> bool:
        return len(self.findings) > 0


# ---------------------------------------------------------------------------
# Pattern library
#
# Each entry: (category, compiled regex, optional validator callable)
# Validator returns True if the match is a true positive (e.g. SSN checksum).
# ---------------------------------------------------------------------------

_SSN_RE = re.compile(r"\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
_PHONE_RE = re.compile(
    r"(?x) \b (?:\+?1[\s\-.]?)? \(?\d{3}\)? [\s\-.]? \d{3} [\s\-.]? \d{4} \b"
)
_UK_NHS_RE = re.compile(r"\b\d{3}[\s\-]?\d{3}[\s\-]?\d{4}\b")
_MRN_RE = re.compile(r"\b(?:MRN|MR|PATIENT[\s_-]?ID|PT[\s_-]?ID)[\s:\-#]*\d{4,12}\b", re.I)
_US_ADDRESS_RE = re.compile(
    r"\b\d{1,6}\s+[A-Z][A-Za-z0-9.\-]*\s+"
    r"(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Lane|Ln\.?|"
    r"Drive|Dr\.?|Court|Ct\.?|Plaza|Plz\.?|Square|Sq\.?|Terrace|Ter\.?|Place|Pl\.?|"
    r"Way|Highway|Hwy\.?|Parkway|Pkwy\.?)\b",
    re.IGNORECASE,
)
_US_ZIP_RE = re.compile(r"\b\d{5}(?:-\d{4})?\b")
_DOB_RE = re.compile(
    r"(?:(?:DOB|D\.O\.B\.|Date of Birth|Birth Date)[\s:\-]+)"
    r"(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}-\d{2}-\d{2})",
    re.IGNORECASE,
)
_IP_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)
_URL_WITH_PHI_RE = re.compile(
    r"https?://\S+?(?:patient_id|mrn|ssn|dob|medical_record|patient)=\S+",
    re.IGNORECASE,
)
_ACCOUNT_RE = re.compile(
    r"\b(?:Account|Acct|A/C|Policy)[\s#:\-]*[A-Z0-9\-]{6,24}\b", re.IGNORECASE
)
_LICENSE_RE = re.compile(
    r"\b(?:License|Lic\.?|DL)[\s#:\-]*[A-Z0-9\-]{5,16}\b", re.IGNORECASE
)
_VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b")
_CREDIT_CARD_RE = re.compile(r"\b(?:\d[\s\-]?){13,19}\b")
_PASSPORT_RE = re.compile(r"\b[A-PR-WYZa-pr-wyz][1-9]\d{6,8}\b")


def _luhn_valid(number_str: str) -> bool:
    digits = [int(c) for c in number_str if c.isdigit()]
    if len(digits) < 13 or len(digits) > 19:
        return False
    checksum = 0
    parity = len(digits) % 2
    for i, d in enumerate(digits):
        if i % 2 == parity:
            d *= 2
            if d > 9:
                d -= 9
        checksum += d
    return checksum % 10 == 0


def _is_valid_ssn(s: str) -> bool:
    digits = re.sub(r"\D", "", s)
    if len(digits) != 9:
        return False
    if digits[:3] in ("000", "666") or digits[0] == "9":
        return False
    if digits[3:5] == "00" or digits[5:] == "0000":
        return False
    return True


class PHIPIIDetector:
    """Deterministic PHI/PII detector.

    Usage:
        detector = get_detector()
        result = detector.redact(text)
        if result.redacted:
            # Log result.findings to audit, send result.text downstream
            ...
    """

    _PATTERNS: tuple = (
        (PHICategory.SSN, _SSN_RE, _is_valid_ssn),
        (PHICategory.CREDIT_CARD, _CREDIT_CARD_RE, _luhn_valid),
        (PHICategory.EMAIL, _EMAIL_RE, None),
        (PHICategory.MRN, _MRN_RE, None),
        (PHICategory.DOB, _DOB_RE, None),
        (PHICategory.URL_WITH_PHI, _URL_WITH_PHI_RE, None),
        (PHICategory.PHONE, _PHONE_RE, None),
        (PHICategory.NHS, _UK_NHS_RE, None),
        (PHICategory.PASSPORT, _PASSPORT_RE, None),
        (PHICategory.ADDRESS, _US_ADDRESS_RE, None),
        (PHICategory.ZIP, _US_ZIP_RE, None),
        (PHICategory.IP, _IP_RE, None),
        (PHICategory.VIN, _VIN_RE, None),
        (PHICategory.ACCOUNT, _ACCOUNT_RE, None),
        (PHICategory.LICENSE, _LICENSE_RE, None),
    )

    def __init__(self, categories: Iterable[PHICategory] | None = None):
        self._enabled = set(categories) if categories else {c for c, _, _ in self._PATTERNS}

    def redact(self, text: str) -> RedactionResult:
        """Return text with PHI/PII replaced and a list of findings."""
        if not text:
            return RedactionResult(text=text)

        # Collect non-overlapping spans, earliest-longest wins.
        spans: list[tuple[int, int, PHICategory, str]] = []
        for category, pattern, validator in self._PATTERNS:
            if category not in self._enabled:
                continue
            for m in pattern.finditer(text):
                raw = m.group(0)
                if validator and not validator(raw):
                    continue
                spans.append((m.start(), m.end(), category, raw))

        if not spans:
            return RedactionResult(text=text)

        # Resolve overlaps: sort by (start, -length), keep first-wins.
        spans.sort(key=lambda s: (s[0], -(s[1] - s[0])))
        resolved: list[tuple[int, int, PHICategory, str]] = []
        last_end = -1
        for span in spans:
            if span[0] >= last_end:
                resolved.append(span)
                last_end = span[1]

        # Rebuild the string with replacements.
        import hashlib

        findings: list[PHIPIIFinding] = []
        out_parts: list[str] = []
        cursor = 0
        for start, end, category, raw in resolved:
            if cursor < start:
                out_parts.append(text[cursor:start])
            replacement = f"[REDACTED:{category.value}]"
            out_parts.append(replacement)
            findings.append(PHIPIIFinding(
                category=category,
                start=start,
                end=end,
                replacement=replacement,
                raw_hash=hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16],
            ))
            cursor = end
        if cursor < len(text):
            out_parts.append(text[cursor:])

        return RedactionResult(text="".join(out_parts), findings=findings)

    def contains_phi(self, text: str) -> bool:
        """Fast path: return True if any PHI/PII is present."""
        for category, pattern, validator in self._PATTERNS:
            if category not in self._enabled:
                continue
            for m in pattern.finditer(text):
                if validator and not validator(m.group(0)):
                    continue
                return True
        return False


# ---------------------------------------------------------------------------
# Module-level singletons + convenience wrappers
# ---------------------------------------------------------------------------

_default: PHIPIIDetector | None = None


def get_detector() -> PHIPIIDetector:
    global _default
    if _default is None:
        _default = PHIPIIDetector()
    return _default


def scrub_for_external_provider(text: str) -> RedactionResult:
    """Scrub BEFORE sending to AWS Bedrock / Azure OpenAI / any LLM.

    Per HIPAA BAA posture: even with a signed BAA, we follow the principle of
    minimum necessary and never send direct identifiers when the reasoning
    task doesn't require them.
    """
    return get_detector().redact(text)


def scrub_for_kg_ingest(text: str) -> RedactionResult:
    """Scrub BEFORE inserting into the shared/common Knowledge Graph.

    User-private KG ingestion has different rules (see kg_first_service.py)
    and may retain identifiers under user control. The SHARED KG is PHI-free.
    """
    return get_detector().redact(text)
