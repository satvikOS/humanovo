/**
 * Vite dev-server plugin that handles /api/v1/orchestrator/chat locally
 * when the full FastAPI backend is not running.
 *
 * This provides Constant AI chat responses powered by a comprehensive
 * biomedical knowledge engine so the frontend receives real HTTP 200
 * responses instead of falling into the network-error fallback path.
 */

import type { Plugin } from 'vite'

// ── Conversation memory (per-session, server-side) ──────────────────────
const conversationHistory: Map<string, { role: string; content: string }[]> = new Map()

// ── System prompt (mirrors backend CONSTANT_SYSTEM_PROMPT) ──────────────
const SYSTEM_PROMPT = `You are Constant, an AI research tutor and assistant built into the HumaNovo biomedical discovery platform. You serve as both a knowledgeable research companion and an educational tutor who helps users learn and grow as researchers.`

// ── Comprehensive biomedical knowledge base ─────────────────────────────
const KNOWLEDGE_BASE: Record<string, string> = {
  // ── Molecular Biology ────────────────────────────────────────────────
  'p53|tp53|tumor protein': `**TP53 (p53)** is often called the "guardian of the genome." It's a transcription factor that responds to cellular stress signals like DNA damage, oncogene activation, and hypoxia.

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
MDM2 ubiquitinates p53 for proteasomal degradation. p53 transcriptionally activates MDM2. This creates a negative feedback loop that keeps p53 levels low in unstressed cells. DNA damage breaks this loop by phosphorylating p53 at sites that block MDM2 binding.`,

  'brca|breast cancer gene': `**BRCA1 and BRCA2** are tumor suppressor genes essential for DNA double-strand break (DSB) repair via homologous recombination (HR).

**BRCA1** (chromosome 17q21):
- Forms the BRCA1-PALB2-BRCA2-RAD51 complex
- Recruited to DSBs via ubiquitin signaling (RNF8/RNF168)
- Also involved in cell cycle checkpoint activation and transcription regulation
- Associated cancers: breast (60-80% lifetime risk), ovarian (40-60%), prostate, pancreatic

**BRCA2** (chromosome 13q12):
- Direct RAD51 loader — loads RAD51 recombinase onto single-stranded DNA
- Essential for the strand invasion step of homologous recombination
- Associated cancers: breast (45-70% lifetime risk), ovarian (15-30%), prostate, pancreatic, melanoma

**Synthetic lethality — the therapeutic breakthrough:**
BRCA-deficient cells can't do HR, so they rely on base excision repair (BER). **PARP inhibitors** (olaparib, rucaparib, niraparib, talazoparib) block BER by trapping PARP1 on DNA. With both repair pathways disabled, cancer cells accumulate lethal DNA damage while normal cells (with one working BRCA copy) survive.

**Resistance mechanisms:** Reversion mutations restoring BRCA reading frame, 53BP1 loss (restores partial HR), PARP1 mutations, drug efflux pumps (ABCB1).`,

  'crispr|cas9|gene edit': `**CRISPR-Cas9** is a revolutionary gene editing technology adapted from bacterial adaptive immunity.

**Mechanism:**
1. **Guide RNA (sgRNA)** — a ~20nt sequence complementary to the target DNA, fused to a scaffold that binds Cas9
2. **Cas9 nuclease** — recognizes a PAM sequence (NGG for SpCas9) adjacent to the target
3. **DNA cleavage** — Cas9 makes a blunt-ended double-strand break 3bp upstream of PAM
4. **Repair pathways:**
   - **NHEJ** (non-homologous end joining) — error-prone, creates insertions/deletions → gene knockouts
   - **HDR** (homology-directed repair) — uses a donor template for precise edits (but lower efficiency)

**Variants and improvements:**
- **Base editors** (BE3, ABE) — convert C→T or A→G without DSBs (David Liu lab)
- **Prime editing** — "search and replace" using a pegRNA + Cas9-RT fusion (all 12 transitions/transversions, small indels)
- **CRISPRi/CRISPRa** — dead Cas9 (dCas9) fused to repressors (KRAB) or activators (VP64, p65, Rta) for gene regulation without cutting
- **Cas12a/Cpf1** — T-rich PAM, staggered cuts, processes its own crRNA array
- **Cas13** — targets RNA instead of DNA (RNA knockdown, diagnostics like SHERLOCK)

**Clinical applications:**
- Sickle cell disease: CASGEVY (exagamglogene autotemcel) — first approved CRISPR therapy (2023)
- Beta-thalassemia, transthyretin amyloidosis (in vivo with LNPs)
- CAR-T cell engineering, HIV cure research`,

  'apoptosis|programmed cell death|cell death': `**Apoptosis** is a tightly regulated form of programmed cell death essential for development, immune homeostasis, and tumor suppression.

**Intrinsic (mitochondrial) pathway:**
1. Cellular stress (DNA damage, ER stress, growth factor withdrawal) activates BH3-only proteins (BIM, BID, BAD, PUMA, NOXA)
2. BH3-only proteins neutralize anti-apoptotic BCL-2 family members (BCL-2, BCL-XL, MCL-1)
3. Pro-apoptotic effectors **BAX** and **BAK** oligomerize in the outer mitochondrial membrane
4. Mitochondrial outer membrane permeabilization (MOMP) → cytochrome c release
5. Cytochrome c + APAF-1 form the **apoptosome** → activates caspase-9
6. Caspase-9 cleaves executioner caspases (caspase-3, -7)

**Extrinsic (death receptor) pathway:**
1. Death ligands (FasL, TRAIL, TNF-α) bind death receptors (Fas/CD95, DR4/DR5, TNFR1)
2. Death receptors recruit **FADD** adapter → form DISC (death-inducing signaling complex)
3. DISC activates caspase-8 (and caspase-10)
4. Caspase-8 directly activates caspase-3 (type I cells) or cleaves BID→tBID to amplify via mitochondria (type II cells)

**Executioner phase (convergence):**
- Caspase-3/7 cleave >1000 substrates: ICAD (DNA fragmentation), lamin A (nuclear breakdown), PARP (prevents DNA repair)
- Phosphatidylserine flips to outer membrane leaflet → "eat me" signal for phagocytes

**Cancer connection:** Evasion of apoptosis is a hallmark of cancer. Strategies include BCL-2 overexpression (targeted by venetoclax), loss of p53/BAX, caspase mutations, overexpression of IAPs (targeted by SMAC mimetics).`,

  'kinase|phosphorylation|signal': `**Protein kinases** are enzymes that transfer phosphate groups from ATP to substrate proteins, acting as molecular switches in cell signaling cascades.

**Major kinase families:**

**Receptor Tyrosine Kinases (RTKs):**
- EGFR (ErbB1) — binds EGF → activates RAS-MAPK and PI3K-AKT pathways. Targeted by erlotinib, gefitinib, osimertinib
- HER2 (ErbB2) — no known ligand, dimerizes with other ErbBs. Targeted by trastuzumab, lapatinib, T-DXd
- VEGFR — drives angiogenesis. Targeted by sunitinib, sorafenib, bevacizumab
- PDGFR, FGFR, MET, ALK, ROS1, RET, KIT

**The RAS-MAPK cascade:**
Growth factor → RTK → GRB2/SOS → RAS (GTP loading) → RAF → MEK → ERK → transcription factors (MYC, FOS, JUN)
- KRAS mutations in ~25% of cancers (G12C targeted by sotorasib, adagrasib)
- BRAF V600E: melanoma, colorectal (targeted by vemurafenib, dabrafenib)

**The PI3K-AKT-mTOR pathway:**
RTK → PI3K → PIP2→PIP3 → AKT → mTOR, GSK3β, FOXO, BAD
- Promotes survival, growth, metabolism
- PTEN is the negative regulator (tumor suppressor)
- Targeted by alpelisib (PI3Kα), everolimus (mTOR), capivasertib (AKT)

**Non-receptor kinases:** JAK-STAT (immune signaling, targeted by ruxolitinib), SRC family, ABL (BCR-ABL in CML, targeted by imatinib), CDKs (cell cycle, targeted by palbociclib)`,

  'immunotherapy|checkpoint|pd-1|pd-l1|ctla-4|car-t': `**Cancer immunotherapy** harnesses the immune system to recognize and destroy cancer cells.

**Immune checkpoint inhibitors:**
- **Anti-PD-1** (pembrolizumab, nivolumab): PD-1 on T cells binds PD-L1 on tumor cells → T cell exhaustion. Blocking this restores anti-tumor immunity
- **Anti-PD-L1** (atezolizumab, durvalumab, avelumab): blocks the ligand side
- **Anti-CTLA-4** (ipilimumab): CTLA-4 competes with CD28 for B7 ligands on APCs. Blocking CTLA-4 enhances T cell activation in lymph nodes
- **Combinations:** Ipilimumab + nivolumab in melanoma, RCC, NSCLC — higher response rates but more immune-related adverse events (irAEs)

**Biomarkers for response:**
- PD-L1 expression (IHC): TPS or CPS scoring
- Tumor mutational burden (TMB): more mutations → more neoantigens → better response
- Microsatellite instability (MSI-H) / mismatch repair deficiency (dMMR)
- Tumor-infiltrating lymphocytes (TILs)

**CAR-T cell therapy:**
1. Harvest patient T cells (leukapheresis)
2. Engineer them with a chimeric antigen receptor: scFv (antigen binding) + CD3ζ (signal 1) + co-stimulatory domain (4-1BB or CD28)
3. Expand ex vivo → infuse back into patient
4. Approved products: tisagenlecleucel (Kymriah, CD19), axicabtagene ciloleucel (Yescarta, CD19), idecabtagene vicleucel (Abecma, BCMA)

**Cytokine release syndrome (CRS):** Major side effect of CAR-T — managed with tocilizumab (anti-IL-6R) and steroids.`,

  'dna repair|mutation|genome instab': `**DNA Repair Mechanisms** are critical for maintaining genome integrity. Defects lead to cancer predisposition.

**Base Excision Repair (BER):** Fixes small base lesions (oxidation, deamination, alkylation)
- DNA glycosylase removes damaged base → AP site → APE1 nicks backbone → Pol β fills gap → ligase seals
- Key genes: OGG1, MUTYH, XRCC1, PARP1

**Nucleotide Excision Repair (NER):** Fixes bulky adducts and UV photoproducts
- Global genome NER: XPC-RAD23B detects distortion
- Transcription-coupled NER: CSA/CSB detect stalled RNA Pol II
- TFIIH unwinds → XPF-ERCC1 and XPG cut flanking the lesion → 24-32nt patch repair
- Defects: Xeroderma pigmentosum (1000x skin cancer risk)

**Mismatch Repair (MMR):** Fixes replication errors (mismatches, small indels)
- MutSα (MSH2-MSH6) or MutSβ (MSH2-MSH3) detect mismatch
- MutLα (MLH1-PMS2) nicks the new strand → exonuclease removal → Pol δ resynthesis
- Defects: Lynch syndrome (hereditary CRC, endometrial cancer), MSI-H tumors → respond to immunotherapy

**Homologous Recombination (HR):** High-fidelity DSB repair (S/G2 phase)
- MRN complex (MRE11-RAD50-NBS1) detects break → resection → RPA coats ssDNA → BRCA1/PALB2/BRCA2 load RAD51 → strand invasion → D-loop → synthesis
- Defects: BRCA1/2 mutations → PARP inhibitor sensitivity

**Non-Homologous End Joining (NHEJ):** Fast but error-prone DSB repair (any cell cycle phase)
- Ku70/Ku80 bind broken ends → DNA-PKcs → processing → XRCC4-Ligase IV seal
- Primary DSB repair in G1 phase`,

  'epigenetics|methylation|histone|chromatin': `**Epigenetics** refers to heritable changes in gene expression without altering the DNA sequence.

**DNA Methylation:**
- Addition of methyl group to cytosine at CpG dinucleotides by DNMTs (DNMT1, 3A, 3B)
- CpG islands in promoters: methylation → gene silencing (recruits MeCP2, MBDs)
- DNMT1: maintenance methyltransferase (copies methylation pattern during replication)
- DNMT3A/3B: de novo methyltransferases
- TET enzymes (TET1/2/3): oxidize 5mC → 5hmC → 5fC → 5caC → demethylation
- Cancer: global hypomethylation (genomic instability) + focal hypermethylation (tumor suppressor silencing)
- Drugs: azacitidine, decitabine (DNMT inhibitors, approved for MDS/AML)

**Histone Modifications:**
- Histones (H2A, H2B, H3, H4) form nucleosome core; N-terminal tails are modified
- **Acetylation** (HATs: p300/CBP, GCN5): opens chromatin → gene activation
  - Deacetylation (HDACs): closes chromatin → silencing
  - HDAC inhibitors: vorinostat, romidepsin (approved for CTCL)
- **Methylation** (HMTs: EZH2, DOT1L, G9a):
  - H3K4me3: active promoters
  - H3K27me3: Polycomb repression (EZH2, targeted by tazemetostat)
  - H3K36me3: active gene bodies
  - H3K9me3: heterochromatin
- **Other marks:** phosphorylation (H3S10p — mitosis), ubiquitination (H2AK119ub — Polycomb)

**Chromatin remodeling complexes:** SWI/SNF (BAF/PBAF), ISWI, CHD, INO80 — use ATP to slide, eject, or restructure nucleosomes. SWI/SNF subunit mutations in ~20% of cancers.`,

  'rett syndrome|mecp2': `**Rett Syndrome** is a severe neurodevelopmental disorder caused primarily by loss-of-function mutations in the **MECP2** gene on the X chromosome (Xq28).

**Epidemiology:** ~1 in 10,000-15,000 female births. Almost exclusively affects girls because hemizygous males typically don't survive.

**Clinical stages:**
1. **Early onset (6-18 months):** Developmental stagnation, deceleration of head growth
2. **Rapid regression (1-4 years):** Loss of hand skills and speech, stereotypic hand movements (wringing, washing), breathing irregularities (hyperventilation, apnea), seizures
3. **Plateau (2-10+ years):** Some improvement in social interaction, persistent motor problems
4. **Late motor deterioration:** Reduced mobility, scoliosis, parkinsonian features

**Molecular mechanism:**
- MeCP2 protein binds methylated CpG dinucleotides and recruits the NCoR/SMRT corepressor complex
- It acts as a transcriptional modulator (both repressor and activator) affecting thousands of genes
- Loss of MeCP2 leads to dysregulation of BDNF, DLX5, FXYD1, UBE3A, and many neuronal genes
- Affects synaptic maturation, dendritic complexity, and neurotransmitter balance (GABA/glutamate)

**Therapeutic approaches:**
- **Gene therapy:** AAV9-MECP2 (clinical trials, dose-finding is critical — too much MeCP2 is also harmful: MECP2 duplication syndrome)
- **X-reactivation:** Reactivating the silent X chromosome's MECP2 copy (experimental)
- **Trofinetide** (DAYBUE™): first FDA-approved treatment (2023) — synthetic analog of IGF-1 tripeptide
- **Downstream targets:** BDNF enhancers, glutamate modulators, GABAergic therapies`,

  'pcr|polymerase chain reaction': `**PCR (Polymerase Chain Reaction)** amplifies specific DNA sequences exponentially.

**Basic PCR steps (per cycle):**
1. **Denaturation** (94-98°C): Separate double-stranded DNA into single strands
2. **Annealing** (50-65°C): Primers bind to complementary sequences flanking the target
3. **Extension** (72°C): Taq polymerase synthesizes new DNA strands from primers

After 30 cycles: 2³⁰ ≈ 1 billion copies of the target sequence.

**PCR variants:**
- **qPCR/RT-qPCR:** Real-time quantification using fluorescent probes (TaqMan) or intercalating dyes (SYBR Green). Ct value inversely proportional to starting template amount.
- **RT-PCR:** Reverse transcription PCR — converts RNA to cDNA first, then amplifies. Used for gene expression analysis.
- **Digital PCR (dPCR):** Partitions sample into thousands of droplets, each undergoes PCR independently. Absolute quantification without standard curve.
- **Multiplex PCR:** Multiple primer pairs in one reaction to amplify several targets simultaneously.
- **Nested PCR:** Two rounds of PCR with inner primers for increased specificity.

**Applications:** Diagnostics (COVID-19, HIV viral load), forensics, cloning, genotyping, pathogen detection, prenatal testing.`,

  'rna|mrna|transcription|translation': `**Gene Expression: Transcription and Translation**

**Transcription (DNA → mRNA):**
1. **Initiation:** RNA Polymerase II (Pol II) recruited to promoter by general transcription factors (TFIIA, TFIIB, TFIID/TBP, TFIIE, TFIIF, TFIIH). Mediator complex bridges with enhancer-bound activators.
2. **Elongation:** Pol II synthesizes pre-mRNA 5'→3'. CTD phosphorylation (Ser5 by CDK7, Ser2 by CDK9/P-TEFb) coordinates co-transcriptional processing.
3. **Co-transcriptional processing:**
   - 5' capping (7-methylguanosine cap → mRNA stability and translation initiation)
   - Splicing (U1, U2, U4, U5, U6 snRNPs form spliceosome → removes introns)
   - 3' polyadenylation (CPSF/CstF cleave → poly(A) polymerase adds ~200 A's)
4. **Termination:** Pol II transcribes past poly(A) signal → Rat1/XRN2 torpedo model

**Translation (mRNA → Protein):**
1. **Initiation:** eIF4E binds 5' cap → eIF4G scaffold → eIF4A helicase unwinds 5' UTR → 43S PIC (40S + eIF2-GTP-Met-tRNAi) scans for AUG start codon → 60S joins
2. **Elongation:** Aminoacyl-tRNAs delivered by eEF1A → peptide bond in peptidyl transferase center → translocation by eEF2
3. **Termination:** Stop codon (UAA/UAG/UGA) → eRF1 recognizes → eRF3 stimulates release → ribosome recycling

**mRNA therapeutics:** COVID-19 vaccines (BNT162b2, mRNA-1273) use N1-methylpseudouridine to reduce innate immune sensing and increase translation.`,

  'clinical trial|phase 1|phase 2|phase 3|fda': `**Clinical Trial Phases:**

**Preclinical:** In vitro (cell lines) and in vivo (animal models) studies. Pharmacokinetics, toxicology, ADME studies. IND (Investigational New Drug) application filed with FDA.

**Phase 0 (Exploratory):** Very low doses in 10-15 subjects. Assess PK/PD, no therapeutic intent. Not always required.

**Phase I (Safety):** 20-100 healthy volunteers (or patients for oncology/rare disease)
- Primary: safety, tolerability, maximum tolerated dose (MTD)
- Dose escalation designs: 3+3, accelerated titration, Bayesian CRM
- Assess PK (Cmax, AUC, t½, clearance) and preliminary PD

**Phase II (Efficacy):**
- IIa: Proof of concept, dose-finding (50-100 patients)
- IIb: Dose-ranging, efficacy signal (100-300 patients)
- Randomized, often with control arm. Primary efficacy endpoints.
- Adaptive designs: Simon's two-stage, seamless Phase II/III

**Phase III (Confirmatory):** 300-3000+ patients
- Randomized, double-blind, placebo/active-controlled
- Demonstrates efficacy and safety at scale
- Powers registration endpoints (overall survival, PFS, ORR, etc.)
- Multi-center, international

**NDA/BLA submission → FDA review (10-month standard, 6-month priority) → PCOM advisory committee → Approval**

**Phase IV (Post-marketing):** Ongoing safety surveillance (pharmacovigilance), label expansion studies, real-world evidence generation.

**Special pathways:** Breakthrough therapy, fast track, accelerated approval (surrogate endpoints), priority review, RMAT (regenerative medicine).`,

  'statistics|t-test|p-value|significance': `**Statistical Hypothesis Testing in Biomedical Research:**

**Core concepts:**
- **Null hypothesis (H₀):** No effect/difference exists
- **Alternative hypothesis (H₁):** Effect/difference exists
- **p-value:** Probability of observing data at least as extreme as what was seen, assuming H₀ is true
- **Significance level (α):** Threshold for rejecting H₀ (usually 0.05)
- **Type I error (false positive):** Rejecting H₀ when it's true (rate = α)
- **Type II error (false negative):** Failing to reject H₀ when H₁ is true (rate = β)
- **Power (1-β):** Probability of detecting a true effect (aim for ≥0.80)

**Common tests:**
- **Student's t-test:** Compare means of 2 groups (independent or paired). Assumes normality and equal variance (or use Welch's t-test).
- **ANOVA (one-way):** Compare means of 3+ groups. F-statistic = between-group variance / within-group variance. Follow up with Tukey's HSD or Bonferroni.
- **Chi-squared test:** Association between categorical variables. Compares observed vs expected frequencies.
- **Mann-Whitney U:** Non-parametric alternative to independent t-test.
- **Wilcoxon signed-rank:** Non-parametric paired test.
- **Kruskal-Wallis:** Non-parametric alternative to one-way ANOVA.

**Effect size matters!** Cohen's d (small: 0.2, medium: 0.5, large: 0.8). A statistically significant result can be clinically meaningless if the effect size is tiny.

**Multiple testing correction:** Bonferroni (conservative), Benjamini-Hochberg FDR (less conservative), permutation-based methods.

You can run all these tests in the **Statistics** section of HumaNovo!`,

  'regression|linear model|correlation': `**Regression Analysis in Research:**

**Simple Linear Regression:** Y = β₀ + β₁X + ε
- β₀ (intercept): Y when X=0
- β₁ (slope): change in Y per unit change in X
- R² (coefficient of determination): proportion of variance explained (0-1)
- Assumptions: linearity, independence, normality of residuals, homoscedasticity

**Multiple Linear Regression:** Y = β₀ + β₁X₁ + β₂X₂ + ... + ε
- Adjusted R² accounts for number of predictors
- VIF (variance inflation factor) detects multicollinearity (VIF > 10 is concerning)
- Stepwise selection: forward, backward, or both (but penalized methods are preferred)

**Logistic Regression:** For binary outcomes (disease/healthy, response/no response)
- log(p/(1-p)) = β₀ + β₁X₁ + ...
- Odds ratio = e^β₁ — interpretable effect measure
- Model fit: AIC, BIC, Hosmer-Lemeshow test, ROC-AUC

**Cox Proportional Hazards Regression:** For time-to-event data
- h(t) = h₀(t) · exp(β₁X₁ + β₂X₂ + ...)
- Hazard ratio (HR): HR > 1 means higher risk, HR < 1 means protective
- Proportional hazards assumption: test with Schoenfeld residuals
- Kaplan-Meier curves + log-rank test for univariate survival comparison

**Regularization methods:**
- LASSO (L1): drives coefficients to exactly zero → feature selection
- Ridge (L2): shrinks coefficients → handles multicollinearity
- Elastic Net: combines L1 + L2

The **Statistics** section has regression tools built in!`,

  'survival analysis|kaplan|cox|hazard': `**Survival Analysis** studies time-to-event data, accounting for censoring.

**Key concepts:**
- **Survival function S(t):** Probability of surviving beyond time t
- **Hazard function h(t):** Instantaneous rate of the event at time t, given survival to t
- **Censoring:** When we don't observe the event — patient lost to follow-up, study ends, or competing event occurs (right censoring is most common)

**Kaplan-Meier estimator:**
- Non-parametric step function estimating S(t)
- Ŝ(t) = ∏ (1 - dᵢ/nᵢ) for all event times tᵢ ≤ t
- Where dᵢ = events at time tᵢ, nᵢ = individuals at risk just before tᵢ
- Median survival: time when Ŝ(t) = 0.50
- 95% CI via Greenwood's formula

**Log-rank test:** Compares survival curves between groups
- H₀: No difference between groups
- Sums observed vs expected events across all time points
- χ² distributed with df = (number of groups - 1)
- Sensitive to late differences; use Wilcoxon-Breslow for early differences

**Cox proportional hazards model:**
- h(t|X) = h₀(t) · exp(β₁X₁ + β₂X₂ + ...)
- Semi-parametric: no assumption about baseline hazard shape
- PH assumption: hazard ratio is constant over time (test with Schoenfeld residuals, log-log plots)
- Stratified Cox: allows different baseline hazards per stratum
- Time-varying covariates: extended Cox model

**Clinical trial endpoints:** Overall survival (OS), progression-free survival (PFS), disease-free survival (DFS), time to progression (TTP), event-free survival (EFS).`,

  'pathway|enrichment|kegg|reactome|go|gene ontology': `**Pathway Enrichment Analysis** identifies biological pathways over-represented in a gene list.

**Method:**
1. Start with a gene list (e.g., differentially expressed genes from RNA-seq)
2. Compare against annotated gene sets from pathway databases
3. Statistical test: **hypergeometric test** (Fisher's exact test equivalent)
   - p = P(X ≥ k) where X ~ Hypergeometric(N, K, n)
   - N = total genes in genome, K = genes in pathway, n = your gene list size, k = overlap

**Major databases:**
- **KEGG** (Kyoto Encyclopedia of Genes and Genomes): Metabolic and signaling pathways, ~350 human pathways
- **Reactome:** Peer-reviewed, manually curated biological pathways, ~2,500 human pathways
- **Gene Ontology (GO):** Three domains — Biological Process (BP), Molecular Function (MF), Cellular Component (CC). ~45,000 terms.
- **WikiPathways, BioCyc, Pathway Commons**

**Corrections:**
- Multiple testing correction is essential (Benjamini-Hochberg FDR recommended)
- Adjusted p-value (q-value) < 0.05 is standard threshold

**Visualization:** Dot plots (size = gene count, color = p-value), bar plots, enrichment maps (network of pathways sharing genes), cnetplots.

You can run pathway enrichment in the **Genomics** section!`,

  'gsea|gene set enrichment': `**GSEA (Gene Set Enrichment Analysis)** detects coordinated expression changes in predefined gene sets.

**Key difference from ORA (over-representation analysis):** GSEA uses your **entire ranked gene list** (not just significant genes), so it can detect subtle but coordinated shifts.

**Algorithm (Subramanian et al., 2005):**
1. **Rank all genes** by a metric (e.g., log₂ fold change, signal-to-noise ratio, t-statistic)
2. Walk down the ranked list. For each gene:
   - If gene is in the gene set: increase running sum by a weighted step (|rⱼ|^p / Nᵣ)
   - If gene is not in the gene set: decrease by 1/(N - Nₕ)
3. **Enrichment Score (ES):** Maximum deviation of the running sum from zero
4. **Significance:** Permute phenotype labels (or genes) 1000+ times → generate null distribution of ES → calculate p-value
5. **Normalized Enrichment Score (NES):** ES normalized by mean of null distribution → allows comparison across gene sets
6. **FDR q-value:** Corrects for multiple gene sets tested

**Leading edge genes:** The core subset of genes that contribute most to the enrichment signal — found between the start of the ranked list and the ES peak.

**Interpretation:**
- Positive NES → gene set enriched in the "upregulated" phenotype
- Negative NES → gene set enriched in the "downregulated" phenotype
- FDR q < 0.25 is standard threshold (more lenient than 0.05 due to the correlative nature)

Run GSEA in the **Genomics** section of HumaNovo!`,

  'variant|snp|mutation|annotation|sift|polyphen': `**Variant Annotation** characterizes the functional impact of genetic variants.

**Variant types:**
- **SNV** (Single Nucleotide Variant): Single base change (A→G, C→T, etc.)
- **Indel:** Insertion or deletion of 1-50bp
- **CNV** (Copy Number Variant): Gains or losses of larger DNA segments
- **Structural variant:** Translocations, inversions, large deletions/duplications (>50bp)

**Functional consequences:**
- **Synonymous:** No amino acid change (but can affect splicing, mRNA stability)
- **Missense:** Different amino acid (may or may not affect protein function)
- **Nonsense:** Premature stop codon → truncated protein → likely NMD
- **Frameshift:** Indel not divisible by 3 → altered reading frame → usually loss of function
- **Splice site:** Disrupts exon-intron boundaries → aberrant splicing

**Pathogenicity prediction tools:**
- **SIFT:** Based on sequence conservation. Score 0-1 (< 0.05 = damaging)
- **PolyPhen-2:** Uses sequence + structure features. Score 0-1 (> 0.85 = probably damaging)
- **CADD (Combined Annotation Dependent Depletion):** Integrates 60+ annotations into a single score. Phred-scaled (> 20 = top 1% most deleterious)
- **REVEL:** Ensemble method combining 13 individual tools. Score 0-1 (> 0.5 = likely pathogenic)
- **AlphaMissense:** Uses AlphaFold-derived features for missense variant classification

**Clinical databases:** ClinVar (clinical significance), gnomAD (population frequencies), COSMIC (somatic mutations in cancer), OMIM (Mendelian disease).

Annotate variants in the **Genomics** section!`,

  'sample size|power analysis|power calculation': `**Sample Size Calculation** ensures your study has enough statistical power.

**Key parameters:**
- **Effect size (d or Δ):** The minimum difference you want to detect
- **Alpha (α):** Significance level (typically 0.05)
- **Power (1-β):** Probability of detecting a true effect (typically 0.80 or 0.90)
- **Variance (σ²):** Expected variability in your measurements

**Formulas (two-sample t-test):**
n per group = 2 × ((z_α/2 + z_β) × σ / Δ)²
- For α=0.05, z_α/2 = 1.96
- For power=0.80, z_β = 0.84
- For power=0.90, z_β = 1.28

**Rules of thumb (Cohen's d):**
- Small effect (d=0.2): ~393 per group (power=0.80, α=0.05)
- Medium effect (d=0.5): ~64 per group
- Large effect (d=0.8): ~26 per group

**For other designs:**
- Paired t-test: n = ((z_α/2 + z_β) × σ_d / Δ)² — usually requires fewer subjects
- ANOVA (k groups): Use per-group formula × adjustment factor
- Proportions: n = (z_α/2√(2p̄q̄) + z_β√(p₁q₁+p₂q₂))² / (p₁-p₂)²
- Survival analysis: Need expected event rates and hazard ratios

**Common pitfalls:**
- Underpowered studies waste resources and risk false negatives
- Overpowered studies expose unnecessary subjects to risk
- Always account for expected dropout rate (add 10-20%)
- Report your sample size justification in your methods section

The **Statistics** section has a sample size calculator!`,

  'drug|pharmacology|mechanism of action|therapeutic': `**Pharmacology Fundamentals:**

**Pharmacokinetics (what the body does to the drug):**
- **Absorption:** Oral bioavailability, first-pass metabolism, Cmax, Tmax
- **Distribution:** Volume of distribution (Vd), protein binding, BBB penetration
- **Metabolism:** CYP450 enzymes (CYP3A4, 2D6, 2C9, 1A2), phase I (oxidation) and phase II (conjugation)
- **Excretion:** Renal (GFR, tubular secretion), hepatic (biliary), half-life (t½)

**Pharmacodynamics (what the drug does to the body):**
- **Receptor theory:** Agonists (full, partial), antagonists (competitive, non-competitive), inverse agonists
- **Dose-response curves:** EC50 (potency), Emax (efficacy)
- **Therapeutic index:** TD50/ED50 — wider = safer
- **Selectivity:** Off-target effects drive side effects

**Drug development timeline:**
Discovery → Lead optimization → Preclinical (3-6 years) → Phase I (1 year) → Phase II (1-2 years) → Phase III (2-4 years) → NDA/BLA → Approval → Phase IV
- Average: 10-15 years, $1-2 billion
- Success rate: ~5-10% from Phase I to approval

**Drug repurposing:** Finding new indications for existing drugs. Advantages: known safety profile, shorter development time. Examples: thalidomide (multiple myeloma), sildenafil (pulmonary hypertension), metformin (cancer prevention studies).`,

  'machine learning|deep learning|ai in research|neural network': `**AI/ML in Biomedical Research:**

**Traditional ML approaches:**
- **Random forests:** Feature importance ranking, classification. Popular for biomarker discovery.
- **SVM (Support Vector Machines):** Classification with kernel tricks for non-linear boundaries.
- **Gradient boosting (XGBoost, LightGBM):** Top performers in tabular data, clinical prediction models.
- **Elastic net regression:** Feature selection in high-dimensional omics data.

**Deep learning:**
- **CNNs:** Medical imaging (radiology, pathology, dermatology). U-Net for segmentation.
- **RNNs/LSTMs:** Time series data (EHR, ICU monitoring, ECG analysis).
- **Transformers:** Protein structure prediction (AlphaFold), drug-target interaction, biomedical NLP.
- **Graph Neural Networks:** Molecular property prediction, drug-drug interactions, PPI networks.
- **Variational Autoencoders/GANs:** Drug molecule generation, synthetic data augmentation.

**Key applications:**
- **AlphaFold2/3:** Protein structure prediction from sequence (near-experimental accuracy)
- **Drug discovery:** Virtual screening, de novo drug design (diffusion models), ADMET prediction
- **Clinical decision support:** Risk stratification, treatment response prediction
- **Genomics:** Variant effect prediction (SpliceAI, DeepVariant), gene expression modeling (Enformer)
- **Single-cell analysis:** Cell type annotation (scBERT), trajectory inference

**Challenges:** Data quality, batch effects, class imbalance, interpretability, generalization across populations, regulatory approval for clinical AI (FDA Software as a Medical Device framework).`,
}

