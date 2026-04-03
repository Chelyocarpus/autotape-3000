import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface TrimPreset {
  /** Extra seconds to trim from the start of the recorded file. */
  startOffsetSec: number
  /** Extra seconds to trim from the end of the recorded file. */
  endOffsetSec: number
}

const GLOBAL_KEY = '*'

function presetsFilePath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'trim-presets.json')
}

export function makePresetKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}|||${title.trim().toLowerCase()}`
}

export function loadAllTrimPresets(): Record<string, TrimPreset> {
  const p = presetsFilePath()
  if (!existsSync(p)) return {}
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, TrimPreset>) : {}
  } catch {
    return {}
  }
}

function persistPresets(presets: Record<string, TrimPreset>): void {
  writeFileSync(presetsFilePath(), JSON.stringify(presets, null, 2), 'utf-8')
}

export function getTrimPreset(artist: string, title: string): TrimPreset | null {
  const presets = loadAllTrimPresets()
  const songKey = makePresetKey(artist, title)
  return presets[songKey] ?? presets[GLOBAL_KEY] ?? null
}

export function saveTrimPreset(
  artist: string,
  title: string | null,
  preset: TrimPreset
): void {
  const presets = loadAllTrimPresets()
  const key = title !== null ? makePresetKey(artist, title) : GLOBAL_KEY
  presets[key] = preset
  persistPresets(presets)
}

export function deleteTrimPreset(artist: string, title: string): void {
  const presets = loadAllTrimPresets()
  const key = makePresetKey(artist, title)
  delete presets[key]
  persistPresets(presets)
}
