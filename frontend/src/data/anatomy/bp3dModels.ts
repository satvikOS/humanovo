/**
 * BodyParts3D (BP3D) Model Registry
 *
 * BodyParts3D is a dictionary-type database for anatomy in which anatomical concepts
 * are represented by 3D structure data. These models are provided by the Database Center
 * for Life Science (DBCLS) at the University of Tokyo.
 *
 * LICENSE: Creative Commons Attribution-ShareAlike 2.1 Japan (CC BY-SA 2.1)
 *
 * ATTRIBUTION REQUIRED:
 * "BodyParts3D, Copyright© 2008 Life Science Integrated Database Center
 *  licensed by CC Attribution-Share Alike 2.1 Japan"
 *
 * Source: https://lifesciencedb.jp/bp3d/?lng=en
 * GitHub Mirror: https://github.com/Kevin-Mattheus-Moerman/BodyParts3D
 *
 * Note: Under CC BY-SA, commercial use is permitted with proper attribution.
 * Any derivative works must be shared under the same license.
 */

import { ModelMetadata, ModelFormat } from '../../utils/modelLoader'

// BP3D Attribution constant - MUST be displayed when using BP3D models
export const BP3D_ATTRIBUTION = `BodyParts3D, Copyright© 2008 Life Science Integrated Database Center licensed by CC Attribution-Share Alike 2.1 Japan`

export const BP3D_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en'
export const BP3D_SOURCE_URL = 'https://lifesciencedb.jp/bp3d/?lng=en'

// Anatomical system categories matching BP3D structure
export type AnatomySystem =
  | 'skeletal'
  | 'muscular'
  | 'nervous'
  | 'circulatory'
  | 'lymphatic'
  | 'respiratory'
  | 'digestive'
  | 'urinary'
  | 'reproductive'
  | 'integumentary'
  | 'endocrine'

// Body regions
export type BodyRegion =
  | 'head'
  | 'neck'
  | 'thorax'
  | 'abdomen'
  | 'pelvis'
  | 'upper_limb'
  | 'lower_limb'
  | 'back'

// BP3D Model configuration
export interface BP3DModel extends Omit<ModelMetadata, 'source' | 'attribution'> {
  bp3dId?: string // Original BP3D identifier
  fmaId?: string  // Foundational Model of Anatomy ID
  region: BodyRegion
  system: AnatomySystem
}

/**
 * Create a full ModelMetadata from BP3D model config
 */
export function toBP3DMetadata(model: BP3DModel): ModelMetadata {
  return {
    ...model,
    attribution: BP3D_ATTRIBUTION,
    source: 'BP3D'
  }
}

/**
 * BP3D Model Registry
 *
 * Models should be placed in /public/models/bp3d/ directory
 * Download models from: https://github.com/Kevin-Mattheus-Moerman/BodyParts3D
 *
 * File naming convention: {bp3dId}_{name}.{format}
 * Example: FMA_9613_skull.glb
 */
