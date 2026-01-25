// Master Human Library - Complete Biological Elements Database
// For Multi-AI Agent Simulation to optimize cure/prevention scores

export type LibraryCategory =
  | 'genetic_material'
  | 'rna_expression'
  | 'proteins_enzymes'
  | 'organic_molecules'
  | 'inorganic_components'
  | 'organelles'
  | 'cell_types'
  | 'tissues'
  | 'organs'
  | 'organ_systems'
  | 'biochemical_pathways'
  | 'signaling_pathways'

export interface BiologicalElement {
  id: string
  name: string
  category: LibraryCategory
  subcategory: string
  description: string
  location: string[]
  functions: string[]
  interactions: string[]
  diseaseLinks: string[]
  drugTargets: string[]
  simulationParams: {
    baselineValue: number
    minValue: number
    maxValue: number
    unit: string
    halfLife?: string
    turnoverRate?: string
  }
  aiSimulationReady: boolean
}

// ==================== GENETIC MATERIAL ====================
export const geneticMaterial: BiologicalElement[] = [
  {
    id: 'dna_nuclear',
    name: 'Nuclear DNA',
    category: 'genetic_material',
    subcategory: 'Chromosomal DNA',
    description: 'Double-helical molecule containing 3.1 billion base pairs encoding hereditary blueprint in 23 chromosome pairs',
    location: ['Cell Nucleus'],
    functions: ['Genetic information storage', 'Hereditary transmission', 'Protein coding', 'Gene regulation'],
    interactions: ['Histones', 'Transcription factors', 'DNA polymerase', 'RNA polymerase'],
    diseaseLinks: ['Cancer', 'Genetic disorders', 'Aging'],
    drugTargets: ['DNA repair enzymes', 'Topoisomerases', 'DNA methyltransferases'],
    simulationParams: { baselineValue: 6.4, minValue: 0, maxValue: 6.4, unit: 'billion base pairs' },
    aiSimulationReady: true
  },
  {
    id: 'dna_mitochondrial',
    name: 'Mitochondrial DNA (mtDNA)',
    category: 'genetic_material',
    subcategory: 'Organelle DNA',
    description: 'Circular DNA molecule in mitochondria encoding 37 genes for oxidative phosphorylation',
    location: ['Mitochondria'],
    functions: ['Encodes 13 respiratory chain proteins', 'Encodes 22 tRNAs', 'Encodes 2 rRNAs'],
    interactions: ['Mitochondrial ribosomes', 'Nuclear-encoded proteins', 'mtDNA polymerase'],
    diseaseLinks: ['Mitochondrial diseases', 'Aging', 'Neurodegeneration', 'Diabetes'],
    drugTargets: ['Mitochondrial transcription factors'],
    simulationParams: { baselineValue: 16569, minValue: 0, maxValue: 16569, unit: 'base pairs' },
    aiSimulationReady: true
  },
  {
    id: 'chromosomes',
    name: 'Chromosomes (46)',
    category: 'genetic_material',
    subcategory: 'Chromosome Structure',
    description: '23 pairs of chromosomes (22 autosomal + 1 sex chromosome pair) containing packaged DNA',
    location: ['Cell Nucleus'],
    functions: ['DNA organization', 'Gene regulation', 'Cell division', 'Heredity'],
    interactions: ['Centromeres', 'Telomeres', 'Histones', 'Cohesin', 'Condensin'],
    diseaseLinks: ['Down syndrome', 'Turner syndrome', 'Klinefelter syndrome', 'Cancer'],
    drugTargets: ['Aurora kinases', 'Polo-like kinases'],
    simulationParams: { baselineValue: 46, minValue: 45, maxValue: 47, unit: 'chromosomes' },
    aiSimulationReady: true
  },
  {
    id: 'telomeres',
    name: 'Telomeres',
    category: 'genetic_material',
    subcategory: 'Chromosome Structure',
    description: 'Protective TTAGGG repeat sequences at chromosome ends preventing degradation',
    location: ['Chromosome ends'],
    functions: ['Chromosome protection', 'Cellular aging regulation', 'Genomic stability'],
    interactions: ['Telomerase', 'Shelterin complex', 'DNA repair proteins'],
    diseaseLinks: ['Aging', 'Cancer', 'Dyskeratosis congenita', 'Pulmonary fibrosis'],
    drugTargets: ['Telomerase', 'Shelterin proteins'],
    simulationParams: { baselineValue: 10000, minValue: 2000, maxValue: 15000, unit: 'base pairs' },
    aiSimulationReady: true
  },
  {
    id: 'centromeres',
    name: 'Centromeres',
    category: 'genetic_material',
    subcategory: 'Chromosome Structure',
    description: 'Specialized chromatin regions for spindle attachment during cell division',
    location: ['Chromosome center'],
    functions: ['Spindle attachment', 'Sister chromatid cohesion', 'Chromosome segregation'],
    interactions: ['Kinetochore proteins', 'CENP proteins', 'Cohesin'],
    diseaseLinks: ['Aneuploidy', 'Cancer', 'Chromosomal instability'],
    drugTargets: ['Aurora kinases', 'CENP-E'],
    simulationParams: { baselineValue: 46, minValue: 46, maxValue: 46, unit: 'per cell' },
    aiSimulationReady: true
  },
  {
    id: 'genes_protein_coding',
    name: 'Protein-Coding Genes',
    category: 'genetic_material',
    subcategory: 'Genes',
    description: 'Approximately 19,000-20,000 genes encoding proteins',
    location: ['Nuclear chromosomes'],
    functions: ['Protein synthesis instructions', 'Cellular function regulation'],
    interactions: ['Transcription factors', 'Enhancers', 'Promoters', 'Silencers'],
    diseaseLinks: ['All genetic diseases', 'Cancer', 'Metabolic disorders'],
    drugTargets: ['Gene therapy targets', 'Antisense oligonucleotides'],
    simulationParams: { baselineValue: 20000, minValue: 19000, maxValue: 21000, unit: 'genes' },
    aiSimulationReady: true
  },
  {
    id: 'genes_noncoding',
    name: 'Non-Coding RNA Genes',
    category: 'genetic_material',
    subcategory: 'Genes',
    description: 'Approximately 15,000-20,000 genes producing functional RNAs without protein products',
    location: ['Nuclear chromosomes'],
    functions: ['Gene regulation', 'RNA processing', 'Chromatin modification'],
    interactions: ['miRNAs', 'lncRNAs', 'RNA binding proteins'],
    diseaseLinks: ['Cancer', 'Neurological disorders', 'Cardiovascular disease'],
    drugTargets: ['RNA therapeutics', 'Antisense oligonucleotides'],
    simulationParams: { baselineValue: 17000, minValue: 15000, maxValue: 20000, unit: 'genes' },
    aiSimulationReady: true
  },
  {
    id: 'histones',
    name: 'Histones',
    category: 'genetic_material',
    subcategory: 'Chromatin Proteins',
    description: 'Basic proteins (H1, H2A, H2B, H3, H4) that package DNA into nucleosomes',
    location: ['Cell Nucleus'],
    functions: ['DNA packaging', 'Gene regulation', 'Chromatin structure'],
    interactions: ['DNA', 'Histone modifying enzymes', 'Chromatin remodelers'],
    diseaseLinks: ['Cancer', 'Developmental disorders', 'Aging'],
    drugTargets: ['HDAC inhibitors', 'Histone methyltransferases', 'BET inhibitors'],
    simulationParams: { baselineValue: 60000000, minValue: 0, maxValue: 100000000, unit: 'molecules/cell' },
    aiSimulationReady: true
  },
  {
    id: 'epigenetic_marks',
    name: 'Epigenetic Modifications',
    category: 'genetic_material',
    subcategory: 'Epigenetics',
    description: 'Chemical modifications to DNA and histones affecting gene expression without changing sequence',
    location: ['DNA', 'Histones'],
    functions: ['Gene silencing', 'Gene activation', 'Cellular memory', 'Development'],
    interactions: ['DNA methyltransferases', 'Histone acetyltransferases', 'Histone deacetylases'],
    diseaseLinks: ['Cancer', 'Imprinting disorders', 'Aging', 'Mental disorders'],
    drugTargets: ['DNMT inhibitors', 'HDAC inhibitors', 'EZH2 inhibitors'],
    simulationParams: { baselineValue: 70, minValue: 0, maxValue: 100, unit: '% methylated CpGs' },
    aiSimulationReady: true
  }
]

