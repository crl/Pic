import { useSyncExternalStore } from 'react'
import { applyBokeh } from '../depth/bokeh'
import { DepthMap } from '../depth/DepthMap'
import { depthFor } from '../depth/DepthProvider'
import { depthSourceTitle } from '../depth/DepthMap'
import { decodeImageFile, fileName, samePath } from './decodeImage'
import { detectTurnaroundPanels, suggestedPanoControls } from '../depth/panorama'
import { DisplayMode, Point, Size } from './types'

export interface GallerySnapshot {
  items: string[]
  index: number
  currentPath: string | null
  currentImage: HTMLImageElement | null
  pixelSize: Size
  displayMode: DisplayMode
  isDropTargeted: boolean
  isSpatialMode: boolean
  isPanoramaMode: boolean
  spatialBusy: boolean
  spatialError: string | null
  blurAmount: number
  parallaxAmount: number
  focusNormalized: Point
  depthMap: DepthMap | null
  bokehCanvas: HTMLCanvasElement | null
  bokehRevision: number
  depthSourceLabel: string | null
  panoSpread: number
  panoBend: number
  panoKind: 'panorama' | 'turntable'
  panoPanels: number
}

const listeners = new Set<() => void>()

const state: GallerySnapshot = {
  items: [],
  index: 0,
  currentPath: null,
  currentImage: null,
  pixelSize: { width: 0, height: 0 },
  displayMode: 'fit',
  isDropTargeted: false,
  isSpatialMode: false,
  isPanoramaMode: false,
  spatialBusy: false,
  spatialError: null,
  blurAmount: 0.45,
  parallaxAmount: 0.7,
  focusNormalized: { x: 0.5, y: 0.5 },
  depthMap: null,
  bokehCanvas: null,
  bokehRevision: 0,
  depthSourceLabel: null,
  panoSpread: 0.5,
  panoBend: 0.38,
  panoKind: 'panorama',
  panoPanels: 0
}

let snapshot: GallerySnapshot = { ...state }

let bokehToken = 0
let spatialToken = 0
let loadToken = 0

function emit(): void {
  for (const listener of listeners) listener()
}

function patch(partial: Partial<GallerySnapshot>): void {
  Object.assign(state, partial)
  snapshot = { ...state }
  emit()
}

function revokeImage(image: HTMLImageElement | null): void {
  if (image?.src.startsWith('blob:')) URL.revokeObjectURL(image.src)
}

