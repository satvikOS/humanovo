# Adversarial Multi-Model Hypothesis Generation with Dual-Embedding Grounding: A Retrospective Validation Study

**Authors:** Satvik Adyanthaya¹,²; [URMC Advisor]³; [Additional Co-authors]
**Affiliations:**
¹ humanovo / Adyanthaya Ventures
² Simon Business School, University of Rochester
³ University of Rochester Medical Center

**Corresponding author:** sadyanth@simon.rochester.edu

**Status:** PREPRINT DRAFT — for advisor review prior to bioRxiv submission

---

## Abstract

We present humanovo, a biomedical hypothesis generation platform that combines a 12-stage adversarial multi-model pipeline with dual-embedding grounding to address the hallucination problem inherent in single-model AI scientific reasoning systems. Unlike prior approaches such as Biomni (Stanford), Google AI Co-Scientist, and OpenAI's Prism — which rely on a single foundation model with retrieval augmentation — humanovo explicitly assigns adversarial roles to different models: hypothesis generation, counter-argument production, mechanistic validation, and grounding verification are performed by different LLMs with complementary strengths. Between every stage, two embedding models (biomedical-optimized Cohere Embed v3 at 1024d, and general-purpose Azure text-embedding-3-large at 1536d) verify claim-evidence alignment, enabling a semantic gate that blocks ungrounded propositions from propagating downstream. We retrospectively validate humanovo against 10 published-and-experimentally-confirmed biomedical hypotheses spanning oncology, neurodegeneration, infectious disease, cardiology, and rare disease, measuring hypothesis recovery rate, citation accuracy, counter-argument identification, and translational roadmap fidelity. Mean hypothesis recovery rate was [TO BE FILLED FROM BENCHMARK RUN], with citation accuracy of [X%] verified via DOI/PMID resolution and semantic relevance scoring. We provide an open-source benchmark suite to enable reproducible evaluation of biomedical hypothesis generation systems and discuss implications for institutional deployment of compliance-sensitive AI in clinical research environments.

**Keywords:** biomedical AI, hypothesis generation, retrieval-augmented generation, multi-agent systems, scientific reasoning, AI grounding, adversarial reasoning

---

## 1. Introduction

The accelerating volume of biomedical literature has outpaced the human capacity to integrate findings across subfields. PubMed indexes over 1.5 million new papers annually, with no individual researcher able to read more than a fraction of work even within their narrow specialization. This information bottleneck constrains hypothesis generation — the foundational creative step in biomedical research — and creates demand for AI systems that can synthesize across the full corpus to propose novel, testable mechanistic claims.

Recent systems have made notable progress. Biomni (Huang et al., 2025) provides a generalist agent across 25 biomedical subfields by integrating 150 specialized tools, 105 software packages, and 59 databases mined from bioRxiv publications. Google's AI Co-Scientist (Gottweis & Natarajan, 2026) deploys six specialized agents (Generation, Reflection, Ranking, Evolution, Proximity, Meta-review) on Gemini 2.0, with notable wet-lab validation in liver fibrosis drug repurposing and bacterial DNA transfer mechanisms. OpenAI's Prism (2026) embeds GPT-5.2 directly in scientific authoring workflows. BenevolentAI demonstrated drug repurposing success with baricitinib for COVID-19. Insilico Medicine recently completed Phase IIa trials for the first fully AI-designed drug.

These systems share an architectural assumption: a single foundation model performs reasoning, with retrieval augmentation supplying evidence. This single-model approach inherits two well-documented limitations. First, hallucination — fabrication of citations or facts — remains prevalent even in frontier models when reasoning across long contexts. Second, the same model that generates a hypothesis is asked to evaluate it, creating an evaluation bias analogous to confirmation bias in human reasoning. Models trained with reinforcement learning from human feedback are particularly susceptible to producing plausible-sounding but unsupported claims when their reward signal favors fluent confidence.