// ==================== RNA AND GENE EXPRESSION ====================
export const rnaElements: BiologicalElement[] = [
  {
    id: 'mrna',
    name: 'Messenger RNA (mRNA)',
    category: 'rna_expression',
    subcategory: 'Coding RNA',
    description: 'RNA transcripts carrying genetic instructions from DNA to ribosomes for protein synthesis',
    location: ['Nucleus', 'Cytoplasm', 'Rough ER'],
    functions: ['Protein coding', 'Genetic information transfer'],
    interactions: ['Ribosomes', 'tRNA', 'Translation factors', 'RNA binding proteins'],
    diseaseLinks: ['Cancer', 'Genetic disorders'],
    drugTargets: ['mRNA therapeutics', 'Antisense oligonucleotides', 'siRNA'],
    simulationParams: { baselineValue: 200000, minValue: 50000, maxValue: 500000, unit: 'molecules/cell', halfLife: '10 hours' },
    aiSimulationReady: true
  },
  {
    id: 'rrna',
    name: 'Ribosomal RNA (rRNA)',
    category: 'rna_expression',
    subcategory: 'Structural RNA',
    description: 'RNA component of ribosomes (28S, 18S, 5.8S, 5S) essential for protein synthesis',
    location: ['Nucleolus', 'Ribosomes', 'Cytoplasm'],
    functions: ['Ribosome structure', 'Peptide bond catalysis', 'Protein synthesis'],
    interactions: ['Ribosomal proteins', 'mRNA', 'tRNA'],
    diseaseLinks: ['Ribosomopathies', 'Diamond-Blackfan anemia', 'Cancer'],
    drugTargets: ['Antibiotics targeting ribosomes'],
    simulationParams: { baselineValue: 80, minValue: 60, maxValue: 85, unit: '% of total RNA' },
    aiSimulationReady: true
  },
  {
    id: 'trna',
    name: 'Transfer RNA (tRNA)',
    category: 'rna_expression',
    subcategory: 'Adapter RNA',
    description: 'Small RNAs (~76 nucleotides) that deliver amino acids to ribosomes during translation',
    location: ['Cytoplasm', 'Mitochondria'],
    functions: ['Amino acid delivery', 'Codon recognition', 'Protein synthesis'],
    interactions: ['Aminoacyl-tRNA synthetases', 'Ribosomes', 'mRNA'],
    diseaseLinks: ['Mitochondrial diseases', 'Neurological disorders'],
    drugTargets: ['tRNA synthetase inhibitors'],
    simulationParams: { baselineValue: 500, minValue: 100, maxValue: 1000, unit: 'different species' },
    aiSimulationReady: true
  },
  {
    id: 'mirna',
    name: 'MicroRNA (miRNA)',
    category: 'rna_expression',
    subcategory: 'Regulatory RNA',
    description: 'Small non-coding RNAs (~22 nucleotides) that regulate gene expression post-transcriptionally',
    location: ['Cytoplasm', 'Nucleus', 'Exosomes'],
    functions: ['Gene silencing', 'mRNA degradation', 'Translation inhibition'],
    interactions: ['RISC complex', 'Argonaute proteins', 'Target mRNAs'],
    diseaseLinks: ['Cancer', 'Cardiovascular disease', 'Neurological disorders', 'Diabetes'],
    drugTargets: ['miRNA mimics', 'Anti-miRNAs', 'miRNA sponges'],
    simulationParams: { baselineValue: 2600, minValue: 2000, maxValue: 3000, unit: 'known miRNAs' },
    aiSimulationReady: true
  },
  {
    id: 'lncrna',
    name: 'Long Non-Coding RNA (lncRNA)',
    category: 'rna_expression',
    subcategory: 'Regulatory RNA',
    description: 'Non-coding RNAs longer than 200 nucleotides with diverse regulatory functions',
    location: ['Nucleus', 'Cytoplasm'],
    functions: ['Chromatin remodeling', 'Transcription regulation', 'RNA processing'],
    interactions: ['Chromatin modifiers', 'Transcription factors', 'RNA binding proteins'],
    diseaseLinks: ['Cancer', 'Neurological disorders', 'Cardiovascular disease'],
    drugTargets: ['Antisense oligonucleotides', 'CRISPR targeting'],
    simulationParams: { baselineValue: 16000, minValue: 10000, maxValue: 20000, unit: 'lncRNA genes' },
    aiSimulationReady: true
  },
  {
    id: 'snrna',
    name: 'Small Nuclear RNA (snRNA)',
    category: 'rna_expression',
    subcategory: 'Processing RNA',
    description: 'Small RNAs in the nucleus involved in pre-mRNA splicing (U1, U2, U4, U5, U6)',
    location: ['Nucleus', 'Spliceosome'],
    functions: ['Pre-mRNA splicing', 'Spliceosome assembly'],
    interactions: ['Sm proteins', 'Spliceosome components', 'Pre-mRNA'],
    diseaseLinks: ['Spinal muscular atrophy', 'Retinitis pigmentosa'],
    drugTargets: ['Splice-switching oligonucleotides'],
    simulationParams: { baselineValue: 200000, minValue: 100000, maxValue: 500000, unit: 'molecules/cell' },
    aiSimulationReady: true
  },
  {
    id: 'snorna',
    name: 'Small Nucleolar RNA (snoRNA)',
    category: 'rna_expression',
    subcategory: 'Processing RNA',
    description: 'Small RNAs guiding chemical modifications of rRNAs and other RNAs',
    location: ['Nucleolus'],
    functions: ['rRNA modification', '2-O-methylation', 'Pseudouridylation'],
    interactions: ['Fibrillarin', 'Dyskerin', 'rRNA precursors'],
    diseaseLinks: ['Dyskeratosis congenita', 'Prader-Willi syndrome'],
    drugTargets: ['snoRNA-targeted therapies'],
    simulationParams: { baselineValue: 400, minValue: 300, maxValue: 500, unit: 'snoRNA species' },
    aiSimulationReady: true
  },
  {
    id: 'circrna',
    name: 'Circular RNA (circRNA)',
    category: 'rna_expression',
    subcategory: 'Regulatory RNA',
    description: 'Covalently closed circular RNA molecules with regulatory functions',
    location: ['Cytoplasm', 'Nucleus'],
    functions: ['miRNA sponging', 'Protein scaffolding', 'Translation regulation'],
    interactions: ['miRNAs', 'RNA binding proteins', 'Ribosomes'],
    diseaseLinks: ['Cancer', 'Neurological disorders', 'Cardiovascular disease'],
    drugTargets: ['circRNA therapeutics'],
    simulationParams: { baselineValue: 100000, minValue: 50000, maxValue: 200000, unit: 'circRNAs identified' },
    aiSimulationReady: true
  }
]

