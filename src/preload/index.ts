import { contextBridge, ipcRenderer } from 'electron'

// Expose a typed API to the renderer via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  // App metadata
  getAppVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,

  // Theme — main resolves persisted-choice-or-OS-preference before the
  // window is even created, so its initial title bar overlay never flashes
  // the wrong color. The renderer persists its choice back via saveTheme.
  getTheme: () => ipcRenderer.invoke('theme:get') as Promise<'dark' | 'light'>,
  saveTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('theme:save', theme) as Promise<void>,

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
  stopRecording: () => ipcRenderer.invoke('recorder:stop') as Promise<'stopped' | 'pending'>,

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

  onRecordingStopped: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('recorder:stopped', handler)
    return () => ipcRenderer.off('recorder:stopped', handler)
  },

  onRecordingIdle: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('recorder:idle', handler)
    return () => ipcRenderer.off('recorder:idle', handler)
  },

  onSilenceWarning: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('recorder:silence-warning', handler)
    return () => ipcRenderer.off('recorder:silence-warning', handler)
  },

  onAudioDetected: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('recorder:audio-detected', handler)
    return () => ipcRenderer.off('recorder:audio-detected', handler)
  },

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: unknown) => ipcRenderer.invoke('settings:save', s),

  // Audio devices
  getAudioDevices: () => ipcRenderer.invoke('audio:devices'),
  readAudioFile: (filePath: string) => ipcRenderer.invoke('audio:read-file', filePath) as Promise<Uint8Array>,

  // ffmpeg binary path
  detectFfmpeg: () => ipcRenderer.invoke('ffmpeg:detect') as Promise<string>,
  getFfmpegPath: () => ipcRenderer.invoke('ffmpeg:get-path') as Promise<string>,

  // File dialog
  pickOutputDir: () => ipcRenderer.invoke('dialog:pick-output-dir'),

  // Shell
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),

  // Title bar overlay (native Windows min/max/close buttons)
  setTitleBarOverlay: (overlay: { color: string; symbolColor: string }) =>
    ipcRenderer.invoke('window:set-titlebar-overlay', overlay),

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
