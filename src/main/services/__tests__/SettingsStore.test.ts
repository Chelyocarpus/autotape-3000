import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

describe('SettingsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'autotape-settings-'))
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns defaults when no settings file exists yet', async () => {
    const { loadSettings } = await import('../SettingsStore')
    const settings = loadSettings()
    expect(settings.format).toBe('mp3')
    expect(settings.bitrate).toBe(320)
  })

  it('round-trips a save/load', async () => {
    const { loadSettings, saveSettings } = await import('../SettingsStore')
    const settings = loadSettings()
    saveSettings({ ...settings, bitrate: 192, outputDir: 'D:\\Music' })
    const reloaded = loadSettings()
    expect(reloaded.bitrate).toBe(192)
    expect(reloaded.outputDir).toBe('D:\\Music')
  })

  it('merges defaults over a settings file missing newer fields', async () => {
    // Simulates upgrading from an older version whose settings.json predates
    // a field that was added later (e.g. ffmpegPath).
    writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ bitrate: 128 }), 'utf-8')
    const { loadSettings } = await import('../SettingsStore')
    const settings = loadSettings()
    expect(settings.bitrate).toBe(128)
    expect(settings.ffmpegPath).toBe('')
  })

  it('falls back to defaults when the settings file is corrupt', async () => {
    writeFileSync(join(userDataDir, 'settings.json'), '{not valid json', 'utf-8')
    const { loadSettings } = await import('../SettingsStore')
    expect(loadSettings().format).toBe('mp3')
  })
})