export const BP3D_MODELS: BP3DModel[] = [
  // ========== SKELETAL SYSTEM ==========
  // Skull
  {
    id: 'bp3d_skull',
    name: 'Skull (Cranium)',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/skull.glb',
    system: 'skeletal',
    region: 'head',
    bp3dId: 'FMA_46565',
    fmaId: 'FMA_46565'
  },
  {
    id: 'bp3d_mandible',
    name: 'Mandible',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/mandible.glb',
    system: 'skeletal',
    region: 'head',
    bp3dId: 'FMA_52748',
    fmaId: 'FMA_52748'
  },

  // Vertebral Column
  {
    id: 'bp3d_cervical_vertebrae',
    name: 'Cervical Vertebrae (C1-C7)',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/cervical_vertebrae.glb',
    system: 'skeletal',
    region: 'neck',
    bp3dId: 'FMA_72063'
  },
  {
    id: 'bp3d_thoracic_vertebrae',
    name: 'Thoracic Vertebrae (T1-T12)',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/thoracic_vertebrae.glb',
    system: 'skeletal',
    region: 'thorax',
    bp3dId: 'FMA_9139'
  },
  {
    id: 'bp3d_lumbar_vertebrae',
    name: 'Lumbar Vertebrae (L1-L5)',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/lumbar_vertebrae.glb',
    system: 'skeletal',
    region: 'abdomen',
    bp3dId: 'FMA_9921'
  },
  {
    id: 'bp3d_sacrum',
    name: 'Sacrum',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/sacrum.glb',
    system: 'skeletal',
    region: 'pelvis',
    bp3dId: 'FMA_16202'
  },

  // Rib Cage
  {
    id: 'bp3d_ribs',
    name: 'Rib Cage',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/ribs.glb',
    system: 'skeletal',
    region: 'thorax',
    bp3dId: 'FMA_7480'
  },
  {
    id: 'bp3d_sternum',
    name: 'Sternum',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/sternum.glb',
    system: 'skeletal',
    region: 'thorax',
    bp3dId: 'FMA_7485'
  },

  // Pelvic Girdle
  {
    id: 'bp3d_pelvis',
    name: 'Pelvis',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/pelvis.glb',
    system: 'skeletal',
    region: 'pelvis',
    bp3dId: 'FMA_9578'
  },

  // Upper Limb
  {
    id: 'bp3d_clavicle_left',
    name: 'Left Clavicle',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/clavicle_left.glb',
    system: 'skeletal',
    region: 'upper_limb',
    side: 'left',
    bp3dId: 'FMA_13321'
  },
  {
    id: 'bp3d_scapula_left',
    name: 'Left Scapula',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/scapula_left.glb',
    system: 'skeletal',
    region: 'upper_limb',
    side: 'left',
    bp3dId: 'FMA_13394'
  },
  {
    id: 'bp3d_humerus_left',
    name: 'Left Humerus',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/humerus_left.glb',
    system: 'skeletal',
    region: 'upper_limb',
    side: 'left',
    bp3dId: 'FMA_23130'
  },
  {
    id: 'bp3d_radius_left',
    name: 'Left Radius',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/radius_left.glb',
    system: 'skeletal',
    region: 'upper_limb',
    side: 'left',
    bp3dId: 'FMA_23463'
  },
  {
    id: 'bp3d_ulna_left',
    name: 'Left Ulna',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/ulna_left.glb',
    system: 'skeletal',
    region: 'upper_limb',
    side: 'left',
    bp3dId: 'FMA_23466'
  },

  // Lower Limb
  {
    id: 'bp3d_femur_left',
    name: 'Left Femur',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/femur_left.glb',
    system: 'skeletal',
    region: 'lower_limb',
    side: 'left',
    bp3dId: 'FMA_24474'
  },
  {
    id: 'bp3d_patella_left',
    name: 'Left Patella',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/patella_left.glb',
    system: 'skeletal',
    region: 'lower_limb',
    side: 'left',
    bp3dId: 'FMA_24485'
  },
  {
    id: 'bp3d_tibia_left',
    name: 'Left Tibia',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/tibia_left.glb',
    system: 'skeletal',
    region: 'lower_limb',
    side: 'left',
    bp3dId: 'FMA_24476'
  },
  {
    id: 'bp3d_fibula_left',
    name: 'Left Fibula',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/skeletal/fibula_left.glb',
    system: 'skeletal',
    region: 'lower_limb',
    side: 'left',
    bp3dId: 'FMA_24479'
  },

  // ========== MUSCULAR SYSTEM ==========
  {
    id: 'bp3d_heart_muscle',
    name: 'Heart (Cardiac Muscle)',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/muscular/heart.glb',
    system: 'muscular',
    region: 'thorax',
    bp3dId: 'FMA_7088'
  },
  {
    id: 'bp3d_diaphragm',
    name: 'Diaphragm',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/muscular/diaphragm.glb',
    system: 'muscular',
    region: 'thorax',
    bp3dId: 'FMA_13295'
  },

  // ========== NERVOUS SYSTEM ==========
  {
    id: 'bp3d_brain',
    name: 'Brain',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/nervous/brain.glb',
    system: 'nervous',
    region: 'head',
    bp3dId: 'FMA_50801'
  },
  {
    id: 'bp3d_spinal_cord',
    name: 'Spinal Cord',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/nervous/spinal_cord.glb',
    system: 'nervous',
    region: 'back',
    bp3dId: 'FMA_7647'
  },

  // ========== CIRCULATORY SYSTEM ==========
  {
    id: 'bp3d_heart',
    name: 'Heart',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/circulatory/heart.glb',
    system: 'circulatory',
    region: 'thorax',
    bp3dId: 'FMA_7088'
  },
  {
    id: 'bp3d_aorta',
    name: 'Aorta',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/circulatory/aorta.glb',
    system: 'circulatory',
    region: 'thorax',
    bp3dId: 'FMA_3734'
  },

  // ========== RESPIRATORY SYSTEM ==========
  {
    id: 'bp3d_lungs',
    name: 'Lungs',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/respiratory/lungs.glb',
    system: 'respiratory',
    region: 'thorax',
    bp3dId: 'FMA_7195'
  },
  {
    id: 'bp3d_trachea',
    name: 'Trachea',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/respiratory/trachea.glb',
    system: 'respiratory',
    region: 'neck',
    bp3dId: 'FMA_7394'
  },

  // ========== DIGESTIVE SYSTEM ==========
  {
    id: 'bp3d_stomach',
    name: 'Stomach',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/digestive/stomach.glb',
    system: 'digestive',
    region: 'abdomen',
    bp3dId: 'FMA_7148'
  },
  {
    id: 'bp3d_liver',
    name: 'Liver',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/digestive/liver.glb',
    system: 'digestive',
    region: 'abdomen',
    bp3dId: 'FMA_7197'
  },
  {
    id: 'bp3d_intestines',
    name: 'Intestines',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/digestive/intestines.glb',
    system: 'digestive',
    region: 'abdomen',
    bp3dId: 'FMA_7199'
  },

  // ========== URINARY SYSTEM ==========
  {
    id: 'bp3d_kidneys',
    name: 'Kidneys',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/urinary/kidneys.glb',
    system: 'urinary',
    region: 'abdomen',
    bp3dId: 'FMA_7203'
  },
  {
    id: 'bp3d_bladder',
    name: 'Urinary Bladder',
    format: 'glb' as ModelFormat,
    url: '/models/bp3d/urinary/bladder.glb',
    system: 'urinary',
    region: 'pelvis',
    bp3dId: 'FMA_15900'
  }
]

/**
 * Get models by anatomical system
 */
export function getModelsBySystem(system: AnatomySystem): BP3DModel[] {
  return BP3D_MODELS.filter(m => m.system === system)
}

/**
 * Get models by body region
 */
export function getModelsByRegion(region: BodyRegion): BP3DModel[] {
  return BP3D_MODELS.filter(m => m.region === region)
}

/**
 * Get a specific model by ID
 */
export function getModelById(id: string): BP3DModel | undefined {
  return BP3D_MODELS.find(m => m.id === id)
}

/**
 * Get all available systems
 */
export function getAvailableSystems(): AnatomySystem[] {
  return [...new Set(BP3D_MODELS.map(m => m.system))]
}

/**
 * Get all available regions
 */
export function getAvailableRegions(): BodyRegion[] {
  return [...new Set(BP3D_MODELS.map(m => m.region))]
}
