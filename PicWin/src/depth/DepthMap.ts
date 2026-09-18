export type DepthSource = 'embedded' | 'machineLearning' | 'cache'

export const depthSourceTitle: Record<DepthSource, string> = {
  embedded: '人像深度',
  machineLearning: '估算深度',
  cache: '已缓存'
}

export class DepthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DepthError'
  }
}

export const depthErrors = {
  modelMissing: '找不到景深模型，无法估算 3D 景深。',
  pixelBuffer: '无法把图片送入景深模型。',
  modelOutput: '景深模型没有返回深度图。',
  emptyImage: '当前没有可计算的图片。'
}

export class DepthMap {
  readonly width: number
  readonly height: number
  /** Row-major, 0 = far, 1 = near. */
  readonly values: Float32Array
  readonly suggestedFocus: { x: number; y: number } | null

  constructor(
    width: number,
    height: number,
    values: Float32Array,
    suggestedFocus: { x: number; y: number } | null
  ) {
    this.width = width
    this.height = height
    this.values = values
    this.suggestedFocus = suggestedFocus
  }

  sample(u: number, v: number): number {
    if (this.width <= 1 || this.height <= 1 || this.values.length === 0) return 0
    const x = Math.min(Math.max(u, 0), 1) * (this.width - 1)
    const y = Math.min(Math.max(v, 0), 1) * (this.height - 1)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(x0 + 1, this.width - 1)
    const y1 = Math.min(y0 + 1, this.height - 1)
    const tx = x - x0
    const ty = y - y0
    const v00 = this.value(x0, y0)
    const v10 = this.value(x1, y0)
    const v01 = this.value(x0, y1)
    const v11 = this.value(x1, y1)
    const a = v00 * (1 - tx) + v10 * tx
    const b = v01 * (1 - tx) + v11 * tx
    return a * (1 - ty) + b * ty
  }

  private value(x: number, y: number): number {
    return this.values[y * this.width + x] ?? 0
  }

  static fromValues(values: Float32Array, width: number, height: number, invert: boolean): DepthMap {
    const finite = new Float32Array(values.length)
    let minValue = Number.POSITIVE_INFINITY
    let maxValue = Number.NEGATIVE_INFINITY
    for (let i = 0; i < values.length; i++) {
      const raw = Number.isFinite(values[i]) ? values[i] : 0
      finite[i] = raw
      if (raw > 0 && Number.isFinite(raw)) {
        if (raw < minValue) minValue = raw
        if (raw > maxValue) maxValue = raw
      }
    }
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      minValue = 0
      maxValue = 1
    }
    const span = Math.max(maxValue - minValue, 1e-5)
    for (let i = 0; i < finite.length; i++) {
      let n = (finite[i] - minValue) / span
      n = Math.min(Math.max(n, 0), 1)
      if (invert) n = 1 - n
      finite[i] = n
    }
    return new DepthMap(width, height, finite, suggestedFocus(finite, width, height))
  }
}

function suggestedFocus(
  values: Float32Array,
  width: number,
  height: number
): { x: number; y: number } | null {
  if (width <= 8 || height <= 8) return null
  const x0 = Math.floor((width * 3) / 10)
  const x1 = Math.floor((width * 7) / 10)
  const y0 = Math.floor((height * 3) / 10)
  const y1 = Math.floor((height * 7) / 10)
  let best = -1
  let bestX = Math.floor(width / 2)
  let bestY = Math.floor(height / 2)
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const v = values[y * width + x] ?? 0
      if (v > best) {
        best = v
        bestX = x
        bestY = y
      }
    }
  }
  return { x: bestX / width, y: bestY / height }
}
