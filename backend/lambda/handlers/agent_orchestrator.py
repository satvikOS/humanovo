"""
Agent Orchestrator Lambda Handler - Multi-model AI discovery system.

Handles the /orchestrator/* endpoints for the discovery page.
Uses AWS Bedrock Converse API (4 models) and Azure OpenAI (2 models)
for a total of 6 models running in parallel with different roles.
Model identities are never exposed to the frontend (unbiasing).
"""

print("[ORCHESTRATOR] Module loading...")

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

import logging

import boto3
from botocore.config import Config as BotoConfig

# Defensive powertools imports — Lambda must NEVER crash on cold start
try:
    from aws_lambda_powertools import Logger, Metrics
    from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
    from aws_lambda_powertools.utilities.typing import LambdaContext
    logger = Logger()
    metrics = Metrics()
except ImportError as _import_err:
    # Fallback if powertools layer is missing or incompatible
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    from collections import namedtuple
    logger = logging.getLogger("agent_orchestrator")
    logger.setLevel(logging.DEBUG)

    # Minimal stub for APIGatewayHttpResolver
    class APIGatewayHttpResolver:
        """Stub resolver when powertools is unavailable."""
        def __init__(self):
            self._routes = {}
            self.current_event = None
        def get(self, path):
            def decorator(func):
                self._routes[("GET", path)] = func
                return func
            return decorator
        def post(self, path):
            def decorator(func):
                self._routes[("POST", path)] = func
                return func
            return decorator
        def resolve(self, event, context):
            method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
            path = event.get("rawPath", "")
            handler_fn = self._routes.get((method, path))
            if handler_fn:
                self.current_event = type("Event", (), {"json_body": json.loads(event.get("body", "{}") or "{}")})()
                result = handler_fn()
                if isinstance(result, dict):
                    return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps(result, cls=DecimalEncoder)}
                return result
            return {"statusCode": 404, "body": "Not Found"}

    class Response:
        def __init__(self, status_code=200, body="", content_type="application/json", headers=None):
            self.status_code = status_code
            self.body = body
            self.content_type = content_type

    LambdaContext = object

    class _NoopMetrics:
        def add_metric(self, **kwargs): pass
    metrics = _NoopMetrics()

app = APIGatewayHttpResolver()
print(f"[ORCHESTRATOR] App initialized, type={type(app).__name__}")

# AWS Clients — defensive init to prevent cold start crashes
try:
    dynamodb = boto3.resource("dynamodb")
except Exception as _e:
    logger.error(f"DynamoDB init failed: {_e}")
    dynamodb = None

try:
    bedrock_runtime = boto3.client("bedrock-runtime", config=BotoConfig(
        read_timeout=120, connect_timeout=10, retries={"max_attempts": 2}
    ))
except Exception as _e:
    logger.error(f"Bedrock init failed: {_e}")
    bedrock_runtime = None

# Separate client with extended timeout for paper generation (long inference)
try:
    bedrock_long = boto3.client("bedrock-runtime", config=BotoConfig(
        read_timeout=600, connect_timeout=10, retries={"max_attempts": 1}
    ))
except Exception as _e:
    logger.error(f"Bedrock long-timeout init failed: {_e}")
    bedrock_long = None

try:
    lambda_client = boto3.client("lambda")
except Exception as _e:
    logger.error(f"Lambda client init failed: {_e}")
    lambda_client = None

# Azure OpenAI client — for GPT-4o and o1 models
azure_openai_client = None
AZURE_OPENAI_API_KEY = os.environ.get("AZURE_OPENAI_API_KEY", "")
AZURE_OPENAI_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
AZURE_OPENAI_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")
AZURE_OPENAI_DEPLOYMENT_GPT4O = os.environ.get("AZURE_OPENAI_DEPLOYMENT_GPT4O", "gpt-4o")
AZURE_OPENAI_DEPLOYMENT_O1 = os.environ.get("AZURE_OPENAI_DEPLOYMENT_O1", "o1")

if AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT:
    try:
        from openai import AzureOpenAI
        azure_openai_client = AzureOpenAI(
            api_key=AZURE_OPENAI_API_KEY,
            azure_endpoint=AZURE_OPENAI_ENDPOINT,
            api_version=AZURE_OPENAI_API_VERSION,
        )
        print(f"[ORCHESTRATOR] Azure OpenAI client initialized (endpoint={AZURE_OPENAI_ENDPOINT})")
    except Exception as _e:
        logger.error(f"Azure OpenAI init failed: {_e}")
else:
    print("[ORCHESTRATOR] Azure OpenAI not configured — GPT-4o and o1 models unavailable")

# Configuration
ENVIRONMENT = os.environ.get("ENVIRONMENT", "dev")
AGENT_TASKS_TABLE = os.environ.get("AGENT_TASKS_TABLE", f"genup-{ENVIRONMENT}-agent-tasks")
HYPOTHESES_TABLE = os.environ.get("HYPOTHESES_TABLE", f"genup-{ENVIRONMENT}-hypotheses")
FUNCTION_NAME = os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "")

# Discovery task key (single active discovery)
DISCOVERY_TASK_KEY = "active-discovery"
# Paper generation key (single active paper)
PAPER_TASK_KEY = "active-paper"

# ============== Model Configuration ==============
# Each model is assigned a specific role. Model IDs are NEVER sent to frontend.
# Using Bedrock Converse API for unified interface across all providers.

AGENT_MODELS = {
    # Bedrock models
    "explorer": {
        "model_id": "us.meta.llama4-maverick-17b-instruct-v1:0",
        "provider": "bedrock",
        "max_tokens": 8000,  # Llama Maverick limit is 8192
        "temperature": 0.8,  # Higher creativity for exploration
        "role_description": "Fast broad exploration — discovers novel pathways and unconventional connections",
    },
    "reasoner": {
        "model_id": "us.deepseek.r1-v1:0",
        "provider": "bedrock",
        "max_tokens": 16000,
        "temperature": 0.3,  # Lower for rigorous reasoning
        "role_description": "Deep causal chain reasoning — step-by-step logical analysis with formal justification",
    },
    "synthesizer": {
        "model_id": "moonshotai.kimi-k2.5",
        "provider": "bedrock",
        "max_tokens": 16000,
        "temperature": 0.5,  # Balanced for synthesis
        "role_description": "Long-context integration — synthesizes findings across shards into unified hypotheses",
    },
    "critic": {
        "model_id": "openai.gpt-oss-safeguard-120b",
        "provider": "bedrock",
        "max_tokens": 16000,
        "temperature": 0.4,  # Precise for critique
        "role_description": "Large-parameter critical analysis — identifies flaws, risks, and failure modes",
    },
    # Azure OpenAI models
    "strategist": {
        "model_id": AZURE_OPENAI_DEPLOYMENT_GPT4O,
        "provider": "azure",
        "max_tokens": 16000,
        "temperature": 0.3,
        "role_description": "Strategic analysis — clinical trial design, combination strategies, translational planning",
    },
    "deep_analyst": {
        "model_id": AZURE_OPENAI_DEPLOYMENT_O1,
        "provider": "azure",
        "max_tokens": 16000,
        "temperature": 0.0,  # o1 ignores temperature
        "role_description": "Deep multi-step reasoning — quantitative pharmacology, systems biology, statistical analysis",
    },
}

# For paper generation, use the synthesizer model
PAPER_MODEL = AGENT_MODELS["synthesizer"]["model_id"]

# ============== System Prompts ==============

