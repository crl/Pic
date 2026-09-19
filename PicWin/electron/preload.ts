import { contextBridge, ipcRenderer, webUtils } from 'electron'

export type WindowAction = 'min' | 'max' | 'close'
export type OpenKind = 'file' | 'folder'

function pathFromFile(file: File): string {
  try {
    return webUtils.getPathForFile(file) || ''
  } catch {
    return ''
  }
}

function blockDefault(event: DragEvent): void {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

window.addEventListener('dragenter', blockDefault, true)
window.addEventListener('dragover', blockDefault, true)
window.addEventListener(
  'drop',
  (event) => {
    event.preventDefault()
    const file = event.dataTransfer?.files[0]
    const filePath = file ? pathFromFile(file) : ''
    if (filePath) ipcRenderer.send('dropped-path', filePath)
  },
  true
)

const api = {
  openDialog: (kind: OpenKind = 'file'): Promise<string | null> => ipcRenderer.invoke('open-dialog', kind),
  statPath: (
    target: string
  ): Promise<{ isDirectory: boolean; isFile: boolean; mtimeMs: number; size: number }> =>
    ipcRenderer.invoke('stat-path', target),
  listImages: (folder: string): Promise<string[]> => ipcRenderer.invoke('list-images', folder),
  readFile: (target: string): Promise<ArrayBuffer> => ipcRenderer.invoke('read-file', target),
  getModelPath: (): Promise<string | null> => ipcRenderer.invoke('get-model-path'),
  readDepthCache: (key: string): Promise<ArrayBuffer | null> => ipcRenderer.invoke('read-depth-cache', key),
  writeDepthCache: (key: string, data: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('write-depth-cache', key, data),
  dirname: (target: string): Promise<string> => ipcRenderer.invoke('dirname', target),
  basename: (target: string): Promise<string> => ipcRenderer.invoke('basename', target),
  ready: (): void => ipcRenderer.send('renderer-ready'),
  setTitle: (title: string): void => ipcRenderer.send('set-title', title),
  windowControl: (action: WindowAction): void => ipcRenderer.send('window-control', action),
  onMenu: (callback: (action: string) => void): (() => void) => {
    const listener = (_event: unknown, action: string): void => callback(action)
    ipcRenderer.on('menu-action', listener)
    return () => ipcRenderer.removeListener('menu-action', listener)
  },
  onOpenPath: (callback: (target: string) => void): (() => void) => {
    const listener = (_event: unknown, target: string): void => callback(target)
    ipcRenderer.on('open-path', listener)
    return () => ipcRenderer.removeListener('open-path', listener)
  }
}

contextBridge.exposeInMainWorld('pic', api)

export type PicApi = typeof api
