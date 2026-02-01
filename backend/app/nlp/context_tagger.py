"""
Context Tagging for Biomedical Text

Tags text segments with semantic context categories:
- DRUG_CONTEXT: Drug-related information
- INDICATION_CONTEXT: Disease/indication information
- RESISTANCE_CONTEXT: Drug resistance mechanisms
- BIOMARKER_CONTEXT: Biomarker-related content
- OUTCOME_CONTEXT: Clinical outcomes
- MECHANISM_CONTEXT: Mechanism of action
- SAFETY_CONTEXT: Safety/toxicity information
- DOSING_CONTEXT: Dosing/administration
- TRIAL_CONTEXT: Clinical trial information
- PRECLINICAL_CONTEXT: Preclinical/lab studies

Also captures:
- Patient population
- Treatment setting
- Disease stage
- Line of therapy
"""

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class ContextCategory(str, Enum):
    """Context categories for biomedical text."""

    DRUG_CONTEXT = "drug_context"
    INDICATION_CONTEXT = "indication_context"
    RESISTANCE_CONTEXT = "resistance_context"
    BIOMARKER_CONTEXT = "biomarker_context"
    OUTCOME_CONTEXT = "outcome_context"
    MECHANISM_CONTEXT = "mechanism_context"
    SAFETY_CONTEXT = "safety_context"
    DOSING_CONTEXT = "dosing_context"
    TRIAL_CONTEXT = "trial_context"
    PRECLINICAL_CONTEXT = "preclinical_context"
    PHARMACOLOGY_CONTEXT = "pharmacology_context"
    DIAGNOSTIC_CONTEXT = "diagnostic_context"


class PatientPopulation(str, Enum):
    """Patient population categories."""

    ADULT = "adult"
    PEDIATRIC = "pediatric"
    GERIATRIC = "geriatric"
    PREGNANT = "pregnant"
    RENAL_IMPAIRED = "renal_impaired"
    HEPATIC_IMPAIRED = "hepatic_impaired"
    TREATMENT_NAIVE = "treatment_naive"
    PREVIOUSLY_TREATED = "previously_treated"
    REFRACTORY = "refractory"
    RELAPSED = "relapsed"


class TreatmentSetting(str, Enum):
    """Treatment setting categories."""

    FIRST_LINE = "first_line"
    SECOND_LINE = "second_line"
    THIRD_LINE_PLUS = "third_line_plus"
    ADJUVANT = "adjuvant"
    NEOADJUVANT = "neoadjuvant"
    MAINTENANCE = "maintenance"
    PALLIATIVE = "palliative"
    CURATIVE = "curative"
    COMBINATION = "combination"
    MONOTHERAPY = "monotherapy"


class DiseaseStage(str, Enum):
    """Disease stage categories."""

    EARLY = "early"
    LOCALIZED = "localized"
    LOCALLY_ADVANCED = "locally_advanced"
    METASTATIC = "metastatic"
    ADVANCED = "advanced"
    RECURRENT = "recurrent"
    PROGRESSIVE = "progressive"
    STABLE = "stable"
    COMPLETE_RESPONSE = "complete_response"
    PARTIAL_RESPONSE = "partial_response"


@dataclass
class ContextAnnotation:
    """Represents a context annotation for a text segment."""

    text: str
    start: int
    end: int
    primary_context: ContextCategory
    secondary_contexts: list[ContextCategory] = field(default_factory=list)
    confidence: float = 0.0
    patient_population: PatientPopulation | None = None
    treatment_setting: TreatmentSetting | None = None
    disease_stage: DiseaseStage | None = None
    line_of_therapy: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "start": self.start,
            "end": self.end,
            "primary_context": self.primary_context.value,
            "secondary_contexts": [c.value for c in self.secondary_contexts],
            "confidence": self.confidence,
            "patient_population": self.patient_population.value
            if self.patient_population
            else None,
            "treatment_setting": self.treatment_setting.value if self.treatment_setting else None,
            "disease_stage": self.disease_stage.value if self.disease_stage else None,
            "line_of_therapy": self.line_of_therapy,
            "metadata": self.metadata,
        }


