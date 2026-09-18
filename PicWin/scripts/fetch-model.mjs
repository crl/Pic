import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const destDir = join(root, 'resources', 'models')
const dest = join(destDir, 'depth-anything-v2-small.onnx')

const urls = [
  'https://hf-mirror.com/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx',
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx',
  'https://hf-mirror.com/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx',
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx'
]

mkdirSync(destDir, { recursive: true })

if (existsSync(dest) && statSync(dest).size > 1_000_000) {
  console.log(`model already present (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`)
  process.exit(0)
}

function looksValid() {
  return existsSync(dest) && statSync(dest).size > 1_000_000
}

function downloadWithCurl(url) {
  const result = spawnSync('curl.exe', ['-L', '--retry', '3', '--connect-timeout', '20', '-o', dest, url], {
    stdio: 'inherit'
  })
  return result.status === 0 && looksValid()
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
for (const url of urls) {
  try {
    if (process.platform === 'win32' && downloadWithCurl(url)) {
      console.log(`saved ${dest} (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`)
      process.exit(0)
    }
    await downloadWithFetch(url)
    if (!looksValid()) {
      throw new Error(`file too small (${existsSync(dest) ? statSync(dest).size : 0} bytes)`)
    }
    console.log(`saved ${dest} (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`)
    process.exit(0)
  } catch (error) {
    lastError = error
    console.warn(`failed: ${error instanceof Error ? error.message : error}`)
    if (existsSync(dest) && !looksValid()) unlinkSync(dest)
  }
}

console.error(lastError)
process.exit(1)
