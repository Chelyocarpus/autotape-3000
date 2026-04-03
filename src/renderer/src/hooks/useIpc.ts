import { useEffect, useState, useCallback, useRef } from 'react'
import type { GsmtcTrack, UserSettings, RecordingEntry, AudioDevice, SourceSessionOption } from '../types'

// The electronAPI is injected by the preload script via contextBridge
declare global {
  interface Window {
    electronAPI: {
      // GSMTC
      onTrackChanged: (cb: (track: GsmtcTrack) => void) => () => void
      onPlayStateChanged: (cb: (isPlaying: boolean) => void) => () => void
      onArtworkUpdated: (cb: (track: GsmtcTrack) => void) => () => void
      getCurrentTrack: () => Promise<GsmtcTrack>
      listSessions: () => Promise<SourceSessionOption[]>

      // Recording control
      startRecording: () => Promise<void>
      stopRecording: () => Promise<void>
      onRecordingStarted: (cb: (track: GsmtcTrack) => void) => () => void
      onRecordingFinished: (cb: (entry: RecordingEntry) => void) => () => void

      // Settings
      getSettings: () => Promise<UserSettings>
      saveSettings: (s: UserSettings) => Promise<void>

      // Audio devices
      getAudioDevices: () => Promise<AudioDevice[]>

      // ffmpeg binary path
      detectFfmpeg: () => Promise<string>
      getFfmpegPath: () => Promise<string>

      // File dialog
      pickOutputDir: () => Promise<string | null>

      // Shell
      openPath: (path: string) => Promise<void>

      // Window controls
      minimizeWindow: () => Promise<void>
      maximizeWindow: () => Promise<void>
      closeWindow: () => Promise<void>
      isWindowMaximized: () => Promise<boolean>
      onWindowMaximizeChange: (cb: (isMaximized: boolean) => void) => () => void

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
  const [currentTrack, setCurrentTrack] = useState<GsmtcTrack | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number>(0)

  const start = useCallback(async () => {
    await window.electronAPI.startRecording()
    setIsRecording(true)
    startTimeRef.current = Date.now()
    setElapsed(0)
  }, [])

  const stop = useCallback(async () => {
    await window.electronAPI.stopRecording()
    setIsRecording(false)
    setCurrentTrack(null)
    setElapsed(0)
  }, [])

  useEffect(() => {
    const unsubStarted = window.electronAPI.onRecordingStarted((track) => {
      setCurrentTrack(track)
      startTimeRef.current = Date.now()
      setElapsed(0)
    })
    const unsubFinished = window.electronAPI.onRecordingFinished((entry) => {
      onEntry(entry)
    })
    return () => {
      unsubStarted()
      unsubFinished()
    }
  }, [onEntry])

  // Elapsed timer — computed from wall-clock time to survive window throttling
  useEffect(() => {
    if (!isRecording) return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [isRecording])

  return { isRecording, currentTrack, elapsed, start, stop }
}

/** Load and save settings */
export function useSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null)

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings).catch(() => {})
  }, [])

  const save = useCallback(async (s: UserSettings) => {
    setSettings(s)
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
