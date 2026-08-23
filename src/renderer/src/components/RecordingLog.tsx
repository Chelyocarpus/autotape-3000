import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  XCircle,
  SkipForward,
  ExternalLink,
  Music2,
  Scissors,
  Loader2,
  Search,
  X,
  Clock
} from 'lucide-react'
import { ScrollArea } from './ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'
import type { GsmtcTrack, RecordingEntry } from '../types'

interface RecordingLogProps {
  entries: RecordingEntry[]
  onTrimEntry: (entry: RecordingEntry) => void
  /** A just-stopped recording currently being encoded/written — shown as a pending row. */
  finalizingTrack?: GsmtcTrack | null
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

// Compact capture-provenance stamp: just a time for today's recordings, otherwise a short
// date — full precision is still available via the element's title tooltip.
function formatRecordedAt(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(
    undefined,
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

function StatusIcon({ status }: { status: RecordingEntry['status'] }) {
  if (status === 'error') return <XCircle className="w-4 h-4 text-[var(--rec-500)] shrink-0" />
  if (status === 'skipped') return <SkipForward className="w-4 h-4 text-zinc-500 shrink-0" />
  return null
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

function FinalizingRow({ track }: { track: GsmtcTrack }) {
  return (
    <div className="relative flex items-center gap-3 rounded-lg px-3 py-2.5 overflow-hidden bg-zinc-800/40 border border-amber-500/25">
      <div className="absolute left-0 inset-y-1.5 w-0.5 rounded-full bg-amber-500/50" />

      <div className="w-10 h-10 rounded-md overflow-hidden bg-zinc-800/80 shrink-0 flex items-center justify-center ring-1 ring-zinc-700/40">
        <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[0.875rem] font-semibold text-zinc-200 truncate leading-snug" title={track.title || 'Unknown'}>
          {track.title || 'Unknown'}
        </p>
        <p className="text-[11px] text-zinc-500 truncate leading-snug mt-0.5" title={track.artist}>{track.artist}</p>
      </div>

      <span className="text-[11px] text-zinc-500 tracking-wide shrink-0">encoding…</span>
    </div>
  )
}

function EmptyState() {
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
        <p className="text-[0.65625rem] font-semibold text-zinc-400 uppercase tracking-widest">No tracks yet</p>
        <p className="text-[11px] text-zinc-600 max-w-40 leading-relaxed">Hit record to start building your collection.</p>
      </div>
    </div>
  )
}

function RecordingRow({
  entry,
  onTrimEntry,
  isNew,
  filterMatchDelayMs
}: {
  entry: RecordingEntry
  onTrimEntry: (entry: RecordingEntry) => void
  isNew: boolean
  /** Set only for a row that just started matching a search as the user typed —
   *  undefined means it was already visible and shouldn't re-animate. Takes a
   *  back seat to `isNew`: a row can't be both a fresh capture and a filter
   *  match in the same render, and the capture glow is the rarer, more
   *  meaningful signal. */
  filterMatchDelayMs?: number
}) {
  return (
    <div
      className={cn(
        'relative flex items-center gap-3 rounded-lg px-3 py-2.5 bg-zinc-800/30 border border-zinc-700/30 hover:bg-zinc-800/55 hover:border-amber-500/30 transition-colors group overflow-hidden',
        isNew && 'motion-safe:animate-[entry-in_550ms_cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-[entry-in-reduced_400ms_ease-out]',
        !isNew && filterMatchDelayMs !== undefined &&
          'motion-safe:animate-[filter-match-in_260ms_cubic-bezier(0.16,1,0.3,1)_backwards] motion-reduce:animate-[filter-match-in-reduced_200ms_ease-out_backwards]'
      )}
      style={
        !isNew && filterMatchDelayMs !== undefined
          ? { animationDelay: `${filterMatchDelayMs}ms` }
          : undefined
      }
    >
      {/* Left accent bar */}
      <div className="absolute left-0 inset-y-1.5 w-0.5 rounded-full bg-transparent group-hover:bg-amber-500/50 transition-colors" />

      <div className="w-10 h-10 rounded-md overflow-hidden bg-zinc-800/80 shrink-0 flex items-center justify-center ring-1 ring-zinc-700/40 group-hover:ring-amber-500/40 transition-all">
        <RecordingThumb entry={entry} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[0.875rem] font-semibold text-zinc-200 truncate leading-snug" title={entry.title || 'Unknown'}>
          {entry.title || 'Unknown'}
        </p>
        <p className="text-[11px] text-zinc-500 truncate leading-snug mt-0.5" title={entry.artist}>{entry.artist}</p>
      </div>

      {/* Two groups, not one flat row: what happened (metadata) vs. what you can
          do about it (actions). 12px between the groups, 8px within each —
          matching the project's group-vs-related-item spacing scale so the
          gap itself signals the split, without adding a divider this small. */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2">
          {entry.startedAt > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-600 whitespace-nowrap cursor-default">
                  <Clock className="w-3 h-3 shrink-0" />
                  {formatRecordedAt(entry.startedAt)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="select-text">
                {new Date(entry.startedAt).toLocaleString()}
              </TooltipContent>
            </Tooltip>
          )}
          <StatusIcon status={entry.status} />
          {entry.status === 'ok' && entry.durationSec > 0 && (
            <span className="text-[11px] text-zinc-500 font-mono tabular-nums">
              {formatDuration(entry.durationSec)}
            </span>
          )}
          {entry.status === 'skipped' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[0.65625rem] font-semibold uppercase tracking-widest text-zinc-500 truncate max-w-20 cursor-default">
                  Skipped
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="select-text">{entry.error || 'Skipped'}</TooltipContent>
            </Tooltip>
          )}
          {entry.status === 'error' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[0.65625rem] font-semibold uppercase tracking-widest text-[var(--rec-500)] truncate max-w-20 cursor-default">
                  Error
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="select-text">{entry.error}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {entry.filePath && (
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="p-1 rounded opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 transition-[opacity,background-color,color] text-zinc-500 hover:text-amber-400 hover:bg-zinc-700/50"
                  onClick={() => onTrimEntry(entry)}
                  aria-label="Trim recording"
                >
                  <Scissors className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Trim recording</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="p-1 rounded opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 transition-[opacity,background-color,color] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50"
                  onClick={() => window.electronAPI.openPath(entry.filePath)}
                  aria-label="Open file location"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Open file location</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  )
}

function NoMatchesState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div className="w-14 h-14 rounded-xl bg-zinc-800/60 flex items-center justify-center ring-1 ring-zinc-700/30">
        <Search className="w-6 h-6 text-zinc-600" />
      </div>
      <div className="flex flex-col items-center gap-1 text-center px-6">
        <p className="text-[0.65625rem] font-semibold text-zinc-400 uppercase tracking-widest">No matches</p>
        <p className="text-[11px] text-zinc-600 max-w-52 leading-relaxed truncate">
          Nothing found for &ldquo;{query}&rdquo;
        </p>
      </div>
      <button
        onClick={onClear}
        className="text-[0.65625rem] font-semibold text-amber-400 hover:text-amber-300 transition-colors uppercase tracking-widest"
      >
        Clear search
      </button>
    </div>
  )
}

export function RecordingLog({ entries, onTrimEntry, finalizingTrack }: RecordingLogProps) {
  const [query, setQuery] = useState('')
  const viewportRef = useRef<HTMLDivElement>(null)

  // The one focal moment this list earns: a track that just landed (always
  // appended, so always the array's last id) gets a brief glow-and-settle
  // instead of appearing exactly like every other row. Tracked by id and
  // cleared after the animation window so it never replays on re-renders
  // (search, virtualizer re-measure, etc.) or on the initial data load.
  const lastEntryIdRef = useRef<string | null>(entries.at(-1)?.id ?? null)
  const [justAddedId, setJustAddedId] = useState<string | null>(null)

  useEffect(() => {
    const lastId = entries.at(-1)?.id ?? null
    const isNewArrival = lastId !== null && lastId !== lastEntryIdRef.current
    lastEntryIdRef.current = lastId
    if (!isNewArrival) return

    setJustAddedId(lastId)
    const t = setTimeout(() => setJustAddedId(null), 600)
    return () => clearTimeout(t)
  }, [entries])

  // "Physical List" reflow: when a search changes which rows are visible,
  // the virtualizer's remaining rows slide to their new position instead of
  // snapping there, and rows that just started matching fade up staggered
  // by their position in the new list. Scoped to genuine query changes only
  // (REPOSITION_WINDOW_MS below) — a new recording arriving with no active
  // search shouldn't trigger this, that's `justAddedId`'s job.
  const REPOSITION_WINDOW_MS = 320
  const MAX_STAGGER_MS = 150
  const STAGGER_STEP_MS = 15
  const prevQueryRef = useRef(query)
  const prevVisibleIdsRef = useRef<Set<string>>(new Set())
  const [isRepositioning, setIsRepositioning] = useState(false)
  const [justMatchedIds, setJustMatchedIds] = useState<ReadonlySet<string>>(new Set())
  const repositionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefersReducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    []
  )

  const visibleEntries = useMemo(() => {
    const reversed = [...entries].reverse()
    const q = query.trim().toLowerCase()
    if (!q) return reversed
    return reversed.filter(
      (entry) => entry.title.toLowerCase().includes(q) || entry.artist.toLowerCase().includes(q)
    )
  }, [entries, query])

  // Robustness / pitfalls guarded against:
  // - Only animates on an actual query change (`queryChanged`), not on every
  //   `visibleEntries` recompute — a new recording arriving mid-search would
  //   otherwise retrigger the reflow for rows that never moved.
  // - `justMatched` is capped implicitly by the virtualizer's own mounted
  //   range (overscan 8 + viewport rows), but the stagger delay itself is
  //   still explicitly clamped (MAX_STAGGER_MS) so a very tall window can't
  //   push a row's fade-in delay out past where it'd read as broken.
  // - The reposition timer is cleared on every rerun and on unmount so a
  //   fast burst of keystrokes can't leave a stale timeout that flips
  //   `isRepositioning` off after a *later* keystroke's window is still live.
  useEffect(() => {
    const queryChanged = query !== prevQueryRef.current
    prevQueryRef.current = query
    const newIds = new Set(visibleEntries.map((e) => e.id))

    if (queryChanged && !prefersReducedMotion) {
      const oldIds = prevVisibleIdsRef.current
      const justMatched = new Set<string>()
      for (const id of newIds) if (!oldIds.has(id)) justMatched.add(id)
      setJustMatchedIds(justMatched)
      setIsRepositioning(true)

      if (repositionTimerRef.current) clearTimeout(repositionTimerRef.current)
      repositionTimerRef.current = setTimeout(() => {
        setIsRepositioning(false)
        setJustMatchedIds(new Set())
        repositionTimerRef.current = null
      }, REPOSITION_WINDOW_MS)

      // Ease the viewport back into bounds instead of letting it hard-clamp:
      // a search that shrinks the list can otherwise leave the scroll
      // position past the new (shorter) content, showing blank space.
      const viewport = viewportRef.current
      if (viewport) {
        const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        if (viewport.scrollTop > maxScrollTop) {
          viewport.scrollTo({ top: maxScrollTop, behavior: 'smooth' })
        }
      }
    }

    prevVisibleIdsRef.current = newIds
  }, [query, visibleEntries, prefersReducedMotion])

  useEffect(() => () => {
    if (repositionTimerRef.current) clearTimeout(repositionTimerRef.current)
  }, [])

  // Safety valve: a real user scroll gesture always wins over the reflow
  // transition, so it never fights live scrolling with an animated lag.
  // Deliberately listens for wheel/touchmove (user intent) rather than the
  // viewport's own `scroll` event — the smooth scrollTo above (and the
  // browser's own scrollTop clamp when content shrinks) also fires `scroll`,
  // which would otherwise cancel the reflow it's part of.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const cancelReposition = () => {
      if (repositionTimerRef.current) {
        clearTimeout(repositionTimerRef.current)
        repositionTimerRef.current = null
      }
      setIsRepositioning(false)
      // Cancelling the timer also cancels the `setJustMatchedIds(new Set())`
      // it would have run — clear it here too, or a matched row that scrolls
      // out of the virtualizer's mounted range and back in later would still
      // have filterMatchDelayMs set and replay the fade on remount.
      setJustMatchedIds(new Set())
    }
    viewport.addEventListener('wheel', cancelReposition, { passive: true })
    viewport.addEventListener('touchmove', cancelReposition, { passive: true })
    return () => {
      viewport.removeEventListener('wheel', cancelReposition)
      viewport.removeEventListener('touchmove', cancelReposition)
    }
  }, [])

