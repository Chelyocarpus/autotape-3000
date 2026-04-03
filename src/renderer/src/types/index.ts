export type MediaFormat = 'mp3' | 'wav'
export type DuplicateAction = 'skip' | 'overwrite' | 'increment'

export interface TrimPreset {
  /** Extra seconds to trim from the start of the recorded file. */
  startOffsetSec: number
  /** Extra seconds to trim from the end of the recorded file. */
  endOffsetSec: number
}

export interface GsmtcTrack {
  artist: string
  title: string
  album: string
  albumArtFile: string
  albumArtMime?: string
  sourceAppId?: string
  positionMs?: number
  isPlaying: boolean
}

export interface UserSettings {
  outputDir: string
  format: MediaFormat
  bitrate: number
  deviceId: string
  duplicateAction: DuplicateAction
  sessionFilter: string
  minSaveSeconds: number
  /** Explicit path to the ffmpeg binary. Empty string = auto-detect. */
  ffmpegPath: string
}

export interface SourceSessionOption {
  sourceAppId: string
  title: string
  artist: string
  isPlaying: boolean
  hasArtwork: boolean
}

export interface AudioDevice {
  id: string
  name: string
}

export interface RecordingEntry {
  id: string
  artist: string
  title: string
  filePath: string
  albumArtFile?: string
  albumArtMime?: string
  durationSec: number
  status: 'ok' | 'skipped' | 'error'
  error?: string
  startedAt: number
}

export type RecordingState = 'idle' | 'recording'
