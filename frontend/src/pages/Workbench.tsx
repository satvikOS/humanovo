import { useState, useRef, useEffect } from 'react'
import {
  FiBox,
  FiZoomIn,
  FiZoomOut,
  FiRotateCw,
  FiMove,
  FiEye,
  FiEyeOff,
  FiTag,
  FiDownload,
  FiUpload,
  FiMaximize2,
  FiGrid,
  FiLayers,
  FiSettings,
  FiChevronRight,
  FiChevronDown,
  FiInfo,
  FiCrosshair,
  FiSearch,
  FiTarget
} from 'react-icons/fi'
import clsx from 'clsx'

// ==================== COMPREHENSIVE BIOLOGICAL DATA MODEL ====================

type BiologicalCategory =
  | 'organ_system'
  | 'cell_type'
  | 'cellular_component'
  | 'biomolecule'
  | 'pathway'
  | 'receptor'
  | 'antigen'
  | 'gene'
  | 'drug_target'
  | 'vaccine_target'

interface BiologicalComponent {
  id: string
  name: string
  category: BiologicalCategory
  subcategory?: string
  visible: boolean
  color: string
  tags: string[]
  description: string
  diseaseRelevance?: string
  therapeuticTargets?: string[]
  relatedComponents?: string[]
  clinicalSignificance?: string
  drugTargets?: string[]
  biomarkers?: string[]
  keyFacts?: string[]
}

// Category metadata
const categoryConfig: Record<BiologicalCategory, { label: string; color: string; icon: string }> = {
  organ_system: { label: 'Organ Systems', color: '#ef4444', icon: 'FiActivity' },
  cell_type: { label: 'Cell Types', color: '#f97316', icon: 'FiTarget' },
  cellular_component: { label: 'Cellular Components', color: '#eab308', icon: 'FiBox' },
  biomolecule: { label: 'Biomolecules', color: '#22c55e', icon: 'FiDatabase' },
  pathway: { label: 'Molecular Pathways', color: '#06b6d4', icon: 'FiActivity' },
  receptor: { label: 'Receptors', color: '#3b82f6', icon: 'FiLink2' },
  antigen: { label: 'Antigens', color: '#8b5cf6', icon: 'FiShield' },
  gene: { label: 'Genes & Regulation', color: '#ec4899', icon: 'FiBookOpen' },
  drug_target: { label: 'Therapeutic Targets', color: '#10b981', icon: 'FiTarget' },
  vaccine_target: { label: 'Vaccine Targets', color: '#14b8a6', icon: 'FiShield' },
}

// ==================== COMPREHENSIVE BIOLOGICAL STRUCTURES DATABASE ====================