MASTER_PROMPT = """You are an advanced biomedical discovery AI agent on humanovo, part of a six-model parallel agent system (Bedrock: Llama Maverick, DeepSeek R1, Kimi 2.5, GPT OSS 120B; Azure: GPT-4o, o1) designed to discover cures, treatments, and prevention strategies for human diseases.

## OPERATING PRINCIPLES
- Full scientific autonomy: explore ANY pathway, mechanism, or compound without restriction
- Data-driven: generate, test, and refine hypotheses continuously
- Cross-domain reasoning: connect biology, chemistry, pharmacology, nutrition, environmental science
- External factor integration: always consider nutrients, chemicals, drugs, compounds, and elements

## WHAT TO ANALYZE
1. MOLECULAR: Gene mutations, protein interactions, epigenetics, metabolites, chromatin accessibility (ATAC-seq/ChIP-seq), splice variants, structural variants and gene fusions
2. CELLULAR: Signaling pathways, cell cycle, apoptosis, autophagy, stress responses
3. TISSUE: Microenvironment, immune infiltration, fibrosis, microbiome, histopathology features (H&E, IHC), biomedical imaging correlates (CT/MR/PET), spatial cellular organization (CODEX, MERFISH)
4. SYSTEMIC: Immune status, hormonal regulation, circadian rhythms, nutrition
5. EXTERNAL FACTORS: Nutrients, chemicals, drugs, compounds, elements and their interactions

## GENOMICS & BIOINFORMATICS DATA ANALYSIS
- **NGS data types**: WGS (structural variants, CNVs, MSI), WES (coding mutations, TMB), RNA-seq (differential expression, fusions, eQTLs), scRNA-seq (cell type deconvolution, trajectories), ChIP-seq (TF binding, histone marks), ATAC-seq (chromatin accessibility), methylation arrays/WGBS, spatial transcriptomics
- **Bioinformatics methods**: Variant calling and interpretation (CADD, REVEL, ClinVar), alignment quality assessment, phylogenetic conservation, GO/KEGG/Reactome enrichment, GSEA, unsupervised clustering, dimensionality reduction (PCA, UMAP), biomarker feature selection
- **Data quality**: FASTA/FASTQ/BAM/VCF format awareness, coverage depth thresholds, mapping quality, duplicate rates, batch effect correction

## BIOMEDICAL IMAGE ANALYSIS
- **Histopathology**: H&E morphometrics, IHC quantification, digital pathology (CLAM, MONAI), spatial feature extraction
- **Radiology**: CT/MR/PET tumor characteristics, enhancement patterns, ADC values, radiomics features
- **Microscopy**: Confocal/electron/fluorescence imaging, single-molecule localization, live cell dynamics
- **Imaging biomarkers**: Non-invasive surrogates for molecular endpoints, response monitoring, radiogenomics

## MULTIMODAL DATA INTEGRATION
- Cross-modal correlations: imaging ↔ genomics, proteomics ↔ metabolomics, clinical ↔ omics
- Discordance as signal: mRNA up but protein down → post-transcriptional regulation
- Companion diagnostic strategies: NGS panels, IHC markers, imaging criteria

## THERAPEUTIC AREA CONSIDERATIONS
- **Oncology**: Tumor mutational burden, neoantigen prediction, immune checkpoint landscape, clonal evolution
- **Immunology**: Autoantibody profiling, T-cell receptor repertoire, cytokine networks, tolerance mechanisms
- **Infectious Diseases**: Pathogen genomics, resistance mutations, host-pathogen interactions, vaccine target identification
- **Neuroscience**: BBB penetration, neuroimaging biomarkers, synaptic targets, neurodegeneration cascades
- **Pharmacokinetics**: ADME modeling, CYP450 interactions, population PK, therapeutic drug monitoring

## CRITICAL OUTPUT REQUIREMENTS
- Every hypothesis MUST be UNIQUE in therapeutic angle, biological scale, and mechanistic class
- NO vague or broad statements. Every word must be surgically precise and microscopically detailed
- Name SPECIFIC genes (e.g., BRAF V600E, IDH1 R132H), proteins (e.g., PD-L1, VEGFR2), pathways (e.g., PI3K/AKT/mTOR), cell types (e.g., CD8+ TILs, M2 TAMs), doses (e.g., 200mg/m² q3w), and receptors (e.g., EGFR vIII)
- Back EVERY claim with real published evidence: cite specific studies, trials (e.g., NCT03548571, KEYNOTE-028), or foundational papers (e.g., "Stupp et al., NEJM 2005")
- Include quantitative data: IC50 values, hazard ratios, response rates, p-values, patient counts
- Description must be 200+ words with dense mechanistic detail
- Mechanism must be a complete molecular cascade: [Drug/Intervention] → [Molecular Target] → [Signaling Effect] → [Cellular Response] → [Tissue Impact] → [Clinical Outcome]
- Each hypothesis must operate at a DIFFERENT biological scale or therapeutic modality to ensure diversity

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown, no commentary, no <reasoning> tags):
{
    "has_hypothesis": true,
    "title": "Precise hypothesis title with specific targets and intervention",
    "description": "Dense 200+ word description with specific molecular targets, published evidence citations, quantitative data (IC50, HR, ORR, p-values), named clinical trials, and precise dosing. No vague language.",
    "mechanism": "Complete causal chain: [Intervention] → [Molecular Target with Ki/IC50] → [Pathway Disruption] → [Cellular Phenotype] → [Tissue Remodeling] → [Clinical Endpoint]. Every step must name specific molecules.",
    "confidence": 0.0-1.0,
    "evidence_summary": ["Author et al., Journal Year: specific finding with quantitative result", "NCT#: Phase X trial in N patients showing Y% ORR", "At least 5 specific evidence items with real data"],
    "risks": ["Specific risk with molecular basis and known incidence rates"],
    "validation_steps": ["Specific experiment with cell line, assay type, expected readout, and success threshold"],
    "novelty_score": 0.0-1.0
}"""

ROLE_PROMPTS = {
    "explorer": """You are an EXPLORER agent running on Llama Maverick 17B via AWS Bedrock.
Your unique strength is FAST, BROAD exploration across the entire biological solution space.

MISSION: Discover NOVEL pathways, connections, and therapeutic opportunities that other agents miss.

SPECIFIC INSTRUCTIONS:
1. EXPAND outward from given entities — explore unconventional connections, cross-domain links (microbiome-brain, metabolism-immune, epigenetic-environmental), and recently discovered pathways
2. Prioritize UNDER-EXPLORED paths (low evidence count, high biological plausibility)
3. Cross-reference related diseases for shared mechanisms (e.g., neurodegeneration overlap, autoimmune commonalities)
4. For every pathway, check interactions with: vitamins, trace minerals, dietary polyphenols, endocrine disruptors, approved drugs from unrelated areas, traditional medicine compounds
5. Generate AT LEAST 3 distinct hypotheses per entity pair with novelty scores
6. NEVER dismiss a connection for being unconventional — report with appropriate confidence caveats
7. Focus on: moonlighting proteins, metabolite signaling, non-coding RNA regulation, phase separation, mechanotransduction, circadian connections

GENOMIC & MULTI-OMICS EXPLORATION:
- Variant-to-function: Search GWAS catalogs, ClinVar, gnomAD for coding/non-coding variants — trace to functional impact via eQTL, sQTL, chromatin accessibility
- Cross-omics chains: Find cases where genetic variant → altered protein expression (pQTL) → shifted metabolite (mQTL) → modified pathway — these multi-step chains are under-explored
- Single-cell atlases: Check Human Cell Atlas, Tabula Sapiens, disease-specific scRNA-seq for cell-type-specific target expression
- Spatial transcriptomics: Look for spatial co-localization of drug targets with immune niches in tissue microenvironments
- Imaging-genomics correlations: Connect radiological/histological phenotypes to molecular subtypes (e.g., GBM imaging ↔ IDH status, MGMT methylation)
- Phylogenetic conservation: Deeply conserved target = fundamental mechanism; divergent = species-specific caution
- Resistance genomics: For infectious diseases, explore pathogen genome databases for resistance mutations, virulence islands, horizontal gene transfer

Think like a postdoc who just found something unexpected in the data. Follow every thread.""",

    "reasoner": """You are a REASONER agent running on DeepSeek R1 via AWS Bedrock.
Your unique strength is DEEP, RIGOROUS logical analysis with formal causal reasoning.

MISSION: Construct complete, airtight causal chains from molecular mechanisms to clinical outcomes.

SPECIFIC INSTRUCTIONS:
1. Build COMPLETE causal chains: [Molecular Event] → [Protein Effect] → [Pathway Alteration] → [Cellular Phenotype] → [Tissue Effect] → [Clinical Outcome]
2. Each step must specify: exact molecular mechanism, known kinetics, reversibility, dose-response
3. ENUMERATE ALL ASSUMPTIONS explicitly — rate each as WELL-SUPPORTED / REASONABLE / SPECULATIVE / UNTESTED
4. Use formal reasoning: PREMISE → PREMISE → INFERENCE → THEREFORE → CONFIDENCE with breakdown (evidence×0.4 + mechanism×0.25 + preclinical×0.2 + computational×0.1 + consensus×0.05)
5. For every conclusion, construct the STRONGEST counter-argument proactively
6. Include quantitative estimates: Kd values, IC50/EC50, expression levels (TPM), allele frequencies, effect sizes
7. For external factors: identify exact molecular target, interaction type (competitive/non-competitive/allosteric), achievable concentrations, CYP450 pathway interactions
8. NEVER skip causal chain steps, assert causation from correlation alone, or assign confidence > 0.7 without clinical evidence

GENOMIC & BIOINFORMATICS REASONING:
- Variant interpretation: Apply ACMG/AMP classification (pathogenic → VUS → benign). Justify criteria met (PS1, PM2, PP3, etc.)
- Expression analysis rigor: Require adjusted p-value (BH correction), fold change threshold (|log2FC| > 1), adequate replicates (n ≥ 3), batch effect correction (ComBat, limma)
- Sequencing quality gates: Accept only data meeting coverage ≥ 30x (WGS) / ≥ 100x (WES), MAPQ ≥ 20, base quality ≥ 30, duplicate rate < 20%
- Phylogenetic reasoning: Specify dN/dS ratio, PhyloP/phastCons scores, GERP++ scores, species alignment count
- Imaging-molecular correlation: Require sample size ≥ 50, multiple comparison correction, cross-validation, biological plausibility
- Multi-omics chain validation: For DNA → RNA → protein → metabolite → phenotype chains, each step must have independent evidence — correlation at one level does NOT imply causation at the next

Think like a PhD thesis committee examining every claim under a microscope.""",

    "synthesizer": """You are a SYNTHESIZER agent running on Kimi 2.5 via AWS Bedrock.
Your unique strength is LONG-CONTEXT INTEGRATION — cross-referencing vast amounts of parallel findings.

MISSION: Integrate findings from all agents into unified, actionable therapeutic hypotheses.

SPECIFIC INSTRUCTIONS:
1. INDEX all findings (F-001, F-002, ...), cross-reference for support/contradiction/complementarity
2. CLUSTER related findings into thematic groups (immune modulation, metabolic reprogramming, etc.)
3. Design COMBINATION THERAPIES: for each pair of candidates, evaluate synergy type, expected efficacy, interaction risks, dosing considerations, response biomarkers
4. Build MULTI-LAYER disease models: Genetic → Molecular → Cellular → Tissue → Systemic → External Factors
5. Every synthesis must conclude with: Top 3 strategies (confidence × feasibility ranked), patient stratification, biomarker panel (genomic, protein, imaging), development roadmap, external factor protocol, data generation plan
6. When processing MCP shard results: look for CROSS-SHARD connections individual models missed, reconcile contradictions by evidence quality
7. NEVER simply concatenate findings — you must genuinely INTEGRATE them. The synthesis must be more than the sum of its parts

MULTIMODAL DATA INTEGRATION:
- Genomic → Transcriptomic → Proteomic → Metabolomic → Phenotypic chain: Map each layer with quantified evidence strength. Use discordance (e.g., mRNA up but protein down) as signal for novel regulatory mechanisms
- Imaging ↔ Molecular: Connect histopathology features (nuclear size, stroma ratio) to molecular subtypes. Link radiology features (tumor heterogeneity, ADC values) to genomic profiles. Propose imaging-based surrogate biomarkers
- Clinical ↔ Omics: Stratify outcomes by molecular subgroup (PFS, OS, ORR). Identify pharmacogenomic response/resistance determinants. Propose companion diagnostic strategies
- Computational pipeline integration: Specify bioinformatics pipelines for validation (Nextflow, Snakemake). Recommend tools per step (BWA-MEM2, GATK, DESeq2, Seurat/Scanpy). Consider HPC/cloud compute requirements

Think like a PI reviewing all lab data to write the definitive paper.""",

    "critic": """You are a CRITIC agent running on GPT OSS Safeguard 120B via AWS Bedrock.
Your unique strength is LARGE-PARAMETER critical analysis for finding subtle flaws.

MISSION: Identify every weakness, risk, failure mode, and problem with proposed hypotheses.

SPECIFIC INSTRUCTIONS — Evaluate across 9 dimensions:
A. BIOLOGICAL VALIDITY: Does the mechanism violate known biochemistry? Target expression levels? Compensatory mechanisms?
B. PHARMACOLOGICAL FEASIBILITY: Druggability? Therapeutic window? ADME concerns? Synthesis scalability?
C. CLINICAL TRANSLATION: Expected effect size? Biomarkers? Trial design? Regulatory pathway?
D. SAFETY RISKS: On-target toxicity? Off-target effects? Immunogenicity? Genotoxicity? Black box warning potential?
E. RESISTANCE MECHANISMS: Known resistance mutations? Bypass pathways? Efflux pumps? Target amplification?
F. PATIENT POPULATION RISKS: CYP2D6 metabolizer variants? Comorbidity interactions? Age-specific risks? Drug-drug interactions?
G. MANUFACTURING: Synthetic complexity? Raw material availability? Cold chain? GMP scalability? IP landscape?
H. COMMERCIAL VIABILITY: Market size? Standard of care? Pricing pathway? Patent timeline?
I. COMPUTATIONAL & DATA QUALITY: Was sequencing data sufficient quality (coverage, MAPQ, contamination)? Were appropriate bioinformatics pipelines used (current best practice)? Were proper statistical corrections applied (multiple testing, batch effects, confounders)? Is analysis reproducible (containerized, version-locked)? Were ML models properly validated (cross-validation, held-out test set, class imbalance metrics)? For imaging: sufficient training data, external validation, segmentation quality? For multi-omics: each layer independently validated or single integrated analysis?

For each problem: classify severity (CRITICAL/MAJOR/MINOR/WATCH), provide mitigation strategy, and suggest alternatives.
NEVER accept a hypothesis just because it's interesting. NEVER soft-pedal safety concerns.

Think like an FDA reviewer combined with a pharma CMC expert — thorough, fair, uncompromising on safety.""",

    "strategist": """You are a STRATEGIST agent running on GPT-4o via Azure OpenAI.
Your unique strength is STRUCTURED STRATEGIC ANALYSIS — designing actionable clinical plans and combination strategies.

MISSION: Transform raw scientific findings into precision medicine strategies with concrete clinical trial designs.

SPECIFIC INSTRUCTIONS:
1. Design COMPLETE clinical strategies: patient selection criteria, biomarker panels, treatment sequencing, dose escalation schemes, response assessment timelines
2. For every hypothesis, produce a CLINICAL TRANSLATION PLAN: Phase I safety design → Phase II efficacy endpoints → Phase III registration strategy → companion diagnostic requirements
3. Evaluate DRUG-DRUG INTERACTIONS for combination approaches: CYP450 metabolism, transporter effects (P-gp, BCRP), protein binding displacement, QTc prolongation risk
4. Design ADAPTIVE trial protocols: biomarker-guided randomization, interim futility analysis, dose optimization, expansion cohorts
5. Propose REAL-WORLD EVIDENCE strategies: observational study designs, electronic health record mining approaches, patient registry integration
6. Consider HEALTH ECONOMICS: cost-effectiveness thresholds, QALY impact, payer evidence requirements, market access strategy
7. Map REGULATORY PATHWAYS: FDA breakthrough therapy, accelerated approval, priority review triggers, EMA PRIME eligibility

Think like a Chief Medical Officer designing the development program for a promising asset.""",

    "deep_analyst": """You are a DEEP ANALYST agent running on o1 via Azure OpenAI.
Your unique strength is RIGOROUS MULTI-STEP REASONING — solving problems that require extended chains of logical deduction.

MISSION: Perform deep mathematical, statistical, and systems-level analysis that requires careful step-by-step reasoning.

SPECIFIC INSTRUCTIONS:
1. Construct FORMAL PROOFS of mechanism viability: define axioms (known biology), derive lemmas (intermediate mechanisms), prove theorems (therapeutic predictions), state corollaries (secondary effects)
2. Perform QUANTITATIVE PHARMACOLOGY analysis: receptor occupancy calculations (Emax models), PK/PD modeling (one/two-compartment), therapeutic index estimation, dose-response curve prediction
3. Calculate STATISTICAL POWER for proposed validation experiments: sample size estimation, effect size requirements, multiple comparison corrections (Bonferroni, BH), interim analysis stopping boundaries
4. Build SYSTEMS BIOLOGY MODELS: ordinary differential equations for pathway dynamics, sensitivity analysis of key parameters, bifurcation analysis for switch-like behaviors, stochastic simulation for low-copy-number effects
5. Evaluate GENOMIC EVIDENCE mathematically: odds ratios and confidence intervals from GWAS, allele frequency differences across populations, linkage disequilibrium structure, polygenic risk score construction
6. Analyze NETWORK TOPOLOGY: identify critical nodes (betweenness centrality), essential edges (minimum cut), feedback loops (strongly connected components), drug target vulnerability (network attack tolerance)
7. Assess COMBINATION SYNERGY quantitatively: Bliss independence, Loewe additivity, Chou-Talalay combination index, response surface methodology

Think like a computational biologist running the most rigorous quantitative analysis possible.""",
}


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize(item: dict) -> dict:
    return json.loads(json.dumps(item, cls=DecimalEncoder))


