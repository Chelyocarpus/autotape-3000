import { useEffect, useState } from 'react'
import { Square, Play, Clock } from 'lucide-react'
import { cn } from '../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import type { GsmtcTrack } from '../types'

const IDLE_TAGLINES = [
  'Drop the needle.',
  'Ready to roll tape.',
  'Cue the music.',
] as const

const RECORDING_STATUSES = [
  'Rolling tape',
  'Capturing the groove',
  'Laying down tracks',
  'In the booth',
] as const

interface RecordButtonProps {
  isRecording: boolean
  stopPending?: boolean
  currentTrack: GsmtcTrack | null
  elapsed: number
  trackCount: number
  onStart: () => void
  onStop: () => void
  tron?: boolean
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function VinylDisc({ isRecording, tron }: { isRecording: boolean; tron: boolean }) {
  return (
    <svg
      className={cn(
        'absolute inset-0 w-full h-full pointer-events-none',
        isRecording
          ? 'animate-[vinyl-spin_1.8s_linear_infinite]'
          : 'animate-[vinyl-spin_8s_linear_infinite]'
      )}
      viewBox="0 0 112 112"
      fill="none"
      aria-hidden="true"
    >
      {tron ? (
        <>
          {/* Tron disc — dark grid with cyan circuit grooves */}
          <circle cx="56" cy="56" r="55" fill="#000a14" />

          {/* Circuit groove rings — cyan neon lines */}
          <circle cx="56" cy="56" r="50" stroke="#003d55" strokeWidth="1" />
          <circle cx="56" cy="56" r="46" stroke="#005a7a" strokeWidth="0.6" />
          <circle cx="56" cy="56" r="42" stroke="#003d55" strokeWidth="1" />
          <circle cx="56" cy="56" r="38" stroke="#005a7a" strokeWidth="0.6" />
          <circle cx="56" cy="56" r="34" stroke="#003d55" strokeWidth="1" />
          <circle cx="56" cy="56" r="30" stroke="#00afd1" strokeWidth="0.8" />
          <circle cx="56" cy="56" r="26" stroke="#003d55" strokeWidth="0.7" />
          <circle cx="56" cy="56" r="22" stroke="#005a7a" strokeWidth="0.5" />

          {/* Circuit trace lines radiating from center */}
          <line x1="56" y1="39" x2="56" y2="8"  stroke="#006080" strokeWidth="0.6" />
          <line x1="56" y1="73" x2="56" y2="104" stroke="#006080" strokeWidth="0.6" />
          <line x1="39" y1="56" x2="8"  y2="56"  stroke="#006080" strokeWidth="0.6" />
          <line x1="73" y1="56" x2="104" y2="56"  stroke="#006080" strokeWidth="0.6" />
          <line x1="44" y1="44" x2="20" y2="20" stroke="#003d55" strokeWidth="0.5" />
          <line x1="68" y1="68" x2="92" y2="92" stroke="#003d55" strokeWidth="0.5" />
          <line x1="68" y1="44" x2="92" y2="20" stroke="#003d55" strokeWidth="0.5" />
          <line x1="44" y1="68" x2="20" y2="92" stroke="#003d55" strokeWidth="0.5" />

          {/* Neon specular arc */}
          <path
            d="M 18 48 A 40 40 0 0 1 52 18"
            stroke="rgba(0,200,255,0.18)"
            strokeWidth="3"
            strokeLinecap="round"
          />

          {/* Center label — neon cyan */}
          <circle cx="56" cy="56" r="17" fill={isRecording ? '#004d6b' : '#002d40'} />
          <circle cx="56" cy="56" r="17" fill="none" stroke={isRecording ? '#00d4ef' : '#009ab5'} strokeWidth="1.2" />
          <circle cx="56" cy="56" r="13" fill="none" stroke="rgba(0,212,239,0.25)" strokeWidth="0.7" />
          {/* Spindle hole */}
          <circle cx="56" cy="56" r="2.5" fill="#000a14" />
          <circle cx="56" cy="56" r="2.5" fill="none" stroke="#00d4ef" strokeWidth="0.8" />
        </>
      ) : (
        <>
          {/* Outer disc — warm near-black vinyl */}
          <circle cx="56" cy="56" r="55" fill="#0e0d08" />

          {/* Groove rings — alternating warm-dark tones */}
          <circle cx="56" cy="56" r="50" stroke="#1e1c11" strokeWidth="0.7" />
          <circle cx="56" cy="56" r="46" stroke="#252310" strokeWidth="0.7" />
          <circle cx="56" cy="56" r="42" stroke="#1e1c11" strokeWidth="0.7" />
          <circle cx="56" cy="56" r="38" stroke="#252310" strokeWidth="0.7" />
          <circle cx="56" cy="56" r="34" stroke="#1e1c11" strokeWidth="0.7" />
          <circle cx="56" cy="56" r="30" stroke="#252310" strokeWidth="0.7" />
          <circle cx="56" cy="56" r="26" stroke="#1e1c11" strokeWidth="0.6" />
          <circle cx="56" cy="56" r="22" stroke="#252310" strokeWidth="0.5" />

          {/* Subtle specular highlight arc for depth */}
          <path
            d="M 20 50 A 38 38 0 0 1 54 19"
            stroke="rgba(255,255,255,0.045)"
            strokeWidth="3"
            strokeLinecap="round"
          />

          {/* Center label */}
          <circle cx="56" cy="56" r="17" fill={isRecording ? 'var(--rec-500)' : 'var(--color-amber-500)'} />
          {/* Label inner decorative ring */}
          <circle cx="56" cy="56" r="13" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.7" />
          {/* Spindle hole */}
          <circle cx="56" cy="56" r="2.5" fill="#09080503" />
          <circle cx="56" cy="56" r="2.5" fill="#0d0c06" />
        </>
      )}
    </svg>
  )
}

export function RecordButton({
  isRecording,
  stopPending = false,
  currentTrack,
  elapsed,
  trackCount,
  onStart,
  onStop,
  tron = false,
}: RecordButtonProps) {
  const [taglineIndex, setTaglineIndex] = useState(0)
  const [statusIndex, setStatusIndex] = useState(0)

  useEffect(() => {
    if (isRecording) return
    const id = setInterval(() => setTaglineIndex((i) => (i + 1) % IDLE_TAGLINES.length), 3500)
    return () => clearInterval(id)
  }, [isRecording])

  useEffect(() => {
    if (!isRecording) return
    const id = setInterval(() => setStatusIndex((i) => (i + 1) % RECORDING_STATUSES.length), 4000)
    return () => clearInterval(id)
  }, [isRecording])

  return (
    <div className="flex flex-col items-center gap-5 pt-1">
      {/* Vinyl record button */}
      <div className="flex items-center justify-center">
        <button
          className={cn(
            'group relative w-28 h-28 rounded-full cursor-pointer',
            'transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900',
            isRecording
              ? 'focus-visible:ring-[var(--rec-500)] animate-[record-ring_1.8s_ease_infinite]'
              : 'focus-visible:ring-[var(--color-amber-500)] hover:scale-[1.08] hover:shadow-[0_0_40px_color-mix(in_srgb,var(--color-amber-500)_50%,transparent)] active:scale-[1.02]'
          )}
          onClick={isRecording ? onStop : onStart}
          aria-label={
            isRecording
              ? stopPending
                ? 'Stop recording now (already stopping after this track)'
                : 'Stop recording'
              : 'Start recording'
          }
        >
          <VinylDisc isRecording={isRecording} tron={tron} />
          {/* Icon floats over center label — stop when recording, play when idle */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {isRecording
              ? <Square className="w-5 h-5 fill-white text-white drop-shadow" />
              : <Play className="w-5 h-5 fill-white text-white drop-shadow translate-x-0.5 opacity-80 group-hover:opacity-100 transition-opacity duration-200" />
            }
          </div>
          {/* Pending-stop badge — deferred until the current track ends; click again to force it */}
          {stopPending && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 ring-2 ring-zinc-900 shadow-md animate-pulse">
                  <Clock className="w-4 h-4 text-zinc-950" strokeWidth={2.5} />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Stopping after this track — click again to stop now</TooltipContent>
            </Tooltip>
          )}
        </button>
      </div>

      {/* Elapsed / status */}
      <div className="text-center">
        {isRecording ? (
          <>
            <p className="text-2xl font-mono font-light text-zinc-100 tabular-nums tracking-wider">
              {formatElapsed(elapsed)}
            </p>
            {stopPending ? (
              <p className="text-[11px] text-amber-400/90 mt-1 flex items-center gap-1.5 justify-center uppercase tracking-widest">
                <Clock className="w-3 h-3" />
                Stopping soon
              </p>
            ) : currentTrack ? (
              <p className="text-[11px] text-[var(--rec-500)]/90 mt-1 flex items-center gap-1.5 justify-center uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--rec-500)] animate-pulse inline-block" />
                {RECORDING_STATUSES[statusIndex]}
              </p>
            ) : (
              <p className="text-[11px] text-amber-400/80 mt-1 flex items-center gap-1.5 justify-center uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                Waiting for music
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
              Click to record
            </p>
            <p className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-widest">
              {IDLE_TAGLINES[taglineIndex]}
            </p>
          </>
        )}
      </div>

      {/* Track count */}
      {trackCount > 0 && (
        <p className="text-xs text-zinc-500 -mt-2">
          {trackCount} track{trackCount !== 1 ? 's' : ''} saved
        </p>
      )}

      {/* Currently recording track */}
      {isRecording && currentTrack && (
        <div className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/40 px-3 py-2 text-xs">
          <p className="text-zinc-500 mb-0.5 uppercase tracking-wider text-[10px]">Capturing</p>
          <p className="text-zinc-200 font-medium truncate">
            {currentTrack.artist} — {currentTrack.title}
          </p>
        </div>
      )}
    </div>
  )
}
