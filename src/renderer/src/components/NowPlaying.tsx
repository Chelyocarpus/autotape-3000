import { Music2, Play, Pause } from 'lucide-react'
import { cn } from '../lib/utils'
import type { GsmtcTrack } from '../types'
import { useState, useEffect } from 'react'

interface NowPlayingProps {
  track: GsmtcTrack
  layout?: 'horizontal' | 'vertical'
}

export function NowPlaying({ track, layout = 'horizontal' }: NowPlayingProps) {
  const [imageError, setImageError] = useState(false)
  const hasTrack = Boolean(track.title)

  useEffect(() => {
    setImageError(false)
  }, [track.albumArtFile])

  const albumArtUrl = track.albumArtFile
    ? `autotape-art://image?path=${encodeURIComponent(track.albumArtFile)}`
    : ''

  const artGlow = track.isPlaying && track.albumArtFile && !imageError

  if (layout === 'vertical') {
    return (
      <div className="flex flex-col items-center gap-3 w-full">
        {/* Album Art — large, centered */}
        <div
          className={cn(
            'relative shrink-0 w-36 h-36 rounded-xl overflow-hidden bg-zinc-800 flex items-center justify-center',
            'transition-shadow duration-700',
            artGlow ? 'shadow-[0_0_40px_#b77466]/50' : 'shadow-md'
          )}
        >
          {track.albumArtFile && !imageError ? (
            <img
              key={track.albumArtFile}
              src={albumArtUrl}
              alt="Album art"
              className="w-full h-full object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <Music2 className="w-12 h-12 text-zinc-500" />
          )}

          {track.isPlaying && (
            <div className="absolute bottom-2 right-2 bg-black/40 backdrop-blur-sm rounded px-1 py-0.5">
              <span className="flex gap-0.75 items-end h-3">
                <span className="soundwave-bar soundwave-bar-1 bg-amber-400" />
                <span className="soundwave-bar soundwave-bar-2 bg-amber-400" />
                <span className="soundwave-bar soundwave-bar-3 bg-amber-400" />
              </span>
            </div>
          )}
        </div>

        {/* Status pill */}
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded-full border',
            track.isPlaying
              ? 'playing-pill'
              : 'bg-zinc-800/80 text-zinc-500 border-zinc-700/50'
          )}
        >
          {track.isPlaying
            ? <><Play className="w-2.5 h-2.5 fill-current" />Playing</>
            : <><Pause className="w-2.5 h-2.5 fill-current" />Paused</>}
        </span>

        {/* Track Info — centered */}
        <div className="w-full text-center flex flex-col gap-0.5 min-w-0 px-1">
          {hasTrack ? (
            <>
              <p className="text-sm font-semibold text-zinc-100 truncate leading-tight">
                {track.title}
              </p>
              <p className="text-xs text-zinc-400 truncate">{track.artist}</p>
              {track.album && (
                <p className="text-[11px] text-zinc-500 truncate">{track.album}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-zinc-500 italic">Nothing playing</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-4 items-center min-h-22">
      {/* Album Art */}
      <div
        className={cn(
          'relative shrink-0 w-24 h-24 rounded-xl overflow-hidden bg-zinc-800 flex items-center justify-center',
          'transition-shadow duration-700',
          artGlow ? 'shadow-[0_0_28px_#b77466]/40' : 'shadow-md'
        )}
      >
        {track.albumArtFile && !imageError ? (
          <img
            key={track.albumArtFile}
            src={albumArtUrl}
            alt="Album art"
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <Music2 className="w-9 h-9 text-zinc-500" />
        )}

        {track.isPlaying && (
          <div className="absolute bottom-1.5 right-1.5 bg-black/40 backdrop-blur-sm rounded px-1 py-0.5">
            <span className="flex gap-0.75 items-end h-3">
              <span className="soundwave-bar soundwave-bar-1 bg-amber-400" />
              <span className="soundwave-bar soundwave-bar-2 bg-amber-400" />
              <span className="soundwave-bar soundwave-bar-3 bg-amber-400" />
            </span>
          </div>
        )}
      </div>

      {/* Track Info */}
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <div className="mb-0.5">
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded-full border',
              track.isPlaying
                ? 'playing-pill'
                : 'bg-zinc-800/80 text-zinc-500 border-zinc-700/50'
            )}
          >
            {track.isPlaying
              ? <><Play className="w-2.5 h-2.5 fill-current" />Playing</>
              : <><Pause className="w-2.5 h-2.5 fill-current" />Paused</>}
          </span>
        </div>

        {hasTrack ? (
          <>
            <p className="text-base font-semibold text-zinc-100 truncate leading-tight">
              {track.title}
            </p>
            <p className="text-sm text-zinc-400 truncate">{track.artist}</p>
            {track.album && (
              <p className="text-xs text-zinc-500 truncate">{track.album}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-500 italic">Nothing playing</p>
        )}
      </div>
    </div>
  )
}