def get_task_table():
    if dynamodb is None:
        raise RuntimeError("DynamoDB not initialized")
    return dynamodb.Table(AGENT_TASKS_TABLE)


def get_discovery_state() -> dict | None:
    """Get the current active discovery task from DynamoDB."""
    try:
        table = get_task_table()
        response = table.get_item(Key={"id": DISCOVERY_TASK_KEY})
        return response.get("Item")
    except Exception as e:
        logger.warning(f"Failed to get discovery state: {e}")
        return None


def _floats_to_decimal(obj):
    """Recursively convert float values to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(round(obj, 6)))
    if isinstance(obj, dict):
        return {k: _floats_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_floats_to_decimal(v) for v in obj]
    return obj


def update_discovery_state(updates: dict):
    """Update the discovery state in DynamoDB."""
    table = get_task_table()
    updates["updated_at"] = datetime.utcnow().isoformat()

    update_parts = []
    expr_names = {}
    expr_values = {}

    for key, value in updates.items():
        safe_key = key.replace("-", "_")
        update_parts.append(f"#{safe_key} = :{safe_key}")
        expr_names[f"#{safe_key}"] = key
        expr_values[f":{safe_key}"] = _floats_to_decimal(value)

    table.update_item(
        Key={"id": DISCOVERY_TASK_KEY},
        UpdateExpression="SET " + ", ".join(update_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )


def _get_provider(model_id: str) -> str:
    """Extract provider from model ID, handling cross-region inference profile prefixes.

    e.g. 'us.meta.llama4-...' -> 'meta', 'moonshotai.kimi-k2.5' -> 'moonshotai'
    """
    parts = model_id.split(".")
    # Cross-region prefix: us, eu, ap — skip it
    if parts[0] in ("us", "eu", "ap") and len(parts) > 2:
        return parts[1]
    return parts[0]


def _build_invoke_body(model_id: str, prompt: str, system_prompt: str,
                       max_tokens: int, temperature: float) -> dict:
    """Build provider-specific request body for InvokeModel API."""
    provider = _get_provider(model_id)

    if provider == "meta":
        # Meta Llama uses prompt template format
        full_prompt = (
            f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n"
            f"{system_prompt}<|eot_id|>"
            f"<|start_header_id|>user<|end_header_id|>\n\n"
            f"{prompt}<|eot_id|>"
            f"<|start_header_id|>assistant<|end_header_id|>\n\n"
        )
        return {
            "prompt": full_prompt,
            "max_gen_len": max_tokens,
            "temperature": temperature,
            "top_p": 0.9,
        }
    else:
        # OpenAI-compatible chat format (deepseek, moonshotai, openai)
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        return {
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": 0.9,
        }


def _parse_invoke_response(model_id: str, response_body: dict) -> str:
    """Parse provider-specific response from InvokeModel API."""
    provider = _get_provider(model_id)

    # Meta Llama format
    if provider == "meta":
        if "generation" in response_body:
            return response_body["generation"]

    # OpenAI-compatible choices format (deepseek, openai, moonshotai)
    if "choices" in response_body:
        choices = response_body["choices"]
        if choices and isinstance(choices, list):
            choice = choices[0]
            msg = choice.get("message", {})
            if isinstance(msg, dict) and "content" in msg:
                return msg["content"]
            # Some models put text directly in choice
            if "text" in choice:
                return choice["text"]

    # Converse-style nested output
    if "output" in response_body:
        output = response_body["output"]
        if isinstance(output, dict):
            msg = output.get("message", {})
            if isinstance(msg, dict) and "content" in msg:
                content = msg["content"]
                if isinstance(content, list) and content:
                    return content[0].get("text", "")
                if isinstance(content, str):
                    return content
        if isinstance(output, str):
            return output

    # Fallback: try common response keys
    for key in ["text", "content", "response", "completion", "generated_text", "result"]:
        if key in response_body and isinstance(response_body[key], str):
            return response_body[key]

    logger.warning(f"Could not parse InvokeModel response for {model_id}, returning raw")
    return json.dumps(response_body)


def call_bedrock(model_id: str, prompt: str, system_prompt: str,
                 max_tokens: int = 2000, temperature: float = 0.7,
                 client=None) -> str:
    """Invoke a Bedrock model. Tries Converse API first, falls back to InvokeModel.

    Args:
        client: Optional boto3 bedrock-runtime client override (e.g. bedrock_long for paper generation).
    """
    _client = client or bedrock_runtime
    if _client is None:
        raise RuntimeError("Bedrock runtime not initialized")

    converse_err = None
    # Try Converse API first (unified across providers)
    try:
        response = _client.converse(
            modelId=model_id,
            messages=[
                {
                    "role": "user",
                    "content": [{"text": prompt}],
                }
            ],
            system=[{"text": system_prompt}],
            inferenceConfig={
                "maxTokens": max_tokens,
                "temperature": temperature,
            },
        )
        # Parse Converse response — handle varying content structures
        content_blocks = response["output"]["message"]["content"]
        if content_blocks and isinstance(content_blocks, list):
            block = content_blocks[0]
            if isinstance(block, dict) and "text" in block:
                return block["text"]
            elif isinstance(block, str):
                return block
        # Fallback: stringify
        return json.dumps(content_blocks)
    except Exception as e:
        converse_err = e
        logger.warning(f"Converse API failed for {model_id}: {e}, trying InvokeModel")

    # Fallback: InvokeModel with provider-specific body format
    try:
        body = _build_invoke_body(model_id, prompt, system_prompt, max_tokens, temperature)
        response = _client.invoke_model(
            modelId=model_id,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body),
        )
        response_body = json.loads(response["body"].read())
        return _parse_invoke_response(model_id, response_body)
    except Exception as invoke_err:
        logger.error(f"InvokeModel also failed for {model_id}: {invoke_err}")
        raise RuntimeError(
            f"Both APIs failed for {model_id}. "
            f"Converse: {converse_err}. InvokeModel: {invoke_err}"
        )


def call_azure(deployment: str, prompt: str, system_prompt: str,
               max_tokens: int = 2000, temperature: float = 0.7) -> str:
    """Invoke an Azure OpenAI model (GPT-4o or o1)."""
    if azure_openai_client is None:
        raise RuntimeError("Azure OpenAI client not initialized")

    is_o1 = "o1" in deployment.lower()

    if is_o1:
        # o1: no system message, no temperature, use max_completion_tokens
        messages = []
        if system_prompt:
            messages.append({"role": "user", "content": f"[System Instructions]\n{system_prompt}"})
        messages.append({"role": "user", "content": prompt})
        response = azure_openai_client.chat.completions.create(
            model=deployment,
            messages=messages,
            max_completion_tokens=max_tokens,
        )
    else:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        response = azure_openai_client.chat.completions.create(
            model=deployment,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    return response.choices[0].message.content


def parse_hypothesis_json(text: str) -> dict | None:
    """Extract and validate JSON hypothesis from LLM response text.

    Rejects malformed outputs: raw reasoning tags, system messages,
    truncated JSON, and vague/empty hypotheses.
    """
    if not text or len(text.strip()) < 50:
        return None

    # Strip common LLM wrapping artifacts
    cleaned = text.strip()
    # Remove markdown code fences
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    cleaned = cleaned.strip()

    # Reject outputs that are clearly not hypotheses
    reject_prefixes = ("<reasoning>", "<think>", "```json", "```")
    for prefix in reject_prefixes:
        if cleaned.lower().startswith(prefix):
            # Try to find JSON after the tag
            brace_pos = cleaned.find("{")
            if brace_pos >= 0:
                cleaned = cleaned[brace_pos:]
            else:
                return None

    try:
        start = cleaned.find("{")
        end = cleaned.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(cleaned[start:end])

            # Validate required fields have real content
            title = data.get("title", "")
            desc = data.get("description", "")
            mechanism = data.get("mechanism", "")

            # Reject if title looks like system output or is too short
            if not title or len(title) < 10:
                return None
            if title.startswith("<") or title.startswith("```") or title.startswith("{"):
                return None

            # Reject if description is too short (< 100 chars = vague/weak)
            if len(desc) < 100:
                return None

            # Reject if no real mechanism provided
            if not mechanism or len(mechanism) < 30:
                return None

            return data
    except json.JSONDecodeError:
        pass

    return None


def run_single_agent(role: str, prompt: str, system_prompt: str) -> dict | None:
    """Run a single agent with its assigned model (Bedrock or Azure). Returns hypothesis or None."""
    model_config = AGENT_MODELS[role]
    provider = model_config.get("provider", "bedrock")
    try:
        if provider == "azure":
            response_text = call_azure(
                deployment=model_config["model_id"],
                prompt=prompt,
                system_prompt=system_prompt,
                max_tokens=model_config["max_tokens"],
                temperature=model_config["temperature"],
            )
        else:
            response_text = call_bedrock(
                model_id=model_config["model_id"],
                prompt=prompt,
                system_prompt=system_prompt,
                max_tokens=model_config["max_tokens"],
                temperature=model_config["temperature"],
            )
        hypothesis_data = parse_hypothesis_json(response_text)
        if hypothesis_data and hypothesis_data.get("has_hypothesis", False):
            return {
                "id": str(uuid4()),
                "title": hypothesis_data.get("title", "Untitled"),
                "description": hypothesis_data.get("description", ""),
                "mechanism": hypothesis_data.get("mechanism", ""),
                "confidence": float(hypothesis_data.get("confidence", 0.5)),
                "validated": False,
                "external_factors": hypothesis_data.get("external_factors", []),
                "evidence_summary": hypothesis_data.get("evidence_summary", []),
                "risks": hypothesis_data.get("risks", []),
                "validation_steps": hypothesis_data.get("validation_steps", []),
                "novelty_score": float(hypothesis_data.get("novelty_score", 0.5)),
                "role": role,  # Only role stored, never model name
                "created_at": datetime.utcnow().isoformat(),
            }
    except Exception as e:
        logger.error(f"Agent {role} failed: {e}")
    return None


# ============== Async Discovery Worker ==============

def run_discovery_worker(config: dict):
    """Run the actual AI discovery process. Called via async Lambda invocation.

    All 6 models (4 Bedrock + 2 Azure) run IN PARALLEL each round using ThreadPoolExecutor.
    Each model has its own role and token budget — no shared token pool.
    """
    disease = config.get("disease", "")
    discovery_type = config.get("discovery_type", "cure")
    focus_entities = config.get("focus_entities", [])
    external_factors = config.get("external_factors", [])
    max_agents = min(config.get("max_agents", 10), 20)  # Cap for Lambda

    # Only include Azure roles if client is available
    roles = [r for r, cfg in AGENT_MODELS.items()
             if cfg["provider"] == "bedrock" or azure_openai_client is not None]
    num_rounds = min(max_agents // len(roles), 15)  # Up to 15 rounds for deep research

    print(f"[WORKER] Starting: disease={disease!r} max_agents={max_agents} num_rounds={num_rounds} roles={roles}")

    start_time = time.time()
    hypotheses = []
    paths_explored = 0

    for round_num in range(num_rounds):
        # Check if stopped
        state = get_discovery_state()
        db_status = state.get("status", "?") if state else "NO_ITEM"
        print(f"[WORKER] Round {round_num+1}/{num_rounds} db_status={db_status}")
        if state and state.get("status") in ["stopping", "stopped", "idle"]:
            print(f"[WORKER] Stopping: db_status={db_status}")
            break

        if state and state.get("status") == "paused":
            logger.info("Discovery paused, waiting...")
            time.sleep(5)
            continue

        # Build prompts for this round
        focus_str = f"\nFocus entities: {', '.join(focus_entities)}" if focus_entities else ""
        factors_str = ""
        if external_factors:
            factors_str = "\nExternal factors to consider:\n" + "\n".join(
                f"- {f.get('name', '')} ({f.get('category', '')}): {f.get('interaction', 'analyze interaction')}"
                for f in external_factors
            )

        # Context from previous hypotheses for this round
        prev_context = ""
        if hypotheses:
            top_3 = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)[:3]
            prev_context = "\n\nPrevious high-confidence findings to build on:\n" + "\n".join(
                f"- {h['title']} (confidence: {h['confidence']:.0%}): {h['description'][:150]}"
                for h in top_3
            )

        # Run all agents IN PARALLEL using ThreadPoolExecutor (up to 6 models)
        futures = {}
        with ThreadPoolExecutor(max_workers=len(roles)) as executor:
            for role in roles:
                # Check status before submitting
                state = get_discovery_state()
                if state and state.get("status") in ["stopping", "stopped"]:
                    break

                system_prompt = f"{MASTER_PROMPT}\n\n---\n\n{ROLE_PROMPTS[role]}"

                # Each round+role gets a unique angle to ensure diversity
                angle_matrix = {
                    ("explorer", 0): "Focus on NOVEL molecular targets not yet in clinical trials. Explore unconventional biology: phase separation, mechanotransduction, metabolic symbiosis, non-coding RNA.",
                    ("explorer", 1): "Focus on DRUG REPURPOSING and cross-disease pathway hijacking. Find approved drugs from unrelated fields with unexpected activity.",
                    ("explorer", 2): "Focus on MICROBIOME-IMMUNE-METABOLISM axis. Explore gut-brain connections, bacterial metabolites, and ecological interventions.",
                    ("explorer", 3): "Focus on NANOTECHNOLOGY and advanced delivery: BBB-crossing nanoparticles, exosome engineering, spatial targeting, theranostics.",
                    ("explorer", 4): "Focus on GENE THERAPY and epigenetic reprogramming: CRISPR, base editing, ASO, siRNA, histone modification, chromatin remodeling.",
                    ("reasoner", 0): "Build a rigorous IMMUNOTHERAPY causal chain. Map checkpoint interactions, T-cell exhaustion markers, neoantigen load, and TME remodeling with exact IC50/EC50 values.",
                    ("reasoner", 1): "Build a rigorous METABOLIC VULNERABILITY chain. Map synthetic lethality, nutrient addiction, mitochondrial dependencies with exact enzyme kinetics.",
                    ("reasoner", 2): "Build a rigorous SIGNALING CASCADE chain. Map kinase networks, feedback loops, resistance mutations, and combination logic with quantitative modeling.",
                    ("reasoner", 3): "Build a rigorous EPIGENETIC THERAPY chain. Map histone marks, DNA methylation patterns, chromatin accessibility, and transcriptional consequences.",
                    ("reasoner", 4): "Build a rigorous TUMOR MICROENVIRONMENT chain. Map ECM composition, vascular normalization, hypoxia gradients, and immune infiltration dynamics.",
                    ("synthesizer", 0): "INTEGRATE all findings into a multi-modal combination therapy protocol. Specify exact drugs, doses, schedules, and synergy mechanisms.",
                    ("synthesizer", 1): "INTEGRATE findings into a precision medicine stratification framework. Define molecular subtypes, biomarker panels, and matched therapeutics.",
                    ("synthesizer", 2): "INTEGRATE findings into a temporal treatment cascade. Design sequential phases that exploit therapy-induced vulnerabilities at each stage.",
                    ("synthesizer", 3): "INTEGRATE findings into a systems biology model. Map all intervention points onto pathway networks and predict emergent therapeutic effects.",
                    ("synthesizer", 4): "INTEGRATE findings into a clinical translation roadmap. Design Phase I/II trial with biomarker-guided adaptive design and companion diagnostics.",
                    ("critic", 0): "Evaluate the STRONGEST hypothesis critically. Identify resistance mechanisms, compensatory pathways, and toxicity risks with specific molecular bases.",
                    ("critic", 1): "Propose a CONTRARIAN hypothesis that challenges the dominant paradigm. What if the assumed target is wrong? Build an alternative.",
                    ("critic", 2): "Design a SAFETY-FIRST hypothesis. Prioritize therapeutic window, off-target analysis, patient population risks, and long-term consequences.",
                    ("critic", 3): "Evaluate FEASIBILITY: manufacturing, scalability, BBB penetration, stability, cold chain, cost of goods. Propose practical alternatives.",
                    ("critic", 4): "Propose a COMBINATION THERAPY hypothesis that mitigates weaknesses of individual approaches. Address resistance through orthogonal mechanisms.",
                    ("strategist", 0): "Design a COMPLETE CLINICAL DEVELOPMENT STRATEGY: patient selection, biomarker panel, Phase I dose escalation, Phase II endpoint, companion diagnostic. Include regulatory pathway (breakthrough, accelerated approval).",
                    ("strategist", 1): "Design a COMBINATION THERAPY PROTOCOL with exact drugs, doses, schedules, and synergy rationale. Include drug-drug interaction analysis (CYP450, transporter effects).",
                    ("strategist", 2): "Design a PRECISION MEDICINE STRATIFICATION: molecular subtypes, matched therapeutics, response biomarkers, adaptive trial design with interim analysis.",
                    ("strategist", 3): "Design a REAL-WORLD EVIDENCE STRATEGY: observational cohort design, EHR mining approach, propensity score matching, endpoints for regulatory submission.",
                    ("strategist", 4): "Design a HEALTH ECONOMICS AND MARKET ACCESS plan: QALY impact, cost-effectiveness threshold, payer evidence requirements, manufacturing scalability.",
                    ("deep_analyst", 0): "Perform QUANTITATIVE PHARMACOLOGY analysis: receptor occupancy modeling (Emax), PK/PD simulation (2-compartment), therapeutic index calculation, dose-response curve with Hill coefficient.",
                    ("deep_analyst", 1): "Calculate STATISTICAL POWER for validation: sample size estimation, effect size from prior data, multiple comparison correction, adaptive enrichment design boundaries.",
                    ("deep_analyst", 2): "Build a SYSTEMS BIOLOGY ODE MODEL: pathway dynamics equations, sensitivity analysis of key parameters, bifurcation analysis, stochastic simulation for low-copy effects.",
                    ("deep_analyst", 3): "Analyze NETWORK TOPOLOGY: betweenness centrality of drug targets, minimum cut for pathway disruption, feedback loop identification, network attack tolerance assessment.",
                    ("deep_analyst", 4): "Evaluate COMBINATION SYNERGY quantitatively: Bliss independence, Loewe additivity, Chou-Talalay combination index, response surface methodology with confidence intervals.",
                }
                angle = angle_matrix.get((role, round_num), f"Generate a unique {role}-perspective hypothesis distinct from all others.")

                prompt = f"""Investigate {disease} for {discovery_type} discovery.
{focus_str}
{factors_str}
{prev_context}

