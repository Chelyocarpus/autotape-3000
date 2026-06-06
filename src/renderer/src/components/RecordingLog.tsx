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

function StatusIcon({ status }: { status: RecordingEntry['status'] }) {
  if (status === 'ok') return <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
  if (status === 'error') return <XCircle className="w-4 h-4 text-[#d9826f] shrink-0" />
  return <SkipForward className="w-4 h-4 text-zinc-500 shrink-0" />
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
    return <Music2 className="w-4 h-4 text-zinc-500" />
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

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col py-1 px-2">
        {[...entries].reverse().map((entry) => (
          <div
            key={entry.id}
            className="relative flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-zinc-800/45 transition-colors group animate-[entry-in_0.2s_ease_forwards] overflow-hidden"
          >
            {/* Left accent bar */}
            <div className="absolute left-0 inset-y-1.5 w-0.5 rounded-full bg-transparent group-hover:bg-amber-500/50 transition-colors" />

            <div className="w-9 h-9 rounded-md overflow-hidden bg-zinc-800/80 shrink-0 flex items-center justify-center ring-1 ring-zinc-700/40">
              <RecordingThumb entry={entry} />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-zinc-200 truncate leading-snug">
                {entry.title || 'Unknown'}
              </p>
              <p className="text-[11px] text-zinc-500 truncate leading-snug mt-0.5">{entry.artist}</p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <StatusIcon status={entry.status} />
              {entry.status === 'ok' && entry.durationSec > 0 && (
                <span className="text-[11px] text-zinc-500 font-mono tabular-nums">
                  {formatDuration(entry.durationSec)}
                </span>
              )}
              {entry.status === 'skipped' && (
                <span className="text-[11px] text-zinc-600 tracking-wide">skipped</span>
              )}
              {entry.status === 'error' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[11px] text-[#d9826f] truncate max-w-20 cursor-default">error</span>
                  </TooltipTrigger>
                  <TooltipContent side="top">{entry.error}</TooltipContent>
                </Tooltip>
              )}
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
        ))}
      </div>
    </ScrollArea>
  )
}
