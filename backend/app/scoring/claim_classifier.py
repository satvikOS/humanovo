"""
Claim Type Classification

Classifies biomedical claims by type and strength:
- Claim types (causal, correlational, predictive)
- Claim strength (strong, moderate, weak)
- Directionality (positive, negative, neutral)
- Specificity (specific, general)
"""

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Any, Tuple

logger = logging.getLogger(__name__)


class ClaimType(str, Enum):
    """Types of scientific claims."""
    CAUSAL = "causal"  # X causes Y
    CORRELATIONAL = "correlational"  # X associated with Y
    PREDICTIVE = "predictive"  # X predicts Y
    MECHANISTIC = "mechanistic"  # X works through Y
    THERAPEUTIC = "therapeutic"  # X treats Y
    DIAGNOSTIC = "diagnostic"  # X indicates Y
    PROGNOSTIC = "prognostic"  # X predicts outcome
    COMPARATIVE = "comparative"  # X better than Y
    DESCRIPTIVE = "descriptive"  # X has property Y
    QUANTITATIVE = "quantitative"  # Specific measurements
    UNKNOWN = "unknown"


class ClaimStrength(str, Enum):
    """Strength of claims."""
    DEFINITIVE = "definitive"  # Proven, established
    STRONG = "strong"  # Strong evidence
    MODERATE = "moderate"  # Reasonable evidence
    WEAK = "weak"  # Limited evidence
    SPECULATIVE = "speculative"  # Hypothesis, suggestion
    CONTRADICTED = "contradicted"  # Evidence against


class ClaimDirection(str, Enum):
    """Direction of claims."""
    POSITIVE = "positive"  # Confirms, supports
    NEGATIVE = "negative"  # Negates, contradicts
    NEUTRAL = "neutral"  # Neither confirms nor contradicts
    MIXED = "mixed"  # Both positive and negative aspects


class ClaimSpecificity(str, Enum):
    """Specificity of claims."""
    HIGHLY_SPECIFIC = "highly_specific"  # Specific population/context
    SPECIFIC = "specific"  # Defined context
    GENERAL = "general"  # Broad applicability
    UNIVERSAL = "universal"  # All contexts


@dataclass
class ClaimClassification:
    """Classification result for a claim."""
    text: str
    claim_type: ClaimType
    strength: ClaimStrength
    direction: ClaimDirection
    specificity: ClaimSpecificity
    confidence: float
    evidence_cues: List[str] = field(default_factory=list)
    hedging_cues: List[str] = field(default_factory=list)
    negation_cues: List[str] = field(default_factory=list)
    quantitative_data: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "claim_type": self.claim_type.value,
            "strength": self.strength.value,
            "direction": self.direction.value,
            "specificity": self.specificity.value,
            "confidence": self.confidence,
            "evidence_cues": self.evidence_cues,
            "hedging_cues": self.hedging_cues,
            "negation_cues": self.negation_cues,
            "quantitative_data": self.quantitative_data,
            "metadata": self.metadata
        }

    def get_claim_score(self) -> float:
        """Calculate claim quality score."""
        # Base score from strength
        strength_scores = {
            ClaimStrength.DEFINITIVE: 1.0,
            ClaimStrength.STRONG: 0.85,
            ClaimStrength.MODERATE: 0.65,
            ClaimStrength.WEAK: 0.4,
            ClaimStrength.SPECULATIVE: 0.2,
            ClaimStrength.CONTRADICTED: 0.1
        }
        base_score = strength_scores.get(self.strength, 0.5)

        # Adjust for specificity
        specificity_boost = {
            ClaimSpecificity.HIGHLY_SPECIFIC: 0.1,
            ClaimSpecificity.SPECIFIC: 0.05,
            ClaimSpecificity.GENERAL: 0.0,
            ClaimSpecificity.UNIVERSAL: -0.05
        }
        base_score += specificity_boost.get(self.specificity, 0)

        # Adjust for quantitative evidence
        if self.quantitative_data:
            base_score += 0.05

        return min(1.0, max(0.0, base_score * self.confidence))