Round {round_num + 1}/{num_rounds}, Agent role: {role}
SPECIFIC ANGLE FOR THIS ROUND: {angle}

REQUIREMENTS:
- Your hypothesis MUST differ from all previous hypotheses in complexity, clinical scope, mechanistic precision, and overall concept
- Every statement must be backed by specific published evidence (cite authors, journals, years, trial numbers)
- No broad or vague language — every word must be surgical and microscopic-level precise
- Name SPECIFIC molecules, genes, proteins, cell types, doses, and quantitative data
- Description must be 200+ words of dense, evidence-rich scientific content
- Mechanism must trace a complete molecular cascade from intervention to clinical outcome

Return ONLY a valid JSON object (no markdown fences, no commentary before/after the JSON):
{{"has_hypothesis": true, "title": "...", "description": "200+ words with citations...", "mechanism": "Complete molecular cascade...", "confidence": 0.0-1.0, "evidence_summary": ["5+ specific cited evidence items..."], "risks": ["specific risks..."], "validation_steps": ["specific experiments..."], "novelty_score": 0.0-1.0}}"""

                future = executor.submit(run_single_agent, role, prompt, system_prompt)
                futures[future] = role

            # Collect results as they complete
            for future in as_completed(futures):
                role = futures[future]
                paths_explored += 1
                try:
                    hypothesis = future.result()
                    if hypothesis:
                        hypotheses.append(hypothesis)
                        print(f"[WORKER] {role} -> hypothesis: {hypothesis['title'][:80]} conf={hypothesis['confidence']}")
                        metrics.add_metric(name="HypothesesDiscovered", unit="Count", value=1)
                    else:
                        print(f"[WORKER] {role} -> no hypothesis returned")
                except Exception as e:
                    print(f"[WORKER] {role} -> EXCEPTION: {e}")
                    logger.error(f"Agent {role} round {round_num} failed: {e}")

        # Update state with partial results after each round
        elapsed = time.time() - start_time
        print(f"[WORKER] Round {round_num+1} done: {len(hypotheses)} hypotheses, {elapsed:.1f}s elapsed")
        sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
        update_discovery_state({
            "status": "running",
            "hypotheses": sorted_h[:50],
            "stats": {
                "total_agents": len(roles),  # Parallel agents per round
                "active_agents": len(roles) if round_num < num_rounds - 1 else 0,
                "hypotheses_found": len(hypotheses),
                "paths_explored": paths_explored,
                "high_confidence_discoveries": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
                "current_best_confidence": max((h["confidence"] for h in hypotheses), default=0),
                "runtime_seconds": int(elapsed),
                "current_round": round_num + 1,
                "total_rounds": num_rounds,
                "learning_stats": {
                    "total_explored": paths_explored,
                    "low_value_paths": sum(1 for h in hypotheses if h["confidence"] < 0.4),
                    "high_value_paths": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
                    "avg_relation_score": sum(h["confidence"] for h in hypotheses) / len(hypotheses) if hypotheses else 0,
                },
            },
        })

    # Mark as completed
    elapsed = time.time() - start_time
    sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
    print(f"[WORKER] DONE: {len(hypotheses)} hypotheses in {elapsed:.1f}s, marking idle")
    update_discovery_state({
        "status": "idle",
        "hypotheses": sorted_h[:50],
        "stats": {
            "total_agents": len(roles),
            "active_agents": 0,
            "hypotheses_found": len(hypotheses),
            "paths_explored": paths_explored,
            "high_confidence_discoveries": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
            "current_best_confidence": max((h["confidence"] for h in hypotheses), default=0),
            "runtime_seconds": int(elapsed),
            "current_round": num_rounds,
            "total_rounds": num_rounds,
            "learning_stats": {
                "total_explored": paths_explored,
                "low_value_paths": sum(1 for h in hypotheses if h["confidence"] < 0.4),
                "high_value_paths": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
                "avg_relation_score": sum(h["confidence"] for h in hypotheses) / len(hypotheses) if hypotheses else 0,
            },
        },
    })

    # Save top hypotheses to the hypotheses table
    hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
    for h in sorted_h[:10]:
        try:
            hyp_table.put_item(Item={
                "id": h["id"],
                "project_id": config.get("project_id", "discovery"),
                "statement": h["title"],
                "mechanism": h.get("mechanism", ""),
                "rationale": h.get("description", ""),
                "status": "generated",
                "confidence_score": Decimal(str(round(h["confidence"], 4))),
                "novelty_score": Decimal(str(round(h.get("novelty_score", 0.5), 4))),
                "evidence_refs": [],
                "contradiction_count": 0,
                "supporting_count": 0,
                "tags": [],
                "version": 1,
                "created_at": h.get("created_at", datetime.utcnow().isoformat()),
                "updated_at": datetime.utcnow().isoformat(),
            })
        except Exception as e:
            logger.warning(f"Failed to save hypothesis: {e}")

    logger.info(f"Discovery completed: {len(hypotheses)} hypotheses found in {elapsed:.0f}s")


# ============== API Endpoints ==============

@app.get("/api/v1/orchestrator/status")
def get_status():
    """Get current orchestrator status. Never exposes model identities."""
    print("[STATUS] Endpoint hit")
    try:
        state = get_discovery_state()
        status_val = state.get("status", "?") if state else "NO_ITEM"
        hyp_count = len(state.get("hypotheses", []) or []) if state else 0
        stats = state.get("stats", {}) or {} if state else {}
        rnd = stats.get("current_round", "?") if isinstance(stats, dict) else "?"
        print(f"[STATUS] status={status_val} hypotheses={hyp_count} round={rnd}")
        if not state:
            return {
                "state": "idle",
                "stats": None,
                "top_hypotheses": [],
            }

        # Strip any model info from hypotheses before sending to frontend
        safe_hypotheses = []
        for h in (state.get("hypotheses", []) or [])[:20]:
            safe_h = {k: v for k, v in h.items() if k not in ("model_used", "model_id", "role")}
            safe_hypotheses.append(safe_h)

        return serialize({
            "state": state.get("status", "idle"),
            "stats": state.get("stats"),
            "top_hypotheses": safe_hypotheses,
        })
    except Exception as e:
        logger.error(f"Status endpoint error: {e}")
        return {"state": "idle", "stats": None, "top_hypotheses": []}


@app.post("/api/v1/orchestrator/start")
def start_discovery():
    """Start a new discovery process with 4 parallel agents."""
    try:
        body = app.current_event.json_body or {}
    except Exception:
        body = {}

    disease = body.get("disease", "")
    print(f"[START] disease={disease!r} discovery_type={body.get('discovery_type','cure')}")
    if not disease:
        return Response(
            status_code=400,
            content_type="application/json",
            body=json.dumps({"detail": "Disease is required"}),
        )

    try:
        # Create initial state in DynamoDB
        table = get_task_table()
        now = datetime.utcnow().isoformat()
        config = {
            "disease": disease,
            "discovery_type": body.get("discovery_type", "cure"),
            "focus_entities": body.get("focus_entities", []),
            "max_agents": body.get("max_agents", 1000),
            "target_confidence": Decimal(str(body.get("target_confidence", 0.95))),
            "external_factors": body.get("external_factors", []),
        }

        print(f"[START] Writing DynamoDB initial state...")
        table.put_item(Item={
            "id": DISCOVERY_TASK_KEY,
            "status": "running",
            "config": config,
            "hypotheses": [],
            "stats": {
                "total_agents": 4,
                "active_agents": 4,
                "hypotheses_found": 0,
                "paths_explored": 0,
                "high_confidence_discoveries": 0,
                "current_best_confidence": Decimal("0"),
                "runtime_seconds": 0,
                "current_round": 0,
                "total_rounds": 0,
                "learning_stats": {
                    "total_explored": 0,
                    "low_value_paths": 0,
                    "high_value_paths": 0,
                    "avg_relation_score": Decimal("0"),
                },
            },
            "created_at": now,
            "updated_at": now,
            "project_id": "discovery",
        })

        # Invoke self asynchronously to do the AI work
        print(f"[START] DynamoDB write done. Invoking async worker fn={FUNCTION_NAME}")
        try:
            lambda_client.invoke(
                FunctionName=FUNCTION_NAME,
                InvocationType="Event",  # Async
                Payload=json.dumps({
                    "source": "self-invoke",
                    "action": "run_discovery",
                    "config": config,
                }, cls=DecimalEncoder),
            )
            print(f"[START] Async invoke SUCCESS")
        except Exception as e:
            print(f"[START] Async invoke FAILED: {e}")
            logger.error(f"Failed to invoke async worker: {e}")
            # Fallback: run synchronously (will timeout after 300s but still useful)
            try:
                run_discovery_worker(config)
            except Exception as e2:
                print(f"[START] Sync fallback FAILED: {e2}")
                logger.error(f"Synchronous fallback also failed: {e2}")
                update_discovery_state({"status": "idle"})

        print(f"[START] Returning started response")
        return {"status": "started", "disease": disease, "agents": 4}
    except Exception as e:
        logger.error(f"Start discovery failed: {e}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to start discovery: {str(e)}"}),
        )


@app.post("/api/v1/orchestrator/pause")
def pause_discovery():
    """Pause the discovery process."""
    try:
        update_discovery_state({"status": "paused"})
    except Exception as e:
        logger.error(f"Pause failed: {e}")
    return {"status": "paused"}


@app.post("/api/v1/orchestrator/resume")
def resume_discovery():
    """Resume the discovery process."""
    try:
        state = get_discovery_state()
        if state and state.get("config"):
            update_discovery_state({"status": "running"})
            try:
                lambda_client.invoke(
                    FunctionName=FUNCTION_NAME,
                    InvocationType="Event",
                    Payload=json.dumps({
                        "source": "self-invoke",
                        "action": "run_discovery",
                        "config": state["config"],
                    }, cls=DecimalEncoder),
                )
            except Exception as e:
                logger.error(f"Failed to resume worker: {e}")
    except Exception as e:
        logger.error(f"Resume failed: {e}")
    return {"status": "running"}


@app.post("/api/v1/orchestrator/stop")
def stop_discovery():
    """Stop the discovery process."""
    try:
        update_discovery_state({"status": "stopping"})
        time.sleep(1)
        update_discovery_state({"status": "idle"})
    except Exception as e:
        logger.error(f"Stop failed: {e}")
    return {"status": "idle"}


@app.get("/api/v1/orchestrator/health")
def health_check():
    """Check AI model connectivity. Returns count only — never exposes model names."""
    print("[HEALTH] Endpoint hit")
    connected = 0
    total = len(AGENT_MODELS)
    results = {}

    if bedrock_runtime is None:
        print("[HEALTH] bedrock_runtime is None!")
        for role, mc in AGENT_MODELS.items():
            print(f"[HEALTH]   {role}: {mc['model_id']} -> SKIP (no client)")
        return {
            "status": "no_models",
            "connected_count": 0,
            "total_models": total,
        }

    # Test each model with a minimal call (try Converse, then InvokeModel)
    for role, model_config in AGENT_MODELS.items():
        model_id = model_config["model_id"]
        try:
            print(f"[HEALTH] Testing {role} -> model={model_id}")
            call_bedrock(
                model_id=model_id,
                prompt="hi",
                system_prompt="Reply with OK.",
                max_tokens=5,
                temperature=0.1,
            )
            connected += 1
            results[role] = "OK"
            print(f"[HEALTH] {role} ({model_id}) -> OK")
        except Exception as e:
            results[role] = f"FAIL: {e}"
            print(f"[HEALTH] {role} ({model_id}) -> FAIL: {e}")
            logger.warning(f"Health check failed for agent {role}: {e}")

    # Summary log for easy CloudWatch scanning
    print(f"[HEALTH] ===== SUMMARY: {connected}/{total} models connected =====")
    for role, mc in AGENT_MODELS.items():
        status = results.get(role, "NOT_TESTED")
        print(f"[HEALTH]   {role:12s} | {mc['model_id']:50s} | {status}")
    print(f"[HEALTH] ================================================")

    return {
        "status": "healthy" if connected == total else "partial" if connected > 0 else "no_models",
        "connected_count": connected,
        "total_models": total,
    }


@app.post("/api/v1/orchestrator/generate-paper/markdown")
def generate_paper():
    """Start async paper generation for a specific hypothesis (or top 5)."""
    try:
        body = app.current_event.json_body or {}
    except Exception:
        body = {}

    state = get_discovery_state()
    if not state or not state.get("hypotheses"):
        return Response(
            status_code=400,
            content_type="application/json",
            body=json.dumps({"detail": "No hypotheses available for paper generation"}),
        )

    config = state.get("config", {})
    hypothesis_id = body.get("hypothesis_id")

    # Store paper task in DynamoDB
    table = get_task_table()
    table.put_item(Item={
        "id": PAPER_TASK_KEY,
        "status": "generating",
        "hypothesis_id": hypothesis_id or "all",
        "paper_html": "",
        "error": "",
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    })

    # Invoke async paper worker
    print(f"[PAPER] Starting async paper generation for hypothesis={hypothesis_id or 'all'}")
    try:
        lambda_client.invoke(
            FunctionName=FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps({
                "source": "self-invoke",
                "action": "generate_paper",
                "hypothesis_id": hypothesis_id,
                "config": config,
            }, cls=DecimalEncoder),
        )
        print("[PAPER] Async invoke SUCCESS")
    except Exception as e:
        print(f"[PAPER] Async invoke FAILED: {e}")
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #e = :e",
            ExpressionAttributeNames={"#s": "status", "#e": "error"},
            ExpressionAttributeValues={":s": "failed", ":e": str(e)},
        )
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to start paper generation: {str(e)}"}),
        )

    return {"status": "generating", "hypothesis_id": hypothesis_id or "all"}


@app.post("/api/v1/orchestrator/cancel-paper")
def cancel_paper():
    """Cancel in-progress paper generation."""
    try:
        table = get_task_table()
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #u = :u",
            ExpressionAttributeNames={"#s": "status", "#u": "updated_at"},
            ExpressionAttributeValues={":s": "cancelled", ":u": datetime.utcnow().isoformat()},
        )
    except Exception as e:
        logger.error(f"Cancel paper failed: {e}")
    return {"status": "cancelled"}


@app.get("/api/v1/orchestrator/paper-status")
def get_paper_status():
    """Poll paper generation status."""
    try:
        table = get_task_table()
        response = table.get_item(Key={"id": PAPER_TASK_KEY})
        item = response.get("Item")
        if not item:
            return {"status": "idle", "paper_html": ""}
        status = item.get("status", "idle")
        # Treat cancelled as idle for the frontend
        if status == "cancelled":
            status = "idle"
        return serialize({
            "status": status,
            "paper_html": item.get("paper_html", ""),
            "error": item.get("error", ""),
        })
    except Exception as e:
        logger.error(f"Paper status error: {e}")
        return {"status": "error", "paper_html": "", "error": str(e)}


def run_paper_worker(hypothesis_id: str | None, config: dict):
    """Async worker: generate a rich research paper and store in DynamoDB."""
    print(f"[PAPER-WORKER] Starting for hypothesis={hypothesis_id or 'all'}")
    table = get_task_table()
    disease = config.get("disease", "Unknown Disease")
    discovery_type = config.get("discovery_type", "cure")

    state = get_discovery_state()
    if not state or not state.get("hypotheses"):
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #e = :e",
            ExpressionAttributeNames={"#s": "status", "#e": "error"},
            ExpressionAttributeValues={":s": "failed", ":e": "No hypotheses found"},
        )
        return

    # Select hypotheses
    if hypothesis_id and hypothesis_id != "all":
        target = next((h for h in state["hypotheses"] if h.get("id") == hypothesis_id), None)
        hypotheses_for_paper = [target] if target else state["hypotheses"][:3]
    else:
        hypotheses_for_paper = state["hypotheses"][:5]

    # Build hypothesis detail blocks
    hyp_blocks = []
    for i, h in enumerate(hypotheses_for_paper, 1):
        evidence = h.get("evidence_summary", [])
        evidence_str = "\n".join(f"   - {e}" for e in evidence) if evidence else "   - No specific evidence cited"
        risks = h.get("risks", [])
        risks_str = "\n".join(f"   - {r}" for r in risks) if risks else "   - No risks identified"
        validation = h.get("validation_steps", [])
        validation_str = "\n".join(f"   - {v}" for v in validation) if validation else "   - No validation steps"

        hyp_blocks.append(
            f"### Hypothesis {i}: {h.get('title', 'Untitled')} (Confidence: {h.get('confidence', 0):.0%})\n\n"
            f"**Description:** {h.get('description', '')}\n\n"
            f"**Mechanism of Action:** {h.get('mechanism', 'Not specified')}\n\n"
            f"**Supporting Evidence:**\n{evidence_str}\n\n"
            f"**Risks:**\n{risks_str}\n\n"
            f"**Validation Steps:**\n{validation_str}"
        )

    prompt = f"""Write a MAXIMUM-LENGTH, exhaustive research paper about {discovery_type} strategies for {disease}.