// ==================== PROTEINS AND ENZYMES ====================
export const proteinsEnzymes: BiologicalElement[] = [
  {
    id: 'collagen',
    name: 'Collagen',
    category: 'proteins_enzymes',
    subcategory: 'Structural Proteins',
    description: 'Most abundant protein in body, forms connective tissue fibers (28 types)',
    location: ['Skin', 'Bone', 'Cartilage', 'Tendons', 'Blood vessels'],
    functions: ['Structural support', 'Tissue strength', 'Cell adhesion'],
    interactions: ['Integrins', 'Fibronectin', 'Proteoglycans'],
    diseaseLinks: ['Osteogenesis imperfecta', 'Ehlers-Danlos syndrome', 'Arthritis', 'Aging'],
    drugTargets: ['Collagen synthesis modulators', 'MMP inhibitors'],
    simulationParams: { baselineValue: 30, minValue: 20, maxValue: 35, unit: '% of body protein' },
    aiSimulationReady: true
  },
  {
    id: 'keratin',
    name: 'Keratin',
    category: 'proteins_enzymes',
    subcategory: 'Structural Proteins',
    description: 'Fibrous structural protein forming hair, nails, and outer skin layer',
    location: ['Epidermis', 'Hair', 'Nails'],
    functions: ['Protection', 'Waterproofing', 'Structural integrity'],
    interactions: ['Desmosomes', 'Intermediate filaments'],
    diseaseLinks: ['Epidermolysis bullosa', 'Ichthyosis', 'Skin disorders'],
    drugTargets: ['Keratin stabilizers'],
    simulationParams: { baselineValue: 95, minValue: 85, maxValue: 100, unit: '% of hair composition' },
    aiSimulationReady: true
  },
  {
    id: 'actin',
    name: 'Actin',
    category: 'proteins_enzymes',
    subcategory: 'Contractile Proteins',
    description: 'Cytoskeletal protein forming microfilaments, essential for muscle contraction',
    location: ['All cells', 'Muscle fibers'],
    functions: ['Cell shape', 'Cell motility', 'Muscle contraction', 'Cell division'],
    interactions: ['Myosin', 'Tropomyosin', 'Troponin', 'Actin-binding proteins'],
    diseaseLinks: ['Cardiomyopathy', 'Muscular dystrophy', 'Cancer metastasis'],
    drugTargets: ['Cytochalasin', 'Phalloidin', 'Latrunculin'],
    simulationParams: { baselineValue: 5, minValue: 1, maxValue: 10, unit: '% of cell protein' },
    aiSimulationReady: true
  },
  {
    id: 'myosin',
    name: 'Myosin',
    category: 'proteins_enzymes',
    subcategory: 'Contractile Proteins',
    description: 'Motor protein that interacts with actin to produce muscle contraction',
    location: ['Muscle fibers', 'Cytoplasm'],
    functions: ['Muscle contraction', 'Cell motility', 'Vesicle transport'],
    interactions: ['Actin', 'ATP', 'Calcium ions'],
    diseaseLinks: ['Cardiomyopathy', 'Hearing loss', 'Muscular disorders'],
    drugTargets: ['Myosin inhibitors', 'Omecamtiv mecarbil'],
    simulationParams: { baselineValue: 25, minValue: 15, maxValue: 35, unit: '% of muscle protein' },
    aiSimulationReady: true
  },
  {
    id: 'hemoglobin',
    name: 'Hemoglobin',
    category: 'proteins_enzymes',
    subcategory: 'Transport Proteins',
    description: 'Iron-containing protein in red blood cells that carries oxygen',
    location: ['Red blood cells'],
    functions: ['Oxygen transport', 'CO2 transport', 'pH buffering'],
    interactions: ['Oxygen', 'Carbon dioxide', '2,3-BPG', 'Iron'],
    diseaseLinks: ['Sickle cell disease', 'Thalassemia', 'Anemia', 'Carbon monoxide poisoning'],
    drugTargets: ['Hemoglobin modifiers', 'Voxelotor'],
    simulationParams: { baselineValue: 14, minValue: 12, maxValue: 17, unit: 'g/dL blood' },
    aiSimulationReady: true
  },
  {
    id: 'albumin',
    name: 'Albumin',
    category: 'proteins_enzymes',
    subcategory: 'Transport Proteins',
    description: 'Most abundant plasma protein, transports hormones, fatty acids, drugs',
    location: ['Blood plasma'],
    functions: ['Osmotic pressure maintenance', 'Transport carrier', 'pH buffering'],
    interactions: ['Fatty acids', 'Hormones', 'Drugs', 'Bilirubin'],
    diseaseLinks: ['Liver disease', 'Kidney disease', 'Malnutrition'],
    drugTargets: ['Drug-albumin binding sites'],
    simulationParams: { baselineValue: 4.0, minValue: 3.5, maxValue: 5.0, unit: 'g/dL plasma' },
    aiSimulationReady: true
  },
  {
    id: 'insulin',
    name: 'Insulin',
    category: 'proteins_enzymes',
    subcategory: 'Hormones/Signaling',
    description: 'Peptide hormone regulating blood glucose uptake into cells',
    location: ['Pancreatic beta cells', 'Blood'],
    functions: ['Glucose uptake', 'Glycogen synthesis', 'Lipogenesis', 'Protein synthesis'],
    interactions: ['Insulin receptor', 'GLUT4', 'IRS proteins', 'PI3K/Akt pathway'],
    diseaseLinks: ['Type 1 diabetes', 'Type 2 diabetes', 'Metabolic syndrome', 'Obesity'],
    drugTargets: ['Insulin analogs', 'Insulin sensitizers'],
    simulationParams: { baselineValue: 10, minValue: 2, maxValue: 25, unit: 'μU/mL fasting' },
    aiSimulationReady: true
  },
  {
    id: 'antibodies_igg',
    name: 'Immunoglobulin G (IgG)',
    category: 'proteins_enzymes',
    subcategory: 'Immune Proteins',
    description: 'Most abundant antibody type providing immunity against pathogens',
    location: ['Blood', 'Extracellular fluid', 'Tissues'],
    functions: ['Pathogen neutralization', 'Opsonization', 'Complement activation'],
    interactions: ['Fc receptors', 'Complement proteins', 'Antigens'],
    diseaseLinks: ['Immunodeficiency', 'Autoimmune diseases', 'Allergies'],
    drugTargets: ['Monoclonal antibodies', 'IVIG therapy'],
    simulationParams: { baselineValue: 1000, minValue: 700, maxValue: 1600, unit: 'mg/dL serum' },
    aiSimulationReady: true
  },
  {
    id: 'cytochrome_p450',
    name: 'Cytochrome P450 Enzymes',
    category: 'proteins_enzymes',
    subcategory: 'Enzymes',
    description: 'Superfamily of ~57 enzymes metabolizing drugs, toxins, and steroids',
    location: ['Liver', 'Intestine', 'Kidney', 'Lung'],
    functions: ['Drug metabolism', 'Toxin detoxification', 'Steroid synthesis'],
    interactions: ['NADPH', 'Cytochrome P450 reductase', 'Drug substrates'],
    diseaseLinks: ['Drug toxicity', 'Drug interactions', 'Cancer susceptibility'],
    drugTargets: ['CYP inhibitors', 'CYP inducers'],
    simulationParams: { baselineValue: 57, minValue: 57, maxValue: 57, unit: 'CYP genes' },
    aiSimulationReady: true
  },
  {
    id: 'dna_polymerase',
    name: 'DNA Polymerases',
    category: 'proteins_enzymes',
    subcategory: 'Enzymes',
    description: 'Enzymes that synthesize DNA during replication and repair',
    location: ['Nucleus', 'Mitochondria'],
    functions: ['DNA replication', 'DNA repair', 'Proofreading'],
    interactions: ['DNA template', 'dNTPs', 'PCNA', 'Primase'],
    diseaseLinks: ['Cancer', 'Aging', 'Genetic instability', 'Immunodeficiency'],
    drugTargets: ['Nucleoside analogs', 'Polymerase inhibitors'],
    simulationParams: { baselineValue: 15, minValue: 15, maxValue: 15, unit: 'polymerase types' },
    aiSimulationReady: true
  },
  {
    id: 'kinases',
    name: 'Protein Kinases',
    category: 'proteins_enzymes',
    subcategory: 'Enzymes',
    description: 'Enzymes that phosphorylate proteins to regulate their activity (~518 in human kinome)',
    location: ['Cytoplasm', 'Nucleus', 'Membrane'],
    functions: ['Signal transduction', 'Cell cycle control', 'Metabolism regulation'],
    interactions: ['ATP', 'Substrate proteins', 'Phosphatases'],
    diseaseLinks: ['Cancer', 'Diabetes', 'Inflammation', 'Neurodegeneration'],
    drugTargets: ['Kinase inhibitors (imatinib, etc.)'],
    simulationParams: { baselineValue: 518, minValue: 518, maxValue: 518, unit: 'kinase genes' },
    aiSimulationReady: true
  },
  {
    id: 'proteases',
    name: 'Proteases/Peptidases',
    category: 'proteins_enzymes',
    subcategory: 'Enzymes',
    description: 'Enzymes that cleave proteins (~600 in human degradome)',
    location: ['Lysosomes', 'Extracellular', 'Cytoplasm', 'Membrane'],
    functions: ['Protein degradation', 'Protein activation', 'Digestion', 'Apoptosis'],
    interactions: ['Protein substrates', 'Protease inhibitors'],
    diseaseLinks: ['Cancer', 'Arthritis', 'Pancreatitis', 'Alzheimer\'s'],
    drugTargets: ['Protease inhibitors (HIV, HCV)'],
    simulationParams: { baselineValue: 600, minValue: 550, maxValue: 650, unit: 'protease genes' },
    aiSimulationReady: true
  }
]

export const allElements: BiologicalElement[] = [
  ...geneticMaterial,
  ...rnaElements,
  ...proteinsEnzymes
]
