// Master Human Library - Complete Index with Tree Structure
// For Multi-AI Agent Simulation to optimize cure/prevention scores

import { BiologicalElement, geneticMaterial, rnaElements, proteinsEnzymes } from './MasterHumanLibrary'
export type { BiologicalElement }
import { organicMolecules, inorganicComponents, organelles } from './MasterHumanLibrary2'
import { cellTypes } from './MasterHumanLibrary3'
import { tissues, organs, organSystems } from './MasterHumanLibrary4'
import { metabolicPathways, signalingPathways } from './MasterHumanLibrary5'
import { bulkElements, electrolyticElements, traceElements, fluidCompartments, allElementsAndFluids } from './MasterHumanLibrary6'
import { ectodermalCells, mesodermalCells, endodermalCells, extendedCellOntology } from './MasterHumanLibrary7'
import { completeSkeleton, neurocranium, viscerocranium, auditoryOssicles, vertebralColumn, thoracicCage, pectoralGirdle, upperLimb, pelvicGirdle, lowerLimb } from './MasterHumanLibrary8'
import { completeMuscularSystem, headNeckMuscles, thoraxAbdomenMuscles, upperLimbMuscles, lowerLimbMuscles } from './MasterHumanLibrary9'
import { cranialNerves, spinalPlexuses, epithelialTissues, connectiveTissues, muscleTissues, nervousTissues, allNervousSystemDetails, allHistologicalTissues, allLibrary10Elements } from './MasterHumanLibrary10'

// ==================== TREE STRUCTURE FOR NAVIGATION ====================
export interface LibraryTreeNode {
  id: string
  name: string
  type: 'category' | 'subcategory' | 'element'
  description?: string
  children?: LibraryTreeNode[]
  elementCount?: number
  icon?: string
  color?: string
}

// Complete library combining all elements
export const allBiologicalElements: BiologicalElement[] = [
  ...geneticMaterial,
  ...rnaElements,
  ...proteinsEnzymes,
  ...organicMolecules,
  ...inorganicComponents,
  ...organelles,
  ...cellTypes,
  ...tissues,
  ...organs,
  ...organSystems,
  ...metabolicPathways,
  ...signalingPathways,
  // Library 6 - Elemental Matrix & Fluids
  ...allElementsAndFluids,
  // Library 7 - Extended Cell Ontology by Germ Layer
  ...extendedCellOntology,
  // Library 8 - Complete Skeletal System (206 bones)
  ...completeSkeleton,
  // Library 9 - Myological System (muscles)
  ...completeMuscularSystem,
  // Library 10 - Nervous System Details & Histological Tissues
  ...allLibrary10Elements
]

// Library statistics
export const libraryStats = {
  totalElements: allBiologicalElements.length,
  categories: 18,
  // Library 1 - Core Molecular
  geneticElements: geneticMaterial.length,
  rnaElements: rnaElements.length,
  proteins: proteinsEnzymes.length,
  // Library 2 - Chemical Components
  organicMolecules: organicMolecules.length,
  inorganicComponents: inorganicComponents.length,
  organelles: organelles.length,
  // Library 3 - Cell Types
  cellTypes: cellTypes.length,
  // Library 4 - Tissues & Organs
  tissues: tissues.length,
  organs: organs.length,
  organSystems: organSystems.length,
  // Library 5 - Pathways
  metabolicPathways: metabolicPathways.length,
  signalingPathways: signalingPathways.length,
  // Library 6 - Elemental Matrix
  bulkElements: bulkElements.length,
  electrolyticElements: electrolyticElements.length,
  traceElements: traceElements.length,
  fluidCompartments: fluidCompartments.length,
  // Library 7 - Extended Cell Ontology
  ectodermalCells: ectodermalCells.length,
  mesodermalCells: mesodermalCells.length,
  endodermalCells: endodermalCells.length,
  // Library 8 - Skeletal System
  skeletalBones: completeSkeleton.length,
  // Library 9 - Muscular System
  muscles: completeMuscularSystem.length,
  // Library 10 - Nervous System & Histology
  cranialNerves: cranialNerves.length,
  spinalPlexuses: spinalPlexuses.length,
  epithelialTissues: epithelialTissues.length,
  connectiveTissues: connectiveTissues.length,
  muscleTissues: muscleTissues.length,
  nervousTissues: nervousTissues.length,
  // AI Simulation Ready
  aiSimulationReady: allBiologicalElements.filter(e => e.aiSimulationReady).length
}

