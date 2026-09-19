import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPPORTED = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
  '.bmp'
])

let mainWindow: BrowserWindow | null = null
let pendingOpenPath: string | null = null
let rendererReady = false
const queuedPaths: string[] = []

function isSupportedImage(filePath: string): boolean {
  return SUPPORTED.has(extname(filePath).toLowerCase())
}

function collectOpenPath(argv: string[]): string | undefined {
  return argv.find((arg) => arg && isSupportedImage(arg) && existsSync(arg))
}

function modelPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'models', 'depth-anything-v2-small.onnx')
  }
  return join(app.getAppPath(), 'resources', 'models', 'depth-anything-v2-small.onnx')
}

function depthCacheDir(): string {
  return join(app.getPath('userData'), 'depth-cache')
}

function depthCacheFile(key: string): string | null {
  if (!/^[a-f0-9]{40}$/.test(key)) return null
  return join(depthCacheDir(), `${key}.bin`)
}

async function pruneDepthCache(dir: string): Promise<void> {
  const maxFiles = 48
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.bin'))
    .map((entry) => join(dir, entry.name))
  if (entries.length <= maxFiles) return
  const ranked = await Promise.all(
    entries.map(async (file) => ({ file, mtimeMs: (await stat(file)).mtimeMs }))
  )
  ranked.sort((a, b) => a.mtimeMs - b.mtimeMs)
  const extra = ranked.slice(0, ranked.length - maxFiles)
  await Promise.all(extra.map((item) => unlink(item.file).catch(() => undefined)))
}

async function listImages(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && isSupportedImage(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => join(folder, entry.name))
    .sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true, sensitivity: 'base' }))
}

function sendMenu(action: string): void {
  mainWindow?.webContents.send('menu-action', action)
}

async function pickImage(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '选择一张图片',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: [...SUPPORTED].map((ext) => ext.slice(1)) },
      { name: '全部文件', extensions: ['*'] }
    ]
  })
  return result.canceled ? null : result.filePaths[0] ?? null
}

async function pickFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '选择一个文件夹',
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0] ?? null
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开…',
          accelerator: 'CommandOrControl+O',
          click: () => {
            void (async () => {
              const selected = await pickImage()
              if (selected) openPathInWindow(selected)
            })()
          }
        },
        {
          label: '打开文件夹…',
          click: () => {
            void (async () => {
              const selected = await pickFolder()
              if (selected) openPathInWindow(selected)
            })()
          }
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '显示',
      submenu: [
        {
          label: '自适应大小',
          accelerator: 'CommandOrControl+0',
          click: () => sendMenu('fit')
        },
        {
          label: '实际大小',
          accelerator: 'CommandOrControl+1',
          click: () => sendMenu('actual')
        },
        { type: 'separator' },
        {
          label: '3D 景深',
          accelerator: 'CommandOrControl+3',
          click: () => sendMenu('spatial')
        }
      ]
    },
    {
      label: '前往',
      submenu: [
        {
          label: '上一张',
          accelerator: 'Left',
          click: () => sendMenu('previous')
        },
        {
          label: '下一张',
          accelerator: 'Right',
          click: () => sendMenu('next')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    backgroundColor: '#000000',
    title: 'Pic',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      navigateOnDragDrop: false
    }
  })

  mainWindow.webContents.on('preload-error', (_event, _path, error) => {
    console.error('preload-error', error)
  })
  void mainWindow.webContents.setVisualZoomLevelLimits(1, 1)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    const openPath = pendingOpenPath ?? collectOpenPath(process.argv.slice(1))
    pendingOpenPath = null
    if (openPath) openPathInWindow(openPath)
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const interceptDropNavigation = (event: Electron.Event, url: string): void => {
    const dropped = fileUrlToPath(url)
    if (!dropped) return
    const normalized = dropped.replaceAll('\\', '/')
    if (normalized.endsWith('/index.html') || normalized.includes('/out/renderer/')) return
    event.preventDefault()
    openPathInWindow(dropped)
  }

  mainWindow.webContents.on('will-navigate', interceptDropNavigation)
  mainWindow.webContents.on('will-redirect', interceptDropNavigation)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function fileUrlToPath(url: string): string | null {
  if (!url.startsWith('file:')) return null
  try {
    return fileURLToPath(url)
  } catch {
    return null
  }
}

function openPathInWindow(target: string): void {
  if (!mainWindow) {
    queuedPaths.push(target)
    return
  }
  if (!rendererReady) {
    queuedPaths.push(target)
    return
  }
  console.log('[pic] open', target)
  mainWindow.webContents.send('open-path', target)
}

let smokeStarted = false