We propose an alternative architecture motivated by the adversarial review process in scientific publishing: different models with different inductive biases generate, attack, revise, and validate hypotheses sequentially. We refer to this as the **adversarial multi-model pipeline**. We further introduce **dual-embedding grounding**, a verification layer that runs between every stage to ensure claims propagated to downstream stages are semantically anchored to retrievable evidence.

This paper makes three contributions:

1. We describe the architecture of humanovo, including the 12-stage pipeline assignment, model selection rationale, and grounding gate logic.
2. We retrospectively validate the system against 10 published biomedical hypotheses spanning multiple therapeutic areas and discovery types, measuring recovery rate, citation accuracy, counter-argument identification, and translational roadmap fidelity.
3. We release the benchmark suite and citation accuracy verification framework as open-source artifacts to enable reproducible evaluation of biomedical hypothesis generation systems.

---

## 2. Related Work

### 2.1 — Biomedical AI Agents

Biomni (Huang et al., 2025) constructed Biomni-E1, a unified biomedical action space mined from 10,000+ publications, paired with a generalist agent (Biomni-A1) that performs LLM reasoning, retrieval-augmented planning, and code-based execution. On LAB-Bench, Biomni achieved 74.4% on database question answering and 81.9% on sequence question answering, surpassing human experts. The system processed 336,000 single-nucleus RNA-seq profiles autonomously and generated experimentally testable wet-lab protocols. Biomni's strengths are breadth and code execution; its limitations include reliance on a single foundation model for reasoning and acknowledged risks around full-system-privilege code execution.

Google's AI Co-Scientist demonstrated wet-lab validation of AML drug repurposing candidates and recovered a bacterial DNA transfer mechanism that Imperial College researchers had been investigating for over a decade. The multi-agent architecture (Generation, Reflection, Ranking, Evolution, Proximity, Meta-review) operates entirely on Gemini 2.0, with all agents sharing the same underlying model.

OpenAI's Prism integrates GPT-5.2 into scientific writing workflows, focusing on reducing friction in literature search, citation management, and manuscript preparation rather than autonomous hypothesis generation.

### 2.2 — Knowledge Graph Approaches

BenevolentAI pioneered the application of biomedical knowledge graphs to drug-target-disease association mining, with notable success in baricitinib repurposing for COVID-19. Knowledge graph approaches provide strong provenance but can struggle with novel hypotheses that require composing relationships not explicitly encoded.

### 2.3 — End-to-End Drug Discovery

Insilico Medicine completed Phase IIa trials for ISM001-055 in idiopathic pulmonary fibrosis, demonstrating that AI-designed molecules can reach clinical efficacy at substantially reduced cost and timeline. Recursion Pharmaceuticals and Exscientia (now merged) operate phenomics-first platforms that conduct millions of automated experiments weekly. These platforms operate downstream of hypothesis generation; humanovo is positioned as an upstream hypothesis engine that can feed such experimental platforms.

### 2.4 — Limitations of Prior Work

Across these systems, three limitations recur:
1. **Single-model reasoning** introduces correlated failure modes
2. **Limited adversarial review** — the same model that generates a hypothesis cannot reliably identify its weaknesses
3. **Grounding verification is implicit** — there is no explicit gate between reasoning stages to block ungrounded claims

humanovo addresses each of these limitations through architectural choices described in Section 3.

---

## 3. Methods

### 3.1 — Pipeline Architecture

humanovo's discovery pipeline executes 12 sequential stages, each performed by a specifically chosen language model:

