#!/usr/bin/env python3
"""
Constant AI Chat Server — Standalone FastAPI server for the HumaNovo chat endpoint.

Connects to AWS Bedrock Claude Opus 4.6 (primary) with Azure text-embedding-3-large
RAG grounding. Falls back to a comprehensive biomedical knowledge engine when
cloud credentials are not configured.

Usage:
    python chat_server.py              # Starts on port 8000
    python chat_server.py --port 8000  # Specify port

Environment variables (or .env file in project root):
    AWS_ACCESS_KEY_ID       — AWS IAM access key for Bedrock
    AWS_SECRET_ACCESS_KEY   — AWS IAM secret key for Bedrock
    AWS_REGION              — AWS region (default: us-east-1)
    AZURE_EMBEDDING_ENDPOINT — Azure OpenAI endpoint for text-embedding-3-large
    AZURE_EMBEDDING_KEY      — Azure OpenAI API key for embeddings
"""

import json
import os
import re
import sys
import logging
from pathlib import Path
from typing import Optional

# ── Load .env if present ────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip("'\"")
            if key and val:
                os.environ.setdefault(key, val)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("constant-chat")

app = FastAPI(title="Constant AI Chat Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ──────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    context: str = "general"
    platform_context: dict = {}


# ── System Prompt ───────────────────────────────────────────────────────
CONSTANT_SYSTEM_PROMPT = """You are Constant, an AI research tutor and assistant built into the HumaNovo biomedical discovery platform. You serve as both a knowledgeable research companion and an educational tutor who helps users learn and grow as researchers.

HumaNovo is a platform for biomedical hypothesis generation, evidence gathering, and drug discovery. It uses multi-model AI orchestration (Claude, Mistral, GPT, Cohere, Grok) across an 11-stage discovery pipeline to explore biological pathways and discover potential treatments.

Your capabilities:
1. **Research Tutoring & Education:**
   - Teach and explain molecular biology, pharmacology, genetics, biochemistry, immunology, cell biology, and biomedical research methodology
   - Break down complex biological concepts into understandable explanations with examples
   - Explain statistical methods (t-tests, ANOVA, survival analysis, regression) and when to use them
   - Teach experimental design principles, controls, sample sizing, and bias mitigation
   - Explain genomics concepts (pathway enrichment, GSEA, variant annotation, biomarkers)
   - Guide users through reading and interpreting research papers and clinical trial data
   - Explain disease mechanisms, drug mechanisms of action, and pharmacokinetics
   - Teach about research ethics, regulatory pathways (FDA, EMA), and GLP/GMP compliance

2. **Platform Assistance:**
   - Help researchers formulate and refine hypotheses about disease mechanisms
   - Suggest experimental designs and validation strategies based on platform evidence
   - Analyze and discuss drug repurposing, combination therapies, and biomarkers
   - Guide users on using HumaNovo features (projects, discovery, simulations, evidence search, workbench, notebook, statistical analysis, genomics analysis, knowledge graph)

3. **Research Companion:**
   - Discuss and reference specific hypotheses, evidence, and projects from the platform
   - Help interpret simulation results and statistical outputs
   - Suggest next steps in the research workflow
   - Help draft research notes, experiment protocols, and manuscript sections

4. **Workbench & Knowledge Graph:**
   - When in workbench context, explain biological relationships between nodes on the graph
   - Suggest connections between biological entities
   - Recommend new nodes to add based on the current graph context
   - Explain signaling pathways, protein interactions, and gene regulatory networks

Guidelines:
- Be conversational and natural — talk like a knowledgeable research mentor, not a robot
- When teaching, use analogies and real-world examples to make concepts accessible
- Be scientifically accurate and cite specific genes, proteins, pathways, and mechanisms
- When discussing hypotheses, consider confidence levels, supporting evidence, and potential confounders
- If the user provides platform context (projects, hypotheses, evidence), use it extensively
- If RAG context is provided below, use it as your primary source of truth
- Proactively offer to teach related concepts when they come up naturally
- Format responses clearly with short paragraphs; use markdown for structure when explaining complex topics
- Never fabricate data — if you don't have enough platform context, say so and use your biomedical knowledge to educate"""


# ── AWS Bedrock Claude Opus 4.6 ────────────────────────────────────────
async def call_bedrock_claude(user_content: str) -> Optional[str]:
    """Call AWS Bedrock Claude Opus 4.6 via boto3 Converse API."""
    access_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
    secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
    region = os.environ.get("AWS_REGION", "us-east-1")
    model_id = os.environ.get("BEDROCK_MODEL_CLAUDE_OPUS", "us.anthropic.claude-opus-4-6-v1:0")

    if not access_key or not secret_key:
        return None

    try:
        import boto3
        client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
        response = client.converse(
            modelId=model_id,
            system=[{"text": CONSTANT_SYSTEM_PROMPT}],
            messages=[{"role": "user", "content": [{"text": user_content}]}],
            inferenceConfig={"maxTokens": 2048, "temperature": 0.5},
        )
        content_blocks = response.get("output", {}).get("message", {}).get("content", [])
        if content_blocks:
            return content_blocks[0].get("text", "")
    except Exception as e:
        logger.warning(f"Bedrock Claude error: {e}")

    return None


# ── Azure text-embedding-3-large RAG ───────────────────────────────────
async def retrieve_rag_context(query: str) -> str:
    """Retrieve RAG context using Azure text-embedding-3-large embeddings."""
    endpoint = os.environ.get("AZURE_EMBEDDING_ENDPOINT", "")
    key = os.environ.get("AZURE_EMBEDDING_KEY", "")
    deployment = os.environ.get("AZURE_OPENAI_EMBEDDING_DEPLOYMENT_LARGE", "text-embedding-3-large")
    api_version = os.environ.get("AZURE_EMBEDDING_API_VERSION", "2023-05-15")
    chroma_dir = os.environ.get("CHROMA_PERSIST_DIRECTORY", "./data/chroma")

    if not endpoint or not key:
        return ""

    try:
        import httpx
        embed_url = f"{endpoint.rstrip('/')}/openai/deployments/{deployment}/embeddings?api-version={api_version}"

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                embed_url,
                headers={"api-key": key},
                json={"input": query, "model": deployment},
            )
            if resp.status_code != 200:
                return ""

            query_embedding = resp.json().get("data", [{}])[0].get("embedding", [])
            if not query_embedding:
                return ""

            # Search ChromaDB vector store
            try:
                import chromadb
                chroma_client = chromadb.PersistentClient(path=chroma_dir)
                for coll_name in ["evidence", "documents", "humanovo_evidence", "default"]:
                    try:
                        collection = chroma_client.get_collection(coll_name)
                        results = collection.query(
                            query_embeddings=[query_embedding],
                            n_results=8,
                            include=["documents", "metadatas"],
                        )
                        docs = results.get("documents", [[]])[0]
                        if docs:
                            return "\n\n".join(docs[:8])
                    except Exception:
                        continue
            except ImportError:
                logger.info("chromadb not installed — skipping vector store RAG")
            except Exception as e:
                logger.debug(f"ChromaDB error: {e}")

    except ImportError:
        logger.info("httpx not installed — skipping Azure embedding RAG")
    except Exception as e:
        logger.warning(f"RAG retrieval error: {e}")

    return ""


