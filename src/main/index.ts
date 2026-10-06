import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeTheme, safeStorage, shell } from 'electron'
import type { SecretBox } from '../core/auth/providers'
import { Core } from '../core/core'
import { Logger } from '../core/log'
import { ChatAgent } from './agent'
import { captureScreens } from './capture'
import { logStartup, watchApp, watchProcess, watchWindow } from './diagnostics'
import { HttpMcpServer } from './http-mcp'
import { registerIpc } from './ipc'
import { PipeMcpServer } from './mcp-pipe'

/**
 * `--background` starts without a window: the stdio bridge (src/mcp/bridge.ts) launches the app
 * this way when an MCP client connects while MailSort is closed.
 */
const BACKGROUND = process.argv.includes('--background')
/** Dev tooling: render screenshots off-screen into this folder, then quit (see capture.ts). */
const CAPTURE_DIR = process.env.MAILSORT_CAPTURE

if (typeof app === 'undefined') {
  // ELECTRON_RUN_AS_NODE is set (e.g. inherited from VS Code's extension host).
  console.error('MailSort must run as an Electron app. Unset ELECTRON_RUN_AS_NODE and try again.')
  process.exit(1)
}

app.setName('MailSort')
app.setPath('userData', process.env.MAILSORT_DATA_DIR || join(app.getPath('appData'), 'MailSort'))
// Force a theme (light/dark) instead of following Windows, e.g. for screenshots.
if (process.env.MAILSORT_THEME === 'light' || process.env.MAILSORT_THEME === 'dark') nativeTheme.themeSource = process.env.MAILSORT_THEME

if (!app.requestSingleInstanceLock()) app.quit()

// A plain-text log next to the database, so a problem on another PC can be understood afterwards.
const log = new Logger({ dir: join(app.getPath('userData'), 'logs') })
watchProcess(log)

const secrets: SecretBox = {
  encrypt(plain) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption (DPAPI) is not available')
    return safeStorage.encryptString(plain)
  },
  decrypt(data) {
    return safeStorage.decryptString(Buffer.from(data))
  }
}

const clientIds = {
  googleClientId: process.env.GOOGLE_CLIENT_ID || import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID || import.meta.env.MAIN_VITE_MICROSOFT_CLIENT_ID
}

let core: Core | null = null
let pipeMcp: PipeMcpServer | null = null
let mainWindow: BrowserWindow | null = null

/** Native window buttons drawn over the photo backdrop; symbols follow the theme. */
const titleBarOverlay = () => ({
  color: '#00000000',
  symbolColor: nativeTheme.shouldUseDarkColors ? '#e7ece8' : '#17201b',
  height: 48
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    title: 'MailSort',
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    backgroundColor: '#33433a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  watchWindow(log, win)
  if (!CAPTURE_DIR) win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  const onTheme = () => !win.isDestroyed() && win.setTitleBarOverlay(titleBarOverlay())
  nativeTheme.on('updated', onTheme)
  win.on('closed', () => nativeTheme.off('updated', onTheme))

  // Links (including ones clicked inside email bodies) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function showWindow(): void {
  if (!mainWindow) mainWindow = createWindow()
  else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}

/** Quit when nothing needs the app: no window and no MCP client connected. */
function quitIfIdle(): void {
  setTimeout(() => {
    if (!mainWindow && (pipeMcp?.activeConnections ?? 0) === 0) app.quit()
  }, 5000)
}

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData')
  core = new Core({
    dbPath: join(dataDir, 'mail.db'),
    secrets,
    clientIds,
    openUrl: (url) => shell.openExternal(url)
  })

  watchApp(log, core)
  if (app.isPackaged) Menu.setApplicationMenu(null)
  const agent = new ChatAgent(core)
  const httpMcp = new HttpMcpServer(core)
  const settings = core.store.getSettings()
  if (settings.mcpHttpEnabled) {
    httpMcp.start(settings.mcpHttpPort).catch((err) => {
      console.error('MCP HTTP server failed:', err)
      log.error('mcp', 'HTTP server failed to start', err)
    })
  }

  pipeMcp = new PipeMcpServer(core, dataDir, (n) => {
    if (n === 0) quitIfIdle()
  })
  await pipeMcp.start().catch((err) => {
    console.error('MCP pipe failed:', err)
    log.error('mcp', 'pipe failed to start', err)
  })

  registerIpc({
    core,
    agent,
    httpMcp,
    log,
    window: () => mainWindow,
    status: () => ({
      logPath: log.path,
      configured: {
        gmail: !!(clientIds.googleClientId && clientIds.googleClientSecret),
        outlook: !!clientIds.microsoftClientId
      },
      dataDir,
      mcpHttpUrl: httpMcp.url,
      stdioCommand: {
        command: process.execPath,
        // Packaged builds keep the bridge outside the asar archive (see electron-builder.yml).
        args: [join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'out', 'main', 'mcp-bridge.js')],
        env: { ELECTRON_RUN_AS_NODE: '1' }
      }
    })
  })

  if (CAPTURE_DIR) {
    const win = (mainWindow = createWindow())
    const files = await captureScreens(win, CAPTURE_DIR, process.env.MAILSORT_THEME ? `${process.env.MAILSORT_THEME}-` : '')
    console.log(files.join('\n'))
    app.quit()
    return
  }

  if (!BACKGROUND) showWindow()
  core.startBackground()
  void logStartup(log, core)
}).catch((err) => log.error('main', 'startup failed', err))

app.on('second-instance', (_event, argv) => {
  if (!argv.includes('--background')) showWindow()
})

// Keep running headless while an MCP client is connected.
app.on('window-all-closed', () => {
  if ((pipeMcp?.activeConnections ?? 0) === 0) app.quit()
})

app.on('will-quit', () => {
  log.info('app', 'MailSort is quitting')
  pipeMcp?.stop()
  core?.close()
  core = null
})
