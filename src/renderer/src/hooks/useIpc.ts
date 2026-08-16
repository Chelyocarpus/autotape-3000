import { useEffect, useState, useCallback, useRef } from 'react'
import type { GsmtcTrack, UserSettings, RecordingEntry, AudioDevice, SourceSessionOption } from '../types'
import type { ElectronAPI } from '../../../preload'

// The electronAPI is injected by the preload script via contextBridge — its
// shape is defined once in preload/index.ts and imported here so the two
// can't drift apart.
declare global {
  interface Window {
    electronAPI: ElectronAPI
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
  const [silenceWarning, setSilenceWarning] = useState(false)
  // Best-effort "a stopped recording is being written to disk" indicator — not
  // matched to a specific entry by id, just cleared on the next finish/error so
  // it can't get stuck showing if a finalize fails.
  const [finalizingTrack, setFinalizingTrack] = useState<GsmtcTrack | null>(null)
  const startTimeRef = useRef<number>(0)

  const start = useCallback(async () => {
    await window.electronAPI.startRecording()
    setIsRecording(true)
    setSilenceWarning(false)
    startTimeRef.current = Date.now()
    setElapsed(0)
  }, [])

  const stop = useCallback(async () => {
    await window.electronAPI.stopRecording()
    setIsRecording(false)
    setCurrentTrack(null)
    setElapsed(0)
    setSilenceWarning(false)
  }, [])

  useEffect(() => {
    const unsubStarted = window.electronAPI.onRecordingStarted((track) => {
      setCurrentTrack(track)
      setSilenceWarning(false)
      startTimeRef.current = Date.now()
      setElapsed(0)
    })
    const unsubFinished = window.electronAPI.onRecordingFinished((entry) => {
      setFinalizingTrack(null)
      onEntry(entry)
    })
    const unsubFinalizing = window.electronAPI.onRecordingFinalizing((track) => {
      setFinalizingTrack(track)
    })
    const unsubSilence = window.electronAPI.onSilenceWarning(() => setSilenceWarning(true))
    const unsubAudio = window.electronAPI.onAudioDetected(() => setSilenceWarning(false))
    return () => {
      unsubStarted()
      unsubFinished()
      unsubFinalizing()
      unsubSilence()
      unsubAudio()
    }
  }, [onEntry])

  // Elapsed timer — computed from wall-clock time to survive window throttling
  useEffect(() => {
    if (!isRecording) return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [isRecording])

  return { isRecording, currentTrack, elapsed, silenceWarning, finalizingTrack, start, stop }
}

/** Read the running app's version (from package.json via Electron) */
export function useAppVersion(): string {
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion).catch(() => {})
  }, [])
  return version
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
