import { useEffect, useState, useCallback, useRef } from 'react'
import type { GsmtcTrack, UserSettings, RecordingEntry, AudioDevice, SourceSessionOption } from '../types'

// The electronAPI is injected by the preload script via contextBridge
declare global {
  interface Window {
    electronAPI: {
      // App metadata
      getAppVersion: () => Promise<string>

      // Theme
      getTheme: () => Promise<'dark' | 'light'>
      saveTheme: (theme: 'dark' | 'light') => Promise<void>

      // GSMTC
      onTrackChanged: (cb: (track: GsmtcTrack) => void) => () => void
      onPlayStateChanged: (cb: (isPlaying: boolean) => void) => () => void
      onArtworkUpdated: (cb: (track: GsmtcTrack) => void) => () => void
      getCurrentTrack: () => Promise<GsmtcTrack>
      listSessions: () => Promise<SourceSessionOption[]>

      // Recording control
      startRecording: () => Promise<void>
      // 'pending' means the stop was deferred until the current track ends —
      // calling stopRecording() again while pending forces an immediate stop.
      stopRecording: () => Promise<'stopped' | 'pending'>
      onRecordingStarted: (cb: (track: GsmtcTrack) => void) => () => void
      onRecordingFinished: (cb: (entry: RecordingEntry) => void) => () => void
      onRecordingStopped: (cb: () => void) => () => void
      // Session is still active, but nothing is currently being captured — e.g.
      // a recording was just dropped (long pause) with no new track to replace it.
      onRecordingIdle: (cb: () => void) => () => void
      onSilenceWarning: (cb: () => void) => () => void
      onAudioDetected: (cb: () => void) => () => void

      // Settings
      getSettings: () => Promise<UserSettings>
      saveSettings: (s: UserSettings) => Promise<void>

      // Audio devices
      getAudioDevices: () => Promise<AudioDevice[]>
      readAudioFile: (filePath: string) => Promise<Uint8Array>

      // ffmpeg binary path
      detectFfmpeg: () => Promise<string>
      getFfmpegPath: () => Promise<string>

      // File dialog
      pickOutputDir: () => Promise<string | null>

      // Shell
      openPath: (path: string) => Promise<void>

      // Title bar overlay (native Windows min/max/close buttons)
      setTitleBarOverlay: (overlay: { color: string; symbolColor: string }) => Promise<void>

      // Trim / presets
      trimApply: (filePath: string, startSec: number, endSec: number) => Promise<{ durationSec: number }>
      trimGetPreset: (artist: string, title: string) => Promise<{ startOffsetSec: number; endOffsetSec: number } | null>
      trimGetAllPresets: () => Promise<Record<string, { startOffsetSec: number; endOffsetSec: number }>>
      trimSavePreset: (artist: string, title: string | null, startOffsetSec: number, endOffsetSec: number) => Promise<void>
      trimDeletePreset: (artist: string, title: string) => Promise<void>
    }
  }
}

/** Subscribe to GSMTC track changes from the Electron main process */
export function useGsmtcTrack(): GsmtcTrack {
  const [track, setTrack] = useState<GsmtcTrack>({
    artist: '',
    title: '',
    album: '',
    albumArtFile: '',
    isPlaying: false
  })

  useEffect(() => {
    // Fetch initial state
    window.electronAPI.getCurrentTrack().then(setTrack).catch(() => {})

    // Subscribe to updates
    const unsub = window.electronAPI.onTrackChanged(setTrack)
    const unsubPlay = window.electronAPI.onPlayStateChanged((isPlaying) => {
      setTrack((t) => ({ ...t, isPlaying }))
    })
    const unsubArt = window.electronAPI.onArtworkUpdated((track) => {
      setTrack((t) => ({ ...t, albumArtFile: track.albumArtFile, albumArtMime: track.albumArtMime }))
    })

    return () => {
      unsub()
      unsubPlay()
      unsubArt()
    }
  }, [])

  return track
}

