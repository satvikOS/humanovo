"""
Assertion Detection for Biomedical Text

Classifies assertions/claims as:
- POSITIVE: Definitive positive statement
- NEGATIVE: Definitive negation
- SPECULATIVE: Hedged or uncertain
- CONDITIONAL: Dependent on conditions
- COMPARATIVE: Comparison between entities
- CONTRAINDICATED: Negative recommendation

Also detects:
- Negation scope
- Hedging language
- Certainty level
- Evidence strength
"""

import logging
import re
from dataclasses import dataclass, field
from enum import StrEnum
from functools import lru_cache
from typing import Any

logger = logging.getLogger(__name__)


class AssertionType(StrEnum):
    """Types of assertions/claims."""

    POSITIVE = "positive"
    NEGATIVE = "negative"
    SPECULATIVE = "speculative"
    CONDITIONAL = "conditional"
    COMPARATIVE = "comparative"
    CONTRAINDICATED = "contraindicated"
    UNKNOWN = "unknown"


class CertaintyLevel(StrEnum):
    """Levels of certainty in assertions."""

    DEFINITE = "definite"
    PROBABLE = "probable"
    POSSIBLE = "possible"
    UNCERTAIN = "uncertain"
    DOUBTFUL = "doubtful"


class EvidenceStrength(StrEnum):
    """Strength of evidence supporting assertion."""

    STRONG = "strong"  # RCT, meta-analysis
    MODERATE = "moderate"  # Cohort, case-control
    LIMITED = "limited"  # Case series, case reports
    WEAK = "weak"  # Expert opinion, in vitro
    ANECDOTAL = "anecdotal"


@dataclass
class Assertion:
    """Represents a detected assertion/claim."""

    text: str
    assertion_type: AssertionType
    certainty: CertaintyLevel
    evidence_strength: EvidenceStrength
    confidence: float
    negation_detected: bool = False
    hedging_detected: bool = False
    negation_cues: list[str] = field(default_factory=list)
    hedging_cues: list[str] = field(default_factory=list)
    condition_cues: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "assertion_type": self.assertion_type.value,
            "certainty": self.certainty.value,
            "evidence_strength": self.evidence_strength.value,
            "confidence": self.confidence,
            "negation_detected": self.negation_detected,
            "hedging_detected": self.hedging_detected,
            "negation_cues": self.negation_cues,
            "hedging_cues": self.hedging_cues,
            "condition_cues": self.condition_cues,
            "metadata": self.metadata,
        }