  // Rows are only mounted for the visible range (plus overscan) rather than
  // all at once — a full archive can reach thousands of entries, and
  // rendering every row unvirtualized measured ~4s to mount and ~500ms per
  // search keystroke at 2000 rows.
  const rowVirtualizer = useVirtualizer({
    count: visibleEntries.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 66,
    overscan: 8,
    getItemKey: (index) => visibleEntries[index].id
  })

  if (entries.length === 0 && !finalizingTrack) {
    return <EmptyState />
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-5 pb-2 shrink-0">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recordings…"
            aria-label="Search recordings"
            className="pl-8 pr-8 text-xs"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <span className="text-[11px] text-zinc-500 tabular-nums shrink-0 whitespace-nowrap">
          {query ? (
            <>
              {visibleEntries.length}
              <span className="text-zinc-600"> / {entries.length}</span>
            </>
          ) : (
            <>
              {entries.length}{' '}
              <span className="uppercase tracking-widest text-[0.65625rem] font-semibold text-zinc-600">
                {entries.length === 1 ? 'recording' : 'recordings'}
              </span>
            </>
          )}
        </span>
      </div>

      <ScrollArea className="flex-1 min-h-0" viewportRef={viewportRef}>
        <div className="flex flex-col gap-1 px-2 pt-1 pb-3">
          {finalizingTrack && <FinalizingRow track={finalizingTrack} />}
          {visibleEntries.length === 0 ? (
            // With no completed entries yet but a search wasn't the reason —
            // e.g. the very first recording is still finalizing — "no
            // matches" is misleading. Only show it when a search is why the
            // list is empty.
            query && <NoMatchesState query={query} onClear={() => setQuery('')} />
          ) : (
            <div style={{ position: 'relative', height: rowVirtualizer.getTotalSize(), width: '100%' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const entry = visibleEntries[virtualRow.index]
                const isFilterMatch = justMatchedIds.has(entry.id)
                return (
                  <div
                    key={entry.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                      transition: isRepositioning ? 'transform 300ms cubic-bezier(0.16,1,0.3,1)' : undefined,
                      paddingBottom: 4
                    }}
                  >
                    <RecordingRow
                      entry={entry}
                      onTrimEntry={onTrimEntry}
                      isNew={entry.id === justAddedId}
                      filterMatchDelayMs={
                        isFilterMatch
                          ? Math.min(virtualRow.index * STAGGER_STEP_MS, MAX_STAGGER_MS)
                          : undefined
                      }
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
