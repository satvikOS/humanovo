import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
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
  FiTarget,
  FiDatabase,
  FiCpu,
  FiActivity,
  FiPlay,
  FiPause,
  FiPlus,
  FiTrash2,
  FiMessageSquare,
  FiSend,
  FiEdit3,
  FiLink,
  FiX,
  FiSave,
  FiImage
} from 'react-icons/fi'
import clsx from 'clsx'

// Import Master Human Library
import {
  masterLibraryTree,
  libraryStats,
  searchElements,
  findElementById,
  LibraryTreeNode,
  BiologicalElement as MasterLibraryElement
} from '../data/MasterHumanLibraryIndex'

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

  // ========================= ORGAN SYSTEMS (EXPANDED) =========================
  { id: 'cardiovascular_system', name: 'Cardiovascular System', category: 'organ_system', subcategory: 'Circulation', visible: true, color: '#ef4444', tags: ['heart', 'vasculature', 'blood pressure', 'atherosclerosis'], description: 'Heart and blood vessel system responsible for circulating blood, delivering oxygen and nutrients to tissues, and removing metabolic waste.', diseaseRelevance: 'Heart disease is the leading cause of death globally. Includes coronary artery disease, heart failure, arrhythmias, and valvular disease.', therapeuticTargets: ['ACE inhibitors', 'Beta-blockers', 'Statins', 'Anticoagulants'], keyFacts: ['Heart pumps ~7,500 liters of blood daily', '~100,000 km of blood vessels in adult body', 'Atherosclerosis underlies most cardiovascular events', 'Cardiac output ~5 L/min at rest'] },
  { id: 'respiratory_system', name: 'Respiratory System', category: 'organ_system', subcategory: 'Gas Exchange', visible: true, color: '#dc2626', tags: ['lungs', 'breathing', 'gas exchange', 'COPD', 'asthma'], description: 'System responsible for gas exchange between the body and environment, including the airways, lungs, and respiratory muscles.', diseaseRelevance: 'COPD, asthma, lung cancer, pneumonia, and pulmonary fibrosis are major respiratory diseases.', therapeuticTargets: ['Bronchodilators', 'Corticosteroids', 'Anti-IgE antibodies'], keyFacts: ['~300 million alveoli provide ~70 m² surface area', 'Respiratory rate 12-20 breaths/min at rest', 'Surfactant prevents alveolar collapse', 'Mucociliary escalator clears pathogens'] },
  { id: 'digestive_system', name: 'Digestive System', category: 'organ_system', subcategory: 'Metabolism', visible: true, color: '#b91c1c', tags: ['GI tract', 'liver', 'pancreas', 'microbiome', 'IBD'], description: 'Gastrointestinal tract and associated organs (liver, pancreas, gallbladder) responsible for digestion, absorption, and metabolism.', diseaseRelevance: 'IBD, celiac disease, liver cirrhosis, pancreatic cancer, colorectal cancer, NAFLD are major GI diseases.', therapeuticTargets: ['PPIs', 'Anti-TNF antibodies', 'JAK inhibitors', 'FXR agonists'], keyFacts: ['GI tract ~9 meters long', '~100 trillion gut bacteria', 'Liver performs >500 metabolic functions', 'Gut-brain axis influences mood and cognition'] },
  { id: 'endocrine_system', name: 'Endocrine System', category: 'organ_system', subcategory: 'Hormonal Regulation', visible: true, color: '#991b1b', tags: ['hormones', 'thyroid', 'adrenal', 'pituitary', 'diabetes'], description: 'Network of glands that produce hormones regulating metabolism, growth, development, reproduction, and homeostasis.', diseaseRelevance: 'Diabetes mellitus, thyroid disorders, adrenal insufficiency, pituitary tumors, and metabolic syndrome.', therapeuticTargets: ['Insulin analogs', 'Thyroid hormone', 'GLP-1 agonists', 'DPP-4 inhibitors'], keyFacts: ['Major glands: pituitary, thyroid, adrenal, pancreatic islets', 'Hypothalamus-pituitary axis controls most endocrine functions', 'Insulin is the primary anabolic hormone', 'Cortisol regulates stress response'] },
  { id: 'nervous_system', name: 'Central Nervous System', category: 'organ_system', subcategory: 'Neural Control', visible: true, color: '#7f1d1d', tags: ['brain', 'spinal cord', 'neurons', 'neurodegeneration', 'neurotransmitters'], description: 'Brain and spinal cord that process sensory information, coordinate motor output, and mediate higher cognitive functions.', diseaseRelevance: 'Alzheimer, Parkinson, ALS, MS, stroke, epilepsy, and psychiatric disorders.', therapeuticTargets: ['Levodopa', 'Cholinesterase inhibitors', 'Anti-amyloid antibodies', 'SSRIs'], keyFacts: ['~86 billion neurons in the human brain', '~150 trillion synaptic connections', 'Blood-brain barrier limits drug penetration', 'Neuroplasticity enables learning and recovery'] },
  { id: 'musculoskeletal_system', name: 'Musculoskeletal System', category: 'organ_system', subcategory: 'Structural Support', visible: true, color: '#ef4444', tags: ['bones', 'muscles', 'joints', 'osteoporosis', 'arthritis'], description: 'Bones, muscles, tendons, ligaments, and joints providing structural support, movement, and protection.', diseaseRelevance: 'Osteoporosis, rheumatoid arthritis, osteoarthritis, muscular dystrophies, and bone cancers.', therapeuticTargets: ['Bisphosphonates', 'Denosumab', 'DMARDs', 'Anti-RANKL'], keyFacts: ['206 bones in adult skeleton', '~640 skeletal muscles', 'Bone continuously remodeled by osteoblasts/osteoclasts', 'Peak bone mass reached ~age 30'] },
  { id: 'renal_system', name: 'Renal System', category: 'organ_system', subcategory: 'Filtration', visible: true, color: '#dc2626', tags: ['kidneys', 'filtration', 'electrolytes', 'CKD', 'dialysis'], description: 'Kidneys and urinary tract that filter blood, regulate fluid/electrolyte balance, and excrete metabolic waste.', diseaseRelevance: 'Chronic kidney disease affects ~15% of adults. Diabetic nephropathy is leading cause of ESRD.', therapeuticTargets: ['SGLT2 inhibitors', 'ACE inhibitors', 'Mineralocorticoid receptor antagonists'], keyFacts: ['Each kidney has ~1 million nephrons', 'Filters ~180 L/day, excretes ~1.5 L urine', 'Produces erythropoietin and active vitamin D', 'GFR <60 defines CKD stage 3+'] },
  { id: 'reproductive_system', name: 'Reproductive System', category: 'organ_system', subcategory: 'Reproduction', visible: true, color: '#b91c1b', tags: ['fertility', 'gonads', 'hormones', 'pregnancy', 'IVF'], description: 'Male and female reproductive organs responsible for gamete production, fertilization, and fetal development.', diseaseRelevance: 'Infertility, endometriosis, PCOS, prostate/ovarian/cervical cancers, STIs.', therapeuticTargets: ['GnRH agonists/antagonists', 'Aromatase inhibitors', 'Anti-androgens'], keyFacts: ['Female: ~1-2 million oocytes at birth', 'Male: ~1,500 sperm produced per second', 'Hormonal regulation by HPG axis', 'Epigenetic reprogramming in early embryo'] },
  { id: 'integumentary_system', name: 'Integumentary System', category: 'organ_system', subcategory: 'Barrier', visible: true, color: '#991b1b', tags: ['skin', 'barrier', 'melanoma', 'dermatology', 'wound healing'], description: 'Skin, hair, nails, and associated glands providing protection, thermoregulation, and sensory perception.', diseaseRelevance: 'Melanoma, psoriasis, eczema, wound healing disorders, skin infections.', therapeuticTargets: ['IL-17 inhibitors', 'IL-23 inhibitors', 'JAK inhibitors', 'Checkpoint inhibitors for melanoma'], keyFacts: ['Largest organ: ~1.5-2 m² surface area', 'Epidermis renews every 28 days', 'Contains Langerhans cells for immune surveillance', 'Melanocytes produce UV-protective melanin'] },

  // ========================= CELL TYPES (EXPANDED) =========================
  { id: 'neurons', name: 'Neurons', category: 'cell_type', subcategory: 'Neural Cells', visible: true, color: '#f97316', tags: ['nerve cells', 'synapses', 'action potential', 'neurodegeneration'], description: 'Electrically excitable cells that transmit information via action potentials and synaptic transmission.', diseaseRelevance: 'Neuronal loss underlies Alzheimer, Parkinson, ALS, and stroke damage.', keyFacts: ['Cannot regenerate in most brain regions', 'Communicate via ~100 neurotransmitters', 'Longest cells: motor neurons up to 1 meter', 'Consume ~20% of body oxygen'] },
  { id: 'cardiomyocytes', name: 'Cardiomyocytes', category: 'cell_type', subcategory: 'Muscle Cells', visible: true, color: '#ea580c', tags: ['heart muscle', 'contraction', 'cardiac', 'myocardial infarction'], description: 'Specialized cardiac muscle cells that contract rhythmically to pump blood throughout the body.', diseaseRelevance: 'MI causes irreversible cardiomyocyte death. Heart failure from cardiomyocyte dysfunction.', keyFacts: ['~2-3 billion cardiomyocytes per heart', 'Beat ~100,000 times/day', 'Very limited regenerative capacity', 'Gap junctions enable coordinated contraction'] },
  { id: 'hepatocytes', name: 'Hepatocytes', category: 'cell_type', subcategory: 'Epithelial', visible: true, color: '#c2410c', tags: ['liver cells', 'metabolism', 'detoxification', 'drug metabolism'], description: 'Main functional cells of the liver, responsible for metabolism, bile production, detoxification, and protein synthesis.', diseaseRelevance: 'Hepatocyte damage in hepatitis, cirrhosis, NAFLD, and hepatocellular carcinoma.', keyFacts: ['Comprise ~80% of liver volume', 'Can regenerate after partial hepatectomy', 'Express CYP450 enzymes for drug metabolism', 'Produce albumin, clotting factors, bile'] },
  { id: 'podocytes', name: 'Podocytes', category: 'cell_type', subcategory: 'Renal', visible: true, color: '#9a3412', tags: ['kidney', 'glomerular filtration', 'proteinuria', 'nephrotic syndrome'], description: 'Specialized epithelial cells in kidney glomeruli that form the filtration barrier preventing protein loss.', diseaseRelevance: 'Podocyte injury leads to proteinuria and nephrotic syndrome. Key in diabetic nephropathy.', keyFacts: ['Foot processes interdigitate to form slit diaphragm', 'Cannot proliferate once mature', 'Loss leads to irreversible glomerulosclerosis', 'NPHS1/nephrin mutations cause congenital nephrosis'] },
  { id: 'osteoblasts', name: 'Osteoblasts', category: 'cell_type', subcategory: 'Bone Cells', visible: true, color: '#b45309', tags: ['bone formation', 'mineralization', 'osteoporosis', 'fracture healing'], description: 'Bone-forming cells that synthesize and mineralize the organic bone matrix (osteoid).', diseaseRelevance: 'Reduced osteoblast activity in osteoporosis. Osteoblastic tumors in osteosarcoma.', keyFacts: ['Produce type I collagen and osteocalcin', 'Regulated by Wnt/beta-catenin signaling', 'Some become osteocytes embedded in bone', 'Sclerostin antibody stimulates osteoblasts'] },
  { id: 'astrocytes', name: 'Astrocytes', category: 'cell_type', subcategory: 'Glial Cells', visible: true, color: '#d97706', tags: ['glia', 'blood-brain barrier', 'neuroinflammation', 'glioma'], description: 'Star-shaped glial cells that maintain the blood-brain barrier, regulate neurotransmitter levels, and provide metabolic support.', diseaseRelevance: 'Reactive astrogliosis in neurodegeneration. Astrocytomas are common brain tumors.', keyFacts: ['Most abundant glial cell type', 'Form the BBB with endothelial cells', 'Clear glutamate from synaptic cleft', 'Provide lactate to neurons (lactate shuttle)'] },
  { id: 'oligodendrocytes', name: 'Oligodendrocytes', category: 'cell_type', subcategory: 'Glial Cells', visible: true, color: '#92400e', tags: ['myelin', 'white matter', 'multiple sclerosis', 'demyelination'], description: 'CNS glial cells that produce myelin sheaths around axons, enabling rapid saltatory nerve conduction.', diseaseRelevance: 'Demyelination in MS. Oligodendrocyte death in leukodystrophies.', keyFacts: ['Each cell myelinates up to 50 axon segments', 'Myelin is 80% lipid, 20% protein', 'Targeted by autoimmune attack in MS', 'Remyelination possible from OPCs'] },
  { id: 'endothelial_cells', name: 'Endothelial Cells', category: 'cell_type', subcategory: 'Vascular', visible: true, color: '#78350f', tags: ['blood vessels', 'angiogenesis', 'vasculature', 'atherosclerosis'], description: 'Cells lining all blood vessels, regulating vascular tone, permeability, coagulation, and angiogenesis.', diseaseRelevance: 'Endothelial dysfunction is the initiating event in atherosclerosis and key in tumor angiogenesis.', keyFacts: ['Produce nitric oxide (vasodilator)', 'Total surface area ~7,000 m²', 'Express selectins and integrins for immune cell recruitment', 'VEGF drives endothelial proliferation'] },
  { id: 'adipocytes', name: 'Adipocytes', category: 'cell_type', subcategory: 'Connective Tissue', visible: true, color: '#f97316', tags: ['fat cells', 'obesity', 'metabolism', 'adipokines', 'insulin resistance'], description: 'Fat-storing cells that also function as endocrine cells, secreting adipokines (leptin, adiponectin) that regulate metabolism.', diseaseRelevance: 'Adipocyte dysfunction central to obesity, metabolic syndrome, and type 2 diabetes.', keyFacts: ['White: energy storage. Brown: thermogenesis', 'Secrete leptin (satiety), adiponectin (insulin sensitizer)', 'Adipose tissue inflammation promotes insulin resistance', 'Beige adipocytes can be induced for thermogenesis'] },
  { id: 'melanocytes', name: 'Melanocytes', category: 'cell_type', subcategory: 'Skin Cells', visible: true, color: '#ea580c', tags: ['pigmentation', 'melanin', 'melanoma', 'UV protection'], description: 'Pigment-producing cells in the epidermis that synthesize melanin to protect against UV radiation damage.', diseaseRelevance: 'Malignant transformation causes melanoma. Vitiligo from melanocyte destruction.', keyFacts: ['Derived from neural crest cells', 'Transfer melanosomes to keratinocytes', 'BRAF V600E mutation in ~50% of melanomas', 'MC1R variants determine skin/hair color'] },
  { id: 'beta_cells', name: 'Pancreatic β Cells', category: 'cell_type', subcategory: 'Endocrine', visible: true, color: '#c2410c', tags: ['insulin', 'diabetes', 'islets of Langerhans', 'glucose sensing'], description: 'Endocrine cells in pancreatic islets that produce insulin in response to elevated blood glucose levels.', diseaseRelevance: 'Autoimmune destruction in T1D. Dysfunction and loss in T2D.', keyFacts: ['Comprise ~60% of islet cells', 'Sense glucose via glucokinase', 'Insulin secretion via KATP channel closure', 'Stem cell-derived β cells in clinical trials'] },
  { id: 'chondrocytes', name: 'Chondrocytes', category: 'cell_type', subcategory: 'Connective Tissue', visible: true, color: '#9a3412', tags: ['cartilage', 'osteoarthritis', 'joint', 'collagen type II'], description: 'Cells within cartilage that maintain the extracellular matrix, providing cushioning and smooth joint surfaces.', diseaseRelevance: 'Chondrocyte death and matrix degradation in osteoarthritis.', keyFacts: ['Avascular tissue limits repair', 'Produce type II collagen and aggrecan', 'Growth plate chondrocytes drive bone elongation', 'Cannot effectively regenerate after injury'] },

  // ========================= CELLULAR COMPONENTS =========================
  { id: 'ribosome', name: 'Ribosome', category: 'cellular_component', subcategory: 'Protein Synthesis', visible: true, color: '#eab308', tags: ['translation', 'protein synthesis', 'mRNA', 'antibiotics'], description: 'Molecular machines that translate mRNA into proteins, comprising large and small rRNA-protein subunits.', diseaseRelevance: 'Ribosomopathies (Diamond-Blackfan anemia). Antibiotic targets in bacteria.', keyFacts: ['80S in eukaryotes (60S+40S), 70S in prokaryotes', '~10 million ribosomes per cell', 'Free ribosomes: cytoplasmic proteins; ER-bound: secreted/membrane', 'Many antibiotics target bacterial ribosomes'] },
  { id: 'proteasome', name: 'Proteasome', category: 'cellular_component', subcategory: 'Protein Degradation', visible: true, color: '#ca8a04', tags: ['protein degradation', 'ubiquitin', 'bortezomib', 'myeloma'], description: '26S proteasome complex that degrades ubiquitin-tagged proteins, maintaining proteostasis.', diseaseRelevance: 'Proteasome inhibitors (bortezomib) are mainstay of myeloma treatment.', keyFacts: ['Barrel-shaped 20S core with regulatory 19S caps', 'Degrades ~80% of cellular proteins', 'Ubiquitin tags mark proteins for destruction', 'Bortezomib/carfilzomib for multiple myeloma'] },
  { id: 'lysosome', name: 'Lysosome', category: 'cellular_component', subcategory: 'Degradation', visible: true, color: '#a16207', tags: ['autophagy', 'storage diseases', 'enzyme replacement', 'pH 4.5'], description: 'Membrane-bound organelles containing acidic hydrolases that degrade macromolecules and mediate autophagy.', diseaseRelevance: '~70 lysosomal storage diseases (Gaucher, Fabry, Pompe). Key in autophagy.', keyFacts: ['pH ~4.5 maintained by V-ATPase', '~60 hydrolytic enzymes', 'Enzyme replacement therapy for storage diseases', 'Autophagy-lysosome pathway degrades organelles'] },
  { id: 'centrosome', name: 'Centrosome', category: 'cellular_component', subcategory: 'Cell Division', visible: true, color: '#854d0e', tags: ['cell division', 'mitotic spindle', 'centrioles', 'cancer'], description: 'Primary microtubule organizing center containing a pair of centrioles, essential for mitotic spindle formation.', diseaseRelevance: 'Centrosome amplification is common in cancers and drives chromosomal instability.', keyFacts: ['Duplicates once per cell cycle', 'Organizes mitotic spindle poles', 'Centrosome amplification in >80% of cancers', 'Centrioles form basal bodies of cilia'] },
  { id: 'tight_junction', name: 'Tight Junctions', category: 'cellular_component', subcategory: 'Cell Junctions', visible: true, color: '#713f12', tags: ['barrier function', 'permeability', 'claudins', 'occludins'], description: 'Intercellular junctions that seal the space between epithelial cells, controlling paracellular permeability.', diseaseRelevance: 'Tight junction dysfunction in IBD, celiac disease, and BBB disruption in neurological disease.', keyFacts: ['Claudins (27 family members) are key components', 'Create charge- and size-selective barriers', 'Regulated by cytokines and growth factors', 'Zonulin modulates intestinal permeability'] },

  // ========================= BIOMOLECULES (EXPANDED) =========================
  { id: 'insulin', name: 'Insulin', category: 'biomolecule', subcategory: 'Hormone', visible: true, color: '#22c55e', tags: ['glucose', 'diabetes', 'anabolic', 'metabolic syndrome'], description: 'Peptide hormone produced by pancreatic β cells that promotes glucose uptake and anabolic metabolism.', diseaseRelevance: 'Deficiency causes T1D. Resistance causes T2D. Insulin analogs are life-saving therapy.', therapeuticTargets: ['Insulin analogs (lispro, glargine, detemir)'], keyFacts: ['51 amino acids, two chains (A and B)', 'Discovered 1921 by Banting and Best', 'Acts via insulin receptor tyrosine kinase', 'Activates PI3K/Akt and RAS/MAPK pathways'] },
  { id: 'erythropoietin', name: 'Erythropoietin (EPO)', category: 'biomolecule', subcategory: 'Growth Factor', visible: true, color: '#16a34a', tags: ['red blood cells', 'anemia', 'kidney', 'doping'], description: 'Glycoprotein hormone produced by the kidney that stimulates red blood cell production in bone marrow.', diseaseRelevance: 'Deficiency in CKD causes anemia. Recombinant EPO is standard treatment.', therapeuticTargets: ['Epoetin alfa', 'Darbepoetin alfa', 'HIF-PHD inhibitors (roxadustat)'], keyFacts: ['Produced by peritubular fibroblasts in kidney', 'Responds to hypoxia via HIF pathway', 'Stimulates erythroid progenitor proliferation', 'HIF-PHD inhibitors are oral EPO alternatives'] },
  { id: 'collagen', name: 'Collagen', category: 'biomolecule', subcategory: 'Structural Protein', visible: true, color: '#15803d', tags: ['extracellular matrix', 'connective tissue', 'fibrosis', 'wound healing'], description: 'Most abundant protein in the body, providing structural support in skin, bone, cartilage, tendons, and blood vessels.', diseaseRelevance: 'Mutations cause osteogenesis imperfecta. Excessive deposition causes fibrosis.', keyFacts: ['28 types identified; Type I most abundant', 'Triple helix structure (Gly-X-Y repeats)', 'Requires vitamin C for hydroxylation', 'Collagen turnover measured by crosslink markers'] },
  { id: 'interferon_gamma', name: 'Interferon-γ (IFN-γ)', category: 'biomolecule', subcategory: 'Cytokine', visible: true, color: '#166534', tags: ['immunity', 'macrophage activation', 'Th1', 'antiviral'], description: 'Type II interferon produced by T cells and NK cells that activates macrophages and promotes Th1 immune responses.', diseaseRelevance: 'Critical for intracellular pathogen defense. Dysregulation in autoimmunity and HLH.', keyFacts: ['Activates macrophages to kill intracellular pathogens', 'Promotes MHC class I and II expression', 'Key Th1 cytokine', 'Deficiency causes susceptibility to mycobacteria'] },
  { id: 'bdnf', name: 'BDNF', category: 'biomolecule', subcategory: 'Neurotrophin', visible: true, color: '#14532d', tags: ['neurotrophic', 'neuroplasticity', 'depression', 'learning'], description: 'Brain-derived neurotrophic factor that supports neuronal survival, growth, and synaptic plasticity.', diseaseRelevance: 'Reduced BDNF in depression, Alzheimer, and Huntington disease.', keyFacts: ['Acts via TrkB receptor', 'Critical for hippocampal neurogenesis', 'Exercise increases BDNF levels', 'Val66Met polymorphism affects secretion'] },
  { id: 'complement_c3', name: 'Complement C3', category: 'biomolecule', subcategory: 'Immune Protein', visible: true, color: '#22c55e', tags: ['complement system', 'innate immunity', 'opsonization', 'MAC'], description: 'Central protein of the complement system that, when cleaved, triggers opsonization, inflammation, and membrane attack complex formation.', diseaseRelevance: 'Complement dysregulation in aHUS, PNH, C3 glomerulopathy, and age-related macular degeneration.', therapeuticTargets: ['Eculizumab (anti-C5)', 'Pegcetacoplan (anti-C3)', 'Iptacopan (factor B inhibitor)'], keyFacts: ['Convergence point of all 3 complement pathways', 'C3a: anaphylatoxin; C3b: opsonin', 'Most abundant complement protein in blood', 'Complement inhibitors approved for PNH, aHUS'] },
  { id: 'fibrinogen', name: 'Fibrinogen', category: 'biomolecule', subcategory: 'Coagulation', visible: true, color: '#16a34a', tags: ['clotting', 'fibrin', 'coagulation', 'thrombosis'], description: 'Soluble plasma glycoprotein converted to insoluble fibrin by thrombin during blood clot formation.', diseaseRelevance: 'Elevated levels are cardiovascular risk factor. Deficiency causes bleeding disorders.', keyFacts: ['Converted to fibrin by thrombin', 'Cross-linked by Factor XIIIa', 'Acute phase reactant', 'D-dimer measures fibrin degradation'] },

  // ========================= MOLECULAR PATHWAYS (EXPANDED) =========================
  { id: 'notch_pathway', name: 'Notch Signaling Pathway', category: 'pathway', subcategory: 'Developmental', visible: true, color: '#06b6d4', tags: ['cell fate', 'differentiation', 'T-ALL', 'lateral inhibition'], description: 'Juxtacrine signaling pathway where Notch receptors are activated by ligands on adjacent cells, controlling cell fate decisions.', diseaseRelevance: 'Activating mutations in >50% of T-ALL. Role in breast, lung, and brain cancers.', keyFacts: ['4 Notch receptors (NOTCH1-4)', '5 ligands (DLL1/3/4, JAG1/2)', 'Gamma-secretase cleaves Notch for nuclear translocation', 'GSI inhibitors in clinical trials'] },
  { id: 'hedgehog_pathway', name: 'Hedgehog Pathway', category: 'pathway', subcategory: 'Developmental', visible: true, color: '#0891b2', tags: ['Sonic hedgehog', 'Patched', 'Smoothened', 'basal cell carcinoma'], description: 'Developmental signaling pathway critical for tissue patterning, stem cell maintenance, and organ morphogenesis.', diseaseRelevance: 'Aberrant activation in basal cell carcinoma and medulloblastoma. Target of vismodegib.', keyFacts: ['SHH ligand binds Patched receptor', 'Releases Smoothened inhibition', 'GLI transcription factors as effectors', 'Vismodegib/sonidegib for BCC'] },
  { id: 'nfkb_pathway', name: 'NF-κB Pathway', category: 'pathway', subcategory: 'Inflammatory', visible: true, color: '#0e7490', tags: ['inflammation', 'immune activation', 'cancer', 'cytokines'], description: 'Master transcription factor pathway controlling inflammation, immunity, cell survival, and proliferation.', diseaseRelevance: 'Constitutive activation in many cancers and chronic inflammatory diseases.', keyFacts: ['5 family members: p65, p50, p52, RelB, c-Rel', 'Activated by TNF, IL-1, TLRs, antigen receptors', 'IκB kinase (IKK) complex is key regulator', 'Target genes: cytokines, anti-apoptotic proteins'] },
  { id: 'hippo_pathway', name: 'Hippo Pathway', category: 'pathway', subcategory: 'Growth Control', visible: true, color: '#155e75', tags: ['organ size', 'YAP/TAZ', 'tumor suppressor', 'regeneration'], description: 'Kinase cascade that controls organ size by regulating cell proliferation and apoptosis via YAP/TAZ transcription coactivators.', diseaseRelevance: 'YAP/TAZ hyperactivation in liver, lung, and colorectal cancers.', keyFacts: ['MST1/2 → LATS1/2 → YAP/TAZ phosphorylation', 'YAP/TAZ nuclear entry drives proliferation', 'Merlin (NF2) is upstream activator', 'Controls organ size and regeneration'] },
  { id: 'autophagy_pathway', name: 'Autophagy Pathway', category: 'pathway', subcategory: 'Degradation', visible: true, color: '#164e63', tags: ['self-eating', 'proteostasis', 'mTOR', 'neurodegeneration'], description: 'Catabolic process where cells degrade and recycle damaged organelles and proteins through lysosomal degradation.', diseaseRelevance: 'Impaired autophagy in neurodegeneration, cancer, and aging. Dual role in cancer.', keyFacts: ['Initiated by ULK1 complex when mTOR inhibited', 'LC3-II marks autophagosomes', 'Selective autophagy: mitophagy, aggrephagy, xenophagy', 'Rapamycin induces autophagy via mTOR inhibition'] },
  { id: 'ampk_pathway', name: 'AMPK Pathway', category: 'pathway', subcategory: 'Metabolic', visible: true, color: '#06b6d4', tags: ['energy sensor', 'metabolism', 'metformin', 'exercise'], description: 'Master cellular energy sensor activated by low ATP levels, promoting catabolic pathways and inhibiting anabolic processes.', diseaseRelevance: 'Metformin activates AMPK. Implicated in diabetes, cancer, and aging.', keyFacts: ['Activated by AMP/ATP ratio increase', 'Inhibits mTOR, fatty acid synthesis', 'Stimulates glucose uptake, fatty acid oxidation', 'Metformin, exercise, and caloric restriction activate AMPK'] },
  { id: 'ferroptosis', name: 'Ferroptosis', category: 'pathway', subcategory: 'Cell Death', visible: true, color: '#0891b2', tags: ['iron-dependent', 'lipid peroxidation', 'GPX4', 'cancer'], description: 'Iron-dependent form of regulated cell death driven by lipid peroxidation, distinct from apoptosis and necroptosis.', diseaseRelevance: 'Ferroptosis inducers may kill therapy-resistant cancers. Pathogenic in neurodegeneration.', keyFacts: ['GPX4 is key anti-ferroptotic enzyme', 'Requires iron and lipid peroxidation', 'System Xc- imports cystine for glutathione synthesis', 'Erastin and RSL3 are ferroptosis inducers'] },
  { id: 'tlr_signaling', name: 'Toll-like Receptor Signaling', category: 'pathway', subcategory: 'Innate Immunity', visible: true, color: '#0e7490', tags: ['innate immunity', 'PAMPs', 'MyD88', 'inflammation'], description: 'Pattern recognition receptor signaling pathway that detects pathogen-associated molecular patterns to initiate innate immune responses.', diseaseRelevance: 'TLR agonists as vaccine adjuvants. TLR dysregulation in autoimmunity and sepsis.', keyFacts: ['10 human TLRs recognizing diverse PAMPs', 'TLR4: LPS, TLR3: dsRNA, TLR9: CpG DNA', 'MyD88 and TRIF are key adaptors', 'Imiquimod (TLR7 agonist) for skin cancer'] },

  // ========================= RECEPTORS (EXPANDED) =========================
  { id: 'beta_adrenergic', name: 'β-Adrenergic Receptors', category: 'receptor', subcategory: 'GPCR', visible: true, color: '#3b82f6', tags: ['heart rate', 'bronchodilation', 'beta-blockers', 'asthma'], description: 'G protein-coupled receptors for epinephrine and norepinephrine. β1 in heart, β2 in lungs, β3 in adipose.', diseaseRelevance: 'Beta-blockers for hypertension, heart failure. Beta-agonists for asthma.', keyFacts: ['β1: cardiac (increases rate and force)', 'β2: bronchial smooth muscle (relaxation)', 'β3: adipose tissue (lipolysis)', 'Signal via Gs → cAMP → PKA'] },
  { id: 'dopamine_receptors', name: 'Dopamine Receptors (D1-D5)', category: 'receptor', subcategory: 'GPCR', visible: true, color: '#2563eb', tags: ['dopamine', 'reward', 'Parkinson', 'schizophrenia', 'antipsychotics'], description: 'Five subtypes of GPCRs for dopamine: D1-like (D1, D5) stimulatory and D2-like (D2, D3, D4) inhibitory.', diseaseRelevance: 'D2 antagonists treat schizophrenia. D2 agonists treat Parkinson. D1 in ADHD.', keyFacts: ['D1/D5: Gs-coupled, activate adenylyl cyclase', 'D2/D3/D4: Gi-coupled, inhibit adenylyl cyclase', 'Antipsychotics primarily block D2', 'Reward circuit: VTA → nucleus accumbens'] },
  { id: 'serotonin_receptors', name: 'Serotonin Receptors (5-HT)', category: 'receptor', subcategory: 'GPCR', visible: true, color: '#1d4ed8', tags: ['serotonin', 'depression', 'SSRIs', 'migraine', 'mood'], description: '14 subtypes of serotonin receptors regulating mood, sleep, appetite, pain, and GI motility.', diseaseRelevance: 'SSRIs block 5-HT reuptake for depression. Triptans target 5-HT1B/1D for migraine.', keyFacts: ['5-HT1A: anxiolytic target', '5-HT2A: psychedelic action, atypical antipsychotic target', '5-HT3: ion channel, ondansetron for nausea', '5-HT4: GI motility, prucalopride'] },
  { id: 'nmda_receptor', name: 'NMDA Receptor', category: 'receptor', subcategory: 'Ion Channel', visible: true, color: '#1e40af', tags: ['glutamate', 'learning', 'excitotoxicity', 'memantine'], description: 'Ionotropic glutamate receptor permeable to Ca²⁺, critical for synaptic plasticity, learning, and memory.', diseaseRelevance: 'Excitotoxicity in stroke and neurodegeneration. Memantine for Alzheimer. Ketamine for depression.', keyFacts: ['Requires glycine co-agonist and depolarization', 'Mg²⁺ block removed by depolarization', 'Ca²⁺ influx triggers LTP and LTD', 'Anti-NMDAR encephalitis: autoimmune'] },
  { id: 'gaba_a_receptor', name: 'GABA-A Receptor', category: 'receptor', subcategory: 'Ion Channel', visible: true, color: '#1e3a8a', tags: ['inhibitory', 'benzodiazepines', 'epilepsy', 'anesthesia'], description: 'Ligand-gated chloride channel mediating fast inhibitory neurotransmission in the CNS.', diseaseRelevance: 'Target for benzodiazepines, barbiturates, anesthetics. Mutations cause epilepsy.', keyFacts: ['Pentameric structure (α, β, γ subunits)', 'Benzodiazepine site on α/γ interface', 'Neurosteroids modulate at δ-containing receptors', 'Major target for anxiolytics and anticonvulsants'] },
  { id: 'estrogen_receptor', name: 'Estrogen Receptor (ERα/ERβ)', category: 'receptor', subcategory: 'Nuclear Receptor', visible: true, color: '#3b82f6', tags: ['estrogen', 'breast cancer', 'tamoxifen', 'SERMs'], description: 'Nuclear hormone receptors that bind estradiol and regulate gene transcription in reproductive tissues and bone.', diseaseRelevance: 'ER+ breast cancer: ~70% of breast cancers. Tamoxifen and aromatase inhibitors are key therapies.', keyFacts: ['ERα: breast, uterus, bone', 'ERβ: ovary, brain, cardiovascular', 'SERMs: tissue-selective ER modulators', 'CDK4/6 inhibitors combined with endocrine therapy'] },
  { id: 'insulin_receptor', name: 'Insulin Receptor (INSR)', category: 'receptor', subcategory: 'Receptor Tyrosine Kinase', visible: true, color: '#2563eb', tags: ['insulin signaling', 'diabetes', 'metabolism', 'PI3K/Akt'], description: 'Receptor tyrosine kinase that binds insulin and activates PI3K/Akt and RAS/MAPK cascades for metabolic and mitogenic effects.', diseaseRelevance: 'Insulin resistance at receptor/post-receptor level causes T2D.', keyFacts: ['Heterotetrameric (α2β2) structure', 'Auto-phosphorylation activates IRS proteins', 'PI3K/Akt: metabolic effects (GLUT4 translocation)', 'Mutations cause severe insulin resistance syndromes'] },

  // ========================= ANTIGENS =========================
  { id: 'cea_antigen', name: 'CEA (Carcinoembryonic Antigen)', category: 'antigen', subcategory: 'Tumor Marker', visible: true, color: '#8b5cf6', tags: ['colorectal cancer', 'tumor marker', 'monitoring', 'immunotherapy'], description: 'Glycoprotein normally produced during fetal development, re-expressed in colorectal, pancreatic, and other cancers.', diseaseRelevance: 'Most widely used tumor marker for colorectal cancer monitoring post-surgery.', keyFacts: ['Normal <5 ng/mL in non-smokers', 'Not specific for cancer (elevated in smoking, IBD)', 'Rising CEA after surgery suggests recurrence', 'CEA-targeted T-BsAbs in development'] },
  { id: 'psa_antigen', name: 'PSA (Prostate-Specific Antigen)', category: 'antigen', subcategory: 'Tumor Marker', visible: true, color: '#7c3aed', tags: ['prostate cancer', 'screening', 'serine protease'], description: 'Serine protease produced by prostate epithelial cells, used as a biomarker for prostate cancer screening.', diseaseRelevance: 'PSA >4 ng/mL warrants investigation. Controversial in population screening.', keyFacts: ['Normal <4 ng/mL', 'Free/total PSA ratio improves specificity', 'PSA velocity and density aid diagnosis', 'Over-diagnosis and over-treatment are concerns'] },
  { id: 'her2_antigen', name: 'HER2/neu Antigen', category: 'antigen', subcategory: 'Oncoprotein', visible: true, color: '#6d28d9', tags: ['breast cancer', 'trastuzumab', 'amplification', 'ADC'], description: 'Receptor tyrosine kinase amplified/overexpressed in ~20% of breast cancers, targetable by trastuzumab and T-DXd.', diseaseRelevance: 'HER2+ breast cancer is aggressive but highly treatable with targeted therapy.', keyFacts: ['ERBB2 gene amplification drives overexpression', 'IHC 3+ or FISH amplified defines HER2+', 'Trastuzumab: first targeted cancer therapy', 'HER2-low now targetable with T-DXd'] },
  { id: 'psma_antigen', name: 'PSMA', category: 'antigen', subcategory: 'Tumor Antigen', visible: true, color: '#5b21b6', tags: ['prostate cancer', 'theranostics', 'Lu-177', 'PET imaging'], description: 'Prostate-specific membrane antigen overexpressed in prostate cancer, used for imaging and radioligand therapy.', diseaseRelevance: 'PSMA PET/CT for staging. Lu-177-PSMA-617 (Pluvicto) for metastatic castration-resistant prostate cancer.', keyFacts: ['10-1000x overexpressed vs normal prostate', 'PSMA PET superior to conventional imaging', 'Lu-177-PSMA-617 extends survival in mCRPC', 'Also expressed in tumor neovasculature'] },
  { id: 'gd2_antigen', name: 'GD2 Ganglioside', category: 'antigen', subcategory: 'Tumor Antigen', visible: true, color: '#4c1d95', tags: ['neuroblastoma', 'ganglioside', 'dinutuximab', 'pediatric'], description: 'Disialoganglioside expressed on neuroblastoma, melanoma, and other neuroectodermal tumors.', diseaseRelevance: 'Target of dinutuximab for high-risk neuroblastoma. GD2 CAR-T in clinical trials.', keyFacts: ['Limited expression on normal tissues', 'Anti-GD2 antibodies activate ADCC and CDC', 'Dinutuximab improved survival in neuroblastoma', 'GD2 CAR-T cells showing promise in solid tumors'] },

  // ========================= GENES (EXPANDED) =========================
  { id: 'myc', name: 'MYC Proto-Oncogene', category: 'gene', subcategory: 'Oncogene', visible: true, color: '#ec4899', tags: ['transcription factor', 'cell proliferation', 'Burkitt lymphoma', 'amplification'], description: 'Master transcription factor regulating cell growth, proliferation, and metabolism. Amplified or translocated in many cancers.', diseaseRelevance: 'Translocation in Burkitt lymphoma. Amplified in breast, lung, ovarian cancers.', keyFacts: ['Regulates ~15% of all genes', 'MYC-MAX heterodimer binds E-boxes', 'Once considered undruggable', 'Omomyc and degraders in clinical trials'] },
  { id: 'rb1', name: 'RB1 (Retinoblastoma)', category: 'gene', subcategory: 'Tumor Suppressor', visible: true, color: '#db2777', tags: ['cell cycle', 'retinoblastoma', 'CDK4/6', 'E2F'], description: 'Tumor suppressor controlling G1/S cell cycle transition by sequestering E2F transcription factors.', diseaseRelevance: 'Biallelic loss causes retinoblastoma. CDK4/6 inhibitors restore RB function.', keyFacts: ['First tumor suppressor identified', 'Two-hit hypothesis demonstrated with RB1', 'Hypophosphorylated RB binds and inhibits E2F', 'CDK4/6 inhibitors (palbociclib) keep RB active'] },
  { id: 'apc_gene', name: 'APC Gene', category: 'gene', subcategory: 'Tumor Suppressor', visible: true, color: '#be185d', tags: ['Wnt pathway', 'colorectal cancer', 'FAP', 'beta-catenin'], description: 'Tumor suppressor that negatively regulates Wnt/β-catenin signaling. Gatekeeper gene in colorectal carcinogenesis.', diseaseRelevance: 'Germline mutations cause FAP. Somatic mutations in >80% sporadic CRC.', keyFacts: ['Part of β-catenin destruction complex', 'Loss activates Wnt target genes (MYC, cyclin D1)', 'Initiating event in adenoma-carcinoma sequence', 'FAP: thousands of polyps, near-certain CRC'] },
  { id: 'cftr', name: 'CFTR Gene', category: 'gene', subcategory: 'Channel Protein', visible: true, color: '#9d174d', tags: ['cystic fibrosis', 'chloride channel', 'ivacaftor', 'gene therapy'], description: 'Chloride channel gene mutated in cystic fibrosis. F508del is the most common mutation (~70% of alleles).', diseaseRelevance: 'CFTR modulators (elexacaftor/tezacaftor/ivacaftor) have transformed CF treatment.', keyFacts: ['F508del causes protein misfolding', 'Trikafta corrects folding + potentiates channel', 'Affects lungs, pancreas, liver, intestine', 'CFTR gene therapy and base editing in development'] },
  { id: 'brca2', name: 'BRCA2 Gene', category: 'gene', subcategory: 'Tumor Suppressor', visible: true, color: '#831843', tags: ['DNA repair', 'homologous recombination', 'breast cancer', 'ovarian cancer'], description: 'Tumor suppressor essential for homologous recombination DNA repair. Mutations confer high lifetime cancer risk.', diseaseRelevance: 'Germline mutations: 45% breast cancer risk, 17% ovarian. PARP inhibitors exploit HR deficiency.', keyFacts: ['Mediates RAD51 loading onto ssDNA', 'Loss causes genomic instability', 'Synthetic lethality with PARP inhibition', 'Also increases prostate and pancreatic cancer risk'] },
  { id: 'htt', name: 'HTT (Huntingtin)', category: 'gene', subcategory: 'Neurodegenerative', visible: true, color: '#ec4899', tags: ['Huntington disease', 'trinucleotide repeat', 'CAG expansion', 'neurodegeneration'], description: 'Gene containing a CAG trinucleotide repeat. Expansion >36 repeats causes Huntington disease.', diseaseRelevance: 'HD is autosomal dominant, progressive neurodegeneration with no cure. Antisense oligonucleotides in trials.', keyFacts: ['>36 CAG repeats: pathogenic', 'Polyglutamine aggregates are toxic', 'Affects striatal medium spiny neurons first', 'Huntingtin-lowering therapies in development'] },

  // ========================= DRUG TARGETS (EXPANDED) =========================
  { id: 'jak_kinase', name: 'JAK Kinases (JAK1/2/3, TYK2)', category: 'drug_target', subcategory: 'Kinase', visible: true, color: '#10b981', tags: ['cytokine signaling', 'JAK inhibitors', 'myelofibrosis', 'rheumatoid arthritis'], description: 'Janus kinase family that transduces signals from cytokine receptors via STAT phosphorylation.', diseaseRelevance: 'JAK2 V617F in myeloproliferative neoplasms. JAK inhibitors for RA, atopic dermatitis, MPN.', therapeuticTargets: ['Ruxolitinib (JAK1/2)', 'Tofacitinib (JAK1/3)', 'Baricitinib (JAK1/2)', 'Deucravacitinib (TYK2)'], keyFacts: ['JAK1/2: broad cytokine signaling', 'JAK3: restricted to immune cells', 'TYK2: IL-12/23 signaling', 'Oral small molecules replacing biologics'] },
  { id: 'hdac', name: 'HDAC (Histone Deacetylase)', category: 'drug_target', subcategory: 'Epigenetic', visible: true, color: '#059669', tags: ['epigenetics', 'histone modification', 'gene silencing', 'lymphoma'], description: 'Enzymes that remove acetyl groups from histones, causing chromatin condensation and gene silencing.', diseaseRelevance: 'HDAC inhibitors approved for T-cell lymphoma and multiple myeloma.', therapeuticTargets: ['Vorinostat', 'Romidepsin', 'Panobinostat', 'Belinostat'], keyFacts: ['18 human HDACs in 4 classes', 'Acetylation: open chromatin = gene activation', 'Deacetylation: closed chromatin = gene silencing', 'HDAC inhibitors reactivate silenced tumor suppressors'] },
  { id: 'btk', name: 'BTK (Bruton Tyrosine Kinase)', category: 'drug_target', subcategory: 'Kinase', visible: true, color: '#047857', tags: ['B cell signaling', 'CLL', 'MCL', 'ibrutinib'], description: 'Non-receptor tyrosine kinase essential for B cell receptor signaling and B cell development.', diseaseRelevance: 'BTK inhibitors have revolutionized CLL and MCL treatment.', therapeuticTargets: ['Ibrutinib', 'Acalabrutinib', 'Zanubrutinib', 'Pirtobrutinib (non-covalent)'], keyFacts: ['Deficiency causes X-linked agammaglobulinemia', 'Downstream of BCR signaling', 'Ibrutinib: first BTK inhibitor approved', 'Covalent vs non-covalent inhibitors'] },
  { id: 'sglt2', name: 'SGLT2 (Sodium-Glucose Co-Transporter 2)', category: 'drug_target', subcategory: 'Transporter', visible: true, color: '#065f46', tags: ['diabetes', 'kidney', 'heart failure', 'empagliflozin'], description: 'Renal sodium-glucose co-transporter in proximal tubule responsible for ~90% of glucose reabsorption.', diseaseRelevance: 'SGLT2 inhibitors reduce CV events, heart failure hospitalization, and CKD progression beyond glucose lowering.', therapeuticTargets: ['Empagliflozin', 'Dapagliflozin', 'Canagliflozin'], keyFacts: ['Inhibition causes glycosuria (glucose in urine)', 'CV and renal benefits independent of glucose lowering', 'Approved for heart failure (even without diabetes)', 'Small risk of euglycemic DKA'] },

  // ========================= VACCINE TARGETS =========================
  { id: 'spike_protein', name: 'SARS-CoV-2 Spike Protein', category: 'vaccine_target', subcategory: 'Viral Surface', visible: true, color: '#14b8a6', tags: ['COVID-19', 'mRNA vaccine', 'ACE2 binding', 'variants'], description: 'Trimeric surface glycoprotein mediating SARS-CoV-2 entry into cells via ACE2 receptor binding.', diseaseRelevance: 'Target of all COVID-19 vaccines. Mutations in spike protein drive immune evasion.', therapeuticTargets: ['mRNA vaccines (BNT162b2, mRNA-1273)', 'Protein subunit vaccines', 'Monoclonal antibodies'], keyFacts: ['S1 subunit: receptor binding domain (RBD)', 'S2 subunit: membrane fusion machinery', 'Prefusion stabilization improves immunogenicity', 'Variant mutations concentrated in RBD and NTD'] },
  { id: 'hemagglutinin', name: 'Influenza Hemagglutinin', category: 'vaccine_target', subcategory: 'Viral Surface', visible: true, color: '#0d9488', tags: ['influenza', 'flu vaccine', 'antigenic drift', 'universal vaccine'], description: 'Major surface glycoprotein of influenza virus that binds sialic acid receptors for cell entry and is the primary vaccine target.', diseaseRelevance: 'Seasonal flu vaccines target HA. Antigenic drift requires annual reformulation.', keyFacts: ['18 HA subtypes (H1-H18)', 'Head domain: immunodominant but variable', 'Stem domain: conserved, target for universal vaccines', 'Antigenic shift can cause pandemics'] },
  { id: 'hpv_l1', name: 'HPV L1 Capsid Protein', category: 'vaccine_target', subcategory: 'Viral Capsid', visible: true, color: '#0f766e', tags: ['HPV', 'cervical cancer', 'Gardasil', 'cancer prevention'], description: 'Major capsid protein of human papillomavirus that self-assembles into virus-like particles (VLPs) used in prophylactic vaccines.', diseaseRelevance: 'Gardasil-9 prevents infection by HPV types causing >90% of cervical cancers.', keyFacts: ['VLPs: non-infectious, highly immunogenic', 'Gardasil-9: HPV 6,11,16,18,31,33,45,52,58', 'Near-complete prevention of targeted HPV types', 'Can eliminate cervical cancer globally'] },
  { id: 'rsv_f_protein', name: 'RSV F Protein', category: 'vaccine_target', subcategory: 'Viral Surface', visible: true, color: '#115e59', tags: ['RSV', 'respiratory', 'infants', 'elderly', 'prefusion'], description: 'RSV fusion protein that mediates viral entry. Prefusion-stabilized F protein is the basis of recently approved RSV vaccines.', diseaseRelevance: 'RSV is leading cause of infant hospitalization. New vaccines approved for elderly and maternal immunization.', therapeuticTargets: ['Arexvy (GSK)', 'Abrysvo (Pfizer)', 'Nirsevimab (mAb for infants)'], keyFacts: ['Prefusion conformation induces more potent antibodies', 'Structure-based vaccine design breakthrough', 'Maternal vaccination protects newborns', 'Nirsevimab: single-dose mAb for all infants'] },
]

