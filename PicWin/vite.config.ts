import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'skip-ort-wasm-assets',
      enforce: 'pre',
      resolveId(id) {
        if (id.includes('onnxruntime-web') && id.endsWith('.wasm')) {
          return { id, external: true }
        }
        return null
      },
      generateBundle(_options, bundle) {
        for (const fileName of Object.keys(bundle)) {
          if (fileName.endsWith('.wasm') && fileName.includes('ort-wasm')) {
            delete bundle[fileName]
          }
        }
      }
    }
  ],
  clearScreen: false,
  publicDir: resolve(__dirname, 'public'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  },
  server: {
    port: 1420,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    minify: process.env.TAURI_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_DEBUG
  }
})
