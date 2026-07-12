import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net, screen, nativeTheme, Notification } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { GsmtcService } from './services/GsmtcService'
import { TrackSplitter } from './services/TrackSplitter'
import { AudioRecorder } from './services/AudioRecorder'
import { listAudioDevices } from './services/AudioDevices'
import { loadSettings, saveSettings } from './services/SettingsStore'
import { setFfmpegOverride, detectFfmpegPath, getFfmpegPath } from './services/FfmpegResolver'
import { loadTheme, saveTheme, type Theme } from './services/ThemeStore'
import {
  loadAllTrimPresets,
  saveTrimPreset,
  deleteTrimPreset,
  getTrimPreset
} from './services/TrimPresetsStore'

// Must be called before app.whenReady() — marks the scheme as safe for fetch() in the renderer.
protocol.registerSchemesAsPrivileged([
  { scheme: 'autotape-audio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let mainWindow: BrowserWindow | null = null
let _flushWindowState: (() => void) | null = null
const gsmtcService = new GsmtcService()
const trackSplitter = new TrackSplitter(gsmtcService)

// ─── Window state persistence ──────────────────────────────────────────────

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 860,
  height: 560,
  isMaximized: false
}

function windowStatePath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'window-state.json')
}

function loadWindowState(): WindowState {
  const p = windowStatePath()
  if (!existsSync(p)) return { ...DEFAULT_WINDOW_STATE }
  try {
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WindowState>
    return { ...DEFAULT_WINDOW_STATE, ...parsed }
  } catch {
    return { ...DEFAULT_WINDOW_STATE }
  }
}

function saveWindowState(state: WindowState): void {
  writeFileSync(windowStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Check whether a rectangle is at least partially visible on any connected display.
 * Prevents the window from opening off-screen when a monitor is disconnected.
 */
function boundsAreVisible(x: number, y: number, width: number, height: number): boolean {
  // Require at least a 100×100 px sliver to be visible
  const MIN_VISIBLE = 100
  return screen.getAllDisplays().some((display) => {
    const { x: dx, y: dy, width: dw, height: dh } = display.bounds
    const overlapX = Math.max(0, Math.min(x + width, dx + dw) - Math.max(x, dx))
    const overlapY = Math.max(0, Math.min(y + height, dy + dh) - Math.max(y, dy))
    return overlapX >= MIN_VISIBLE && overlapY >= MIN_VISIBLE
  })
}

/**
 * Wire up window move/resize/maximize listeners with debounced persistence.
 * Returns a cleanup function that flushes the final state synchronously
 * (call on app quit while the window still exists).
 */
function trackWindowState(win: BrowserWindow): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const persist = (): void => {
    if (!win || win.isDestroyed()) return
    const isMaximized = win.isMaximized()
    // When maximized, save the normal (unmaximized) bounds so we can restore
    // that size on next launch even if the user quits while maximized.
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
    saveWindowState({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized
    })
  }

  // Debounced persist — fires 300ms after the last resize/move event stops
  const debouncedPersist = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, 300)
  }

  win.on('resize', debouncedPersist)
  win.on('move', debouncedPersist)

  // Maximize/unmaximize: persist immediately so the flag is always in sync
  win.on('maximize', () => persist())
  win.on('unmaximize', () => persist())

  // Return a cleanup that does a final synchronous save
  return () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    persist()
  }
}

function registerArtProtocol(): void {
  protocol.handle('autotape-art', async (request) => {
    try {
      const url = new URL(request.url)
      const filePathParam = url.searchParams.get('path')
      if (!filePathParam) {
        return new Response('Missing path', { status: 400 })
      }

      const fileUrl = pathToFileURL(filePathParam).toString()
      return net.fetch(fileUrl)
    } catch (error) {
      console.error('[ArtProtocol] Failed to serve album art:', error)
      return new Response('Failed to load art', { status: 500 })
    }
  })

  // Serve local audio files for the trim preview modal
  protocol.handle('autotape-audio', async (request) => {
    try {
      const url = new URL(request.url)
      const filePathParam = url.searchParams.get('path')
      if (!filePathParam) {
        return new Response('Missing path', { status: 400 })
      }
      const fileUrl = pathToFileURL(filePathParam).toString()
      return net.fetch(fileUrl, { headers: request.headers })
    } catch (error) {
      console.error('[AudioProtocol] Failed to serve audio:', error)
      return new Response('Failed to load audio', { status: 500 })
    }
  })
}

