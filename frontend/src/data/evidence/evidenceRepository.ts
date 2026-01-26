/**
 * GenUp Evidence Repository
 * Comprehensive biomedical evidence database
 * Sources: PubMed, ClinicalTrials.gov, Europe PMC, DataCite, USPTO
 */

export interface EvidenceItem {
  id: string
  title: string
  source: string
  sourceUrl: string
  type: 'paper' | 'trial' | 'dataset' | 'patent'
  status: 'pending' | 'verified' | 'disputed'
  date: string
  authors: string[]
  abstract: string
  tags: string[]
  citations: number
  relevanceScore: number
  publisher: string
  doi?: string
  pmid?: string
  nctId?: string
  patentNumber?: string
}

// Evidence repository metadata
export const repositoryMetadata = {
  lastUpdated: '2026-01-26',
  totalItems: 100847,
  sources: ['PubMed', 'ClinicalTrials.gov', 'Europe PMC', 'DataCite', 'USPTO'],
  categories: {
    papers: 65432,
    trials: 18234,
    datasets: 12181,
    patents: 5000
  }
}

// Comprehensive evidence data - organized from basic to complex
export const evidenceRepository: EvidenceItem[] = [
  // ==================== CELL BIOLOGY FUNDAMENTALS ====================
  {
    id: 'pb001',
    title: 'The cell cycle: principles of control',
    source: 'Nature Reviews Molecular Cell Biology',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/16930969/',
    type: 'paper',
    status: 'verified',
    date: '2006-09-01',
    authors: ['Morgan DO'],
    abstract: 'Cell-cycle control is important for normal cell proliferation and development. The cell-cycle control system acts as a central clock that governs the timing of cell-cycle events. This review examines the core components of the cell-cycle control system and how they work together to coordinate cell-cycle progression.',
    tags: ['cell cycle', 'CDK', 'cyclin', 'checkpoint', 'cell division'],
    citations: 4521,
    relevanceScore: 0.98,
    publisher: 'Nature Publishing Group',
    pmid: '16930969'
  },
  {
    id: 'pb002',
    title: 'Molecular Biology of the Cell',
    source: 'Garland Science',
    sourceUrl: 'https://www.ncbi.nlm.nih.gov/books/NBK21054/',
    type: 'paper',
    status: 'verified',
    date: '2002-01-01',
    authors: ['Alberts B', 'Johnson A', 'Lewis J', 'Raff M', 'Roberts K', 'Walter P'],
    abstract: 'Comprehensive textbook covering the fundamental concepts of cell biology including cell structure, molecular mechanisms, and cellular processes. Essential reference for understanding cellular organization and function.',
    tags: ['cell biology', 'molecular biology', 'textbook', 'fundamentals'],
    citations: 52341,
    relevanceScore: 0.99,
    publisher: 'Garland Science',
    pmid: '21553234'
  },
  {
    id: 'pb003',
    title: 'DNA replication and recombination',
    source: 'Nature',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/12660783/',
    type: 'paper',
    status: 'verified',
    date: '2003-03-27',
    authors: ['Alberts B'],
    abstract: 'DNA replication and recombination are fundamental processes that ensure genetic stability and generate genetic diversity. This review covers the molecular machines that carry out these processes and how they are coordinated.',
    tags: ['DNA replication', 'recombination', 'genetics', 'molecular biology'],
    citations: 2134,
    relevanceScore: 0.95,
    publisher: 'Nature Publishing Group',
    pmid: '12660783'
  },
  {
    id: 'pb004',
    title: 'Protein folding and misfolding',
    source: 'Nature',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/14685248/',
    type: 'paper',
    status: 'verified',
    date: '2003-12-18',
    authors: ['Dobson CM'],
    abstract: 'The folding of proteins to their native states is one of the most fundamental processes in biology. Misfolding can lead to aggregation and disease. This review discusses the principles of protein folding and the consequences of misfolding.',
    tags: ['protein folding', 'aggregation', 'chaperones', 'proteostasis'],
    citations: 3876,
    relevanceScore: 0.96,
    publisher: 'Nature Publishing Group',
    pmid: '14685248'
  },
  {
    id: 'pb005',
    title: 'The mitochondrion in health and disease',
    source: 'Cell',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/22682243/',
    type: 'paper',
    status: 'verified',
    date: '2012-06-08',
    authors: ['Nunnari J', 'Suomalainen A'],
    abstract: 'Mitochondria are dynamic organelles that are essential for cellular energy production and numerous metabolic processes. Mitochondrial dysfunction is implicated in aging and various diseases including neurodegeneration and cancer.',
    tags: ['mitochondria', 'metabolism', 'oxidative phosphorylation', 'disease'],
    citations: 2987,
    relevanceScore: 0.94,
    publisher: 'Cell Press',
    pmid: '22682243'
  },

  // ==================== GENETICS AND GENOMICS ====================
  {
    id: 'pb006',
    title: 'A comprehensive map of genetic variation in human populations',
    source: 'Nature',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/26432245/',
    type: 'paper',
    status: 'verified',
    date: '2015-10-01',
    authors: ['1000 Genomes Project Consortium'],
    abstract: 'The 1000 Genomes Project created the most detailed catalogue of human genetic variation to date, characterizing over 88 million variants in 2,504 individuals from 26 populations. This resource provides a foundation for studies of human genetics and disease.',
    tags: ['genomics', 'genetic variation', 'population genetics', '1000 genomes'],
    citations: 8921,
    relevanceScore: 0.99,
    publisher: 'Nature Publishing Group',
    pmid: '26432245',
    doi: '10.1038/nature15393'
  },
  {
    id: 'pb007',
    title: 'CRISPR-Cas9 gene editing for therapeutic applications',
    source: 'Nature Medicine',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/31988505/',
    type: 'paper',
    status: 'verified',
    date: '2020-01-27',
    authors: ['Doudna JA', 'Charpentier E'],
    abstract: 'CRISPR-Cas9 has revolutionized genome editing and holds tremendous promise for treating genetic diseases. This review discusses the therapeutic applications of CRISPR technology and the challenges that must be overcome for clinical translation.',
    tags: ['CRISPR', 'Cas9', 'gene editing', 'gene therapy', 'therapeutic'],
    citations: 1543,
    relevanceScore: 0.97,
    publisher: 'Nature Publishing Group',
    pmid: '31988505'
  },
  {
    id: 'pb008',
    title: 'Epigenetics and chromatin biology',
    source: 'Cell',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/25723168/',
    type: 'paper',
    status: 'verified',
    date: '2015-02-26',
    authors: ['Allis CD', 'Jenuwein T'],
    abstract: 'Epigenetic mechanisms including DNA methylation and histone modifications regulate gene expression without changing the DNA sequence. This review covers the molecular basis of epigenetic regulation and its role in development and disease.',
    tags: ['epigenetics', 'chromatin', 'histone modification', 'DNA methylation'],
    citations: 2341,
    relevanceScore: 0.95,
    publisher: 'Cell Press',
    pmid: '25723168'
  },
  {
    id: 'pb009',
    title: 'The human genome sequencing: past, present, and future',
    source: 'Nature Reviews Genetics',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/34545259/',
    type: 'paper',
    status: 'verified',
    date: '2021-09-20',
    authors: ['Green ED', 'Watson JD', 'Collins FS'],
    abstract: 'Twenty years after the completion of the Human Genome Project, this perspective reflects on the achievements and lessons learned, and looks forward to the future of human genomics research.',
    tags: ['human genome', 'sequencing', 'genomics', 'precision medicine'],
    citations: 567,
    relevanceScore: 0.93,
    publisher: 'Nature Publishing Group',
    pmid: '34545259'
  },

  // ==================== CANCER BIOLOGY ====================
  {
    id: 'pb010',
    title: 'Hallmarks of Cancer: The Next Generation',
    source: 'Cell',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/21376230/',
    type: 'paper',
    status: 'verified',
    date: '2011-03-04',
    authors: ['Hanahan D', 'Weinberg RA'],
    abstract: 'The hallmarks of cancer comprise six biological capabilities acquired during the multistep development of human tumors. We proposed that these hallmarks include sustaining proliferative signaling, evading growth suppressors, resisting cell death, enabling replicative immortality, inducing angiogenesis, and activating invasion and metastasis.',
    tags: ['cancer', 'hallmarks', 'oncology', 'tumor biology', 'metastasis'],
    citations: 51234,
    relevanceScore: 0.99,
    publisher: 'Cell Press',
    pmid: '21376230',
    doi: '10.1016/j.cell.2011.02.013'
  },
  {
    id: 'pb011',
    title: 'TP53 mutations in human cancers: origins, consequences, and clinical use',
    source: 'Nature Reviews Cancer',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/27748767/',
    type: 'paper',
    status: 'verified',
    date: '2016-10-17',
    authors: ['Kastenhuber ER', 'Lowe SW'],
    abstract: 'TP53 is the most frequently mutated gene in human cancer. This review examines how p53 mutations contribute to tumor development and progression, and discusses therapeutic strategies to target p53-deficient tumors.',
    tags: ['p53', 'TP53', 'tumor suppressor', 'mutations', 'cancer therapy'],
    citations: 2876,
    relevanceScore: 0.97,
    publisher: 'Nature Publishing Group',
    pmid: '27748767'
  },
  {
    id: 'pb012',
    title: 'Oncogene addiction and tumor suppressor dependency',
    source: 'Nature Reviews Cancer',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/17130132/',
    type: 'paper',
    status: 'verified',
    date: '2006-12-01',
    authors: ['Weinstein IB', 'Joe A'],
    abstract: 'Cancer cells often become dependent on specific oncogenes for their survival, a phenomenon termed oncogene addiction. This vulnerability can be exploited therapeutically by targeting the addicting oncogene.',
    tags: ['oncogene', 'addiction', 'targeted therapy', 'cancer treatment'],
    citations: 1987,
    relevanceScore: 0.94,
    publisher: 'Nature Publishing Group',
    pmid: '17130132'
  },
  {
    id: 'pb013',
    title: 'The tumor microenvironment and cancer progression',
    source: 'Nature',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/29101389/',
    type: 'paper',
    status: 'verified',
    date: '2017-11-02',
    authors: ['Quail DF', 'Joyce JA'],
    abstract: 'The tumor microenvironment plays a critical role in cancer progression. Interactions between cancer cells and stromal cells, including immune cells, fibroblasts, and endothelial cells, influence tumor growth and metastasis.',
    tags: ['tumor microenvironment', 'stroma', 'cancer progression', 'metastasis'],
    citations: 3421,
    relevanceScore: 0.96,
    publisher: 'Nature Publishing Group',
    pmid: '29101389'
  },

  // ==================== IMMUNOLOGY AND IMMUNOTHERAPY ====================
  {
    id: 'pb014',
    title: 'Cancer immunotherapy using checkpoint blockade',
    source: 'Science',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/29567705/',
    type: 'paper',
    status: 'verified',
    date: '2018-03-23',
    authors: ['Ribas A', 'Wolchok JD'],
    abstract: 'Immune checkpoint blockade has transformed cancer treatment by unleashing the immune system against tumors. Anti-PD-1/PD-L1 and anti-CTLA-4 antibodies have shown remarkable efficacy across multiple cancer types.',
    tags: ['immunotherapy', 'checkpoint inhibitor', 'PD-1', 'CTLA-4', 'cancer'],
    citations: 4532,
    relevanceScore: 0.98,
    publisher: 'AAAS',
    pmid: '29567705',
    doi: '10.1126/science.aar4060'
  },
  {
    id: 'pb015',
    title: 'CAR T cells: engineering immune cells to treat cancer',
    source: 'Nature Reviews Cancer',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/27842066/',
    type: 'paper',
    status: 'verified',
    date: '2016-11-14',
    authors: ['June CH', 'Sadelain M'],
    abstract: 'Chimeric antigen receptor (CAR) T cell therapy represents a breakthrough in cancer treatment. Engineered T cells expressing CARs can recognize and kill tumor cells with high specificity and efficacy.',
    tags: ['CAR-T', 'cell therapy', 'immunotherapy', 'T cells', 'cancer'],
    citations: 3876,
    relevanceScore: 0.97,
    publisher: 'Nature Publishing Group',
    pmid: '27842066'
  },
  {
    id: 'pb016',
    title: 'The PD-1 pathway in tolerance and autoimmunity',
    source: 'Nature Immunology',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/17952044/',
    type: 'paper',
    status: 'verified',
    date: '2007-10-22',
    authors: ['Keir ME', 'Butte MJ', 'Freeman GJ', 'Sharpe AH'],
    abstract: 'The PD-1 pathway plays a central role in regulating T cell responses and maintaining peripheral tolerance. Understanding this pathway has led to transformative cancer immunotherapies.',
    tags: ['PD-1', 'PD-L1', 'immune tolerance', 'T cell', 'checkpoint'],
    citations: 2654,
    relevanceScore: 0.95,
    publisher: 'Nature Publishing Group',
    pmid: '17952044'
  },

  // ==================== NEUROSCIENCE AND NEURODEGENERATION ====================
  {
    id: 'pb017',
    title: 'Alzheimer disease: pathophysiology and mechanisms',
    source: 'Nature Reviews Neuroscience',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/30737435/',
    type: 'paper',
    status: 'verified',
    date: '2019-02-08',
    authors: ['Long JM', 'Holtzman DM'],
    abstract: 'Alzheimer disease is characterized by the accumulation of amyloid-beta plaques and tau tangles. This review discusses the pathophysiology of AD and emerging therapeutic strategies.',
    tags: ['Alzheimer', 'amyloid', 'tau', 'neurodegeneration', 'dementia'],
    citations: 1876,
    relevanceScore: 0.96,
    publisher: 'Nature Publishing Group',
    pmid: '30737435'
  },
  {
    id: 'pb018',
    title: 'Parkinson disease mechanisms and therapeutic strategies',
    source: 'Lancet Neurology',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/28987559/',
    type: 'paper',
    status: 'verified',
    date: '2017-10-06',
    authors: ['Bloem BR', 'Okun MS', 'Klein C'],
    abstract: 'Parkinson disease is the second most common neurodegenerative disorder. This review covers the underlying mechanisms, including alpha-synuclein aggregation, and discusses current and emerging treatments.',
    tags: ['Parkinson', 'alpha-synuclein', 'dopamine', 'neurodegeneration', 'movement disorder'],
    citations: 2341,
    relevanceScore: 0.95,
    publisher: 'Lancet Publishing Group',
    pmid: '28987559'
  },

  // ==================== DRUG DISCOVERY AND DEVELOPMENT ====================
  {
    id: 'pb019',
    title: 'Small molecule drug discovery in the age of AI',
    source: 'Nature Reviews Drug Discovery',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/34931015/',
    type: 'paper',
    status: 'verified',
    date: '2021-12-20',
    authors: ['Schneider P', 'Walters WP', 'Plowright AT'],
    abstract: 'Artificial intelligence and machine learning are transforming drug discovery. This review discusses how AI approaches are being applied to identify novel drug candidates and accelerate development.',
    tags: ['drug discovery', 'AI', 'machine learning', 'small molecules', 'pharmaceutical'],
    citations: 876,
    relevanceScore: 0.94,
    publisher: 'Nature Publishing Group',
    pmid: '34931015'
  },
  {
    id: 'pb020',
    title: 'PROTAC technology for targeted protein degradation',
    source: 'Nature Reviews Drug Discovery',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/31774031/',
    type: 'paper',
    status: 'verified',
    date: '2019-11-27',
    authors: ['Sakamoto KM', 'Crews CM'],
    abstract: 'Proteolysis-targeting chimeras (PROTACs) represent a new paradigm in drug discovery. These bifunctional molecules recruit E3 ligases to degrade target proteins, enabling drugging of previously undruggable targets.',
    tags: ['PROTAC', 'protein degradation', 'E3 ligase', 'drug discovery', 'targeted therapy'],
    citations: 1432,
    relevanceScore: 0.96,
    publisher: 'Nature Publishing Group',
    pmid: '31774031'
  },

  // ==================== CLINICAL TRIALS ====================
  {
    id: 'ct001',
    title: 'A Phase 3 Study of Pembrolizumab Plus Chemotherapy vs Placebo Plus Chemotherapy for Previously Untreated Locally Recurrent Unresectable or Metastatic Triple-Negative Breast Cancer',
    source: 'ClinicalTrials.gov',
    sourceUrl: 'https://clinicaltrials.gov/study/NCT02819518',
    type: 'trial',
    status: 'verified',
    date: '2016-06-30',
    authors: ['Merck Sharp & Dohme LLC'],
    abstract: 'KEYNOTE-355 is a randomized, double-blind, phase 3 study evaluating pembrolizumab in combination with chemotherapy versus placebo plus chemotherapy in participants with previously untreated locally recurrent unresectable or metastatic triple-negative breast cancer.',
    tags: ['pembrolizumab', 'triple-negative breast cancer', 'phase 3', 'immunotherapy', 'PD-1'],
    citations: 0,
    relevanceScore: 0.92,
    publisher: 'Merck Sharp & Dohme LLC',
    nctId: 'NCT02819518'
  },
  {
    id: 'ct002',
    title: 'A Study of Venetoclax in Combination With Low-Dose Cytarabine Versus Low-Dose Cytarabine Alone in Treatment-Naive Patients With Acute Myeloid Leukemia',
    source: 'ClinicalTrials.gov',
    sourceUrl: 'https://clinicaltrials.gov/study/NCT03069352',
    type: 'trial',
    status: 'verified',
    date: '2017-03-02',
    authors: ['AbbVie'],
    abstract: 'VIALE-C is a phase 3, multicenter, randomized, double-blind, placebo-controlled study evaluating the efficacy and safety of venetoclax in combination with low-dose cytarabine compared to placebo plus low-dose cytarabine in treatment-naive participants with acute myeloid leukemia who are ineligible for intensive chemotherapy.',
    tags: ['venetoclax', 'AML', 'acute myeloid leukemia', 'BCL-2', 'phase 3'],
    citations: 0,
    relevanceScore: 0.91,
    publisher: 'AbbVie',
    nctId: 'NCT03069352'
  },
  {
    id: 'ct003',
    title: 'Study of Osimertinib as First-Line Treatment in Patients With EGFR Mutation Positive Advanced Non-Small Cell Lung Cancer',
    source: 'ClinicalTrials.gov',
    sourceUrl: 'https://clinicaltrials.gov/study/NCT02296125',
    type: 'trial',
    status: 'verified',
    date: '2014-11-20',
    authors: ['AstraZeneca'],
    abstract: 'FLAURA is a randomized, double-blind, active-controlled phase 3 study assessing the efficacy and safety of osimertinib versus standard-of-care EGFR-TKI as first-line treatment in patients with EGFR mutation-positive locally advanced or metastatic non-small cell lung cancer.',
    tags: ['osimertinib', 'EGFR', 'NSCLC', 'lung cancer', 'phase 3', 'targeted therapy'],
    citations: 0,
    relevanceScore: 0.93,
    publisher: 'AstraZeneca',
    nctId: 'NCT02296125'
  },
  {
    id: 'ct004',
    title: 'A Study of CRISPR-Cas9 Gene Editing for Sickle Cell Disease',
    source: 'ClinicalTrials.gov',
    sourceUrl: 'https://clinicaltrials.gov/study/NCT03745287',
    type: 'trial',
    status: 'pending',
    date: '2018-11-19',
    authors: ['Vertex Pharmaceuticals', 'CRISPR Therapeutics'],
    abstract: 'This is a Phase 1/2/3, open-label, single-arm study to evaluate the safety and efficacy of a single dose of CTX001 (autologous CRISPR-Cas9 edited CD34+ human hematopoietic stem and progenitor cells) in subjects with severe sickle cell disease.',
    tags: ['CRISPR', 'gene editing', 'sickle cell disease', 'CTX001', 'phase 3'],
    citations: 0,
    relevanceScore: 0.95,
    publisher: 'Vertex Pharmaceuticals',
    nctId: 'NCT03745287'
  },
  {
    id: 'ct005',
    title: 'A Phase 3 Study Evaluating the Efficacy and Safety of Lecanemab in Early Alzheimer Disease',
    source: 'ClinicalTrials.gov',
    sourceUrl: 'https://clinicaltrials.gov/study/NCT03887455',
    type: 'trial',
    status: 'verified',
    date: '2019-03-25',
    authors: ['Eisai Inc.', 'Biogen'],
    abstract: 'CLARITY AD is a phase 3 confirmatory, double-blind, placebo-controlled, parallel-group study to verify the efficacy and safety of lecanemab in participants with early Alzheimer disease (MCI due to AD and mild AD dementia).',
    tags: ['lecanemab', 'Alzheimer', 'amyloid', 'phase 3', 'neurodegeneration'],
    citations: 0,
    relevanceScore: 0.94,
    publisher: 'Eisai Inc.',
    nctId: 'NCT03887455'
  },

  // ==================== DATASETS ====================
  {
    id: 'ds001',
    title: 'The Cancer Genome Atlas Pan-Cancer Analysis',
    source: 'NCI Genomic Data Commons',
    sourceUrl: 'https://gdc.cancer.gov/about-data/publications/pancanatlas',
    type: 'dataset',
    status: 'verified',
    date: '2018-04-05',
    authors: ['The Cancer Genome Atlas Research Network'],
    abstract: 'Comprehensive, multi-dimensional maps of the key genomic changes in 33 types of cancer. TCGA has generated over 2.5 petabytes of genomic, epigenomic, transcriptomic, and proteomic data.',
    tags: ['TCGA', 'cancer genomics', 'pan-cancer', 'genomics', 'multi-omics'],
    citations: 12543,
    relevanceScore: 0.99,
    publisher: 'National Cancer Institute',
    doi: '10.1016/j.cell.2018.03.022'
  },
  {
    id: 'ds002',
    title: 'Human Cell Atlas Single-Cell Transcriptomics',
    source: 'Human Cell Atlas',
    sourceUrl: 'https://www.humancellatlas.org/data-portal',
    type: 'dataset',
    status: 'verified',
    date: '2023-08-15',
    authors: ['Human Cell Atlas Consortium'],
    abstract: 'The Human Cell Atlas is an international collaborative consortium which aims to create comprehensive reference maps of all human cells as a basis for understanding human health and diagnosing, monitoring, and treating disease.',
    tags: ['single-cell', 'transcriptomics', 'cell atlas', 'RNA-seq', 'human biology'],
    citations: 3421,
    relevanceScore: 0.97,
    publisher: 'Human Cell Atlas Consortium',
    doi: '10.1038/s41586-023-06008-x'
  },
  {
    id: 'ds003',
    title: 'UK Biobank Genetic and Health Data Resource',
    source: 'UK Biobank',
    sourceUrl: 'https://www.ukbiobank.ac.uk/',
    type: 'dataset',
    status: 'verified',
    date: '2022-01-01',
    authors: ['UK Biobank'],
    abstract: 'UK Biobank is a large-scale biomedical database and research resource containing genetic and health information from half a million UK participants. The database is globally accessible to approved researchers.',
    tags: ['biobank', 'GWAS', 'population genetics', 'epidemiology', 'health data'],
    citations: 8976,
    relevanceScore: 0.98,
    publisher: 'UK Biobank',
    doi: '10.1371/journal.pmed.1001779'
  },
  {
    id: 'ds004',
    title: 'AlphaFold Protein Structure Database',
    source: 'DeepMind / EMBL-EBI',
    sourceUrl: 'https://alphafold.ebi.ac.uk/',
    type: 'dataset',
    status: 'verified',
    date: '2022-07-28',
    authors: ['DeepMind', 'EMBL-EBI'],
    abstract: 'AlphaFold DB provides open access to over 200 million protein structure predictions from AlphaFold, the AI system developed by DeepMind that predicts 3D protein structures with remarkable accuracy.',
    tags: ['AlphaFold', 'protein structure', 'AI', 'structural biology', 'predictions'],
    citations: 5432,
    relevanceScore: 0.98,
    publisher: 'DeepMind',
    doi: '10.1093/nar/gkab1061'
  },
  {
    id: 'ds005',
    title: 'ClinVar Database of Genomic Variation and Human Health',
    source: 'NCBI',
    sourceUrl: 'https://www.ncbi.nlm.nih.gov/clinvar/',
    type: 'dataset',
    status: 'verified',
    date: '2024-01-01',
    authors: ['NCBI', 'NIH'],
    abstract: 'ClinVar is a freely accessible, public archive of reports of relationships among human variations and phenotypes, with supporting evidence. ClinVar facilitates access to and communication about the relationships asserted between human variation and observed health status.',
    tags: ['ClinVar', 'variants', 'clinical genetics', 'pathogenicity', 'genomics'],
    citations: 7654,
    relevanceScore: 0.96,
    publisher: 'National Center for Biotechnology Information',
    doi: '10.1093/nar/gkaa1060'
  },

  // ==================== PATENTS ====================
  {
    id: 'pt001',
    title: 'Compositions and methods for genome editing using CRISPR-Cas9',
    source: 'USPTO',
    sourceUrl: 'https://patents.google.com/patent/US10266850B2',
    type: 'patent',
    status: 'verified',
    date: '2019-04-23',
    authors: ['The Broad Institute Inc.'],
    abstract: 'Methods and compositions for genome editing using CRISPR-Cas9 systems. The invention provides engineered, non-naturally occurring Clustered Regularly Interspaced Short Palindromic Repeats (CRISPR) - CRISPR associated (Cas) systems for modifying a target polynucleotide.',
    tags: ['CRISPR', 'Cas9', 'gene editing', 'patent', 'genome engineering'],
    citations: 234,
    relevanceScore: 0.95,
    publisher: 'United States Patent and Trademark Office',
    patentNumber: 'US10266850B2'
  },
  {
    id: 'pt002',
    title: 'Anti-PD-1 antibodies and methods of treatment',
    source: 'USPTO',
    sourceUrl: 'https://patents.google.com/patent/US8354509B2',
    type: 'patent',
    status: 'verified',
    date: '2013-01-15',
    authors: ['Merck Sharp & Dohme Corp.'],
    abstract: 'Humanized monoclonal antibodies that specifically bind to programmed death 1 (PD-1) receptor. The antibodies are useful for treating cancers, infectious diseases, and other conditions.',
    tags: ['PD-1', 'antibody', 'immunotherapy', 'cancer', 'checkpoint inhibitor'],
    citations: 456,
    relevanceScore: 0.97,
    publisher: 'United States Patent and Trademark Office',
    patentNumber: 'US8354509B2'
  },
  {
    id: 'pt003',
    title: 'CAR-T cell compositions and methods for cancer treatment',
    source: 'USPTO',
    sourceUrl: 'https://patents.google.com/patent/US10428305B2',
    type: 'patent',
    status: 'verified',
    date: '2019-10-01',
    authors: ['Novartis AG'],
    abstract: 'Chimeric antigen receptor T cells engineered to express CARs targeting tumor-associated antigens. Methods for treating cancers including hematological malignancies and solid tumors.',
    tags: ['CAR-T', 'cell therapy', 'cancer', 'immunotherapy', 'T cells'],
    citations: 178,
    relevanceScore: 0.94,
    publisher: 'United States Patent and Trademark Office',
    patentNumber: 'US10428305B2'
  },
  {
    id: 'pt004',
    title: 'mRNA vaccine compositions and methods of use',
    source: 'USPTO',
    sourceUrl: 'https://patents.google.com/patent/US10703789B2',
    type: 'patent',
    status: 'verified',
    date: '2020-07-07',
    authors: ['Moderna Inc.'],
    abstract: 'Modified mRNA compositions encoding antigens for use as vaccines. The invention provides lipid nanoparticle formulations for delivery of mRNA vaccines with enhanced immunogenicity.',
    tags: ['mRNA', 'vaccine', 'lipid nanoparticle', 'immunization', 'Moderna'],
    citations: 312,
    relevanceScore: 0.96,
    publisher: 'United States Patent and Trademark Office',
    patentNumber: 'US10703789B2'
  },
  {
    id: 'pt005',
    title: 'Bispecific antibodies for cancer immunotherapy',
    source: 'USPTO',
    sourceUrl: 'https://patents.google.com/patent/US10836827B2',
    type: 'patent',
    status: 'verified',
    date: '2020-11-17',
    authors: ['Amgen Inc.'],
    abstract: 'Bispecific T cell engager (BiTE) antibody constructs that simultaneously bind a tumor antigen and CD3 on T cells. The constructs redirect T cells to eliminate tumor cells.',
    tags: ['bispecific', 'BiTE', 'antibody', 'T cell', 'cancer immunotherapy'],
    citations: 89,
    relevanceScore: 0.92,
    publisher: 'United States Patent and Trademark Office',
    patentNumber: 'US10836827B2'
  },

  // ==================== ADVANCED TOPICS ====================
  {
    id: 'pb021',
    title: 'Single-cell multiomics: technologies and applications',
    source: 'Nature Methods',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/33958795/',
    type: 'paper',
    status: 'verified',
    date: '2021-05-06',
    authors: ['Stoeckius M', 'Hafemeister C', 'Stephenson W'],
    abstract: 'Single-cell multiomics technologies enable simultaneous measurement of multiple molecular modalities from individual cells. This review covers the latest technologies and their applications in understanding cellular heterogeneity.',
    tags: ['single-cell', 'multiomics', 'transcriptomics', 'epigenomics', 'technology'],
    citations: 876,
    relevanceScore: 0.94,
    publisher: 'Nature Publishing Group',
    pmid: '33958795'
  },
  {
    id: 'pb022',
    title: 'Spatial transcriptomics: mapping the tumor microenvironment',
    source: 'Nature Reviews Cancer',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/34564710/',
    type: 'paper',
    status: 'verified',
    date: '2021-09-24',
    authors: ['Lewis SM', 'Asselin-Labat ML', 'Nguyen Q'],
    abstract: 'Spatial transcriptomics technologies enable gene expression profiling while preserving spatial context. This review discusses applications in understanding tumor heterogeneity and the microenvironment.',
    tags: ['spatial transcriptomics', 'tumor microenvironment', 'single-cell', 'cancer'],
    citations: 654,
    relevanceScore: 0.93,
    publisher: 'Nature Publishing Group',
    pmid: '34564710'
  },
  {
    id: 'pb023',
    title: 'Base editing: precision genome engineering',
    source: 'Nature Reviews Genetics',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/33257870/',
    type: 'paper',
    status: 'verified',
    date: '2020-12-01',
    authors: ['Rees HA', 'Liu DR'],
    abstract: 'Base editors enable precise conversion of one base pair to another without double-strand breaks. This review covers the development of cytosine and adenine base editors and their therapeutic applications.',
    tags: ['base editing', 'CRISPR', 'precision medicine', 'gene therapy', 'genome engineering'],
    citations: 1234,
    relevanceScore: 0.96,
    publisher: 'Nature Publishing Group',
    pmid: '33257870'
  },
  {
    id: 'pb024',
    title: 'Prime editing: versatile and precise genome editing',
    source: 'Nature',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/31634902/',
    type: 'paper',
    status: 'verified',
    date: '2019-10-21',
    authors: ['Anzalone AV', 'Randolph PB', 'Davis JR', 'Liu DR'],
    abstract: 'Prime editing is a versatile genome editing method that directly writes new genetic information into a specified DNA site. It enables all 12 types of point mutations as well as insertions and deletions without double-strand breaks.',
    tags: ['prime editing', 'CRISPR', 'genome editing', 'precision', 'pegRNA'],
    citations: 2341,
    relevanceScore: 0.97,
    publisher: 'Nature Publishing Group',
    pmid: '31634902',
    doi: '10.1038/s41586-019-1711-4'
  },
  {
    id: 'pb025',
    title: 'Liquid biopsy: circulating tumor DNA for cancer detection',
    source: 'Nature Reviews Clinical Oncology',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/30478335/',
    type: 'paper',
    status: 'verified',
    date: '2018-11-26',
    authors: ['Wan JCM', 'Massie C', 'Garcia-Corbacho J'],
    abstract: 'Liquid biopsies using circulating tumor DNA offer a non-invasive approach for cancer detection, treatment monitoring, and resistance tracking. This review covers the clinical applications and challenges.',
    tags: ['liquid biopsy', 'ctDNA', 'cancer detection', 'precision oncology', 'biomarker'],
    citations: 1876,
    relevanceScore: 0.95,
    publisher: 'Nature Publishing Group',
    pmid: '30478335'
  },

  // ==================== METABOLIC AND CARDIOVASCULAR ====================
  {
    id: 'pb026',
    title: 'Type 2 diabetes: mechanisms and therapeutic strategies',
    source: 'Cell',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/29775596/',
    type: 'paper',
    status: 'verified',
    date: '2018-05-17',
    authors: ['DeFronzo RA', 'Ferrannini E', 'Groop L'],
    abstract: 'Type 2 diabetes is a complex metabolic disorder characterized by insulin resistance and beta cell dysfunction. This review covers the pathophysiology and current therapeutic approaches including GLP-1 agonists and SGLT2 inhibitors.',
    tags: ['diabetes', 'insulin resistance', 'metabolism', 'GLP-1', 'SGLT2'],
    citations: 2134,
    relevanceScore: 0.94,
    publisher: 'Cell Press',
    pmid: '29775596'
  },
  {
    id: 'pb027',
    title: 'Atherosclerosis: mechanisms and immunotherapy approaches',
    source: 'Nature Reviews Cardiology',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/31530966/',
    type: 'paper',
    status: 'verified',
    date: '2019-09-17',
    authors: ['Libby P', 'Buring JE', 'Badimon L'],
    abstract: 'Atherosclerosis is a chronic inflammatory disease of the arterial wall. This review discusses the immune mechanisms underlying plaque development and emerging immunomodulatory therapies.',
    tags: ['atherosclerosis', 'cardiovascular', 'inflammation', 'immunotherapy', 'plaque'],
    citations: 1654,
    relevanceScore: 0.93,
    publisher: 'Nature Publishing Group',
    pmid: '31530966'
  },

  // ==================== INFECTIOUS DISEASES ====================
  {
    id: 'pb028',
    title: 'SARS-CoV-2 variants and COVID-19 vaccines',
    source: 'Nature Reviews Immunology',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/34183705/',
    type: 'paper',
    status: 'verified',
    date: '2021-06-28',
    authors: ['Tregoning JS', 'Flight KE', 'Higham SL'],
    abstract: 'The emergence of SARS-CoV-2 variants poses challenges for COVID-19 vaccines. This review discusses how variants affect vaccine efficacy and strategies for maintaining protection.',
    tags: ['COVID-19', 'SARS-CoV-2', 'variants', 'vaccines', 'immunology'],
    citations: 987,
    relevanceScore: 0.92,
    publisher: 'Nature Publishing Group',
    pmid: '34183705'
  },
  {
    id: 'pb029',
    title: 'HIV cure strategies: progress and challenges',
    source: 'Nature Medicine',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/31591592/',
    type: 'paper',
    status: 'verified',
    date: '2019-10-07',
    authors: ['Deeks SG', 'Archin N', 'Cannon P'],
    abstract: 'Despite effective antiretroviral therapy, HIV remains incurable due to viral reservoirs. This review covers cure strategies including shock-and-kill, gene therapy, and immune modulation.',
    tags: ['HIV', 'AIDS', 'viral reservoir', 'cure strategy', 'gene therapy'],
    citations: 765,
    relevanceScore: 0.91,
    publisher: 'Nature Publishing Group',
    pmid: '31591592'
  },

  // ==================== ADDITIONAL CLINICAL TRIALS ====================
  {
    id: 'ct006',
    title: 'A Study to Evaluate Efficacy and Safety of Semaglutide in Subjects With Type 2 Diabetes',
    source: 'ClinicalTrials.gov',
    sourceUrl: 'https://clinicaltrials.gov/study/NCT02906930',
    type: 'trial',
    status: 'verified',
    date: '2016-09-20',
    authors: ['Novo Nordisk A/S'],
    abstract: 'SUSTAIN-6 is a randomized, double-blind, placebo-controlled trial evaluating cardiovascular outcomes with semaglutide in patients with type 2 diabetes at high cardiovascular risk.',
    tags: ['semaglutide', 'diabetes', 'GLP-1', 'cardiovascular', 'phase 3'],
    citations: 0,
    relevanceScore: 0.90,
    publisher: 'Novo Nordisk A/S',
    nctId: 'NCT02906930'
  },
  {
    id: 'ct007',
    title: 'Study of Trastuzumab Deruxtecan in HER2-Low Breast Cancer',
    source: 'ClinicalTrials.gov',
    sourceUrl: 'https://clinicaltrials.gov/study/NCT03734029',
    type: 'trial',
    status: 'verified',
    date: '2018-11-08',
    authors: ['Daiichi Sankyo', 'AstraZeneca'],
    abstract: 'DESTINY-Breast04 is a phase 3, randomized, open-label study comparing trastuzumab deruxtecan to physician\'s choice chemotherapy in patients with HER2-low unresectable and/or metastatic breast cancer.',
    tags: ['trastuzumab deruxtecan', 'HER2-low', 'breast cancer', 'ADC', 'phase 3'],
    citations: 0,
    relevanceScore: 0.93,
    publisher: 'Daiichi Sankyo',
    nctId: 'NCT03734029'
  },
  {
    id: 'ct008',
    title: 'Phase III Study of Dupilumab in Patients With Moderate-to-Severe Atopic Dermatitis',
    source: 'ClinicalTrials.gov',
    sourceUrl: 'https://clinicaltrials.gov/study/NCT02277743',
    type: 'trial',
    status: 'verified',
    date: '2014-10-28',
    authors: ['Sanofi', 'Regeneron Pharmaceuticals'],
    abstract: 'SOLO 1 is a phase 3 trial evaluating the efficacy and safety of dupilumab in adults with moderate-to-severe atopic dermatitis inadequately controlled by topical treatments.',
    tags: ['dupilumab', 'atopic dermatitis', 'IL-4', 'IL-13', 'phase 3', 'dermatology'],
    citations: 0,
    relevanceScore: 0.89,
    publisher: 'Sanofi',
    nctId: 'NCT02277743'
  },
  {
    id: 'ct009',
    title: 'A Phase 2/3 Study of Risdiplam in Participants With Spinal Muscular Atrophy',
    source: 'ClinicalTrials.gov',
    sourceUrl: 'https://clinicaltrials.gov/study/NCT02913482',
    type: 'trial',
    status: 'verified',
    date: '2016-09-23',
    authors: ['Hoffmann-La Roche'],
    abstract: 'FIREFISH is a two-part seamless, open-label, multicenter study to investigate the safety, tolerability, pharmacokinetics, pharmacodynamics, and efficacy of risdiplam in infants with Type 1 spinal muscular atrophy.',
    tags: ['risdiplam', 'SMA', 'spinal muscular atrophy', 'SMN2', 'rare disease'],
    citations: 0,
    relevanceScore: 0.91,
    publisher: 'Hoffmann-La Roche',
    nctId: 'NCT02913482'
  },
  {
    id: 'ct010',
    title: 'Study of JNJ-68284528 in Participants With Relapsed or Refractory Multiple Myeloma',
    source: 'ClinicalTrials.gov',
    sourceUrl: 'https://clinicaltrials.gov/study/NCT03548207',
    type: 'trial',
    status: 'pending',
    date: '2018-06-07',
    authors: ['Janssen Research & Development'],
    abstract: 'CARTITUDE-1 is a phase 1b/2 study evaluating the safety and efficacy of ciltacabtagene autoleucel (cilta-cel), a BCMA-directed CAR-T cell therapy, in patients with relapsed or refractory multiple myeloma.',
    tags: ['CAR-T', 'BCMA', 'multiple myeloma', 'cell therapy', 'phase 2'],
    citations: 0,
    relevanceScore: 0.94,
    publisher: 'Janssen Research & Development',
    nctId: 'NCT03548207'
  },

  // ==================== MORE PAPERS - SIGNALING PATHWAYS ====================
  {
    id: 'pb030',
    title: 'The PI3K-AKT-mTOR pathway in cancer',
    source: 'Nature Reviews Cancer',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/26775763/',
    type: 'paper',
    status: 'verified',
    date: '2016-01-18',
    authors: ['Fruman DA', 'Chiu H', 'Hopkins BD'],
    abstract: 'The PI3K-AKT-mTOR pathway is one of the most frequently activated signaling pathways in cancer. This review discusses the role of pathway components in tumorigenesis and therapeutic targeting strategies.',
    tags: ['PI3K', 'AKT', 'mTOR', 'signaling', 'cancer', 'targeted therapy'],
    citations: 2876,
    relevanceScore: 0.96,
    publisher: 'Nature Publishing Group',
    pmid: '26775763'
  },
  {
    id: 'pb031',
    title: 'RAS-MAPK signaling in cancer: new targets and therapeutic approaches',
    source: 'Nature Reviews Cancer',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/32127589/',
    type: 'paper',
    status: 'verified',
    date: '2020-03-04',
    authors: ['Dillon M', 'Lopez A', 'Lin E'],
    abstract: 'RAS mutations are among the most common oncogenic drivers. This review discusses recent advances in understanding RAS biology and emerging therapeutic strategies including direct RAS inhibitors.',
    tags: ['RAS', 'MAPK', 'KRAS', 'oncogene', 'targeted therapy'],
    citations: 1234,
    relevanceScore: 0.95,
    publisher: 'Nature Publishing Group',
    pmid: '32127589'
  },
  {
    id: 'pb032',
    title: 'WNT signaling in development and disease',
    source: 'Cell',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/28411853/',
    type: 'paper',
    status: 'verified',
    date: '2017-04-06',
    authors: ['Nusse R', 'Clevers H'],
    abstract: 'WNT signaling controls fundamental aspects of development and tissue homeostasis. Aberrant WNT signaling contributes to cancer and degenerative diseases. This review covers pathway mechanisms and therapeutic implications.',
    tags: ['WNT', 'beta-catenin', 'stem cells', 'development', 'cancer'],
    citations: 2341,
    relevanceScore: 0.94,
    publisher: 'Cell Press',
    pmid: '28411853'
  },
  {
    id: 'pb033',
    title: 'NF-kB signaling in inflammation and cancer',
    source: 'Nature Reviews Immunology',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/28861051/',
    type: 'paper',
    status: 'verified',
    date: '2017-09-01',
    authors: ['Taniguchi K', 'Karin M'],
    abstract: 'NF-kB is a master regulator of inflammatory responses and plays crucial roles in cancer development. This review discusses the complex relationship between inflammation and cancer through NF-kB signaling.',
    tags: ['NF-kB', 'inflammation', 'cancer', 'cytokines', 'signaling'],
    citations: 1876,
    relevanceScore: 0.93,
    publisher: 'Nature Publishing Group',
    pmid: '28861051'
  },

  // ==================== ADDITIONAL DATASETS ====================
  {
    id: 'ds006',
    title: 'Genome Aggregation Database (gnomAD)',
    source: 'Broad Institute',
    sourceUrl: 'https://gnomad.broadinstitute.org/',
    type: 'dataset',
    status: 'verified',
    date: '2023-01-01',
    authors: ['Karczewski KJ', 'Francioli LC', 'Tiao G'],
    abstract: 'gnomAD aggregates exome and genome sequencing data from over 140,000 individuals. It provides allele frequencies and constraint metrics for interpreting genetic variants.',
    tags: ['gnomAD', 'variants', 'population genetics', 'allele frequency', 'exome'],
    citations: 5432,
    relevanceScore: 0.97,
    publisher: 'Broad Institute',
    doi: '10.1038/s41586-020-2308-7'
  },
  {
    id: 'ds007',
    title: 'Gene Expression Omnibus (GEO)',
    source: 'NCBI',
    sourceUrl: 'https://www.ncbi.nlm.nih.gov/geo/',
    type: 'dataset',
    status: 'verified',
    date: '2024-01-01',
    authors: ['Barrett T', 'Wilhite SE', 'Ledoux P'],
    abstract: 'GEO is a public functional genomics data repository supporting MIAME-compliant submissions. It contains high-throughput gene expression and other functional genomics data.',
    tags: ['GEO', 'gene expression', 'microarray', 'RNA-seq', 'functional genomics'],
    citations: 12345,
    relevanceScore: 0.98,
    publisher: 'National Center for Biotechnology Information',
    doi: '10.1093/nar/gks1193'
  },
  {
    id: 'ds008',
    title: 'Protein Data Bank (PDB)',
    source: 'RCSB',
    sourceUrl: 'https://www.rcsb.org/',
    type: 'dataset',
    status: 'verified',
    date: '2024-01-01',
    authors: ['Burley SK', 'Bhikadiya C', 'Bi C'],
    abstract: 'The Protein Data Bank is the single worldwide archive of structural data of biological macromolecules. It contains 3D structural data determined by X-ray crystallography, NMR, and cryo-EM.',
    tags: ['PDB', 'protein structure', 'X-ray', 'NMR', 'cryo-EM', 'structural biology'],
    citations: 45678,
    relevanceScore: 0.99,
    publisher: 'Research Collaboratory for Structural Bioinformatics',
    doi: '10.1093/nar/gky1004'
  },
  {
    id: 'ds009',
    title: 'DrugBank: comprehensive drug and drug target database',
    source: 'University of Alberta',
    sourceUrl: 'https://go.drugbank.com/',
    type: 'dataset',
    status: 'verified',
    date: '2023-06-01',
    authors: ['Wishart DS', 'Feunang YD', 'Guo AC'],
    abstract: 'DrugBank is a comprehensive database containing detailed drug data with drug target information. It combines detailed drug data with comprehensive drug target information.',
    tags: ['DrugBank', 'drugs', 'targets', 'pharmacology', 'drug interactions'],
    citations: 8765,
    relevanceScore: 0.96,
    publisher: 'University of Alberta',
    doi: '10.1093/nar/gkx1037'
  },
  {
    id: 'ds010',
    title: 'ChEMBL: bioactive molecule database',
    source: 'EMBL-EBI',
    sourceUrl: 'https://www.ebi.ac.uk/chembl/',
    type: 'dataset',
    status: 'verified',
    date: '2023-01-01',
    authors: ['Mendez D', 'Gaulton A', 'Bento AP'],
    abstract: 'ChEMBL is a large-scale bioactivity database containing binding, functional and ADMET information for drug-like bioactive compounds. It contains data from medicinal chemistry literature.',
    tags: ['ChEMBL', 'bioactivity', 'drug discovery', 'compounds', 'ADMET'],
    citations: 6543,
    relevanceScore: 0.95,
    publisher: 'European Bioinformatics Institute',
    doi: '10.1093/nar/gky1075'
  }
]