// ── Platform navigation guide ──────────────────────────────────────────
const NAV_MAP: [RegExp, string][] = [
  [/dashboard/i, 'Head to the **Dashboard** from the sidebar — it shows your research overview, recent activity, and quick stats across all your projects.'],
  [/project/i, 'Go to **Projects** in the sidebar. You can create new projects, organize hypotheses, and generate research papers from there.'],
  [/discover|hypothes/i, 'Open **Discovery** in the sidebar. Enter a disease or research area, then click "Start" to generate AI-powered hypotheses using our multi-model pipeline.'],
  [/workbench|graph|knowledge/i, 'Open the **Workbench** from the sidebar. Drag biological structures from the library onto the canvas and connect them to build knowledge graphs. I can help explain relationships between nodes!'],
  [/notebook|note/i, 'Go to **Notebook** in the sidebar under Tools. You can create pages using templates (research notes, experiment logs, protocols) and write in rich text or Markdown.'],
  [/simulat/i, 'Head to **Simulations** in the sidebar. You can run Monte Carlo simulations to test hypothesis robustness with configurable parameters.'],
  [/statistic|t-test|anova|regression/i, 'Go to **Statistics** under Analysis in the sidebar. It has tabs for descriptive stats, hypothesis testing, regression, survival analysis, and sample size calculation.'],
  [/genom|pathway|gsea|variant/i, 'Open **Genomics** under Analysis. You can run pathway enrichment, GSEA, variant annotation, and biomarker discovery with your gene lists.'],
  [/timeline|activity|history/i, 'Check the **Timeline** in the sidebar under Tools to see your complete research activity history.'],
  [/search/i, 'Use **Search** in the sidebar or press **Cmd/Ctrl+K** to search across all your projects, hypotheses, and papers.'],
  [/citation/i, 'Go to **Citations** under Research in the sidebar to manage your reference library.'],
  [/experiment|tracker/i, 'Check **Experiments** under Research to track your experimental protocols and results.'],
  [/visual|chart|plot/i, 'Open **Visualization** under Research to create custom charts and plots from your data.'],
  [/evidence/i, 'Go to **Evidence** in the sidebar to browse and manage your research evidence base.'],
  [/anatomy|3d|body/i, 'Open **3D Anatomy** in the sidebar for an interactive human anatomy explorer.'],
  [/setting/i, 'Go to **Settings** at the bottom of the sidebar to customize your experience.'],
]