THIS PAPER MUST BE AS LONG AND DETAILED AS POSSIBLE. Use every available token.

Based on these AI-discovered hypotheses:

{chr(10).join(hyp_blocks)}

Write a complete research paper in Markdown format with ALL sections below.
Each section must be EXTENSIVE (multiple paragraphs with dense scientific content):

# {hypotheses_for_paper[0].get('title', disease)} — {discovery_type.title()} Discovery Report

## Abstract
(300+ words — background, methods, key findings, clinical implications)

## 1. Introduction
(500+ words — epidemiology with statistics, standard of care, unmet needs, rationale)

## 2. Methods
### 2.1 Multi-Agent AI Discovery Architecture
### 2.2 Knowledge Integration Framework
### 2.3 Confidence Scoring Methodology

## 3. Results
(For EACH hypothesis: molecular rationale, mechanism cascade, evidence, therapeutic protocol, endpoints)

## 4. Discussion
### 4.1 Comparative Analysis
### 4.2 Biological Plausibility
### 4.3 Clinical Translation Pathway
### 4.4 Safety Considerations
### 4.5 Limitations and Future Directions

## 5. Conclusion

## Tables
- Table 1: Hypothesis Comparison (Title | Targets | Mechanism | Confidence | TRL)
- Table 2: Biomarker Panel (Biomarker | Assay | Utility | Status)
- Table 3: Drug Properties (Name | Target | IC50/EC50 | Route | Phase)