// ==================== GRAPH NODE TYPES ====================

interface GraphNode {
  id: string
  entityId: string
  name: string
  category: BiologicalCategory
  color: string
  x: number
  y: number
  width: number
  height: number
  notes: string
  expanded: boolean
}

interface GraphEdge {
  id: string
  sourceId: string
  targetId: string
  label: string
  color: string
}

interface GraphState {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const STORAGE_KEY = 'humanovo-workbench-graph'

function loadGraphState(): GraphState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { nodes: [], edges: [] }
}

function saveGraphState(state: GraphState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* ignore */ }
}

// ==================== NODE SHAPE HELPER ====================

function getNodeShape(category: BiologicalCategory, x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = w / 2
  const ry = h / 2
  switch (category) {
    case 'pathway':
      // Diamond
      return `M ${cx} ${y} L ${x + w} ${cy} L ${cx} ${y + h} L ${x} ${cy} Z`
    case 'gene':
      // Octagon
      {
        const inset = Math.min(w, h) * 0.25
        return `M ${x + inset} ${y} L ${x + w - inset} ${y} L ${x + w} ${y + inset} L ${x + w} ${y + h - inset} L ${x + w - inset} ${y + h} L ${x + inset} ${y + h} L ${x} ${y + h - inset} L ${x} ${y + inset} Z`
      }
    case 'biomolecule':
      // Hexagon
      {
        const pts: string[] = []
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 2
          pts.push(`${cx + rx * Math.cos(angle)} ${cy + ry * Math.sin(angle)}`)
        }
        return `M ${pts.join(' L ')} Z`
      }
    default:
      // Rounded rect as path
      {
        const r = 8
        return `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`
      }
  }
}

