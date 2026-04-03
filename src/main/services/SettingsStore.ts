import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { DuplicateAction, MediaFormat } from './FileManager'

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

const DEFAULTS: UserSettings = {
  outputDir: join(homedir(), 'Music', 'Autotape 3000'),
  format: 'mp3',
  bitrate: 320,
  deviceId: 'default',
  duplicateAction: 'increment',
  sessionFilter: 'auto',
  minSaveSeconds: 0,
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
