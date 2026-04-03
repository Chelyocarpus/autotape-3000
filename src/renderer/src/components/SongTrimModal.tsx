import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X, Play, Square, Music2, Scissors, BookmarkCheck, BookmarkX, Loader2,
  ZoomIn, ZoomOut, Maximize2
} from 'lucide-react'
import { Button } from './ui/button'
import type { RecordingEntry } from '../types'

const MIN_ZOOM = 1
const MAX_ZOOM = 40

interface SongTrimModalProps {
  entry: RecordingEntry
  onClose: () => void
  onSaved: (updatedEntry: RecordingEntry) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatTime(sec: number): string {
  if (!isFinite(sec)) return '0:00.0'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

function formatOffset(sec: number, sign: '+' | '-'): string {
  if (!isFinite(sec) || Math.abs(sec) < 0.001) return ''
  return `${sign}${Math.abs(sec).toFixed(3)}s`
}

function buildAudioUrl(filePath: string): string {
  return `autotape-audio://file?path=${encodeURIComponent(filePath)}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ─── Waveform canvas drawing ───────────────────────────────────────────────
// viewStart / viewEnd are normalised fractions [0..1] of the full audio duration.
function drawWaveform(
  canvas: HTMLCanvasElement,
  channelData: Float32Array,
  startFrac: number,
  endFrac: number,
  playFrac: number,
  isDark: boolean,
  viewStart: number,
  viewEnd: number
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx || viewEnd <= viewStart) return

  const { width, height } = canvas
  const mid = height / 2
  const viewRange = viewEnd - viewStart

  const style = getComputedStyle(document.documentElement)
  const clr800 = style.getPropertyValue('--z-800').trim() || '#2a1b16'
  const clr500 = style.getPropertyValue('--z-500').trim() || '#b89080'
  const clrAmber = style.getPropertyValue('--color-amber-400').trim() || '#e2b59a'
  const clrAmberDim = style.getPropertyValue('--color-amber-700').trim() || '#957c62'

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = isDark ? clr800 : '#ecdabc'
  ctx.fillRect(0, 0, width, height)

  // Audio fraction → canvas X pixel
  const fracToX = (f: number): number => ((f - viewStart) / viewRange) * width

  // Selected region tint
  const sx = clamp(fracToX(startFrac), 0, width)
  const ex = clamp(fracToX(endFrac), 0, width)
  ctx.fillStyle = isDark ? 'rgba(226,181,154,0.10)' : 'rgba(226,181,154,0.22)'
  ctx.fillRect(sx, 0, ex - sx, height)

  // Waveform bars — only samples visible in the view window
  const totalSamples = channelData.length
  const sampleStart = Math.floor(viewStart * totalSamples)
  const sampleEnd = Math.ceil(viewEnd * totalSamples)
  const visibleSamples = sampleEnd - sampleStart
  const blockSize = Math.max(1, Math.floor(visibleSamples / width))

  for (let x = 0; x < width; x++) {
    const sampleIdx = sampleStart + Math.floor((x / width) * visibleSamples)
    let peak = 0
    for (let i = 0; i < blockSize; i++) {
      const abs = Math.abs(channelData[sampleIdx + i] ?? 0)
      if (abs > peak) peak = abs
    }
    const barH = Math.max(2, peak * (height - 4))
    const audioFrac = viewStart + (x / width) * viewRange
    ctx.fillStyle = audioFrac >= startFrac && audioFrac <= endFrac ? clrAmber : clrAmberDim
    ctx.fillRect(x, mid - barH / 2, 1, barH)
  }

  // Handle lines — only draw if in view
  ctx.lineWidth = 2
  if (startFrac >= viewStart && startFrac <= viewEnd) {
    const hx = Math.round(fracToX(startFrac))
    ctx.strokeStyle = clrAmber
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, height); ctx.stroke()
  }
  if (endFrac >= viewStart && endFrac <= viewEnd) {
    const hx = Math.round(fracToX(endFrac))
    ctx.strokeStyle = clrAmber
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, height); ctx.stroke()
  }

  // Off-screen handle indicators
  ctx.fillStyle = clrAmber
  if (startFrac < viewStart) {
    ctx.beginPath(); ctx.moveTo(8, mid); ctx.lineTo(16, mid - 5); ctx.lineTo(16, mid + 5); ctx.fill()
  }
  if (endFrac > viewEnd) {
    ctx.beginPath(); ctx.moveTo(width - 8, mid); ctx.lineTo(width - 16, mid - 5); ctx.lineTo(width - 16, mid + 5); ctx.fill()
  }

  // Playhead
  if (playFrac >= viewStart && playFrac <= viewEnd && playFrac > 0) {
    const px = Math.round(fracToX(playFrac))
    ctx.strokeStyle = clr500
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke()
    ctx.setLineDash([])
  }

  // Time ruler ticks
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  const tickCount = Math.floor(width / 80)
  for (let t = 1; t < tickCount; t++) {
    ctx.fillRect(Math.round((t / tickCount) * width), height - 6, 1, 6)
  }
}

// ─── Main component ────────────────────────────────────────────────────────

export function SongTrimModal({ entry, onClose, onSaved }: SongTrimModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const playStartTimeRef = useRef<number>(0)
  const playOffsetRef = useRef<number>(0)
  const channelDataRef = useRef<Float32Array | null>(null)
  const animFrameRef = useRef<number>(0)

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
  const [duration, setDuration] = useState(entry.durationSec > 0 ? entry.durationSec : 0)
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState(entry.durationSec > 0 ? entry.durationSec : 0)
  const [playheadSec, setPlayheadSec] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveAsPreset, setSaveAsPreset] = useState(false)
  const [applyToAllSongs, setApplyToAllSongs] = useState(false)
  const [existingPreset, setExistingPreset] = useState<{ startOffsetSec: number; endOffsetSec: number } | null>(null)
  const [isDark] = useState(() => document.documentElement.getAttribute('data-theme') !== 'light')

  // Zoom state: zoom ≥ 1, viewOffset is the normalised left edge of the view window
  const [zoom, setZoom] = useState(1)
  const [viewOffset, setViewOffset] = useState(0)

  // Stable refs for callbacks
  const startSecRef = useRef(startSec)
  const endSecRef = useRef(endSec)
  const durationRef = useRef(duration)
  const zoomRef = useRef(zoom)
  const viewOffsetRef = useRef(viewOffset)
  useEffect(() => { startSecRef.current = startSec }, [startSec])
  useEffect(() => { endSecRef.current = endSec }, [endSec])
  useEffect(() => { durationRef.current = duration }, [duration])
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { viewOffsetRef.current = viewOffset }, [viewOffset])

  // ─── Load preset ──────────────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI.trimGetPreset(entry.artist, entry.title)
      .then((p) => setExistingPreset(p))
      .catch(() => {})
  }, [entry.artist, entry.title])

  // ─── Decode audio ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!entry.filePath) {
      setLoadError('No file path available.')
      setIsLoading(false)
      return
    }

    const abortCtrl = new AbortController()
    setIsLoading(true)
    setLoadError(null)

    fetch(buildAudioUrl(entry.filePath), { signal: abortCtrl.signal })
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const ctx = new AudioContext()
        audioCtxRef.current = ctx
        return ctx.decodeAudioData(buf)
      })
      .then((decoded) => {
        if (abortCtrl.signal.aborted) return
        const dur = decoded.duration
        channelDataRef.current = decoded.getChannelData(0)
        setAudioBuffer(decoded)
        setDuration(dur)
        setStartSec(0)
        setEndSec(dur)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (abortCtrl.signal.aborted) return
        setLoadError((err instanceof Error ? err.message : String(err)) || 'Failed to load audio.')
        setIsLoading(false)
      })

    return () => {
      abortCtrl.abort()
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [entry.filePath])

  // ─── Derived view window ──────────────────────────────────────────────
  const viewSize = 1 / zoom
  const viewStart = clamp(viewOffset, 0, 1 - viewSize)
  const viewEnd = viewStart + viewSize

  // ─── Redraw ───────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !channelDataRef.current) return
    const dur = durationRef.current
    const vz = zoomRef.current
    const vs = clamp(viewOffsetRef.current, 0, 1 - 1 / vz)
    drawWaveform(
      canvas,
      channelDataRef.current,
      dur > 0 ? startSecRef.current / dur : 0,
      dur > 0 ? endSecRef.current / dur : 1,
      dur > 0 ? playheadSec / dur : 0,
      isDark,
      vs,
      vs + 1 / vz
    )
  }, [isDark, playheadSec])

  useEffect(() => { redraw() }, [startSec, endSec, playheadSec, duration, isDark, audioBuffer, zoom, viewOffset, redraw])

  // ─── Canvas resize observer ───────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      canvas.width = Math.round(canvas.offsetWidth * window.devicePixelRatio)
      canvas.height = Math.round(canvas.offsetHeight * window.devicePixelRatio)
      redraw()
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [redraw])

  // ─── Playback ─────────────────────────────────────────────────────────
  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch { /* already stopped */ }
      sourceRef.current = null
    }
    cancelAnimationFrame(animFrameRef.current)
    setIsPlaying(false)
    setPlayheadSec(0)
  }, [])

  const startPlayback = useCallback(() => {
    const ctx = audioCtxRef.current
    const buf = audioBuffer
    if (!ctx || !buf) return
    stopPlayback()
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    const s = startSecRef.current
    const e = endSecRef.current
    src.start(0, s, Math.max(0.1, e - s))
    sourceRef.current = src
    playStartTimeRef.current = ctx.currentTime
    playOffsetRef.current = s
    setIsPlaying(true)
    src.addEventListener('ended', () => {
      cancelAnimationFrame(animFrameRef.current)
      setIsPlaying(false)
      setPlayheadSec(0)
      sourceRef.current = null
    })
    const tick = (): void => {
      const ph = playOffsetRef.current + (ctx.currentTime - playStartTimeRef.current)
      setPlayheadSec(Math.min(ph, endSecRef.current))
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }, [audioBuffer, stopPlayback])

  useEffect(() => () => {
    stopPlayback()
    audioCtxRef.current?.close().catch(() => {})
  }, [stopPlayback])

  // ─── Zoom helpers ─────────────────────────────────────────────────────
  const applyZoom = useCallback((nextZoom: number, pivotAudioFrac: number) => {
    const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    setZoom(clamped)
    const newViewSize = 1 / clamped
    setViewOffset(clamp(pivotAudioFrac - newViewSize / 2, 0, 1 - newViewSize))
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(1)
    setViewOffset(0)
  }, [])

  // ─── Scroll-wheel zoom ────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const canvasFrac = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    const vz = zoomRef.current
    const vs = clamp(viewOffsetRef.current, 0, 1 - 1 / vz)
    const audioFrac = vs + canvasFrac / vz
    applyZoom(vz * (e.deltaY < 0 ? 1.25 : 0.8), audioFrac)
  }, [applyZoom])

  // ─── Drag / pan interaction ───────────────────────────────────────────
  type DragHandle = 'start' | 'end' | 'pan'
  const dragRef = useRef<{
    handle: DragHandle
    rect: DOMRect
    panStartX: number
    panStartOffset: number
  } | null>(null)

  const canvasXToAudioFrac = useCallback((clientX: number, rect: DOMRect): number => {
    const canvasFrac = clamp((clientX - rect.left) / rect.width, 0, 1)
    const vz = zoomRef.current
    const vs = clamp(viewOffsetRef.current, 0, 1 - 1 / vz)
    return vs + canvasFrac / vz
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, handle: DragHandle) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      dragRef.current = { handle, rect, panStartX: e.clientX, panStartOffset: viewOffsetRef.current }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    []
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const { handle, rect } = drag
      if (handle === 'pan') {
        const deltaFrac = -(e.clientX - drag.panStartX) / rect.width / zoomRef.current
        const vz = zoomRef.current
        setViewOffset(clamp(drag.panStartOffset + deltaFrac, 0, 1 - 1 / vz))
        return
      }
      const sec = clamp(canvasXToAudioFrac(e.clientX, rect) * durationRef.current, 0, durationRef.current)
      if (handle === 'start') {
        setStartSec(parseFloat(Math.min(sec, endSecRef.current - 0.05).toFixed(3)))
      } else {
        setEndSec(parseFloat(Math.max(sec, startSecRef.current + 0.05).toFixed(3)))
      }
      // Auto-pan when near edges
      const canvasFrac = clamp((e.clientX - rect.left) / rect.width, 0, 1)
      const edgeZone = 0.05
      const vz = zoomRef.current
      const nudge = 0.002 / vz
      if (canvasFrac < edgeZone) setViewOffset((v) => clamp(v - nudge, 0, 1 - 1 / vz))
      else if (canvasFrac > 1 - edgeZone) setViewOffset((v) => clamp(v + nudge, 0, 1 - 1 / vz))
    },
    [canvasXToAudioFrac]
  )

  const onPointerUp = useCallback(() => { dragRef.current = null }, [])

  // Click on empty waveform → move nearest handle; middle-button → pan
  const onWaveformPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button === 1) { onPointerDown(e, 'pan'); return }
      if (e.button !== 0) return
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const sec = canvasXToAudioFrac(e.clientX, rect) * durationRef.current
      const distStart = Math.abs(sec - startSecRef.current)
      const distEnd = Math.abs(sec - endSecRef.current)
      onPointerDown(e, distStart < distEnd ? 'start' : 'end')
    },
    [canvasXToAudioFrac, onPointerDown]
  )

  // ─── Save ─────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (isSaving || !entry.filePath) return
    setIsSaving(true)
    try {
      const result = await window.electronAPI.trimApply(entry.filePath, startSec, endSec)
      if (saveAsPreset) {
        await window.electronAPI.trimSavePreset(
          entry.artist,
          applyToAllSongs ? null : entry.title,
          startSec,
          Math.max(0, duration - endSec)
        )
      }
      onSaved({ ...entry, durationSec: result.durationSec })
    } catch (err: unknown) {
      console.error('[SongTrimModal] save failed', err)
      setIsSaving(false)
    }
  }, [isSaving, entry, startSec, endSec, saveAsPreset, applyToAllSongs, duration, onSaved])

  const handleDeletePreset = useCallback(async () => {
    await window.electronAPI.trimDeletePreset(entry.artist, entry.title)
    setExistingPreset(null)
  }, [entry.artist, entry.title])

  // ─── Derived ──────────────────────────────────────────────────────────
  const trimDuration = endSec - startSec
  const startFrac = duration > 0 ? startSec / duration : 0
  const endFrac = duration > 0 ? endSec / duration : 1
  const startOffsetSec = startSec
  const endOffsetSec = Math.max(0, duration - endSec)

  // Handle left % position in canvas space, clamped so the knob stays grabbable
  const audioFracToCanvasPct = (f: number): number =>
    clamp(((f - viewStart) / (viewEnd - viewStart)) * 100, -8, 108)
  const startCanvasPct = audioFracToCanvasPct(startFrac)
  const endCanvasPct = audioFracToCanvasPct(endFrac)
  const startInView = startFrac >= viewStart - 0.01 && startFrac <= viewEnd + 0.01
  const endInView = endFrac >= viewStart - 0.01 && endFrac <= viewEnd + 0.01

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="w-170 max-w-[96vw] rounded-xl border border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden song-trim-modal-card">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-zinc-800">
          <Scissors className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm font-semibold text-zinc-200 tracking-wide uppercase">
            Trim Recording
          </span>
          <button
            className="ml-auto text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Song identity ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800/60">
          <div className="w-10 h-10 rounded-md overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
            {entry.albumArtFile ? (
              <img
                src={`autotape-art://image?path=${encodeURIComponent(entry.albumArtFile)}`}
                alt="Album art"
                className="w-full h-full object-cover"
              />
            ) : (
              <Music2 className="w-4 h-4 text-zinc-500" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">{entry.title || 'Unknown'}</p>
            <p className="text-xs text-zinc-500 truncate">{entry.artist}</p>
          </div>
          {existingPreset && (
            <div className="ml-auto flex items-center gap-1.5 text-xs text-amber-400 shrink-0">
              <BookmarkCheck className="w-3.5 h-3.5" />
              <span className="font-mono">
                {formatOffset(existingPreset.startOffsetSec, '+')} / {formatOffset(existingPreset.endOffsetSec, '-')}
              </span>
              <button
                onClick={handleDeletePreset}
                className="text-zinc-500 hover:text-zinc-300 transition-colors ml-1"
                aria-label="Delete preset"
              >
                <BookmarkX className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ── Waveform ── */}
        <div className="px-5 pt-4 pb-1">
          {isLoading && (
            <div className="flex items-center justify-center h-24 gap-2 text-zinc-500 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              Decoding audio…
            </div>
          )}
          {loadError && (
            <div className="flex items-center justify-center h-24 text-zinc-500 text-xs">
              {loadError}
            </div>
          )}
          {!isLoading && !loadError && (
            <>
              {/* Zoom bar */}
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[10px] text-zinc-600 mr-1 select-none">Zoom</span>
                <button
                  className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-30"
                  onClick={() => applyZoom(zoom / 1.5, viewStart + viewSize / 2)}
                  disabled={zoom <= MIN_ZOOM}
                  aria-label="Zoom out"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.1}
                  value={zoom}
                  onChange={(e) => applyZoom(parseFloat(e.target.value), viewStart + viewSize / 2)}
                  className="flex-1 mx-1 h-1 accent-amber-400 cursor-pointer"
                  aria-label="Zoom level"
                />
                <button
                  className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-30"
                  onClick={() => applyZoom(zoom * 1.5, viewStart + viewSize / 2)}
                  disabled={zoom >= MAX_ZOOM}
                  aria-label="Zoom in"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
                {zoom > 1 && (
                  <button
                    className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors ml-0.5"
                    onClick={resetZoom}
                    aria-label="Reset zoom"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                )}
                <span className="text-[10px] font-mono text-zinc-600 w-12 text-right select-none">
                  {zoom.toFixed(1)}x
                </span>
              </div>

              {/* Timeline container */}
              <div
                ref={containerRef}
                className="relative h-24 rounded-md overflow-hidden select-none trim-waveform-container"
                onPointerDown={onWaveformPointerDown}
                onWheel={onWheel}
              >
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full [image-rendering:pixelated] pointer-events-none"
                />

                {/* Start handle */}
                {startInView && (
                  <div
                    className="trim-handle absolute top-0 bottom-0 w-4 flex items-center justify-center cursor-ew-resize z-10 group"
                    data-left={`${startCanvasPct}pct`}
                    style={{ left: `${startCanvasPct}%` }} // eslint-disable-line react/forbid-dom-props
                    onPointerDown={(e) => onPointerDown(e, 'start')}
                  >
                    <div className="w-3 h-full flex flex-col items-center justify-start pt-1">
                      <div className="w-2.5 h-2.5 rounded-sm bg-amber-400 group-hover:bg-amber-300 transition-colors shadow-md flex items-center justify-center">
                        <div className="w-0.5 h-1.5 bg-zinc-950 rounded-full" />
                      </div>
                    </div>
                  </div>
                )}

                {/* End handle */}
                {endInView && (
                  <div
                    className="trim-handle absolute top-0 bottom-0 w-4 flex items-center justify-center cursor-ew-resize z-10 group"
                    data-left={`${endCanvasPct}pct`}
                    style={{ left: `${endCanvasPct}%` }} // eslint-disable-line react/forbid-dom-props
                    onPointerDown={(e) => onPointerDown(e, 'end')}
                  >
                    <div className="w-3 h-full flex flex-col items-center justify-start pt-1">
                      <div className="w-2.5 h-2.5 rounded-sm bg-amber-400 group-hover:bg-amber-300 transition-colors shadow-md flex items-center justify-center">
                        <div className="w-0.5 h-1.5 bg-zinc-950 rounded-full" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {zoom > 1 && (
                <p className="mt-0.5 text-[10px] text-zinc-600 text-center select-none">
                  Scroll to zoom · drag background to pan · middle-click drag
                </p>
              )}

              {/* Time labels + relative offsets */}
              <div className="flex items-end justify-between mt-1.5">
                <div className="flex flex-col items-start">
                  <span className="text-[10px] font-mono text-amber-400">{formatTime(startSec)}</span>
                  {startOffsetSec > 0.001 && (
                    <span className="text-[9px] font-mono text-zinc-600">{formatOffset(startOffsetSec, '+')} from start</span>
                  )}
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-mono text-zinc-500">{formatTime(trimDuration)}</span>
                  {isPlaying && <span className="text-[9px] font-mono text-zinc-600">{formatTime(playheadSec)}</span>}
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-mono text-amber-400">{formatTime(endSec)}</span>
                  {endOffsetSec > 0.001 && (
                    <span className="text-[9px] font-mono text-zinc-600">{formatOffset(endOffsetSec, '-')} from end</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Playback controls ── */}
        {!isLoading && !loadError && (
          <div className="flex items-center gap-2 px-5 pb-3 pt-1">
            {isPlaying ? (
              <button
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={stopPlayback}
              >
                <Square className="w-3.5 h-3.5" />Stop
              </button>
            ) : (
              <button
                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                onClick={startPlayback}
                disabled={!audioBuffer}
              >
                <Play className="w-3.5 h-3.5" />Preview trim
              </button>
            )}
            <span className="text-[10px] font-mono text-zinc-600 ml-auto">total: {formatTime(duration)}</span>
          </div>
        )}

        {/* ── Preset options ── */}
        <div className="px-5 py-3 border-t border-zinc-800/60 flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer group select-none">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-amber-400"
              checked={saveAsPreset}
              onChange={(e) => setSaveAsPreset(e.target.checked)}
            />
            <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">
              Save as preset for future recordings
              {saveAsPreset && (startOffsetSec > 0.001 || endOffsetSec > 0.001) && (
                <span className="ml-1 font-mono text-zinc-600">
                  ({formatOffset(startOffsetSec, '+')} / {formatOffset(endOffsetSec, '-')})
                </span>
              )}
            </span>
          </label>
          {saveAsPreset && (
            <label className="flex items-center gap-2 cursor-pointer group select-none ml-5">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 accent-amber-400"
                checked={applyToAllSongs}
                onChange={(e) => setApplyToAllSongs(e.target.checked)}
              />
              <span className="text-xs text-zinc-500 group-hover:text-zinc-300 transition-colors">
                Apply as global default (all songs without a specific preset)
              </span>
            </label>
          )}
        </div>

        {/* ── Actions ── */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-800">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving || isLoading || !!loadError}>
            {isSaving ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Trimming…</>
            ) : (
              <><Scissors className="w-3.5 h-3.5" />Save trimmed file</>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
