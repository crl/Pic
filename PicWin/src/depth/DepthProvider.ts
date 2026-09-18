import { DepthMap, DepthSource } from './DepthMap'
import { estimateDepth } from './estimator'

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
  const estimated = await estimateDepth(image)
  remember(path, estimated)
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