export const galleryStore = {
  getSnapshot(): GallerySnapshot {
    return snapshot
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  setDropTargeted(value: boolean): void {
    if (state.isDropTargeted === value) return
    patch({ isDropTargeted: value })
  },
  setDisplayMode(mode: DisplayMode): void {
    patch({ displayMode: mode })
  },
  toggleDisplayMode(): void {
    patch({ displayMode: state.displayMode === 'fit' ? 'actual' : 'fit' })
  },
  async presentOpenPanel(kind: 'file' | 'folder' = 'file'): Promise<void> {
    if (!window.pic) return
    const selected = await window.pic.openDialog(kind)
    if (selected) await galleryStore.open(selected)
  },
  async open(path: string): Promise<void> {
    try {
      const info = await window.pic.statPath(path)
      if (info.isDirectory) {
        const listed = await window.pic.listImages(path)
        patch({ items: listed, index: 0 })
      } else {
        const folder = await window.pic.dirname(path)
        const listed = await window.pic.listImages(folder)
        const items = listed.length > 0 ? listed : [path]
        const index = items.findIndex((item) => samePath(item, path))
        patch({ items, index: index >= 0 ? index : 0 })
      }
      await loadCurrent()
    } catch (error) {
      patch({
        spatialError: error instanceof Error ? error.message : '无法打开图片'
      })
    }
  },
  async openFromFile(file: File): Promise<void> {
    const token = ++loadToken
    spatialToken += 1
    bokehToken += 1
    try {
      const bytes = await file.arrayBuffer()
      if (token !== loadToken) return
      const image = await decodeImageFile(file.name, bytes)
      if (token !== loadToken) {
        revokeImage(image)
        return
      }
      revokeImage(state.currentImage)
      window.pic?.setTitle(file.name)
      patch({
        items: [file.name],
        index: 0,
        currentPath: file.name,
        currentImage: image,
        pixelSize: { width: image.naturalWidth, height: image.naturalHeight },
        depthMap: null,
        bokehCanvas: null,
        bokehRevision: 0,
        depthSourceLabel: null,
        spatialError: null,
        isDropTargeted: false
      })
    } catch (error) {
      if (token !== loadToken) return
      patch({
        spatialError: error instanceof Error ? error.message : '无法打开图片'
      })
    }
  },
  previous(): void {
    if (state.items.length === 0) return
    patch({ index: (state.index - 1 + state.items.length) % state.items.length })
    void loadCurrent()
  },
  next(): void {
    if (state.items.length === 0) return
    patch({ index: (state.index + 1) % state.items.length })
    void loadCurrent()
  },
  async toggleSpatial(): Promise<void> {
    if (state.isPanoramaMode) {
      await enableSpatial()
      return
    }
    if (state.isSpatialMode) {
      patch({ isSpatialMode: false, isPanoramaMode: false, spatialError: null })
      return
    }
    await enableSpatial()
  },
  togglePanorama(): void {
    if (state.isPanoramaMode) {
      patch({ isSpatialMode: false, isPanoramaMode: false, spatialError: null })
      return
    }
    enablePanorama()
  },
  setFocus(normalized: Point): void {
    patch({
      focusNormalized: {
        x: Math.min(Math.max(normalized.x, 0), 1),
        y: Math.min(Math.max(normalized.y, 0), 1)
      }
    })
    scheduleBokeh()
  },
  setBlurAmount(value: number): void {
    patch({ blurAmount: value })
    scheduleBokeh()
  },
  setParallaxAmount(value: number): void {
    patch({ parallaxAmount: Math.min(Math.max(value, 0), 1) })
  },
  setPanoSpread(value: number): void {
    patch({ panoSpread: Math.min(Math.max(value, 0), 1) })
  },
  setPanoBend(value: number): void {
    patch({ panoBend: Math.min(Math.max(value, 0), 1) })
  },
  clearSpatialError(): void {
    if (state.spatialError) patch({ spatialError: null })
  }
}

async function loadCurrent(): Promise<void> {
  const token = ++loadToken
  spatialToken += 1
  bokehToken += 1
  const path = state.items[state.index] ?? null
  window.pic.setTitle(path ? fileName(path) : 'Pic')

  if (!path) {
    revokeImage(state.currentImage)
    patch({
      currentPath: null,
      currentImage: null,
      pixelSize: { width: 0, height: 0 },
      depthMap: null,
      bokehCanvas: null,
      bokehRevision: 0,
      depthSourceLabel: null,
      isSpatialMode: false,
      isPanoramaMode: false,
      spatialError: null
    })
    return
  }

  const stayPanorama = state.isPanoramaMode
  const staySpatial = state.isSpatialMode && !state.isPanoramaMode
  try {
    const bytes = await window.pic.readFile(path)
    if (token !== loadToken) return
    const image = await decodeImageFile(path, bytes)
    if (token !== loadToken) {
      revokeImage(image)
      return
    }
    revokeImage(state.currentImage)
    patch({
      currentPath: path,
      currentImage: image,
      pixelSize: { width: image.naturalWidth, height: image.naturalHeight },
      depthMap: null,
      bokehCanvas: null,
      bokehRevision: 0,
      depthSourceLabel: null,
      spatialError: null
    })
    if (stayPanorama) {
      enablePanorama()
    } else if (staySpatial) {
      await enableSpatial()
    }
  } catch (error) {
    if (token !== loadToken) return
    revokeImage(state.currentImage)
    patch({
      currentPath: path,
      currentImage: null,
      pixelSize: { width: 0, height: 0 },
      spatialError: error instanceof Error ? error.message : '无法打开图片'
    })
  }
}

function enablePanorama(): void {
  if (!state.currentImage) return
  spatialToken += 1
  const panels = detectTurnaroundPanels(state.currentImage)
  if (panels) {
    patch({
      isSpatialMode: true,
      isPanoramaMode: true,
      spatialBusy: false,
      spatialError: null,
      depthMap: null,
      bokehCanvas: null,
      depthSourceLabel: '角色转盘',
      panoKind: 'turntable',
      panoPanels: panels
    })
    return
  }
  const controls = suggestedPanoControls(state.pixelSize)
  patch({
    isSpatialMode: true,
    isPanoramaMode: true,
    spatialBusy: false,
    spatialError: null,
    depthMap: null,
    bokehCanvas: null,
    depthSourceLabel: '720 全景',
    panoSpread: controls.spread,
    panoBend: controls.bend,
    panoKind: 'panorama',
    panoPanels: 0
  })
}

async function enableSpatial(): Promise<void> {
  const path = state.currentPath
  const image = state.currentImage
  if (!path || !image) return
  const token = ++spatialToken
  patch({ spatialBusy: true, spatialError: null, isPanoramaMode: false })
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  try {
    const result = await depthFor(path, image)
    if (token !== spatialToken) return
    const focus = result.map.suggestedFocus ?? { x: 0.5, y: 0.5 }
    patch({
      depthMap: result.map,
      depthSourceLabel: depthSourceTitle[result.source],
      focusNormalized: focus,
      isSpatialMode: true,
      isPanoramaMode: false
    })
    await recomputeBokeh(state.blurAmount, focus)
  } catch (error) {
    if (token !== spatialToken) return
    patch({
      isSpatialMode: false,
      isPanoramaMode: false,
      spatialError: error instanceof Error ? error.message : '无法计算景深'
    })
  } finally {
    if (token === spatialToken) {
      patch({ spatialBusy: false })
    }
  }
}

function scheduleBokeh(): void {
  const blurAmount = state.blurAmount
  const focus = state.focusNormalized
  const token = ++bokehToken
  window.setTimeout(() => {
    if (token !== bokehToken) return
    void recomputeBokeh(blurAmount, focus)
  }, 30)
}

async function recomputeBokeh(blurAmount: number, focus: Point): Promise<void> {
  const image = state.currentImage
  const depthMap = state.depthMap
  const path = state.currentPath
  if (!image || !depthMap) return
  const canvas = await applyBokeh(image, depthMap, focus, blurAmount)
  if (state.currentPath !== path || state.currentImage !== image || !state.depthMap) return
  patch({
    bokehCanvas: canvas,
    bokehRevision: state.bokehRevision + 1
  })
}

export function useGallery(): GallerySnapshot {
  return useSyncExternalStore(galleryStore.subscribe, galleryStore.getSnapshot, galleryStore.getSnapshot)
}

export function statusText(snapshot: GallerySnapshot): string {
  if (!snapshot.currentPath || !snapshot.currentImage) {
    return '打开图片或将文件拖到窗口'
  }
  const count = `${snapshot.index + 1} / ${snapshot.items.length}`
  const size = `${Math.round(snapshot.pixelSize.width)} × ${Math.round(snapshot.pixelSize.height)}`
  return `${count}    ${size}`
}

export const canGoPrevious = (snapshot: GallerySnapshot): boolean => snapshot.items.length > 1
export const canGoNext = (snapshot: GallerySnapshot): boolean => snapshot.items.length > 1

let ipcBound = false
if (!ipcBound && typeof window !== 'undefined' && window.pic) {
  ipcBound = true
  window.pic.onOpenPath((path) => {
    void galleryStore.open(path)
  })
  window.pic.onMenu((action) => {
    if (action === 'open') void galleryStore.presentOpenPanel('file')
    if (action === 'open-folder') void galleryStore.presentOpenPanel('folder')
    if (action === 'fit') galleryStore.setDisplayMode('fit')
    if (action === 'actual') galleryStore.setDisplayMode('actual')
    if (action === 'spatial') void galleryStore.toggleSpatial()
    if (action === 'previous') galleryStore.previous()
    if (action === 'next') galleryStore.next()
  })
  window.pic.ready()
}