# ── Azure GPT-4o fallback ──────────────────────────────────────────────
async def call_azure_gpt4o(user_content: str) -> Optional[str]:
    """Call Azure GPT-4o as fallback."""
    endpoint = os.environ.get("AZURE_GPT4O_ENDPOINT", "")
    key = os.environ.get("AZURE_GPT4O_KEY", "")
    deployment = os.environ.get("AZURE_GPT4O_DEPLOYMENT", "gpt-4o")
    api_version = os.environ.get("AZURE_GPT4O_API_VERSION", "2024-11-20")

    if not endpoint or not key:
        return None

    try:
        import httpx
        url = f"{endpoint.rstrip('/')}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                url,
                headers={"api-key": key},
                json={
                    "messages": [
                        {"role": "system", "content": CONSTANT_SYSTEM_PROMPT},
                        {"role": "user", "content": user_content},
                    ],
                    "max_tokens": 2048,
                    "temperature": 0.5,
                },
            )
            if resp.status_code == 200:
                choices = resp.json().get("choices", [])
                if choices:
                    return choices[0].get("message", {}).get("content", "")
    except Exception as e:
        logger.warning(f"Azure GPT-4o error: {e}")

    return None


# ── Comprehensive knowledge engine (no-cloud fallback) ─────────────────
KNOWLEDGE_BASE = {
    "p53|tp53|tumor protein|guardian of the genome": """**TP53 (p53)** is often called the "guardian of the genome." It's a transcription factor that responds to cellular stress signals like DNA damage, oncogene activation, and hypoxia.

**How it works:**
- When DNA is damaged, kinases like ATM/ATR phosphorylate p53, stabilizing it
- p53 then activates target genes depending on damage severity:
  - **Cell cycle arrest:** p21 (CDKN1A) blocks cyclin-CDK complexes → G1/S arrest
  - **DNA repair:** GADD45 promotes nucleotide excision repair
  - **Apoptosis:** BAX, PUMA, NOXA activate the mitochondrial death pathway
  - **Senescence:** sustained p21 and RB activation

**Clinical significance:**
- Mutated in ~50% of all human cancers (most commonly R175H, R248W, R273H)
- Li-Fraumeni syndrome: germline TP53 mutations → early-onset cancers
- MDM2 amplification is another way cancers inactivate p53
- Therapeutic targets: MDM2 inhibitors (nutlin-3a, idasanutlin), p53 reactivators (APR-246/eprenetapopt)

**The MDM2-p53 feedback loop:**
MDM2 ubiquitinates p53 for proteasomal degradation. p53 transcriptionally activates MDM2. This creates a negative feedback loop that keeps p53 levels low in unstressed cells. DNA damage breaks this loop by phosphorylating p53 at sites that block MDM2 binding.""",

    "brca|breast cancer gene": """**BRCA1 and BRCA2** are tumor suppressor genes essential for DNA double-strand break repair via homologous recombination (HR).

**BRCA1** (chromosome 17q21):
- Forms the BRCA1-PALB2-BRCA2-RAD51 complex
- Recruited to DSBs via ubiquitin signaling (RNF8/RNF168)
- Associated cancers: breast (60-80% lifetime risk), ovarian (40-60%), prostate, pancreatic

**BRCA2** (chromosome 13q12):
- Direct RAD51 loader — loads RAD51 recombinase onto single-stranded DNA
- Associated cancers: breast (45-70% lifetime risk), ovarian (15-30%)

**Synthetic lethality — the therapeutic breakthrough:**
BRCA-deficient cells rely on base excision repair. **PARP inhibitors** (olaparib, rucaparib, niraparib, talazoparib) block BER by trapping PARP1 on DNA. With both repair pathways disabled, cancer cells die while normal cells survive.

**Resistance mechanisms:** Reversion mutations, 53BP1 loss, PARP1 mutations, drug efflux pumps.""",

    "crispr|cas9|gene edit": """**CRISPR-Cas9** is a revolutionary gene editing technology adapted from bacterial adaptive immunity.

**Mechanism:**
1. **Guide RNA (sgRNA)** — ~20nt sequence complementary to target DNA + Cas9 scaffold
2. **Cas9 nuclease** — recognizes PAM sequence (NGG) adjacent to target
3. **DNA cleavage** — blunt-ended DSB 3bp upstream of PAM
4. **Repair:** NHEJ (knockouts) or HDR (precise edits with donor template)

**Variants:**
- **Base editors:** C→T or A→G without DSBs
- **Prime editing:** search-and-replace using pegRNA + Cas9-RT fusion
- **CRISPRi/CRISPRa:** dCas9 + repressors/activators for regulation without cutting
- **Cas13:** targets RNA for knockdown and diagnostics

**Clinical applications:** CASGEVY for sickle cell disease (first approved 2023), beta-thalassemia, CAR-T engineering, HIV cure research.""",

    "apoptosis|programmed cell death": """**Apoptosis** is a tightly regulated form of programmed cell death.

**Intrinsic (mitochondrial) pathway:**
Stress → BH3-only proteins (BIM, BID, BAD, PUMA) → neutralize BCL-2/BCL-XL/MCL-1 → BAX/BAK oligomerize → MOMP → cytochrome c → apoptosome (APAF-1) → caspase-9 → caspase-3/7

**Extrinsic (death receptor) pathway:**
Death ligands (FasL, TRAIL, TNF-α) → death receptors → FADD → DISC → caspase-8 → caspase-3 (or BID cleavage to amplify via mitochondria)

**Executioner phase:** Caspase-3/7 cleave >1000 substrates: ICAD (DNA fragmentation), lamin A (nuclear breakdown), PARP (prevents repair)

**Cancer connection:** Venetoclax (BCL-2 inhibitor), SMAC mimetics (IAP antagonists), TRAIL receptor agonists.""",

    "immunotherapy|checkpoint|pd-1|pd-l1|ctla-4|car-t": """**Cancer Immunotherapy** harnesses the immune system against cancer.

**Checkpoint inhibitors:**
- **Anti-PD-1** (pembrolizumab, nivolumab): restore exhausted T cells
- **Anti-PD-L1** (atezolizumab, durvalumab): block tumor's immune evasion
- **Anti-CTLA-4** (ipilimumab): enhance T cell activation in lymph nodes

**Biomarkers:** PD-L1 (IHC), TMB, MSI-H/dMMR, TILs

**CAR-T therapy:**
Harvest T cells → engineer with chimeric antigen receptor (scFv + CD3ζ + 4-1BB/CD28) → expand → infuse
- Approved: tisagenlecleucel (CD19), axicabtagene ciloleucel (CD19), idecabtagene vicleucel (BCMA)
- CRS managed with tocilizumab + steroids""",

    "kinase|phosphorylation|signaling cascade|mapk|pi3k": """**Protein Kinases** are enzymes that phosphorylate substrates, acting as molecular switches.

**RAS-MAPK cascade:** RTK → GRB2/SOS → RAS-GTP → RAF → MEK → ERK → transcription (MYC, FOS, JUN)
- KRAS mutations: ~25% of cancers (sotorasib, adagrasib for G12C)
- BRAF V600E: vemurafenib, dabrafenib

**PI3K-AKT-mTOR:** RTK → PI3K → PIP3 → AKT → mTOR/GSK3β/FOXO
- PTEN is the negative regulator
- Targeted by alpelisib (PI3Kα), everolimus (mTOR), capivasertib (AKT)

**JAK-STAT:** Cytokine receptors → JAK1/2/3 → STAT phosphorylation/dimerization → gene expression
- Ruxolitinib (myelofibrosis), tofacitinib (RA)

**CDKs:** Cell cycle control — palbociclib, ribociclib (CDK4/6 inhibitors for breast cancer)""",

    "epigenetics|methylation|histone|chromatin": """**Epigenetics** — heritable gene expression changes without DNA sequence alteration.

**DNA methylation:** CpG dinucleotides methylated by DNMTs → gene silencing
- DNMT1 (maintenance), DNMT3A/3B (de novo)
- TET enzymes demethylate (5mC → 5hmC → 5fC → 5caC)
- Cancer: global hypomethylation + focal hypermethylation
- Drugs: azacitidine, decitabine (MDS/AML)

**Histone modifications:**
- Acetylation (HATs: p300) → open chromatin; HDACs close it → vorinostat
- H3K4me3: active promoters; H3K27me3: Polycomb repression (EZH2 → tazemetostat)
- H3K9me3: heterochromatin; H3K36me3: active gene bodies

**Chromatin remodeling:** SWI/SNF (BAF/PBAF) complexes — mutated in ~20% of cancers""",

    "rett syndrome|mecp2": """**Rett Syndrome** — rare neurodevelopmental disorder from MECP2 mutations (Xq28).

**Epidemiology:** ~1 in 10,000-15,000 females. Hemizygous males usually don't survive.

**Clinical stages:**
1. Early onset (6-18mo): developmental stagnation
2. Rapid regression (1-4yr): loss of hand skills, speech; stereotypic hand movements
3. Plateau: some social improvement, motor problems persist
4. Late deterioration: reduced mobility, scoliosis

**Molecular mechanism:** MeCP2 reads CpG methylation, recruits NCoR/SMRT corepressor. Loss dysregulates BDNF, DLX5, and thousands of neuronal genes → impaired synaptic maturation.

**Therapeutics:**
- **Trofinetide (DAYBUE™):** First FDA-approved treatment (2023) — IGF-1 tripeptide analog
- **Gene therapy:** AAV9-MECP2 (clinical trials — dose is critical)
- **X-reactivation:** Reactivating silent X chromosome copy (experimental)""",

    "statistics|t-test|p-value|significance|hypothesis test": """**Statistical Hypothesis Testing:**

**Core concepts:**
- **p-value:** P(data ≥ observed | H₀ true). NOT P(H₀ true | data)!
- **Type I error (α):** False positive (rejecting true H₀)
- **Type II error (β):** False negative (missing real effect)
- **Power (1-β):** P(detecting true effect) — aim ≥0.80

**Common tests:**
- **Student's t-test:** 2 groups mean comparison. Welch's if unequal variance.
- **ANOVA:** 3+ groups. F = between-group var / within-group var. Post-hoc: Tukey/Bonferroni.
- **Chi-squared:** Categorical variable association.
- **Mann-Whitney U / Wilcoxon:** Non-parametric alternatives.

**Effect size matters!** Cohen's d: small 0.2, medium 0.5, large 0.8. Statistical significance ≠ clinical significance.

**Multiple testing:** Bonferroni (conservative), Benjamini-Hochberg FDR (recommended for genomics).

Run these in the **Statistics** section of HumaNovo!""",

    "regression|linear model|logistic": """**Regression Analysis:**

**Linear:** Y = β₀ + β₁X + ε. R² = variance explained. Check residuals for assumptions.
**Multiple:** Y = β₀ + Σβᵢxᵢ + ε. Watch VIF for multicollinearity.
**Logistic:** log(p/(1-p)) = β₀ + β₁X. Odds ratio = e^β. For binary outcomes.
**Cox PH:** h(t) = h₀(t)·exp(βX). Hazard ratios for survival data.
**Regularization:** LASSO (L1, feature selection), Ridge (L2, multicollinearity), Elastic Net (both).

Available in the **Statistics** section!""",

    "survival analysis|kaplan|cox|hazard": """**Survival Analysis** — time-to-event data with censoring.

**Kaplan-Meier:** Non-parametric survival curve. Ŝ(t) = ∏(1 - dᵢ/nᵢ). Median = time at Ŝ=0.50.
**Log-rank test:** Compares curves. χ² with df = groups-1.
**Cox PH:** Semi-parametric. HR > 1 = higher risk. Check PH assumption with Schoenfeld residuals.

**Clinical endpoints:** OS, PFS, DFS, TTP, EFS.

Run survival analysis in **Statistics**!""",

    "pathway|enrichment|kegg|reactome|gene ontology": """**Pathway Enrichment Analysis** identifies over-represented biological pathways.

**Method:** Hypergeometric test on gene overlap with curated pathway databases.
**Databases:** KEGG (~350 pathways), Reactome (~2,500), Gene Ontology (BP, MF, CC — ~45,000 terms).
**Correction:** BH FDR (q < 0.05 standard).
**Visualization:** Dot plots, bar plots, enrichment maps.

Run in **Genomics** section!""",

    "gsea|gene set enrichment": """**GSEA** uses entire ranked gene lists (not just significant genes) to detect coordinated changes.

**Algorithm:** Walk ranked list → increase score for genes in set, decrease otherwise → ES = max deviation → permutation null → NES → FDR q-value.
**Leading edge:** Core genes driving the signal.
**Threshold:** FDR q < 0.25 (standard for GSEA).

Run GSEA in **Genomics**!""",

    "variant|snp|mutation|annotation|sift|polyphen|cadd": """**Variant Annotation** — characterizing genetic variant impact.

**Types:** SNV, indel, CNV, structural variants.
**Consequences:** Synonymous, missense, nonsense, frameshift, splice site.
**Prediction tools:**
- SIFT: conservation-based (< 0.05 = damaging)
- PolyPhen-2: sequence + structure (> 0.85 = probably damaging)
- CADD: 60+ annotations combined (Phred > 20 = top 1%)
- REVEL, AlphaMissense: ensemble approaches

**Databases:** ClinVar, gnomAD, COSMIC, OMIM.

Annotate in **Genomics** section!""",

    "sample size|power analysis|power calculation": """**Sample Size Calculation:**
n per group = 2 × ((z_α/2 + z_β) × σ/Δ)²

**Rules of thumb (Cohen's d, α=0.05, power=0.80):**
- Small (d=0.2): ~393/group
- Medium (d=0.5): ~64/group
- Large (d=0.8): ~26/group

Always account for ~10-20% dropout. Available in **Statistics**!""",

    "clinical trial|phase 1|phase 2|phase 3|fda": """**Clinical Trial Phases:**

**Preclinical → IND** → **Phase I** (20-100, safety/MTD) → **Phase II** (50-300, efficacy signal) → **Phase III** (300-3000+, confirmatory) → **NDA/BLA** → **Phase IV** (post-marketing).

**Special pathways:** Breakthrough therapy, fast track, accelerated approval, priority review.
**Timeline:** ~10-15 years, $1-2B. Success rate: ~5-10% from Phase I to approval.""",

    "drug|pharmacology|mechanism of action|pharmacokinetics": """**Pharmacology Fundamentals:**

**PK (body → drug):** Absorption (bioavailability), Distribution (Vd, protein binding), Metabolism (CYP450), Excretion (renal/hepatic, t½)
**PD (drug → body):** Agonists/antagonists, dose-response (EC50, Emax), therapeutic index

**Drug development:** Discovery → preclinical (3-6yr) → Phase I-III (5-8yr) → approval → Phase IV""",

    "dna repair|genome instability": """**DNA Repair Mechanisms:**
- **BER:** Small base lesions. DNA glycosylase → AP site → APE1 → Pol β → ligase.
- **NER:** Bulky adducts/UV damage. XPC → TFIIH → XPF/XPG excision → patch repair.
- **MMR:** Replication errors. MSH2/MSH6 detect → MLH1/PMS2 nick → exonuclease → Pol δ. Defects → Lynch syndrome.
- **HR:** Faithful DSB repair (S/G2). MRN → resection → RPA → BRCA1/2 → RAD51 → strand invasion.
- **NHEJ:** Fast, error-prone DSB repair. Ku70/80 → DNA-PKcs → Ligase IV.""",

    "rna|mrna|transcription|translation": """**Gene Expression:**

**Transcription:** Pol II + GTFs → promoter recognition → elongation → co-transcriptional capping + splicing + polyadenylation
**Translation:** eIF4E/4G/4A scan → 43S PIC → AUG recognition → 80S → elongation (eEF1A, eEF2) → termination (eRF1/3)

**mRNA therapeutics:** N1-methylpseudouridine reduces innate sensing. LNP delivery. BNT162b2/mRNA-1273 for COVID-19.""",

    "pcr|polymerase chain reaction|qpcr": """**PCR** amplifies specific DNA sequences exponentially.
**Steps:** Denature (94-98°C) → Anneal (50-65°C) → Extend (72°C). 30 cycles ≈ 10⁹ copies.
**Variants:** qPCR (fluorescent quantification), RT-PCR (RNA → cDNA first), dPCR (absolute quantification), multiplex, nested.""",

    "machine learning|deep learning|ai in research|alphafold": """**AI/ML in Biomedical Research:**
- **AlphaFold2/3:** Protein structure from sequence (near-experimental accuracy)
- **Drug discovery:** Virtual screening, de novo design (diffusion models), ADMET prediction
- **Genomics:** DeepVariant, SpliceAI, Enformer
- **Clinical:** Risk stratification, treatment response prediction
- **Methods:** Random forests (biomarkers), CNNs (imaging), transformers (NLP, protein), GNNs (molecular graphs)""",

    "biomarker|diagnostic marker|prognostic": """**Biomarkers:**
- **Diagnostic:** Detect disease (PSA, troponin)
- **Prognostic:** Predict outcome (Ki-67, gene expression signatures)
- **Predictive:** Predict treatment response (HER2 for trastuzumab, EGFR for erlotinib)
- **Pharmacodynamic:** Measure drug effect

Discovery: Compare molecular profiles between groups, validate in independent cohorts. Run in **Genomics**!""",
}


