// @ts-nocheck
/**
 * 3D Model Loader Utilities
 *
 * Supports loading various 3D model formats for the anatomy viewer:
 * - GLB/GLTF: Recommended format, widely supported
 * - OBJ: Common format, may need MTL files for materials
 * - STL: Simple geometry, no colors/textures
 * - FBX: Complex scenes with animations
 *
 * For .stz files (compressed/archive format), extract to standard formats first.
 */

import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import * as THREE from 'three'

// Model format types
export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'fbx'

// Model metadata interface
export interface ModelMetadata {
  id: string
  name: string
  format: ModelFormat
  url: string
  system: string // Anatomical system (skeletal, muscular, etc.)
  region?: string // Body region
  side?: 'left' | 'right' | 'center'
  attribution?: string // License attribution
  source?: string // Data source (e.g., BP3D)
}

// Loaded model result
export interface LoadedModel {
  metadata: ModelMetadata
  object: THREE.Object3D
  boundingBox: THREE.Box3
}

// Loader cache for performance
const loaderCache: {
  gltf?: GLTFLoader
  obj?: OBJLoader
  stl?: STLLoader
  fbx?: FBXLoader
  draco?: DRACOLoader
} = {}

/**
 * Get or create DRACO loader for compressed GLTF files
 */
function getDracoLoader(): DRACOLoader {
  if (!loaderCache.draco) {
    loaderCache.draco = new DRACOLoader()
    // Use CDN for Draco decoder
    loaderCache.draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
  }
  return loaderCache.draco
}

/**
 * Get or create GLTF loader
 */
function getGLTFLoader(): GLTFLoader {
  if (!loaderCache.gltf) {
    loaderCache.gltf = new GLTFLoader()
    loaderCache.gltf.setDRACOLoader(getDracoLoader())
  }
  return loaderCache.gltf
}

/**
 * Get or create OBJ loader
 */
function getOBJLoader(): OBJLoader {
  if (!loaderCache.obj) {
    loaderCache.obj = new OBJLoader()
  }
  return loaderCache.obj
}

/**
 * Get or create STL loader
 */
function getSTLLoader(): STLLoader {
  if (!loaderCache.stl) {
    loaderCache.stl = new STLLoader()
  }
  return loaderCache.stl
}

/**
 * Get or create FBX loader
 */
function getFBXLoader(): FBXLoader {
  if (!loaderCache.fbx) {
    loaderCache.fbx = new FBXLoader()
  }
  return loaderCache.fbx
}

/**
 * Detect model format from URL or file extension
 */
export function detectModelFormat(url: string): ModelFormat | null {
  const extension = url.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'glb':
    case 'gltf':
      return 'glb'
    case 'obj':
      return 'obj'
    case 'stl':
      return 'stl'
    case 'fbx':
      return 'fbx'
    default:
      return null
  }
}

/**
 * Load a GLTF/GLB model
 */
async function loadGLTF(url: string): Promise<GLTF> {
  const loader = getGLTFLoader()
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf),
      undefined,
      (error) => reject(error)
    )
  })
}

/**
 * Load an OBJ model
 */
async function loadOBJ(url: string): Promise<THREE.Group> {
  const loader = getOBJLoader()
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (obj) => resolve(obj),
      undefined,
      (error) => reject(error)
    )
  })
}

/**
 * Load an STL model
 */
async function loadSTL(url: string): Promise<THREE.BufferGeometry> {
  const loader = getSTLLoader()
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (geometry) => resolve(geometry),
      undefined,
      (error) => reject(error)
    )
  })
}

/**
 * Load an FBX model
 */
async function loadFBX(url: string): Promise<THREE.Group> {
  const loader = getFBXLoader()
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (fbx) => resolve(fbx),
      undefined,
      (error) => reject(error)
    )
  })
}

/**
 * Load a 3D model with automatic format detection
 */
export async function loadModel(metadata: ModelMetadata): Promise<LoadedModel> {
  const format = metadata.format || detectModelFormat(metadata.url)

  if (!format) {
    throw new Error(`Unable to detect format for model: ${metadata.url}`)
  }

  let object: THREE.Object3D

  switch (format) {
    case 'glb':
    case 'gltf': {
      const gltf = await loadGLTF(metadata.url)
      object = gltf.scene
      break
    }
    case 'obj': {
      object = await loadOBJ(metadata.url)
      break
    }
    case 'stl': {
      const geometry = await loadSTL(metadata.url)
      // Create mesh with default material for STL
      const material = new THREE.MeshStandardMaterial({
        color: 0xf5f5dc, // Bone color
        roughness: 0.4,
        metalness: 0.1
      })
      object = new THREE.Mesh(geometry, material)
      break
    }
    case 'fbx': {
      object = await loadFBX(metadata.url)
      break
    }
    default:
      throw new Error(`Unsupported model format: ${format}`)
  }

  // Calculate bounding box
  const boundingBox = new THREE.Box3()
  if (object instanceof THREE.Object3D) {
    boundingBox.setFromObject(object)
  }

  return {
    metadata,
    object,
    boundingBox
  }
}

/**
 * Load multiple models in parallel
 */
export async function loadModels(metadataList: ModelMetadata[]): Promise<LoadedModel[]> {
  const results = await Promise.allSettled(
    metadataList.map(metadata => loadModel(metadata))
  )

  return results
    .filter((result): result is PromiseFulfilledResult<LoadedModel> =>
      result.status === 'fulfilled'
    )
    .map(result => result.value)
}

/**
 * Apply default material to a model based on anatomical system
 */
export function applySystemMaterial(
  object: THREE.Object3D,
  system: string,
  options: { opacity?: number; wireframe?: boolean } = {}
): void {
  const colors: Record<string, number> = {
    skeletal: 0xf5f5dc,     // Beige
    muscular: 0xcd5c5c,     // Indian Red
    nervous: 0xffd700,      // Gold
    circulatory: 0xdc143c,  // Crimson
    lymphatic: 0x90ee90,    // Light Green
    respiratory: 0x87ceeb,  // Sky Blue
    digestive: 0xdeb887,    // Burlywood
    integumentary: 0xffdab9,// Peach
    organs: 0xe6a8d7        // Pink
  }

  const color = colors[system] || 0xcccccc

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.5,
        metalness: 0.1,
        transparent: options.opacity !== undefined && options.opacity < 1,
        opacity: options.opacity ?? 1,
        wireframe: options.wireframe ?? false,
        side: THREE.DoubleSide
      })
    }
  })
}

/**
 * Center and normalize model size
 */
export function normalizeModel(object: THREE.Object3D, targetSize: number = 2): void {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  // Center the model
  object.position.sub(center)

  // Scale to target size
  const maxDim = Math.max(size.x, size.y, size.z)
  if (maxDim > 0) {
    const scale = targetSize / maxDim
    object.scale.multiplyScalar(scale)
  }
}

/**
 * Dispose of model resources
 */
export function disposeModel(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      if (Array.isArray(child.material)) {
        child.material.forEach(mat => mat.dispose())
      } else {
        child.material.dispose()
      }
    }
  })
}