// ─── Theme / title bar overlay colors ──────────────────────────────────────
// Mirrors the color pairs App.tsx uses for the in-page theme toggle, so the
// native title bar buttons never visibly mismatch the rest of the UI.
const TITLEBAR_OVERLAY: Record<Theme, { color: string; symbolColor: string }> = {
  dark: { color: '#1a100d', symbolColor: '#b89080' },
  light: { color: '#fdf3ea', symbolColor: '#6b4e3e' }
}

/** The user's last explicitly-chosen theme, falling back to the OS preference. */
function resolveInitialTheme(): Theme {
  return loadTheme() ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
}

function createWindow(): void {
  const savedState = loadWindowState()
  const initialTheme = resolveInitialTheme()

  // Only restore position if the saved bounds are still visible on a display
  const hasValidPosition =
    savedState.x !== undefined &&
    savedState.y !== undefined &&
    boundsAreVisible(savedState.x, savedState.y, savedState.width, savedState.height)

  mainWindow = new BrowserWindow({
    ...(hasValidPosition ? { x: savedState.x, y: savedState.y } : {}),
    width: savedState.width,
    height: savedState.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      ...TITLEBAR_OVERLAY[initialTheme],
      height: 32
    },
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    backgroundColor: '#0f0f13',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Restore maximized state after the window is ready (avoids visual flicker)
  if (savedState.isMaximized) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.maximize()
    })
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.on('closed', () => {
    // Flush final window state before the window object is destroyed
    if (_flushWindowState) {
      _flushWindowState()
      _flushWindowState = null
    }
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── GSMTC event wiring ────────────────────────────────────────────────────
function wireGsmtc(): void {
  gsmtcService.on('trackChanged', (oldTrack, newTrack) => {
    mainWindow?.webContents.send('gsmtc:track-changed', newTrack)
    // Also push old track for debugging
    void oldTrack
  })

  gsmtcService.on('playStateChanged', (isPlaying) => {
    mainWindow?.webContents.send('gsmtc:play-state', isPlaying)
  })

  gsmtcService.on('artworkUpdated', (track) => {
    mainWindow?.webContents.send('gsmtc:artwork-updated', track)
  })

  gsmtcService.on('error', (err) => {
    console.error('[GSMTC]', err.message)
  })
}

// ─── TrackSplitter event wiring ────────────────────────────────────────────
function wireSplitter(): void {
  trackSplitter.on('recordingStarted', (track) => {
    mainWindow?.webContents.send('recorder:started', track)
  })

  trackSplitter.on('recordingFinished', (entry) => {
    mainWindow?.webContents.send('recorder:finished', entry)
  })

  trackSplitter.on('error', (err) => {
    console.error('[Splitter]', err.message)
  })

  trackSplitter.on('silenceWarning', () => {
    mainWindow?.webContents.send('recorder:silence-warning')

    // The in-app modal is invisible if the user is tabbed away — pair it with
    // a native toast and a taskbar flash so the warning isn't silent too.
    if (mainWindow && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true)
    }

    if (Notification.isSupported()) {
      new Notification({
        title: 'Autotape 3000',
        body: 'No audio detected — the current recording may be silent.',
        icon: join(__dirname, '../../resources/icon.png')
      }).show()
    }
  })

  trackSplitter.on('audioDetected', () => {
    mainWindow?.webContents.send('recorder:audio-detected')
    mainWindow?.flashFrame(false)
  })
}

// ─── IPC handlers ──────────────────────────────────────────────────────────
function registerIpcHandlers(): void {
  // App metadata
  ipcMain.handle('app:get-version', () => app.getVersion())

  // Theme — lets the renderer persist its choice so the next launch's
  // initial title bar overlay (set before any renderer JS runs) matches.
  ipcMain.handle('theme:get', () => resolveInitialTheme())
  ipcMain.handle('theme:save', (_event, theme: Theme) => saveTheme(theme))

  // GSMTC
  ipcMain.handle('gsmtc:get-current', () => gsmtcService.currentTrack)
  ipcMain.handle('gsmtc:list-sessions', async () => gsmtcService.listSessions())

  // Recording
  ipcMain.handle('recorder:start', async () => {
    // Ensure ffmpeg capability cache is warm before starting the recorder.
    // probe() returns the same singleton Promise on every call and resolves
    // instantly once the initial async detection has completed, so awaiting
    // here is non-blocking for any click that happens after startup.
    await AudioRecorder.probe()
    const settings = loadSettings()
    trackSplitter.startListening({
      outputDir: settings.outputDir,
      format: settings.format,
      bitrate: settings.bitrate,
      deviceId: settings.deviceId,
      duplicateAction: settings.duplicateAction,
      sessionFilter: settings.sessionFilter,
      minSaveSeconds: settings.minSaveSeconds
    })
  })

  ipcMain.handle('recorder:stop', async () => {
    await trackSplitter.stopListening()
  })

  // Settings
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:save', (_event, settings) => {
    saveSettings(settings)
    gsmtcService.setSourceFilter(settings.sessionFilter)
    // Apply user-configured ffmpeg path override; empty string = auto-detect
    const ffmpegOverride = settings.ffmpegPath?.trim() || null
    setFfmpegOverride(ffmpegOverride)
    // Reset probe cache so the next recording start re-detects capabilities
    AudioRecorder.resetProbe()
    // Update splitter settings without stopping
    trackSplitter.updateSettings(settings)
  })

  // ffmpeg path detection — clears any override, re-runs detection, returns resolved path
  ipcMain.handle('ffmpeg:detect', async () => {
    setFfmpegOverride(null)
    AudioRecorder.resetProbe()
    const resolved = detectFfmpegPath()
    void AudioRecorder.probe()
    return resolved
  })

  // Current resolved ffmpeg path (override or auto-detected)
  ipcMain.handle('ffmpeg:get-path', () => getFfmpegPath())

  // Audio devices
  ipcMain.handle('audio:devices', () => listAudioDevices())

  // File dialog
  ipcMain.handle('dialog:pick-output-dir', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Output Folder'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Shell
  ipcMain.handle('shell:open-path', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // Title bar overlay (min/max/close buttons are drawn natively by Windows so
  // Snap Layouts works; keep their color in sync with the app's light/dark theme)
  ipcMain.handle(
    'window:set-titlebar-overlay',
    (_event, overlay: { color: string; symbolColor: string }) => {
      mainWindow?.setTitleBarOverlay({ ...overlay, height: 32 })
    }
  )

  // ─── Trim / preset handlers ─────────────────────────────────────────────

  // Apply a trim in-place to an already-saved file: re-encodes from startSec to endSec
  ipcMain.handle('trim:apply', async (_event, filePath: string, startSec: number, endSec: number) => {
    await AudioRecorder.retrimFile(filePath, startSec, endSec)
    return { durationSec: Math.round(endSec - startSec) }
  })

  // Retrieve the preset saved for a given artist+title (or global)
  ipcMain.handle('trim:get-preset', (_event, artist: string, title: string) => {
    return getTrimPreset(artist, title)
  })

  // Retrieve all saved presets
  ipcMain.handle('trim:get-all-presets', () => {
    return loadAllTrimPresets()
  })

  // Save a preset for a specific song (title=null saves as global default)
  ipcMain.handle(
    'trim:save-preset',
    (_event, artist: string, title: string | null, startOffsetSec: number, endOffsetSec: number) => {
      saveTrimPreset(artist, title, { startOffsetSec, endOffsetSec })
    }
  )

  // Delete the preset for a specific song
  ipcMain.handle('trim:delete-preset', (_event, artist: string, title: string) => {
    deleteTrimPreset(artist, title)
  })
}

// ─── App lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.autotape3000.app')
  registerArtProtocol()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  const settings = loadSettings()
  // Apply saved ffmpeg path override before any detection
  setFfmpegOverride(settings.ffmpegPath?.trim() || null)
  gsmtcService.setSourceFilter(settings.sessionFilter)
  wireGsmtc()
  wireSplitter()
  createWindow()
  _flushWindowState = trackWindowState(mainWindow!)

  // Pre-warm ffmpeg capability detection asynchronously to avoid blocking
  // the event loop (and freezing the UI) when the user first presses Record.
  void AudioRecorder.probe()

  // Start GSMTC polling once window is created (very fast cadence to minimize split lag)
  gsmtcService.start(100)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      _flushWindowState = trackWindowState(mainWindow!)
    }
  })
})

app.on('window-all-closed', async () => {
  await trackSplitter.stopListening()
  gsmtcService.stop()
  // Window state is already flushed in mainWindow.on('closed') above
  if (process.platform !== 'darwin') app.quit()
})
