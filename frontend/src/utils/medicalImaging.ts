// ═══════════════════════════════════════════════════════════════════════
// Medical Imaging Format Parsers
// Minimal but functional readers for DICOM, NIfTI-1, and TIFF.
// Converts to a normalized { width, height, pixels: Uint8ClampedArray (RGBA) }
// representation that can be rendered directly on a canvas.
// All parsing is client-side — no backend required.
// ═══════════════════════════════════════════════════════════════════════

export interface ParsedImage {
  width: number
  height: number
  pixels: Uint8ClampedArray  // RGBA, width*height*4 bytes
  meta: {
    modality?: string
    windowCenter?: number
    windowWidth?: number
    slices?: number
    sliceIndex?: number
    bitsPerSample?: number
    format: 'dicom' | 'nifti' | 'tiff' | 'native'
  }
}

function readString(view: DataView, offset: number, length: number): string {
  let s = ''
  for (let i = 0; i < length && offset + i < view.byteLength; i++) {
    const c = view.getUint8(offset + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

function pixelsToDataURL(p: ParsedImage): string {
  const canvas = document.createElement('canvas')
  canvas.width = p.width
  canvas.height = p.height
  const ctx = canvas.getContext('2d')!
  const imgData = new ImageData(p.pixels, p.width, p.height)
  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

export function parsedToDataURL(p: ParsedImage): string {
  return pixelsToDataURL(p)
}

// ─── DICOM ──────────────────────────────────────────────────────────────
// Handles the common case: preamble + DICM magic, explicit VR little
// endian, uncompressed monochrome or RGB pixel data, 8 or 16 bit allocated.
// This covers the vast majority of real-world exported DICOM files.
export function parseDICOM(buffer: ArrayBuffer): ParsedImage | null {
  if (buffer.byteLength < 140) return null
  const view = new DataView(buffer)
  // DICM magic lives at bytes 128..131 (after 128-byte preamble)
  const magic =
    String.fromCharCode(view.getUint8(128)) +
    String.fromCharCode(view.getUint8(129)) +
    String.fromCharCode(view.getUint8(130)) +
    String.fromCharCode(view.getUint8(131))
  if (magic !== 'DICM') return null

  let offset = 132
  let width = 0
  let height = 0
  let bitsAllocated = 8
  let bitsStored = 8
  let pixelRepresentation = 0
  let samplesPerPixel = 1
  let windowCenter = NaN
  let windowWidth = NaN
  let rescaleSlope = 1
  let rescaleIntercept = 0
  let modality = ''
  let photometric = 'MONOCHROME2'
  let pixelDataOffset = 0
  let pixelDataLength = 0

  // Value Representations that use 4-byte length (OB/OW/OF/SQ/UT/UN/OD/OL)
  const longVRs = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN', 'OD', 'OL'])

  while (offset + 8 <= view.byteLength) {
    const group = view.getUint16(offset, true)
    const element = view.getUint16(offset + 2, true)
    const vr =
      String.fromCharCode(view.getUint8(offset + 4)) +
      String.fromCharCode(view.getUint8(offset + 5))

    let length: number
    let dataStart: number

    if (longVRs.has(vr)) {
      length = view.getUint32(offset + 8, true)
      dataStart = offset + 12
    } else if (/^[A-Z]{2}$/.test(vr)) {
      length = view.getUint16(offset + 6, true)
      dataStart = offset + 8
    } else {
      // Implicit VR fallback: group(2) element(2) length(4)
      length = view.getUint32(offset + 4, true)
      dataStart = offset + 8
    }

    const tag = (group << 16) | element

    // Pixel Data — stop here, we've captured all meta we need
    if (tag === 0x7fe00010) {
      pixelDataOffset = dataStart
      pixelDataLength =
        length === 0xffffffff ? view.byteLength - dataStart : length
      break
    }

    // Sequence items with undefined length — skip the delimiter dance
    if (length === 0xffffffff) {
      offset = dataStart
      continue
    }

    try {
      if (tag === 0x00080060) modality = readString(view, dataStart, length).trim()
      else if (tag === 0x00280002) samplesPerPixel = view.getUint16(dataStart, true)
      else if (tag === 0x00280004) photometric = readString(view, dataStart, length).trim()
      else if (tag === 0x00280010) height = view.getUint16(dataStart, true)
      else if (tag === 0x00280011) width = view.getUint16(dataStart, true)
      else if (tag === 0x00280100) bitsAllocated = view.getUint16(dataStart, true)
      else if (tag === 0x00280101) bitsStored = view.getUint16(dataStart, true)
      else if (tag === 0x00280103) pixelRepresentation = view.getUint16(dataStart, true)
      else if (tag === 0x00281050) {
        const s = readString(view, dataStart, length)
        const v = parseFloat(s.split('\\')[0])
        if (!isNaN(v)) windowCenter = v
      } else if (tag === 0x00281051) {
        const s = readString(view, dataStart, length)
        const v = parseFloat(s.split('\\')[0])
        if (!isNaN(v)) windowWidth = v
      } else if (tag === 0x00281052) {
        const v = parseFloat(readString(view, dataStart, length))
        if (!isNaN(v)) rescaleIntercept = v
      } else if (tag === 0x00281053) {
        const v = parseFloat(readString(view, dataStart, length))
        if (!isNaN(v)) rescaleSlope = v
      }
    } catch {
      /* ignore malformed element */
    }

    offset = dataStart + length
    if (length < 0) break
  }

  if (!width || !height || !pixelDataLength) return null

  const numPixels = width * height
  const pixels = new Uint8ClampedArray(numPixels * 4)

  if (bitsAllocated === 16) {
    // Read as Int16 or Uint16 using DataView (no alignment requirement)
    const values = new Float32Array(numPixels)
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < numPixels; i++) {
      const byteIdx = pixelDataOffset + i * 2
      const raw = pixelRepresentation === 1
        ? view.getInt16(byteIdx, true)
        : view.getUint16(byteIdx, true)
      const v = raw * rescaleSlope + rescaleIntercept
      values[i] = v
      if (v < min) min = v
      if (v > max) max = v
    }

    // Use windowing from DICOM if present, otherwise auto
    let lo: number
    let hi: number
    if (!isNaN(windowCenter) && !isNaN(windowWidth) && windowWidth > 0) {
      lo = windowCenter - windowWidth / 2
      hi = windowCenter + windowWidth / 2
    } else {
      lo = min
      hi = max
      windowCenter = (min + max) / 2
      windowWidth = max - min
    }
    const span = hi - lo || 1

    const invert = photometric === 'MONOCHROME1'
    for (let i = 0; i < numPixels; i++) {
      let g = Math.round(((values[i] - lo) / span) * 255)
      if (g < 0) g = 0
      else if (g > 255) g = 255
      if (invert) g = 255 - g
      const o = i * 4
      pixels[o] = g
      pixels[o + 1] = g
      pixels[o + 2] = g
      pixels[o + 3] = 255
    }
  } else if (bitsAllocated === 8) {
    if (samplesPerPixel === 1) {
      const invert = photometric === 'MONOCHROME1'
      for (let i = 0; i < numPixels; i++) {
        let g = view.getUint8(pixelDataOffset + i)
        if (invert) g = 255 - g
        const o = i * 4
        pixels[o] = g
        pixels[o + 1] = g
        pixels[o + 2] = g
        pixels[o + 3] = 255
      }
      if (isNaN(windowCenter)) {
        windowCenter = 128
        windowWidth = 256
      }
    } else if (samplesPerPixel === 3) {
      for (let i = 0; i < numPixels; i++) {
        const base = pixelDataOffset + i * 3
        const o = i * 4
        pixels[o] = view.getUint8(base)
        pixels[o + 1] = view.getUint8(base + 1)
        pixels[o + 2] = view.getUint8(base + 2)
        pixels[o + 3] = 255
      }
      windowCenter = 128
      windowWidth = 256
    } else {
      return null
    }
  } else {
    return null
  }

  void bitsStored

  return {
    width,
    height,
    pixels,
    meta: {
      modality: modality || undefined,
      windowCenter: isNaN(windowCenter) ? undefined : windowCenter,
      windowWidth: isNaN(windowWidth) ? undefined : windowWidth,
      format: 'dicom',
    },
  }
}

// ─── NIfTI-1 ───────────────────────────────────────────────────────────
// Reads uncompressed .nii files. For 3D/4D volumes returns the middle
// axial slice rendered to grayscale via min/max normalization.
export function parseNIfTI(buffer: ArrayBuffer): ParsedImage | null {
  if (buffer.byteLength < 352) return null
  const view = new DataView(buffer)

  // Determine endianness from sizeof_hdr (should be 348 for NIfTI-1)
  const littleEndian = view.getInt32(0, true) === 348
  if (!littleEndian && view.getInt32(0, false) !== 348) return null

  // Magic at offset 344: 'ni1' or 'n+1'
  const magic =
    String.fromCharCode(view.getUint8(344)) +
    String.fromCharCode(view.getUint8(345)) +
    String.fromCharCode(view.getUint8(346))
  if (magic !== 'ni1' && magic !== 'n+1') return null

  // dim[8] at offset 40, each int16
  const ndims = view.getInt16(40, littleEndian)
  const width = view.getInt16(42, littleEndian)
  const height = view.getInt16(44, littleEndian)
  const depth = Math.max(1, view.getInt16(46, littleEndian))

  const datatype = view.getInt16(70, littleEndian)
  const bitpix = view.getInt16(72, littleEndian)

  const sclSlopeRaw = view.getFloat32(112, littleEndian)
  const sclInterRaw = view.getFloat32(116, littleEndian)
  const sclSlope = sclSlopeRaw === 0 ? 1 : sclSlopeRaw
  const sclInter = sclInterRaw || 0

  let voxOffset = view.getFloat32(108, littleEndian)
  if (!voxOffset || voxOffset < 352) voxOffset = magic === 'n+1' ? 352 : 0

  if (!width || !height) return null

  const sliceSize = width * height
  const byteSize = Math.max(1, bitpix / 8)
  const sliceIdx = Math.floor(depth / 2)
  const sliceStart = Math.round(voxOffset + sliceIdx * sliceSize * byteSize)

  if (sliceStart + sliceSize * byteSize > buffer.byteLength) return null

  const values = new Float32Array(sliceSize)
  for (let i = 0; i < sliceSize; i++) {
    const byteIdx = sliceStart + i * byteSize
    let v = 0
    switch (datatype) {
      case 2: // uint8
        v = view.getUint8(byteIdx)
        break
      case 4: // int16
        v = view.getInt16(byteIdx, littleEndian)
        break
      case 8: // int32
        v = view.getInt32(byteIdx, littleEndian)
        break
      case 16: // float32
        v = view.getFloat32(byteIdx, littleEndian)
        break
      case 64: // float64
        v = view.getFloat64(byteIdx, littleEndian)
        break
      case 256: // int8
        v = view.getInt8(byteIdx)
        break
      case 512: // uint16
        v = view.getUint16(byteIdx, littleEndian)
        break
      case 768: // uint32
        v = view.getUint32(byteIdx, littleEndian)
        break
      default:
        return null
    }
    values[i] = v * sclSlope + sclInter
  }

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < sliceSize; i++) {
    const v = values[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min || 1

  const pixels = new Uint8ClampedArray(sliceSize * 4)
  for (let i = 0; i < sliceSize; i++) {
    const g = Math.round(((values[i] - min) / range) * 255)
    const o = i * 4
    pixels[o] = g
    pixels[o + 1] = g
    pixels[o + 2] = g
    pixels[o + 3] = 255
  }

  void ndims

  return {
    width,
    height,
    pixels,
    meta: {
      slices: depth,
      sliceIndex: sliceIdx,
      format: 'nifti',
      windowCenter: (min + max) / 2,
      windowWidth: range,
    },
  }
}

// ─── TIFF (baseline uncompressed) ──────────────────────────────────────
// Supports 8-bit grayscale and 8-bit RGB, and 16-bit grayscale (window-
// normalized). Handles Intel (II) and Motorola (MM) byte order.
export function parseTIFF(buffer: ArrayBuffer): ParsedImage | null {
  if (buffer.byteLength < 8) return null
  const view = new DataView(buffer)
  const byteOrder = view.getUint16(0, false)
  let le: boolean
  if (byteOrder === 0x4949) le = true
  else if (byteOrder === 0x4d4d) le = false
  else return null

  const magic = view.getUint16(2, le)
  if (magic !== 42) return null

  const ifdOffset = view.getUint32(4, le)
  if (ifdOffset + 2 > buffer.byteLength) return null

  const entries = view.getUint16(ifdOffset, le)
  const tags: Record<number, { type: number; count: number; valueOffset: number }> = {}

  for (let i = 0; i < entries; i++) {
    const entryOffset = ifdOffset + 2 + i * 12
    if (entryOffset + 12 > buffer.byteLength) return null
    const tag = view.getUint16(entryOffset, le)
    const type = view.getUint16(entryOffset + 2, le)
    const count = view.getUint32(entryOffset + 4, le)
    tags[tag] = { type, count, valueOffset: entryOffset + 8 }
  }

  // TIFF field type sizes: 1=byte 2=ascii 3=short 4=long 5=rational
  const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }

  const readTagValue = (tagId: number, defaultValue = 0): number => {
    const t = tags[tagId]
    if (!t) return defaultValue
    const size = (typeSize[t.type] || 4) * t.count
    const baseOffset =
      size <= 4 ? t.valueOffset : view.getUint32(t.valueOffset, le)
    if (t.type === 3) return view.getUint16(baseOffset, le)
    if (t.type === 4) return view.getUint32(baseOffset, le)
    if (t.type === 1) return view.getUint8(baseOffset)
    return defaultValue
  }

  const readTagArray = (tagId: number): number[] => {
    const t = tags[tagId]
    if (!t) return []
    const size = (typeSize[t.type] || 4) * t.count
    const baseOffset =
      size <= 4 ? t.valueOffset : view.getUint32(t.valueOffset, le)
    const out: number[] = []
    for (let i = 0; i < t.count; i++) {
      if (t.type === 3) out.push(view.getUint16(baseOffset + i * 2, le))
      else if (t.type === 4) out.push(view.getUint32(baseOffset + i * 4, le))
      else if (t.type === 1) out.push(view.getUint8(baseOffset + i))
    }
    return out
  }

  const width = readTagValue(256)
  const height = readTagValue(257)
  const bitsPerSample = readTagValue(258, 8)
  const compression = readTagValue(259, 1)
  const photometric = readTagValue(262, 1)
  const samplesPerPixel = readTagValue(277, 1)
  const stripOffsets = readTagArray(273)
  const stripByteCounts = readTagArray(279)

  if (!width || !height || compression !== 1) return null
  if (bitsPerSample !== 8 && bitsPerSample !== 16) return null

  // Concatenate strip data into one linear buffer
  let totalBytes = 0
  for (const n of stripByteCounts) totalBytes += n
  const raw = new Uint8Array(totalBytes)
  let pos = 0
  for (let s = 0; s < stripOffsets.length; s++) {
    const off = stripOffsets[s]
    const len = stripByteCounts[s]
    raw.set(new Uint8Array(buffer, off, len), pos)
    pos += len
  }

  const numPixels = width * height
  const pixels = new Uint8ClampedArray(numPixels * 4)

  if (bitsPerSample === 8) {
    if (samplesPerPixel === 1) {
      const invert = photometric === 0 // WhiteIsZero
      for (let i = 0; i < numPixels; i++) {
        let v = raw[i]
        if (invert) v = 255 - v
        const o = i * 4
        pixels[o] = v
        pixels[o + 1] = v
        pixels[o + 2] = v
        pixels[o + 3] = 255
      }
    } else if (samplesPerPixel >= 3) {
      for (let i = 0; i < numPixels; i++) {
        const b = i * samplesPerPixel
        const o = i * 4
        pixels[o] = raw[b]
        pixels[o + 1] = raw[b + 1]
        pixels[o + 2] = raw[b + 2]
        pixels[o + 3] = 255
      }
    } else {
      return null
    }
  } else {
    // 16-bit grayscale — normalize
    const values = new Uint16Array(numPixels)
    for (let i = 0; i < numPixels; i++) {
      values[i] = le
        ? raw[i * 2] | (raw[i * 2 + 1] << 8)
        : (raw[i * 2] << 8) | raw[i * 2 + 1]
    }
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < numPixels; i++) {
      if (values[i] < min) min = values[i]
      if (values[i] > max) max = values[i]
    }
    const range = max - min || 1
    for (let i = 0; i < numPixels; i++) {
      const g = Math.round(((values[i] - min) / range) * 255)
      const o = i * 4
      pixels[o] = g
      pixels[o + 1] = g
      pixels[o + 2] = g
      pixels[o + 3] = 255
    }
  }

  return {
    width,
    height,
    pixels,
    meta: {
      bitsPerSample,
      format: 'tiff',
    },
  }
}

// ─── Unified dispatcher ────────────────────────────────────────────────
// Given a File, detect the format and return a normalized ParsedImage,
// or null if the file isn't a recognized non-native format (in which
// case the caller should fall back to the native Image() loader).
export async function parseMedicalFile(file: File): Promise<ParsedImage | null> {
  const name = file.name.toLowerCase()
  const isDicom = name.endsWith('.dcm') || name.endsWith('.dicom')
  const isNifti = name.endsWith('.nii')
  const isTiff = name.endsWith('.tif') || name.endsWith('.tiff')

  if (!isDicom && !isNifti && !isTiff) return null

  const buffer = await file.arrayBuffer()
  if (isDicom) return parseDICOM(buffer)
  if (isNifti) return parseNIfTI(buffer)
  if (isTiff) return parseTIFF(buffer)
  return null
}
