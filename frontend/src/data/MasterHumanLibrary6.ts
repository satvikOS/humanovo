// Master Human Library Part 6 - Elemental Matrix & Fluid Compartments
import { BiologicalElement, LibraryCategory } from './MasterHumanLibrary'

// Extended category type for elements
export type ExtendedCategory = LibraryCategory | 'elements' | 'fluid_compartments' | 'histology'

// ==================== BULK ELEMENTS (The Structural Six) ====================
export const bulkElements: BiologicalElement[] = [
  {
    id: 'element_oxygen',
    name: 'Oxygen (O)',
    category: 'inorganic_components',
    subcategory: 'Bulk Elements',
    description: 'Primary component of water and organic molecules; terminal electron acceptor in cellular respiration. Comprises ~65% of body mass, ~24% of atoms.',
    location: ['All tissues', 'Blood', 'Lungs', 'Water molecules'],
    functions: ['Cellular respiration', 'Water composition', 'Organic molecule structure', 'Oxidative metabolism'],
    interactions: ['Hemoglobin', 'Cytochrome oxidase', 'Reactive oxygen species'],
    diseaseLinks: ['Hypoxia', 'Ischemia', 'Oxidative stress', 'COPD'],
    drugTargets: ['Hypoxia-inducible factors', 'Antioxidants'],
    simulationParams: { baselineValue: 65, minValue: 60, maxValue: 70, unit: '% body mass' },
    aiSimulationReady: true
  },
  {
    id: 'element_carbon',
    name: 'Carbon (C)',
    category: 'inorganic_components',
    subcategory: 'Bulk Elements',
    description: 'Structural backbone of all organic chemistry; forms tetravalent bonds allowing complex polymers. Comprises ~18.5% of body mass.',
    location: ['All organic molecules', 'All tissues'],
    functions: ['Organic molecule backbone', 'Protein structure', 'Lipid structure', 'Carbohydrate structure'],
    interactions: ['All organic biomolecules', 'CO2 transport'],
    diseaseLinks: ['Carbon monoxide poisoning', 'Metabolic disorders'],
    drugTargets: ['Carbon-based drug scaffolds'],
    simulationParams: { baselineValue: 18.5, minValue: 16, maxValue: 21, unit: '% body mass' },
    aiSimulationReady: true
  },
  {
    id: 'element_hydrogen',
    name: 'Hydrogen (H)',
    category: 'inorganic_components',
    subcategory: 'Bulk Elements',
    description: 'Most abundant atom by count (~62%); determines pH (H+); component of water and all organics. ~9.5% of body mass.',
    location: ['Water', 'All organic molecules', 'Proton gradients'],
    functions: ['pH regulation', 'Water composition', 'Proton gradient energy', 'Hydrogen bonding'],
    interactions: ['H+ ATPase', 'Proton pumps', 'Acid-base buffers'],
    diseaseLinks: ['Acidosis', 'Alkalosis', 'Dehydration'],
    drugTargets: ['Proton pump inhibitors', 'pH modulators'],
    simulationParams: { baselineValue: 9.5, minValue: 8, maxValue: 11, unit: '% body mass' },
    aiSimulationReady: true
  },
  {
    id: 'element_nitrogen',
    name: 'Nitrogen (N)',
    category: 'inorganic_components',
    subcategory: 'Bulk Elements',
    description: 'Fundamental to amino acids (proteins) and nucleic acids (DNA/RNA). Comprises ~3.2% of body mass.',
    location: ['Amino acids', 'Proteins', 'Nucleic acids', 'Urea'],
    functions: ['Protein structure', 'DNA/RNA bases', 'Neurotransmitter synthesis', 'Nitrogen balance'],
    interactions: ['Amino acid metabolism', 'Urea cycle', 'Nucleotide synthesis'],
    diseaseLinks: ['Protein malnutrition', 'Urea cycle disorders', 'Ammonia toxicity'],
    drugTargets: ['Nitrogen metabolism enzymes'],
    simulationParams: { baselineValue: 3.2, minValue: 2.5, maxValue: 4, unit: '% body mass' },
    aiSimulationReady: true
  },
  {
    id: 'element_calcium',
    name: 'Calcium (Ca)',
    category: 'inorganic_components',
    subcategory: 'Bulk Elements',
    description: 'Structural integrity of hydroxyapatite in bone/teeth; vital signaling ion for muscle contraction and exocytosis. ~1.5% body mass.',
    location: ['Bones', 'Teeth', 'Blood', 'Intracellular stores'],
    functions: ['Bone structure', 'Muscle contraction', 'Nerve transmission', 'Blood clotting', 'Second messenger'],
    interactions: ['Calmodulin', 'Troponin', 'Voltage-gated Ca channels', 'PTH', 'Vitamin D'],
    diseaseLinks: ['Osteoporosis', 'Hypocalcemia', 'Hypercalcemia', 'Kidney stones'],
    drugTargets: ['Calcium channel blockers', 'Bisphosphonates', 'Vitamin D analogs'],
    simulationParams: { baselineValue: 9.5, minValue: 8.5, maxValue: 10.5, unit: 'mg/dL blood' },
    aiSimulationReady: true
  },
  {
    id: 'element_phosphorus',
    name: 'Phosphorus (P)',
    category: 'inorganic_components',
    subcategory: 'Bulk Elements',
    description: 'Backbone of nucleic acids; high-energy bonds in ATP; phospholipid bilayers. ~1% body mass.',
    location: ['Bones', 'Teeth', 'ATP', 'DNA/RNA', 'Cell membranes'],
    functions: ['ATP energy bonds', 'DNA/RNA backbone', 'Phospholipid structure', 'Bone mineralization', 'Buffer system'],
    interactions: ['ATP synthase', 'Kinases', 'Phosphatases', 'PTH'],
    diseaseLinks: ['Hypophosphatemia', 'Hyperphosphatemia', 'Rickets', 'Renal failure'],
    drugTargets: ['Phosphate binders', 'Vitamin D analogs'],
    simulationParams: { baselineValue: 3.5, minValue: 2.5, maxValue: 4.5, unit: 'mg/dL blood' },
    aiSimulationReady: true
  }
]