// Tree structure for hierarchical navigation
export const masterLibraryTree: LibraryTreeNode[] = [
  {
    id: 'molecular_level',
    name: '🧬 Molecular Level',
    type: 'category',
    description: 'Fundamental molecular components of life',
    color: '#8B5CF6',
    children: [
      {
        id: 'genetic_material',
        name: 'Genetic Material',
        type: 'subcategory',
        icon: '🧬',
        description: 'DNA, genes, chromosomes, and epigenetic elements',
        elementCount: geneticMaterial.length,
        children: [
          { id: 'chromosomal_dna', name: 'Chromosomal DNA', type: 'subcategory', children: geneticMaterial.filter(e => e.subcategory === 'Chromosomal DNA').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'organelle_dna', name: 'Organelle DNA', type: 'subcategory', children: geneticMaterial.filter(e => e.subcategory === 'Organelle DNA').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'chromosome_structure', name: 'Chromosome Structure', type: 'subcategory', children: geneticMaterial.filter(e => e.subcategory === 'Chromosome Structure').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'genes', name: 'Genes', type: 'subcategory', children: geneticMaterial.filter(e => e.subcategory === 'Genes').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'chromatin_proteins', name: 'Chromatin Proteins', type: 'subcategory', children: geneticMaterial.filter(e => e.subcategory === 'Chromatin Proteins').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'epigenetics', name: 'Epigenetics', type: 'subcategory', children: geneticMaterial.filter(e => e.subcategory === 'Epigenetics').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      },
      {
        id: 'rna_expression',
        name: 'RNA & Gene Expression',
        type: 'subcategory',
        icon: '📜',
        description: 'All types of RNA and gene expression machinery',
        elementCount: rnaElements.length,
        children: [
          { id: 'coding_rna', name: 'Coding RNA', type: 'subcategory', children: rnaElements.filter(e => e.subcategory === 'Coding RNA').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'structural_rna', name: 'Structural RNA', type: 'subcategory', children: rnaElements.filter(e => e.subcategory === 'Structural RNA').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'adapter_rna', name: 'Adapter RNA', type: 'subcategory', children: rnaElements.filter(e => e.subcategory === 'Adapter RNA').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'regulatory_rna', name: 'Regulatory RNA', type: 'subcategory', children: rnaElements.filter(e => e.subcategory === 'Regulatory RNA').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'processing_rna', name: 'Processing RNA', type: 'subcategory', children: rnaElements.filter(e => e.subcategory === 'Processing RNA').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      },
      {
        id: 'proteins_enzymes',
        name: 'Proteins & Enzymes',
        type: 'subcategory',
        icon: '🔧',
        description: 'Structural proteins, enzymes, and functional proteins',
        elementCount: proteinsEnzymes.length,
        children: [
          { id: 'structural_proteins', name: 'Structural Proteins', type: 'subcategory', children: proteinsEnzymes.filter(e => e.subcategory === 'Structural Proteins').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'contractile_proteins', name: 'Contractile Proteins', type: 'subcategory', children: proteinsEnzymes.filter(e => e.subcategory === 'Contractile Proteins').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'transport_proteins', name: 'Transport Proteins', type: 'subcategory', children: proteinsEnzymes.filter(e => e.subcategory === 'Transport Proteins').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'hormones_signaling', name: 'Hormones/Signaling', type: 'subcategory', children: proteinsEnzymes.filter(e => e.subcategory === 'Hormones/Signaling').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'immune_proteins', name: 'Immune Proteins', type: 'subcategory', children: proteinsEnzymes.filter(e => e.subcategory === 'Immune Proteins').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'enzymes', name: 'Enzymes', type: 'subcategory', children: proteinsEnzymes.filter(e => e.subcategory === 'Enzymes').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      }
    ]
  },
  {
    id: 'chemical_level',
    name: '⚗️ Chemical Level',
    type: 'category',
    description: 'Organic and inorganic chemical components',
    color: '#10B981',
    children: [
      {
        id: 'organic_molecules',
        name: 'Organic Molecules',
        type: 'subcategory',
        icon: '🧪',
        description: 'Carbohydrates, lipids, vitamins, neurotransmitters',
        elementCount: organicMolecules.length,
        children: [
          { id: 'carbohydrates_simple', name: 'Carbohydrates - Simple', type: 'subcategory', children: organicMolecules.filter(e => e.subcategory?.includes('Carbohydrates')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'nucleotides_energy', name: 'Nucleotides - Energy', type: 'subcategory', children: organicMolecules.filter(e => e.subcategory?.includes('Nucleotides')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'lipids', name: 'Lipids', type: 'subcategory', children: organicMolecules.filter(e => e.subcategory?.includes('Lipids')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'vitamins', name: 'Vitamins', type: 'subcategory', children: organicMolecules.filter(e => e.subcategory?.includes('Vitamins')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'neurotransmitters', name: 'Neurotransmitters', type: 'subcategory', children: organicMolecules.filter(e => e.subcategory?.includes('Neurotransmitters')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      },
      {
        id: 'inorganic_components',
        name: 'Inorganic Components',
        type: 'subcategory',
        icon: '💧',
        description: 'Water, electrolytes, minerals, trace elements, gases',
        elementCount: inorganicComponents.length,
        children: [
          { id: 'solvents', name: 'Solvents', type: 'subcategory', children: inorganicComponents.filter(e => e.subcategory === 'Solvents').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'electrolytes_major', name: 'Major Electrolytes', type: 'subcategory', children: inorganicComponents.filter(e => e.subcategory === 'Electrolytes - Major').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'trace_elements', name: 'Trace Elements', type: 'subcategory', children: inorganicComponents.filter(e => e.subcategory === 'Trace Elements').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'gases', name: 'Gases', type: 'subcategory', children: inorganicComponents.filter(e => e.subcategory === 'Gases').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      },
      {
        id: 'elemental_matrix',
        name: 'Elemental Matrix',
        type: 'subcategory',
        icon: '⚛️',
        description: 'Bulk elements, electrolytes, trace elements, and fluid compartments',
        elementCount: allElementsAndFluids.length,
        children: [
          { id: 'bulk_elements', name: 'Bulk Elements (O, C, H, N, Ca, P)', type: 'subcategory', children: bulkElements.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'electrolytic_elements', name: 'Electrolytic Elements (K, S, Na, Cl, Mg)', type: 'subcategory', children: electrolyticElements.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'trace_elements_extended', name: 'Trace Elements (Fe, Zn, Cu, I, Mn, Se, Mo, Cr, Co, F)', type: 'subcategory', children: traceElements.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'fluid_compartments', name: 'Fluid Compartments (ICF, ECF, Transcellular)', type: 'subcategory', children: fluidCompartments.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      }
    ]
  },
  {
    id: 'cellular_level',
    name: '🔬 Cellular Level',
    type: 'category',
    description: 'Cell structures and cell types',
    color: '#F59E0B',
    children: [
      {
        id: 'organelles',
        name: 'Organelles & Structures',
        type: 'subcategory',
        icon: '🏭',
        description: 'Intracellular organelles and structures',
        elementCount: organelles.length,
        children: [
          { id: 'membrane_bound', name: 'Membrane-Bound', type: 'subcategory', children: organelles.filter(e => e.subcategory === 'Membrane-Bound').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'non_membrane', name: 'Non-Membrane', type: 'subcategory', children: organelles.filter(e => e.subcategory === 'Non-Membrane').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'nuclear_substructure', name: 'Nuclear Substructures', type: 'subcategory', children: organelles.filter(e => e.subcategory === 'Nuclear Substructure').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'membranes', name: 'Membranes', type: 'subcategory', children: organelles.filter(e => e.subcategory === 'Membranes').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      },
      {
        id: 'cell_types',
        name: 'Cell Types (~200)',
        type: 'subcategory',
        icon: '🦠',
        description: 'All major human cell types',
        elementCount: cellTypes.length,
        children: [
          { id: 'blood_cells', name: 'Blood Cells', type: 'subcategory', children: cellTypes.filter(e => e.subcategory?.includes('Blood')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'muscle_cells', name: 'Muscle Cells', type: 'subcategory', children: cellTypes.filter(e => e.subcategory === 'Muscle Cells').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'nerve_cells', name: 'Nervous System Cells', type: 'subcategory', children: cellTypes.filter(e => e.subcategory?.includes('Nervous') || e.subcategory?.includes('Glial')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'epithelial_cells', name: 'Epithelial Cells', type: 'subcategory', children: cellTypes.filter(e => e.subcategory?.includes('Epithelial')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'connective_cells', name: 'Connective Tissue Cells', type: 'subcategory', children: cellTypes.filter(e => e.subcategory?.includes('Connective') || e.subcategory?.includes('Bone') || e.subcategory?.includes('Cartilage')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'immune_cells', name: 'Immune Cells', type: 'subcategory', children: cellTypes.filter(e => e.subcategory?.includes('Immune') || e.subcategory?.includes('Antigen')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'endocrine_cells', name: 'Endocrine Cells', type: 'subcategory', children: cellTypes.filter(e => e.subcategory === 'Endocrine Cells').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'stem_cells', name: 'Stem Cells', type: 'subcategory', children: cellTypes.filter(e => e.subcategory === 'Stem Cells').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'germ_cells', name: 'Germ Cells', type: 'subcategory', children: cellTypes.filter(e => e.subcategory === 'Germ Cells').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'sensory_cells', name: 'Sensory Cells', type: 'subcategory', children: cellTypes.filter(e => e.subcategory?.includes('Sensory')).map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      },
      {
        id: 'cell_ontology_germ_layer',
        name: 'Cell Ontology by Germ Layer',
        type: 'subcategory',
        icon: '🧬',
        description: 'Comprehensive cell types organized by embryonic origin',
        elementCount: extendedCellOntology.length,
        children: [
          { id: 'ectodermal_cells', name: 'Ectodermal Lineage', type: 'subcategory', children: ectodermalCells.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'mesodermal_cells', name: 'Mesodermal Lineage', type: 'subcategory', children: mesodermalCells.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'endodermal_cells', name: 'Endodermal Lineage', type: 'subcategory', children: endodermalCells.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      }
    ]
  },
  {
    id: 'tissue_level',
    name: '🧫 Tissue Level',
    type: 'category',
    description: 'Four fundamental tissue types',
    color: '#EC4899',
    children: [
      {
        id: 'tissues',
        name: 'Tissue Types',
        type: 'subcategory',
        icon: '🧫',
        description: 'Epithelial, connective, muscle, and nervous tissues',
        elementCount: tissues.length,
        children: [
          { id: 'epithelial_tissue', name: 'Epithelial Tissue', type: 'subcategory', children: tissues.filter(e => e.subcategory === 'Epithelial Tissue').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'connective_tissue', name: 'Connective Tissue', type: 'subcategory', children: tissues.filter(e => e.subcategory === 'Connective Tissue').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'muscle_tissue', name: 'Muscle Tissue', type: 'subcategory', children: tissues.filter(e => e.subcategory === 'Muscle Tissue').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'nervous_tissue', name: 'Nervous Tissue', type: 'subcategory', children: tissues.filter(e => e.subcategory === 'Nervous Tissue').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      }
    ]
  },
  {
    id: 'organ_level',
    name: '🫀 Organ Level',
    type: 'category',
    description: 'Major organs and organ systems',
    color: '#EF4444',
    children: [
      {
        id: 'organs',
        name: 'Organs (~78)',
        type: 'subcategory',
        icon: '🫀',
        description: 'Major organs of the human body',
        elementCount: organs.length,
        children: organs.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      },
      {
        id: 'organ_systems',
        name: 'Organ Systems (11)',
        type: 'subcategory',
        icon: '🏥',
        description: 'Complete organ system organization',
        elementCount: organSystems.length,
        children: organSystems.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      }
    ]
  },
  {
    id: 'skeletal_system',
    name: '🦴 Skeletal System (206 Bones)',
    type: 'category',
    description: 'Complete skeletal system including axial and appendicular skeleton',
    color: '#F5F5DC',
    children: [
      {
        id: 'axial_skeleton',
        name: 'Axial Skeleton (80 bones)',
        type: 'subcategory',
        icon: '🦴',
        description: 'Skull, vertebral column, and thoracic cage',
        elementCount: neurocranium.length + viscerocranium.length + auditoryOssicles.length + vertebralColumn.length + thoracicCage.length,
        children: [
          { id: 'neurocranium', name: 'Neurocranium (8)', type: 'subcategory', children: neurocranium.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'viscerocranium', name: 'Viscerocranium (14)', type: 'subcategory', children: viscerocranium.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'auditory_ossicles', name: 'Auditory Ossicles (6)', type: 'subcategory', children: auditoryOssicles.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'vertebral_column', name: 'Vertebral Column (26)', type: 'subcategory', children: vertebralColumn.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'thoracic_cage', name: 'Thoracic Cage (25)', type: 'subcategory', children: thoracicCage.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      },
      {
        id: 'appendicular_skeleton',
        name: 'Appendicular Skeleton (126 bones)',
        type: 'subcategory',
        icon: '💪',
        description: 'Limb bones and girdles',
        elementCount: pectoralGirdle.length + upperLimb.length + pelvicGirdle.length + lowerLimb.length,
        children: [
          { id: 'pectoral_girdle', name: 'Pectoral Girdle (4)', type: 'subcategory', children: pectoralGirdle.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'upper_limb_bones', name: 'Upper Limb (60)', type: 'subcategory', children: upperLimb.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'pelvic_girdle', name: 'Pelvic Girdle (2)', type: 'subcategory', children: pelvicGirdle.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'lower_limb_bones', name: 'Lower Limb (60)', type: 'subcategory', children: lowerLimb.map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      }
    ]
  },
  {
    id: 'muscular_system',
    name: '💪 Muscular System',
    type: 'category',
    description: 'Major skeletal muscles of the human body',
    color: '#CD5C5C',
    children: [
      {
        id: 'head_neck_muscles',
        name: 'Head & Neck Muscles',
        type: 'subcategory',
        icon: '🗣️',
        description: 'Facial expression, mastication, and neck muscles',
        elementCount: headNeckMuscles.length,
        children: headNeckMuscles.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      },
      {
        id: 'thorax_abdomen_muscles',
        name: 'Thorax & Abdomen Muscles',
        type: 'subcategory',
        icon: '🫁',
        description: 'Respiratory and abdominal wall muscles',
        elementCount: thoraxAbdomenMuscles.length,
        children: thoraxAbdomenMuscles.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      },
      {
        id: 'upper_limb_muscles',
        name: 'Upper Limb Muscles',
        type: 'subcategory',
        icon: '💪',
        description: 'Shoulder, arm, and forearm muscles',
        elementCount: upperLimbMuscles.length,
        children: upperLimbMuscles.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      },
      {
        id: 'lower_limb_muscles',
        name: 'Lower Limb Muscles',
        type: 'subcategory',
        icon: '🦵',
        description: 'Hip, thigh, and leg muscles',
        elementCount: lowerLimbMuscles.length,
        children: lowerLimbMuscles.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      }
    ]
  },
  {
    id: 'nervous_system_details',
    name: '🧠 Nervous System Details',
    type: 'category',
    description: 'Cranial nerves and spinal plexuses',
    color: '#FFD700',
    children: [
      {
        id: 'cranial_nerves',
        name: 'Cranial Nerves (12 pairs)',
        type: 'subcategory',
        icon: '🧠',
        description: 'All 12 cranial nerve pairs with functions and pathology',
        elementCount: cranialNerves.length,
        children: cranialNerves.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      },
      {
        id: 'spinal_plexuses',
        name: 'Spinal Plexuses & Major Nerves',
        type: 'subcategory',
        icon: '⚡',
        description: 'Cervical, brachial, lumbar, and sacral plexuses',
        elementCount: spinalPlexuses.length,
        children: spinalPlexuses.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      }
    ]
  },
  {
    id: 'histological_tissues',
    name: '🔬 Histological Tissues',
    type: 'category',
    description: 'Comprehensive tissue classification at the microscopic level',
    color: '#DDA0DD',
    children: [
      {
        id: 'epithelial_tissues',
        name: 'Epithelial Tissues',
        type: 'subcategory',
        icon: '🧫',
        description: 'Simple, stratified, and transitional epithelia',
        elementCount: epithelialTissues.length,
        children: epithelialTissues.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      },
      {
        id: 'connective_tissues',
        name: 'Connective Tissues',
        type: 'subcategory',
        icon: '🕸️',
        description: 'Loose, dense, cartilage, bone, blood, and lymph',
        elementCount: connectiveTissues.length,
        children: connectiveTissues.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      },
      {
        id: 'muscle_tissues',
        name: 'Muscle Tissues',
        type: 'subcategory',
        icon: '💪',
        description: 'Skeletal, cardiac, and smooth muscle',
        elementCount: muscleTissues.length,
        children: muscleTissues.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      },
      {
        id: 'nervous_tissues',
        name: 'Nervous Tissues',
        type: 'subcategory',
        icon: '⚡',
        description: 'Gray matter, white matter, and peripheral nerves',
        elementCount: nervousTissues.length,
        children: nervousTissues.map(e => ({ id: e.id, name: e.name, type: 'element' as const }))
      }
    ]
  },
  {
    id: 'pathway_level',
    name: '🔄 Biochemical Pathways',
    type: 'category',
    description: 'Metabolic and signaling pathways',
    color: '#3B82F6',
    children: [
      {
        id: 'metabolic_pathways',
        name: 'Metabolic Pathways',
        type: 'subcategory',
        icon: '⚡',
        description: 'Energy metabolism, biosynthesis, catabolism',
        elementCount: metabolicPathways.length,
        children: [
          { id: 'energy_metabolism', name: 'Energy Metabolism', type: 'subcategory', children: metabolicPathways.filter(e => e.subcategory === 'Energy Metabolism').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'carbohydrate_metabolism', name: 'Carbohydrate Metabolism', type: 'subcategory', children: metabolicPathways.filter(e => e.subcategory === 'Carbohydrate Metabolism').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'lipid_metabolism', name: 'Lipid Metabolism', type: 'subcategory', children: metabolicPathways.filter(e => e.subcategory === 'Lipid Metabolism').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'nitrogen_metabolism', name: 'Nitrogen Metabolism', type: 'subcategory', children: metabolicPathways.filter(e => e.subcategory === 'Nitrogen Metabolism').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'nucleotide_metabolism', name: 'Nucleotide Metabolism', type: 'subcategory', children: metabolicPathways.filter(e => e.subcategory === 'Nucleotide Metabolism').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'porphyrin_metabolism', name: 'Porphyrin Metabolism', type: 'subcategory', children: metabolicPathways.filter(e => e.subcategory === 'Porphyrin Metabolism').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      },
      {
        id: 'signaling_pathways',
        name: 'Signaling Pathways',
        type: 'subcategory',
        icon: '📡',
        description: 'Cell signaling and signal transduction',
        elementCount: signalingPathways.length,
        children: [
          { id: 'growth_factor_signaling', name: 'Growth Factor Signaling', type: 'subcategory', children: signalingPathways.filter(e => e.subcategory === 'Growth Factor Signaling').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'developmental_signaling', name: 'Developmental Signaling', type: 'subcategory', children: signalingPathways.filter(e => e.subcategory === 'Developmental Signaling').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'cytokine_signaling', name: 'Cytokine Signaling', type: 'subcategory', children: signalingPathways.filter(e => e.subcategory === 'Cytokine Signaling').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'inflammatory_signaling', name: 'Inflammatory Signaling', type: 'subcategory', children: signalingPathways.filter(e => e.subcategory === 'Inflammatory Signaling').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'cell_death_signaling', name: 'Cell Death Signaling', type: 'subcategory', children: signalingPathways.filter(e => e.subcategory === 'Cell Death Signaling').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'metabolic_signaling', name: 'Metabolic Signaling', type: 'subcategory', children: signalingPathways.filter(e => e.subcategory === 'Metabolic Signaling').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'receptor_signaling', name: 'Receptor Signaling', type: 'subcategory', children: signalingPathways.filter(e => e.subcategory === 'Receptor Signaling').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'second_messenger_signaling', name: 'Second Messenger Signaling', type: 'subcategory', children: signalingPathways.filter(e => e.subcategory === 'Second Messenger Signaling').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'stress_response', name: 'Stress Response', type: 'subcategory', children: signalingPathways.filter(e => e.subcategory === 'Stress Response').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) },
          { id: 'cellular_recycling', name: 'Cellular Recycling', type: 'subcategory', children: signalingPathways.filter(e => e.subcategory === 'Cellular Recycling').map(e => ({ id: e.id, name: e.name, type: 'element' as const })) }
        ]
      }
    ]
  }
]

// Helper function to find element by ID
export function findElementById(id: string): BiologicalElement | undefined {
  return allBiologicalElements.find(e => e.id === id)
}

// Helper function to search elements
export function searchElements(query: string): BiologicalElement[] {
  const q = query.toLowerCase()
  return allBiologicalElements.filter(e =>
    e.name.toLowerCase().includes(q) ||
    e.description.toLowerCase().includes(q) ||
    e.category.toLowerCase().includes(q) ||
    e.subcategory.toLowerCase().includes(q) ||
    e.functions.some(f => f.toLowerCase().includes(q)) ||
    e.diseaseLinks.some(d => d.toLowerCase().includes(q)) ||
    e.drugTargets.some(t => t.toLowerCase().includes(q))
  )
}

// Get elements by category
export function getElementsByCategory(category: string): BiologicalElement[] {
  return allBiologicalElements.filter(e => e.category === category)
}

// Get disease-related elements
export function getElementsByDisease(disease: string): BiologicalElement[] {
  const d = disease.toLowerCase()
  return allBiologicalElements.filter(e =>
    e.diseaseLinks.some(link => link.toLowerCase().includes(d))
  )
}

// Get drug target elements
export function getElementsByDrugTarget(drug: string): BiologicalElement[] {
  const d = drug.toLowerCase()
  return allBiologicalElements.filter(e =>
    e.drugTargets.some(target => target.toLowerCase().includes(d))
  )
}

// AI Simulation Interface
export interface SimulationState {
  elementId: string
  currentValue: number
  targetValue: number
  isModified: boolean
}

export interface CurePreventionScore {
  disease: string
  cureScore: number  // 0-100
  preventionScore: number  // 0-100
  affectedElements: string[]
  recommendations: string[]
}

// Export all for module use
export {
  geneticMaterial,
  rnaElements,
  proteinsEnzymes,
  organicMolecules,
  inorganicComponents,
  organelles,
  cellTypes,
  tissues,
  organs,
  organSystems,
  metabolicPathways,
  signalingPathways,
  // Library 6 - Elemental Matrix
  bulkElements,
  electrolyticElements,
  traceElements,
  fluidCompartments,
  allElementsAndFluids,
  // Library 7 - Extended Cell Ontology
  ectodermalCells,
  mesodermalCells,
  endodermalCells,
  extendedCellOntology,
  // Library 8 - Skeletal System
  neurocranium,
  viscerocranium,
  auditoryOssicles,
  vertebralColumn,
  thoracicCage,
  pectoralGirdle,
  upperLimb,
  pelvicGirdle,
  lowerLimb,
  completeSkeleton,
  // Library 9 - Muscular System
  headNeckMuscles,
  thoraxAbdomenMuscles,
  upperLimbMuscles,
  lowerLimbMuscles,
  completeMuscularSystem,
  // Library 10 - Nervous System & Histology
  cranialNerves,
  spinalPlexuses,
  epithelialTissues,
  connectiveTissues,
  muscleTissues,
  nervousTissues,
  allNervousSystemDetails,
  allHistologicalTissues,
  allLibrary10Elements
}
