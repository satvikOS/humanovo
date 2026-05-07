"""
Clinical Trials Ingestion Agent

Specialized agent for ingesting clinical trial data from ClinicalTrials.gov
using their public API v2.
"""

import hashlib
from datetime import datetime
from typing import Any

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


class ClinicalTrialsConfig(IngestionConfig):
    """Configuration specific to ClinicalTrials.gov ingestion."""

    # Study status filters
    status_filter: list[str] = []  # RECRUITING, COMPLETED, ACTIVE_NOT_RECRUITING, etc.

    # Phase filters
    phase_filter: list[str] = []  # PHASE1, PHASE2, PHASE3, PHASE4, NA

    # Study type filters
    study_type_filter: list[str] = []  # INTERVENTIONAL, OBSERVATIONAL, etc.

    # Intervention type filters
    intervention_type_filter: list[str] = []  # DRUG, DEVICE, BIOLOGICAL, etc.

    # Geographic filters
    country_filter: list[str] = []
    state_filter: list[str] = []

    # Sponsor filters
    sponsor_filter: list[str] = []
    funder_type_filter: list[str] = []  # NIH, INDUSTRY, OTHER

    # Results availability
    has_results: bool | None = None

    # Age group filters
    age_group_filter: list[str] = []  # CHILD, ADULT, OLDER_ADULT

    # Sex filters
    sex_filter: str | None = None  # ALL, FEMALE, MALE

    # Sort options
    sort_by: str = "LastUpdatePostDate"  # StudyFirstPostDate, LastUpdatePostDate, etc.
    sort_order: str = "desc"