// ==================== ELECTROLYTIC ELEMENTS ====================
export const electrolyticElements: BiologicalElement[] = [
  {
    id: 'element_potassium',
    name: 'Potassium (K+)',
    category: 'inorganic_components',
    subcategory: 'Electrolytes',
    description: 'Dominant intracellular cation (~0.4% mass). Establishes resting membrane potential; crucial for repolarization after action potentials.',
    location: ['Intracellular fluid', 'All cells', 'Muscle', 'Nerve'],
    functions: ['Resting membrane potential', 'Action potential repolarization', 'Enzyme cofactor', 'Protein synthesis'],
    interactions: ['Na+/K+ ATPase', 'K+ channels', 'Aldosterone', 'Insulin'],
    diseaseLinks: ['Hypokalemia', 'Hyperkalemia', 'Cardiac arrhythmias', 'Muscle weakness'],
    drugTargets: ['Potassium-sparing diuretics', 'K+ channel modulators'],
    simulationParams: { baselineValue: 4.0, minValue: 3.5, maxValue: 5.0, unit: 'mEq/L blood' },
    aiSimulationReady: true
  },
  {
    id: 'element_sulfur',
    name: 'Sulfur (S)',
    category: 'inorganic_components',
    subcategory: 'Electrolytes',
    description: 'Integrated into cysteine and methionine; forms disulfide bridges stabilizing protein tertiary structure. ~0.3% body mass.',
    location: ['Proteins', 'Amino acids', 'Glutathione', 'Coenzyme A'],
    functions: ['Disulfide bonds', 'Protein structure', 'Antioxidant (glutathione)', 'Detoxification'],
    interactions: ['Cysteine', 'Methionine', 'Glutathione', 'Sulfotransferases'],
    diseaseLinks: ['Homocystinuria', 'Sulfite oxidase deficiency', 'Oxidative stress'],
    drugTargets: ['Sulfur-containing drugs (sulfonamides)'],
    simulationParams: { baselineValue: 0.3, minValue: 0.2, maxValue: 0.4, unit: '% body mass' },
    aiSimulationReady: true
  },
  {
    id: 'element_sodium',
    name: 'Sodium (Na+)',
    category: 'inorganic_components',
    subcategory: 'Electrolytes',
    description: 'Dominant extracellular cation (~0.2% mass). Drives depolarization in excitable tissues; regulates blood volume via osmotic pressure.',
    location: ['Extracellular fluid', 'Blood', 'Interstitial fluid'],
    functions: ['Action potential depolarization', 'Osmotic pressure', 'Blood volume regulation', 'Nutrient co-transport'],
    interactions: ['Na+/K+ ATPase', 'Na+ channels', 'SGLT transporters', 'Aldosterone', 'ANP'],
    diseaseLinks: ['Hyponatremia', 'Hypernatremia', 'Hypertension', 'Heart failure'],
    drugTargets: ['Diuretics', 'Na+ channel blockers', 'SGLT2 inhibitors'],
    simulationParams: { baselineValue: 140, minValue: 135, maxValue: 145, unit: 'mEq/L blood' },
    aiSimulationReady: true
  },
  {
    id: 'element_chlorine',
    name: 'Chloride (Cl-)',
    category: 'inorganic_components',
    subcategory: 'Electrolytes',
    description: 'Primary extracellular anion (~0.2% mass). Balances cations for electrical neutrality; forms gastric HCl for digestion.',
    location: ['Extracellular fluid', 'Stomach', 'Blood'],
    functions: ['Electrical neutrality', 'Gastric acid production', 'Chloride shift (CO2 transport)', 'GABA-A receptor function'],
    interactions: ['Cl- channels', 'CFTR', 'Parietal cells', 'GABA receptors'],
    diseaseLinks: ['Cystic fibrosis', 'Metabolic alkalosis', 'Hypochloremia'],
    drugTargets: ['CFTR modulators', 'Loop diuretics'],
    simulationParams: { baselineValue: 102, minValue: 96, maxValue: 106, unit: 'mEq/L blood' },
    aiSimulationReady: true
  },
  {
    id: 'element_magnesium',
    name: 'Magnesium (Mg2+)',
    category: 'inorganic_components',
    subcategory: 'Electrolytes',
    description: 'Critical cofactor for >300 enzymatic reactions including ATP synthesis and nucleic acid stabilization. ~0.1% body mass.',
    location: ['Bones', 'Intracellular', 'Blood', 'Muscle'],
    functions: ['ATP-Mg complex', 'Enzyme cofactor', 'DNA/RNA stabilization', 'Calcium channel blocking', 'Muscle relaxation'],
    interactions: ['ATP', 'DNA polymerase', 'RNA polymerase', 'Calcium channels'],
    diseaseLinks: ['Hypomagnesemia', 'Arrhythmias', 'Seizures', 'Osteoporosis'],
    drugTargets: ['Magnesium supplements', 'Mg2+ channel modulators'],
    simulationParams: { baselineValue: 2.0, minValue: 1.5, maxValue: 2.5, unit: 'mg/dL blood' },
    aiSimulationReady: true
  }
]