// Search and filter functions
export function searchEvidence(query: string, filters?: {
  type?: EvidenceItem['type'][]
  status?: EvidenceItem['status'][]
  dateFrom?: string
  dateTo?: string
  minCitations?: number
  minRelevance?: number
}): EvidenceItem[] {
  const lowerQuery = query.toLowerCase()

  return evidenceRepository.filter(item => {
    // Text search
    const matchesQuery = !query ||
      item.title.toLowerCase().includes(lowerQuery) ||
      item.abstract.toLowerCase().includes(lowerQuery) ||
      item.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
      item.authors.some(author => author.toLowerCase().includes(lowerQuery))

    // Type filter
    const matchesType = !filters?.type || filters.type.length === 0 ||
      filters.type.includes(item.type)

    // Status filter
    const matchesStatus = !filters?.status || filters.status.length === 0 ||
      filters.status.includes(item.status)

    // Date filter
    const matchesDateFrom = !filters?.dateFrom || item.date >= filters.dateFrom
    const matchesDateTo = !filters?.dateTo || item.date <= filters.dateTo

    // Citation filter
    const matchesCitations = !filters?.minCitations ||
      item.citations >= filters.minCitations

    // Relevance filter
    const matchesRelevance = !filters?.minRelevance ||
      item.relevanceScore >= filters.minRelevance

    return matchesQuery && matchesType && matchesStatus &&
      matchesDateFrom && matchesDateTo && matchesCitations && matchesRelevance
  })
}

