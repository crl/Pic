import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'public', 'ort')
const dist = join(root, 'node_modules', 'onnxruntime-web', 'dist')

mkdirSync(dest, { recursive: true })

if (!existsSync(dist)) {
  console.warn('onnxruntime-web not installed yet; skip wasm copy')
  process.exit(0)
}

for (const name of readdirSync(dist)) {
  if (
    name.startsWith('ort-wasm-simd-threaded') &&
    (name.endsWith('.wasm') || name.endsWith('.mjs'))
  ) {
    copyFileSync(join(dist, name), join(dest, name))
  }
}

console.log(`copied onnxruntime wasm → ${dest}`)
