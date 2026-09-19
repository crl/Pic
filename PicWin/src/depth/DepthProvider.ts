import { DepthMap, DepthSource } from './DepthMap'
import { estimateDepth, warmupDepth } from './estimator'

const maxCached = 24
const cache = new Map<string, DepthMap>()
const order: string[] = []

function remember(path: string, map: DepthMap): void {
  cache.set(path, map)
  const existing = order.indexOf(path)
  if (existing >= 0) order.splice(existing, 1)
  order.push(path)
  while (order.length > maxCached) {
    const oldest = order.shift()
    if (oldest) cache.delete(oldest)
  }
}

export async function depthFor(
  path: string,
  image: HTMLImageElement
): Promise<{ map: DepthMap; source: DepthSource }> {
  const cached = cache.get(path)
  if (cached) {
    return { map: cached, source: 'cache' }
  }

  const key = await diskKey(path, image)
  if (key && window.pic.readDepthCache) {
    try {
      const stored = await window.pic.readDepthCache(key)
      const map = stored ? decodeMap(stored) : null
      if (map) {
        remember(path, map)
        return { map, source: 'cache' }
      }
    } catch {
      // fall through to estimate
    }
  }

  const estimated = await estimateDepth(image)
  remember(path, estimated)
  if (key && window.pic.writeDepthCache) {
    void window.pic.writeDepthCache(key, encodeMap(estimated)).catch(() => undefined)
  }
  return { map: estimated, source: 'machineLearning' }
}

export function clearDepth(path?: string): void {
  if (!path) {
    cache.clear()
    order.length = 0
    return
  }
  cache.delete(path)
  const index = order.indexOf(path)
  if (index >= 0) order.splice(index, 1)
}

export { warmupDepth }

async function diskKey(path: string, image: HTMLImageElement): Promise<string | null> {
  let stamp = '0'
  try {
    const info = await window.pic.statPath(path)
    stamp = `${Math.round(info.mtimeMs)}:${info.size}`
  } catch {
    stamp = `${image.naturalWidth}x${image.naturalHeight}`
  }
  const raw = `${path}|${image.naturalWidth}x${image.naturalHeight}|${stamp}|d3`
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(raw))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function encodeMap(map: DepthMap): ArrayBuffer {
  const header = 24
  const buffer = new ArrayBuffer(header + map.values.length * 4)
  const view = new DataView(buffer)
  view.setUint32(0, 0x50494344, false)
  view.setUint16(4, 1, true)
  view.setUint16(6, 0, true)
  view.setUint32(8, map.width, true)
  view.setUint32(12, map.height, true)
  view.setFloat32(16, map.suggestedFocus?.x ?? -1, true)
  view.setFloat32(20, map.suggestedFocus?.y ?? -1, true)
  new Float32Array(buffer, header, map.values.length).set(map.values)
  return buffer
}

function decodeMap(buffer: ArrayBuffer): DepthMap | null {
  if (buffer.byteLength < 24) return null
  const view = new DataView(buffer)
  if (view.getUint32(0, false) !== 0x50494344) return null
  if (view.getUint16(4, true) !== 1) return null
  const width = view.getUint32(8, true)
  const height = view.getUint32(12, true)
  if (width < 8 || height < 8 || width * height > 4_000_000) return null
  const expected = 24 + width * height * 4
  if (buffer.byteLength < expected) return null
  const focusX = view.getFloat32(16, true)
  const focusY = view.getFloat32(20, true)
  const values = new Float32Array(buffer.slice(24, expected))
  const focus =
    Number.isFinite(focusX) && Number.isFinite(focusY) && focusX >= 0 && focusY >= 0
      ? { x: focusX, y: focusY }
      : null
  return new DepthMap(width, height, values, focus)
}
