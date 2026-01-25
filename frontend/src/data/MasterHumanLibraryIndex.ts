// Master Human Library - Complete Index with Tree Structure
// For Multi-AI Agent Simulation to optimize cure/prevention scores

import { BiologicalElement, geneticMaterial, rnaElements, proteinsEnzymes } from './MasterHumanLibrary'
export type { BiologicalElement }
import { organicMolecules, inorganicComponents, organelles } from './MasterHumanLibrary2'
import { cellTypes } from './MasterHumanLibrary3'
import { tissues, organs, organSystems } from './MasterHumanLibrary4'
import { metabolicPathways, signalingPathways } from './MasterHumanLibrary5'

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
  ...signalingPathways
]

// Library statistics
export const libraryStats = {
  totalElements: allBiologicalElements.length,
  categories: 12,
  geneticElements: geneticMaterial.length,
  rnaElements: rnaElements.length,
  proteins: proteinsEnzymes.length,
  organicMolecules: organicMolecules.length,
  inorganicComponents: inorganicComponents.length,
  organelles: organelles.length,
  cellTypes: cellTypes.length,
  tissues: tissues.length,
  organs: organs.length,
  organSystems: organSystems.length,
  metabolicPathways: metabolicPathways.length,
  signalingPathways: signalingPathways.length,
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
  signalingPathways
}