class ClaimClassifier:
    """
    Classifies biomedical claims.

    Analyzes:
    - Claim type (causal, correlational, etc.)
    - Strength (definitive to speculative)
    - Direction (positive, negative)
    - Specificity (specific to universal)
    """

    # Claim type patterns
    CLAIM_TYPE_PATTERNS = {
        ClaimType.CAUSAL: [
            r'\bcauses?\b', r'\binduces?\b', r'\bleads?\s+to\b',
            r'\bresults?\s+in\b', r'\bproduces?\b', r'\bgenerates?\b',
            r'\bdrives?\b', r'\btriggers?\b'
        ],
        ClaimType.CORRELATIONAL: [
            r'\bassociated\s+with\b', r'\bcorrelat(?:es?|ed|ion)\b',
            r'\blinked\s+to\b', r'\brelated\s+to\b', r'\bco-?occurs?\b'
        ],
        ClaimType.PREDICTIVE: [
            r'\bpredicts?\b', r'\bprognostic\b', r'\bforecasts?\b',
            r'\bindicative\s+of\b', r'\bpredictive\s+of\b'
        ],
        ClaimType.MECHANISTIC: [
            r'\bmechanism\b', r'\bpathway\b', r'\bthrough\b',
            r'\bvia\b', r'\bmediated\s+by\b', r'\bmodulated\s+by\b'
        ],
        ClaimType.THERAPEUTIC: [
            r'\btreats?\b', r'\btherapeutic\b', r'\befficac(?:y|ious)\b',
            r'\beffective\s+(?:in|for|against)\b', r'\bbenefit\b'
        ],
        ClaimType.DIAGNOSTIC: [
            r'\bdiagnos(?:es?|tic|is)\b', r'\bdetects?\b',
            r'\bidentif(?:y|ies)\b', r'\bmarker\s+for\b'
        ],
        ClaimType.PROGNOSTIC: [
            r'\bprognos(?:is|tic)\b', r'\boutcome\b', r'\bsurvival\b',
            r'\brisk\s+(?:of|for)\b', r'\bpredicts?\s+outcome\b'
        ],
        ClaimType.COMPARATIVE: [
            r'\bsuperior\s+to\b', r'\bbetter\s+than\b', r'\bmore\s+effective\b',
            r'\boutperforms?\b', r'\bcompared?\s+(?:to|with)\b', r'\bvs\.?\b'
        ],
        ClaimType.QUANTITATIVE: [
            r'\b\d+(?:\.\d+)?\s*%\b', r'\bp\s*[<>=]\s*0\.\d+\b',
            r'\bHR\s*=?\s*\d', r'\bOR\s*=?\s*\d', r'\bCI\s*[:\[]'
        ],
    }

    # Strength patterns
    STRENGTH_PATTERNS = {
        ClaimStrength.DEFINITIVE: [
            r'\bconfirms?\b', r'\bestablish(?:es|ed)?\b', r'\bproven?\b',
            r'\bdemonstrat(?:es?|ed)\b', r'\bconclusively\b', r'\bdefinitively\b'
        ],
        ClaimStrength.STRONG: [
            r'\bsignificant(?:ly)?\b', r'\bstrongly?\b', r'\bclearly\b',
            r'\bsubstantial\b', r'\brobust\b', r'\bp\s*<\s*0\.001\b'
        ],
        ClaimStrength.MODERATE: [
            r'\bsuggest(?:s|ed|ing)?\b', r'\bindicat(?:es?|ed|ing)\b',
            r'\bsupport(?:s|ed|ing)?\b', r'\bp\s*<\s*0\.05\b'
        ],
        ClaimStrength.WEAK: [
            r'\btrend\b', r'\bweak(?:ly)?\b', r'\blimited\b',
            r'\bmarginally?\b', r'\bp\s*[<>=]\s*0\.1\b'
        ],
        ClaimStrength.SPECULATIVE: [
            r'\bmay\b', r'\bmight\b', r'\bcould\b', r'\bpossibly\b',
            r'\bperhaps\b', r'\bhypothesi[sz]e\b', r'\bspeculat\b'
        ],
    }

    # Negation patterns
    NEGATION_PATTERNS = [
        r'\bno\b', r'\bnot\b', r'\bnone\b', r'\bnever\b',
        r'\bfail(?:s|ed)?\s+to\b', r'\black(?:s|ed|ing)?\s+of\b',
        r'\babsence\s+of\b', r'\bwithout\b', r'\bdoes\s+not\b'
    ]

    # Hedging patterns
    HEDGING_PATTERNS = [
        r'\bpossibly\b', r'\bpotentially\b', r'\blikely\b',
        r'\bunlikely\b', r'\bprobably\b', r'\bappear(?:s)?\s+to\b',
        r'\bseem(?:s)?\s+to\b', r'\bsuggest(?:s|ing)?\b'
    ]

    # Specificity patterns
    SPECIFICITY_PATTERNS = {
        ClaimSpecificity.HIGHLY_SPECIFIC: [
            r'\bin\s+patients?\s+with\b', r'\bin\s+\w+\s+cells?\b',
            r'\bsubgroup\b', r'\bstratified\b', r'\bspecifically\b'
        ],
        ClaimSpecificity.SPECIFIC: [
            r'\bin\s+\w+\s+cancer\b', r'\bin\s+adults?\b',
            r'\bin\s+(?:phase\s+)?[IVX]+\b'
        ],
        ClaimSpecificity.UNIVERSAL: [
            r'\ball\s+patients?\b', r'\buniversally?\b',
            r'\balways\b', r'\binvariably\b'
        ],
    }

    def __init__(
        self,
        confidence_threshold: float = 0.5
    ):
        """
        Initialize the claim classifier.

        Args:
            confidence_threshold: Minimum confidence threshold
        """
        self.confidence_threshold = confidence_threshold

        # Compile patterns
        self._type_patterns = {
            ct: [re.compile(p, re.IGNORECASE) for p in patterns]
            for ct, patterns in self.CLAIM_TYPE_PATTERNS.items()
        }
        self._strength_patterns = {
            cs: [re.compile(p, re.IGNORECASE) for p in patterns]
            for cs, patterns in self.STRENGTH_PATTERNS.items()
        }
        self._negation_patterns = [
            re.compile(p, re.IGNORECASE) for p in self.NEGATION_PATTERNS
        ]
        self._hedging_patterns = [
            re.compile(p, re.IGNORECASE) for p in self.HEDGING_PATTERNS
        ]
        self._specificity_patterns = {
            sp: [re.compile(p, re.IGNORECASE) for p in patterns]
            for sp, patterns in self.SPECIFICITY_PATTERNS.items()
        }

        logger.info("ClaimClassifier initialized")

    def classify(self, text: str) -> ClaimClassification:
        """
        Classify a claim.

        Args:
            text: Claim text

        Returns:
            ClaimClassification
        """
        # Detect claim type
        claim_type, type_cues = self._detect_claim_type(text)

        # Detect strength
        strength, strength_cues = self._detect_strength(text)

        # Detect negation and direction
        negation_cues = self._detect_negation(text)
        hedging_cues = self._detect_hedging(text)
        direction = self._determine_direction(negation_cues, hedging_cues, text)

        # Detect specificity
        specificity = self._detect_specificity(text)

        # Extract quantitative data
        quant_data = self._extract_quantitative(text)

        # Calculate confidence
        confidence = self._calculate_confidence(
            type_cues, strength_cues, negation_cues, hedging_cues, quant_data
        )

        return ClaimClassification(
            text=text,
            claim_type=claim_type,
            strength=strength,
            direction=direction,
            specificity=specificity,
            confidence=confidence,
            evidence_cues=type_cues + strength_cues,
            hedging_cues=hedging_cues,
            negation_cues=negation_cues,
            quantitative_data=quant_data
        )

    def _detect_claim_type(self, text: str) -> Tuple[ClaimType, List[str]]:
        """Detect claim type from text."""
        matches = {}
        all_cues = []

        for claim_type, patterns in self._type_patterns.items():
            count = 0
            cues = []
            for pattern in patterns:
                found = pattern.findall(text)
                count += len(found)
                cues.extend(found)

            if count > 0:
                matches[claim_type] = count
                all_cues.extend(cues)

        if not matches:
            return ClaimType.UNKNOWN, []

        best_type = max(matches, key=matches.get)
        return best_type, all_cues

    def _detect_strength(self, text: str) -> Tuple[ClaimStrength, List[str]]:
        """Detect claim strength from text."""
        for strength in [
            ClaimStrength.DEFINITIVE,
            ClaimStrength.STRONG,
            ClaimStrength.MODERATE,
            ClaimStrength.WEAK,
            ClaimStrength.SPECULATIVE
        ]:
            patterns = self._strength_patterns.get(strength, [])
            for pattern in patterns:
                matches = pattern.findall(text)
                if matches:
                    return strength, matches

        return ClaimStrength.MODERATE, []

    def _detect_negation(self, text: str) -> List[str]:
        """Detect negation cues."""
        cues = []
        for pattern in self._negation_patterns:
            matches = pattern.findall(text)
            cues.extend(matches)
        return cues

    def _detect_hedging(self, text: str) -> List[str]:
        """Detect hedging language."""
        cues = []
        for pattern in self._hedging_patterns:
            matches = pattern.findall(text)
            cues.extend(matches)
        return cues

    def _determine_direction(
        self,
        negation_cues: List[str],
        hedging_cues: List[str],
        text: str
    ) -> ClaimDirection:
        """Determine claim direction."""
        # Check for explicit negative direction
        if len(negation_cues) > 0:
            if len(hedging_cues) > 0:
                return ClaimDirection.MIXED
            return ClaimDirection.NEGATIVE

        # Check for positive indicators
        positive_patterns = [
            r'\bconfirm', r'\bsupport', r'\bshow', r'\bdemonstrate',
            r'\beffective', r'\bbeneficial', r'\bimprove'
        ]
        for pattern in positive_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return ClaimDirection.POSITIVE

        return ClaimDirection.NEUTRAL

    def _detect_specificity(self, text: str) -> ClaimSpecificity:
        """Detect claim specificity."""
        for specificity in [
            ClaimSpecificity.HIGHLY_SPECIFIC,
            ClaimSpecificity.SPECIFIC,
            ClaimSpecificity.UNIVERSAL
        ]:
            patterns = self._specificity_patterns.get(specificity, [])
            for pattern in patterns:
                if pattern.search(text):
                    return specificity

        return ClaimSpecificity.GENERAL

    def _extract_quantitative(self, text: str) -> Dict[str, Any]:
        """Extract quantitative data from text."""
        data = {}

        # P-values
        p_match = re.search(r'p\s*[<>=]\s*(0\.\d+)', text, re.IGNORECASE)
        if p_match:
            data['p_value'] = float(p_match.group(1))

        # Hazard ratio
        hr_match = re.search(r'HR\s*[=:]\s*(\d+\.?\d*)', text, re.IGNORECASE)
        if hr_match:
            data['hazard_ratio'] = float(hr_match.group(1))

        # Odds ratio
        or_match = re.search(r'OR\s*[=:]\s*(\d+\.?\d*)', text, re.IGNORECASE)
        if or_match:
            data['odds_ratio'] = float(or_match.group(1))

        # Confidence interval
        ci_match = re.search(
            r'(?:95%?\s*)?CI\s*[:\[]\s*(\d+\.?\d*)\s*[-,]\s*(\d+\.?\d*)',
            text, re.IGNORECASE
        )
        if ci_match:
            data['confidence_interval'] = [
                float(ci_match.group(1)),
                float(ci_match.group(2))
            ]

        # Percentages
        pct_matches = re.findall(r'(\d+(?:\.\d+)?)\s*%', text)
        if pct_matches:
            data['percentages'] = [float(p) for p in pct_matches]

        return data

    def _calculate_confidence(
        self,
        type_cues: List[str],
        strength_cues: List[str],
        negation_cues: List[str],
        hedging_cues: List[str],
        quant_data: Dict[str, Any]
    ) -> float:
        """Calculate classification confidence."""
        # Base confidence
        confidence = 0.5

        # Boost for more evidence cues
        confidence += min(0.2, len(type_cues) * 0.05)
        confidence += min(0.1, len(strength_cues) * 0.05)

        # Boost for quantitative data
        if quant_data:
            confidence += 0.1

        # Penalty for hedging
        confidence -= min(0.2, len(hedging_cues) * 0.05)

        return min(1.0, max(0.1, confidence))

    def batch_classify(self, texts: List[str]) -> List[ClaimClassification]:
        """Classify multiple claims."""
        return [self.classify(text) for text in texts]

    def analyze_claims(
        self,
        classifications: List[ClaimClassification]
    ) -> Dict[str, Any]:
        """Analyze a set of claim classifications."""
        if not classifications:
            return {"error": "No claims to analyze"}

        type_counts = {}
        strength_counts = {}
        direction_counts = {}
        scores = []

        for c in classifications:
            type_counts[c.claim_type.value] = type_counts.get(c.claim_type.value, 0) + 1
            strength_counts[c.strength.value] = strength_counts.get(c.strength.value, 0) + 1
            direction_counts[c.direction.value] = direction_counts.get(c.direction.value, 0) + 1
            scores.append(c.get_claim_score())

        return {
            "total_claims": len(classifications),
            "claim_type_distribution": type_counts,
            "strength_distribution": strength_counts,
            "direction_distribution": direction_counts,
            "average_score": sum(scores) / len(scores),
            "quantitative_claims": sum(1 for c in classifications if c.quantitative_data),
            "hedged_claims": sum(1 for c in classifications if c.hedging_cues)
        }


# Convenience function
def classify_claim(text: str) -> ClaimClassification:
    """Quick claim classification."""
    classifier = ClaimClassifier()
    return classifier.classify(text)
