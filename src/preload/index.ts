import { contextBridge, ipcRenderer } from 'electron'
import type { AudioDevice, GsmtcTrack, RecordingEntry, SourceSessionOption, TrimPreset, UserSettings } from '../shared/types'

// The renderer imports `ElectronAPI` (inferred from `api` below) to type
// `window.electronAPI` — see useIpc.ts — so this object's shape is the one
// and only source of truth for what's exposed across the contextBridge.
const api = {
  // App metadata
  getAppVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,

  // Theme — main resolves persisted-choice-or-OS-preference before the
  // window is even created, so its initial title bar overlay never flashes
  // the wrong color. The renderer persists its choice back via saveTheme.
  getTheme: () => ipcRenderer.invoke('theme:get') as Promise<'dark' | 'light'>,
  saveTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('theme:save', theme) as Promise<void>,

  // GSMTC events (main → renderer pushes)
  onTrackChanged: (cb: (track: GsmtcTrack) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, track: GsmtcTrack) => cb(track)
    ipcRenderer.on('gsmtc:track-changed', handler)
    return (): void => void ipcRenderer.off('gsmtc:track-changed', handler)
  },

  onPlayStateChanged: (cb: (isPlaying: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isPlaying: boolean) => cb(isPlaying)
    ipcRenderer.on('gsmtc:play-state', handler)
    return (): void => void ipcRenderer.off('gsmtc:play-state', handler)
  },

  onArtworkUpdated: (cb: (track: GsmtcTrack) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, track: GsmtcTrack) => cb(track)
    ipcRenderer.on('gsmtc:artwork-updated', handler)
    return (): void => void ipcRenderer.off('gsmtc:artwork-updated', handler)
  },

  getCurrentTrack: () => ipcRenderer.invoke('gsmtc:get-current') as Promise<GsmtcTrack>,
  listSessions: () => ipcRenderer.invoke('gsmtc:list-sessions') as Promise<SourceSessionOption[]>,

  // Recording
  startRecording: () => ipcRenderer.invoke('recorder:start') as Promise<void>,
  stopRecording: () => ipcRenderer.invoke('recorder:stop') as Promise<void>,

  onRecordingStarted: (cb: (track: GsmtcTrack) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, track: GsmtcTrack) => cb(track)
    ipcRenderer.on('recorder:started', handler)
    return (): void => void ipcRenderer.off('recorder:started', handler)
  },

  onRecordingFinished: (cb: (entry: RecordingEntry) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: RecordingEntry) => cb(entry)
    ipcRenderer.on('recorder:finished', handler)
    return (): void => void ipcRenderer.off('recorder:finished', handler)
  },

  onRecordingFinalizing: (cb: (track: GsmtcTrack) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, track: GsmtcTrack) => cb(track)
    ipcRenderer.on('recorder:finalizing', handler)
    return (): void => void ipcRenderer.off('recorder:finalizing', handler)
  },

  onSilenceWarning: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('recorder:silence-warning', handler)
    return (): void => void ipcRenderer.off('recorder:silence-warning', handler)
  },

  onAudioDetected: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('recorder:audio-detected', handler)
    return (): void => void ipcRenderer.off('recorder:audio-detected', handler)
  },

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<UserSettings>,
  saveSettings: (s: UserSettings) => ipcRenderer.invoke('settings:save', s) as Promise<void>,

  // Audio devices
  getAudioDevices: () => ipcRenderer.invoke('audio:devices') as Promise<AudioDevice[]>,

  // ffmpeg binary path
  detectFfmpeg: () => ipcRenderer.invoke('ffmpeg:detect') as Promise<string>,
  getFfmpegPath: () => ipcRenderer.invoke('ffmpeg:get-path') as Promise<string>,

  // File dialog
  pickOutputDir: () => ipcRenderer.invoke('dialog:pick-output-dir') as Promise<string | null>,

  // Shell
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path) as Promise<void>,

  // Title bar overlay (native Windows min/max/close buttons)
  setTitleBarOverlay: (overlay: { color: string; symbolColor: string }) =>
    ipcRenderer.invoke('window:set-titlebar-overlay', overlay) as Promise<void>,

  // ─── Trim / preset ─────────────────────────────────────────────────────
  trimApply: (filePath: string, startSec: number, endSec: number) =>
    ipcRenderer.invoke('trim:apply', filePath, startSec, endSec) as Promise<{ durationSec: number }>,

  trimGetPreset: (artist: string, title: string) =>
    ipcRenderer.invoke('trim:get-preset', artist, title) as Promise<TrimPreset | null>,

  trimGetAllPresets: () =>
    ipcRenderer.invoke('trim:get-all-presets') as Promise<Record<string, TrimPreset>>,

  trimSavePreset: (artist: string, title: string | null, startOffsetSec: number, endOffsetSec: number) =>
    ipcRenderer.invoke('trim:save-preset', artist, title, startOffsetSec, endOffsetSec) as Promise<void>,

  trimDeletePreset: (artist: string, title: string) =>
    ipcRenderer.invoke('trim:delete-preset', artist, title) as Promise<void>,

  trimHasLosslessSource: (filePath: string) =>
    ipcRenderer.invoke('trim:has-lossless-source', filePath) as Promise<boolean>,

  // Raw audio bytes for the trim preview's waveform decode (see main/index.ts
  // for why this goes over IPC instead of fetch() against autotape-audio://).
  readAudioFile: (filePath: string) =>
    ipcRenderer.invoke('audio:read-file', filePath) as Promise<Uint8Array>
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('electronAPI', api)