// ==================== TRACE ELEMENTS ====================
export const traceElements: BiologicalElement[] = [
  {
    id: 'element_iron',
    name: 'Iron (Fe)',
    category: 'inorganic_components',
    subcategory: 'Trace Elements',
    description: 'Core of heme group in hemoglobin/myoglobin for oxygen transport; critical for cytochrome enzymes in electron transport.',
    location: ['Hemoglobin', 'Myoglobin', 'Cytochromes', 'Liver (ferritin)'],
    functions: ['Oxygen transport', 'Electron transport chain', 'DNA synthesis', 'Energy metabolism'],
    interactions: ['Transferrin', 'Ferritin', 'Hepcidin', 'DMT1'],
    diseaseLinks: ['Iron deficiency anemia', 'Hemochromatosis', 'Anemia of chronic disease'],
    drugTargets: ['Iron supplements', 'Iron chelators', 'Hepcidin modulators'],
    simulationParams: { baselineValue: 100, minValue: 60, maxValue: 170, unit: 'μg/dL serum' },
    aiSimulationReady: true
  },
  {
    id: 'element_zinc',
    name: 'Zinc (Zn)',
    category: 'inorganic_components',
    subcategory: 'Trace Elements',
    description: 'Cofactor for >300 enzymes (polymerases, proteases); essential for DNA synthesis, wound healing, and sperm production.',
    location: ['All tissues', 'Prostate', 'Immune cells', 'Bone'],
    functions: ['Enzyme cofactor', 'DNA/RNA synthesis', 'Wound healing', 'Immune function', 'Taste/smell'],
    interactions: ['Zinc finger proteins', 'SOD', 'Metallothionein', 'ZIP transporters'],
    diseaseLinks: ['Zinc deficiency', 'Acrodermatitis enteropathica', 'Impaired immunity', 'Growth retardation'],
    drugTargets: ['Zinc supplements', 'Zinc lozenges'],
    simulationParams: { baselineValue: 85, minValue: 60, maxValue: 120, unit: 'μg/dL serum' },
    aiSimulationReady: true
  },
  {
    id: 'element_copper',
    name: 'Copper (Cu)',
    category: 'inorganic_components',
    subcategory: 'Trace Elements',
    description: 'Component of cytochrome c oxidase; involved in iron metabolism (ceruloplasmin) and collagen cross-linking (lysyl oxidase).',
    location: ['Liver', 'Brain', 'Connective tissue', 'Blood'],
    functions: ['Electron transport', 'Iron metabolism', 'Collagen cross-linking', 'Neurotransmitter synthesis', 'Antioxidant (SOD)'],
    interactions: ['Ceruloplasmin', 'Cytochrome c oxidase', 'Lysyl oxidase', 'ATP7A/B'],
    diseaseLinks: ['Wilson disease', 'Menkes disease', 'Copper deficiency anemia'],
    drugTargets: ['Copper chelators (penicillamine)', 'Zinc (reduces absorption)'],
    simulationParams: { baselineValue: 110, minValue: 70, maxValue: 150, unit: 'μg/dL serum' },
    aiSimulationReady: true
  },
  {
    id: 'element_iodine',
    name: 'Iodine (I)',
    category: 'inorganic_components',
    subcategory: 'Trace Elements',
    description: 'Exclusive function in thyroid hormones (T3/T4) which regulate basal metabolic rate.',
    location: ['Thyroid gland', 'Blood'],
    functions: ['Thyroid hormone synthesis (T3, T4)', 'Metabolic rate regulation', 'Growth and development'],
    interactions: ['Thyroglobulin', 'TPO', 'NIS (sodium-iodide symporter)', 'Deiodinases'],
    diseaseLinks: ['Goiter', 'Hypothyroidism', 'Cretinism', 'Hyperthyroidism'],
    drugTargets: ['Iodine supplements', 'Radioactive iodine', 'Antithyroid drugs'],
    simulationParams: { baselineValue: 150, minValue: 100, maxValue: 200, unit: 'μg/day intake' },
    aiSimulationReady: true
  },
  {
    id: 'element_manganese',
    name: 'Manganese (Mn)',
    category: 'inorganic_components',
    subcategory: 'Trace Elements',
    description: 'Cofactor for superoxide dismutase (MnSOD, antioxidant) and enzymes in urea cycle and connective tissue synthesis.',
    location: ['Bone', 'Liver', 'Pancreas', 'Mitochondria'],
    functions: ['Antioxidant (MnSOD)', 'Bone formation', 'Carbohydrate metabolism', 'Urea cycle'],
    interactions: ['MnSOD', 'Arginase', 'Glycosyltransferases', 'Pyruvate carboxylase'],
    diseaseLinks: ['Manganese deficiency', 'Manganism (toxicity)', 'Osteoporosis'],
    drugTargets: ['Manganese supplements'],
    simulationParams: { baselineValue: 1.0, minValue: 0.5, maxValue: 1.5, unit: 'μg/L blood' },
    aiSimulationReady: true
  },
  {
    id: 'element_selenium',
    name: 'Selenium (Se)',
    category: 'inorganic_components',
    subcategory: 'Trace Elements',
    description: 'Integral to glutathione peroxidase (antioxidant) and deiodinase enzymes (thyroid hormone conversion).',
    location: ['Thyroid', 'Liver', 'Muscle', 'Testes'],
    functions: ['Antioxidant (GPx)', 'Thyroid hormone metabolism', 'Immune function', 'Sperm function'],
    interactions: ['Selenoproteins', 'Glutathione peroxidase', 'Deiodinases', 'Thioredoxin reductase'],
    diseaseLinks: ['Keshan disease', 'Kashin-Beck disease', 'Thyroid disorders', 'Cancer risk'],
    drugTargets: ['Selenium supplements', 'Selenomethionine'],
    simulationParams: { baselineValue: 120, minValue: 70, maxValue: 150, unit: 'μg/L serum' },
    aiSimulationReady: true
  },
  {
    id: 'element_molybdenum',
    name: 'Molybdenum (Mo)',
    category: 'inorganic_components',
    subcategory: 'Trace Elements',
    description: 'Cofactor for xanthine oxidase, sulfite oxidase, and aldehyde oxidase; essential for sulfur amino acid metabolism.',
    location: ['Liver', 'Kidney', 'Bone'],
    functions: ['Purine metabolism', 'Sulfite detoxification', 'Drug metabolism', 'Uric acid production'],
    interactions: ['Xanthine oxidase', 'Sulfite oxidase', 'Aldehyde oxidase', 'Molybdopterin'],
    diseaseLinks: ['Molybdenum cofactor deficiency', 'Sulfite intolerance'],
    drugTargets: ['Xanthine oxidase inhibitors'],
    simulationParams: { baselineValue: 0.5, minValue: 0.1, maxValue: 1.0, unit: 'μg/L serum' },
    aiSimulationReady: true
  },
  {
    id: 'element_chromium',
    name: 'Chromium (Cr)',
    category: 'inorganic_components',
    subcategory: 'Trace Elements',
    description: 'Potentiates insulin action; involved in glucose and lipid metabolism through chromodulin complex.',
    location: ['Liver', 'Spleen', 'Bone', 'Muscle'],
    functions: ['Insulin potentiation', 'Glucose metabolism', 'Lipid metabolism', 'Protein metabolism'],
    interactions: ['Chromodulin', 'Insulin receptor', 'Transferrin'],
    diseaseLinks: ['Glucose intolerance', 'Type 2 diabetes risk', 'Chromium deficiency'],
    drugTargets: ['Chromium picolinate supplements'],
    simulationParams: { baselineValue: 0.3, minValue: 0.1, maxValue: 0.5, unit: 'μg/L serum' },
    aiSimulationReady: true
  },
  {
    id: 'element_cobalt',
    name: 'Cobalt (Co)',
    category: 'inorganic_components',
    subcategory: 'Trace Elements',
    description: 'Central atom of Vitamin B12 (Cobalamin); essential for erythropoiesis and myelin synthesis.',
    location: ['Liver', 'Blood', 'Bone marrow'],
    functions: ['Vitamin B12 component', 'Red blood cell production', 'Myelin synthesis', 'DNA synthesis'],
    interactions: ['Vitamin B12', 'Intrinsic factor', 'Methylmalonyl-CoA mutase'],
    diseaseLinks: ['B12 deficiency', 'Pernicious anemia', 'Neuropathy'],
    drugTargets: ['Vitamin B12 supplements'],
    simulationParams: { baselineValue: 0.5, minValue: 0.2, maxValue: 1.0, unit: 'μg/L serum' },
    aiSimulationReady: true
  },
  {
    id: 'element_fluorine',
    name: 'Fluoride (F)',
    category: 'inorganic_components',
    subcategory: 'Trace Elements',
    description: 'Incorporated into dental enamel and bone as fluoroapatite, increasing hardness and caries resistance.',
    location: ['Teeth', 'Bone'],
    functions: ['Tooth enamel hardening', 'Bone mineralization', 'Caries prevention'],
    interactions: ['Hydroxyapatite', 'Enamel proteins'],
    diseaseLinks: ['Dental caries', 'Fluorosis (excess)', 'Osteoporosis'],
    drugTargets: ['Fluoride toothpaste', 'Fluoride supplements'],
    simulationParams: { baselineValue: 0.02, minValue: 0.01, maxValue: 0.05, unit: 'mg/L serum' },
    aiSimulationReady: true
  }
]