class ContextTagger:
    """
    Tags biomedical text with semantic context categories.

    Provides rich contextual information about:
    - What type of information is being discussed
    - Patient population characteristics
    - Treatment setting
    - Disease stage
    """

    # Context category patterns
    CONTEXT_PATTERNS = {
        ContextCategory.DRUG_CONTEXT: [
            r"\b(?:drug|medication|compound|therapeutic|treatment|therapy|regimen)\b",
            r"\b(?:administer(?:ed|ing)?|dose|dosing|dosage)\b",
            r"\b(?:oral|intravenous|IV|subcutaneous|SC|intramuscular|IM)\b",
            r"\b(?:formulation|preparation|solution|suspension|tablet|capsule)\b",
            r"\b(?:approved|FDA|EMA|authorized|marketed)\b",
            r"\b(?:generic|brand|proprietary)\b",
        ],
        ContextCategory.INDICATION_CONTEXT: [
            r"\b(?:indicated|indication|disease|condition|disorder|syndrome)\b",
            r"\b(?:patient[s]?\s+with|diagnosed\s+with)\b",
            r"\b(?:cancer|carcinoma|tumor|malignancy|neoplasm)\b",
            r"\b(?:leukemia|lymphoma|melanoma|sarcoma)\b",
            r"\b(?:breast|lung|colon|prostate|ovarian|pancreatic)\s+cancer\b",
            r"\b(?:autoimmune|inflammatory|infectious|metabolic)\b",
        ],
        ContextCategory.RESISTANCE_CONTEXT: [
            r"\b(?:resistan(?:t|ce)|refractor(?:y|iness))\b",
            r"\b(?:non-?responder|non-?responsive)\b",
            r"\b(?:acquired\s+resistance|innate\s+resistance|de\s+novo\s+resistance)\b",
            r"\b(?:escape|evasion|bypass)\s+mechanism\b",
            r"\b(?:drug\s+efflux|ABC\s+transporter|P-?glycoprotein|MDR)\b",
            r"\b(?:mutation|variant)\s+(?:confer|mediate)\s+resistance\b",
        ],
        ContextCategory.BIOMARKER_CONTEXT: [
            r"\b(?:biomarker|marker|predictor|indicator)\b",
            r"\b(?:expression|level|status|positive|negative)\b",
            r"\b(?:HER2|EGFR|PD-?L1|Ki-?67|ER|PR|AR)\b",
            r"\b(?:mutation|amplification|overexpression|deletion)\b",
            r"\b(?:test(?:ed|ing)?|assay|IHC|FISH|PCR|NGS)\b",
            r"\b(?:predictive|prognostic|diagnostic)\s+(?:marker|value|significance)\b",
        ],
        ContextCategory.OUTCOME_CONTEXT: [
            r"\b(?:outcome|endpoint|response|efficacy|effectiveness)\b",
            r"\b(?:overall\s+survival|OS|progression-?free\s+survival|PFS)\b",
            r"\b(?:objective\s+response\s+rate|ORR|complete\s+response|CR)\b",
            r"\b(?:partial\s+response|PR|stable\s+disease|SD)\b",
            r"\b(?:disease\s+control\s+rate|DCR|duration\s+of\s+response|DOR)\b",
            r"\b(?:median|hazard\s+ratio|HR|confidence\s+interval|CI)\b",
            r"\b(?:time\s+to\s+progression|TTP|event-?free\s+survival|EFS)\b",
        ],
        ContextCategory.MECHANISM_CONTEXT: [
            r"\b(?:mechanism|mode)\s+of\s+action\b",
            r"\b(?:pathway|signal(?:ing)?|cascade)\b",
            r"\b(?:inhibit|block|activate|stimulate|modulate)\b",
            r"\b(?:receptor|ligand|substrate|enzyme|kinase)\b",
            r"\b(?:phosphorylation|ubiquitination|methylation)\b",
            r"\b(?:downstream|upstream|target|effector)\b",
            r"\b(?:MAPK|PI3K|AKT|mTOR|JAK|STAT|NF-?κB|Wnt)\b",
        ],
        ContextCategory.SAFETY_CONTEXT: [
            r"\b(?:safety|tolerability|toxicity|adverse)\b",
            r"\b(?:side\s+effect|AE|adverse\s+event|SAE|serious\s+adverse)\b",
            r"\b(?:discontinu(?:ed|ation)|withdraw(?:al|n))\b",
            r"\b(?:dose\s+(?:reduction|modification|limiting))\b",
            r"\b(?:grade\s+[1-5]|CTCAE)\b",
            r"\b(?:hepatotoxicity|nephrotoxicity|cardiotoxicity|neurotoxicity)\b",
            r"\b(?:nausea|vomiting|diarrhea|fatigue|neutropenia|thrombocytopenia)\b",
        ],
        ContextCategory.DOSING_CONTEXT: [
            r"\b(?:dose|dosage|dosing|administration)\b",
            r"\b\d+\s*(?:mg|g|mcg|µg|mL)(?:/(?:kg|m2|day|week))?\b",
            r"\b(?:once|twice|three\s+times)\s+(?:daily|weekly|monthly)\b",
            r"\b(?:QD|BID|TID|QOD|Q\d+[DWH])\b",
            r"\b(?:cycle|course|infusion|injection|bolus)\b",
            r"\b(?:loading|maintenance|maximum|recommended)\s+dose\b",
        ],
        ContextCategory.TRIAL_CONTEXT: [
            r"\b(?:clinical\s+trial|study|NCT\d+)\b",
            r"\b(?:phase\s+[I1|II2|III3|IV4])\b",
            r"\b(?:randomized|controlled|blinded|open-?label)\b",
            r"\b(?:arm|cohort|group|placebo|comparator)\b",
            r"\b(?:enroll(?:ed|ment)|recruit(?:ed|ment)|inclusion|exclusion)\b",
            r"\b(?:primary|secondary)\s+(?:endpoint|outcome)\b",
            r"\b(?:intent-?to-?treat|ITT|per-?protocol|PP)\b",
        ],
        ContextCategory.PRECLINICAL_CONTEXT: [
            r"\b(?:preclinical|pre-?clinical|nonclinical)\b",
            r"\b(?:in\s+vitro|in\s+vivo|ex\s+vivo|in\s+silico)\b",
            r"\b(?:cell\s+line|xenograft|PDX|organoid)\b",
            r"\b(?:mouse|murine|rat|rodent|animal)\s+(?:model|study)\b",
            r"\b(?:IC50|EC50|Ki|Kd|potency)\b",
            r"\b(?:assay|screen(?:ing)?|high-?throughput)\b",
        ],
        ContextCategory.PHARMACOLOGY_CONTEXT: [
            r"\b(?:pharmacokinetic|PK|pharmacodynamic|PD)\b",
            r"\b(?:absorption|distribution|metabolism|excretion|ADME)\b",
            r"\b(?:half-?life|t1/2|Cmax|AUC|clearance)\b",
            r"\b(?:bioavailability|protein\s+binding)\b",
            r"\b(?:CYP|P450|metabolite|metabolized)\b",
            r"\b(?:drug-?drug\s+interaction|DDI)\b",
        ],
        ContextCategory.DIAGNOSTIC_CONTEXT: [
            r"\b(?:diagnos(?:is|tic|ed)|detect(?:ion|ed))\b",
            r"\b(?:screening|surveillance|monitoring)\b",
            r"\b(?:biopsy|imaging|CT|MRI|PET|ultrasound)\b",
            r"\b(?:sensitivity|specificity|accuracy|PPV|NPV)\b",
            r"\b(?:staging|grading|classification)\b",
        ],
    }

    # Patient population patterns
    POPULATION_PATTERNS = {
        PatientPopulation.ADULT: [
            r"\b(?:adult|grown-?up)\s+patient",
            r"\b(?:age[d]?\s+)?(?:1[89]|[2-9]\d)\s+(?:year|yr)",
        ],
        PatientPopulation.PEDIATRIC: [
            r"\b(?:pediatric|paediatric|child(?:ren)?|adolescent)\b",
            r"\b(?:age[d]?\s+)?(?:[1-9]|1[0-7])\s+(?:year|yr)",
            r"\b(?:infant|neonate|newborn)\b",
        ],
        PatientPopulation.GERIATRIC: [
            r"\b(?:elderly|geriatric|older\s+adult)\b",
            r"\b(?:age[d]?\s+)?(?:6[5-9]|[7-9]\d)\s+(?:year|yr)",
        ],
        PatientPopulation.TREATMENT_NAIVE: [
            r"\b(?:treatment|therapy|chemo)?-?na[iï]ve\b",
            r"\b(?:untreated|previously\s+untreated)\b",
            r"\b(?:first|1st)\s+line\b",
            r"\b(?:no\s+prior|without\s+prior)\s+(?:therapy|treatment)\b",
        ],
        PatientPopulation.PREVIOUSLY_TREATED: [
            r"\b(?:previously|prior)\s+treated\b",
            r"\b(?:second|2nd|third|3rd)\s+line\b",
            r"\b(?:pre-?treated|prior\s+therapy)\b",
        ],
        PatientPopulation.REFRACTORY: [
            r"\b(?:refractory|resistant)\b",
            r"\b(?:non-?responder|failed)\b",
            r"\b(?:progression\s+on|progressed\s+after)\b",
        ],
        PatientPopulation.RELAPSED: [
            r"\b(?:relapsed|recurrent)\b",
            r"\b(?:relapse\s+after|recurrence\s+following)\b",
        ],
    }

    # Treatment setting patterns
    SETTING_PATTERNS = {
        TreatmentSetting.FIRST_LINE: [
            r"\b(?:first|1st)[\s-]?line\b",
            r"\b(?:front[\s-]?line|initial)\s+(?:therapy|treatment)\b",
        ],
        TreatmentSetting.SECOND_LINE: [
            r"\b(?:second|2nd)[\s-]?line\b",
        ],
        TreatmentSetting.THIRD_LINE_PLUS: [
            r"\b(?:third|3rd|fourth|4th|later)[\s-]?line\b",
            r"\b(?:heavily\s+pre-?treated)\b",
        ],
        TreatmentSetting.ADJUVANT: [
            r"\b(?:adjuvant)\b",
            r"\b(?:post-?(?:surgical|operative))\s+(?:therapy|treatment)\b",
        ],
        TreatmentSetting.NEOADJUVANT: [
            r"\b(?:neoadjuvant|pre-?operative)\b",
        ],
        TreatmentSetting.MAINTENANCE: [
            r"\b(?:maintenance)\s+(?:therapy|treatment)\b",
        ],
        TreatmentSetting.COMBINATION: [
            r"\b(?:combination|combined)\s+(?:therapy|treatment|regimen)\b",
            r"\b(?:plus|with|\+)\s+\w+(?:mab|nib)?\b",
        ],
        TreatmentSetting.MONOTHERAPY: [
            r"\b(?:monotherapy|single[\s-]?agent)\b",
        ],
    }

    # Disease stage patterns
    STAGE_PATTERNS = {
        DiseaseStage.EARLY: [
            r"\b(?:early|early-?stage|stage\s+[I1])\b",
        ],
        DiseaseStage.LOCALIZED: [
            r"\b(?:localized|local|confined)\b",
        ],
        DiseaseStage.LOCALLY_ADVANCED: [
            r"\b(?:locally\s+advanced|stage\s+III)\b",
            r"\b(?:unresectable|inoperable)\s+(?!metastatic)\b",
        ],
        DiseaseStage.METASTATIC: [
            r"\b(?:metastatic|metastases|mets|stage\s+IV)\b",
            r"\b(?:distant|spread|disseminated)\b",
        ],
        DiseaseStage.ADVANCED: [
            r"\b(?:advanced|late[\s-]?stage)\b",
        ],
        DiseaseStage.RECURRENT: [
            r"\b(?:recurrent|recurrence|relapsed)\b",
        ],
        DiseaseStage.PROGRESSIVE: [
            r"\b(?:progressive|progression|progressed)\b",
        ],
    }

    def __init__(self, confidence_threshold: float = 0.5, multi_label: bool = True):
        """
        Initialize the context tagger.

        Args:
            confidence_threshold: Minimum confidence for context assignment
            multi_label: Allow multiple context labels per segment
        """
        self.confidence_threshold = confidence_threshold
        self.multi_label = multi_label

        # Compile patterns
        self._context_patterns: dict[ContextCategory, list[re.Pattern]] = {}
        for context, patterns in self.CONTEXT_PATTERNS.items():
            self._context_patterns[context] = [re.compile(p, re.IGNORECASE) for p in patterns]

        self._population_patterns: dict[PatientPopulation, list[re.Pattern]] = {}
        for pop, patterns in self.POPULATION_PATTERNS.items():
            self._population_patterns[pop] = [re.compile(p, re.IGNORECASE) for p in patterns]

        self._setting_patterns: dict[TreatmentSetting, list[re.Pattern]] = {}
        for setting, patterns in self.SETTING_PATTERNS.items():
            self._setting_patterns[setting] = [re.compile(p, re.IGNORECASE) for p in patterns]

        self._stage_patterns: dict[DiseaseStage, list[re.Pattern]] = {}
        for stage, patterns in self.STAGE_PATTERNS.items():
            self._stage_patterns[stage] = [re.compile(p, re.IGNORECASE) for p in patterns]

        logger.info("ContextTagger initialized")

    def tag_text(self, text: str) -> list[ContextAnnotation]:
        """
        Tag text with context annotations.

        Args:
            text: Input text to tag

        Returns:
            List of context annotations
        """
        annotations = []

        # Split into sentences
        sentences = self._split_sentences(text)

        for start, end, sentence in sentences:
            # Detect contexts
            contexts = self._detect_contexts(sentence)

            if not contexts:
                continue

            # Sort by score
            contexts = sorted(contexts, key=lambda x: x[1], reverse=True)

            # Primary context
            primary_context = contexts[0][0]
            primary_confidence = contexts[0][1]

            # Secondary contexts (if multi-label)
            secondary_contexts = []
            if self.multi_label and len(contexts) > 1:
                secondary_contexts = [
                    c[0] for c in contexts[1:] if c[1] >= self.confidence_threshold
                ][:3]  # Max 3 secondary contexts

            # Detect additional attributes
            patient_pop = self._detect_population(sentence)
            treatment_setting = self._detect_setting(sentence)
            disease_stage = self._detect_stage(sentence)
            line_of_therapy = self._detect_line_of_therapy(sentence)

            annotation = ContextAnnotation(
                text=sentence,
                start=start,
                end=end,
                primary_context=primary_context,
                secondary_contexts=secondary_contexts,
                confidence=primary_confidence,
                patient_population=patient_pop,
                treatment_setting=treatment_setting,
                disease_stage=disease_stage,
                line_of_therapy=line_of_therapy,
                metadata={"all_contexts": [(c[0].value, c[1]) for c in contexts]},
            )
            annotations.append(annotation)

        return annotations

    def _split_sentences(self, text: str) -> list[tuple[int, int, str]]:
        """Split text into sentences with positions."""
        sentences = []
        pattern = re.compile(r"(?<=[.!?])\s+")

        start = 0
        for match in pattern.finditer(text):
            end = match.start() + 1
            sentence = text[start:end].strip()
            if sentence and len(sentence) > 10:
                sentences.append((start, end, sentence))
            start = match.end()

        # Add remaining text
        if start < len(text):
            sentence = text[start:].strip()
            if sentence and len(sentence) > 10:
                sentences.append((start, len(text), sentence))

        return sentences

    def _detect_contexts(self, text: str) -> list[tuple[ContextCategory, float]]:
        """Detect context categories in text."""
        scores: dict[ContextCategory, float] = {}

        for context, patterns in self._context_patterns.items():
            match_count = 0
            for pattern in patterns:
                matches = pattern.findall(text)
                match_count += len(matches)

            if match_count > 0:
                # Normalize score (max 1.0)
                score = min(1.0, match_count * 0.2 + 0.3)
                scores[context] = score

        # Return as sorted list
        return [(k, v) for k, v in scores.items()]

    def _detect_population(self, text: str) -> PatientPopulation | None:
        """Detect patient population from text."""
        for pop, patterns in self._population_patterns.items():
            for pattern in patterns:
                if pattern.search(text):
                    return pop
        return None

    def _detect_setting(self, text: str) -> TreatmentSetting | None:
        """Detect treatment setting from text."""
        for setting, patterns in self._setting_patterns.items():
            for pattern in patterns:
                if pattern.search(text):
                    return setting
        return None

    def _detect_stage(self, text: str) -> DiseaseStage | None:
        """Detect disease stage from text."""
        for stage, patterns in self._stage_patterns.items():
            for pattern in patterns:
                if pattern.search(text):
                    return stage
        return None

    def _detect_line_of_therapy(self, text: str) -> int | None:
        """Detect line of therapy from text."""
        patterns = [
            (r"\b(?:first|1st)[\s-]?line\b", 1),
            (r"\b(?:second|2nd)[\s-]?line\b", 2),
            (r"\b(?:third|3rd)[\s-]?line\b", 3),
            (r"\b(?:fourth|4th)[\s-]?line\b", 4),
            (r"\b(\d+)(?:st|nd|rd|th)[\s-]?line\b", None),
        ]

        text_lower = text.lower()
        for pattern, value in patterns:
            match = re.search(pattern, text_lower)
            if match:
                if value is not None:
                    return value
                else:
                    # Extract number from match
                    try:
                        return int(match.group(1))
                    except (ValueError, IndexError):
                        pass

        return None

    def tag_document(self, text: str, return_summary: bool = True) -> dict[str, Any]:
        """
        Tag entire document and return comprehensive analysis.

        Args:
            text: Document text
            return_summary: Whether to include summary statistics

        Returns:
            Dictionary with annotations and optional summary
        """
        annotations = self.tag_text(text)

        result = {
            "annotations": [a.to_dict() for a in annotations],
            "annotation_count": len(annotations),
        }

        if return_summary:
            # Count context categories
            context_counts: dict[str, int] = {}
            for ann in annotations:
                ctx = ann.primary_context.value
                context_counts[ctx] = context_counts.get(ctx, 0) + 1
                for sec in ann.secondary_contexts:
                    ctx = sec.value
                    context_counts[ctx] = context_counts.get(ctx, 0) + 1

            # Collect unique attributes
            populations = set()
            settings = set()
            stages = set()
            lines = set()

            for ann in annotations:
                if ann.patient_population:
                    populations.add(ann.patient_population.value)
                if ann.treatment_setting:
                    settings.add(ann.treatment_setting.value)
                if ann.disease_stage:
                    stages.add(ann.disease_stage.value)
                if ann.line_of_therapy:
                    lines.add(ann.line_of_therapy)

            result["summary"] = {
                "context_distribution": context_counts,
                "patient_populations": list(populations),
                "treatment_settings": list(settings),
                "disease_stages": list(stages),
                "lines_of_therapy": sorted(list(lines)) if lines else [],
            }

        return result

    def batch_tag(self, texts: list[str]) -> list[list[ContextAnnotation]]:
        """
        Tag multiple texts.

        Args:
            texts: List of input texts

        Returns:
            List of annotation lists
        """
        return [self.tag_text(text) for text in texts]


# Convenience functions
def get_default_tagger() -> ContextTagger:
    """Get a default context tagger."""
    return ContextTagger()


def tag_text(text: str) -> list[ContextAnnotation]:
    """Quick text tagging using default tagger."""
    tagger = get_default_tagger()
    return tagger.tag_text(text)


def tag_document(text: str) -> dict[str, Any]:
    """Quick document tagging using default tagger."""
    tagger = get_default_tagger()
    return tagger.tag_document(text)