const biologicalStructures: BiologicalComponent[] = [
  // === ORGAN SYSTEMS ===
  {
    id: 'immune_system',
    name: 'Immune & Lymphatic System',
    category: 'organ_system',
    subcategory: 'Primary Defense',
    visible: true,
    color: '#ef4444',
    tags: ['immunity', 'defense', 'cancer surveillance', 'infection'],
    description: 'The primary defense against infections (viruses, bacteria) and plays a key role in surveilling and eliminating cancerous cells.',
    diseaseRelevance: 'Central to all infectious diseases and cancer immunotherapy. HIV specifically depletes CD4+ T cells leading to AIDS.',
    therapeuticTargets: ['Checkpoint inhibitors (PD-1/PD-L1)', 'CAR-T therapy', 'Cytokine therapy'],
    relatedComponents: ['bone_marrow', 'thymus', 'spleen', 'lymph_nodes', 'cd4_t_cells', 'b_cells'],
    keyFacts: [
      'Primary lymphoid organs: bone marrow, thymus',
      'Secondary lymphoid organs: spleen, lymph nodes, tonsils, Peyer\'s patches',
      'Lymphatic vessels transport immune cells throughout body',
      'Skin and mucous membranes provide physical barriers'
    ]
  },
  {
    id: 'tumor_microenvironment',
    name: 'Tumor Microenvironment',
    category: 'organ_system',
    subcategory: 'Cancer Biology',
    visible: true,
    color: '#dc2626',
    tags: ['cancer', 'stroma', 'angiogenesis', 'immune infiltration'],
    description: 'The cellular environment in which tumors exist, including blood vessels, immune cells, fibroblasts, and extracellular matrix.',
    diseaseRelevance: 'Influences tumor growth and is a target for therapy. Anti-angiogenic therapy targets tumor blood vessels.',
    therapeuticTargets: ['VEGF inhibitors (bevacizumab)', 'Anti-angiogenic therapy', 'Stromal targeting'],
    relatedComponents: ['vegf', 'cancer_cells', 'fibroblasts'],
    keyFacts: [
      'Includes blood vessels, immune cells, fibroblasts, ECM',
      'Angiogenesis hijacked by tumors for nutrient supply',
      'VEGF blockade inhibits tumor blood supply',
      'Stromal cells influence tumor behavior'
    ]
  },
  {
    id: 'hematopoietic_system',
    name: 'Hematopoietic System',
    category: 'organ_system',
    subcategory: 'Blood & Marrow',
    visible: true,
    color: '#b91c1c',
    tags: ['blood', 'bone marrow', 'leukemia', 'lymphoma'],
    description: 'Bone marrow and blood system central to blood cell production and cancers like leukemias and lymphomas.',
    diseaseRelevance: 'Site of leukemias and lymphomas. Bone marrow transplantation used for treatment.',
    therapeuticTargets: ['BCR-ABL inhibitors', 'CD19 CAR-T', 'Stem cell transplant'],
    relatedComponents: ['bone_marrow', 'b_cells', 'cd4_t_cells', 'bcr_abl'],
    keyFacts: [
      'Produces all blood cells including immune cells',
      'Central to leukemias and lymphomas',
      'Bone marrow transplant can replace diseased cells',
      'Source of hematopoietic stem cells'
    ]
  },

  // === CELL TYPES - IMMUNE CELLS ===
  {
    id: 'cd4_t_cells',
    name: 'CD4⁺ T Helper Cells',
    category: 'cell_type',
    subcategory: 'Lymphocytes',
    visible: true,
    color: '#f97316',
    tags: ['adaptive immunity', 'HIV target', 'immune coordination', 'AIDS'],
    description: 'Helper T lymphocytes central to adaptive immunity. Primary host cells for HIV which infects and depletes them, leading to AIDS.',
    diseaseRelevance: 'HIV specifically infects CD4+ T cells. CD4 counts are key measure of HIV disease progression. Also orchestrate anti-tumor responses.',
    therapeuticTargets: ['Antiretrovirals for HIV', 'Checkpoint inhibitors to enhance function'],
    clinicalSignificance: 'CD4 count < 200 cells/μL defines AIDS diagnosis',
    relatedComponents: ['hiv_gp120', 'ccr5', 'pd1_pdl1', 'mhc_class_ii'],
    biomarkers: ['CD4 count', 'CD4/CD8 ratio'],
    keyFacts: [
      'Mature in thymus, express CD4 receptor',
      'Coordinate immune responses via cytokine secretion',
      'HIV primary target cell - uses CD4 + CCR5/CXCR4 for entry',
      'Depletion leads to immunodeficiency'
    ]
  },
  {
    id: 'cd8_t_cells',
    name: 'CD8⁺ Cytotoxic T Cells',
    category: 'cell_type',
    subcategory: 'Lymphocytes',
    visible: true,
    color: '#ea580c',
    tags: ['cell killing', 'antiviral', 'antitumor', 'CTL'],
    description: 'Cytotoxic T lymphocytes that directly kill virus-infected or malignant cells by recognizing peptide-MHC class I complexes.',
    diseaseRelevance: 'Central to eliminating infected and cancer cells. Target of checkpoint inhibitor therapy.',
    therapeuticTargets: ['Checkpoint inhibitors', 'CAR-T engineering', 'Therapeutic vaccines'],
    relatedComponents: ['mhc_class_i', 'pd1_pdl1', 'cancer_cells'],
    keyFacts: [
      'Kill infected/cancer cells via perforin/granzyme',
      'Recognize MHC class I presented peptides',
      'PD-1 inhibition enhances killing capacity',
      'Can become exhausted in chronic infection/cancer'
    ]
  },
  {
    id: 'b_cells',
    name: 'B Lymphocytes',
    category: 'cell_type',
    subcategory: 'Lymphocytes',
    visible: true,
    color: '#fb923c',
    tags: ['antibodies', 'humoral immunity', 'plasma cells', 'lymphoma'],
    description: 'B lymphocytes mature in bone marrow and produce antibodies (immunoglobulins) that neutralize pathogens or tag them for destruction.',
    diseaseRelevance: 'Produce neutralizing antibodies against pathogens. B-cell malignancies (lymphomas, leukemias) are common cancers.',
    therapeuticTargets: ['CD20 antibodies (rituximab)', 'CD19 CAR-T', 'Vaccine targets'],
    relatedComponents: ['antibodies', 'cd20', 'bcr'],
    keyFacts: [
      'Differentiate into antibody-secreting plasma cells',
      'Antibodies neutralize pathogens, activate complement',
      'CD19/CD20 are therapeutic targets in B-cell cancers',
      'Memory B cells provide long-term immunity'
    ]
  },
  {
    id: 'nk_cells',
    name: 'Natural Killer (NK) Cells',
    category: 'cell_type',
    subcategory: 'Lymphocytes',
    visible: true,
    color: '#c2410c',
    tags: ['innate immunity', 'tumor surveillance', 'ADCC', 'virus killing'],
    description: 'Innate immune cells that can lyse tumor cells or virus-infected cells without prior sensitization.',
    diseaseRelevance: 'Important for early tumor surveillance and viral clearance. Mediate antibody-dependent cellular cytotoxicity (ADCC).',
    therapeuticTargets: ['NK cell therapies', 'BiKE/TriKE engagers', 'Checkpoint modulation'],
    relatedComponents: ['cancer_cells', 'antibodies'],
    keyFacts: [
      'Kill without prior antigen sensitization',
      'Detect "missing self" (loss of MHC class I)',
      'Mediate ADCC via Fc receptors',
      'Important in antibody therapy efficacy'
    ]
  },
  {
    id: 'macrophages',
    name: 'Macrophages',
    category: 'cell_type',
    subcategory: 'Phagocytes',
    visible: true,
    color: '#d97706',
    tags: ['phagocytosis', 'antigen presentation', 'cytokines', 'inflammation'],
    description: 'Tissue-resident phagocytes that engulf pathogens or cancer cells and secrete cytokines to stimulate other immune cells.',
    diseaseRelevance: 'Critical for pathogen clearance. Tumor-associated macrophages can promote or inhibit tumor growth.',
    therapeuticTargets: ['CSF1R inhibitors', 'CD47-SIRPα blockade', 'Repolarization strategies'],
    relatedComponents: ['cytokines', 'mhc_class_ii', 'tumor_microenvironment'],
    keyFacts: [
      'Mature from blood monocytes',
      'Professional antigen presenting cells',
      'M1 (inflammatory) vs M2 (wound healing) polarization',
      'Can be co-opted by tumors (TAMs)'
    ]
  },
  {
    id: 'dendritic_cells',
    name: 'Dendritic Cells',
    category: 'cell_type',
    subcategory: 'Antigen Presenting Cells',
    visible: true,
    color: '#b45309',
    tags: ['antigen presentation', 'T cell activation', 'vaccines', 'adaptive immunity'],
    description: 'Professional antigen-presenting cells that capture antigens and migrate to lymph nodes to activate T cells.',
    diseaseRelevance: 'Critical for initiating adaptive immune responses. Target for dendritic cell vaccines.',
    therapeuticTargets: ['DC vaccines (Sipuleucel-T)', 'DC-based immunotherapy'],
    relatedComponents: ['cd4_t_cells', 'cd8_t_cells', 'mhc_class_i', 'mhc_class_ii'],
    keyFacts: [
      'Most potent antigen presenting cells',
      'Bridge innate and adaptive immunity',
      'Present on MHC class I (cross-presentation) and II',
      'Used in therapeutic cancer vaccines'
    ]
  },
  {
    id: 'neutrophils',
    name: 'Neutrophils',
    category: 'cell_type',
    subcategory: 'Granulocytes',
    visible: true,
    color: '#92400e',
    tags: ['first responders', 'phagocytosis', 'NETs', 'bacterial killing'],
    description: 'Abundant granulocytes (40-70% of WBCs) that serve as first responders to infections, killing bacteria and fungi.',
    diseaseRelevance: 'Critical for acute infection defense. Can attack tumor cells. Form neutrophil extracellular traps (NETs).',
    relatedComponents: ['cytokines', 'complement'],
    keyFacts: [
      'Most abundant white blood cell type',
      'First responders to infection',
      'NETs trap and kill pathogens',
      'Short-lived, continually replaced'
    ]
  },

  // === CELL TYPES - CANCER ===
  {
    id: 'cancer_cells',
    name: 'Cancer Cells',
    category: 'cell_type',
    subcategory: 'Malignant',
    visible: true,
    color: '#7c2d12',
    tags: ['mutation', 'proliferation', 'metastasis', 'immortality'],
    description: 'Transformed cells with mutations allowing uncontrolled growth, evasion of apoptosis, and invasion of other tissues.',
    diseaseRelevance: 'The fundamental unit of cancer. Classified by origin (carcinoma, leukemia, sarcoma).',
    therapeuticTargets: ['Targeted therapies', 'Chemotherapy', 'Immunotherapy', 'Radiation'],
    relatedComponents: ['tp53', 'kras', 'her2', 'pd1_pdl1', 'tumor_microenvironment'],
    keyFacts: [
      'Arise from normal cells via acquired mutations',
      'Hallmarks: sustained proliferation, evading growth suppressors',
      'Resist cell death, enable replicative immortality',
      'Induce angiogenesis, activate invasion/metastasis'
    ]
  },
  {
    id: 'cancer_stem_cells',
    name: 'Cancer Stem Cells',
    category: 'cell_type',
    subcategory: 'Malignant',
    visible: false,
    color: '#78350f',
    tags: ['tumor initiation', 'recurrence', 'therapy resistance', 'self-renewal'],
    description: 'Subpopulation of cancer cells with self-renewal capacity that may drive tumor recurrence and therapy resistance.',
    diseaseRelevance: 'May explain treatment resistance and cancer recurrence. Target for novel therapies.',
    therapeuticTargets: ['Stemness pathway inhibitors', 'Differentiation therapy'],
    relatedComponents: ['cancer_cells', 'wnt_pathway'],
    keyFacts: [
      'Can self-renew and differentiate',
      'May drive tumor initiation and recurrence',
      'Often resistant to conventional therapy',
      'Express specific surface markers'
    ]
  },

  // === CELLULAR COMPONENTS ===
  {
    id: 'cell_membrane',
    name: 'Cell Membrane',
    category: 'cellular_component',
    subcategory: 'Membrane',
    visible: true,
    color: '#eab308',
    tags: ['receptors', 'viral entry', 'signaling', 'antigens'],
    description: 'Lipid bilayer containing receptors that sense external signals and antigens displayed for immune recognition.',
    diseaseRelevance: 'Viruses exploit membrane receptors for entry (HIV uses CD4). Membrane proteins are major therapeutic targets.',
    therapeuticTargets: ['Monoclonal antibodies', 'Entry inhibitors', 'Receptor blockers'],
    relatedComponents: ['cd4_t_cells', 'her2', 'ccr5', 'mhc_class_i'],
    keyFacts: [
      'Contains receptors for signals and viral entry',
      'MHC molecules present antigens to T cells',
      'Cancer cells alter membrane proteins to evade immunity',
      'Major target for antibody therapies'
    ]
  },
  {
    id: 'nucleus',
    name: 'Nucleus',
    category: 'cellular_component',
    subcategory: 'Genetic',
    visible: true,
    color: '#ca8a04',
    tags: ['DNA', 'gene expression', 'mutations', 'viral integration'],
    description: 'Houses genetic material (DNA) and controls gene expression. Central to disease because mutations here drive cancer.',
    diseaseRelevance: 'Mutations in nuclear DNA can convert proto-oncogenes to oncogenes or disable tumor suppressors.',
    therapeuticTargets: ['Epigenetic modifiers', 'Transcription factor targets'],
    relatedComponents: ['tp53', 'kras', 'brca', 'dna_repair'],
    keyFacts: [
      'Control center for gene expression',
      'Viral genomes may integrate (HIV provirus)',
      'Genomic instability is hallmark of cancer',
      'DNA repair processes are study targets'
    ]
  },
  {
    id: 'mitochondria',
    name: 'Mitochondria',
    category: 'cellular_component',
    subcategory: 'Metabolic',
    visible: true,
    color: '#a16207',
    tags: ['ATP', 'apoptosis', 'Warburg effect', 'metabolism'],
    description: 'Powerhouses producing ATP but also regulate apoptosis. Mitochondrial dysfunction is focus in cancer metabolism.',
    diseaseRelevance: 'Apoptosis often suppressed through mitochondrial pathways in cancer (Bcl-2 overexpression).',
    therapeuticTargets: ['BH3 mimetics', 'Bcl-2 inhibitors (venetoclax)', 'Metabolic targeting'],
    relatedComponents: ['bcl2', 'apoptosis_pathway'],
    keyFacts: [
      'Release cytochrome c to trigger apoptosis',
      'Bcl-2 overexpression blocks death signals in cancer',
      'Cancer cells rewire metabolism (Warburg effect)',
      'mtDNA mutations can contribute to disease'
    ]
  },
  {
    id: 'proteasome',
    name: 'Proteasome',
    category: 'cellular_component',
    subcategory: 'Protein Degradation',
    visible: false,
    color: '#854d0e',
    tags: ['protein degradation', 'antigen processing', 'MHC presentation'],
    description: 'Protein degradation machinery that generates peptides presented on MHC class I for immune surveillance.',
    diseaseRelevance: 'Generates peptides for immune recognition. Proteasome inhibitors used in multiple myeloma.',
    therapeuticTargets: ['Bortezomib', 'Carfilzomib'],
    relatedComponents: ['mhc_class_i', 'cd8_t_cells'],
    keyFacts: [
      'Degrades damaged and misfolded proteins',
      'Generates peptides for MHC class I presentation',
      'Cancer cells depend on proteasome function',
      'Inhibition effective in myeloma'
    ]
  },

  // === BIOMOLECULES - PROTEINS ===
  {
    id: 'hiv_gp120',
    name: 'HIV gp120 Envelope',
    category: 'biomolecule',
    subcategory: 'Viral Protein',
    visible: true,
    color: '#22c55e',
    tags: ['HIV', 'viral entry', 'vaccine target', 'neutralizing antibodies'],
    description: 'HIV envelope glycoprotein that mediates entry by binding CD4 receptor and CCR5/CXCR4 co-receptors.',
    diseaseRelevance: 'Major target for neutralizing antibodies and vaccine design. Variability complicates vaccine development.',
    therapeuticTargets: ['Entry inhibitors', 'Broadly neutralizing antibodies', 'Vaccine immunogens'],
    relatedComponents: ['cd4_t_cells', 'ccr5', 'hiv_gp41'],
    clinicalSignificance: 'Key target for HIV vaccine development',
    keyFacts: [
      'Binds CD4 then CCR5/CXCR4 co-receptor',
      'Highly variable with glycan shield',
      'Target of broadly neutralizing antibodies',
      'Major vaccine target despite challenges'
    ]
  },
  {
    id: 'hiv_gp41',
    name: 'HIV gp41 Fusion Protein',
    category: 'biomolecule',
    subcategory: 'Viral Protein',
    visible: false,
    color: '#16a34a',
    tags: ['HIV', 'membrane fusion', 'enfuvirtide target'],
    description: 'HIV envelope protein that facilitates fusion of viral and cell membranes after gp120 binding.',
    diseaseRelevance: 'Target of fusion inhibitor enfuvirtide.',
    therapeuticTargets: ['Enfuvirtide (T-20)'],
    relatedComponents: ['hiv_gp120', 'cell_membrane'],
    keyFacts: [
      'Mediates viral-cell membrane fusion',
      'Undergoes conformational change after gp120 binding',
      'Targeted by fusion inhibitor enfuvirtide'
    ]
  },
  {
    id: 'hiv_rt',
    name: 'HIV Reverse Transcriptase',
    category: 'biomolecule',
    subcategory: 'Viral Enzyme',
    visible: true,
    color: '#15803d',
    tags: ['HIV', 'drug target', 'NRTI', 'NNRTI', 'resistance'],
    description: 'Enzyme converting HIV RNA to DNA - critical step in infection. Major drug target with multiple inhibitor classes.',
    diseaseRelevance: 'Targeted by NRTIs (AZT, tenofovir) and NNRTIs (efavirenz). Error-prone nature causes resistance.',
    therapeuticTargets: ['NRTIs', 'NNRTIs'],
    drugTargets: ['Zidovudine (AZT)', 'Tenofovir', 'Efavirenz', 'Rilpivirine'],
    relatedComponents: ['hiv_integrase', 'hiv_protease'],
    keyFacts: [
      'Converts viral RNA to DNA',
      'Lacks proofreading - causes mutations',
      'Targeted by two drug classes (NRTI, NNRTI)',
      'Resistance emerges via mutations'
    ]
  },
  {
    id: 'hiv_integrase',
    name: 'HIV Integrase',
    category: 'biomolecule',
    subcategory: 'Viral Enzyme',
    visible: true,
    color: '#166534',
    tags: ['HIV', 'drug target', 'INSTI', 'provirus'],
    description: 'Viral enzyme that inserts HIV DNA into host genome, creating a provirus.',
    diseaseRelevance: 'Targeted by integrase strand transfer inhibitors (INSTIs) - highly effective drugs.',
    therapeuticTargets: ['Dolutegravir', 'Bictegravir', 'Raltegravir'],
    relatedComponents: ['hiv_rt', 'nucleus'],
    keyFacts: [
      'Inserts viral DNA into host chromosome',
      'Creates permanent provirus',
      'INSTIs are backbone of modern HIV therapy',
      'High barrier to resistance for some INSTIs'
    ]
  },
  {
    id: 'hiv_protease',
    name: 'HIV Protease',
    category: 'biomolecule',
    subcategory: 'Viral Enzyme',
    visible: true,
    color: '#14532d',
    tags: ['HIV', 'drug target', 'polyprotein processing'],
    description: 'Enzyme processing viral polyproteins into functional proteins for new virus particles.',
    diseaseRelevance: 'Target of protease inhibitors that prevent mature virus formation.',
    therapeuticTargets: ['Darunavir', 'Atazanavir', 'Lopinavir'],
    relatedComponents: ['hiv_rt', 'hiv_integrase'],
    keyFacts: [
      'Cleaves Gag and Gag-Pol polyproteins',
      'Essential for mature virus production',
      'Protease inhibitors boosted with ritonavir',
      'Resistance mutations well characterized'
    ]
  },
  {
    id: 'p53_protein',
    name: 'p53 Protein',
    category: 'biomolecule',
    subcategory: 'Tumor Suppressor',
    visible: true,
    color: '#4ade80',
    tags: ['tumor suppressor', 'guardian of genome', 'apoptosis', 'cell cycle'],
    description: 'Transcription factor that triggers DNA repair or apoptosis in damaged cells. Mutated in ~50% of cancers.',
    diseaseRelevance: 'Most frequently mutated gene in human cancers. HPV E6 and HBV HBx inactivate p53.',
    therapeuticTargets: ['MDM2 inhibitors', 'p53 reactivators', 'Synthetic lethality approaches'],
    relatedComponents: ['tp53', 'mdm2', 'apoptosis_pathway'],
    keyFacts: [
      '"Guardian of the genome"',
      'Induces cell cycle arrest or apoptosis',
      'Mutated/lost in ~50% of cancers',
      'Inactivated by viral oncoproteins (HPV E6)'
    ]
  },
  {
    id: 'antibodies',
    name: 'Antibodies (Immunoglobulins)',
    category: 'biomolecule',
    subcategory: 'Immune Protein',
    visible: true,
    color: '#86efac',
    tags: ['B cells', 'neutralization', 'therapeutics', 'ADCC'],
    description: 'Y-shaped proteins from B cells that bind specific antigens. Central to infection prevention and cancer therapy.',
    diseaseRelevance: 'Neutralize viruses, mark pathogens for destruction. Monoclonal antibodies are major drug class.',
    therapeuticTargets: ['Trastuzumab (HER2)', 'Rituximab (CD20)', 'Pembrolizumab (PD-1)'],
    relatedComponents: ['b_cells', 'nk_cells', 'her2', 'cd20'],
    keyFacts: [
      'Produced by plasma cells',
      'Neutralize pathogens and toxins',
      'Mediate ADCC via Fc receptors',
      'Engineered as therapeutics'
    ]
  },
  {
    id: 'cytokines',
    name: 'Cytokines',
    category: 'biomolecule',
    subcategory: 'Signaling',
    visible: true,
    color: '#bbf7d0',
    tags: ['interleukins', 'interferons', 'TNF', 'immune signaling'],
    description: 'Small signaling proteins (interleukins, interferons, TNF) that orchestrate immune responses.',
    diseaseRelevance: 'Can be therapeutic (IFN-α for hepatitis) or pathological (cytokine storms).',
    therapeuticTargets: ['IL-2 therapy', 'TNF blockers', 'IL-6 inhibitors'],
    relatedComponents: ['macrophages', 'cd4_t_cells', 'jak_stat'],
    keyFacts: [
      'Coordinate immune cell communication',
      'Interferons induce antiviral state',
      'IL-2 stimulates T cell proliferation',
      'Excess can cause cytokine storms'
    ]
  },
  {
    id: 'vegf',
    name: 'VEGF (Vascular Endothelial Growth Factor)',
    category: 'biomolecule',
    subcategory: 'Growth Factor',
    visible: true,
    color: '#dcfce7',
    tags: ['angiogenesis', 'tumor blood supply', 'bevacizumab'],
    description: 'Signaling protein secreted by tumors to stimulate new blood vessel formation (angiogenesis).',
    diseaseRelevance: 'Key factor for tumor growth. Anti-VEGF therapy (bevacizumab) inhibits angiogenesis.',
    therapeuticTargets: ['Bevacizumab', 'VEGFR inhibitors (sunitinib)'],
    relatedComponents: ['tumor_microenvironment', 'vegfr'],
    keyFacts: [
      'Drives angiogenesis for tumor nutrient supply',
      'Secreted in hypoxic conditions',
      'Bevacizumab binds and neutralizes VEGF',
      'Combined with chemotherapy in various cancers'
    ]
  },

  // === MOLECULAR PATHWAYS ===
  {
    id: 'ras_mapk',
    name: 'RAS/MAPK Pathway',
    category: 'pathway',
    subcategory: 'Growth Signaling',
    visible: true,
    color: '#06b6d4',
    tags: ['proliferation', 'KRAS', 'MEK', 'cancer driver'],
    description: 'Major signaling cascade transmitting growth signals from cell surface to nucleus. Frequently dysregulated in cancer.',
    diseaseRelevance: 'KRAS mutations found in ~20% of cancers. MEK inhibitors used therapeutically.',
    therapeuticTargets: ['KRAS G12C inhibitors (sotorasib)', 'MEK inhibitors', 'RAF inhibitors'],
    relatedComponents: ['kras', 'egfr', 'her2'],
    keyFacts: [
      'RAS → RAF → MEK → ERK cascade',
      'Transmits growth factor signals to nucleus',
      'KRAS mutations lock pathway "on"',
      'Target of multiple cancer drugs'
    ]
  },
  {
    id: 'pi3k_akt_mtor',
    name: 'PI3K/AKT/mTOR Pathway',
    category: 'pathway',
    subcategory: 'Survival Signaling',
    visible: true,
    color: '#0891b2',
    tags: ['survival', 'metabolism', 'PTEN', 'everolimus'],
    description: 'Pathway controlling cell survival, growth, and metabolism. PTEN loss leads to continuous activation.',
    diseaseRelevance: 'Frequently activated in cancer via PTEN loss or PI3K mutations.',
    therapeuticTargets: ['PI3K inhibitors', 'mTOR inhibitors (everolimus)', 'AKT inhibitors'],
    relatedComponents: ['pten', 'egfr'],
    keyFacts: [
      'PI3K → AKT → mTOR cascade',
      'Controls cell growth and metabolism',
      'PTEN normally restrains pathway',
      'mTOR inhibitors used in renal cancer, breast cancer'
    ]
  },
  {
    id: 'apoptosis_pathway',
    name: 'Apoptosis Pathways',
    category: 'pathway',
    subcategory: 'Cell Death',
    visible: true,
    color: '#0e7490',
    tags: ['programmed cell death', 'Bcl-2', 'caspases', 'intrinsic', 'extrinsic'],
    description: 'Programmed cell death pathways (intrinsic mitochondrial and extrinsic death receptor mediated).',
    diseaseRelevance: 'Cancer cells frequently suppress apoptosis. Novel drugs aim to reactivate it.',
    therapeuticTargets: ['Bcl-2 inhibitors (venetoclax)', 'BH3 mimetics', 'TRAIL agonists'],
    relatedComponents: ['mitochondria', 'bcl2', 'p53_protein'],
    keyFacts: [
      'Intrinsic: mitochondrial cytochrome c release',
      'Extrinsic: death receptor (Fas, TRAIL) activation',
      'Caspases execute cell death',
      'Cancer evades via Bcl-2 overexpression'
    ]
  },
  {
    id: 'pd1_pdl1_pathway',
    name: 'PD-1/PD-L1 Checkpoint Pathway',
    category: 'pathway',
    subcategory: 'Immune Checkpoint',
    visible: true,
    color: '#155e75',
    tags: ['immune evasion', 'checkpoint inhibitor', 'pembrolizumab', 'nivolumab'],
    description: 'Inhibitory pathway where PD-L1 on tumor cells engages PD-1 on T cells, sending an "off" signal.',
    diseaseRelevance: 'Blocking with checkpoint inhibitors allows T cells to attack tumors. Revolutionized cancer therapy.',
    therapeuticTargets: ['Pembrolizumab', 'Nivolumab', 'Atezolizumab', 'Durvalumab'],
    relatedComponents: ['pd1_pdl1', 'cd8_t_cells', 'cancer_cells'],
    clinicalSignificance: 'PD-L1 expression helps predict immunotherapy response',
    keyFacts: [
      'PD-1 on T cells, PD-L1 on tumor/APC',
      'Interaction inhibits T cell killing',
      'Checkpoint blockade unleashes T cells',
      'Nobel Prize 2018 (Honjo, Allison)'
    ]
  },
  {
    id: 'jak_stat',
    name: 'JAK/STAT Pathway',
    category: 'pathway',
    subcategory: 'Cytokine Signaling',
    visible: false,
    color: '#164e63',
    tags: ['cytokine signaling', 'JAK2', 'myeloproliferative'],
    description: 'Pathway for cytokine receptor signaling. JAK2 mutations cause myeloproliferative diseases.',
    diseaseRelevance: 'JAK2 V617F mutation in polycythemia vera. JAK inhibitors used therapeutically.',
    therapeuticTargets: ['Ruxolitinib', 'Fedratinib', 'Tofacitinib'],
    relatedComponents: ['cytokines'],
    keyFacts: [
      'Mediates cytokine and growth factor signaling',
      'JAK kinases activate STAT transcription factors',
      'JAK2 V617F mutation drives myeloproliferative neoplasms',
      'JAK inhibitors treat myelofibrosis'
    ]
  },
  {
    id: 'wnt_pathway',
    name: 'Wnt/β-catenin Pathway',
    category: 'pathway',
    subcategory: 'Developmental',
    visible: false,
    color: '#083344',
    tags: ['stemness', 'colorectal cancer', 'APC'],
    description: 'Pathway controlling cell fate and stem cell maintenance. Aberrant in colorectal and other cancers.',
    diseaseRelevance: 'APC mutations lead to constitutive Wnt activation in most colorectal cancers.',
    therapeuticTargets: ['Wnt pathway inhibitors (in development)'],
    relatedComponents: ['cancer_stem_cells'],
    keyFacts: [
      'Controls cell proliferation and fate',
      'APC normally degrades β-catenin',
      'APC loss in >80% of colorectal cancers',
      'Drives stemness in cancer'
    ]
  },
  {
    id: 'dna_damage_response',
    name: 'DNA Damage Response',
    category: 'pathway',
    subcategory: 'Repair',
    visible: true,
    color: '#22d3ee',
    tags: ['DNA repair', 'p53', 'ATM', 'PARP', 'BRCA'],
    description: 'Pathways detecting and repairing DNA damage (NER, BER, homologous recombination, mismatch repair).',
    diseaseRelevance: 'Defects cause cancer susceptibility and genomic instability but create therapeutic vulnerabilities.',
    therapeuticTargets: ['PARP inhibitors', 'ATM/ATR inhibitors', 'CHK1/2 inhibitors'],
    relatedComponents: ['brca', 'tp53', 'p53_protein'],
    keyFacts: [
      'Multiple repair pathways: HR, NHEJ, NER, BER, MMR',
      'ATM/ATR kinases sense damage',
      'p53 mediates arrest or apoptosis',
      'BRCA defects sensitize to PARP inhibitors'
    ]
  },

  // === RECEPTORS ===
  {
    id: 'ccr5',
    name: 'CCR5 Receptor',
    category: 'receptor',
    subcategory: 'Chemokine Receptor',
    visible: true,
    color: '#3b82f6',
    tags: ['HIV co-receptor', 'maraviroc', 'CCR5-Δ32', 'entry'],
    description: 'Chemokine receptor on T cells/macrophages. HIV co-receptor for most strains. CCR5-Δ32 mutation confers resistance.',
    diseaseRelevance: 'HIV uses CCR5 for entry. Maraviroc blocks CCR5. Gene therapy exploring CCR5 knockout.',
    therapeuticTargets: ['Maraviroc'],
    relatedComponents: ['cd4_t_cells', 'hiv_gp120'],
    clinicalSignificance: 'CCR5-Δ32 homozygotes are HIV-resistant',
    keyFacts: [
      'Normal function: immune cell migration',
      'HIV co-receptor (R5 viruses)',
      'CCR5-Δ32 mutation = HIV resistance',
      'Maraviroc blocks HIV entry'
    ]
  },
  {
    id: 'her2',
    name: 'HER2/ErbB2 Receptor',
    category: 'receptor',
    subcategory: 'Growth Factor Receptor',
    visible: true,
    color: '#2563eb',
    tags: ['breast cancer', 'trastuzumab', 'amplification', 'targeted therapy'],
    description: 'Growth factor receptor overexpressed in ~25-30% of breast cancers, driving aggressive proliferation.',
    diseaseRelevance: 'HER2-positive breast cancer treated with trastuzumab, pertuzumab, T-DM1.',
    therapeuticTargets: ['Trastuzumab (Herceptin)', 'Pertuzumab', 'T-DM1', 'Lapatinib'],
    biomarkers: ['HER2 IHC', 'HER2 FISH'],
    relatedComponents: ['antibodies', 'ras_mapk'],
    clinicalSignificance: 'HER2 testing mandatory in breast cancer',
    keyFacts: [
      'Amplified in 25-30% of breast cancers',
      'Drives aggressive tumor growth',
      'Trastuzumab revolutionized treatment',
      'Antibody-drug conjugate T-DM1 available'
    ]
  },
  {
    id: 'egfr',
    name: 'EGFR Receptor',
    category: 'receptor',
    subcategory: 'Growth Factor Receptor',
    visible: true,
    color: '#1d4ed8',
    tags: ['lung cancer', 'erlotinib', 'osimertinib', 'mutations'],
    description: 'Growth factor receptor mutated in subset of lung cancers, making them susceptible to targeted therapy.',
    diseaseRelevance: 'EGFR mutations in ~15% of lung cancers (higher in Asian populations). Highly responsive to EGFR TKIs.',
    therapeuticTargets: ['Osimertinib', 'Erlotinib', 'Gefitinib'],
    biomarkers: ['EGFR mutation testing'],
    relatedComponents: ['ras_mapk', 'pi3k_akt_mtor'],
    keyFacts: [
      'Mutations in exon 19, 21 common',
      'T790M resistance mutation',
      'Osimertinib overcomes T790M',
      'Must test before lung cancer therapy'
    ]
  },
  {
    id: 'pd1_pdl1',
    name: 'PD-1 / PD-L1',
    category: 'receptor',
    subcategory: 'Immune Checkpoint',
    visible: true,
    color: '#1e40af',
    tags: ['checkpoint inhibitor', 'immunotherapy', 'T cell exhaustion'],
    description: 'Inhibitory receptor (PD-1) on T cells and its ligand (PD-L1) on tumor/APCs. Key immunotherapy target.',
    diseaseRelevance: 'Blocking restores T cell function. Checkpoint inhibitors transformed cancer treatment.',
    therapeuticTargets: ['Pembrolizumab', 'Nivolumab', 'Atezolizumab'],
    relatedComponents: ['cd8_t_cells', 'cancer_cells', 'pd1_pdl1_pathway'],
    clinicalSignificance: 'PD-L1 expression is predictive biomarker',
    keyFacts: [
      'PD-1 inhibitory receptor on T cells',
      'PD-L1 upregulated on tumors',
      'Interaction suppresses T cell killing',
      'Blockade restores anti-tumor immunity'
    ]
  },
  {
    id: 'ctla4',
    name: 'CTLA-4',
    category: 'receptor',
    subcategory: 'Immune Checkpoint',
    visible: false,
    color: '#1e3a8a',
    tags: ['checkpoint', 'ipilimumab', 'T cell priming'],
    description: 'Inhibitory receptor that dampens T cell activation in lymph nodes. First checkpoint inhibitor target.',
    diseaseRelevance: 'Ipilimumab blocks CTLA-4. First checkpoint inhibitor approved (melanoma 2011).',
    therapeuticTargets: ['Ipilimumab'],
    relatedComponents: ['cd8_t_cells', 'dendritic_cells'],
    keyFacts: [
      'Competes with CD28 for B7 ligands',
      'Inhibits T cell priming',
      'Ipilimumab: first checkpoint inhibitor',
      'Combined with PD-1 blockade in melanoma'
    ]
  },
  {
    id: 'mhc_class_i',
    name: 'MHC Class I',
    category: 'receptor',
    subcategory: 'Antigen Presentation',
    visible: true,
    color: '#3730a3',
    tags: ['antigen presentation', 'CD8 T cells', 'immune evasion', 'HLA'],
    description: 'Present on most cells, displays intracellular peptides to CD8+ T cells for immune surveillance.',
    diseaseRelevance: 'Cancer cells often downregulate MHC-I to evade CD8 T cells. Loss indicates immune evasion.',
    therapeuticTargets: ['Interferon to upregulate MHC', 'Strategies bypassing MHC'],
    relatedComponents: ['cd8_t_cells', 'proteasome', 'cancer_cells'],
    keyFacts: [
      'Presents 8-10 aa peptides from inside cell',
      'CD8 T cells recognize via TCR',
      'Loss allows tumor immune escape',
      'Interferon can upregulate expression'
    ]
  },
  {
    id: 'mhc_class_ii',
    name: 'MHC Class II',
    category: 'receptor',
    subcategory: 'Antigen Presentation',
    visible: false,
    color: '#312e81',
    tags: ['antigen presentation', 'CD4 T cells', 'APCs', 'HLA-DR'],
    description: 'On professional APCs, presents extracellular peptides to CD4+ helper T cells.',
    diseaseRelevance: 'Critical for initiating adaptive immune responses. Variations affect disease susceptibility.',
    relatedComponents: ['cd4_t_cells', 'dendritic_cells', 'macrophages'],
    keyFacts: [
      'On dendritic cells, macrophages, B cells',
      'Presents exogenous peptides',
      'Activates CD4 helper T cells',
      'HLA variations affect disease risk'
    ]
  },

  // === GENES ===
  {
    id: 'tp53',
    name: 'TP53 Gene',
    category: 'gene',
    subcategory: 'Tumor Suppressor',
    visible: true,
    color: '#ec4899',
    tags: ['tumor suppressor', 'guardian of genome', 'most mutated'],
    description: 'Gene encoding p53 protein. Mutated or lost in ~50% of human cancers. Guardian of the genome.',
    diseaseRelevance: 'Most frequently mutated gene in cancer. Mutations predict worse prognosis. Targeted by HPV E6.',
    therapeuticTargets: ['MDM2 inhibitors', 'p53 reactivators'],
    biomarkers: ['TP53 mutation status'],
    relatedComponents: ['p53_protein', 'dna_damage_response'],
    keyFacts: [
      'Mutated in ~50% of human cancers',
      'Encodes transcription factor for cell cycle/apoptosis genes',
      'Li-Fraumeni syndrome: germline TP53 mutation',
      'HPV E6 degrades p53 protein'
    ]
  },
  {
    id: 'kras',
    name: 'KRAS Oncogene',
    category: 'gene',
    subcategory: 'Oncogene',
    visible: true,
    color: '#db2777',
    tags: ['oncogene', 'GTPase', 'undruggable', 'MAPK'],
    description: 'Proto-oncogene encoding signaling GTPase. Mutations lock it active, driving uncontrolled proliferation.',
    diseaseRelevance: 'Mutated in ~20% of cancers (~90% of pancreatic). KRAS G12C now druggable.',
    therapeuticTargets: ['Sotorasib (G12C)', 'Adagrasib (G12C)'],
    biomarkers: ['KRAS mutation status'],
    relatedComponents: ['ras_mapk'],
    keyFacts: [
      'Part of RAS family (KRAS, NRAS, HRAS)',
      'G12, G13 codon mutations common',
      'Was considered "undruggable"',
      'KRAS G12C inhibitors now approved'
    ]
  },
  {
    id: 'brca',
    name: 'BRCA1/2 Genes',
    category: 'gene',
    subcategory: 'Tumor Suppressor',
    visible: true,
    color: '#be185d',
    tags: ['DNA repair', 'hereditary cancer', 'PARP inhibitors', 'HR deficiency'],
    description: 'DNA repair genes. Germline mutations cause high breast/ovarian cancer risk. Tumors sensitive to PARP inhibitors.',
    diseaseRelevance: 'BRCA mutations: ~70% lifetime breast cancer risk. Synthetic lethality with PARP inhibition.',
    therapeuticTargets: ['Olaparib', 'Niraparib', 'Talazoparib'],
    biomarkers: ['BRCA mutation testing', 'HRD score'],
    relatedComponents: ['dna_damage_response'],
    clinicalSignificance: 'Germline testing for cancer risk assessment',
    keyFacts: [
      'BRCA1/2 function in homologous recombination',
      'Germline mutations: hereditary breast/ovarian cancer',
      'Enhanced screening, prophylactic surgery options',
      'PARP inhibitors exploit defective DNA repair'
    ]
  },
  {
    id: 'bcr_abl',
    name: 'BCR-ABL Fusion',
    category: 'gene',
    subcategory: 'Oncogene',
    visible: true,
    color: '#9d174d',
    tags: ['CML', 'Philadelphia chromosome', 'imatinib', 'TKI'],
    description: 'Fusion oncogene from t(9;22) translocation (Philadelphia chromosome) driving CML.',
    diseaseRelevance: 'Defines CML. Imatinib (Gleevec) transformed CML from fatal to chronic manageable disease.',
    therapeuticTargets: ['Imatinib', 'Dasatinib', 'Nilotinib', 'Ponatinib'],
    biomarkers: ['BCR-ABL transcript', 'Philadelphia chromosome'],
    relatedComponents: ['hematopoietic_system'],
    clinicalSignificance: 'Paradigm for targeted therapy',
    keyFacts: [
      'Created by t(9;22) translocation',
      'Constitutively active tyrosine kinase',
      'Imatinib: first successful targeted therapy',
      'Monitoring by BCR-ABL transcript levels'
    ]
  },
  {
    id: 'myc',
    name: 'MYC Oncogene',
    category: 'gene',
    subcategory: 'Oncogene',
    visible: false,
    color: '#831843',
    tags: ['transcription factor', 'proliferation', 'Burkitt lymphoma'],
    description: 'Transcription factor oncogene driving cell growth when overexpressed. Implicated in many cancers.',
    diseaseRelevance: 'MYC translocation in Burkitt lymphoma. Amplified in many solid tumors.',
    therapeuticTargets: ['MYC inhibitors (in development)', 'BET inhibitors'],
    relatedComponents: ['cancer_cells'],
    keyFacts: [
      'Master regulator of cell growth genes',
      'c-MYC translocation in Burkitt lymphoma',
      'Amplified in breast, lung, other cancers',
      'Difficult drug target, active research'
    ]
  },

  // === ANTIGENS ===
  {
    id: 'psa',
    name: 'PSA (Prostate-Specific Antigen)',
    category: 'antigen',
    subcategory: 'Tumor Marker',
    visible: true,
    color: '#8b5cf6',
    tags: ['prostate cancer', 'screening', 'biomarker', 'monitoring'],
    description: 'Protein produced by prostate, elevated in blood indicates possible prostate cancer.',
    diseaseRelevance: 'Used for prostate cancer screening and monitoring. Not specific - benign conditions can raise it.',
    biomarkers: ['PSA blood test'],
    clinicalSignificance: 'Revolutionized prostate cancer detection but has limitations',
    keyFacts: [
      'Produced by prostate tissue',
      'Elevated in prostate cancer',
      'Also elevated in BPH, prostatitis',
      'Used for screening and monitoring'
    ]
  },
  {
    id: 'ny_eso_1',
    name: 'NY-ESO-1 Antigen',
    category: 'antigen',
    subcategory: 'Cancer/Testis Antigen',
    visible: false,
    color: '#7c3aed',
    tags: ['cancer testis', 'vaccine target', 'TCR therapy', 'immunogenic'],
    description: 'Cancer/testis antigen present in tumors but few normal tissues. Target for vaccines and T cell therapy.',
    diseaseRelevance: 'Target for therapeutic vaccines and TCR-engineered T cells.',
    therapeuticTargets: ['NY-ESO-1 vaccines', 'TCR-T cell therapy'],
    relatedComponents: ['cancer_cells', 'cd8_t_cells'],
    keyFacts: [
      'Expressed in melanoma, sarcoma, other cancers',
      'Restricted normal expression (testis)',
      'Highly immunogenic',
      'Target for adoptive T cell therapy'
    ]
  },
  {
    id: 'cd19',
    name: 'CD19 Antigen',
    category: 'antigen',
    subcategory: 'B Cell Marker',
    visible: true,
    color: '#6d28d9',
    tags: ['B cell', 'CAR-T', 'leukemia', 'lymphoma'],
    description: 'Surface marker on B cells. Target for CAR-T therapy in B-cell malignancies.',
    diseaseRelevance: 'CD19 CAR-T (Kymriah, Yescarta) approved for ALL and lymphomas.',
    therapeuticTargets: ['Tisagenlecleucel', 'Axicabtagene ciloleucel'],
    relatedComponents: ['b_cells', 'cancer_cells'],
    clinicalSignificance: 'First approved CAR-T target',
    keyFacts: [
      'Pan-B cell marker',
      'Target of first approved CAR-T therapies',
      'Complete remissions in refractory B-ALL',
      'Causes B cell aplasia (manageable)'
    ]
  },
  {
    id: 'hpv_e6_e7',
    name: 'HPV E6/E7 Oncoproteins',
    category: 'antigen',
    subcategory: 'Viral Antigen',
    visible: true,
    color: '#5b21b6',
    tags: ['cervical cancer', 'head and neck', 'therapeutic vaccine', 'viral oncogene'],
    description: 'HPV oncoproteins that inactivate p53 (E6) and Rb (E7), driving cancer. Targets for therapeutic vaccines.',
    diseaseRelevance: 'Drive HPV-associated cancers. Being targeted by therapeutic vaccines.',
    therapeuticTargets: ['E6/E7 therapeutic vaccines', 'T cell therapies'],
    relatedComponents: ['tp53', 'cancer_cells'],
    keyFacts: [
      'E6 degrades p53, E7 inactivates Rb',
      'Drive HPV-induced carcinogenesis',
      'Foreign antigens targetable by immunity',
      'Therapeutic vaccines in clinical trials'
    ]
  },

  // === DRUG/VACCINE TARGETS ===
  {
    id: 'hpv_l1',
    name: 'HPV L1 Capsid Protein',
    category: 'vaccine_target',
    subcategory: 'Prophylactic Vaccine',
    visible: true,
    color: '#14b8a6',
    tags: ['HPV vaccine', 'Gardasil', 'cervical cancer prevention', 'VLP'],
    description: 'HPV capsid protein used in virus-like particle vaccines that prevent HPV infection and cervical cancer.',
    diseaseRelevance: 'HPV vaccines (Gardasil, Cervarix) use L1 VLPs. One of greatest cancer prevention successes.',
    therapeuticTargets: ['Gardasil 9', 'Cervarix'],
    relatedComponents: ['hpv_e6_e7'],
    clinicalSignificance: 'Prevents ~90% of cervical cancers',
    keyFacts: [
      'Forms virus-like particles (VLPs)',
      'Induces neutralizing antibodies',
      'Prevents HPV infection',
      'Prevents cervical, anal, oropharyngeal cancers'
    ]
  },
  {
    id: 'spike_protein',
    name: 'SARS-CoV-2 Spike Protein',
    category: 'vaccine_target',
    subcategory: 'Viral Vaccine Antigen',
    visible: true,
    color: '#0d9488',
    tags: ['COVID-19', 'mRNA vaccine', 'ACE2 binding', 'neutralizing antibodies'],
    description: 'Viral surface protein that binds ACE2 for cell entry. Target of COVID-19 mRNA vaccines.',
    diseaseRelevance: 'mRNA vaccines encode spike to induce neutralizing antibodies.',
    therapeuticTargets: ['Pfizer-BioNTech', 'Moderna mRNA vaccines', 'Viral vector vaccines'],
    relatedComponents: ['mrna_vaccines'],
    keyFacts: [
      'Mediates viral entry via ACE2',
      'Target of neutralizing antibodies',
      'mRNA vaccines encode spike',
      'Demonstrated mRNA vaccine platform'
    ]
  },
  {
    id: 'mrna_vaccines',
    name: 'mRNA Vaccine Platform',
    category: 'vaccine_target',
    subcategory: 'Delivery Technology',
    visible: true,
    color: '#0f766e',
    tags: ['lipid nanoparticles', 'COVID-19', 'rapid development', 'cancer vaccines'],
    description: 'Novel vaccine technology using mRNA in lipid nanoparticles. Proven by COVID-19 vaccines.',
    diseaseRelevance: 'Enables rapid vaccine development. Being applied to HIV, cancer, other diseases.',
    therapeuticTargets: ['Personalized cancer vaccines', 'HIV vaccine trials', 'Influenza'],
    relatedComponents: ['spike_protein'],
    keyFacts: [
      'mRNA encodes antigen, cells produce it',
      'Lipid nanoparticles protect and deliver mRNA',
      'Non-infectious, no DNA integration',
      'Rapid development capability proven'
    ]
  },
  {
    id: 'bcl2',
    name: 'Bcl-2 (Drug Target)',
    category: 'drug_target',
    subcategory: 'Apoptosis Regulator',
    visible: true,
    color: '#10b981',
    tags: ['anti-apoptotic', 'venetoclax', 'CLL', 'AML'],
    description: 'Anti-apoptotic protein overexpressed in many cancers. Target of BH3 mimetic venetoclax.',
    diseaseRelevance: 'Overexpression prevents apoptosis. Venetoclax highly effective in CLL.',
    therapeuticTargets: ['Venetoclax'],
    relatedComponents: ['mitochondria', 'apoptosis_pathway'],
    keyFacts: [
      'Prevents mitochondrial apoptosis',
      'Overexpressed in CLL, follicular lymphoma',
      'Venetoclax mimics BH3-only proteins',
      'Can induce rapid tumor lysis'
    ]
  },
  {
    id: 'cd20',
    name: 'CD20 (Drug Target)',
    category: 'drug_target',
    subcategory: 'B Cell Target',
    visible: true,
    color: '#059669',
    tags: ['rituximab', 'B cell depletion', 'lymphoma', 'autoimmune'],
    description: 'B cell surface marker targeted by rituximab in lymphomas and autoimmune diseases.',
    diseaseRelevance: 'Rituximab revolutionized B-cell lymphoma treatment. Also used in RA, MS.',
    therapeuticTargets: ['Rituximab', 'Obinutuzumab', 'Ofatumumab'],
    relatedComponents: ['b_cells'],
    keyFacts: [
      'Pan-B cell marker (not plasma cells)',
      'Rituximab: first therapeutic cancer antibody',
      'Depletes B cells',
      'Used in lymphoma and autoimmune disease'
    ]
  },
  {
    id: 'parp',
    name: 'PARP Enzyme',
    category: 'drug_target',
    subcategory: 'DNA Repair',
    visible: true,
    color: '#047857',
    tags: ['DNA repair', 'synthetic lethality', 'BRCA', 'olaparib'],
    description: 'DNA repair enzyme. PARP inhibitors exploit synthetic lethality in BRCA-mutant cancers.',
    diseaseRelevance: 'PARP inhibitors highly effective in BRCA-mutant breast and ovarian cancers.',
    therapeuticTargets: ['Olaparib', 'Niraparib', 'Rucaparib', 'Talazoparib'],
    relatedComponents: ['brca', 'dna_damage_response'],
    keyFacts: [
      'Involved in base excision repair',
      'Inhibition lethal if HR repair defective',
      'Synthetic lethality concept',
      'Approved for BRCA-mutant cancers'
    ]
  },
]