def knowledge_engine_response(message: str, platform_context: dict) -> str:
    """Generate intelligent response using comprehensive knowledge base."""
    q = message.lower().strip()

    # ── Greetings ──
    if re.match(r"^(hi|hey|hello|howdy|yo|sup|what'?s up|good\s*(morning|afternoon|evening))[\s!.?]*$", q, re.I):
        projects = len(platform_context.get("projects", []))
        hypotheses = len(platform_context.get("hypotheses", []))
        if projects > 0 or hypotheses > 0:
            return f"Hey! Great to see you. You've got **{projects}** project{'s' if projects != 1 else ''} and **{hypotheses}** hypothes{'es' if hypotheses != 1 else 'is'} going. What would you like to work on?"
        return "Hey there! I'm Constant, your AI research companion on HumaNovo. I can help you learn biology, statistics, and genomics concepts, navigate the platform, or discuss your research. What's on your mind?"

    # ── Personal introductions ──
    m = re.match(r"^(?:i am|i'm|my name is|call me)\s+(.+)", q, re.I)
    if m:
        name = m.group(1).rstrip(".!? ")
        return f"Nice to meet you, {name}! I'm Constant — your research companion here on HumaNovo. I'm knowledgeable in molecular biology, pharmacology, genomics, statistics, and research methodology. What are you curious about?"

    # ── Thanks ──
    if re.match(r"^(thanks?|thank you|thx|ty|cheers|appreciate)[\s!.]*$", q, re.I):
        return "You're welcome! I'm always here to help with your research. Don't hesitate to ask about anything."

    # ── How are you ──
    if re.search(r"how are you|how('?re| are) (you|u) doing|how('?s| is) it going", q, re.I):
        return "I'm doing great, thanks for asking! I love helping researchers explore new ideas. What can I help you with today?"

    # ── What can you do ──
    if re.search(r"what (can|do) you do|help me|capabilities|tour|guide", q, re.I):
        return """Great question! Here's what I can do:

**Teach & Explain:**
- Molecular biology, pharmacology, genetics, epigenetics
- Statistics: hypothesis testing, regression, survival analysis
- Genomics: pathway enrichment, GSEA, variant annotation
- Research methodology, experimental design, clinical trials

**Platform Navigation:**
- Guide you to any tool on HumaNovo
- Explain how each feature works

**Research Support:**
- Discuss hypotheses and suggest experiments
- Help interpret results
- Explain disease mechanisms and therapeutics

Just ask naturally!"""

    # ── Navigation ──
    nav_patterns = [
        (r"dashboard", "Head to the **Dashboard** — it shows your research overview, recent activity, and quick stats."),
        (r"project", "Go to **Projects** in the sidebar to create/manage projects and generate research papers."),
        (r"discover|hypothes", "Open **Discovery** — enter a disease and let the AI generate novel hypotheses."),
        (r"workbench|graph|knowledge", "Open the **Workbench** to build biological knowledge graphs visually."),
        (r"notebook|note", "Go to **Notebook** under Tools for research notes with Markdown support."),
        (r"simulat", "Head to **Simulations** for Monte Carlo simulations on hypotheses."),
        (r"statistic|t-test|anova|regression", "Go to **Statistics** under Analysis for hypothesis testing, regression, and more."),
        (r"genom|pathway|gsea|variant", "Open **Genomics** under Analysis for pathway enrichment, GSEA, and variant annotation."),
        (r"search", "Use **Search** or **Cmd/Ctrl+K** to find anything across your data."),
        (r"setting", "Go to **Settings** at the bottom of the sidebar."),
    ]
    if re.search(r"where|how (do i|to|can i).*(find|get|go|navigate|open|use|start)|take me to|go to|open|show me", q, re.I):
        for pattern, response in nav_patterns:
            if re.search(pattern, q, re.I):
                return response
        return "I can help you find anything! Try asking about a specific section."

    # ── Knowledge base lookup ──
    for keys, explanation in KNOWLEDGE_BASE.items():
        patterns = keys.split("|")
        if any(p.lower() in q for p in patterns):
            return explanation + "\n\nWant me to go deeper on any aspect of this?"

    # ── Search user data ──
    hypotheses = platform_context.get("hypotheses", [])
    projects = platform_context.get("projects", [])
    words = [w for w in q.split() if len(w) > 3]

    matching_hyps = [
        h for h in hypotheses
        if any(w in " ".join(filter(None, [
            h.get("title", ""), h.get("mechanism", ""), h.get("disease", "")
        ])).lower() for w in words)
    ]

    if matching_hyps:
        items = []
        for i, h in enumerate(matching_hyps[:3]):
            item = f"{i+1}. **{h.get('title', 'Untitled')}**"
            if h.get("confidence"):
                item += f" ({round(h['confidence'] * 100)}% confidence)"
            if h.get("mechanism"):
                mech = h["mechanism"][:150]
                item += f"\n   {mech}{'...' if len(h['mechanism']) > 150 else ''}"
            items.append(item)
        return f"I found **{len(matching_hyps)}** relevant hypothes{'is' if len(matching_hyps) == 1 else 'es'}:\n\n" + "\n\n".join(items) + "\n\nWant me to explain the biology behind any of these?"

    # ── Research status ──
    if re.search(r"how many|count|total|overview|summary|status|my research", q, re.I):
        tp = len(projects)
        th = len(hypotheses)
        tpa = len(platform_context.get("papers", []))
        return f"Your research overview:\n\n- **{tp}** project{'s' if tp != 1 else ''}\n- **{th}** hypothes{'es' if th != 1 else 'is'}\n- **{tpa}** research paper{'s' if tpa != 1 else ''}\n\nWhat would you like to explore?"

    # ── Educational intent ──
    if re.search(r"what is|explain|teach|how does|define|tell me about|what are|why|describe|compare|difference", q, re.I):
        topic_m = re.search(r"(?:what is|explain|tell me about|describe|how does)\s+(.+?)(?:\?|$)", q, re.I)
        topic = topic_m.group(1).strip() if topic_m else "that topic"
        return f"""That's a great question about **{topic}**! I can explain many biomedical topics in depth:

**Biology:** p53, BRCA, CRISPR, apoptosis, kinases, DNA repair, epigenetics, RNA biology, immunotherapy
**Statistics:** t-tests, ANOVA, regression, survival analysis, sample size
**Genomics:** pathway enrichment, GSEA, variant annotation, biomarkers
**Pharmacology:** drug mechanisms, clinical trials, pharmacokinetics
**Methods:** experimental design, hypothesis formulation, machine learning in research

Could you be more specific about what aspect of **{topic}** you'd like to explore?"""

    # ── Default ──
    tp = len(projects)
    th = len(hypotheses)
    if tp == 0 and th == 0:
        return "Welcome! Try:\n\n1. **Run a Discovery** — generate AI-powered hypotheses for any disease\n2. **Explore the Workbench** — build knowledge graphs\n3. **Ask me anything** — from CRISPR to survival analysis\n\nWhat interests you?"

    return f"I'd love to help! Try asking me to:\n\n- **Explain concepts** — \"Explain the MAPK cascade\" or \"What is GSEA?\"\n- **Discuss your research** — you have {th} hypotheses and {tp} projects\n- **Navigate the platform** — \"How do I run a t-test?\"\n\nWhat would you like to explore?"


