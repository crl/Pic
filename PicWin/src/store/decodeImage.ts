import { supportedExtensions } from './types'

const HEIC = new Set(['heic', 'heif'])

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
    default:
      return 'application/octet-stream'
  }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法打开图片'))
    image.src = url
  })
}

async function decodeHeic(bytes: ArrayBuffer): Promise<HTMLImageElement> {
  const decode = (await import('heic-decode')).default
  const result = await decode({ buffer: new Uint8Array(bytes) })
  const canvas = document.createElement('canvas')
  canvas.width = result.width
  canvas.height = result.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法打开图片')
  const pixels =
    result.data instanceof Uint8ClampedArray
      ? result.data
      : new Uint8ClampedArray(result.data.buffer, result.data.byteOffset, result.data.byteLength)
  ctx.putImageData(new ImageData(pixels, result.width, result.height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('无法打开图片'))), 'image/png')
  })
  return loadHtmlImage(URL.createObjectURL(blob))
}

export async function decodeImageFile(
  path: string,
  bytes: ArrayBuffer | Uint8Array
): Promise<HTMLImageElement> {
  const ext = extensionOf(path)
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (HEIC.has(ext)) {
    return decodeHeic(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
  }
  if (!(supportedExtensions as readonly string[]).includes(ext)) {
    throw new Error('不支持的图片格式')
  }
  const blob = new Blob([buffer], { type: mimeFromExt(ext) })
  return loadHtmlImage(URL.createObjectURL(blob))
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function samePath(a: string, b: string): boolean {
  return a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase()
}