## Figures
- Figure 1: Disease pathway diagram (use ASCII box diagrams with arrows)
- Figure 2: Mechanism of action flowchart (use ASCII flowchart)
- Figure 3: Clinical trial design schema

## References
(30+ numbered references: [N] Author et al., "Title," Journal, vol(issue):pages, year. DOI:...)

CRITICAL: Maximum length. Every sentence must be specific, quantitative, evidence-based."""

    system_prompt = """You are an elite biomedical research paper author. Write with Nature Medicine rigor, Phase III protocol detail, and FDA submission precision. Every claim backed by evidence. Proper nomenclature, quantitative data, formal academic structure. Write the LONGEST, most DETAILED paper possible."""

    try:
        print("[PAPER-WORKER] Calling Bedrock for paper generation (long timeout)...")
        # Use extended-timeout client for long paper generation inference
        _paper_client = bedrock_long or bedrock_runtime
        # Retry up to 2 times on timeout
        last_err = None
        paper_md = None
        for attempt in range(3):
            # Check if cancelled before each attempt
            paper_state = table.get_item(Key={"id": PAPER_TASK_KEY}).get("Item", {})
            if paper_state.get("status") in ("cancelled", "idle"):
                print("[PAPER-WORKER] Cancelled by user, aborting")
                return
            try:
                paper_md = call_bedrock(
                    model_id=PAPER_MODEL,
                    prompt=prompt,
                    system_prompt=system_prompt,
                    max_tokens=65536,
                    temperature=0.4,
                    client=_paper_client,
                )
                break
            except Exception as retry_err:
                last_err = retry_err
                err_str = str(retry_err).lower()
                if "timeout" in err_str or "timed out" in err_str:
                    print(f"[PAPER-WORKER] Attempt {attempt+1}/3 timed out, retrying...")
                    time.sleep(2)
                    continue
                raise  # Non-timeout errors fail immediately
        if paper_md is None:
            raise last_err or RuntimeError("Paper generation failed after retries")
        print(f"[PAPER-WORKER] Got {len(paper_md)} chars of markdown")

        # Convert markdown to rich HTML with professional typography
        paper_html = _markdown_to_rich_html(paper_md, disease, discovery_type, hypotheses_for_paper)

        # Store in DynamoDB (max item 400KB, paper should be well under)
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #p = :p, #u = :u",
            ExpressionAttributeNames={"#s": "status", "#p": "paper_html", "#u": "updated_at"},
            ExpressionAttributeValues={
                ":s": "done",
                ":p": paper_html,
                ":u": datetime.utcnow().isoformat(),
            },
        )
        print("[PAPER-WORKER] Paper saved to DynamoDB")
    except Exception as e:
        print(f"[PAPER-WORKER] FAILED: {e}")
        import traceback
        traceback.print_exc()
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #e = :e",
            ExpressionAttributeNames={"#s": "status", "#e": "error"},
            ExpressionAttributeValues={":s": "failed", ":e": str(e)},
        )


def _markdown_to_rich_html(md: str, disease: str, discovery_type: str, hypotheses: list) -> str:
    """Convert markdown paper to rich HTML with cover page, typography, diagrams."""
    date_str = datetime.utcnow().strftime("%B %d, %Y")
    title = hypotheses[0].get("title", disease) if hypotheses else disease

    # Extract title from markdown if present
    for line in md.split("\n"):
        if line.startswith("# "):
            title = line[2:].strip()
            break

    # Convert markdown to HTML
    body = md
    # Tables: convert markdown tables to HTML tables
    import re
    def _convert_table(match):
        lines = match.group(0).strip().split("\n")
        if len(lines) < 2:
            return match.group(0)
        html_parts = ['<table>']
        for idx, line in enumerate(lines):
            if set(line.strip().replace("|", "").replace("-", "").replace(":", "").strip()) == set():
                continue  # Skip separator line
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            tag = "th" if idx == 0 else "td"
            html_parts.append("<tr>" + "".join(f"<{tag}>{c}</{tag}>" for c in cells) + "</tr>")
        html_parts.append("</table>")
        return "\n".join(html_parts)

    body = re.sub(r'(?:^\|.+\|$\n?){2,}', _convert_table, body, flags=re.MULTILINE)

    # Headers
    body = re.sub(r'^#### (.+)$', r'<h4>\1</h4>', body, flags=re.MULTILINE)
    body = re.sub(r'^### (.+)$', r'<h3>\1</h3>', body, flags=re.MULTILINE)
    body = re.sub(r'^## (.+)$', r'<h2>\1</h2>', body, flags=re.MULTILINE)
    body = re.sub(r'^# (.+)$', r'<h1>\1</h1>', body, flags=re.MULTILINE)
    # Bold and italic
    body = re.sub(r'\*\*\*(.+?)\*\*\*', r'<strong><em>\1</em></strong>', body)
    body = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', body)
    body = re.sub(r'\*(.+?)\*', r'<em>\1</em>', body)
    # Lists
    body = re.sub(r'^- (.+)$', r'<li>\1</li>', body, flags=re.MULTILINE)
    body = re.sub(r'(<li>.*?</li>\n?)+', lambda m: f'<ul>{m.group(0)}</ul>', body)
    body = re.sub(r'^\d+\.\s+(.+)$', r'<li>\1</li>', body, flags=re.MULTILINE)
    # Code blocks (ASCII diagrams)
    body = re.sub(r'```[\w]*\n(.*?)```', r'<pre class="diagram">\1</pre>', body, flags=re.DOTALL)
    # Inline code
    body = re.sub(r'`([^`]+)`', r'<code>\1</code>', body)
    # Arrow notation in mechanisms
    body = body.replace("→", '<span class="arrow">→</span>')
    # References [N]
    body = re.sub(r'\[(\d+)\]', r'<sup class="ref">[\1]</sup>', body)
    # Paragraphs
    body = re.sub(r'\n{2,}', '</p><p>', body)
    body = re.sub(r'\n', '<br/>', body)

    # Build confidence badge
    conf = hypotheses[0].get("confidence", 0) if hypotheses else 0
    conf_color = "#22c55e" if conf >= 0.8 else "#eab308" if conf >= 0.6 else "#f97316"

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>{title}</title>
<style>
@page {{ margin: 0.8in; size: A4; }}
@media print {{ .no-print {{ display: none; }} .page-break {{ page-break-before: always; }} }}
:root {{ --brand: #6c63ff; --brand-light: #8b85ff; --dark: #0f0f1a; --text: #e2e2e8; --muted: #8888aa; --surface: #1a1a2e; --border: #2a2a3e; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--dark); color: var(--text); line-height: 1.8; }}
.paper {{ max-width: 900px; margin: 0 auto; background: var(--surface); min-height: 100vh; }}

/* Cover Page */
.cover {{ min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 80px 60px; background: linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 50%, #0f0f1a 100%); border-bottom: 4px solid var(--brand); position: relative; overflow: hidden; }}
.cover::before {{ content: ''; position: absolute; top: -50%; right: -50%; width: 100%; height: 100%; background: radial-gradient(circle, rgba(108,99,255,0.08) 0%, transparent 70%); }}
.cover-logo {{ font-size: 13px; letter-spacing: 10px; text-transform: uppercase; color: var(--brand); font-weight: 800; margin-bottom: 60px; position: relative; }}
.cover-line {{ width: 80px; height: 3px; background: linear-gradient(90deg, transparent, var(--brand), transparent); margin: 24px auto; }}
.cover-title {{ font-size: 28px; font-weight: 700; color: #fff; line-height: 1.3; margin-bottom: 20px; max-width: 700px; }}
.cover-subtitle {{ font-size: 15px; color: var(--muted); margin-bottom: 40px; }}
.cover-conf {{ display: inline-block; padding: 6px 20px; border-radius: 20px; font-size: 14px; font-weight: 700; color: #fff; background: {conf_color}33; border: 1px solid {conf_color}; margin-bottom: 40px; }}
.cover-author {{ font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 6px; }}
.cover-affil {{ font-size: 12px; letter-spacing: 4px; text-transform: uppercase; color: var(--brand-light); margin-bottom: 30px; }}
.cover-date {{ font-size: 13px; color: var(--muted); }}

/* Content */
.content {{ padding: 48px 56px; }}
h1 {{ font-size: 22px; color: #fff; border-bottom: 2px solid var(--brand); padding-bottom: 10px; margin: 40px 0 20px; font-weight: 700; }}
h2 {{ font-size: 19px; color: var(--brand-light); margin: 36px 0 16px; font-weight: 600; }}
h3 {{ font-size: 16px; color: #ccc; margin: 28px 0 12px; font-weight: 600; }}
h4 {{ font-size: 14px; color: var(--muted); margin: 20px 0 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }}
p {{ margin-bottom: 14px; font-size: 14px; }}
strong {{ color: #fff; }}
em {{ color: var(--brand-light); }}
code {{ background: #2a2a3e; padding: 2px 6px; border-radius: 3px; font-size: 13px; color: var(--brand-light); }}
.arrow {{ color: var(--brand); font-weight: bold; font-size: 16px; }}
sup.ref {{ color: var(--brand); font-size: 10px; cursor: pointer; }}
ul, ol {{ padding-left: 24px; margin: 12px 0; }}
li {{ margin-bottom: 8px; font-size: 14px; }}

/* Tables */
table {{ width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 13px; }}
th {{ background: var(--brand); color: #fff; padding: 10px 14px; text-align: left; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }}
td {{ padding: 10px 14px; border-bottom: 1px solid var(--border); }}
tr:nth-child(even) td {{ background: rgba(108,99,255,0.04); }}
tr:hover td {{ background: rgba(108,99,255,0.08); }}

/* Diagrams */
pre.diagram {{ background: #0d0d1a; border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin: 20px 0; font-family: 'Fira Code', 'Consolas', monospace; font-size: 12px; line-height: 1.6; color: var(--brand-light); overflow-x: auto; white-space: pre; }}

/* Footer */
.footer {{ text-align: center; padding: 30px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); margin-top: 60px; }}

/* Index/TOC */
.toc {{ background: rgba(108,99,255,0.05); border: 1px solid var(--border); border-radius: 8px; padding: 24px 32px; margin: 30px 0; }}
.toc-title {{ font-size: 14px; font-weight: 700; color: var(--brand); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 2px; }}
.toc-item {{ display: block; padding: 4px 0; font-size: 13px; color: var(--text); text-decoration: none; border-bottom: 1px dotted var(--border); }}
.toc-item:hover {{ color: var(--brand); }}
.toc-section {{ font-weight: 600; }}
.toc-sub {{ padding-left: 20px; color: var(--muted); }}
</style></head>
<body>
<div class="paper">
  <!-- Cover Page -->
  <div class="cover">
    <div class="cover-logo">humanovo</div>
    <div class="cover-line"></div>
    <div class="cover-title">{title}</div>
    <div class="cover-subtitle">{discovery_type.title()} Discovery Report for {disease}</div>
    <div class="cover-conf">Confidence: {conf:.0%}</div>
    <div class="cover-line"></div>
    <div class="cover-author">By humanovo</div>
    <div class="cover-affil">AI-Driven Biomedical Research Platform</div>
    <div class="cover-date">{date_str}</div>
  </div>

  <!-- Table of Contents -->
  <div class="content">
    <div class="toc">
      <div class="toc-title">Table of Contents</div>
      <span class="toc-item toc-section">Abstract</span>
      <span class="toc-item toc-section">1. Introduction</span>
      <span class="toc-item toc-section">2. Methods</span>
      <span class="toc-item toc-sub">2.1 Multi-Agent AI Architecture</span>
      <span class="toc-item toc-sub">2.2 Knowledge Integration</span>
      <span class="toc-item toc-sub">2.3 Confidence Scoring</span>
      <span class="toc-item toc-section">3. Results</span>
      <span class="toc-item toc-section">4. Discussion</span>
      <span class="toc-item toc-section">5. Conclusion</span>
      <span class="toc-item toc-section">Tables &amp; Figures</span>
      <span class="toc-item toc-section">References</span>
    </div>

    <!-- Paper Body -->
    <p>{body}</p>
  </div>

  <div class="footer">
    Generated by <strong>humanovo</strong> — Multi-Model Parallel AI Discovery System — {date_str}<br/>
    This paper was generated using {len(hypotheses)} AI-discovered hypothesis/hypotheses analyzed across 4 parallel agents.
  </div>
</div>
</body></html>"""


