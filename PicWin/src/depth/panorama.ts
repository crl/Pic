import { Size } from '../store/types'

export type PanoramaProjection =
  | { kind: 'equirect' }
  | { kind: 'cylinder'; haov: number; vaov: number; wrap: boolean }

export const panoSpreadMin = (80 * Math.PI) / 180
export const panoSpreadMax = Math.PI * 2

/** 2:1 equirectangular spherical panorama (often called 720°). */
export function isEquirectangular(size: Size): boolean {
  if (size.width < 512 || size.height < 256) return false
  const aspect = size.width / Math.max(size.height, 1)
  return aspect >= 1.85 && aspect <= 2.15
}

/** Pick sphere vs cylinder from the source image, instead of always wrapping 360×180. */
export function panoramaProjection(size: Size): PanoramaProjection {
  if (isEquirectangular(size)) return { kind: 'equirect' }
  const aspect = size.width / Math.max(size.height, 1)
  const vaov = Math.min(100, 42 + aspect * 8) * (Math.PI / 180)
  let haov = vaov * aspect
  const wrap = haov >= (330 * Math.PI) / 180 || aspect >= 4.8
  if (wrap) haov = Math.PI * 2
  else haov = Math.min(haov, Math.PI * 2)
  return { kind: 'cylinder', haov, vaov, wrap }
}

export function spreadToHaov(spread: number): number {
  const t = Math.min(Math.max(spread, 0), 1)
  return panoSpreadMin + t * (panoSpreadMax - panoSpreadMin)
}

export function haovToSpread(haov: number): number {
  return Math.min(Math.max((haov - panoSpreadMin) / (panoSpreadMax - panoSpreadMin), 0), 1)
}

export function suggestedPanoControls(size: Size): { spread: number; bend: number } {
  if (isEquirectangular(size)) return { spread: 1, bend: 1 }
  const projection = panoramaProjection(size)
  if (projection.kind === 'equirect') return { spread: 1, bend: 1 }
  return {
    spread: haovToSpread(projection.haov),
    bend: 0.38
  }
}

/** Front/side/back character sheets on a plain backdrop. */
export function detectTurnaroundPanels(image: HTMLImageElement): number | null {
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width < 400 || height < 360) return null
  const aspect = width / Math.max(height, 1)
  if (aspect < 1.18 || aspect > 2.55) return null

  const sampleW = 240
  const sampleH = Math.max(48, Math.round((sampleW * height) / width))
  const canvas = document.createElement('canvas')
  canvas.width = sampleW
  canvas.height = sampleH
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, sampleW, sampleH)
  const pixels = context.getImageData(0, 0, sampleW, sampleH).data

  const corner = averageBox(pixels, sampleW, sampleH, 0, 0, 14, 14)
  const others = [
    averageBox(pixels, sampleW, sampleH, sampleW - 14, 0, 14, 14),
    averageBox(pixels, sampleW, sampleH, 0, sampleH - 14, 14, 14),
    averageBox(pixels, sampleW, sampleH, sampleW - 14, sampleH - 14, 14, 14)
  ]
  if (others.some((color) => colorDistance(corner, color) > 38)) return null

  const columnBg = new Float32Array(sampleW)
  for (let x = 0; x < sampleW; x += 1) {
    let hits = 0
    for (let y = 0; y < sampleH; y += 1) {
      const index = (y * sampleW + x) * 4
      if (colorDistance(corner, [pixels[index], pixels[index + 1], pixels[index + 2]]) < 32) hits += 1
    }
    columnBg[x] = hits / sampleH
  }
  for (let x = 1; x < sampleW - 1; x += 1) {
    columnBg[x] = (columnBg[x - 1] + columnBg[x] * 2 + columnBg[x + 1]) / 4
  }

  const runs: Array<{ start: number; end: number }> = []
  let start = -1
  for (let x = 0; x < sampleW; x += 1) {
    const content = columnBg[x] < 0.78
    if (content && start < 0) start = x
    if (!content && start >= 0) {
      runs.push({ start, end: x })
      start = -1
    }
  }
  if (start >= 0) runs.push({ start, end: sampleW })

  const bodies = runs.filter((run) => run.end - run.start >= sampleW * 0.08)
  if (bodies.length < 2 || bodies.length > 4) return null
  const widths = bodies.map((run) => run.end - run.start)
  const maxW = Math.max(...widths)
  const minW = Math.min(...widths)
  if (maxW / Math.max(minW, 1) > 1.85) return null
  return bodies.length
}

function averageBox(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  boxW: number,
  boxH: number
): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  const x1 = Math.min(width, x0 + boxW)
  const y1 = Math.min(height, y0 + boxH)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4
      r += pixels[index]
      g += pixels[index + 1]
      b += pixels[index + 2]
      n += 1
    }
  }
  return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n]
}

function colorDistance(a: number[], b: number[]): number {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}
