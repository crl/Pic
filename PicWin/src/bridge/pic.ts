export type WindowAction = 'min' | 'max' | 'close'
export type OpenKind = 'file' | 'folder'

export interface PicApi {
  openDialog: (kind?: OpenKind) => Promise<string | null>
  statPath: (target: string) => Promise<{ isDirectory: boolean; isFile: boolean; mtimeMs: number; size: number }>
  listImages: (folder: string) => Promise<string[]>
  readFile: (target: string) => Promise<ArrayBuffer>
  getModelPath: () => Promise<string | null>
  readDepthCache: (key: string) => Promise<ArrayBuffer | null>
  writeDepthCache: (key: string, data: ArrayBuffer) => Promise<void>
  dirname: (target: string) => Promise<string>
  basename: (target: string) => Promise<string>
  ready: () => void
  setTitle: (title: string) => void
  windowControl: (action: WindowAction) => void
  onMenu: (callback: (action: string) => void) => () => void
  onOpenPath: (callback: (target: string) => void) => () => void
}

function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  }
  if (Array.isArray(data)) {
    return new Uint8Array(data).buffer
  }
  throw new Error('unexpected binary payload')
}

export async function installPicBridge(): Promise<void> {
  const [{ invoke }, { listen }, { getCurrentWindow }, { getCurrentWebview }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/webview')
  ])

  const windowRef = getCurrentWindow()
  const openPathListeners = new Set<(target: string) => void>()
  const menuListeners = new Set<(action: string) => void>()

  const api: PicApi = {
    openDialog: (kind: OpenKind = 'file') => invoke<string | null>('open_dialog', { kind }),
    statPath: (target) => invoke('stat_path', { target }),
    listImages: (folder) => invoke<string[]>('list_images', { folder }),
    readFile: async (target) => toArrayBuffer(await invoke('read_file', { target })),
    getModelPath: () => invoke<string | null>('get_model_path'),
    readDepthCache: async (key) => {
      const stored = toArrayBuffer(await invoke('read_depth_cache', { key }))
      return stored.byteLength === 0 ? null : stored
    },
    writeDepthCache: (key, data) =>
      invoke('write_depth_cache', { key, data: Array.from(new Uint8Array(data)) }),
    dirname: (target) => invoke<string>('dirname', { target }),
    basename: (target) => invoke<string>('basename', { target }),
    ready: () => {
      void invoke('ready')
    },
    setTitle: (title) => {
      void windowRef.setTitle(title || 'Pic')
    },
    windowControl: (action) => {
      if (action === 'min') void windowRef.minimize()
      if (action === 'max') void windowRef.toggleMaximize()
      if (action === 'close') void windowRef.close()
    },
    onMenu: (callback) => {
      menuListeners.add(callback)
      return () => {
        menuListeners.delete(callback)
      }
    },
    onOpenPath: (callback) => {
      openPathListeners.add(callback)
      return () => {
        openPathListeners.delete(callback)
      }
    }
  }

  window.pic = api

  await Promise.all([
    listen<string>('menu-action', (event) => {
      for (const listener of menuListeners) listener(event.payload)
    }),
    listen<string>('open-path', (event) => {
      for (const listener of openPathListeners) listener(event.payload)
    }),
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return
      const path = event.payload.paths[0]
      if (!path) return
      for (const listener of openPathListeners) listener(path)
    })
  ])
}
