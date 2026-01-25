// Master Human Library Part 8 - Complete Skeletal System (206 Bones)
import { BiologicalElement } from './MasterHumanLibrary'

// ==================== AXIAL SKELETON (80 Bones) ====================

// SKULL - NEUROCRANIUM (8 bones)
export const neurocranium: BiologicalElement[] = [
  {
    id: 'bone_frontal',
    name: 'Frontal Bone',
    category: 'organs',
    subcategory: 'Axial Skeleton - Neurocranium',
    description: 'Forms forehead and superior orbital margins; contains frontal sinuses.',
    location: ['Anterior cranium'],
    functions: ['Brain protection (frontal lobes)', 'Forehead structure', 'Frontal sinus housing'],
    interactions: ['Parietal bones (coronal suture)', 'Nasal bones', 'Sphenoid', 'Ethmoid'],
    diseaseLinks: ['Frontal bone fractures', 'Sinusitis', 'Craniosynostosis'],
    drugTargets: ['Surgical repair'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'bone' },
    aiSimulationReady: true
  },
  {
    id: 'bone_parietal',
    name: 'Parietal Bones (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Neurocranium',
    description: 'Paired bones forming superior and lateral cranial vault; join at sagittal suture.',
    location: ['Superior-lateral cranium'],
    functions: ['Brain protection (parietal lobes)', 'Cranial vault formation'],
    interactions: ['Frontal (coronal)', 'Occipital (lambdoid)', 'Temporal (squamosal)', 'Each other (sagittal)'],
    diseaseLinks: ['Skull fractures', 'Craniosynostosis', 'Parietal foramina'],
    drugTargets: ['Surgical repair'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_temporal',
    name: 'Temporal Bones (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Neurocranium',
    description: 'Complex paired bones housing middle/inner ear; contains mastoid process, styloid process, zygomatic process.',
    location: ['Lateral cranium, inferior to parietal'],
    functions: ['Hearing apparatus housing', 'TMJ articulation', 'Muscle attachment (mastoid)'],
    interactions: ['Parietal', 'Sphenoid', 'Occipital', 'Zygomatic', 'Mandible'],
    diseaseLinks: ['Temporal bone fracture', 'Mastoiditis', 'Cholesteatoma', 'Acoustic neuroma'],
    drugTargets: ['Antibiotics (mastoiditis)', 'Surgical intervention'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_occipital',
    name: 'Occipital Bone',
    category: 'organs',
    subcategory: 'Axial Skeleton - Neurocranium',
    description: 'Forms posterior cranium; contains foramen magnum for spinal cord passage; articulates with atlas (C1).',
    location: ['Posterior-inferior cranium'],
    functions: ['Brain protection (occipital lobe, cerebellum)', 'Spinal cord passage', 'Atlas articulation'],
    interactions: ['Parietal (lambdoid)', 'Temporal', 'Sphenoid', 'Atlas (C1)'],
    diseaseLinks: ['Occipital fractures', 'Arnold-Chiari malformation', 'Basilar invagination'],
    drugTargets: ['Surgical decompression'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'bone' },
    aiSimulationReady: true
  },
  {
    id: 'bone_sphenoid',
    name: 'Sphenoid Bone',
    category: 'organs',
    subcategory: 'Axial Skeleton - Neurocranium',
    description: 'Bat-shaped bone in middle cranial fossa; contains sella turcica (pituitary fossa), sphenoid sinuses.',
    location: ['Central skull base'],
    functions: ['Pituitary housing (sella turcica)', 'Optic canal', 'Multiple cranial nerve foramina'],
    interactions: ['All cranial bones', 'Optic nerves', 'Internal carotid arteries'],
    diseaseLinks: ['Pituitary tumors', 'Sphenoid sinusitis', 'CSF leaks'],
    drugTargets: ['Transsphenoidal surgery access'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'bone' },
    aiSimulationReady: true
  },
  {
    id: 'bone_ethmoid',
    name: 'Ethmoid Bone',
    category: 'organs',
    subcategory: 'Axial Skeleton - Neurocranium',
    description: 'Delicate bone forming nasal septum (perpendicular plate), superior/middle conchae; contains ethmoidal air cells.',
    location: ['Between orbits, anterior cranial fossa floor'],
    functions: ['Nasal septum', 'Olfactory nerve passage (cribriform plate)', 'Nasal turbinate support'],
    interactions: ['Frontal', 'Sphenoid', 'Nasal', 'Lacrimal', 'Maxilla', 'Vomer'],
    diseaseLinks: ['Ethmoid sinusitis', 'CSF rhinorrhea', 'Anosmia'],
    drugTargets: ['Decongestants', 'FESS surgery'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'bone' },
    aiSimulationReady: true
  }
]

// SKULL - VISCEROCRANIUM (14 bones)
export const viscerocranium: BiologicalElement[] = [
  {
    id: 'bone_mandible',
    name: 'Mandible',
    category: 'organs',
    subcategory: 'Axial Skeleton - Viscerocranium',
    description: 'Lower jaw; only movable skull bone; contains alveolar processes for teeth.',
    location: ['Lower face'],
    functions: ['Mastication', 'Speech', 'Lower teeth housing', 'TMJ movement'],
    interactions: ['Temporal bone (TMJ)', 'Muscles of mastication', 'Lower teeth'],
    diseaseLinks: ['TMJ disorders', 'Mandible fractures', 'Osteonecrosis'],
    drugTargets: ['Muscle relaxants', 'Bisphosphonates (ONJ risk)'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'bone' },
    aiSimulationReady: true
  },
  {
    id: 'bone_maxilla',
    name: 'Maxillae (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Viscerocranium',
    description: 'Paired upper jaw bones; form hard palate, orbital floor, nasal cavity walls; contain maxillary sinuses.',
    location: ['Upper face'],
    functions: ['Upper teeth housing', 'Hard palate formation', 'Orbital floor', 'Maxillary sinus'],
    interactions: ['All facial bones except mandible', 'Upper teeth'],
    diseaseLinks: ['Maxillary sinusitis', 'Le Fort fractures', 'Cleft palate'],
    drugTargets: ['Sinus surgery', 'Orthodontics'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_zygomatic',
    name: 'Zygomatic Bones (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Viscerocranium',
    description: 'Cheekbones; form lateral orbital wall and zygomatic arch with temporal process.',
    location: ['Lateral face below orbits'],
    functions: ['Cheek prominence', 'Lateral orbital wall', 'Masseter attachment'],
    interactions: ['Maxilla', 'Frontal', 'Sphenoid', 'Temporal'],
    diseaseLinks: ['Zygomatic fractures', 'Tripod fractures'],
    drugTargets: ['ORIF surgery'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_nasal',
    name: 'Nasal Bones (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Viscerocranium',
    description: 'Small paired bones forming bridge of nose.',
    location: ['Superior nasal bridge'],
    functions: ['Nasal bridge structure', 'Cartilage attachment'],
    interactions: ['Frontal', 'Maxilla', 'Nasal cartilages'],
    diseaseLinks: ['Nasal fractures', 'Saddle nose deformity'],
    drugTargets: ['Rhinoplasty'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_lacrimal',
    name: 'Lacrimal Bones (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Viscerocranium',
    description: 'Smallest facial bones; form medial orbital wall; contain lacrimal fossa for lacrimal sac.',
    location: ['Medial orbit'],
    functions: ['Lacrimal apparatus housing', 'Medial orbital wall'],
    interactions: ['Ethmoid', 'Frontal', 'Maxilla', 'Inferior concha'],
    diseaseLinks: ['Dacryocystitis', 'Lacrimal duct obstruction'],
    drugTargets: ['DCR surgery'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_palatine',
    name: 'Palatine Bones (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Viscerocranium',
    description: 'L-shaped paired bones forming posterior hard palate, lateral nasal wall, and orbital floor.',
    location: ['Posterior hard palate, nasal cavity'],
    functions: ['Posterior hard palate', 'Nasal cavity wall', 'Orbital floor contribution'],
    interactions: ['Maxilla', 'Sphenoid', 'Ethmoid', 'Inferior concha', 'Vomer'],
    diseaseLinks: ['Cleft palate'],
    drugTargets: ['Surgical repair'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_vomer',
    name: 'Vomer',
    category: 'organs',
    subcategory: 'Axial Skeleton - Viscerocranium',
    description: 'Thin, flat bone forming inferior-posterior nasal septum.',
    location: ['Nasal septum'],
    functions: ['Nasal septum formation', 'Nasal cavity division'],
    interactions: ['Ethmoid (perpendicular plate)', 'Maxilla', 'Palatine', 'Sphenoid'],
    diseaseLinks: ['Deviated septum'],
    drugTargets: ['Septoplasty'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'bone' },
    aiSimulationReady: true
  },
  {
    id: 'bone_inferior_concha',
    name: 'Inferior Nasal Conchae (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Viscerocranium',
    description: 'Scroll-shaped bones in lateral nasal wall; separate bones (unlike superior/middle from ethmoid).',
    location: ['Lateral nasal cavity'],
    functions: ['Air turbulence', 'Warming/humidifying air', 'Increased surface area'],
    interactions: ['Maxilla', 'Lacrimal', 'Ethmoid', 'Palatine'],
    diseaseLinks: ['Turbinate hypertrophy', 'Nasal obstruction'],
    drugTargets: ['Turbinate reduction', 'Nasal steroids'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  }
]

// AUDITORY OSSICLES (6 bones)
export const auditoryOssicles: BiologicalElement[] = [
  {
    id: 'bone_malleus',
    name: 'Malleus (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Auditory Ossicles',
    description: 'Hammer-shaped; largest ossicle; attached to tympanic membrane, articulates with incus.',
    location: ['Middle ear cavity'],
    functions: ['Sound transmission from tympanic membrane', 'Mechanical amplification'],
    interactions: ['Tympanic membrane', 'Incus', 'Tensor tympani muscle'],
    diseaseLinks: ['Otosclerosis', 'Ossicular chain disruption', 'Cholesteatoma'],
    drugTargets: ['Ossiculoplasty'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_incus',
    name: 'Incus (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Auditory Ossicles',
    description: 'Anvil-shaped; middle ossicle connecting malleus to stapes.',
    location: ['Middle ear cavity'],
    functions: ['Sound transmission relay', 'Mechanical coupling'],
    interactions: ['Malleus', 'Stapes'],
    diseaseLinks: ['Otosclerosis', 'Incus necrosis'],
    drugTargets: ['Ossiculoplasty'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_stapes',
    name: 'Stapes (2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Auditory Ossicles',
    description: 'Stirrup-shaped; smallest bone in body; footplate covers oval window.',
    location: ['Middle ear cavity'],
    functions: ['Sound transmission to inner ear', 'Oval window vibration'],
    interactions: ['Incus', 'Oval window', 'Stapedius muscle'],
    diseaseLinks: ['Otosclerosis (stapes fixation)', 'Conductive hearing loss'],
    drugTargets: ['Stapedectomy', 'Stapedotomy'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  }
]

// VERTEBRAL COLUMN (26 bones)
export const vertebralColumn: BiologicalElement[] = [
  {
    id: 'bone_atlas_c1',
    name: 'Atlas (C1)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Cervical Vertebrae',
    description: 'First cervical vertebra; ring-shaped without body or spinous process; supports skull.',
    location: ['Superior cervical spine'],
    functions: ['Skull support', 'Head nodding (atlantooccipital joint)', 'Vertebral artery passage'],
    interactions: ['Occipital condyles', 'Axis (C2)', 'Vertebral arteries'],
    diseaseLinks: ['Atlantooccipital dislocation', 'Jefferson fracture', 'Atlantoaxial instability'],
    drugTargets: ['Surgical fusion'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'vertebra' },
    aiSimulationReady: true
  },
  {
    id: 'bone_axis_c2',
    name: 'Axis (C2)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Cervical Vertebrae',
    description: 'Second cervical vertebra; contains dens (odontoid process) for atlas rotation.',
    location: ['Cervical spine'],
    functions: ['Head rotation (atlantoaxial joint)', 'Pivot point for atlas'],
    interactions: ['Atlas (C1)', 'C3', 'Dens ligaments'],
    diseaseLinks: ['Odontoid fracture', 'Hangman fracture', 'Rheumatoid atlantoaxial subluxation'],
    drugTargets: ['Surgical fixation'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'vertebra' },
    aiSimulationReady: true
  },
  {
    id: 'bone_cervical_c3_c7',
    name: 'Cervical Vertebrae (C3-C7)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Cervical Vertebrae',
    description: 'Five typical cervical vertebrae with transverse foramina for vertebral arteries; bifid spinous processes.',
    location: ['Cervical spine'],
    functions: ['Neck support', 'Spinal cord protection', 'Nerve root passage', 'Neck mobility'],
    interactions: ['Intervertebral discs', 'Facet joints', 'Spinal cord', 'Nerve roots'],
    diseaseLinks: ['Cervical radiculopathy', 'Disc herniation', 'Cervical spondylosis'],
    drugTargets: ['NSAIDs', 'Epidural steroids', 'ACDF surgery'],
    simulationParams: { baselineValue: 5, minValue: 5, maxValue: 5, unit: 'vertebrae' },
    aiSimulationReady: true
  },
  {
    id: 'bone_thoracic',
    name: 'Thoracic Vertebrae (T1-T12)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Thoracic Vertebrae',
    description: 'Twelve vertebrae with costal facets for rib articulation; longest spinous processes.',
    location: ['Thoracic spine'],
    functions: ['Rib articulation', 'Thoracic cage support', 'Spinal cord protection'],
    interactions: ['Ribs (costotransverse, costovertebral joints)', 'Intervertebral discs', 'Spinal cord'],
    diseaseLinks: ['Thoracic disc herniation', 'Compression fractures', 'Scheuermann disease'],
    drugTargets: ['Vertebroplasty', 'Kyphoplasty'],
    simulationParams: { baselineValue: 12, minValue: 12, maxValue: 12, unit: 'vertebrae' },
    aiSimulationReady: true
  },
  {
    id: 'bone_lumbar',
    name: 'Lumbar Vertebrae (L1-L5)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Lumbar Vertebrae',
    description: 'Five largest vertebrae with kidney-shaped bodies; bear most body weight.',
    location: ['Lumbar spine'],
    functions: ['Weight bearing', 'Flexibility', 'Spinal cord/cauda equina protection'],
    interactions: ['Intervertebral discs', 'Facet joints', 'Psoas muscles', 'Cauda equina'],
    diseaseLinks: ['Lumbar disc herniation', 'Spinal stenosis', 'Spondylolisthesis', 'Degenerative disc disease'],
    drugTargets: ['NSAIDs', 'Epidural steroids', 'Spinal fusion', 'Disc replacement'],
    simulationParams: { baselineValue: 5, minValue: 5, maxValue: 5, unit: 'vertebrae' },
    aiSimulationReady: true
  },
  {
    id: 'bone_sacrum',
    name: 'Sacrum',
    category: 'organs',
    subcategory: 'Axial Skeleton - Sacrum',
    description: 'Five fused vertebrae forming triangular bone; articulates with pelvis at SI joints.',
    location: ['Inferior spine, posterior pelvis'],
    functions: ['Pelvic support', 'Weight transmission to pelvis', 'Sacral nerve passage'],
    interactions: ['L5', 'Iliac bones (SI joints)', 'Coccyx', 'Sacral nerves'],
    diseaseLinks: ['Sacroiliitis', 'Sacral fractures', 'Ankylosing spondylitis'],
    drugTargets: ['SI joint injections', 'Biologics (AS)'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'bone (5 fused)' },
    aiSimulationReady: true
  },
  {
    id: 'bone_coccyx',
    name: 'Coccyx',
    category: 'organs',
    subcategory: 'Axial Skeleton - Coccyx',
    description: 'Tailbone; 3-5 fused vertebrae; vestigial structure with muscle attachments.',
    location: ['Inferior spine'],
    functions: ['Muscle attachment (pelvic floor)', 'Weight bearing when sitting'],
    interactions: ['Sacrum', 'Pelvic floor muscles', 'Gluteus maximus'],
    diseaseLinks: ['Coccydynia', 'Coccyx fracture', 'Pilonidal cyst'],
    drugTargets: ['NSAIDs', 'Cushioning', 'Coccygectomy'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'bone (3-5 fused)' },
    aiSimulationReady: true
  }
]

// THORACIC CAGE (25 bones)
export const thoracicCage: BiologicalElement[] = [
  {
    id: 'bone_sternum',
    name: 'Sternum',
    category: 'organs',
    subcategory: 'Axial Skeleton - Thoracic Cage',
    description: 'Breastbone comprising manubrium, body, and xiphoid process; articulates with clavicles and ribs.',
    location: ['Anterior chest'],
    functions: ['Thoracic protection', 'Rib articulation', 'Bone marrow (sternal aspirate)'],
    interactions: ['Clavicles', 'Ribs 1-7 (costal cartilages)', 'Pectoralis major'],
    diseaseLinks: ['Sternal fracture', 'Sternotomy complications', 'Pectus excavatum'],
    drugTargets: ['Sternal wiring'],
    simulationParams: { baselineValue: 1, minValue: 1, maxValue: 1, unit: 'bone' },
    aiSimulationReady: true
  },
  {
    id: 'bone_ribs_true',
    name: 'True Ribs (1-7)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Thoracic Cage',
    description: 'Seven pairs directly articulating with sternum via individual costal cartilages.',
    location: ['Thoracic cage'],
    functions: ['Thoracic protection', 'Breathing mechanics', 'Organ protection'],
    interactions: ['Thoracic vertebrae', 'Sternum', 'Intercostal muscles'],
    diseaseLinks: ['Rib fractures', 'Costochondritis', 'Flail chest'],
    drugTargets: ['Pain management', 'Rib fixation'],
    simulationParams: { baselineValue: 14, minValue: 14, maxValue: 14, unit: 'ribs' },
    aiSimulationReady: true
  },
  {
    id: 'bone_ribs_false',
    name: 'False Ribs (8-10)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Thoracic Cage',
    description: 'Three pairs connecting to sternum indirectly via rib 7 costal cartilage.',
    location: ['Lower thoracic cage'],
    functions: ['Thoracic protection', 'Breathing mechanics'],
    interactions: ['Thoracic vertebrae', 'Costal margin', 'Diaphragm attachment'],
    diseaseLinks: ['Rib fractures', 'Slipping rib syndrome'],
    drugTargets: ['Pain management'],
    simulationParams: { baselineValue: 6, minValue: 6, maxValue: 6, unit: 'ribs' },
    aiSimulationReady: true
  },
  {
    id: 'bone_ribs_floating',
    name: 'Floating Ribs (11-12)',
    category: 'organs',
    subcategory: 'Axial Skeleton - Thoracic Cage',
    description: 'Two pairs with no anterior attachment; embedded in posterior abdominal wall musculature.',
    location: ['Posterior lower thorax'],
    functions: ['Muscle attachment', 'Limited protection'],
    interactions: ['T11-T12 vertebrae', 'Quadratus lumborum'],
    diseaseLinks: ['Floating rib fractures', 'Kidney injury'],
    drugTargets: ['Pain management'],
    simulationParams: { baselineValue: 4, minValue: 4, maxValue: 4, unit: 'ribs' },
    aiSimulationReady: true
  }
]

// ==================== APPENDICULAR SKELETON (126 Bones) ====================

// PECTORAL GIRDLE (4 bones)
export const pectoralGirdle: BiologicalElement[] = [
  {
    id: 'bone_clavicle',
    name: 'Clavicles (2)',
    category: 'organs',
    subcategory: 'Appendicular - Pectoral Girdle',
    description: 'S-shaped bones connecting sternum to scapulae; first bones to ossify, commonly fractured.',
    location: ['Anterior shoulder'],
    functions: ['Upper limb support', 'Force transmission', 'Muscle attachment'],
    interactions: ['Sternum (SC joint)', 'Acromion (AC joint)', 'Trapezius', 'Deltoid'],
    diseaseLinks: ['Clavicle fracture (most common)', 'AC separation', 'Distal clavicle osteolysis'],
    drugTargets: ['ORIF', 'Conservative management'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_scapula',
    name: 'Scapulae (2)',
    category: 'organs',
    subcategory: 'Appendicular - Pectoral Girdle',
    description: 'Triangular shoulder blades with acromion, coracoid process, spine, and glenoid cavity.',
    location: ['Posterior thorax'],
    functions: ['Shoulder mobility', 'Muscle attachment (17 muscles)', 'GH joint socket'],
    interactions: ['Clavicle', 'Humerus', 'Rotator cuff', 'Serratus anterior', 'Rhomboids'],
    diseaseLinks: ['Scapular winging', 'Snapping scapula', 'Scapular fractures'],
    drugTargets: ['Physical therapy'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  }
]

// UPPER LIMB (60 bones)
export const upperLimb: BiologicalElement[] = [
  {
    id: 'bone_humerus',
    name: 'Humerus (2)',
    category: 'organs',
    subcategory: 'Appendicular - Upper Limb',
    description: 'Arm bone from shoulder to elbow; head articulates with glenoid, distally with radius/ulna.',
    location: ['Arm (brachium)'],
    functions: ['Arm structure', 'Elbow/shoulder movement', 'Muscle attachment'],
    interactions: ['Scapula (GH joint)', 'Radius/Ulna (elbow)', 'Biceps', 'Triceps', 'Deltoid'],
    diseaseLinks: ['Humeral fractures', 'Rotator cuff tears', 'Lateral epicondylitis'],
    drugTargets: ['ORIF', 'Arthroplasty'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_radius',
    name: 'Radius (2)',
    category: 'organs',
    subcategory: 'Appendicular - Upper Limb',
    description: 'Lateral forearm bone; head rotates on humerus, distal end articulates with carpal bones.',
    location: ['Lateral forearm'],
    functions: ['Forearm pronation/supination', 'Wrist articulation', 'Thumb-side structure'],
    interactions: ['Humerus', 'Ulna (PRUJ, DRUJ)', 'Scaphoid/Lunate', 'Biceps tendon'],
    diseaseLinks: ['Distal radius fracture (Colles)', 'Radial head fracture'],
    drugTargets: ['Casting', 'ORIF'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_ulna',
    name: 'Ulna (2)',
    category: 'organs',
    subcategory: 'Appendicular - Upper Limb',
    description: 'Medial forearm bone; olecranon forms elbow point; trochlear notch articulates with humerus.',
    location: ['Medial forearm'],
    functions: ['Elbow hinge joint', 'Forearm structure', 'Pinky-side structure'],
    interactions: ['Humerus (trochlea)', 'Radius', 'Triceps (olecranon)'],
    diseaseLinks: ['Olecranon fracture', 'Ulnar shaft fracture', 'Ulnar neuropathy'],
    drugTargets: ['ORIF', 'Tension band wiring'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_carpals',
    name: 'Carpal Bones (16 total)',
    category: 'organs',
    subcategory: 'Appendicular - Upper Limb',
    description: 'Eight bones per wrist: Proximal row (Scaphoid, Lunate, Triquetrum, Pisiform); Distal row (Trapezium, Trapezoid, Capitate, Hamate).',
    location: ['Wrist'],
    functions: ['Wrist mobility', 'Force transmission', 'Hand positioning'],
    interactions: ['Radius', 'Metacarpals', 'Numerous ligaments', 'Flexor/extensor tendons'],
    diseaseLinks: ['Scaphoid fracture', 'Carpal tunnel syndrome', 'Kienbock disease', 'SLAC wrist'],
    drugTargets: ['Splinting', 'Carpal tunnel release', 'Fusion'],
    simulationParams: { baselineValue: 16, minValue: 16, maxValue: 16, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_metacarpals',
    name: 'Metacarpals (10 total)',
    category: 'organs',
    subcategory: 'Appendicular - Upper Limb',
    description: 'Five bones per hand forming palm; numbered I-V from thumb to pinky.',
    location: ['Palm of hand'],
    functions: ['Hand structure', 'Grip mechanics', 'Knuckle formation'],
    interactions: ['Carpals', 'Proximal phalanges', 'Intrinsic hand muscles'],
    diseaseLinks: ['Boxer fracture (5th MC)', 'Bennett fracture (1st MC)', 'CMC arthritis'],
    drugTargets: ['Splinting', 'ORIF'],
    simulationParams: { baselineValue: 10, minValue: 10, maxValue: 10, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_phalanges_hand',
    name: 'Phalanges - Hand (28 total)',
    category: 'organs',
    subcategory: 'Appendicular - Upper Limb',
    description: 'Finger bones: 2 per thumb (proximal, distal), 3 per finger (proximal, middle, distal).',
    location: ['Fingers'],
    functions: ['Fine motor control', 'Grip', 'Touch sensation platform'],
    interactions: ['Metacarpals', 'Flexor/extensor tendons', 'Collateral ligaments'],
    diseaseLinks: ['Phalangeal fractures', 'Mallet finger', 'Trigger finger', 'Dupuytren contracture'],
    drugTargets: ['Splinting', 'Tendon repair'],
    simulationParams: { baselineValue: 28, minValue: 28, maxValue: 28, unit: 'bones' },
    aiSimulationReady: true
  }
]

// PELVIC GIRDLE (2 bones)
export const pelvicGirdle: BiologicalElement[] = [
  {
    id: 'bone_os_coxae',
    name: 'Os Coxae / Hip Bones (2)',
    category: 'organs',
    subcategory: 'Appendicular - Pelvic Girdle',
    description: 'Each formed by fusion of ilium, ischium, and pubis at acetabulum; articulates with sacrum and femur.',
    location: ['Pelvis'],
    functions: ['Weight support', 'Hip joint socket', 'Muscle attachment', 'Organ protection'],
    interactions: ['Sacrum (SI joint)', 'Femur (hip joint)', 'Pubic symphysis', 'Pelvic floor'],
    diseaseLinks: ['Hip fractures', 'Pelvic fractures', 'Sacroiliitis', 'Hip dysplasia'],
    drugTargets: ['Hip replacement', 'ORIF'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  }
]

// LOWER LIMB (60 bones)
export const lowerLimb: BiologicalElement[] = [
  {
    id: 'bone_femur',
    name: 'Femur (2)',
    category: 'organs',
    subcategory: 'Appendicular - Lower Limb',
    description: 'Longest, strongest bone; head articulates with acetabulum, condyles with tibia.',
    location: ['Thigh'],
    functions: ['Weight bearing', 'Locomotion', 'Muscle attachment'],
    interactions: ['Hip joint', 'Knee joint', 'Quadriceps', 'Hamstrings', 'Adductors'],
    diseaseLinks: ['Hip fractures', 'Femoral shaft fractures', 'AVN femoral head'],
    drugTargets: ['Hip replacement', 'IM nailing'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_patella',
    name: 'Patella (2)',
    category: 'organs',
    subcategory: 'Appendicular - Lower Limb',
    description: 'Sesamoid bone within quadriceps tendon; largest sesamoid; protects knee and improves leverage.',
    location: ['Anterior knee'],
    functions: ['Quadriceps leverage', 'Knee protection', 'Knee extension mechanics'],
    interactions: ['Femur (patellofemoral joint)', 'Quadriceps tendon', 'Patellar tendon'],
    diseaseLinks: ['Patellar fracture', 'Patellofemoral syndrome', 'Patellar dislocation'],
    drugTargets: ['Physical therapy', 'ORIF'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_tibia',
    name: 'Tibia (2)',
    category: 'organs',
    subcategory: 'Appendicular - Lower Limb',
    description: 'Shinbone; medial weight-bearing leg bone; proximal plateau articulates with femur.',
    location: ['Medial leg'],
    functions: ['Primary weight bearing', 'Ankle joint formation', 'Muscle attachment'],
    interactions: ['Femur (knee)', 'Fibula', 'Talus (ankle)', 'Patellar tendon'],
    diseaseLinks: ['Tibial plateau fracture', 'Tibial shaft fracture', 'Shin splints'],
    drugTargets: ['IM nailing', 'ORIF'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_fibula',
    name: 'Fibula (2)',
    category: 'organs',
    subcategory: 'Appendicular - Lower Limb',
    description: 'Lateral leg bone; non-weight-bearing; lateral malleolus forms lateral ankle.',
    location: ['Lateral leg'],
    functions: ['Lateral ankle stability', 'Muscle attachment', 'Syndesmosis'],
    interactions: ['Tibia (syndesmosis)', 'Talus', 'Peroneal muscles'],
    diseaseLinks: ['Fibula fractures', 'Ankle fractures', 'High ankle sprain'],
    drugTargets: ['ORIF', 'Syndesmotic repair'],
    simulationParams: { baselineValue: 2, minValue: 2, maxValue: 2, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_tarsals',
    name: 'Tarsal Bones (14 total)',
    category: 'organs',
    subcategory: 'Appendicular - Lower Limb',
    description: 'Seven bones per foot: Talus, Calcaneus (heel), Navicular, Cuboid, 3 Cuneiforms (medial, intermediate, lateral).',
    location: ['Ankle and hindfoot/midfoot'],
    functions: ['Weight transmission', 'Arch support', 'Shock absorption', 'Gait mechanics'],
    interactions: ['Tibia/Fibula', 'Metatarsals', 'Numerous ligaments', 'Tendons'],
    diseaseLinks: ['Calcaneal fractures', 'Talar fractures', 'Tarsal coalition', 'Flat feet'],
    drugTargets: ['ORIF', 'Orthotics', 'Fusion'],
    simulationParams: { baselineValue: 14, minValue: 14, maxValue: 14, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_metatarsals',
    name: 'Metatarsals (10 total)',
    category: 'organs',
    subcategory: 'Appendicular - Lower Limb',
    description: 'Five bones per foot forming ball of foot; numbered I-V from great toe to little toe.',
    location: ['Forefoot'],
    functions: ['Weight distribution', 'Push-off in gait', 'Arch formation'],
    interactions: ['Tarsals', 'Proximal phalanges', 'Plantar fascia', 'Intrinsic muscles'],
    diseaseLinks: ['Metatarsal fractures', 'Jones fracture (5th MT)', 'Metatarsalgia', 'Bunion'],
    drugTargets: ['ORIF', 'Orthotics'],
    simulationParams: { baselineValue: 10, minValue: 10, maxValue: 10, unit: 'bones' },
    aiSimulationReady: true
  },
  {
    id: 'bone_phalanges_foot',
    name: 'Phalanges - Foot (28 total)',
    category: 'organs',
    subcategory: 'Appendicular - Lower Limb',
    description: 'Toe bones: 2 per great toe, 3 per lesser toes (proximal, middle, distal).',
    location: ['Toes'],
    functions: ['Balance', 'Push-off', 'Grip (minimal)'],
    interactions: ['Metatarsals', 'Flexor/extensor tendons'],
    diseaseLinks: ['Toe fractures', 'Hammer toe', 'Claw toe', 'Ingrown toenail'],
    drugTargets: ['Buddy taping', 'Surgical correction'],
    simulationParams: { baselineValue: 28, minValue: 28, maxValue: 28, unit: 'bones' },
    aiSimulationReady: true
  }
]

// Combine all skeletal elements
export const completeSkeleton: BiologicalElement[] = [
  ...neurocranium,
  ...viscerocranium,
  ...auditoryOssicles,
  ...vertebralColumn,
  ...thoracicCage,
  ...pectoralGirdle,
  ...upperLimb,
  ...pelvicGirdle,
  ...lowerLimb
]
