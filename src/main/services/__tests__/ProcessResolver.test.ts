import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false }
}))

const execFileMock = vi.fn()

vi.mock('child_process', () => {
  const execFile = (...args: unknown[]) => execFileMock(...args)
  return { execFile, default: { execFile } }
})

import { classifyAumid, resolveAumidToPid } from '../ProcessResolver'

type ExecFileCallback = (err: Error | null, stdout?: string) => void

/** Mocks the next execFile call (the resolve-loopback-target.ps1 invocation) to return this payload. */
function mockLoopbackTarget(payload: {
  windows?: Array<{ Pid: number; Aumid: string }>
  processes?: Array<{ ProcessName: string; Id: number; MainWindowHandle?: number }>
}): void {
  execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
    cb(null, JSON.stringify(payload))
  })
}

describe('classifyAumid', () => {
  it('treats a packaged-app AUMID (PackageFamilyName!AppId) as unsupported', () => {
    expect(classifyAumid('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify')).toEqual({ kind: 'packaged' })
  })

  it('treats an empty AUMID as unsupported', () => {
    expect(classifyAumid('  ')).toEqual({ kind: 'packaged' })
  })

  it('extracts the exe name from a full win32 path AUMID', () => {
    expect(classifyAumid('C:\\Program Files\\Spotify\\Spotify.exe')).toEqual({
      kind: 'win32',
      exeName: 'Spotify.exe'
    })
  })

  it('extracts the exe name from a forward-slash path', () => {
    expect(classifyAumid('C:/Apps/foobar2000/foobar2000.exe')).toEqual({
      kind: 'win32',
      exeName: 'foobar2000.exe'
    })
  })

  it('treats a bare exe name as-is', () => {
    expect(classifyAumid('vlc.exe')).toEqual({ kind: 'win32', exeName: 'vlc.exe' })
  })

  it('appends .exe to a bare app name with no path or extension', () => {
    expect(classifyAumid('Chrome')).toEqual({ kind: 'win32', exeName: 'Chrome.exe' })
  })
})

describe('resolveAumidToPid', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('returns null without querying processes for a packaged-app AUMID', async () => {
    const pid = await resolveAumidToPid('Some.Package_abc123!App')
    expect(pid).toBeNull()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('resolves via an exact window AppUserModel.ID match, even when it bears no relation to the exe name', async () => {
    // Reproduces a real machine: Firefox (and Chromium) assign each top-level window its
    // own generated AUMID for taskbar/jump-list grouping, unrelated to the process image
    // name — the exe-name-guess fallback can never match "E020BA2ACACF116C" to firefox.exe.
    mockLoopbackTarget({
      windows: [{ Pid: 19412, Aumid: 'E020BA2ACACF116C' }],
      processes: [{ ProcessName: 'firefox', Id: 19412, MainWindowHandle: 12345 }]
    })

    const pid = await resolveAumidToPid('E020BA2ACACF116C')
    expect(pid).toBe(19412)
  })

  it('matches the window AUMID case-insensitively', async () => {
    mockLoopbackTarget({
      windows: [{ Pid: 19412, Aumid: 'E020BA2ACACF116C' }],
      processes: []
    })

    const pid = await resolveAumidToPid('e020ba2acacf116c')
    expect(pid).toBe(19412)
  })

  it('resolves the PID of the process matching the exe name (case-insensitive, no .exe in Get-Process output)', async () => {
    mockLoopbackTarget({
      processes: [
        { ProcessName: 'explorer', Id: 111 },
        { ProcessName: 'spotify', Id: 4242 }
      ]
    })

    const pid = await resolveAumidToPid('Spotify.exe')
    expect(pid).toBe(4242)
  })

  it('handles PowerShell collapsing a single-element windows/processes array to a bare object', async () => {
    execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(null, JSON.stringify({ windows: { Pid: 111, Aumid: 'Foo' }, processes: { ProcessName: 'Spotify', Id: 99 } }))
    })

    const pid = await resolveAumidToPid('Spotify.exe')
    expect(pid).toBe(99)
  })

  it('prefers the match that owns a top-level window over other same-named processes', async () => {
    // Reproduces a real machine: apps like Spotify run several same-named helper/GPU/
    // renderer processes alongside the one that actually owns the UI window and audio
    // session. Picking the first match (array order, not window-ownership) would target
    // a silent sibling — process-loopback only captures the targeted process's own
    // descendants, so that produces a "no audio detected" recording.
    mockLoopbackTarget({
      processes: [
        { ProcessName: 'Spotify', Id: 6352, MainWindowHandle: 0 },
        { ProcessName: 'Spotify', Id: 12208, MainWindowHandle: 0 },
        { ProcessName: 'Spotify', Id: 26260, MainWindowHandle: 67692 },
        { ProcessName: 'Spotify', Id: 26500, MainWindowHandle: 0 }
      ]
    })

    const pid = await resolveAumidToPid('Spotify.exe')
    expect(pid).toBe(26260)
  })

  it('falls back to the first match when none of the same-named processes own a window', async () => {
    mockLoopbackTarget({
      processes: [
        { ProcessName: 'foobar2000', Id: 555, MainWindowHandle: 0 },
        { ProcessName: 'foobar2000', Id: 777, MainWindowHandle: 0 }
      ]
    })

    const pid = await resolveAumidToPid('foobar2000.exe')
    expect(pid).toBe(555)
  })

  it('returns null when no window or process matches', async () => {
    mockLoopbackTarget({
      windows: [{ Pid: 111, Aumid: 'SomeOtherApp' }],
      processes: [{ ProcessName: 'explorer', Id: 111 }]
    })

    const pid = await resolveAumidToPid('Spotify.exe')
    expect(pid).toBeNull()
  })

  it('returns null when the PowerShell query fails', async () => {
    execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(new Error('spawn failed'))
    })

    const pid = await resolveAumidToPid('Spotify.exe')
    expect(pid).toBeNull()
  })
})