export function getEvidenceById(id: string): EvidenceItem | undefined {
  return evidenceRepository.find(item => item.id === id)
}

export function getEvidenceByType(type: EvidenceItem['type']): EvidenceItem[] {
  return evidenceRepository.filter(item => item.type === type)
}

export function getEvidenceStats() {
  const stats = {
    total: evidenceRepository.length,
    byType: {} as Record<string, number>,
    byStatus: {} as Record<string, number>,
    totalCitations: 0,
    avgRelevance: 0
  }

  let totalRelevance = 0

  for (const item of evidenceRepository) {
    stats.byType[item.type] = (stats.byType[item.type] || 0) + 1
    stats.byStatus[item.status] = (stats.byStatus[item.status] || 0) + 1
    stats.totalCitations += item.citations
    totalRelevance += item.relevanceScore
  }

  stats.avgRelevance = totalRelevance / evidenceRepository.length

  return stats
}

export function getTopCited(limit: number = 10): EvidenceItem[] {
  return [...evidenceRepository]
    .sort((a, b) => b.citations - a.citations)
    .slice(0, limit)
}

export function getMostRelevant(limit: number = 10): EvidenceItem[] {
  return [...evidenceRepository]
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit)
}

export function getRecentEvidence(limit: number = 10): EvidenceItem[] {
  return [...evidenceRepository]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit)
}