// ==================== CATEGORY ICON TEXT ====================

function getCategoryIcon(category: BiologicalCategory): string {
  switch (category) {
    case 'organ_system': return '\u2665' // heart
    case 'cell_type': return '\u25CB'    // circle
    case 'cellular_component': return '\u25A1' // square
    case 'biomolecule': return '\u2B22'  // hexagon
    case 'pathway': return '\u2192'      // arrow
    case 'receptor': return '\u0059'     // Y
    case 'antigen': return '\u2316'      // target
    case 'gene': return '\u2622'         // helix-ish
    case 'drug_target': return '\u2295'  // circled plus
    case 'vaccine_target': return '\u2694' // shield
    default: return '\u25CF'
  }
}

// ==================== BEZIER EDGE PATH ====================

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1) * 0.5
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

// ==================== SVG NODE GRAPH CANVAS ====================

function NodeGraphCanvas({
  nodes,
  edges,
  selectedNode,
  connectingFrom,
  mousePos,
  zoom,
  canvasOffset,
  onNodeMouseDown,
  onCanvasMouseMove,
  onCanvasMouseUp,
  onCanvasMouseDown,
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  onWheel,
  svgRef,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNode: string | null
  connectingFrom: string | null
  mousePos: { x: number; y: number }
  zoom: number
  canvasOffset: { x: number; y: number }
  onNodeMouseDown: (e: React.MouseEvent, nodeId: string) => void
  onCanvasMouseMove: (e: React.MouseEvent) => void
  onCanvasMouseUp: (e: React.MouseEvent) => void
  onCanvasMouseDown: (e: React.MouseEvent) => void
  onNodeClick: (nodeId: string) => void
  onNodeDoubleClick: (nodeId: string) => void
  onEdgeClick: (edgeId: string) => void
  onWheel: (e: React.WheelEvent) => void
  svgRef: React.RefObject<SVGSVGElement | null>
}) {
  // Compute edge endpoints based on node centers
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  return (
    <svg
      ref={svgRef}
      className="w-full h-full grid-bg cursor-crosshair"
      style={{ background: 'var(--color-bg)' }}
      onMouseMove={onCanvasMouseMove}
      onMouseUp={onCanvasMouseUp}
      onMouseDown={onCanvasMouseDown}
      onWheel={onWheel}
      onContextMenu={e => e.preventDefault()}
    >
      <defs>
        <filter id="node-glow">
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodOpacity="0.6" />
        </filter>
        <filter id="node-glow-selected">
          <feDropShadow dx="0" dy="2" stdDeviation="8" floodOpacity="0.8" />
        </filter>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="rgba(255,255,255,0.4)" />
        </marker>
      </defs>

      <g transform={`translate(${canvasOffset.x}, ${canvasOffset.y}) scale(${zoom})`}>
        {/* Edges */}
        {edges.map(edge => {
          const src = nodeMap.get(edge.sourceId)
          const tgt = nodeMap.get(edge.targetId)
          if (!src || !tgt) return null
          const x1 = src.x + src.width / 2
          const y1 = src.y + src.height / 2
          const x2 = tgt.x + tgt.width / 2
          const y2 = tgt.y + tgt.height / 2
          const midX = (x1 + x2) / 2
          const midY = (y1 + y2) / 2
          return (
            <g key={edge.id} onClick={() => onEdgeClick(edge.id)} className="cursor-pointer">
              <path
                d={edgePath(x1, y1, x2, y2)}
                fill="none"
                stroke={edge.color || 'rgba(255,255,255,0.25)'}
                strokeWidth={2}
                markerEnd="url(#arrowhead)"
                className="transition-all duration-200"
              />
              {/* Invisible wider path for easier clicking */}
              <path
                d={edgePath(x1, y1, x2, y2)}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
              />
              {edge.label && (
                <g transform={`translate(${midX}, ${midY})`}>
                  <rect
                    x={-edge.label.length * 3.5 - 6}
                    y={-10}
                    width={edge.label.length * 7 + 12}
                    height={20}
                    rx={4}
                    fill="rgba(0,0,0,0.7)"
                    stroke={edge.color || 'rgba(255,255,255,0.15)'}
                    strokeWidth={1}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="rgba(255,255,255,0.7)"
                    fontSize={10}
                    fontFamily="Inter, sans-serif"
                  >
                    {edge.label}
                  </text>
                </g>
              )}
            </g>
          )
        })}

        {/* Temporary connection line */}
        {connectingFrom && (() => {
          const src = nodeMap.get(connectingFrom)
          if (!src) return null
          const x1 = src.x + src.width / 2
          const y1 = src.y + src.height / 2
          const mx = (mousePos.x - canvasOffset.x) / zoom
          const my = (mousePos.y - canvasOffset.y) / zoom
          return (
            <path
              d={edgePath(x1, y1, mx, my)}
              fill="none"
              stroke="rgba(6, 182, 212, 0.6)"
              strokeWidth={2}
              strokeDasharray="6,4"
              pointerEvents="none"
            />
          )
        })()}

        {/* Nodes */}
        {nodes.map(node => {
          const isSelected = selectedNode === node.id
          const isConnecting = connectingFrom === node.id
          return (
            <g
              key={node.id}
              onMouseDown={(e) => onNodeMouseDown(e, node.id)}
              onClick={(e) => { e.stopPropagation(); onNodeClick(node.id) }}
              onDoubleClick={(e) => { e.stopPropagation(); onNodeDoubleClick(node.id) }}
              className="cursor-grab active:cursor-grabbing"
            >
              {/* Node shape */}
              <path
                d={getNodeShape(node.category, node.x, node.y, node.width, node.height)}
                fill={isSelected ? node.color + '30' : 'rgba(15, 15, 20, 0.85)'}
                stroke={node.color}
                strokeWidth={isSelected ? 2.5 : 1.5}
                filter={isSelected ? 'url(#node-glow-selected)' : undefined}
                style={{ transition: 'stroke-width 0.15s, fill 0.15s' }}
              />
              {/* Category icon */}
              <text
                x={node.x + 12}
                y={node.y + 18}
                fill={node.color}
                fontSize={12}
                fontFamily="Inter, sans-serif"
              >
                {getCategoryIcon(node.category)}
              </text>
              {/* Node name */}
              <text
                x={node.x + 26}
                y={node.y + 18}
                fill="rgba(255,255,255,0.9)"
                fontSize={11}
                fontWeight={600}
                fontFamily="Inter, sans-serif"
              >
                {node.name.length > 22 ? node.name.slice(0, 20) + '...' : node.name}
              </text>
              {/* Category label */}
              <text
                x={node.x + 12}
                y={node.y + 34}
                fill="rgba(255,255,255,0.4)"
                fontSize={9}
                fontFamily="Inter, sans-serif"
              >
                {categoryConfig[node.category]?.label || node.category}
              </text>
              {/* Notes indicator */}
              {node.notes && (
                <circle
                  cx={node.x + node.width - 10}
                  cy={node.y + 10}
                  r={4}
                  fill="#eab308"
                />
              )}
              {/* Connection handle (right side) */}
              <circle
                cx={node.x + node.width}
                cy={node.y + node.height / 2}
                r={5}
                fill={isConnecting ? '#06b6d4' : 'rgba(255,255,255,0.15)'}
                stroke={isConnecting ? '#06b6d4' : 'rgba(255,255,255,0.3)'}
                strokeWidth={1.5}
                className="hover:fill-[#06b6d4] transition-colors"
              />
              {/* Connection handle (left side) */}
              <circle
                cx={node.x}
                cy={node.y + node.height / 2}
                r={5}
                fill="rgba(255,255,255,0.15)"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth={1.5}
                className="hover:fill-[#06b6d4] transition-colors"
              />
              {/* Expanded details */}
              {node.expanded && (
                <foreignObject
                  x={node.x}
                  y={node.y + 42}
                  width={node.width}
                  height={node.height - 42}
                >
                  <div className="px-2 pb-1 text-[9px] text-white/50 overflow-hidden leading-tight">
                    {node.notes ? node.notes.slice(0, 80) : 'No notes'}
                  </div>
                </foreignObject>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

// ==================== SIDEBAR COMPONENT TREE ====================

function ComponentTree({ components, selectedId, onSelect, onToggleVisibility, searchTerm, onAddToCanvas }: {
  components: BiologicalComponent[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleVisibility: (id: string) => void
  searchTerm: string
  onAddToCanvas?: (comp: BiologicalComponent) => void
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
                      'group flex items-center gap-1.5 px-2 py-1 text-xs rounded cursor-pointer transition-colors',
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
                    {onAddToCanvas && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAddToCanvas(comp) }}
                        className="p-0.5 hover:bg-primary-500/20 rounded text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Add to Canvas"
                      >
                        <FiPlus className="w-3 h-3" />
                      </button>
                    )}
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

// ==================== MASTER HUMAN LIBRARY COMPONENTS ====================

function MasterLibraryTree({
  nodes,
  onSelect,
  selectedId,
  expandedNodes,
  onToggleExpand,
  depth = 0
}: {
  nodes: LibraryTreeNode[]
  onSelect: (id: string) => void
  selectedId: string | null
  expandedNodes: Set<string>
  onToggleExpand: (id: string) => void
  depth?: number
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map(node => {
        const isExpanded = expandedNodes.has(node.id)
        const hasChildren = node.children && node.children.length > 0
        const isSelected = selectedId === node.id

        return (
          <div key={node.id}>
            <div
              onClick={() => {
                if (node.type === 'element') {
                  onSelect(node.id)
                } else if (hasChildren) {
                  onToggleExpand(node.id)
                }
              }}
              style={{ paddingLeft: `${depth * 12 + 4}px` }}
              className={clsx(
                'flex items-center gap-1.5 py-1 px-2 rounded text-xs cursor-pointer transition-colors',
                isSelected
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'hover:bg-[var(--color-surface)] text-[var(--color-text-secondary)]',
                node.type === 'category' && 'font-medium text-[var(--color-text)]'
              )}
            >
              {hasChildren ? (
                <button className="p-0.5">
                  {isExpanded ? (
                    <FiChevronDown className="w-3 h-3" />
                  ) : (
                    <FiChevronRight className="w-3 h-3" />
                  )}
                </button>
              ) : (
                <span className="w-4" />
              )}
              {node.type === 'category' && node.color && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: node.color }}
                />
              )}
              <span className="truncate flex-1">{node.name}</span>
              {node.elementCount !== undefined && (
                <span className="text-xxs text-[var(--color-text-muted)]">
                  {node.elementCount}
                </span>
              )}
            </div>
            {isExpanded && hasChildren && (
              <MasterLibraryTree
                nodes={node.children!}
                onSelect={onSelect}
                selectedId={selectedId}
                expandedNodes={expandedNodes}
                onToggleExpand={onToggleExpand}
                depth={depth + 1}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function MasterLibraryDetails({ element }: { element: MasterLibraryElement | null }) {
  const [activeTab, setActiveTab] = useState<'info' | 'simulation' | 'interactions'>('info')

  if (!element) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] text-xs p-4">
        <FiDatabase className="w-8 h-8 mb-3 opacity-50" />
        <span className="text-center">Select an element from the Master Human Library to view details</span>
        <div className="mt-4 text-xxs">
          <div className="text-center mb-2">Library Statistics:</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span>Total Elements:</span>
            <span className="text-primary-400">{libraryStats.totalElements}</span>
            <span>Categories:</span>
            <span className="text-primary-400">{libraryStats.categories}</span>
            <span>AI-Ready:</span>
            <span className="text-green-400">{libraryStats.aiSimulationReady}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          {element.aiSimulationReady && (
            <FiCpu className="w-3.5 h-3.5 text-green-400" title="AI Simulation Ready" />
          )}
          <span className="text-sm font-medium">{element.name}</span>
        </div>
        <div className="flex items-center gap-2 text-xxs text-[var(--color-text-muted)]">
          <span className="badge badge-primary">{element.category.replace(/_/g, ' ')}</span>
          <span>• {element.subcategory}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 pt-2 border-b border-[var(--color-border)]">
        {(['info', 'simulation', 'interactions'] as const).map(tab => (
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {activeTab === 'info' && (
          <>
            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Description</div>
              <p className="text-[var(--color-text-secondary)] leading-relaxed">{element.description}</p>
            </div>

            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Location</div>
              <div className="flex flex-wrap gap-1">
                {element.location.map((loc: string) => (
                  <span key={loc} className="badge badge-neutral">{loc}</span>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Functions</div>
              <ul className="space-y-1">
                {element.functions.map((fn: string) => (
                  <li key={fn} className="flex items-start gap-1.5">
                    <span className="text-primary-400 mt-0.5">•</span>
                    <span className="text-[var(--color-text-secondary)]">{fn}</span>
                  </li>
                ))}
              </ul>
            </div>

            {element.diseaseLinks.length > 0 && (
              <div>
                <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Disease Links</div>
                <div className="flex flex-wrap gap-1">
                  {element.diseaseLinks.map((disease: string) => (
                    <span key={disease} className="badge" style={{ backgroundColor: '#ef444430', color: '#ef4444' }}>
                      {disease}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {element.drugTargets.length > 0 && (
              <div>
                <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Drug Targets</div>
                <div className="flex flex-wrap gap-1">
                  {element.drugTargets.map((drug: string) => (
                    <span key={drug} className="badge" style={{ backgroundColor: '#10b98130', color: '#10b981' }}>
                      {drug}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'simulation' && (
          <>
            <div className="bg-[var(--color-surface)] rounded-lg p-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider">Simulation Parameters</span>
                {element.aiSimulationReady ? (
                  <span className="badge" style={{ backgroundColor: '#22c55e30', color: '#22c55e' }}>AI Ready</span>
                ) : (
                  <span className="badge badge-neutral">Not Ready</span>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Baseline:</span>
                  <span>{element.simulationParams.baselineValue} {element.simulationParams.unit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Range:</span>
                  <span>{element.simulationParams.minValue} - {element.simulationParams.maxValue}</span>
                </div>
                {element.simulationParams.halfLife && (
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">Half-life:</span>
                    <span>{element.simulationParams.halfLife}</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">AI Simulation Controls</div>
              <div className="space-y-2">
                <div>
                  <label className="text-xxs text-[var(--color-text-muted)]">Target Value</label>
                  <input
                    type="range"
                    min={element.simulationParams.minValue}
                    max={element.simulationParams.maxValue}
                    defaultValue={element.simulationParams.baselineValue}
                    className="w-full"
                  />
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-primary flex-1">
                    <FiPlay className="w-3 h-3" />
                    Run Simulation
                  </button>
                  <button className="btn btn-sm btn-secondary">
                    <FiPause className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-[var(--color-surface)] rounded-lg p-3">
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Cure/Prevention Score Impact</div>
              <div className="text-center py-4 text-[var(--color-text-muted)]">
                <FiActivity className="w-6 h-6 mx-auto mb-2 opacity-50" />
                <span className="text-xxs">Run simulation to calculate impact</span>
              </div>
            </div>
          </>
        )}

        {activeTab === 'interactions' && (
          <>
            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Molecular Interactions</div>
              <div className="flex flex-wrap gap-1">
                {element.interactions.map((int: string) => (
                  <span key={int} className="badge badge-neutral">{int}</span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ==================== MAIN WORKBENCH COMPONENT ====================

export default function Workbench() {
  const [components, setComponents] = useState<BiologicalComponent[]>(biologicalStructures)
  const [leftPanelTab, setLeftPanelTab] = useState<'structures' | 'library'>('structures')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showGrid, setShowGrid] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  // Master Library state
  const [librarySearchTerm, setLibrarySearchTerm] = useState('')
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['molecular_level', 'cellular_level']))

  // Constant AI chat state
  const [showConstant, setShowConstant] = useState(false)
  const [constantMessages, setConstantMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [constantInput, setConstantInput] = useState('')
  const [constantLoading, setConstantLoading] = useState(false)
  const constantEndRef = useRef<HTMLDivElement>(null)

  const selectedComponent = components.find(c => c.id === selectedId) || null
  const selectedLibraryElement = selectedLibraryId ? findElementById(selectedLibraryId) ?? null : null

  // Library search results
  const librarySearchResults = librarySearchTerm.length > 2 ? searchElements(librarySearchTerm) : []

  const toggleLibraryNode = (id: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleVisibility = (id: string) => {
    setComponents(prev =>
      prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c)
    )
  }

  const sendConstantMessage = async () => {
    const msg = constantInput.trim()
    if (!msg || constantLoading) return
    setConstantInput('')
    setConstantMessages(prev => [...prev, { role: 'user', content: msg }])
    setConstantLoading(true)
    try {
      const context: Record<string, any> = { section: 'workbench' }
      if (selectedComponent) {
        context.selected_node = { id: selectedComponent.id, name: selectedComponent.name, type: selectedComponent.type, category: selectedComponent.category }
      }
      if (selectedLibraryElement) {
        context.selected_library_element = { id: selectedLibraryElement.id, name: selectedLibraryElement.name, type: selectedLibraryElement.type }
      }
      const res = await fetch('/api/v1/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, context: 'workbench', platform_context: context }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setConstantMessages(prev => [...prev, { role: 'assistant', content: data.response || data.message || 'No response' }])
    } catch {
      setConstantMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I could not process that request. Please try again.' }])
    } finally {
      setConstantLoading(false)
      setTimeout(() => constantEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  const visibleCount = components.filter(c => c.visible).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Main Workbench Area */}
      <div className="flex flex-1 min-h-0">
      {/* Left panel - Component Tree / Master Library */}
      <div className="w-72 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
        {/* Tab switcher */}
        <div className="flex border-b border-[var(--color-border)]">
          <button
            onClick={() => setLeftPanelTab('structures')}
            className={clsx(
              'flex-1 px-3 py-2 text-xs font-medium transition-colors border-b-2',
              leftPanelTab === 'structures'
                ? 'border-primary-500 text-primary-400 bg-primary-500/10'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            )}
          >
            <FiTarget className="w-3.5 h-3.5 inline mr-1.5" />
            Structures
          </button>
          <button
            onClick={() => setLeftPanelTab('library')}
            className={clsx(
              'flex-1 px-3 py-2 text-xs font-medium transition-colors border-b-2',
              leftPanelTab === 'library'
                ? 'border-primary-500 text-primary-400 bg-primary-500/10'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            )}
          >
            <FiDatabase className="w-3.5 h-3.5 inline mr-1.5" />
            Master Library
          </button>
        </div>

        {leftPanelTab === 'structures' ? (
          <>
            <div className="p-3 border-b border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">Disease Structures</h3>
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
          </>
        ) : (
          <>
            <div className="p-3 border-b border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">Master Human Library</h3>
                <span className="text-xxs text-green-400">{libraryStats.totalElements} elements</span>
              </div>
              <div className="relative">
                <FiSearch className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  placeholder="Search all elements..."
                  value={librarySearchTerm}
                  onChange={(e) => setLibrarySearchTerm(e.target.value)}
                  className="input w-full text-xs pl-7"
                />
              </div>
              {librarySearchTerm.length > 0 && librarySearchTerm.length < 3 && (
                <div className="text-xxs text-[var(--color-text-muted)] mt-1">Type 3+ characters to search</div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {librarySearchResults.length > 0 ? (
                <div className="space-y-0.5">
                  <div className="text-xxs text-[var(--color-text-muted)] px-2 py-1">
                    {librarySearchResults.length} results found
                  </div>
                  {librarySearchResults.slice(0, 50).map(elem => (
                    <div
                      key={elem.id}
                      onClick={() => setSelectedLibraryId(elem.id)}
                      className={clsx(
                        'flex items-center gap-2 py-1.5 px-2 rounded text-xs cursor-pointer transition-colors',
                        selectedLibraryId === elem.id
                          ? 'bg-primary-500/20 text-primary-400'
                          : 'hover:bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                      )}
                    >
                      {elem.aiSimulationReady && <FiCpu className="w-3 h-3 text-green-400" />}
                      <span className="truncate flex-1">{elem.name}</span>
                      <span className="text-xxs text-[var(--color-text-muted)]">{elem.category.split('_')[0]}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <MasterLibraryTree
                  nodes={masterLibraryTree}
                  onSelect={setSelectedLibraryId}
                  selectedId={selectedLibraryId}
                  expandedNodes={expandedNodes}
                  onToggleExpand={toggleLibraryNode}
                />
              )}
            </div>
          </>
        )}
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
            <div className="w-px h-5 bg-[var(--color-border)] mx-2" />
            <button
              onClick={() => setShowConstant(!showConstant)}
              className={clsx('btn btn-sm', showConstant ? 'btn-primary' : 'btn-secondary')}
              title="Constant AI Assistant"
            >
              <FiMessageSquare className="w-3 h-3" />
              Constant
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

      {/* Constant AI Panel */}
      {showConstant && (
        <div className="w-80 border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
          <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <h3 className="text-sm font-medium">Constant AI</h3>
            </div>
            <button onClick={() => setShowConstant(false)} className="p-1 hover:bg-[var(--color-surface)] rounded transition-colors">
              <FiX className="w-3.5 h-3.5" />
            </button>
          </div>
          {selectedComponent && (
            <div className="px-3 py-2 border-b border-[var(--color-border)] bg-cyan-500/5">
              <p className="text-[10px] text-cyan-400">Context: {selectedComponent.name}</p>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {constantMessages.length === 0 && (
              <div className="text-center py-8 text-[var(--color-text-muted)]">
                <FiMessageSquare className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-xs">Ask Constant about your workbench entities, connections, or biological structures.</p>
                <div className="mt-3 space-y-1">
                  {['Explain this pathway', 'Suggest connections', 'What proteins interact with this?', 'Analyze this structure'].map(s => (
                    <button key={s} onClick={() => { setConstantInput(s); }} className="block w-full text-left text-[10px] px-2 py-1.5 rounded hover:bg-[var(--color-surface)] text-[var(--color-text-muted)] transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {constantMessages.map((m, i) => (
              <div key={i} className={clsx('text-xs rounded-lg px-3 py-2 max-w-[95%]', m.role === 'user' ? 'ml-auto bg-cyan-500/20 text-cyan-100' : 'bg-[var(--color-surface)]')}>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ))}
            {constantLoading && (
              <div className="bg-[var(--color-surface)] rounded-lg px-3 py-2 text-xs max-w-[95%]">
                <span className="animate-pulse">Thinking...</span>
              </div>
            )}
            <div ref={constantEndRef} />
          </div>
          <div className="p-3 border-t border-[var(--color-border)]">
            <div className="flex gap-2" style={{ background: 'rgba(17, 17, 17, 0.7)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderRadius: '8px', padding: '6px' }}>
              <input
                value={constantInput}
                onChange={e => setConstantInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendConstantMessage()}
                placeholder="Ask Constant..."
                className="flex-1 bg-transparent text-xs outline-none px-2"
              />
              <button onClick={sendConstantMessage} disabled={constantLoading || !constantInput.trim()} className="p-1.5 rounded hover:bg-[var(--color-surface)] transition-colors disabled:opacity-30">
                <FiSend className="w-3.5 h-3.5 text-cyan-400" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right panel - Properties / Library Details */}
      <div className="w-80 border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              {leftPanelTab === 'library' ? 'Element Details' : 'Properties'}
            </h3>
            <div className="flex items-center gap-1">
              {leftPanelTab === 'library' && selectedLibraryElement && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">
                  {selectedLibraryElement.aiSimulationReady ? 'AI Ready' : 'Manual'}
                </span>
              )}
              <button className="p-1 hover:bg-[var(--color-surface)] rounded transition-colors">
                <FiSettings className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {leftPanelTab === 'library' ? (
            <MasterLibraryDetails element={selectedLibraryElement} />
          ) : (
            <div className="p-3">
              <PropertiesPanel component={selectedComponent} />
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