class ClinicalTrialsIngestionAgent(IngestionAgent):
    """
    Agent for ingesting clinical trial data from ClinicalTrials.gov.

    Uses the ClinicalTrials.gov API v2:
    - Studies endpoint for searching and fetching trials
    - Supports filtering by status, phase, intervention type, etc.
    """

    source_type = SourceType.CLINICAL_TRIALS
    description = "ClinicalTrials.gov clinical trial ingestion agent"

    API_BASE = "https://clinicaltrials.gov/api/v2"

    # Field list for API requests
    STUDY_FIELDS = [
        "NCTId",
        "BriefTitle",
        "OfficialTitle",
        "BriefSummary",
        "DetailedDescription",
        "Condition",
        "ConditionMeshTerm",
        "Keyword",
        "Phase",
        "StudyType",
        "OverallStatus",
        "StartDate",
        "PrimaryCompletionDate",
        "CompletionDate",
        "StudyFirstPostDate",
        "LastUpdatePostDate",
        "EnrollmentCount",
        "EnrollmentType",
        "LeadSponsorName",
        "LeadSponsorClass",
        "CollaboratorName",
        "InterventionName",
        "InterventionType",
        "InterventionDescription",
        "ArmGroupLabel",
        "ArmGroupDescription",
        "PrimaryOutcomeMeasure",
        "PrimaryOutcomeDescription",
        "SecondaryOutcomeMeasure",
        "EligibilityCriteria",
        "Gender",
        "MinimumAge",
        "MaximumAge",
        "HealthyVolunteers",
        "LocationFacility",
        "LocationCity",
        "LocationState",
        "LocationCountry",
        "ResponsiblePartyInvestigatorFullName",
        "ResponsiblePartyInvestigatorAffiliation",
        "PointOfContactEMail",
    ]

    def __init__(
        self,
        config: ClinicalTrialsConfig | None = None,
        **kwargs,
    ):
        config = config or ClinicalTrialsConfig()
        super().__init__(config=config, **kwargs)
        self.ct_config: ClinicalTrialsConfig = config
        self._session: httpx.AsyncClient | None = None

    async def _get_session(self) -> httpx.AsyncClient:
        """Get or create the SSRF-allowlisted httpx client."""
        if self._session is None:
            self._session = make_httpx_client(timeout=60.0, follow_redirects=True)
        return self._session

    async def _close_session(self) -> None:
        """Close the httpx client."""
        if self._session is not None:
            await self._session.aclose()
            self._session = None

    def _build_query_params(
        self,
        query: str,
        page_token: str | None = None,
        page_size: int = 100,
    ) -> dict[str, Any]:
        """Build API query parameters."""
        params = {
            "format": "json",
            "pageSize": min(page_size, 1000),  # API max is 1000
            "fields": ",".join(self.STUDY_FIELDS),
        }

        # Add search query
        if query:
            params["query.term"] = query

        # Add page token for pagination
        if page_token:
            params["pageToken"] = page_token

        # Status filter
        if self.ct_config.status_filter:
            params["filter.overallStatus"] = ",".join(self.ct_config.status_filter)

        # Phase filter
        if self.ct_config.phase_filter:
            params["filter.phase"] = ",".join(self.ct_config.phase_filter)

        # Study type filter
        if self.ct_config.study_type_filter:
            params["filter.studyType"] = ",".join(self.ct_config.study_type_filter)

        # Has results filter
        if self.ct_config.has_results is not None:
            params["filter.resultsFirstPostDate"] = "MIN" if self.ct_config.has_results else ""

        # Geographic filters
        if self.ct_config.country_filter:
            params["filter.geo"] = ",".join(f"country:{c}" for c in self.ct_config.country_filter)

        # Age group filter
        if self.ct_config.age_group_filter:
            params["filter.eligibility.stdAge"] = ",".join(self.ct_config.age_group_filter)

        # Sex filter
        if self.ct_config.sex_filter:
            params["filter.eligibility.sex"] = self.ct_config.sex_filter

        # Funder type filter
        if self.ct_config.funder_type_filter:
            params["filter.sponsor.type"] = ",".join(self.ct_config.funder_type_filter)

        # Date range
        if self.ct_config.date_from:
            params["filter.lastUpdatePostDate"] = (
                f"{self.ct_config.date_from.strftime('%Y-%m-%d')}_"
            )
        if self.ct_config.date_to:
            if "filter.lastUpdatePostDate" in params:
                params["filter.lastUpdatePostDate"] += self.ct_config.date_to.strftime("%Y-%m-%d")
            else:
                params["filter.lastUpdatePostDate"] = (
                    f"_{self.ct_config.date_to.strftime('%Y-%m-%d')}"
                )

        # Sorting
        params["sort"] = f"{self.ct_config.sort_by}:{self.ct_config.sort_order}"

        return params

    async def _search_studies(
        self,
        query: str,
        page_token: str | None = None,
        page_size: int = 100,
    ) -> tuple[list[dict[str, Any]], str | None, int]:
        """
        Search for clinical trials.

        Returns:
            Tuple of (studies, next_page_token, total_count)
        """
        await self._rate_limit()
        session = await self._get_session()

        params = self._build_query_params(query, page_token, page_size)
        url = f"{self.API_BASE}/studies"

        try:
            response = await session.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            self.state.metrics.api_calls_made += 1

            studies = data.get("studies", [])
            next_token = data.get("nextPageToken")
            total_count = data.get("totalCount", 0)

            return studies, next_token, total_count

        except httpx.HTTPError as e:
            self.logger.error("ClinicalTrials.gov API error", error=str(e))
            raise

    def _parse_date(self, date_info: dict[str, Any] | None) -> datetime | None:
        """Parse date from API response."""
        if not date_info:
            return None

        date_str = date_info.get("date")
        if not date_str:
            return None

        try:
            # API returns dates in various formats
            for fmt in ["%Y-%m-%d", "%Y-%m", "%Y"]:
                try:
                    return datetime.strptime(date_str, fmt)
                except ValueError:
                    continue
        except Exception:
            pass

        return None

    def _extract_nested_value(
        self,
        data: dict[str, Any],
        *keys: str,
        default: Any = None,
    ) -> Any:
        """Safely extract nested values from API response."""
        current = data
        for key in keys:
            if isinstance(current, dict):
                current = current.get(key, default)
            elif isinstance(current, list) and current:
                current = current[0].get(key, default) if isinstance(current[0], dict) else default
            else:
                return default
        return current if current is not None else default

    def _study_to_record(
        self,
        study: dict[str, Any],
    ) -> IngestionRecord:
        """Convert API study response to IngestionRecord."""
        protocol = study.get("protocolSection", {})
        identification = protocol.get("identificationModule", {})
        description = protocol.get("descriptionModule", {})
        status_module = protocol.get("statusModule", {})
        sponsor_module = protocol.get("sponsorCollaboratorsModule", {})
        design_module = protocol.get("designModule", {})
        arms_module = protocol.get("armsInterventionsModule", {})
        outcomes_module = protocol.get("outcomesModule", {})
        eligibility_module = protocol.get("eligibilityModule", {})
        contacts_module = protocol.get("contactsLocationsModule", {})
        conditions_module = protocol.get("conditionsModule", {})

        nct_id = identification.get("nctId", "")
        query_hash = hashlib.md5(self.config.query.encode()).hexdigest()[:8]

        # Extract title
        title = identification.get("officialTitle") or identification.get("briefTitle", "")

        # Extract abstract/summary
        brief_summary = description.get("briefSummary", "")
        detailed_desc = description.get("detailedDescription", "")
        abstract = brief_summary
        if detailed_desc:
            abstract = f"{brief_summary}\n\n{detailed_desc}"

        # Extract conditions
        conditions = conditions_module.get("conditions", [])
        mesh_terms = conditions_module.get("conditionMeshTerms", [])
        keywords = conditions_module.get("keywords", [])

        # Extract interventions
        interventions = []
        for intervention in arms_module.get("interventions", []):
            interventions.append(
                {
                    "name": intervention.get("name"),
                    "type": intervention.get("type"),
                    "description": intervention.get("description"),
                }
            )

        # Extract outcomes
        primary_outcomes = []
        for outcome in outcomes_module.get("primaryOutcomes", []):
            primary_outcomes.append(
                {
                    "measure": outcome.get("measure"),
                    "description": outcome.get("description"),
                    "time_frame": outcome.get("timeFrame"),
                }
            )

        # Extract sponsor info
        lead_sponsor = sponsor_module.get("leadSponsor", {})
        collaborators = sponsor_module.get("collaborators", [])

        # Extract locations
        locations = []
        for location in contacts_module.get("locations", []):
            locations.append(
                {
                    "facility": location.get("facility"),
                    "city": location.get("city"),
                    "state": location.get("state"),
                    "country": location.get("country"),
                }
            )

        # Extract eligibility
        eligibility = {
            "criteria": eligibility_module.get("eligibilityCriteria"),
            "gender": eligibility_module.get("sex"),
            "min_age": eligibility_module.get("minimumAge"),
            "max_age": eligibility_module.get("maximumAge"),
            "healthy_volunteers": eligibility_module.get("healthyVolunteers"),
        }

        # Parse dates
        start_date = self._parse_date(status_module.get("startDateStruct"))
        completion_date = self._parse_date(status_module.get("completionDateStruct"))
        last_update = self._parse_date(status_module.get("lastUpdatePostDateStruct"))

        # Build URL
        url = f"https://clinicaltrials.gov/study/{nct_id}"

        return IngestionRecord(
            record_id=f"ct_{nct_id}_{query_hash}",
            source_type=SourceType.CLINICAL_TRIALS,
            source_id=nct_id,
            title=title,
            abstract=abstract,
            authors=[lead_sponsor.get("name", "Unknown Sponsor")],
            publication_date=last_update or start_date,
            url=url,
            keywords=list(set(conditions + keywords)),
            metadata={
                "nct_id": nct_id,
                "status": status_module.get("overallStatus"),
                "phase": design_module.get("phases", []),
                "study_type": design_module.get("studyType"),
                "enrollment": design_module.get("enrollmentInfo", {}).get("count"),
                "start_date": start_date.isoformat() if start_date else None,
                "completion_date": completion_date.isoformat() if completion_date else None,
                "lead_sponsor": lead_sponsor,
                "collaborators": [c.get("name") for c in collaborators],
                "interventions": interventions,
                "primary_outcomes": primary_outcomes,
                "eligibility": eligibility,
                "locations": locations[:10],  # Limit to first 10
                "conditions": conditions,
                "mesh_terms": mesh_terms,
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
        Fetch a batch of clinical trials.

        Args:
            query: Search query
            offset: Not used (API uses page tokens)
            limit: Maximum records to fetch

        Returns:
            Tuple of (records, next_page_token)
        """
        page_token = kwargs.get("page_token")

        studies, next_token, total_count = await self._search_studies(
            query=query,
            page_token=page_token,
            page_size=limit,
        )

        self.logger.info(
            "ClinicalTrials.gov search results",
            studies_found=len(studies),
            total_count=total_count,
        )

        records = []
        for study in studies:
            try:
                record = self._study_to_record(study)
                records.append(record)
            except Exception as e:
                self.logger.warning("Failed to parse study", error=str(e))
                continue

        return records, next_token

    async def fetch_by_id(self, source_id: str) -> IngestionRecord | None:
        """
        Fetch a specific clinical trial by NCT ID.

        Args:
            source_id: NCT ID (e.g., NCT12345678)

        Returns:
            IngestionRecord or None
        """
        nct_id = source_id.upper()
        if not nct_id.startswith("NCT"):
            nct_id = f"NCT{nct_id}"

        await self._rate_limit()
        session = await self._get_session()

        url = f"{self.API_BASE}/studies/{nct_id}"
        params = {
            "format": "json",
            "fields": ",".join(self.STUDY_FIELDS),
        }

        try:
            response = await session.get(url, params=params)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            data = response.json()

            self.state.metrics.api_calls_made += 1

            return self._study_to_record(data)

        except httpx.HTTPError as e:
            self.logger.error("Failed to fetch study", nct_id=nct_id, error=str(e))
            return None

    async def fetch_by_condition(
        self,
        condition: str,
        max_results: int = 100,
    ) -> list[IngestionRecord]:
        """
        Fetch trials for a specific condition.

        Args:
            condition: Medical condition to search for
            max_results: Maximum trials to fetch

        Returns:
            List of IngestionRecords
        """
        # Use condition-specific query
        query = f"AREA[Condition]{condition}"
        records, _ = await self.fetch_batch(query=query, limit=max_results)
        return records

    async def fetch_by_intervention(
        self,
        intervention: str,
        intervention_type: str | None = None,
        max_results: int = 100,
    ) -> list[IngestionRecord]:
        """
        Fetch trials for a specific intervention.

        Args:
            intervention: Intervention name (drug, device, etc.)
            intervention_type: Type filter (DRUG, DEVICE, BIOLOGICAL, etc.)
            max_results: Maximum trials to fetch

        Returns:
            List of IngestionRecords
        """
        query = f"AREA[InterventionName]{intervention}"
        if intervention_type:
            self.ct_config.intervention_type_filter = [intervention_type]

        records, _ = await self.fetch_batch(query=query, limit=max_results)
        return records

    async def fetch_recruiting(
        self,
        query: str,
        max_results: int = 100,
    ) -> list[IngestionRecord]:
        """
        Fetch currently recruiting trials.

        Args:
            query: Search query
            max_results: Maximum trials to fetch

        Returns:
            List of recruiting trials
        """
        # Set status filter to recruiting
        original_status = self.ct_config.status_filter
        self.ct_config.status_filter = ["RECRUITING"]

        try:
            records, _ = await self.fetch_batch(query=query, limit=max_results)
            return records
        finally:
            self.ct_config.status_filter = original_status

    async def close(self) -> None:
        """Close resources."""
        await self._close_session()
