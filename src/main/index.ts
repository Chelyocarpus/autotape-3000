import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { GsmtcService } from './services/GsmtcService'
import { TrackSplitter } from './services/TrackSplitter'
import { AudioRecorder } from './services/AudioRecorder'
import { listAudioDevices } from './services/AudioDevices'
import { loadSettings, saveSettings } from './services/SettingsStore'
import { setFfmpegOverride, detectFfmpegPath, getFfmpegPath } from './services/FfmpegResolver'
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
const gsmtcService = new GsmtcService()
const trackSplitter = new TrackSplitter(gsmtcService)

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 560,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    backgroundColor: '#0f0f13',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized')
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:unmaximized')
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
}

// ─── IPC handlers ──────────────────────────────────────────────────────────
function registerIpcHandlers(): void {
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

  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)

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

  // Pre-warm ffmpeg capability detection asynchronously to avoid blocking
  // the event loop (and freezing the UI) when the user first presses Record.
  void AudioRecorder.probe()

  // Start GSMTC polling once window is created (very fast cadence to minimize split lag)
  gsmtcService.start(100)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await trackSplitter.stopListening()
  gsmtcService.stop()
  if (process.platform !== 'darwin') app.quit()
})