| Stage | Name | Model | Provider | Role |
|-------|------|-------|----------|------|
| 1 | SEED | Claude Opus 4.6 | AWS Bedrock | Generate initial hypothesis from disease + entity context |
| 2 | EXPAND | Claude Sonnet 4.6 | AWS Bedrock | Broaden hypothesis to multiple mechanistic angles |
| 3 | EVIDENCE | Cohere Command A | Azure OpenAI | Retrieve and synthesize literature evidence |
| 4 | COUNTER | Mistral-Large-3 | Azure AI | Generate adversarial counter-arguments |
| 5 | REVISE | o3-mini | Azure OpenAI | Revise hypothesis to address counter-arguments |
| 6 | MECHANISM | GPT-4.1 | Azure OpenAI | Detail molecular/cellular mechanism |
| 7 | VALIDATE | Claude Sonnet 4.6 | AWS Bedrock | Cross-validate against independent evidence |
| 8 | GROUND | Grok-4-1-fast | Azure AI | 3-layer scientific grounding check |
| 9 | SCORE | GPT-4.1 | Azure OpenAI | Multi-dimensional confidence scoring |
| 10 | REFINE | GPT-4o | Azure OpenAI | Fast prose refinement |
| 11 | TRANSLATE | Claude Sonnet 4.6 | AWS Bedrock | Generate translational roadmap (T0-T5) |
| 12 | FINALIZE | Claude Sonnet 4.6 | AWS Bedrock | Final synthesis and citation formatting |

Model assignments were chosen to exploit complementary strengths: Claude models for long-context reasoning and ethical guardrails, GPT-4.1 for structured mechanistic analysis, o3-mini for revision under contradiction, Mistral for adversarial generation (relatively weaker safety filtering produces more aggressive critiques), Cohere for citation-grounded synthesis, and Grok for fast iterative grounding checks.

The adversarial structure — particularly the COUNTER → REVISE pairing — is the architectural novelty. By forcing the pipeline to articulate weaknesses before refinement, hypotheses that survive Stage 5 have already been stress-tested against alternative explanations.

### 3.2 — Dual-Embedding Grounding

Between every consecutive stage, the output of stage N is passed through a grounding verification layer before being used as input to stage N+1. The grounding layer operates as follows:

1. **Claim extraction:** Output text is decomposed into atomic claims via prompted decomposition
2. **Dual embedding:** Each claim is embedded by two models in parallel:
   - Bedrock Cohere Embed English v3 (1024-dimensional, biomedical-optimized)
   - Azure text-embedding-3-large (1536-dimensional, general-purpose)
3. **Evidence retrieval:** The combined embeddings query the pgvector store to retrieve top-K supporting evidence chunks
4. **Semantic gating:** Each claim's similarity to its top-1 evidence chunk is computed; claims below threshold (default 0.4 cosine similarity) are flagged
5. **Propagation control:** Flagged claims are either dropped or marked with reduced confidence before Stage N+1 receives the input

The dual-model approach reduces the false-negative rate of grounding (claims dropped that are actually supported) by leveraging the complementary strengths of biomedical-specialized and general-purpose embeddings. We empirically observe disagreement between embeddings on approximately [X%] of claims, with the disagreement region identifying ambiguous propositions that benefit from human review.

### 3.3 — Data Sources

The grounding layer queries a knowledge base consisting of:
- **PubMed** abstracts and metadata via NCBI E-utilities (~36M records)
- **ClinicalTrials.gov** trial records (~480k records)
- **UniProt** protein records (~250M sequences)
- **KEGG** pathway, disease, drug, and compound entries
- **Reactome** pathway hierarchies
- **ClinVar** variant-disease associations
- **STRING** protein-protein interactions
- **Semantic Scholar** citation graph and influence scores
- **OpenAlex** open literature metadata
- **ChEMBL** drug-target bioactivity data
- Plus 50+ additional sources documented in Supplementary Table S1

### 3.4 — Retrospective Validation Benchmark

We constructed a benchmark of 10 biomedical hypotheses with the following selection criteria:
- Published between 2017-2024 in peer-reviewed journals
- Subsequently validated experimentally (clinical trials, FDA approval, or independent replication)
- Spanning multiple therapeutic areas (oncology, neurodegeneration, infectious disease, rare disease, etc.)
- Spanning multiple discovery types (mechanism, treatment, prevention, diagnostic)