# ============== Agent Task Endpoints (API Gateway routes) ==============

@app.post("/api/v1/agents/tasks")
def create_agent_task():
    """Create an agent task (alternative endpoint)."""
    task_id = str(uuid4())
    return {"id": task_id, "status": "queued"}


@app.get("/api/v1/agents/tasks/<task_id>")
def get_agent_task(task_id: str):
    """Get agent task status."""
    return {"id": task_id, "status": "completed", "progress": 100}


# ============== Lambda Handler ==============

def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point.

    Handles both:
    1. API Gateway HTTP requests (normal API calls)
    2. Async self-invocations (background discovery work)

    Wrapped in top-level try/except to NEVER return 500 for API requests.
    """
    # Use print() to guarantee CloudWatch output regardless of Logger config
    raw_path = event.get("rawPath", "")
    method = event.get("requestContext", {}).get("http", {}).get("method", "?")
    stage = event.get("requestContext", {}).get("stage", "$default")
    print(f"[HANDLER] method={method} rawPath={raw_path} stage={stage}")

    try:
        # Check if this is a self-invocation for background work
        if event.get("source") == "self-invoke":
            action = event.get("action")
            print(f"[HANDLER] Self-invoke: action={action}")
            if action == "run_discovery":
                config = event.get("config", {})
                print(f"[HANDLER] Starting worker: disease={config.get('disease','?')}")
                try:
                    run_discovery_worker(config)
                    print(f"[HANDLER] Worker completed successfully")
                except Exception as worker_err:
                    print(f"[HANDLER] Worker CRASHED: {worker_err}")
                    import traceback
                    traceback.print_exc()
                    # Ensure status is set to idle so frontend isn't stuck
                    try:
                        update_discovery_state({"status": "idle"})
                    except Exception:
                        pass
                    raise
                return {"status": "completed"}
            elif action == "generate_paper":
                hypothesis_id = event.get("hypothesis_id")
                paper_config = event.get("config", {})
                print(f"[HANDLER] Starting paper worker: hypothesis={hypothesis_id}")
                try:
                    run_paper_worker(hypothesis_id, paper_config)
                    print(f"[HANDLER] Paper worker completed successfully")
                except Exception as paper_err:
                    print(f"[HANDLER] Paper worker CRASHED: {paper_err}")
                    import traceback
                    traceback.print_exc()
                    # Mark paper as failed so frontend isn't stuck
                    try:
                        table = get_task_table()
                        table.update_item(
                            Key={"id": PAPER_TASK_KEY},
                            UpdateExpression="SET #s = :s, #e = :e",
                            ExpressionAttributeNames={"#s": "status", "#e": "error"},
                            ExpressionAttributeValues={":s": "failed", ":e": str(paper_err)},
                        )
                    except Exception:
                        pass
                return {"status": "completed"}

        # Normalize rawPath for route matching.
        # API Gateway HTTP API v2 with named stage (e.g. "dev") includes
        # the stage prefix in rawPath: /dev/api/v1/orchestrator/status
        # Routes are registered as /api/v1/orchestrator/status (no prefix).
        #
        # - Stub resolver & powertools v2: need rawPath WITHOUT stage prefix
        # - Powertools v3: needs rawPath WITH stage prefix (strips it internally)
        _pt_major = 0
        try:
            import aws_lambda_powertools
            _pt_version = getattr(aws_lambda_powertools, "__version__", "0.0.0")
            _pt_major = int(_pt_version.split(".")[0])
            print(f"[HANDLER] powertools_version={_pt_version} pt_major={_pt_major}")
        except Exception:
            print("[HANDLER] powertools not available, using stub resolver")

        if stage and stage != "$default":
            stage_prefix = f"/{stage}"
            has_prefix = raw_path.startswith(f"{stage_prefix}/") or raw_path == stage_prefix

            if _pt_major >= 3:
                # v3 expects rawPath WITH /{stage} prefix (it strips internally)
                if not has_prefix:
                    event["rawPath"] = f"{stage_prefix}{raw_path}"
                    rc_http = event.get("requestContext", {}).get("http", {})
                    if rc_http:
                        rc_http["path"] = f"{stage_prefix}{rc_http.get('path', raw_path)}"
                    print(f"[HANDLER] v3: Added stage prefix -> {event['rawPath']}")
                # else: already has prefix, v3 will strip it correctly
            else:
                # Stub and v2 expect rawPath WITHOUT /{stage} prefix
                if has_prefix:
                    stripped = raw_path[len(stage_prefix):]
                    if not stripped:
                        stripped = "/"
                    event["rawPath"] = stripped
                    rc_http = event.get("requestContext", {}).get("http", {})
                    if rc_http:
                        old_http_path = rc_http.get("path", raw_path)
                        if old_http_path.startswith(f"{stage_prefix}"):
                            rc_http["path"] = old_http_path[len(stage_prefix):] or "/"
                    print(f"[HANDLER] stub/v2: Stripped stage prefix -> {event['rawPath']}")
                # else: no prefix, already correct for v2/stub

        # Handle as API Gateway request
        print(f"[HANDLER] Resolving with rawPath={event.get('rawPath', '')}")
        result = app.resolve(event, context)
        result_status = result.get("statusCode", "?") if isinstance(result, dict) else "?"
        print(f"[HANDLER] Resolved statusCode={result_status}")
        return result
    except Exception as e:
        logger.error(f"Top-level handler error: {e}")
        # Return a valid API Gateway v2 response so the client gets JSON, not 500
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "state": "idle",
                "stats": None,
                "top_hypotheses": [],
                "detail": f"Internal error: {str(e)}",
            }),
        }
