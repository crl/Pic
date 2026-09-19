import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'public', 'ort')
const dist = join(root, 'node_modules', 'onnxruntime-web', 'dist')
const needed = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']

mkdirSync(dest, { recursive: true })

if (!existsSync(dist)) {
  console.warn('onnxruntime-web not installed yet; skip wasm copy')
  process.exit(0)
}

for (const name of needed) {
  const from = join(dist, name)
  if (!existsSync(from)) {
    console.warn(`missing ${name}`)
    continue
  }
  copyFileSync(from, join(dest, name))
}

for (const extra of [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.jspi.wasm',
  'ort-wasm-simd-threaded.jspi.mjs'
]) {
  const leftover = join(dest, extra)
  if (existsSync(leftover)) rmSync(leftover)
}

console.log(`copied onnxruntime wasm → ${dest}`)