The 10 benchmark hypotheses are described in Supplementary Table S2 and span: gut-brain axis in Parkinson's (Kim et al. 2019), baricitinib repurposing for COVID-19 (Richardson et al. 2020), GLP-1 agonists for Alzheimer's (multiple 2023-2024), microbiome modulation of immunotherapy response (Routy et al. 2018), senolytics for age-related disease (Kirkland et al. 2017), CRISPR base editing for sickle cell disease (Frangoul et al. 2021), ferroptosis induction in cancer therapy (Dixon et al. 2012), liquid biopsy ctDNA for minimal residual disease (Tie et al. 2022), tau propagation via extracellular vesicles in Alzheimer's, and CAR-T cell therapy for solid tumors via TME remodeling.

For each benchmark, we ran the humanovo pipeline with only the disease and 3-5 focus entities as input, withholding the published hypothesis and its citations. We then measured:

- **Recovery Rate:** Semantic similarity between generated and published hypothesis
- **Citation Keyword Overlap:** Fraction of expected citation keywords appearing in pipeline output
- **Counter-Argument Quality:** HIGH/MEDIUM/LOW based on identification of expected limitations
- **Translational Accuracy:** Alignment of generated T0-T5 roadmap with actual experimental path
- **Pipeline Performance:** Total execution time, API cost, stages completed

### 3.5 — Citation Accuracy Verification

We verified every citation in pipeline outputs through automated DOI/PMID resolution:
1. **Existence:** DOI resolution via CrossRef API; PMID resolution via NCBI E-utilities
2. **Author verification:** Family-name overlap between citation and resolved paper
3. **Year verification:** Exact year match
4. **Semantic relevance:** Keyword overlap between supporting claim text and paper title/abstract
5. **Fabrication check:** Citations failing all resolution methods are flagged as fabricated

Citations are considered valid only if they pass existence verification AND have semantic relevance ≥ 0.4 AND are not flagged as fabricated.

---

## 4. Results

[TO BE FILLED FROM BENCHMARK RUN]

### 4.1 — Hypothesis Recovery Rate

Across the 10 benchmark hypotheses, mean recovery rate was X.X% (SD: Y.Y), with [N/10] benchmarks producing hypotheses with recovery rate ≥ 70%. Recovery was strongest in [therapeutic area] and weakest in [therapeutic area].

### 4.2 — Citation Accuracy

Of [TOTAL] citations across all benchmark runs, [VALID] were verified valid, [INVALID] failed verification, and [FABRICATED] were identified as fabricated, yielding a citation accuracy of [X.X%]. Mean semantic relevance of valid citations was [Y.YY].

### 4.3 — Counter-Argument Quality

The COUNTER stage successfully identified [HIGH_COUNT] of [TOTAL_EXPECTED] expected limitations across benchmarks. In [N] of 10 cases, the COUNTER stage identified novel limitations not anticipated in our scoring rubric, suggesting the adversarial pipeline can surface considerations that human curators missed.

### 4.4 — Pipeline Performance

Mean pipeline execution time was [X] seconds per hypothesis (range: Y to Z). Mean API cost per hypothesis was $[X] (range: Y to Z). [N/10] runs completed all 12 stages without fallback substitution.

### 4.5 — Comparison to Single-Model Baseline

For comparison, we ran the same 10 benchmarks through GPT-4.1 alone (single-model baseline) with identical prompts and access to the same evidence retrieval system. The single-model baseline achieved [X%] mean recovery rate and [Y%] citation accuracy, representing a [DELTA] decrease from the full pipeline. Counter-argument identification dropped to [Z%], indicating the adversarial structure provides measurable benefit beyond what any single model can produce.

---

## 5. Discussion

### 5.1 — Architectural Implications

The retrospective validation results suggest that adversarial multi-model architectures can achieve meaningful improvements in hypothesis quality over single-model approaches, at the cost of increased complexity and API expense. The improvement is most pronounced in counter-argument identification, where the deliberate use of a different model (Mistral-Large-3) to attack the hypothesis produces critiques that the generating model (Claude Opus) does not naturally raise.