# ── Chat endpoint ───────────────────────────────────────────────────────
@app.post("/api/v1/orchestrator/chat")
async def constant_chat(request: ChatRequest):
    """
    Constant AI chat — uses AWS Bedrock Claude Opus 4.6 (primary)
    with Azure text-embedding-3-large RAG. Falls back to Azure GPT-4o,
    then local knowledge engine.
    """
    if not request.message.strip():
        return {"response": "Please ask me a question about your research."}

    # Step 1: Retrieve RAG context (Azure text-embedding-3-large)
    rag_context = await retrieve_rag_context(request.message)

    # Step 2: Build user content with context
    parts = []
    if rag_context:
        parts.append(f"[RAG Knowledge Base Context]\n{rag_context}")
    if request.platform_context:
        projects = request.platform_context.get("projects", [])
        hypotheses = request.platform_context.get("hypotheses", [])
        if projects:
            parts.append(f"[Platform context]\nUser's projects: {json.dumps(projects[:5], default=str)}")
        if hypotheses:
            parts.append(f"[Platform context]\nUser's hypotheses: {json.dumps(hypotheses[:5], default=str)}")
    parts.append(f"[User question]\n{request.message}")
    user_content = "\n\n".join(parts)

    # Step 3: Try AWS Bedrock Claude Opus 4.6
    response_text = await call_bedrock_claude(user_content)

    # Step 4: Fallback to Azure GPT-4o
    if not response_text:
        response_text = await call_azure_gpt4o(user_content)

    # Step 5: Fallback to knowledge engine
    if not response_text:
        response_text = knowledge_engine_response(request.message, request.platform_context)

    return {"response": response_text}


@app.get("/health")
async def health():
    """Health check endpoint."""
    has_bedrock = bool(os.environ.get("AWS_ACCESS_KEY_ID"))
    has_azure = bool(os.environ.get("AZURE_GPT4O_ENDPOINT"))
    return {
        "status": "ok",
        "service": "constant-chat",
        "ai_backends": {
            "bedrock_claude_opus": "configured" if has_bedrock else "not configured",
            "azure_gpt4o": "configured" if has_azure else "not configured",
            "knowledge_engine": "always available",
        }
    }


if __name__ == "__main__":
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8000
    logger.info(f"Starting Constant AI Chat Server on port {port}")
    logger.info(f"AWS Bedrock: {'configured' if os.environ.get('AWS_ACCESS_KEY_ID') else 'NOT configured (add to .env)'}")
    logger.info(f"Azure GPT-4o: {'configured' if os.environ.get('AZURE_GPT4O_ENDPOINT') else 'NOT configured (add to .env)'}")
    logger.info(f"Knowledge engine: always available as fallback")
    uvicorn.run(app, host="0.0.0.0", port=port)