class AssertionDetector:
    """
    Detects and classifies assertions in biomedical text.

    Uses pattern-based and linguistic analysis to identify:
    - Positive vs negative claims
    - Speculative language
    - Certainty indicators
    - Evidence strength
    """

    # Negation patterns
    NEGATION_CUES = [
        r"\bno\b",
        r"\bnot\b",
        r"\bnone\b",
        r"\bnever\b",
        r"\bneither\b",
        r"\bwithout\b",
        r"\black[s]?\s+of\b",
        r"\babsence\s+of\b",
        r"\bfail[s|ed]?\s+to\b",
        r"\bfailure\b",
        r"\bunable\s+to\b",
        r"\bdid\s+not\b",
        r"\bdoes\s+not\b",
        r"\bcannot\b",
        r"\bcan\'t\b",
        r"\bwon\'t\b",
        r"\bwouldn\'t\b",
        r"\bshouldn\'t\b",
        r"\brule[sd]?\s+out\b",
        r"\bexclude[sd]?\b",
        r"\bnegative\s+for\b",
        r"\bno\s+evidence\b",
        r"\bno\s+significant\b",
        r"\bnon-?\s*\w+",
        r"\bun\w+able\b",
        r"\bin\w+ant\b",
    ]

    # Hedging patterns (speculative language)
    HEDGING_CUES = [
        r"\bmay\b",
        r"\bmight\b",
        r"\bcould\b",
        r"\bwould\b",
        r"\bpossibly\b",
        r"\bpotentially\b",
        r"\bperhaps\b",
        r"\bsuggest[s]?\b",
        r"\bappear[s]?\s+to\b",
        r"\bseem[s]?\s+to\b",
        r"\blikely\b",
        r"\bunlikely\b",
        r"\bprobably\b",
        r"\bprobable\b",
        r"\bpossible\b",
        r"\bplausible\b",
        r"\bputative\b",
        r"\bhypothesi[sz]ed?\b",
        r"\bproposed\b",
        r"\bpredict[s|ed]?\b",
        r"\bcandidate\b",
        r"\bpreliminary\b",
        r"\btentative\b",
        r"\buncertain\b",
        r"\bunclear\b",
        r"\bremains?\s+to\s+be\b",
        r"\bfurther\s+(?:research|investigation|study)\b",
        r"\bin\s+vitro\b",
        r"\bin\s+silico\b",
        r"\bmodel[s]?\s+suggest\b",
    ]

    # Strong positive indicators
    DEFINITE_POSITIVE_CUES = [
        r"\bconfirm[s|ed]?\b",
        r"\bdemonstrat[e|ed|es]?\b",
        r"\bestablish[ed]?\b",
        r"\bprov[e|en|ed]?\b",
        r"\bvalidat[e|ed]?\b",
        r"\bshowed?\s+(?:that|clear)\b",
        r"\bclearly\b",
        r"\bdefinitely\b",
        r"\bconclusively\b",
        r"\bindubitably\b",
        r"\beffective\b",
        r"\befficacious\b",
        r"\bsignificant(?:ly)?\b",
        r"\bstatistically\s+significant\b",
        r"\bp\s*[<≤]\s*0\.0[0-5]\b",
        r"\bphase\s+(?:II|III)\s+(?:trial|study)\b",
        r"\brandomized\s+controlled\b",
        r"\bmeta-?analysis\b",
        r"\bsystematic\s+review\b",
    ]

    # Conditional cues
    CONDITIONAL_CUES = [
        r"\bif\b",
        r"\bwhen\b",
        r"\bunless\b",
        r"\bprovided\s+that\b",
        r"\bassuming\b",
        r"\bin\s+(?:the\s+)?case\s+(?:of|that)\b",
        r"\bdepend(?:s|ing)?\s+on\b",
        r"\bconditional\s+on\b",
        r"\bgiven\s+that\b",
        r"\bonly\s+if\b",
        r"\bonly\s+when\b",
        r"\bunder\s+(?:certain\s+)?conditions?\b",
        r"\bin\s+(?:certain|some)\s+(?:cases|patients|populations)\b",
        r"\bsubgroup\b",
        r"\bstratified\b",
    ]

    # Contraindication cues
    CONTRAINDICATION_CUES = [
        r"\bcontraindicated\b",
        r"\bcontraindication\b",
        r"\bnot\s+recommended\b",
        r"\bavoid\b",
        r"\bshould\s+not\s+(?:be\s+)?(?:used|administered|given)\b",
        r"\bwarning\b",
        r"\bcaution\b",
        r"\badverse\s+(?:effect|event|reaction)\b",
        r"\btoxic(?:ity)?\b",
        r"\bhazard(?:ous)?\b",
        r"\bdangerous\b",
    ]

    # Comparative cues
    COMPARATIVE_CUES = [
        r"\bcompared?\s+(?:to|with)\b",
        r"\bversus\b",
        r"\bvs\.?\b",
        r"\brelative\s+to\b",
        r"\bsuperior\s+to\b",
        r"\binferior\s+to\b",
        r"\bequivalent\s+to\b",
        r"\bnon-?inferior\b",
        r"\bmore\s+(?:effective|efficacious)\b",
        r"\bless\s+(?:effective|efficacious)\b",
        r"\bgreater\s+than\b",
        r"\bless\s+than\b",
        r"\bbetter\s+than\b",
        r"\bworse\s+than\b",
        r"\boutperform[s|ed]?\b",
    ]

    # Evidence strength indicators
    EVIDENCE_INDICATORS = {
        EvidenceStrength.STRONG: [
            r"\brandomized\s+controlled\s+trial\b",
            r"\bRCT\b",
            r"\bmeta-?analysis\b",
            r"\bsystematic\s+review\b",
            r"\bCochrane\b",
            r"\bphase\s+III\b",
            r"\bpivotal\s+(?:study|trial)\b",
            r"\bregistration\s+(?:study|trial)\b",
        ],
        EvidenceStrength.MODERATE: [
            r"\bcohort\s+study\b",
            r"\bcase-?control\b",
            r"\bprospective\s+study\b",
            r"\bretrospective\s+(?:study|analysis)\b",
            r"\bphase\s+II\b",
            r"\bobservational\s+study\b",
        ],
        EvidenceStrength.LIMITED: [
            r"\bcase\s+series\b",
            r"\bcase\s+report\b",
            r"\bsingle-?arm\b",
            r"\bpilot\s+study\b",
            r"\bphase\s+I\b",
            r"\bsmall\s+(?:study|sample|cohort)\b",
        ],
        EvidenceStrength.WEAK: [
            r"\bexpert\s+opinion\b",
            r"\bconsensus\b",
            r"\bin\s+vitro\b",
            r"\bcell\s+line\b",
            r"\bpreclinical\b",
            r"\banimal\s+(?:model|study)\b",
            r"\bmouse\s+(?:model|study)\b",
        ],
        EvidenceStrength.ANECDOTAL: [
            r"\banecdotal\b",
            r"\bpersonal\s+(?:experience|observation)\b",
            r"\bisolated\s+(?:case|report)\b",
            r"\bunpublished\b",
            r"\bpreliminary\s+data\b",
        ],
    }

    def __init__(self, confidence_threshold: float = 0.5, detect_negation_scope: bool = True):
        """
        Initialize the assertion detector.

        Args:
            confidence_threshold: Minimum confidence for classification
            detect_negation_scope: Whether to detect negation scope
        """
        self.confidence_threshold = confidence_threshold
        self.detect_negation_scope = detect_negation_scope

        # Compile patterns
        self._negation_patterns = [re.compile(p, re.IGNORECASE) for p in self.NEGATION_CUES]
        self._hedging_patterns = [re.compile(p, re.IGNORECASE) for p in self.HEDGING_CUES]
        self._positive_patterns = [
            re.compile(p, re.IGNORECASE) for p in self.DEFINITE_POSITIVE_CUES
        ]
        self._conditional_patterns = [re.compile(p, re.IGNORECASE) for p in self.CONDITIONAL_CUES]
        self._contraindication_patterns = [
            re.compile(p, re.IGNORECASE) for p in self.CONTRAINDICATION_CUES
        ]
        self._comparative_patterns = [re.compile(p, re.IGNORECASE) for p in self.COMPARATIVE_CUES]

        self._evidence_patterns: dict[EvidenceStrength, list[re.Pattern]] = {}
        for strength, patterns in self.EVIDENCE_INDICATORS.items():
            self._evidence_patterns[strength] = [re.compile(p, re.IGNORECASE) for p in patterns]

        logger.info("AssertionDetector initialized")

    def detect_assertion(self, text: str) -> Assertion:
        """
        Detect and classify assertion in text.

        Args:
            text: Input text to analyze

        Returns:
            Assertion object with classification
        """
        # Detect various linguistic features
        negation_cues = self._detect_negation(text)
        hedging_cues = self._detect_hedging(text)
        positive_cues = self._detect_positive(text)
        conditional_cues = self._detect_conditional(text)
        contraindication_cues = self._detect_contraindication(text)
        comparative_cues = self._detect_comparative(text)

        # Detect evidence strength
        evidence_strength = self._detect_evidence_strength(text)

        # Classify assertion type
        assertion_type, confidence = self._classify_assertion(
            negation_cues=negation_cues,
            hedging_cues=hedging_cues,
            positive_cues=positive_cues,
            conditional_cues=conditional_cues,
            contraindication_cues=contraindication_cues,
            comparative_cues=comparative_cues,
        )

        # Determine certainty level
        certainty = self._determine_certainty(
            assertion_type=assertion_type,
            hedging_cues=hedging_cues,
            positive_cues=positive_cues,
            evidence_strength=evidence_strength,
        )

        return Assertion(
            text=text,
            assertion_type=assertion_type,
            certainty=certainty,
            evidence_strength=evidence_strength,
            confidence=confidence,
            negation_detected=len(negation_cues) > 0,
            hedging_detected=len(hedging_cues) > 0,
            negation_cues=negation_cues,
            hedging_cues=hedging_cues,
            condition_cues=conditional_cues,
            metadata={
                "positive_cues": positive_cues,
                "contraindication_cues": contraindication_cues,
                "comparative_cues": comparative_cues,
            },
        )

    def _detect_negation(self, text: str) -> list[str]:
        """Detect negation cues in text."""
        cues = []
        for pattern in self._negation_patterns:
            matches = pattern.findall(text)
            cues.extend(matches)
        return cues

    def _detect_hedging(self, text: str) -> list[str]:
        """Detect hedging language in text."""
        cues = []
        for pattern in self._hedging_patterns:
            matches = pattern.findall(text)
            cues.extend(matches)
        return cues

    def _detect_positive(self, text: str) -> list[str]:
        """Detect positive/definite language in text."""
        cues = []
        for pattern in self._positive_patterns:
            matches = pattern.findall(text)
            cues.extend(matches)
        return cues

    def _detect_conditional(self, text: str) -> list[str]:
        """Detect conditional language in text."""
        cues = []
        for pattern in self._conditional_patterns:
            matches = pattern.findall(text)
            cues.extend(matches)
        return cues

    def _detect_contraindication(self, text: str) -> list[str]:
        """Detect contraindication language in text."""
        cues = []
        for pattern in self._contraindication_patterns:
            matches = pattern.findall(text)
            cues.extend(matches)
        return cues

    def _detect_comparative(self, text: str) -> list[str]:
        """Detect comparative language in text."""
        cues = []
        for pattern in self._comparative_patterns:
            matches = pattern.findall(text)
            cues.extend(matches)
        return cues

    def _detect_evidence_strength(self, text: str) -> EvidenceStrength:
        """Detect evidence strength from text."""
        for strength in [
            EvidenceStrength.STRONG,
            EvidenceStrength.MODERATE,
            EvidenceStrength.LIMITED,
            EvidenceStrength.WEAK,
            EvidenceStrength.ANECDOTAL,
        ]:
            for pattern in self._evidence_patterns[strength]:
                if pattern.search(text):
                    return strength

        return EvidenceStrength.MODERATE  # Default

    def _classify_assertion(
        self,
        negation_cues: list[str],
        hedging_cues: list[str],
        positive_cues: list[str],
        conditional_cues: list[str],
        contraindication_cues: list[str],
        comparative_cues: list[str],
    ) -> tuple[AssertionType, float]:
        """Classify assertion type based on detected cues."""
        scores = {
            AssertionType.POSITIVE: 0.0,
            AssertionType.NEGATIVE: 0.0,
            AssertionType.SPECULATIVE: 0.0,
            AssertionType.CONDITIONAL: 0.0,
            AssertionType.COMPARATIVE: 0.0,
            AssertionType.CONTRAINDICATED: 0.0,
        }

        # Score based on cue counts
        if positive_cues:
            scores[AssertionType.POSITIVE] += len(positive_cues) * 0.3

        if negation_cues:
            scores[AssertionType.NEGATIVE] += len(negation_cues) * 0.4

        if hedging_cues:
            scores[AssertionType.SPECULATIVE] += len(hedging_cues) * 0.35

        if conditional_cues:
            scores[AssertionType.CONDITIONAL] += len(conditional_cues) * 0.3

        if comparative_cues:
            scores[AssertionType.COMPARATIVE] += len(comparative_cues) * 0.3

        if contraindication_cues:
            scores[AssertionType.CONTRAINDICATED] += len(contraindication_cues) * 0.5

        # Normalize scores
        total = sum(scores.values())
        if total > 0:
            scores = {k: v / total for k, v in scores.items()}

        # Find highest score
        best_type = max(scores, key=scores.get)
        best_score = scores[best_type]

        # Default to positive if no clear signal
        if best_score < 0.2:
            return AssertionType.POSITIVE, 0.5

        return best_type, min(0.95, best_score + 0.3)

    def _determine_certainty(
        self,
        assertion_type: AssertionType,
        hedging_cues: list[str],
        positive_cues: list[str],
        evidence_strength: EvidenceStrength,
    ) -> CertaintyLevel:
        """Determine certainty level of assertion."""
        # Start with evidence-based certainty
        certainty_map = {
            EvidenceStrength.STRONG: CertaintyLevel.DEFINITE,
            EvidenceStrength.MODERATE: CertaintyLevel.PROBABLE,
            EvidenceStrength.LIMITED: CertaintyLevel.POSSIBLE,
            EvidenceStrength.WEAK: CertaintyLevel.UNCERTAIN,
            EvidenceStrength.ANECDOTAL: CertaintyLevel.DOUBTFUL,
        }

        base_certainty = certainty_map.get(evidence_strength, CertaintyLevel.POSSIBLE)

        # Adjust based on language
        if assertion_type == AssertionType.SPECULATIVE:
            # Downgrade certainty
            if base_certainty == CertaintyLevel.DEFINITE:
                return CertaintyLevel.PROBABLE
            elif base_certainty == CertaintyLevel.PROBABLE:
                return CertaintyLevel.POSSIBLE
            elif base_certainty == CertaintyLevel.POSSIBLE:
                return CertaintyLevel.UNCERTAIN
            return CertaintyLevel.DOUBTFUL

        if len(positive_cues) >= 2 and len(hedging_cues) == 0:
            # Upgrade certainty
            if base_certainty == CertaintyLevel.PROBABLE:
                return CertaintyLevel.DEFINITE
            elif base_certainty == CertaintyLevel.POSSIBLE:
                return CertaintyLevel.PROBABLE

        return base_certainty

    def batch_detect(self, texts: list[str]) -> list[Assertion]:
        """
        Detect assertions in multiple texts.

        Args:
            texts: List of input texts

        Returns:
            List of Assertion objects
        """
        return [self.detect_assertion(text) for text in texts]

    def analyze_claim(self, claim_text: str, context: str | None = None) -> dict[str, Any]:
        """
        Comprehensive analysis of a scientific claim.

        Args:
            claim_text: The claim to analyze
            context: Optional surrounding context

        Returns:
            Dictionary with detailed analysis
        """
        assertion = self.detect_assertion(claim_text)

        analysis = {
            "claim": claim_text,
            "assertion": assertion.to_dict(),
            "summary": {
                "is_positive": assertion.assertion_type == AssertionType.POSITIVE,
                "is_negated": assertion.negation_detected,
                "is_speculative": assertion.hedging_detected,
                "certainty": assertion.certainty.value,
                "evidence_quality": assertion.evidence_strength.value,
            },
            "cues": {
                "negation": assertion.negation_cues,
                "hedging": assertion.hedging_cues,
                "conditions": assertion.condition_cues,
            },
        }

        # Analyze context if provided
        if context:
            context_assertion = self.detect_assertion(context)
            analysis["context_analysis"] = {
                "evidence_strength": context_assertion.evidence_strength.value,
                "contains_negation": context_assertion.negation_detected,
                "contains_hedging": context_assertion.hedging_detected,
            }

        return analysis


# Convenience functions
@lru_cache(maxsize=1)
def get_default_assertion_detector() -> AssertionDetector:
    """Get a cached default assertion detector."""
    return AssertionDetector()


def detect_assertion(text: str) -> Assertion:
    """Quick assertion detection using default detector."""
    detector = get_default_assertion_detector()
    return detector.detect_assertion(text)


def analyze_claim(claim_text: str, context: str | None = None) -> dict[str, Any]:
    """Quick claim analysis using default detector."""
    detector = get_default_assertion_detector()
    return detector.analyze_claim(claim_text, context)
