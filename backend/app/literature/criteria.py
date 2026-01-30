"""
Inclusion/Exclusion Criteria for Literature Selection

Defines and applies selection criteria:
- Inclusion criteria (what to include)
- Exclusion criteria (what to exclude)
- Quality filters
- Language filters
- Date ranges
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Dict, List, Optional, Any, Callable, Set

from .sources import LiteratureRecord, SourceType

logger = logging.getLogger(__name__)


class CriterionType(str, Enum):
    """Types of selection criteria."""
    DATE_RANGE = "date_range"
    LANGUAGE = "language"
    SOURCE_TYPE = "source_type"
    KEYWORD_PRESENCE = "keyword_presence"
    KEYWORD_ABSENCE = "keyword_absence"
    PUBLICATION_TYPE = "publication_type"
    QUALITY_SCORE = "quality_score"
    CITATION_COUNT = "citation_count"
    AUTHOR_AFFILIATION = "author_affiliation"
    JOURNAL_LIST = "journal_list"
    STUDY_DESIGN = "study_design"
    CUSTOM = "custom"


@dataclass
class Criterion:
    """A single selection criterion."""
    criterion_type: CriterionType
    name: str
    description: str
    parameters: Dict[str, Any] = field(default_factory=dict)
    required: bool = True  # Required for inclusion
    weight: float = 1.0  # For weighted scoring

    def to_dict(self) -> Dict[str, Any]:
        return {
            "criterion_type": self.criterion_type.value,
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
            "required": self.required,
            "weight": self.weight
        }


@dataclass
class CriterionResult:
    """Result of applying a criterion."""
    criterion_name: str
    passed: bool
    reason: str
    score: float = 1.0  # 0-1, 1 = fully passed

    def to_dict(self) -> Dict[str, Any]:
        return {
            "criterion_name": self.criterion_name,
            "passed": self.passed,
            "reason": self.reason,
            "score": self.score
        }


@dataclass
class SelectionResult:
    """Result of selection process for a record."""
    record_id: str
    included: bool
    inclusion_results: List[CriterionResult] = field(default_factory=list)
    exclusion_results: List[CriterionResult] = field(default_factory=list)
    overall_score: float = 0.0
    decision_reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "record_id": self.record_id,
            "included": self.included,
            "inclusion_results": [r.to_dict() for r in self.inclusion_results],
            "exclusion_results": [r.to_dict() for r in self.exclusion_results],
            "overall_score": self.overall_score,
            "decision_reason": self.decision_reason
        }


class InclusionCriteria:
    """
    Defines inclusion criteria for literature selection.

    Records must meet ALL required criteria to be included.
    Optional criteria contribute to scoring.
    """

    def __init__(self):
        """Initialize inclusion criteria."""
        self.criteria: List[Criterion] = []
        self._evaluators: Dict[CriterionType, Callable] = {}
        self._setup_evaluators()

    def _setup_evaluators(self):
        """Setup criterion evaluators."""
        self._evaluators = {
            CriterionType.DATE_RANGE: self._evaluate_date_range,
            CriterionType.LANGUAGE: self._evaluate_language,
            CriterionType.SOURCE_TYPE: self._evaluate_source_type,
            CriterionType.KEYWORD_PRESENCE: self._evaluate_keyword_presence,
            CriterionType.PUBLICATION_TYPE: self._evaluate_publication_type,
            CriterionType.CITATION_COUNT: self._evaluate_citation_count,
            CriterionType.JOURNAL_LIST: self._evaluate_journal_list,
            CriterionType.STUDY_DESIGN: self._evaluate_study_design,
        }

    def add_date_range(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        required: bool = True
    ):
        """Add date range criterion."""
        self.criteria.append(Criterion(
            criterion_type=CriterionType.DATE_RANGE,
            name="Date Range",
            description=f"Publication date between {start_date} and {end_date}",
            parameters={"start_date": start_date, "end_date": end_date},
            required=required
        ))

    def add_language(
        self,
        languages: List[str],
        required: bool = True
    ):
        """Add language criterion."""
        self.criteria.append(Criterion(
            criterion_type=CriterionType.LANGUAGE,
            name="Language",
            description=f"Language must be one of: {languages}",
            parameters={"languages": languages},
            required=required
        ))

    def add_source_types(
        self,
        source_types: List[SourceType],
        required: bool = True
    ):
        """Add source type criterion."""
        self.criteria.append(Criterion(
            criterion_type=CriterionType.SOURCE_TYPE,
            name="Source Type",
            description=f"Source type must be one of: {[s.value for s in source_types]}",
            parameters={"source_types": source_types},
            required=required
        ))

    def add_keyword_requirement(
        self,
        keywords: List[str],
        match_any: bool = True,
        case_sensitive: bool = False,
        required: bool = True
    ):
        """Add keyword presence criterion."""
        mode = "any" if match_any else "all"
        self.criteria.append(Criterion(
            criterion_type=CriterionType.KEYWORD_PRESENCE,
            name="Required Keywords",
            description=f"Must contain {mode} of: {keywords}",
            parameters={
                "keywords": keywords,
                "match_any": match_any,
                "case_sensitive": case_sensitive
            },
            required=required
        ))

    def add_minimum_citations(
        self,
        min_citations: int,
        required: bool = False
    ):
        """Add minimum citation criterion."""
        self.criteria.append(Criterion(
            criterion_type=CriterionType.CITATION_COUNT,
            name="Minimum Citations",
            description=f"Must have at least {min_citations} citations",
            parameters={"min_citations": min_citations},
            required=required
        ))

    def add_journal_list(
        self,
        journals: List[str],
        include: bool = True,
        required: bool = False
    ):
        """Add journal list criterion."""
        mode = "include" if include else "exclude"
        self.criteria.append(Criterion(
            criterion_type=CriterionType.JOURNAL_LIST,
            name="Journal List",
            description=f"Journal must be in list (mode: {mode})",
            parameters={"journals": journals, "include": include},
            required=required
        ))

    def add_study_design(
        self,
        designs: List[str],
        required: bool = False
    ):
        """Add study design criterion."""
        self.criteria.append(Criterion(
            criterion_type=CriterionType.STUDY_DESIGN,
            name="Study Design",
            description=f"Study design must be one of: {designs}",
            parameters={"designs": designs},
            required=required
        ))

    def evaluate(self, record: LiteratureRecord) -> List[CriterionResult]:
        """
        Evaluate a record against all inclusion criteria.

        Args:
            record: Record to evaluate

        Returns:
            List of CriterionResults
        """
        results = []
        for criterion in self.criteria:
            evaluator = self._evaluators.get(criterion.criterion_type)
            if evaluator:
                result = evaluator(record, criterion)
            else:
                result = CriterionResult(
                    criterion_name=criterion.name,
                    passed=True,
                    reason="No evaluator available"
                )
            results.append(result)
        return results

    def _evaluate_date_range(
        self,
        record: LiteratureRecord,
        criterion: Criterion
    ) -> CriterionResult:
        """Evaluate date range criterion."""
        start_date = criterion.parameters.get("start_date")
        end_date = criterion.parameters.get("end_date")
        pub_date = record.publication_date

        if pub_date is None:
            return CriterionResult(
                criterion_name=criterion.name,
                passed=False,
                reason="No publication date",
                score=0.0
            )

        if start_date and pub_date < start_date:
            return CriterionResult(
                criterion_name=criterion.name,
                passed=False,
                reason=f"Publication date {pub_date} before {start_date}",
                score=0.0
            )

        if end_date and pub_date > end_date:
            return CriterionResult(
                criterion_name=criterion.name,
                passed=False,
                reason=f"Publication date {pub_date} after {end_date}",
                score=0.0
            )

        return CriterionResult(
            criterion_name=criterion.name,
            passed=True,
            reason="Within date range",
            score=1.0
        )

    def _evaluate_language(
        self,
        record: LiteratureRecord,
        criterion: Criterion
    ) -> CriterionResult:
        """Evaluate language criterion."""
        allowed = criterion.parameters.get("languages", ["en"])
        if record.language.lower() in [l.lower() for l in allowed]:
            return CriterionResult(
                criterion_name=criterion.name,
                passed=True,
                reason=f"Language {record.language} is allowed",
                score=1.0
            )
        return CriterionResult(
            criterion_name=criterion.name,
            passed=False,
            reason=f"Language {record.language} not in {allowed}",
            score=0.0
        )

    def _evaluate_source_type(
        self,
        record: LiteratureRecord,
        criterion: Criterion
    ) -> CriterionResult:
        """Evaluate source type criterion."""
        allowed = criterion.parameters.get("source_types", [])
        if record.source_type in allowed:
            return CriterionResult(
                criterion_name=criterion.name,
                passed=True,
                reason=f"Source type {record.source_type.value} is allowed",
                score=1.0
            )
        return CriterionResult(
            criterion_name=criterion.name,
            passed=False,
            reason=f"Source type {record.source_type.value} not allowed",
            score=0.0
        )

    def _evaluate_keyword_presence(
        self,
        record: LiteratureRecord,
        criterion: Criterion
    ) -> CriterionResult:
        """Evaluate keyword presence criterion."""
        keywords = criterion.parameters.get("keywords", [])
        match_any = criterion.parameters.get("match_any", True)
        case_sensitive = criterion.parameters.get("case_sensitive", False)

        text = record.get_text()
        if not case_sensitive:
            text = text.lower()
            keywords = [k.lower() for k in keywords]

        matches = [k for k in keywords if k in text]

        if match_any:
            passed = len(matches) > 0
            score = len(matches) / len(keywords) if keywords else 0
        else:
            passed = len(matches) == len(keywords)
            score = 1.0 if passed else len(matches) / len(keywords)

        return CriterionResult(
            criterion_name=criterion.name,
            passed=passed,
            reason=f"Matched {len(matches)}/{len(keywords)} keywords",
            score=score
        )

    def _evaluate_publication_type(
        self,
        record: LiteratureRecord,
        criterion: Criterion
    ) -> CriterionResult:
        """Evaluate publication type criterion."""
        # Simplified - would need more metadata in real implementation
        return CriterionResult(
            criterion_name=criterion.name,
            passed=True,
            reason="Publication type check passed",
            score=1.0
        )

    def _evaluate_citation_count(
        self,
        record: LiteratureRecord,
        criterion: Criterion
    ) -> CriterionResult:
        """Evaluate citation count criterion."""
        min_citations = criterion.parameters.get("min_citations", 0)
        if record.citations >= min_citations:
            return CriterionResult(
                criterion_name=criterion.name,
                passed=True,
                reason=f"Citations {record.citations} >= {min_citations}",
                score=1.0
            )
        return CriterionResult(
            criterion_name=criterion.name,
            passed=False,
            reason=f"Citations {record.citations} < {min_citations}",
            score=record.citations / min_citations if min_citations > 0 else 0
        )

    def _evaluate_journal_list(
        self,
        record: LiteratureRecord,
        criterion: Criterion
    ) -> CriterionResult:
        """Evaluate journal list criterion."""
        journals = criterion.parameters.get("journals", [])
        include_mode = criterion.parameters.get("include", True)

        if not record.journal:
            return CriterionResult(
                criterion_name=criterion.name,
                passed=not include_mode,  # Pass if exclude mode
                reason="No journal specified",
                score=0.5
            )

        journal_lower = record.journal.lower()
        journals_lower = [j.lower() for j in journals]
        in_list = any(j in journal_lower for j in journals_lower)

        if include_mode:
            passed = in_list
            reason = "Journal in list" if passed else "Journal not in list"
        else:
            passed = not in_list
            reason = "Journal not in exclude list" if passed else "Journal in exclude list"

        return CriterionResult(
            criterion_name=criterion.name,
            passed=passed,
            reason=reason,
            score=1.0 if passed else 0.0
        )

    def _evaluate_study_design(
        self,
        record: LiteratureRecord,
        criterion: Criterion
    ) -> CriterionResult:
        """Evaluate study design criterion."""
        designs = criterion.parameters.get("designs", [])
        text = record.get_text().lower()

        for design in designs:
            if design.lower() in text:
                return CriterionResult(
                    criterion_name=criterion.name,
                    passed=True,
                    reason=f"Study design '{design}' found",
                    score=1.0
                )

        return CriterionResult(
            criterion_name=criterion.name,
            passed=False,
            reason="No matching study design found",
            score=0.0
        )


class ExclusionCriteria:
    """
    Defines exclusion criteria for literature selection.

    Records matching ANY exclusion criterion are excluded.
    """

    def __init__(self):
        """Initialize exclusion criteria."""
        self.criteria: List[Criterion] = []

    def add_keyword_exclusion(
        self,
        keywords: List[str],
        case_sensitive: bool = False
    ):
        """Add keyword exclusion criterion."""
        self.criteria.append(Criterion(
            criterion_type=CriterionType.KEYWORD_ABSENCE,
            name="Excluded Keywords",
            description=f"Must NOT contain: {keywords}",
            parameters={
                "keywords": keywords,
                "case_sensitive": case_sensitive
            },
            required=True
        ))

    def add_retracted_exclusion(self):
        """Add retracted paper exclusion."""
        self.criteria.append(Criterion(
            criterion_type=CriterionType.CUSTOM,
            name="Retracted Papers",
            description="Exclude retracted papers",
            parameters={"check": "retracted"},
            required=True
        ))

    def add_non_human_exclusion(self):
        """Add non-human studies exclusion."""
        self.criteria.append(Criterion(
            criterion_type=CriterionType.KEYWORD_ABSENCE,
            name="Non-Human Studies",
            description="Exclude animal-only studies",
            parameters={
                "keywords": ["mouse model only", "rat study", "in vitro only"],
                "case_sensitive": False
            },
            required=True
        ))

    def add_review_exclusion(self, exclude: bool = False):
        """Add review article exclusion (optional)."""
        if exclude:
            self.criteria.append(Criterion(
                criterion_type=CriterionType.PUBLICATION_TYPE,
                name="Review Articles",
                description="Exclude review articles",
                parameters={"exclude_types": ["review", "systematic review"]},
                required=True
            ))

    def evaluate(self, record: LiteratureRecord) -> List[CriterionResult]:
        """
        Evaluate a record against all exclusion criteria.

        Args:
            record: Record to evaluate

        Returns:
            List of CriterionResults (passed=True means SHOULD BE EXCLUDED)
        """
        results = []
        text = record.get_text().lower()

        for criterion in self.criteria:
            if criterion.criterion_type == CriterionType.KEYWORD_ABSENCE:
                keywords = criterion.parameters.get("keywords", [])
                case_sensitive = criterion.parameters.get("case_sensitive", False)

                search_text = text if not case_sensitive else record.get_text()
                search_keywords = keywords if case_sensitive else [k.lower() for k in keywords]

                found = [k for k in search_keywords if k in search_text]
                if found:
                    results.append(CriterionResult(
                        criterion_name=criterion.name,
                        passed=True,  # True = should exclude
                        reason=f"Found excluded keywords: {found}",
                        score=1.0
                    ))
                else:
                    results.append(CriterionResult(
                        criterion_name=criterion.name,
                        passed=False,  # False = keep
                        reason="No excluded keywords found",
                        score=0.0
                    ))

            elif criterion.criterion_type == CriterionType.CUSTOM:
                check = criterion.parameters.get("check")
                if check == "retracted":
                    is_retracted = "retract" in text or record.metadata.get("retracted", False)
                    results.append(CriterionResult(
                        criterion_name=criterion.name,
                        passed=is_retracted,
                        reason="Retracted" if is_retracted else "Not retracted",
                        score=1.0 if is_retracted else 0.0
                    ))

        return results


class SelectionEngine:
    """
    Combines inclusion and exclusion criteria for selection.

    Workflow:
    1. Check exclusion criteria (any match -> exclude)
    2. Check inclusion criteria (must meet required)
    3. Calculate overall score
    """

    def __init__(
        self,
        inclusion_criteria: Optional[InclusionCriteria] = None,
        exclusion_criteria: Optional[ExclusionCriteria] = None
    ):
        """
        Initialize selection engine.

        Args:
            inclusion_criteria: Inclusion criteria
            exclusion_criteria: Exclusion criteria
        """
        self.inclusion_criteria = inclusion_criteria or InclusionCriteria()
        self.exclusion_criteria = exclusion_criteria or ExclusionCriteria()

    def select(self, record: LiteratureRecord) -> SelectionResult:
        """
        Apply selection criteria to a record.

        Args:
            record: Record to evaluate

        Returns:
            SelectionResult
        """
        result = SelectionResult(record_id=record.record_id)

        # Step 1: Check exclusion criteria
        exclusion_results = self.exclusion_criteria.evaluate(record)
        result.exclusion_results = exclusion_results

        # If any exclusion criterion passed (found match), exclude
        excluded = any(r.passed for r in exclusion_results)
        if excluded:
            result.included = False
            result.decision_reason = "Matched exclusion criteria: " + ", ".join(
                r.criterion_name for r in exclusion_results if r.passed
            )
            return result

        # Step 2: Check inclusion criteria
        inclusion_results = self.inclusion_criteria.evaluate(record)
        result.inclusion_results = inclusion_results

        # Check required criteria
        required_criteria = [
            c for c in self.inclusion_criteria.criteria if c.required
        ]
        required_results = [
            r for r in inclusion_results
            if r.criterion_name in [c.name for c in required_criteria]
        ]

        all_required_passed = all(r.passed for r in required_results)

        if not all_required_passed:
            result.included = False
            failed = [r.criterion_name for r in required_results if not r.passed]
            result.decision_reason = f"Failed required criteria: {failed}"
            return result

        # Step 3: Calculate overall score
        total_weight = sum(
            c.weight for c in self.inclusion_criteria.criteria
        )
        weighted_score = sum(
            r.score * c.weight
            for r, c in zip(inclusion_results, self.inclusion_criteria.criteria)
        )
        result.overall_score = weighted_score / total_weight if total_weight > 0 else 0

        result.included = True
        result.decision_reason = f"Passed all criteria, score: {result.overall_score:.2f}"

        return result

    def batch_select(
        self,
        records: List[LiteratureRecord]
    ) -> Dict[str, Any]:
        """
        Apply selection to multiple records.

        Args:
            records: List of records

        Returns:
            Dictionary with results and statistics
        """
        results = []
        included = []
        excluded = []

        for record in records:
            result = self.select(record)
            results.append(result)

            if result.included:
                included.append(record)
            else:
                excluded.append((record, result.decision_reason))

        return {
            "total": len(records),
            "included": len(included),
            "excluded": len(excluded),
            "inclusion_rate": len(included) / len(records) if records else 0,
            "results": [r.to_dict() for r in results],
            "included_records": included,
            "exclusion_reasons": {
                r.record_id: reason for r, reason in excluded
            }
        }
