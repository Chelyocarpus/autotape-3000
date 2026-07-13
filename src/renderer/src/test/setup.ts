import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

// jsdom has no ResizeObserver; SongTrimModal and other components use it.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub

// jsdom doesn't implement 2D canvas contexts; SongTrimModal's drawWaveform()
// already no-ops when getContext() returns null, so returning null here (vs.
// jsdom's noisy "Not implemented" console error) matches what real headless
// test/CI environments without the optional `canvas` package actually get.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

// The real API is injected by the preload script via contextBridge; tests run
// without Electron, so every renderer test gets a fresh no-op/resolved-promise
// stand-in it can override per-test with vi.spyOn(window.electronAPI, ...).
function makeElectronApiMock(): Window['electronAPI'] {
  return {
    getAppVersion: () => Promise.resolve('0.0.0-test'),

    getTheme: () => Promise.resolve('dark' as const),
    saveTheme: () => Promise.resolve(),

    onTrackChanged: () => () => {},
    onPlayStateChanged: () => () => {},
    onArtworkUpdated: () => () => {},
    getCurrentTrack: () => Promise.resolve({
      artist: '', title: '', album: '', albumArtFile: '', isPlaying: false
    }),
    listSessions: () => Promise.resolve([]),

    startRecording: () => Promise.resolve(),
    stopRecording: () => Promise.resolve('stopped' as const),
    onRecordingStarted: () => () => {},
    onRecordingFinished: () => () => {},
    onRecordingStopped: () => () => {},
    onRecordingIdle: () => () => {},
    onSilenceWarning: () => () => {},
    onAudioDetected: () => () => {},

    getSettings: () => Promise.resolve({
      outputDir: 'C:\\Music',
      format: 'mp3',
      bitrate: 320,
      deviceId: 'default',
      duplicateAction: 'increment',
      sessionFilter: 'auto',
      minSaveSeconds: 0,
      pauseDiscardSeconds: 60,
      ffmpegPath: ''
    }),
    saveSettings: () => Promise.resolve(),

    getAudioDevices: () => Promise.resolve([]),
    readAudioFile: () => Promise.resolve(new Uint8Array(8)),

    detectFfmpeg: () => Promise.resolve(''),
    getFfmpegPath: () => Promise.resolve(''),

    pickOutputDir: () => Promise.resolve(null),

    openPath: () => Promise.resolve(),

    setTitleBarOverlay: () => Promise.resolve(),

    trimApply: () => Promise.resolve({ durationSec: 0 }),
    trimGetPreset: () => Promise.resolve(null),
    trimGetAllPresets: () => Promise.resolve({}),
    trimSavePreset: () => Promise.resolve(),
    trimDeletePreset: () => Promise.resolve()
  }
}

beforeEach(() => {
  ;(window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI = makeElectronApiMock()
})