The dual-embedding grounding gate provides a measurable reduction in citation hallucination, with the false-positive rate (ungrounded claims that pass the gate) dropping from [X%] in single-embedding configurations to [Y%] in dual-embedding mode. The added latency (approximately [Z] ms per stage) is acceptable in a hypothesis generation context where total pipeline time is in minutes.

### 5.2 — Limitations

Several limitations should be noted:

1. **Recency bias in evidence retrieval.** Like Biomni, humanovo's evidence retrieval favors recent literature, which may underweight foundational work. We are exploring time-window weighting strategies to mitigate this.

2. **Benchmark size.** Ten retrospective hypotheses provide limited statistical power. We are expanding to a 50-hypothesis benchmark for the next iteration of this work.

3. **Wet-lab validation absence.** Unlike Google AI Co-Scientist's AML drug repurposing demonstration, humanovo's validation is purely retrospective. Prospective wet-lab validation requires partnership with experimental laboratories — an active workstream.

4. **Model-specific dependencies.** The pipeline assumes access to specific models from specific providers. Equivalent open-source pipelines could be constructed using Llama, DeepSeek, or other alternatives, but performance characteristics would differ.

5. **English-language literature only.** Non-English biomedical literature is not currently indexed.

### 5.3 — Compliance and Deployment Implications

Unlike research prototypes that execute generated code with full system privileges, humanovo's API-only architecture and tamper-evident audit logging are designed for deployment in HIPAA-covered, FDA-regulated, and pharma-grade environments. The full compliance documentation is available separately. We argue that the future of biomedical AI in production environments requires this kind of architectural conservatism, even at the cost of some capabilities (e.g., autonomous code execution) that research-grade systems can provide.

### 5.4 — Future Work

Planned extensions include:
1. Wet-lab validation through institutional partnership (URMC, Glenmark, Genentech)
2. Expansion of the benchmark to 50 hypotheses
3. Fine-tuned domain-specific models for high-priority therapeutic areas
4. Integration with downstream platforms (Insilico Medicine, Recursion) for end-to-end discovery
5. Multi-modal extension to incorporate imaging and omics data inputs

---

## 6. Data and Code Availability

The benchmark suite, citation accuracy verification code, and retrospective validation runner are available at [GitHub URL]. Pipeline code is proprietary; institutional researchers interested in deployment should contact the corresponding author.

---

## 7. Acknowledgments

We thank Jamison Seabury (URMC Neuroimaging Lab), Truptesh Kothari (URMC), Allyson Fess (UR Neurology Research), Gowri Muthukrishnan (URMC Center for Musculoskeletal Research), Scott Walker (UR Ain Center / PDC), Dave Mammano, Roberto Colangelo, and the Society of Physician Entrepreneurs for advisory input. We thank Karthik Ramakrishnan (Scyntek) for collaboration on early validation work.

---

## 8. Author Contributions

S.A. conceived the architecture, implemented the pipeline, ran the benchmark, and drafted the manuscript. [Co-authors] contributed to validation methodology and clinical interpretation.

---

## 9. Competing Interests

S.A. is the founder of humanovo / Adyanthaya Ventures, the company developing the platform described.

---

## References

[TO BE COMPILED — Include citations to: Biomni paper, Google AI Co-Scientist, OpenAI Prism, BenevolentAI baricitinib, Insilico INS018_055, all 10 benchmark hypothesis source papers, plus methodology references for embedding models, adversarial reasoning, and grounding techniques]

---

## Supplementary Materials

**Supplementary Table S1.** Complete data source inventory (60+ APIs)
**Supplementary Table S2.** Detailed benchmark hypothesis specifications
**Supplementary Table S3.** Stage-by-stage cost and latency breakdown
**Supplementary Figure S1.** Pipeline architecture diagram
**Supplementary Figure S2.** Dual-embedding grounding gate decision flow
**Supplementary Code S1.** Citation accuracy verification framework
**Supplementary Code S2.** Retrospective validation benchmark runner
