import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, XCircle, SkipForward, ExternalLink, Music2, Scissors } from 'lucide-react'
import { ScrollArea } from './ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import type { RecordingEntry } from '../types'

interface RecordingLogProps {
  entries: RecordingEntry[]
  onTrimEntry: (entry: RecordingEntry) => void
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function StatusBadge({ entry }: { entry: RecordingEntry }) {
  if (entry.status === 'ok') {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-zinc-800/70 ring-1 ring-zinc-700/50 pl-1.5 pr-2 py-0.5 shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        {entry.durationSec > 0 && (
          <span className="text-[11px] text-zinc-400 font-mono tabular-nums whitespace-nowrap">
            {formatDuration(entry.durationSec)}
          </span>
        )}
      </span>
    )
  }

  if (entry.status === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 rounded-full bg-(--rec-500)/10 ring-1 ring-(--rec-500)/30 pl-1.5 pr-2 py-0.5 cursor-default shrink-0">
            <XCircle className="w-3.5 h-3.5 text-(--rec-500) shrink-0" />
            <span className="text-[11px] text-(--rec-500) whitespace-nowrap">error</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="select-text">{entry.error}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1.5 rounded-full bg-zinc-800/50 ring-1 ring-zinc-700/40 pl-1.5 pr-2 py-0.5 cursor-default shrink-0">
          <SkipForward className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="text-[11px] text-zinc-500 whitespace-nowrap">skipped</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="select-text">{entry.error || 'Skipped'}</TooltipContent>
    </Tooltip>
  )
}

function RecordingThumb({ entry }: { entry: RecordingEntry }) {
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    setImageError(false)
  }, [entry.albumArtFile])

  const src = useMemo(() => {
    if (!entry.albumArtFile) return ''
    return `autotape-art://image?path=${encodeURIComponent(entry.albumArtFile)}`
  }, [entry.albumArtFile])

  if (!src || imageError) {
    return <Music2 className="w-4 h-4 text-amber-400/70" />
  }

  return (
    <img
      src={src}
      alt="Album art"
      className="w-full h-full object-cover"
      loading="lazy"
      onError={() => setImageError(true)}
    />
  )
}

export function RecordingLog({ entries, onTrimEntry }: RecordingLogProps) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 pb-6">
        <div className="w-14 h-14 rounded-xl bg-zinc-800/60 flex items-center justify-center ring-1 ring-zinc-700/30">
          <svg
            viewBox="0 0 256 256"
            className="w-7 h-7 text-zinc-600"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M224,44H32A20,20,0,0,0,12,64V192a20,20,0,0,0,20,20H224a20,20,0,0,0,20-20V64A20,20,0,0,0,224,44Zm-4,144H183l-12.6-16.8A8,8,0,0,0,164,168H92a8,8,0,0,0-6.4,3.2L73,188H36V68H220ZM82,152h92a34,34,0,0,0,0-68H82a34,34,0,0,0,0,68Zm0-44a10,10,0,1,1-10,10A10,10,0,0,1,82,108Zm102,10a10,10,0,1,1-10-10A10,10,0,0,1,184,118Zm-42.5,10h-27a34.08,34.08,0,0,0,0-20h27a34.08,34.08,0,0,0,0,20Z"/>
          </svg>
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">No tracks yet</p>
          <p className="text-[11px] text-zinc-600 max-w-40 leading-relaxed">Hit record to start building your collection.</p>
        </div>
      </div>
    )
  }

  const reversed = [...entries].reverse()

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-1.5 py-1 px-2">
        {reversed.map((entry, i) => (
          <div
            key={entry.id}
            className="relative flex items-center gap-3 rounded-lg px-3 py-2.5 bg-zinc-800/25 ring-1 ring-zinc-800/70 hover:ring-amber-500/40 hover:bg-zinc-800/45 transition-all group animate-[entry-in_0.2s_ease_forwards] overflow-hidden"
          >
            {/* Left accent bar */}
            <div className="absolute left-0 inset-y-1.5 w-0.5 rounded-full bg-transparent group-hover:bg-amber-500/60 transition-colors" />

            <span className="w-4 shrink-0 text-[10px] font-mono text-zinc-600 text-right tabular-nums">
              {reversed.length - i}
            </span>

            <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 flex items-center justify-center ring-1 ring-zinc-700/50 bg-linear-to-br from-amber-500/15 to-zinc-800 shadow-sm">
              <RecordingThumb entry={entry} />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-zinc-100 truncate leading-snug">
                {entry.title || 'Unknown'}
              </p>
              <p className="text-[11px] text-zinc-500 truncate leading-snug mt-0.5">{entry.artist}</p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="w-20 flex justify-end">
                <StatusBadge entry={entry} />
              </div>
              <div className="w-9.5 flex items-center justify-end gap-2">
                {entry.filePath && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-amber-400"
                        onClick={() => onTrimEntry(entry)}
                        aria-label="Trim recording"
                      >
                        <Scissors className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Trim recording</TooltipContent>
                  </Tooltip>
                )}
                {entry.filePath && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-zinc-300"
                        onClick={() => window.electronAPI.openPath(entry.filePath)}
                        aria-label="Open file location"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Open file location</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