// ==================== FLUID COMPARTMENTS ====================
export const fluidCompartments: BiologicalElement[] = [
  {
    id: 'fluid_icf',
    name: 'Intracellular Fluid (ICF)',
    category: 'inorganic_components',
    subcategory: 'Fluid Compartments',
    description: 'Cytosol comprising ~40% body weight, rich in K+, Mg2+, phosphates, and proteins.',
    location: ['Inside all cells'],
    functions: ['Metabolic reactions', 'Protein synthesis', 'Ion homeostasis'],
    interactions: ['Ion pumps', 'Organelles', 'Cytoskeleton'],
    diseaseLinks: ['Cell swelling', 'Dehydration', 'Electrolyte imbalance'],
    drugTargets: ['Ion channel modulators'],
    simulationParams: { baselineValue: 28, minValue: 25, maxValue: 32, unit: 'L total volume' },
    aiSimulationReady: true
  },
  {
    id: 'fluid_plasma',
    name: 'Blood Plasma',
    category: 'inorganic_components',
    subcategory: 'Fluid Compartments',
    description: 'Liquid fraction of blood (~3L), rich in Na+, Cl-, plasma proteins (albumin, globulins, fibrinogen).',
    location: ['Blood vessels'],
    functions: ['Nutrient transport', 'Waste removal', 'Hormone transport', 'Immune function', 'Clotting'],
    interactions: ['Albumin', 'Globulins', 'Fibrinogen', 'Blood cells'],
    diseaseLinks: ['Hypovolemia', 'Edema', 'Hypoalbuminemia'],
    drugTargets: ['Volume expanders', 'Albumin infusion'],
    simulationParams: { baselineValue: 3, minValue: 2.5, maxValue: 3.5, unit: 'L volume' },
    aiSimulationReady: true
  },
  {
    id: 'fluid_interstitial',
    name: 'Interstitial Fluid (IF)',
    category: 'inorganic_components',
    subcategory: 'Fluid Compartments',
    description: 'Fluid surrounding cells (~11L), lower protein content than plasma, facilitates nutrient/waste exchange.',
    location: ['Between cells', 'Tissue spaces'],
    functions: ['Cell-capillary exchange', 'Immune cell trafficking', 'Lymph formation'],
    interactions: ['Capillary walls', 'Lymphatics', 'Extracellular matrix'],
    diseaseLinks: ['Edema', 'Lymphedema', 'Third spacing'],
    drugTargets: ['Diuretics', 'Lymphatic modulators'],
    simulationParams: { baselineValue: 11, minValue: 9, maxValue: 14, unit: 'L volume' },
    aiSimulationReady: true
  },
  {
    id: 'fluid_csf',
    name: 'Cerebrospinal Fluid (CSF)',
    category: 'inorganic_components',
    subcategory: 'Transcellular Fluids',
    description: 'Clear fluid (~150mL) cushioning brain/spinal cord, produced by choroid plexus, drains via arachnoid granulations.',
    location: ['Ventricles', 'Subarachnoid space', 'Central canal'],
    functions: ['Brain cushioning', 'Nutrient delivery', 'Waste removal', 'Intracranial pressure regulation'],
    interactions: ['Choroid plexus', 'Blood-brain barrier', 'Arachnoid granulations'],
    diseaseLinks: ['Hydrocephalus', 'Meningitis', 'Intracranial hypertension'],
    drugTargets: ['Acetazolamide', 'Shunt systems'],
    simulationParams: { baselineValue: 150, minValue: 100, maxValue: 200, unit: 'mL volume' },
    aiSimulationReady: true
  },
  {
    id: 'fluid_synovial',
    name: 'Synovial Fluid',
    category: 'inorganic_components',
    subcategory: 'Transcellular Fluids',
    description: 'Viscous fluid in joint cavities containing hyaluronic acid for lubrication and cartilage nutrition.',
    location: ['Synovial joints', 'Bursae', 'Tendon sheaths'],
    functions: ['Joint lubrication', 'Cartilage nutrition', 'Shock absorption'],
    interactions: ['Hyaluronic acid', 'Lubricin', 'Synoviocytes'],
    diseaseLinks: ['Osteoarthritis', 'Rheumatoid arthritis', 'Gout', 'Septic arthritis'],
    drugTargets: ['Hyaluronic acid injections', 'Corticosteroids'],
    simulationParams: { baselineValue: 3, minValue: 0.5, maxValue: 5, unit: 'mL per joint' },
    aiSimulationReady: true
  },
  {
    id: 'fluid_aqueous_humor',
    name: 'Aqueous Humor',
    category: 'inorganic_components',
    subcategory: 'Transcellular Fluids',
    description: 'Clear fluid in anterior chamber of eye, produced by ciliary body, drains via Canal of Schlemm.',
    location: ['Anterior chamber', 'Posterior chamber (eye)'],
    functions: ['Intraocular pressure maintenance', 'Cornea/lens nutrition', 'Waste removal'],
    interactions: ['Ciliary body', 'Canal of Schlemm', 'Trabecular meshwork'],
    diseaseLinks: ['Glaucoma', 'Uveitis', 'Hypotony'],
    drugTargets: ['Prostaglandin analogs', 'Beta-blockers', 'Carbonic anhydrase inhibitors'],
    simulationParams: { baselineValue: 15, minValue: 10, maxValue: 21, unit: 'mmHg IOP' },
    aiSimulationReady: true
  },
  {
    id: 'fluid_vitreous_humor',
    name: 'Vitreous Humor',
    category: 'inorganic_components',
    subcategory: 'Transcellular Fluids',
    description: 'Gel-like substance (~4mL) filling posterior eye chamber, composed of water, collagen, and hyaluronic acid.',
    location: ['Posterior chamber of eye'],
    functions: ['Eye shape maintenance', 'Light transmission', 'Retina support'],
    interactions: ['Retina', 'Lens', 'Collagen fibrils'],
    diseaseLinks: ['Vitreous detachment', 'Floaters', 'Retinal detachment'],
    drugTargets: ['Anti-VEGF injections', 'Vitrectomy'],
    simulationParams: { baselineValue: 4, minValue: 3.5, maxValue: 4.5, unit: 'mL volume' },
    aiSimulationReady: true
  },
  {
    id: 'fluid_pleural',
    name: 'Pleural Fluid',
    category: 'inorganic_components',
    subcategory: 'Transcellular Fluids',
    description: 'Thin layer of fluid (~15mL) between visceral and parietal pleura, enabling frictionless lung expansion.',
    location: ['Pleural cavity'],
    functions: ['Lung lubrication', 'Surface tension maintenance', 'Pleural adhesion'],
    interactions: ['Mesothelial cells', 'Lymphatics'],
    diseaseLinks: ['Pleural effusion', 'Pneumothorax', 'Empyema', 'Mesothelioma'],
    drugTargets: ['Thoracentesis', 'Pleurodesis agents'],
    simulationParams: { baselineValue: 15, minValue: 5, maxValue: 25, unit: 'mL volume' },
    aiSimulationReady: true
  },
  {
    id: 'fluid_pericardial',
    name: 'Pericardial Fluid',
    category: 'inorganic_components',
    subcategory: 'Transcellular Fluids',
    description: 'Fluid (~25mL) in pericardial sac surrounding heart, reducing friction during cardiac contractions.',
    location: ['Pericardial cavity'],
    functions: ['Heart lubrication', 'Cardiac protection', 'Friction reduction'],
    interactions: ['Pericardium', 'Epicardium', 'Mesothelial cells'],
    diseaseLinks: ['Pericardial effusion', 'Cardiac tamponade', 'Pericarditis'],
    drugTargets: ['Pericardiocentesis', 'NSAIDs', 'Colchicine'],
    simulationParams: { baselineValue: 25, minValue: 15, maxValue: 50, unit: 'mL volume' },
    aiSimulationReady: true
  },
  {
    id: 'fluid_peritoneal',
    name: 'Peritoneal Fluid',
    category: 'inorganic_components',
    subcategory: 'Transcellular Fluids',
    description: 'Fluid (~50mL) in peritoneal cavity lubricating abdominal organs.',
    location: ['Peritoneal cavity'],
    functions: ['Organ lubrication', 'Immune surveillance', 'Fluid balance'],
    interactions: ['Peritoneum', 'Mesentery', 'Omentum'],
    diseaseLinks: ['Ascites', 'Peritonitis', 'Ovarian cancer'],
    drugTargets: ['Paracentesis', 'Diuretics', 'Albumin'],
    simulationParams: { baselineValue: 50, minValue: 20, maxValue: 100, unit: 'mL volume' },
    aiSimulationReady: true
  }
]

// Combine all elements
export const allElementsAndFluids: BiologicalElement[] = [
  ...bulkElements,
  ...electrolyticElements,
  ...traceElements,
  ...fluidCompartments
]
