import wasmSimd from 'onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url'
import wasmJsep from 'onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url'
import wasmAsyncify from 'onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url'
import wasmJspi from 'onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.wasm?url'
import { DepthError, DepthMap, depthErrors } from './DepthMap'

let sessionPromise: Promise<import('onnxruntime-web').InferenceSession> | null = null
let ortModule: typeof import('onnxruntime-web') | null = null

function wasmPrefix(): string {
  return new URL('ort/', `${window.location.origin}/`).href
}

async function loadOrt() {
  if (ortModule) return ortModule
  const ort = await import('onnxruntime-web')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  ort.env.wasm.proxy = false
  ort.env.wasm.wasmPaths = {
    'ort-wasm-simd-threaded.wasm': wasmSimd,
    'ort-wasm-simd-threaded.jsep.wasm': wasmJsep,
    'ort-wasm-simd-threaded.asyncify.wasm': wasmAsyncify,
    'ort-wasm-simd-threaded.jspi.wasm': wasmJspi
  }
  if (!ort.env.wasm.wasmPaths['ort-wasm-simd-threaded.wasm']) {
    ort.env.wasm.wasmPaths = wasmPrefix()
  }
  ortModule = ort
  return ort
}

async function createSession() {
  try {
    const ort = await loadOrt()
    const modelPath = await window.pic.getModelPath()
    if (!modelPath) {
      throw new DepthError(depthErrors.modelMissing)
    }
    const buffer = await window.pic.readFile(modelPath)
    const model = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    try {
      return await ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
    } catch (wasmError) {
      try {
        return await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] })
      } catch {
        throw wasmError
      }
    }
  } catch (error) {
    sessionPromise = null
    if (error instanceof DepthError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new DepthError(`找不到可用的景深计算后端。${detail}`)
  }
}

function session(): Promise<import('onnxruntime-web').InferenceSession> {
  sessionPromise ??= createSession()
  return sessionPromise
}

function resizeImageToCanvas(image: HTMLImageElement, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new DepthError(depthErrors.pixelBuffer)
  ctx.drawImage(image, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

function imageDataToTensor(
  imageData: ImageData,
  Tensor: typeof import('onnxruntime-web').Tensor
) {
  const { width, height, data } = imageData
  const plane = width * height
  const float32 = new Float32Array(plane * 3)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  for (let i = 0; i < plane; i++) {
    float32[i] = (data[i * 4]! / 255 - mean[0]!) / std[0]!
    float32[plane + i] = (data[i * 4 + 1]! / 255 - mean[1]!) / std[1]!
    float32[plane * 2 + i] = (data[i * 4 + 2]! / 255 - mean[2]!) / std[2]!
  }
  return new Tensor('float32', float32, [1, 3, height, width])
}

function firstNumberArray(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return value as number[]
  }
  return null
}

function inputSize(sessionLike: import('onnxruntime-web').InferenceSession, inputName: string): {
  width: number
  height: number
} {
  const meta = (
    sessionLike as unknown as {
      inputMetadata?: Record<string, { dimensions?: unknown }>
    }
  ).inputMetadata?.[inputName]
  const dims = firstNumberArray(meta?.dimensions)
  if (dims && dims.length >= 4 && dims[2]! > 0 && dims[3]! > 0) {
    return { width: dims[3]!, height: dims[2]! }
  }
  return { width: 518, height: 518 }
}

function upsampleDepth(
  values: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Float32Array {
  const out = new Float32Array(dstWidth * dstHeight)
  for (let y = 0; y < dstHeight; y++) {
    const v = dstHeight === 1 ? 0 : y / (dstHeight - 1)
    const sy = v * (srcHeight - 1)
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, srcHeight - 1)
    const ty = sy - y0
    for (let x = 0; x < dstWidth; x++) {
      const u = dstWidth === 1 ? 0 : x / (dstWidth - 1)
      const sx = u * (srcWidth - 1)
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, srcWidth - 1)
      const tx = sx - x0
      const v00 = values[y0 * srcWidth + x0] ?? 0
      const v10 = values[y0 * srcWidth + x1] ?? 0
      const v01 = values[y1 * srcWidth + x0] ?? 0
      const v11 = values[y1 * srcWidth + x1] ?? 0
      const a = v00 * (1 - tx) + v10 * tx
      const b = v01 * (1 - tx) + v11 * tx
      out[y * dstWidth + x] = a * (1 - ty) + b * ty
    }
  }
  return out
}

export async function estimateDepth(image: HTMLImageElement): Promise<DepthMap> {
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new DepthError(depthErrors.emptyImage)
  }
  const ort = await loadOrt()
  const ml = await session()
  const inputName = ml.inputNames[0]
  const outputName = ml.outputNames[0]
  if (!inputName || !outputName) {
    throw new DepthError(depthErrors.modelOutput)
  }
  const size = inputSize(ml, inputName)
  const pixels = resizeImageToCanvas(image, size.width, size.height)
  const tensor = imageDataToTensor(pixels, ort.Tensor)
  const result = await ml.run({ [inputName]: tensor })
  const output = result[outputName]
  if (!output) {
    throw new DepthError(depthErrors.modelOutput)
  }
  const data = output.data
  const floats =
    data instanceof Float32Array
      ? data
      : new Float32Array(Array.from(data as ArrayLike<number>, (value) => Number(value)))
  const dims = output.dims
  const srcHeight = dims.length >= 3 ? Number(dims[dims.length - 2]) : size.height
  const srcWidth = dims.length >= 3 ? Number(dims[dims.length - 1]) : size.width
  const upsampled = upsampleDepth(
    floats,
    srcWidth,
    srcHeight,
    image.naturalWidth,
    image.naturalHeight
  )
  return DepthMap.fromValues(upsampled, image.naturalWidth, image.naturalHeight, false)
}
