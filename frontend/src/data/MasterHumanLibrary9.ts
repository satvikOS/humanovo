// Master Human Library Part 9 - Myological System (Major Muscles)
import { BiologicalElement } from './MasterHumanLibrary'

// ==================== HEAD AND NECK MUSCLES ====================
export const headNeckMuscles: BiologicalElement[] = [
  // MUSCLES OF FACIAL EXPRESSION
  {
    id: 'muscle_frontalis',
    name: 'Frontalis',
    category: 'organs',
    subcategory: 'Muscular - Head/Facial Expression',
    description: 'Anterior belly of epicranius; raises eyebrows, wrinkles forehead. Connected to occipitalis via galea aponeurotica.',
    location: ['Forehead'],
    functions: ['Eyebrow elevation', 'Forehead wrinkling', 'Surprise expression'],
    interactions: ['Facial nerve (CN VII)', 'Galea aponeurotica', 'Occipitalis'],
    diseaseLinks: ['Facial nerve palsy', 'Botox cosmetic target'],
    drugTargets: ['Botulinum toxin'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_orbicularis_oculi',
    name: 'Orbicularis Oculi',
    category: 'organs',
    subcategory: 'Muscular - Head/Facial Expression',
    description: 'Sphincter muscle around eye; orbital part for forceful closure, palpebral part for blinking.',
    location: ['Surrounding eye orbit'],
    functions: ['Eye closure', 'Blinking', 'Tear drainage (lacrimal pump)'],
    interactions: ['Facial nerve (CN VII)', 'Levator palpebrae', 'Lacrimal apparatus'],
    diseaseLinks: ['Blepharospasm', 'Bell palsy', 'Lagophthalmos'],
    drugTargets: ['Botulinum toxin (blepharospasm)'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_orbicularis_oris',
    name: 'Orbicularis Oris',
    category: 'organs',
    subcategory: 'Muscular - Head/Facial Expression',
    description: 'Complex sphincter muscle of lips; closes mouth, puckers lips, essential for speech.',
    location: ['Lips'],
    functions: ['Lip closure', 'Puckering', 'Speech articulation', 'Kissing'],
    interactions: ['Facial nerve (CN VII)', 'Buccinator', 'Lip elevators/depressors'],
    diseaseLinks: ['Facial nerve palsy', 'Cleft lip'],
    drugTargets: ['Surgical repair'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  // MUSCLES OF MASTICATION
  {
    id: 'muscle_masseter',
    name: 'Masseter',
    category: 'organs',
    subcategory: 'Muscular - Head/Mastication',
    description: 'Powerful jaw elevator; most superficial mastication muscle; strongest muscle by force (based on size).',
    location: ['Lateral mandible/cheek'],
    functions: ['Jaw elevation (closing)', 'Mastication power stroke'],
    interactions: ['Trigeminal nerve (V3)', 'Mandible', 'Zygomatic arch'],
    diseaseLinks: ['TMJ disorders', 'Bruxism', 'Masseter hypertrophy'],
    drugTargets: ['Botulinum toxin (bruxism)', 'Muscle relaxants'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_temporalis',
    name: 'Temporalis',
    category: 'organs',
    subcategory: 'Muscular - Head/Mastication',
    description: 'Fan-shaped muscle from temporal fossa to coronoid process; elevates and retracts mandible.',
    location: ['Temporal fossa (side of head)'],
    functions: ['Jaw elevation', 'Jaw retraction', 'Positioning during chewing'],
    interactions: ['Trigeminal nerve (V3)', 'Mandible (coronoid)', 'Temporal bone'],
    diseaseLinks: ['TMJ disorders', 'Tension headaches', 'Temporal arteritis area'],
    drugTargets: ['Botulinum toxin', 'NSAIDs'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_pterygoid_medial',
    name: 'Medial Pterygoid',
    category: 'organs',
    subcategory: 'Muscular - Head/Mastication',
    description: 'Deep muscle assisting jaw elevation; works with masseter in power closure.',
    location: ['Medial to mandibular ramus'],
    functions: ['Jaw elevation', 'Lateral jaw movement (with lateral pterygoid)'],
    interactions: ['Trigeminal nerve (V3)', 'Mandible', 'Pterygoid plate'],
    diseaseLinks: ['TMJ disorders', 'Trismus'],
    drugTargets: ['Muscle relaxants'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_pterygoid_lateral',
    name: 'Lateral Pterygoid',
    category: 'organs',
    subcategory: 'Muscular - Head/Mastication',
    description: 'Two-headed muscle; protrudes mandible and opens mouth; only jaw opener via mastication muscles.',
    location: ['Lateral to medial pterygoid'],
    functions: ['Jaw protrusion', 'Jaw depression (opening)', 'Lateral deviation', 'TMJ disc movement'],
    interactions: ['Trigeminal nerve (V3)', 'TMJ disc', 'Mandibular condyle'],
    diseaseLinks: ['TMJ disorders', 'TMJ disc displacement'],
    drugTargets: ['Physical therapy', 'Arthrocentesis'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  // NECK MUSCLES
  {
    id: 'muscle_sternocleidomastoid',
    name: 'Sternocleidomastoid (SCM)',
    category: 'organs',
    subcategory: 'Muscular - Neck',
    description: 'Prominent neck muscle; unilateral contraction rotates head contralaterally; bilateral flexes neck.',
    location: ['Lateral neck'],
    functions: ['Head rotation (opposite side)', 'Neck flexion (bilateral)', 'Head tilting'],
    interactions: ['Accessory nerve (CN XI)', 'C2-C3 ventral rami', 'Sternum', 'Clavicle', 'Mastoid'],
    diseaseLinks: ['Torticollis', 'SCM tumor (mass)', 'Accessory nerve injury'],
    drugTargets: ['Botulinum toxin (torticollis)', 'Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_trapezius',
    name: 'Trapezius',
    category: 'organs',
    subcategory: 'Muscular - Neck/Back',
    description: 'Large superficial back muscle; upper fibers elevate, middle retract, lower depress scapula.',
    location: ['Posterior neck and upper back'],
    functions: ['Scapular elevation', 'Scapular retraction', 'Scapular depression', 'Head extension (bilateral)'],
    interactions: ['Accessory nerve (CN XI)', 'C3-C4', 'Occipital bone', 'Scapular spine', 'Clavicle'],
    diseaseLinks: ['Trapezius strain', 'Accessory nerve injury', 'Myofascial pain'],
    drugTargets: ['Physical therapy', 'Trigger point injection'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_splenius_capitis',
    name: 'Splenius Capitis',
    category: 'organs',
    subcategory: 'Muscular - Neck',
    description: 'Posterior neck muscle; bilateral extends head, unilateral rotates head to same side.',
    location: ['Posterior neck deep to trapezius'],
    functions: ['Head extension', 'Head rotation (ipsilateral)', 'Lateral flexion'],
    interactions: ['Posterior rami C3-C5', 'Spinous processes', 'Mastoid process'],
    diseaseLinks: ['Neck strain', 'Cervicogenic headache'],
    drugTargets: ['Physical therapy', 'NSAIDs'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  }
]

// ==================== THORAX AND ABDOMEN MUSCLES ====================
export const thoraxAbdomenMuscles: BiologicalElement[] = [
  // RESPIRATORY MUSCLES
  {
    id: 'muscle_diaphragm',
    name: 'Diaphragm',
    category: 'organs',
    subcategory: 'Muscular - Respiratory',
    description: 'Primary respiratory muscle; dome-shaped separating thorax from abdomen; contraction causes inspiration.',
    location: ['Inferior thorax (thoracoabdominal junction)'],
    functions: ['Inspiration (primary)', 'Abdominal pressure increase', 'Vena cava/aorta/esophagus passage'],
    interactions: ['Phrenic nerve (C3-C5)', 'Central tendon', 'Ribs', 'Lumbar vertebrae'],
    diseaseLinks: ['Diaphragmatic paralysis', 'Hiatal hernia', 'Respiratory failure'],
    drugTargets: ['Diaphragm pacing'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_intercostals_external',
    name: 'External Intercostals',
    category: 'organs',
    subcategory: 'Muscular - Respiratory',
    description: 'Eleven pairs; fibers run inferoanteriorly; elevate ribs during inspiration.',
    location: ['Between ribs (superficial)'],
    functions: ['Rib elevation', 'Inspiration assistance', 'Chest wall stabilization'],
    interactions: ['Intercostal nerves', 'Ribs', 'Internal intercostals'],
    diseaseLinks: ['Intercostal neuralgia', 'Rib fractures', 'Costochondritis'],
    drugTargets: ['Intercostal nerve block'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_intercostals_internal',
    name: 'Internal Intercostals',
    category: 'organs',
    subcategory: 'Muscular - Respiratory',
    description: 'Eleven pairs deep to external; fibers run inferoposteriorly; depress ribs during forced expiration.',
    location: ['Between ribs (deep)'],
    functions: ['Rib depression', 'Forced expiration', 'Chest wall stabilization'],
    interactions: ['Intercostal nerves', 'Ribs', 'External intercostals'],
    diseaseLinks: ['Intercostal neuralgia'],
    drugTargets: ['Intercostal nerve block'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  // ABDOMINAL MUSCLES
  {
    id: 'muscle_rectus_abdominis',
    name: 'Rectus Abdominis',
    category: 'organs',
    subcategory: 'Muscular - Abdominal',
    description: '"Six-pack" muscle; paired vertical muscles with tendinous intersections; flexes trunk.',
    location: ['Anterior abdomen'],
    functions: ['Trunk flexion', 'Abdominal compression', 'Pelvic tilt', 'Forced expiration'],
    interactions: ['Thoracoabdominal nerves (T7-T12)', 'Pubis', 'Costal cartilages 5-7'],
    diseaseLinks: ['Diastasis recti', 'Abdominal hernia', 'Rectus sheath hematoma'],
    drugTargets: ['Core strengthening'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_external_oblique',
    name: 'External Oblique',
    category: 'organs',
    subcategory: 'Muscular - Abdominal',
    description: 'Largest and most superficial anterolateral abdominal muscle; fibers run inferomedially.',
    location: ['Lateral abdomen'],
    functions: ['Trunk rotation (contralateral)', 'Lateral flexion', 'Abdominal compression'],
    interactions: ['Thoracoabdominal nerves (T7-T12)', 'Ribs 5-12', 'Iliac crest', 'Linea alba'],
    diseaseLinks: ['Oblique strain', 'Inguinal hernia (external ring)'],
    drugTargets: ['Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_internal_oblique',
    name: 'Internal Oblique',
    category: 'organs',
    subcategory: 'Muscular - Abdominal',
    description: 'Middle layer; fibers run superomedially (perpendicular to external oblique).',
    location: ['Deep to external oblique'],
    functions: ['Trunk rotation (ipsilateral)', 'Lateral flexion', 'Abdominal compression'],
    interactions: ['Thoracoabdominal nerves (T7-T12)', 'L1', 'Iliac crest', 'Thoracolumbar fascia'],
    diseaseLinks: ['Oblique strain', 'Inguinal hernia'],
    drugTargets: ['Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_transversus_abdominis',
    name: 'Transversus Abdominis',
    category: 'organs',
    subcategory: 'Muscular - Abdominal',
    description: 'Deepest abdominal muscle; fibers run horizontally; primary core stabilizer.',
    location: ['Deepest anterolateral abdomen'],
    functions: ['Abdominal compression', 'Core stabilization', 'Forced expiration', 'Intra-abdominal pressure'],
    interactions: ['Thoracoabdominal nerves (T7-T12)', 'L1', 'Iliac crest', 'Costal cartilages 7-12'],
    diseaseLinks: ['Core weakness', 'Low back pain'],
    drugTargets: ['Core stabilization exercises'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  }
]

// ==================== UPPER LIMB MUSCLES ====================
export const upperLimbMuscles: BiologicalElement[] = [
  // SHOULDER MUSCLES
  {
    id: 'muscle_deltoid',
    name: 'Deltoid',
    category: 'organs',
    subcategory: 'Muscular - Shoulder',
    description: 'Triangular shoulder muscle; anterior (flexion), middle (abduction), posterior (extension) portions.',
    location: ['Covering shoulder joint'],
    functions: ['Arm abduction (0-15° then supraspinatus, 15-90°)', 'Flexion (anterior)', 'Extension (posterior)'],
    interactions: ['Axillary nerve (C5-C6)', 'Clavicle', 'Acromion', 'Scapular spine', 'Deltoid tuberosity'],
    diseaseLinks: ['Deltoid strain', 'Axillary nerve injury', 'IM injection site'],
    drugTargets: ['IM injection site'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_pectoralis_major',
    name: 'Pectoralis Major',
    category: 'organs',
    subcategory: 'Muscular - Shoulder',
    description: 'Large fan-shaped chest muscle; clavicular and sternocostal heads; powerful adductor and flexor.',
    location: ['Anterior chest'],
    functions: ['Arm adduction', 'Arm medial rotation', 'Arm flexion (clavicular)', 'Arm extension (from flexed)'],
    interactions: ['Medial and lateral pectoral nerves', 'Clavicle', 'Sternum', 'Costal cartilages', 'Humerus'],
    diseaseLinks: ['Pec tear', 'Poland syndrome'],
    drugTargets: ['Surgical repair'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_latissimus_dorsi',
    name: 'Latissimus Dorsi',
    category: 'organs',
    subcategory: 'Muscular - Shoulder/Back',
    description: 'Broadest back muscle; powerful extensor, adductor, and medial rotator of arm.',
    location: ['Lower back, lateral trunk'],
    functions: ['Arm extension', 'Arm adduction', 'Arm medial rotation', 'Climbing'],
    interactions: ['Thoracodorsal nerve (C6-C8)', 'Spinous processes T7-L5', 'Iliac crest', 'Humerus'],
    diseaseLinks: ['Lat strain', 'Thoracodorsal nerve injury'],
    drugTargets: ['Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  // ROTATOR CUFF (SITS)
  {
    id: 'muscle_supraspinatus',
    name: 'Supraspinatus',
    category: 'organs',
    subcategory: 'Muscular - Rotator Cuff',
    description: 'Initiates arm abduction (first 15°); most commonly torn rotator cuff muscle.',
    location: ['Supraspinous fossa to greater tubercle'],
    functions: ['Arm abduction initiation', 'Humeral head stabilization'],
    interactions: ['Suprascapular nerve (C5-C6)', 'Scapula', 'Humerus (greater tubercle)'],
    diseaseLinks: ['Rotator cuff tear', 'Impingement syndrome', 'Suprascapular neuropathy'],
    drugTargets: ['Physical therapy', 'Corticosteroid injection', 'Surgical repair'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_infraspinatus',
    name: 'Infraspinatus',
    category: 'organs',
    subcategory: 'Muscular - Rotator Cuff',
    description: 'Primary external rotator of arm; covers infraspinous fossa.',
    location: ['Infraspinous fossa to greater tubercle'],
    functions: ['Arm external rotation', 'Humeral head stabilization'],
    interactions: ['Suprascapular nerve (C5-C6)', 'Scapula', 'Humerus (greater tubercle)'],
    diseaseLinks: ['Rotator cuff tear', 'Infraspinatus atrophy'],
    drugTargets: ['Physical therapy', 'Surgical repair'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_teres_minor',
    name: 'Teres Minor',
    category: 'organs',
    subcategory: 'Muscular - Rotator Cuff',
    description: 'Small external rotator; assists infraspinatus.',
    location: ['Lateral scapular border to greater tubercle'],
    functions: ['Arm external rotation', 'Humeral head stabilization'],
    interactions: ['Axillary nerve (C5-C6)', 'Scapula', 'Humerus (greater tubercle)'],
    diseaseLinks: ['Rotator cuff pathology', 'Quadrilateral space syndrome'],
    drugTargets: ['Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_subscapularis',
    name: 'Subscapularis',
    category: 'organs',
    subcategory: 'Muscular - Rotator Cuff',
    description: 'Largest rotator cuff muscle; covers anterior scapula; primary internal rotator.',
    location: ['Subscapular fossa to lesser tubercle'],
    functions: ['Arm internal rotation', 'Humeral head stabilization'],
    interactions: ['Upper and lower subscapular nerves (C5-C7)', 'Scapula', 'Humerus (lesser tubercle)'],
    diseaseLinks: ['Subscapularis tear', 'Internal impingement'],
    drugTargets: ['Physical therapy', 'Surgical repair'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  // ARM MUSCLES
  {
    id: 'muscle_biceps_brachii',
    name: 'Biceps Brachii',
    category: 'organs',
    subcategory: 'Muscular - Arm Anterior',
    description: 'Two-headed arm flexor; long head from supraglenoid, short head from coracoid; powerful supinator.',
    location: ['Anterior arm'],
    functions: ['Elbow flexion', 'Forearm supination', 'Shoulder flexion (weak)'],
    interactions: ['Musculocutaneous nerve (C5-C6)', 'Scapula', 'Radial tuberosity'],
    diseaseLinks: ['Biceps tendon rupture', 'Biceps tendinitis', 'SLAP tear (long head)'],
    drugTargets: ['Tenodesis', 'Tenotomy', 'SLAP repair'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_brachialis',
    name: 'Brachialis',
    category: 'organs',
    subcategory: 'Muscular - Arm Anterior',
    description: 'Deep to biceps; pure elbow flexor regardless of forearm position; strongest elbow flexor.',
    location: ['Anterior arm deep to biceps'],
    functions: ['Elbow flexion (primary)'],
    interactions: ['Musculocutaneous nerve (C5-C6)', 'Radial nerve (small)', 'Humerus', 'Ulnar tuberosity'],
    diseaseLinks: ['Brachialis strain', 'Elbow contracture'],
    drugTargets: ['Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_triceps_brachii',
    name: 'Triceps Brachii',
    category: 'organs',
    subcategory: 'Muscular - Arm Posterior',
    description: 'Three-headed elbow extensor; long head from infraglenoid; medial and lateral heads from humerus.',
    location: ['Posterior arm'],
    functions: ['Elbow extension', 'Shoulder extension (long head)'],
    interactions: ['Radial nerve (C6-C8)', 'Scapula', 'Humerus', 'Olecranon'],
    diseaseLinks: ['Triceps rupture', 'Radial nerve palsy'],
    drugTargets: ['Surgical repair', 'Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  }
]

// ==================== LOWER LIMB MUSCLES ====================
export const lowerLimbMuscles: BiologicalElement[] = [
  // GLUTEAL MUSCLES
  {
    id: 'muscle_gluteus_maximus',
    name: 'Gluteus Maximus',
    category: 'organs',
    subcategory: 'Muscular - Gluteal',
    description: 'Largest and most superficial gluteal muscle; powerful hip extensor; essential for climbing and standing from sitting.',
    location: ['Buttock'],
    functions: ['Hip extension', 'Hip lateral rotation', 'Hip abduction (upper)', 'Standing from sitting'],
    interactions: ['Inferior gluteal nerve (L5-S2)', 'Ilium', 'Sacrum', 'IT band', 'Gluteal tuberosity'],
    diseaseLinks: ['Gluteus maximus weakness', 'Piriformis syndrome area'],
    drugTargets: ['IM injection site', 'Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_gluteus_medius',
    name: 'Gluteus Medius',
    category: 'organs',
    subcategory: 'Muscular - Gluteal',
    description: 'Primary hip abductor; stabilizes pelvis during single-leg stance (Trendelenburg test).',
    location: ['Lateral hip'],
    functions: ['Hip abduction', 'Hip medial rotation (anterior)', 'Pelvic stabilization'],
    interactions: ['Superior gluteal nerve (L4-S1)', 'Ilium', 'Greater trochanter'],
    diseaseLinks: ['Trendelenburg gait', 'Hip abductor weakness', 'Greater trochanteric bursitis'],
    drugTargets: ['Physical therapy', 'Trochanteric bursa injection'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_gluteus_minimus',
    name: 'Gluteus Minimus',
    category: 'organs',
    subcategory: 'Muscular - Gluteal',
    description: 'Smallest and deepest gluteal muscle; assists medius in abduction and medial rotation.',
    location: ['Deep lateral hip'],
    functions: ['Hip abduction', 'Hip medial rotation'],
    interactions: ['Superior gluteal nerve (L4-S1)', 'Ilium', 'Greater trochanter'],
    diseaseLinks: ['Hip abductor weakness'],
    drugTargets: ['Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  // QUADRICEPS (Knee Extensors)
  {
    id: 'muscle_rectus_femoris',
    name: 'Rectus Femoris',
    category: 'organs',
    subcategory: 'Muscular - Quadriceps',
    description: 'Only quadriceps crossing both hip and knee; flexes hip, extends knee.',
    location: ['Anterior thigh (superficial)'],
    functions: ['Knee extension', 'Hip flexion'],
    interactions: ['Femoral nerve (L2-L4)', 'AIIS', 'Patella', 'Tibial tuberosity'],
    diseaseLinks: ['Rectus femoris strain', 'Patellofemoral syndrome'],
    drugTargets: ['Physical therapy', 'RICE protocol'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_vastus_lateralis',
    name: 'Vastus Lateralis',
    category: 'organs',
    subcategory: 'Muscular - Quadriceps',
    description: 'Largest quadriceps component; lateral thigh; common IM injection site.',
    location: ['Lateral thigh'],
    functions: ['Knee extension'],
    interactions: ['Femoral nerve (L2-L4)', 'Femur (linea aspera)', 'Patella'],
    diseaseLinks: ['Quadriceps weakness', 'Patellofemoral syndrome'],
    drugTargets: ['IM injection site'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_vastus_medialis',
    name: 'Vastus Medialis',
    category: 'organs',
    subcategory: 'Muscular - Quadriceps',
    description: 'Medial quadriceps; VMO (vastus medialis obliquus) portion stabilizes patella.',
    location: ['Medial thigh'],
    functions: ['Knee extension', 'Patellar tracking stabilization'],
    interactions: ['Femoral nerve (L2-L4)', 'Femur (linea aspera)', 'Patella'],
    diseaseLinks: ['VMO weakness', 'Patellofemoral syndrome', 'Patellar instability'],
    drugTargets: ['VMO strengthening exercises'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_vastus_intermedius',
    name: 'Vastus Intermedius',
    category: 'organs',
    subcategory: 'Muscular - Quadriceps',
    description: 'Deep quadriceps component; lies between vastus lateralis and medialis.',
    location: ['Deep anterior thigh'],
    functions: ['Knee extension'],
    interactions: ['Femoral nerve (L2-L4)', 'Femur (anterior surface)', 'Patella'],
    diseaseLinks: ['Quadriceps weakness'],
    drugTargets: ['Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  // HAMSTRINGS (Knee Flexors)
  {
    id: 'muscle_biceps_femoris',
    name: 'Biceps Femoris',
    category: 'organs',
    subcategory: 'Muscular - Hamstrings',
    description: 'Lateral hamstring; long head from ischial tuberosity, short head from femur; flexes knee, extends hip.',
    location: ['Posterior lateral thigh'],
    functions: ['Knee flexion', 'Hip extension (long head)', 'Knee lateral rotation'],
    interactions: ['Tibial nerve (long head)', 'Common fibular nerve (short head)', 'Ischial tuberosity', 'Fibular head'],
    diseaseLinks: ['Hamstring strain', 'Proximal hamstring rupture'],
    drugTargets: ['Physical therapy', 'PRP injection', 'Surgical repair'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_semitendinosus',
    name: 'Semitendinosus',
    category: 'organs',
    subcategory: 'Muscular - Hamstrings',
    description: 'Medial hamstring with long distal tendon; used for ACL reconstruction graft.',
    location: ['Posterior medial thigh'],
    functions: ['Knee flexion', 'Hip extension', 'Knee medial rotation'],
    interactions: ['Tibial nerve (L5-S2)', 'Ischial tuberosity', 'Pes anserinus (tibia)'],
    diseaseLinks: ['Hamstring strain', 'ACL graft donor site'],
    drugTargets: ['ACL reconstruction graft'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_semimembranosus',
    name: 'Semimembranosus',
    category: 'organs',
    subcategory: 'Muscular - Hamstrings',
    description: 'Deep medial hamstring; membranous proximal tendon.',
    location: ['Deep posterior medial thigh'],
    functions: ['Knee flexion', 'Hip extension', 'Knee medial rotation'],
    interactions: ['Tibial nerve (L5-S2)', 'Ischial tuberosity', 'Medial tibial condyle'],
    diseaseLinks: ['Hamstring strain'],
    drugTargets: ['Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  // CALF MUSCLES
  {
    id: 'muscle_gastrocnemius',
    name: 'Gastrocnemius',
    category: 'organs',
    subcategory: 'Muscular - Calf',
    description: 'Superficial two-headed calf muscle; crosses knee and ankle; powerful plantar flexor.',
    location: ['Posterior leg (calf)'],
    functions: ['Ankle plantar flexion', 'Knee flexion (weak)'],
    interactions: ['Tibial nerve (S1-S2)', 'Femoral condyles', 'Calcaneus (via Achilles)'],
    diseaseLinks: ['Gastrocnemius strain (tennis leg)', 'Achilles tendinopathy'],
    drugTargets: ['RICE', 'Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_soleus',
    name: 'Soleus',
    category: 'organs',
    subcategory: 'Muscular - Calf',
    description: 'Deep calf muscle; single-joint ankle plantar flexor; postural muscle.',
    location: ['Deep to gastrocnemius'],
    functions: ['Ankle plantar flexion', 'Postural stabilization'],
    interactions: ['Tibial nerve (S1-S2)', 'Tibia/Fibula', 'Calcaneus (via Achilles)'],
    diseaseLinks: ['Soleus strain', 'Deep vein thrombosis (soleal veins)'],
    drugTargets: ['Compression stockings', 'Physical therapy'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  },
  {
    id: 'muscle_tibialis_anterior',
    name: 'Tibialis Anterior',
    category: 'organs',
    subcategory: 'Muscular - Leg Anterior',
    description: 'Primary dorsiflexor; inverts foot; visible tendon crossing ankle.',
    location: ['Anterior leg'],
    functions: ['Ankle dorsiflexion', 'Foot inversion'],
    interactions: ['Deep fibular nerve (L4-L5)', 'Tibia', 'Medial cuneiform/1st metatarsal'],
    diseaseLinks: ['Foot drop', 'Tibialis anterior tendinopathy', 'Anterior compartment syndrome'],
    drugTargets: ['AFO (foot drop)', 'Fasciotomy (compartment syndrome)'],
    simulationParams: { baselineValue: 100, minValue: 0, maxValue: 100, unit: '% activation' },
    aiSimulationReady: true
  }
]

// Combine all muscles
export const completeMuscularSystem: BiologicalElement[] = [
  ...headNeckMuscles,
  ...thoraxAbdomenMuscles,
  ...upperLimbMuscles,
  ...lowerLimbMuscles
]