async function runSmokeTest(): Promise<void> {
  if (smokeStarted) return
  smokeStarted = true
  const win = mainWindow
  if (!win) return
  const sample = join(app.getAppPath(), 'resources', 'sample.png')
  if (!existsSync(sample)) {
    console.error('[smoke] FAIL missing resources/sample.png')
    return
  }

  await win.webContents.executeJavaScript('new Promise((r) => setTimeout(r, 300))')
  openPathInWindow(sample)
  await win.webContents.executeJavaScript('new Promise((r) => setTimeout(r, 1200))')
  const afterOpen = await win.webContents.executeJavaScript(`JSON.stringify({
    href: location.href,
    windowTitle: ${JSON.stringify('placeholder')},
    root: !!document.querySelector('#root'),
    imgCount: document.querySelectorAll('img').length,
    imgSize: Array.from(document.querySelectorAll('img')).map((img) => img.naturalWidth + 'x' + img.naturalHeight),
    chromeViewer: location.href.toLowerCase().endsWith('.png'),
    store: window.__picStore ? {
      items: window.__picStore.getSnapshot().items,
      path: window.__picStore.getSnapshot().currentPath,
      hasImage: !!window.__picStore.getSnapshot().currentImage,
      error: window.__picStore.getSnapshot().spatialError,
      size: window.__picStore.getSnapshot().pixelSize
    } : null,
    html: document.body.innerHTML.slice(0, 400),
  })`)
  console.log('[smoke:open]', afterOpen)
  console.log('[smoke:nativeTitle]', win.getTitle())

  const pngB64 = readFileSync(sample).toString('base64')
  const afterDrop = await win.webContents.executeJavaScript(`
    (async () => {
      const raw = atob(${JSON.stringify(pngB64)})
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      const file = new File([bytes], 'drop-smoke.png', { type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const node = document.querySelector('.titlebar-no-drag') || document.getElementById('root')
      node?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      node?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await new Promise((r) => setTimeout(r, 900))
      return JSON.stringify({
        href: location.href,
        imgCount: document.querySelectorAll('img').length,
        navigatedToPng: location.href.toLowerCase().includes('.png')
      })
    })()
  `)
  console.log('[smoke:drop]', afterDrop)

  const extraWindows = BrowserWindow.getAllWindows().filter((item) => item !== win).length
  console.log('[smoke:windows]', JSON.stringify({ total: BrowserWindow.getAllWindows().length, extra: extraWindows }))

  const open = JSON.parse(String(afterOpen)) as {
    root: boolean
    imgCount: number
    chromeViewer: boolean
    store: { hasImage: boolean; path: string | null } | null
  }
  const drop = JSON.parse(String(afterDrop)) as { imgCount: number; navigatedToPng: boolean }
  const passed =
    open.root &&
    open.imgCount > 0 &&
    !open.chromeViewer &&
    !!open.store?.hasImage &&
    (open.store.path || '').includes('sample.png') &&
    drop.imgCount > 0 &&
    !drop.navigatedToPng &&
    extraWindows === 0
  console.log(passed ? '[smoke] PASS' : '[smoke] FAIL')
}

function registerIpc(): void {
  ipcMain.handle('open-dialog', async (_event, kind: 'file' | 'folder' = 'file') => {
    return kind === 'folder' ? pickFolder() : pickImage()
  })

  ipcMain.handle('stat-path', async (_event, target: string) => {
    const info = await stat(target)
    return {
      isDirectory: info.isDirectory(),
      isFile: info.isFile(),
      mtimeMs: info.mtimeMs,
      size: info.size
    }
  })

  ipcMain.handle('list-images', async (_event, folder: string) => listImages(folder))

  ipcMain.handle('read-file', async (_event, target: string) => {
    const buf = await readFile(target)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  ipcMain.handle('get-model-path', async () => {
    const path = modelPath()
    return existsSync(path) ? path : null
  })

  ipcMain.handle('read-depth-cache', async (_event, key: string) => {
    const file = depthCacheFile(key)
    if (!file || !existsSync(file)) return null
    const buf = await readFile(file)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  ipcMain.handle('write-depth-cache', async (_event, key: string, data: ArrayBuffer) => {
    const file = depthCacheFile(key)
    if (!file) return
    const dir = depthCacheDir()
    await mkdir(dir, { recursive: true })
    await writeFile(file, Buffer.from(data))
    await pruneDepthCache(dir)
  })

  ipcMain.handle('dirname', (_event, target: string) => dirname(target))
  ipcMain.handle('basename', (_event, target: string) => basename(target))

  ipcMain.on('window-control', (_event, action: 'min' | 'max' | 'close') => {
    if (!mainWindow) return
    if (action === 'min') mainWindow.minimize()
    if (action === 'max') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
    }
    if (action === 'close') {
      mainWindow.destroy()
      app.quit()
    }
  })

  ipcMain.on('set-title', (_event, title: string) => {
    mainWindow?.setTitle(title || 'Pic')
  })

  ipcMain.on('open-external', (_event, url: string) => {
    void shell.openExternal(url)
  })

  ipcMain.on('dropped-path', (_event, target: string) => {
    if (typeof target === 'string' && target.length > 0) openPathInWindow(target)
  })

  ipcMain.on('renderer-ready', () => {
    rendererReady = true
    const pending = queuedPaths.splice(0)
    if (pendingOpenPath) {
      pending.unshift(pendingOpenPath)
      pendingOpenPath = null
    }
    for (const target of pending) openPathInWindow(target)
    if (process.env.PICWIN_SMOKE === '1') {
      void runSmokeTest()
    }
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const openPath = collectOpenPath(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (openPath) openPathInWindow(openPath)
    } else if (openPath) {
      pendingOpenPath = openPath
    }
  })

  app.whenReady().then(() => {
    createMenu()
    registerIpc()
    createWindow()
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      const dropped = fileUrlToPath(url)
      if (dropped && isSupportedImage(dropped)) openPathInWindow(dropped)
      return { action: 'deny' }
    })
  })

  app.on('browser-window-created', (_event, win) => {
    const stealIfImageWindow = (): void => {
      if (win === mainWindow || win.isDestroyed()) return
      const dropped = fileUrlToPath(win.webContents.getURL())
      if (!dropped || !isSupportedImage(dropped)) return
      openPathInWindow(dropped)
      win.destroy()
    }
    win.webContents.on('did-finish-load', stealIfImageWindow)
    win.webContents.on('did-navigate', stealIfImageWindow)
    win.webContents.on('page-title-updated', stealIfImageWindow)
  })
}

app.on('window-all-closed', () => {
  app.quit()
})