// ── Response generator ─────────────────────────────────────────────────
function isOutOfScopePlugin(query: string): boolean {
  const q = query.toLowerCase().trim()
  if (/^(hi|hey|hello|howdy|yo|sup|what'?s up|good (morning|afternoon|evening))[\s!.?]*$/i.test(q)) return false
  if (/^(i am|i'm|my name is|this is|call me)\s/i.test(q)) return false
  if (/^(thanks?|thank you|thx|ty|cheers|appreciate)[\s!.]*$/i.test(q)) return false
  if (/how are you/i.test(q)) return false
  if (/what (can|do) you do|help me|tour|guide/i.test(q)) return false
  if (/where|how (do i|to|can i)|take me to|go to|open|navigate|show me|dashboard|project|notebook|workbench|setting|search|discover/i.test(q)) return false
  if (/hypothes|paper|simulat|how many|count|total|overview|summary|status/i.test(q)) return false
  if (/medic|health|bio|pharma|genom|gene|protein|cell|organ|disease|drug|clinic|pathol|immun|neuro|cardio|oncol|cancer|tumor|anat|physiol|molecule|dna|rna|enzyme|receptor|antibod|vaccine|therap|diagnos|symptom|treat|patient|epidem|virus|bacter|infect|metabol|kinase|pathway|apoptosis|crispr|pcr|t-test|anova|regression|survival|sample size|statistic|research|experiment|lab|science|human|body|tissue|blood|brain|heart|lung|liver|kidney|p53|tp53|brca|egfr|rett/i.test(q)) return false
  if (q.split(/\s+/).length <= 4) return false
  if (/\b(cook|recipe|football|soccer|basketball|movie|film|music|song|celebrity|fashion|politics|election|stock market|crypto|bitcoin|gaming|video game|programming|javascript|python|react|html|css|database|sql|astrology|horoscope|dating|relationship|astronomy|planet|galaxy|weather|forecast|travel|hotel|restaurant|food|cuisine)\b/i.test(q)) return true
  return false
}

function generateResponse(message: string, platformContext: any): string {
  const q = message.toLowerCase().trim()

  // ── Scope guard ──
  if (isOutOfScopePlugin(q)) {
    return `I appreciate the question, but I'm specifically designed to assist with **medicine, healthcare, biotechnology, and human sciences** topics.\n\nHere's what I can help with:\n\n| Category | Examples |\n|----------|----------|\n| **Biology** | Genes, proteins, pathways, cell biology, anatomy |\n| **Medicine** | Diseases, diagnostics, treatments, clinical trials |\n| **Statistics** | t-tests, ANOVA, regression, survival analysis |\n| **Genomics** | GSEA, pathway enrichment, variant annotation |\n| **Platform** | Navigation, your projects, hypotheses, papers |\n\nTry asking something in these areas!`
  }

  // ── Greetings ──
  if (/^(hi|hey|hello|howdy|yo|sup|what'?s up|good\s*(morning|afternoon|evening))[\s!.?]*$/i.test(q)) {
    const projects = platformContext?.projects?.length || 0
    const hypotheses = platformContext?.hypotheses?.length || 0
    if (projects > 0 || hypotheses > 0) {
      return `Hey! Great to see you. You've got **${projects}** project${projects !== 1 ? 's' : ''} and **${hypotheses}** hypothes${hypotheses !== 1 ? 'es' : 'is'} going. What would you like to work on?`
    }
    return `Hey there! I'm Constant, your AI research companion on HumaNovo. I can help you with:\n\n- **Learning** — explain any biology, statistics, or genomics concept in depth\n- **Navigating** — find any tool or feature on the platform\n- **Research** — discuss hypotheses, experimental design, data interpretation\n\nWhat's on your mind?`
  }

  // ── Personal introductions ──
  if (/^(i am|i'm|my name is|this is|call me)\s/i.test(q)) {
    const nameMatch = q.match(/(?:i am|i'm|my name is|this is|call me)\s+(.+)/i)
    const name = nameMatch ? nameMatch[1].replace(/[.!?]+$/, '').trim() : 'there'
    return `Nice to meet you, ${name}! I'm Constant, your research companion here on HumaNovo. I'm knowledgeable in molecular biology, pharmacology, genomics, statistics, and research methodology. Feel free to ask me anything — I'll explain it clearly and connect it to tools on the platform when relevant. What are you curious about?`
  }

  // ── Thanks ──
  if (/^(thanks?|thank you|thx|ty|cheers|appreciate)[\s!.]*$/i.test(q)) {
    return "You're welcome! I'm always here if you need help with your research. Don't hesitate to ask about anything — from molecular mechanisms to statistical methods."
  }

  // ── How are you ──
  if (/how are you|how('?re| are) (you|u) doing|how('?s| is) it going/i.test(q)) {
    return "I'm doing great, thanks for asking! I love helping researchers explore new ideas. What can I help you with today?"
  }

  // ── What can you do / help ──
  if (/what (can|do) you do|help me|how (can|do) (you|i) (use|start)|what('?s| is) this|tour|guide|capabilities/i.test(q)) {
    return `Great question! Here's what I can do:\n\n**🧬 Teach & Explain:**\n- Molecular biology (signaling pathways, DNA repair, epigenetics, gene regulation)\n- Pharmacology (drug mechanisms, clinical trials, PK/PD)\n- Statistics (hypothesis testing, regression, survival analysis, power calculations)\n- Genomics (pathway enrichment, GSEA, variant annotation, biomarkers)\n- Research methodology (experimental design, controls, bias mitigation)\n\n**🔬 Platform Navigation:**\n- Guide you to any tool: Discovery, Workbench, Statistics, Genomics, Notebook, and more\n- Explain how to use each feature effectively\n\n**📊 Research Support:**\n- Discuss your hypotheses and suggest experiments\n- Help interpret statistical and genomics results\n- Explain disease mechanisms and therapeutic strategies\n\nJust ask naturally — I'll give you a thorough, educational response!`
  }

  // ── Navigation requests ──
  if (/where (can i|do i|is|are)|how (do i|to|can i) (find|get|go|navigate|access|open|use|start|create|make|run|see|view)/i.test(q) || /take me to|go to|open|navigate to|show me/i.test(q)) {
    for (const [pattern, response] of NAV_MAP) {
      if (pattern.test(q)) return response
    }
    return "I can help you find anything on the platform! Try asking about a specific section — like \"How do I start a discovery?\" or \"Where can I run statistics?\""
  }

  // ── Knowledge base lookup ──
  for (const [keys, explanation] of Object.entries(KNOWLEDGE_BASE)) {
    const patterns = keys.split('|')
    if (patterns.some(p => q.includes(p.toLowerCase()))) {
      return explanation + '\n\nWant me to go deeper on any aspect of this, or connect it to something in your research?'
    }
  }

  // ── Platform data queries ──
  const projects = (platformContext?.projects as any[]) || []
  const hypotheses = (platformContext?.hypotheses as any[]) || []
  const papers = (platformContext?.papers as any[]) || []
  const totalProjects = projects.length
  const totalHypotheses = hypotheses.length
  const totalPapers = papers.length

  // Search user data
  const matchingHyps = hypotheses.filter((h: any) => {
    const searchable = [h.title, h.mechanism, h.disease, ...(h.tags || [])].filter(Boolean).join(' ').toLowerCase()
    return q.split(/\s+/).some((word: string) => word.length > 3 && searchable.includes(word))
  })

  if (matchingHyps.length > 0) {
    const intro = matchingHyps.length === 1 ? 'I found a relevant hypothesis in your data:' : `I found **${matchingHyps.length}** relevant hypotheses:`
    const items = matchingHyps.slice(0, 3).map((h: any, i: number) => {
      let item = `${i + 1}. **${h.title}**`
      if (h.confidence) item += ` (${Math.round(h.confidence * 100)}% confidence)`
      if (h.mechanism) item += `\n   ${h.mechanism.slice(0, 150)}${h.mechanism.length > 150 ? '...' : ''}`
      return item
    }).join('\n\n')
    return `${intro}\n\n${items}\n\nWould you like me to explain the biology behind any of these, or suggest follow-up experiments?`
  }

  // Queries about user's research status
  if (/how many|count|total|number|overview|summary|status|my research|my work/i.test(q)) {
    return `Here's your research overview:\n\n- **${totalProjects}** project${totalProjects !== 1 ? 's' : ''}\n- **${totalHypotheses}** hypothes${totalHypotheses !== 1 ? 'es' : 'is'}\n- **${totalPapers}** research paper${totalPapers !== 1 ? 's' : ''}\n\nWant to dive into any of these, or start something new?`
  }

  // ── General educational intent (broad catch) ──
  if (/what is|explain|teach|how does|define|tell me about|what are|why do|why is|how do|what('?s| is) the|describe|difference between|compare/i.test(q)) {
    // Check for broad biology/research topics even if not in the KB
    const topicHints = q.match(/(?:what is|explain|tell me about|describe|how does)\s+(.+?)(?:\?|$)/i)
    if (topicHints) {
      const topic = topicHints[1].trim()
      return `That's a great question about **${topic}**! I have deep knowledge on many biomedical topics. Here are some areas I can explain in detail:\n\n**Molecular Biology:** p53, BRCA, CRISPR, apoptosis, kinases, DNA repair, epigenetics, RNA biology, PCR\n**Immunology:** immunotherapy, checkpoint inhibitors, CAR-T cells\n**Statistics:** t-tests, ANOVA, regression, survival analysis, power calculations\n**Genomics:** pathway enrichment, GSEA, variant annotation, biomarkers\n**Pharmacology:** drug mechanisms, clinical trials, pharmacokinetics\n**Methods:** experimental design, hypothesis formulation\n\nCould you be more specific about what aspect of **${topic}** you'd like to explore? The more specific your question, the more detailed and useful my answer will be!`
    }
  }

  // ── Conversational catch-all ──
  if (totalProjects === 0 && totalHypotheses === 0) {
    return "Welcome to HumaNovo! Here's how to get started:\n\n1. **Run a Discovery** — enter any disease in the Discovery section and let the AI generate novel hypotheses\n2. **Explore the Workbench** — build visual biological knowledge graphs\n3. **Try the analysis tools** — run statistical tests or genomics analyses\n\nOr ask me to explain any biomedical concept — from CRISPR to survival analysis to clinical trial design. What interests you?"
  }

  return `I'd love to help! I'm most useful when you ask me to:\n\n- **Explain concepts** — "Explain the MAPK signaling cascade" or "What is GSEA?"\n- **Discuss your research** — ask about your ${totalHypotheses} hypotheses or ${totalProjects} projects\n- **Navigate the platform** — "How do I run a t-test?" or "Where is the workbench?"\n- **Learn methods** — "How does survival analysis work?" or "What's a good sample size?"\n\nWhat would you like to explore?`
}

// ── Vite plugin ─────────────────────────────────────────────────────────
export function constantChatPlugin(): Plugin {
  return {
    name: 'constant-chat-handler',
    configureServer(server) {
      // Add middleware BEFORE the proxy so it intercepts the chat route
      server.middlewares.use('/api/v1/orchestrator/chat', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            const message = parsed.message || ''
            const platformContext = parsed.platform_context || {}

            const response = generateResponse(message, platformContext)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ response }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ response: 'Could you rephrase that? I didn\'t quite catch it.' }))
          }
        })
      })

      // Also handle health check
      server.middlewares.use('/health', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', service: 'constant-chat' }))
      })
    },
  }
}
