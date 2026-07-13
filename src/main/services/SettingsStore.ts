import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { DuplicateAction, MediaFormat } from './FileManager'
import { APP_LOOPBACK_DEVICE_ID, isProcessLoopbackSupported } from './AudioDevices'

export interface UserSettings {
  outputDir: string
  format: MediaFormat
  bitrate: number
  deviceId: string
  duplicateAction: DuplicateAction
  sessionFilter: string
  minSaveSeconds: number
  /** Seconds paused before an in-progress recording is stopped and discarded. 0 disables. */
  pauseDiscardSeconds: number
  /** Explicit path to the ffmpeg binary. Empty string = auto-detect. */
  ffmpegPath: string
}

const DEFAULTS: UserSettings = {
  outputDir: join(homedir(), 'Music', 'Autotape 3000'),
  format: 'mp3',
  bitrate: 320,
  deviceId: isProcessLoopbackSupported() ? APP_LOOPBACK_DEVICE_ID : 'default',
  duplicateAction: 'increment',
  sessionFilter: 'auto',
  minSaveSeconds: 0,
  pauseDiscardSeconds: 60,
  ffmpegPath: ''
}

function settingsPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

export function loadSettings(): UserSettings {
  const p = settingsPath()
  if (!existsSync(p)) return { ...DEFAULTS }
  try {
    const raw = readFileSync(p, 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) } as UserSettings
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: UserSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}