// ==================== COMPONENTS ====================

function Canvas3D({ components, selectedId, onSelect: _onSelect }: {
  components: BiologicalComponent[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rotation, setRotation] = useState({ x: 0.3, y: 0.5 })
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)

      // Draw grid
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.05)'
      ctx.lineWidth = 1
      const gridSize = 30 * zoom
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      // Draw biological components
      const centerX = width / 2
      const centerY = height / 2
      const visibleComponents = components.filter(c => c.visible)

      // Group by category for visual organization
      const categoryGroups = visibleComponents.reduce((acc, comp) => {
        if (!acc[comp.category]) acc[comp.category] = []
        acc[comp.category].push(comp)
        return acc
      }, {} as Record<string, BiologicalComponent[]>)

      let globalIndex = 0
      Object.entries(categoryGroups).forEach(([_category, comps], categoryIndex) => {
        const categoryAngle = (categoryIndex / Object.keys(categoryGroups).length) * Math.PI * 2
        const categoryRadius = 180 * zoom

        comps.forEach((component, compIndex) => {
          const localAngle = (compIndex / comps.length) * Math.PI * 0.5 - Math.PI * 0.25
          const angle = categoryAngle + localAngle + rotation.y
          const radius = (80 + compIndex * 25) * zoom

          const x = centerX + Math.cos(angle) * radius
          const y = centerY + Math.sin(angle) * radius * 0.6 + Math.sin(rotation.x) * 30

          // Draw connecting lines to category center
          const catX = centerX + Math.cos(categoryAngle + rotation.y) * categoryRadius * 0.3
          const catY = centerY + Math.sin(categoryAngle + rotation.y) * categoryRadius * 0.3 * 0.6

          ctx.strokeStyle = component.color + '30'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(catX, catY)
          ctx.lineTo(x, y)
          ctx.stroke()

          // Draw component node
          const size = 20 * zoom
          const isSelected = selectedId === component.id

          if (isSelected) {
            ctx.shadowColor = component.color
            ctx.shadowBlur = 15
          }

          ctx.fillStyle = component.color + (isSelected ? 'ff' : 'aa')
          ctx.beginPath()

          // Different shapes by category
          if (component.category === 'organ_system') {
            // Large circle
            ctx.arc(x, y, size * 1.2, 0, Math.PI * 2)
          } else if (component.category === 'cell_type') {
            // Circle with inner structure
            ctx.arc(x, y, size, 0, Math.PI * 2)
          } else if (component.category === 'pathway') {
            // Diamond
            ctx.moveTo(x, y - size)
            ctx.lineTo(x + size, y)
            ctx.lineTo(x, y + size)
            ctx.lineTo(x - size, y)
            ctx.closePath()
          } else if (component.category === 'gene') {
            // Double helix representation
            ctx.ellipse(x, y, size * 0.5, size, 0, 0, Math.PI * 2)
          } else if (component.category === 'biomolecule') {
            // Hexagon
            for (let i = 0; i < 6; i++) {
              const hx = x + Math.cos(i * Math.PI / 3) * size
              const hy = y + Math.sin(i * Math.PI / 3) * size
              if (i === 0) ctx.moveTo(hx, hy)
              else ctx.lineTo(hx, hy)
            }
            ctx.closePath()
          } else if (component.category === 'receptor' || component.category === 'antigen') {
            // Y-shape for antibody/receptor
            ctx.arc(x, y, size * 0.8, 0, Math.PI * 2)
          } else {
            // Default circle
            ctx.arc(x, y, size * 0.7, 0, Math.PI * 2)
          }
          ctx.fill()
          ctx.shadowBlur = 0

          // Draw label
          ctx.fillStyle = 'var(--color-text)'
          ctx.font = `${9 * zoom}px Inter`
          ctx.textAlign = 'center'
          const shortName = component.name.length > 15 ? component.name.slice(0, 15) + '...' : component.name
          ctx.fillText(shortName, x, y + size + 12)

          globalIndex++
        })
      })

      // Draw center hub
      ctx.fillStyle = 'rgba(6, 182, 212, 0.1)'
      ctx.beginPath()
      ctx.arc(centerX, centerY, 40 * zoom, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.arc(centerX, centerY, 40 * zoom, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = 'var(--color-text-muted)'
      ctx.font = `${10 * zoom}px Inter`
      ctx.textAlign = 'center'
      ctx.fillText('Disease Research', centerX, centerY - 5)
      ctx.fillText('Structures', centerX, centerY + 10)
    }

    draw()
  }, [components, rotation, zoom, selectedId])

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setLastMouse({ x: e.clientX, y: e.clientY })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    const dx = e.clientX - lastMouse.x
    const dy = e.clientY - lastMouse.y
    setRotation(prev => ({
      x: prev.x + dy * 0.01,
      y: prev.y + dx * 0.01,
    }))
    setLastMouse({ x: e.clientX, y: e.clientY })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(prev => Math.max(0.5, Math.min(2, prev - e.deltaY * 0.001)))
  }

  return (
    <div className="relative w-full h-full canvas-container">
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-[var(--color-surface)]/90 backdrop-blur rounded-lg border border-[var(--color-border)] p-1">
        <button
          onClick={() => setZoom(z => Math.min(2, z + 0.1))}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
          title="Zoom In"
        >
          <FiZoomIn className="w-3.5 h-3.5" />
        </button>
        <span className="px-2 text-xs text-[var(--color-text-muted)]">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
          title="Zoom Out"
        >
          <FiZoomOut className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <button
          onClick={() => setRotation({ x: 0.3, y: 0.5 })}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
          title="Reset View"
        >
          <FiRotateCw className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
          title="Center View"
        >
          <FiCrosshair className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="absolute top-4 left-4 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <FiBox className="w-3.5 h-3.5" />
        <span>Biological Structures Workbench</span>
      </div>

      {/* Category legend */}
      <div className="absolute top-4 right-4 bg-[var(--color-surface)]/90 backdrop-blur rounded-lg border border-[var(--color-border)] p-2 text-xxs">
        <div className="font-medium mb-1.5 text-[var(--color-text-muted)]">Categories</div>
        <div className="space-y-1">
          {Object.entries(categoryConfig).slice(0, 5).map(([key, config]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
              <span>{config.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ComponentTree({ components, selectedId, onSelect, onToggleVisibility, searchTerm }: {
  components: BiologicalComponent[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleVisibility: (id: string) => void
  searchTerm: string
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    organ_system: true,
    cell_type: true,
    cellular_component: false,
    biomolecule: true,
    pathway: true,
    receptor: true,
    antigen: false,
    gene: true,
    drug_target: false,
    vaccine_target: false,
  })

  const filteredComponents = components.filter(comp =>
    comp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    comp.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())) ||
    comp.description.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const groupedComponents = filteredComponents.reduce((acc, comp) => {
    if (!acc[comp.category]) acc[comp.category] = []
    acc[comp.category].push(comp)
    return acc
  }, {} as Record<string, BiologicalComponent[]>)

  return (
    <div className="space-y-1">
      {Object.entries(categoryConfig).map(([category, config]) => {
        const comps = groupedComponents[category] || []
        if (comps.length === 0 && searchTerm) return null

        return (
          <div key={category}>
            <button
              onClick={() => setExpanded(e => ({ ...e, [category]: !e[category] }))}
              className="flex items-center gap-1.5 w-full px-2 py-1 text-xs hover:bg-[var(--color-border)] rounded transition-colors"
            >
              {expanded[category] ? <FiChevronDown className="w-3 h-3" /> : <FiChevronRight className="w-3 h-3" />}
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: config.color }}
              />
              <span className="flex-1 text-left truncate">{config.label}</span>
              <span className="text-[var(--color-text-muted)]">{comps.length}</span>
            </button>
            {expanded[category] && comps.length > 0 && (
              <div className="ml-4 space-y-0.5">
                {comps.map(comp => (
                  <div
                    key={comp.id}
                    onClick={() => onSelect(comp.id)}
                    className={clsx(
                      'flex items-center gap-1.5 px-2 py-1 text-xs rounded cursor-pointer transition-colors',
                      selectedId === comp.id
                        ? 'bg-primary-500/20 text-primary-400'
                        : 'hover:bg-[var(--color-border)] text-[var(--color-text-secondary)]'
                    )}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleVisibility(comp.id)
                      }}
                      className="p-0.5 hover:bg-[var(--color-surface)] rounded"
                    >
                      {comp.visible ? (
                        <FiEye className="w-3 h-3" />
                      ) : (
                        <FiEyeOff className="w-3 h-3 text-[var(--color-text-muted)]" />
                      )}
                    </button>
                    <span className={clsx('truncate flex-1', !comp.visible && 'text-[var(--color-text-muted)]')}>
                      {comp.name}
                    </span>
                    {comp.therapeuticTargets && comp.therapeuticTargets.length > 0 && (
                      <FiTarget className="w-3 h-3 text-[var(--color-text-muted)]" title="Has therapeutic targets" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PropertiesPanel({ component }: { component: BiologicalComponent | null }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'clinical' | 'targets'>('overview')

  if (!component) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] text-xs">
        <FiInfo className="w-6 h-6 mb-2" />
        <span>Select a component to view properties</span>
      </div>
    )
  }

  const config = categoryConfig[component.category]

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] pb-2">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: component.color }}
          />
          <span className="text-sm font-medium">{component.name}</span>
        </div>
        <div className="flex items-center gap-2 text-xxs text-[var(--color-text-muted)]">
          <span className="badge" style={{ backgroundColor: config.color + '30', color: config.color }}>
            {config.label}
          </span>
          {component.subcategory && (
            <span className="text-[var(--color-text-muted)]">• {component.subcategory}</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {(['overview', 'clinical', 'targets'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'px-2 py-1 text-xxs capitalize border-b-2 transition-colors',
              activeTab === tab
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-3 text-xs">
        {activeTab === 'overview' && (
          <>
            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Description</div>
              <p className="text-[var(--color-text-secondary)] leading-relaxed">{component.description}</p>
            </div>

            {component.keyFacts && component.keyFacts.length > 0 && (
              <div>
                <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Key Facts</div>
                <ul className="space-y-1">
                  {component.keyFacts.map((fact, i) => (
                    <li key={i} className="flex gap-2 text-[var(--color-text-secondary)]">
                      <span className="text-primary-500">•</span>
                      <span>{fact}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Tags</div>
              <div className="flex flex-wrap gap-1">
                {component.tags.map(tag => (
                  <span key={tag} className="badge badge-neutral">{tag}</span>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'clinical' && (
          <>
            {component.diseaseRelevance && (
              <div>
                <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Disease Relevance</div>
                <p className="text-[var(--color-text-secondary)] leading-relaxed">{component.diseaseRelevance}</p>
              </div>
            )}

            {component.clinicalSignificance && (
              <div>
                <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Clinical Significance</div>
                <p className="text-[var(--color-text-secondary)] leading-relaxed">{component.clinicalSignificance}</p>
              </div>
            )}

            {component.biomarkers && component.biomarkers.length > 0 && (
              <div>
                <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Biomarkers</div>
                <div className="flex flex-wrap gap-1">
                  {component.biomarkers.map(marker => (
                    <span key={marker} className="badge" style={{ backgroundColor: '#3b82f620', color: '#3b82f6' }}>
                      {marker}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'targets' && (
          <>
            {component.therapeuticTargets && component.therapeuticTargets.length > 0 && (
              <div>
                <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Therapeutic Targets</div>
                <ul className="space-y-1">
                  {component.therapeuticTargets.map((target, i) => (
                    <li key={i} className="flex gap-2 text-[var(--color-text-secondary)]">
                      <FiTarget className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
                      <span>{target}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {component.drugTargets && component.drugTargets.length > 0 && (
              <div>
                <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Drug Examples</div>
                <div className="flex flex-wrap gap-1">
                  {component.drugTargets.map(drug => (
                    <span key={drug} className="badge" style={{ backgroundColor: '#10b98120', color: '#10b981' }}>
                      {drug}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {component.relatedComponents && component.relatedComponents.length > 0 && (
              <div>
                <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Related Components</div>
                <div className="flex flex-wrap gap-1">
                  {component.relatedComponents.map(rel => (
                    <span key={rel} className="badge badge-neutral">
                      {rel.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function Workbench() {
  const [components, setComponents] = useState<BiologicalComponent[]>(biologicalStructures)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showGrid, setShowGrid] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  const selectedComponent = components.find(c => c.id === selectedId) || null

  const toggleVisibility = (id: string) => {
    setComponents(prev =>
      prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c)
    )
  }

  const visibleCount = components.filter(c => c.visible).length

  return (
    <div className="flex h-full">
      {/* Left panel - Component Tree */}
      <div className="w-64 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Biological Structures</h3>
            <span className="text-xxs text-[var(--color-text-muted)]">{visibleCount} visible</span>
          </div>
          <div className="relative">
            <FiSearch className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder="Search structures..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input w-full text-xs pl-7"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <ComponentTree
            components={components}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleVisibility={toggleVisibility}
            searchTerm={searchTerm}
          />
        </div>
      </div>

      {/* Main viewport */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="h-10 flex items-center justify-between px-3 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
          <div className="flex items-center gap-1">
            <button className="btn btn-sm btn-secondary">
              <FiMove className="w-3 h-3" />
              Pan
            </button>
            <button className="btn btn-sm btn-secondary">
              <FiRotateCw className="w-3 h-3" />
              Rotate
            </button>
            <button className="btn btn-sm btn-secondary">
              <FiZoomIn className="w-3 h-3" />
              Zoom
            </button>
            <div className="w-px h-5 bg-[var(--color-border)] mx-2" />
            <button
              onClick={() => setShowGrid(!showGrid)}
              className={clsx('btn btn-sm', showGrid ? 'btn-primary' : 'btn-secondary')}
            >
              <FiGrid className="w-3 h-3" />
            </button>
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={clsx('btn btn-sm', showLabels ? 'btn-primary' : 'btn-secondary')}
            >
              <FiTag className="w-3 h-3" />
            </button>
            <button className="btn btn-sm btn-secondary">
              <FiLayers className="w-3 h-3" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button className="btn btn-sm btn-secondary">
              <FiUpload className="w-3 h-3" />
              Import
            </button>
            <button className="btn btn-sm btn-secondary">
              <FiDownload className="w-3 h-3" />
              Export
            </button>
            <button className="btn btn-sm btn-secondary">
              <FiMaximize2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 3D Canvas */}
        <div className="flex-1 relative">
          <Canvas3D
            components={components}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </div>

      {/* Right panel - Properties */}
      <div className="w-72 border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Properties</h3>
            <button className="p-1 hover:bg-[var(--color-surface)] rounded transition-colors">
              <FiSettings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <PropertiesPanel component={selectedComponent} />
        </div>
      </div>
    </div>
  )
}