/** Recording state */
export function useRecording(onEntry: (e: RecordingEntry) => void) {
  const [isRecording, setIsRecording] = useState(false)
  const [stopPending, setStopPending] = useState(false)
  const [currentTrack, setCurrentTrack] = useState<GsmtcTrack | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [silenceWarning, setSilenceWarning] = useState(false)
  const startTimeRef = useRef<number>(0)

  const start = useCallback(async () => {
    await window.electronAPI.startRecording()
    setIsRecording(true)
    setStopPending(false)
    setSilenceWarning(false)
    startTimeRef.current = Date.now()
    setElapsed(0)
  }, [])

  // First call defers the stop until the current track ends; a second call
  // while already pending forces an immediate stop. Either way, isRecording
  // only flips off once the main process confirms via onRecordingStopped —
  // that's what actually happened, not what we asked for.
  const stop = useCallback(async () => {
    const result = await window.electronAPI.stopRecording()
    if (result === 'pending') setStopPending(true)
  }, [])

  useEffect(() => {
    const unsubStarted = window.electronAPI.onRecordingStarted((track) => {
      setCurrentTrack(track)
      setSilenceWarning(false)
      startTimeRef.current = Date.now()
      setElapsed(0)
    })
    const unsubFinished = window.electronAPI.onRecordingFinished((entry) => {
      onEntry(entry)
    })
    const unsubStopped = window.electronAPI.onRecordingStopped(() => {
      setIsRecording(false)
      setStopPending(false)
      setCurrentTrack(null)
      setElapsed(0)
      setSilenceWarning(false)
    })
    // Session is still on, but nothing is being captured right now (e.g. a
    // recording was just dropped after a long pause) — clear the stale track
    // and timer instead of leaving them frozen on whatever was captured last.
    const unsubIdle = window.electronAPI.onRecordingIdle(() => {
      setCurrentTrack(null)
      setElapsed(0)
      setSilenceWarning(false)
    })
    const unsubSilence = window.electronAPI.onSilenceWarning(() => setSilenceWarning(true))
    const unsubAudio = window.electronAPI.onAudioDetected(() => setSilenceWarning(false))
    return () => {
      unsubStarted()
      unsubFinished()
      unsubStopped()
      unsubIdle()
      unsubSilence()
      unsubAudio()
    }
  }, [onEntry])

  // Elapsed timer — computed from wall-clock time to survive window throttling.
  // Only ticks while a track is actually being captured, not just while the
  // session is armed and waiting (see onRecordingIdle above).
  useEffect(() => {
    if (!isRecording || !currentTrack) return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [isRecording, currentTrack])

  return { isRecording, stopPending, currentTrack, elapsed, silenceWarning, start, stop }
}

/** Read the running app's version (from package.json via Electron) */
export function useAppVersion(): string {
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion).catch(() => {})
  }, [])
  return version
}

// SettingsPanel and OnboardingWizard each call useSettings() independently. Without
// this, saving in one left every other mounted instance holding a stale snapshot
// until the whole renderer reloaded — e.g. picking a different capture device in a
// re-opened onboarding wizard didn't show up in Settings until an app restart.
const settingsListeners = new Set<(s: UserSettings) => void>()

/** Load and save settings */
export function useSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null)

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings).catch(() => {})
    settingsListeners.add(setSettings)
    return () => {
      settingsListeners.delete(setSettings)
    }
  }, [])

  const save = useCallback(async (s: UserSettings) => {
    for (const listener of settingsListeners) listener(s)
    await window.electronAPI.saveSettings(s)
  }, [])

  return { settings, save }
}

/** Load audio devices list */
export function useAudioDevices(): AudioDevice[] {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  useEffect(() => {
    window.electronAPI.getAudioDevices().then(setDevices).catch(() => {})
  }, [])
  return devices
}

/** Load available source sessions from GSMTC */
export function useSourceSessions(): SourceSessionOption[] {
  const [sessions, setSessions] = useState<SourceSessionOption[]>([])

  useEffect(() => {
    let mounted = true
    const load = () => {
      window.electronAPI.listSessions().then((items) => {
        if (mounted) setSessions(items)
      }).catch(() => {})
    }

    load()
    const id = setInterval(load, 2000)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [])

  return sessions
}

/** Read the currently resolved ffmpeg path and provide a callback to auto-detect */
export function useFfmpegPath() {
  const [resolvedPath, setResolvedPath] = useState<string>('')
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    window.electronAPI.getFfmpegPath().then(setResolvedPath).catch(() => {})
  }, [])

  const detect = useCallback(async () => {
    setDetecting(true)
    try {
      const path = await window.electronAPI.detectFfmpeg()
      setResolvedPath(path)
      return path
    } finally {
      setDetecting(false)
    }
  }, [])

  return { resolvedPath, detecting, detect }
}
