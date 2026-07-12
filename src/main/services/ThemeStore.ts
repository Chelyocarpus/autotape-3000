import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export type Theme = 'dark' | 'light'

function themePath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'theme.json')
}

/** Returns the last theme the user explicitly chose, or null if none is saved yet. */
export function loadTheme(): Theme | null {
  const p = themePath()
  if (!existsSync(p)) return null
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as { theme?: string }
    return parsed.theme === 'dark' || parsed.theme === 'light' ? parsed.theme : null
  } catch {
    return null
  }
}

export function saveTheme(theme: Theme): void {
  writeFileSync(themePath(), JSON.stringify({ theme }), 'utf-8')
}
