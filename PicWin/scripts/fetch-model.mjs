import { spawnSync } from 'node:child_process'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const destDir = join(root, 'resources', 'models')
const publicDir = join(root, 'public', 'models')
const dest = join(destDir, 'depth-anything-v2-small.onnx')

const sources = [
  {
    url: 'https://hf-mirror.com/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx?download=true',
    min: 20_000_000,
    max: 35_000_000
  },
  {
    url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx?download=true',
    min: 20_000_000,
    max: 35_000_000
  },
  {
    url: 'https://hf-mirror.com/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx?download=true',
    min: 40_000_000,
    max: 80_000_000
  },
  {
    url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx?download=true',
    min: 40_000_000,
    max: 80_000_000
  }
]

mkdirSync(destDir, { recursive: true })
mkdirSync(publicDir, { recursive: true })

function headerLooksLikeOnnx() {
  const bytes = readFileSync(dest).subarray(0, 64)
  return bytes.includes(Buffer.from('onnx'))
}

function looksValid(min, max) {
  if (!existsSync(dest)) return false
  const size = statSync(dest).size
  return size >= min && size <= max && headerLooksLikeOnnx()
}

function publish() {
  copyFileSync(dest, join(publicDir, 'depth-anything-v2-small.onnx'))
  console.log(`saved ${dest} (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`)
}

const cached = sources[0]
if (looksValid(cached.min, cached.max) || looksValid(40_000_000, 80_000_000)) {
  publish()
  process.exit(0)
}

if (existsSync(dest)) {
  console.warn(`removing invalid model (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`)
  unlinkSync(dest)
}

function downloadWithCurl(url) {
  const result = spawnSync(
    'curl.exe',
    ['-L', '--fail', '--retry', '3', '--connect-timeout', '20', '-o', dest, url],
    { stdio: 'inherit' }
  )
  return result.status === 0
}

async function downloadWithFetch(url) {
  console.log(`downloading ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

let lastError
for (const source of sources) {
  try {
    if (process.platform === 'win32') {
      if (!downloadWithCurl(source.url)) {
        throw new Error('curl failed')
      }
    } else {
      await downloadWithFetch(source.url)
    }
    if (!looksValid(source.min, source.max)) {
      throw new Error(`file invalid (${existsSync(dest) ? statSync(dest).size : 0} bytes)`)
    }
    publish()
    process.exit(0)
  } catch (error) {
    lastError = error
    console.warn(`failed: ${error instanceof Error ? error.message : error}`)
    if (existsSync(dest)) unlinkSync(dest)
  }
}

console.error(lastError)
process.exit(1)
