"""
Tests for the PHI/PII guardrail — the single active content safety layer.
"""


from app.agents.guardrails.phi_pii_detector import (
    PHICategory,
    PHIPIIDetector,
    scrub_for_external_provider,
    scrub_for_kg_ingest,
)


def test_ssn_detected_and_redacted():
    det = PHIPIIDetector()
    r = det.redact("Patient SSN is 123-45-6789 on file")
    assert r.redacted
    assert "[REDACTED:SSN]" in r.text
    assert "123-45-6789" not in r.text
    assert any(f.category == PHICategory.SSN for f in r.findings)


def test_invalid_ssn_not_matched():
    det = PHIPIIDetector()
    # 000-XX-XXXX is reserved and invalid per SSA rules
    r = det.redact("Identifier 000-12-3456 is not valid SSN")
    # Should not be redacted as SSN
    assert "[REDACTED:SSN]" not in r.text


def test_email_redacted():
    det = PHIPIIDetector()
    r = det.redact("Contact patient at jane.doe@example.com for results")
    assert "[REDACTED:EMAIL]" in r.text
    assert "jane.doe@example.com" not in r.text


def test_phone_redacted():
    det = PHIPIIDetector()
    r = det.redact("Call 555-123-4567 for follow-up")
    assert "[REDACTED:PHONE]" in r.text


def test_mrn_redacted():
    det = PHIPIIDetector()
    r = det.redact("MRN: 1234567 in the EHR")
    assert "[REDACTED:MRN]" in r.text


def test_dob_redacted():
    det = PHIPIIDetector()
    r = det.redact("Date of Birth: 03/14/1985 documented")
    assert "[REDACTED:DOB]" in r.text


def test_credit_card_luhn_valid():
    det = PHIPIIDetector()
    # Valid Luhn test number
    r = det.redact("Card 4532 0151 1283 0366 was used")
    assert "[REDACTED:CREDIT_CARD]" in r.text


def test_credit_card_luhn_invalid_not_matched():
    det = PHIPIIDetector()
    # Luhn-invalid: last digit changed
    r = det.redact("Random number 1234 5678 9012 3456 is not a card")
    assert "[REDACTED:CREDIT_CARD]" not in r.text


def test_ip_address_redacted():
    det = PHIPIIDetector()
    r = det.redact("Server 192.168.1.42 logged request")
    assert "[REDACTED:IP]" in r.text


def test_url_with_phi_params_redacted():
    det = PHIPIIDetector()
    r = det.redact("https://ehr.example.com/view?patient_id=98765&mrn=11111")
    assert "[REDACTED:URL_WITH_PHI]" in r.text


def test_multiple_redactions_in_one_buffer():
    det = PHIPIIDetector()
    text = (
        "Jane has SSN 123-45-6789, DOB 01/15/1970, "
        "and email jane@example.com. Call 555-987-6543."
    )
    r = det.redact(text)
    assert r.redacted
    assert "[REDACTED:SSN]" in r.text
    assert "[REDACTED:EMAIL]" in r.text
    assert "[REDACTED:PHONE]" in r.text
    # At least 3 distinct categories
    cats = {f.category for f in r.findings}
    assert PHICategory.SSN in cats
    assert PHICategory.EMAIL in cats


def test_no_phi_passes_through_unchanged():
    det = PHIPIIDetector()
    scientific = (
        "TP53 inhibits MDM2 via ubiquitin ligase activity in hepatocellular "
        "carcinoma. The mechanism involves nuclear translocation and binding "
        "to p53 response elements (PMID: 35123456)."
    )
    r = det.redact(scientific)
    assert not r.redacted
    assert r.text == scientific


def test_raw_value_never_leaks_into_finding():
    det = PHIPIIDetector()
    r = det.redact("SSN 123-45-6789 is sensitive")
    for f in r.findings:
        # replacement never contains the raw value
        assert "123-45-6789" not in f.replacement
        # raw_hash is present for audit correlation
        assert len(f.raw_hash) == 16


def test_scrub_for_external_provider_wrapper():
    r = scrub_for_external_provider("Patient contact: foo@example.com")
    assert "[REDACTED:EMAIL]" in r.text


def test_scrub_for_kg_ingest_wrapper():
    r = scrub_for_kg_ingest("Subject DOB 02/28/1990 enrolled")
    assert "[REDACTED:DOB]" in r.text


def test_contains_phi_fast_path():
    det = PHIPIIDetector()
    assert det.contains_phi("SSN 123-45-6789")
    assert not det.contains_phi("TP53 and MDM2 pathway")


def test_overlapping_matches_resolved_first_wins():
    det = PHIPIIDetector()
    # Email contains a dot-pattern that could match other regexes; the
    # first-wins resolver should produce a clean single EMAIL redaction.
    r = det.redact("Reach out to 555-123@example.com for info")
    # It's either parsed as email OR phone but not both overlapping
    assert r.redacted
    # No double-redaction artifacts
    assert "[REDACTED:EMAIL][REDACTED:" not in r.text
