import { contextBridge, ipcRenderer } from 'electron'

// Expose a typed API to the renderer via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  // GSMTC events (main → renderer pushes)
  onTrackChanged: (cb: (track: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, track: unknown) => cb(track)
    ipcRenderer.on('gsmtc:track-changed', handler)
    return () => ipcRenderer.off('gsmtc:track-changed', handler)
  },

  onPlayStateChanged: (cb: (isPlaying: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isPlaying: boolean) => cb(isPlaying)
    ipcRenderer.on('gsmtc:play-state', handler)
    return () => ipcRenderer.off('gsmtc:play-state', handler)
  },

  onArtworkUpdated: (cb: (track: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, track: unknown) => cb(track)
    ipcRenderer.on('gsmtc:artwork-updated', handler)
    return () => ipcRenderer.off('gsmtc:artwork-updated', handler)
  },

  getCurrentTrack: () => ipcRenderer.invoke('gsmtc:get-current'),
  listSessions: () => ipcRenderer.invoke('gsmtc:list-sessions'),

  // Recording
  startRecording: () => ipcRenderer.invoke('recorder:start'),
  stopRecording: () => ipcRenderer.invoke('recorder:stop'),

  onRecordingStarted: (cb: (track: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, track: unknown) => cb(track)
    ipcRenderer.on('recorder:started', handler)
    return () => ipcRenderer.off('recorder:started', handler)
  },

  onRecordingFinished: (cb: (entry: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: unknown) => cb(entry)
    ipcRenderer.on('recorder:finished', handler)
    return () => ipcRenderer.off('recorder:finished', handler)
  },

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: unknown) => ipcRenderer.invoke('settings:save', s),

  // Audio devices
  getAudioDevices: () => ipcRenderer.invoke('audio:devices'),

  // ffmpeg binary path
  detectFfmpeg: () => ipcRenderer.invoke('ffmpeg:detect') as Promise<string>,
  getFfmpegPath: () => ipcRenderer.invoke('ffmpeg:get-path') as Promise<string>,

  // File dialog
  pickOutputDir: () => ipcRenderer.invoke('dialog:pick-output-dir'),

  // Shell
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
  onWindowMaximizeChange: (cb: (isMaximized: boolean) => void) => {
    const maximize = () => cb(true)
    const unmaximize = () => cb(false)
    ipcRenderer.on('window:maximized', maximize)
    ipcRenderer.on('window:unmaximized', unmaximize)
    return () => {
      ipcRenderer.off('window:maximized', maximize)
      ipcRenderer.off('window:unmaximized', unmaximize)
    }
  },

  // ─── Trim / preset ─────────────────────────────────────────────────────
  trimApply: (filePath: string, startSec: number, endSec: number) =>
    ipcRenderer.invoke('trim:apply', filePath, startSec, endSec) as Promise<{ durationSec: number }>,

  trimGetPreset: (artist: string, title: string) =>
    ipcRenderer.invoke('trim:get-preset', artist, title) as Promise<{ startOffsetSec: number; endOffsetSec: number } | null>,

  trimGetAllPresets: () =>
    ipcRenderer.invoke('trim:get-all-presets') as Promise<Record<string, { startOffsetSec: number; endOffsetSec: number }>>,

  trimSavePreset: (artist: string, title: string | null, startOffsetSec: number, endOffsetSec: number) =>
    ipcRenderer.invoke('trim:save-preset', artist, title, startOffsetSec, endOffsetSec) as Promise<void>,

  trimDeletePreset: (artist: string, title: string) =>
    ipcRenderer.invoke('trim:delete-preset', artist, title) as Promise<void>
})
