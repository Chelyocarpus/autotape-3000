import { useState, useCallback, useEffect, useRef } from 'react'
import { Sun, Moon, Library, SlidersHorizontal, AlertTriangle } from 'lucide-react'
import { NowPlaying } from './components/NowPlaying'
import { RecordButton } from './components/RecordButton'
import { RecordingLog } from './components/RecordingLog'
import { SettingsPanel } from './components/SettingsPanel'
import { OnboardingWizard, ONBOARDING_KEY } from './components/OnboardingWizard'
import { SongTrimModal } from './components/SongTrimModal'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs'
import { Card, CardContent } from './components/ui/card'
import { Separator } from './components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
import { useGsmtcTrack, useRecording } from './hooks/useIpc'
import type { RecordingEntry } from './types'

const TRON_CODE = ['t', 'r', 'o', 'n']

export function App() {
  const track = useGsmtcTrack()
  const [entries, setEntries] = useState<RecordingEntry[]>([])

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('autotape-theme') as 'dark' | 'light' | null
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    const initial = saved ?? (prefersDark ? 'dark' : 'light')
    document.documentElement.setAttribute('data-theme', initial)
    return initial
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('autotape-theme', theme)
    // Keep the native title bar buttons in sync with the app theme
    window.electronAPI.setTitleBarOverlay(
      theme === 'dark'
        ? { color: '#1a100d', symbolColor: '#b89080' }
        : { color: '#fdf3ea', symbolColor: '#6b4e3e' }
    )
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  const tronRef = useRef<string[]>([])
  const [tronMode, setTronMode] = useState(false)
  const [tronOverlay, setTronOverlay] = useState(false)

  // Persist tronMode on documentElement
  useEffect(() => {
    document.documentElement.setAttribute('data-tron', tronMode ? 'true' : 'false')
  }, [tronMode])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Tron code — type "tron"
      const nextTron = [...tronRef.current, e.key.toLowerCase()].slice(-4)
      tronRef.current = nextTron
      if (nextTron.join('') === TRON_CODE.join('')) {
        tronRef.current = []
        setTronMode((prev) => {
          const next = !prev
          setTronOverlay(true)
          setTimeout(() => setTronOverlay(false), 3000)
          return next
        })
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const titleClickRef = useRef(0)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [titleSecret, setTitleSecret] = useState(false)
  const handleTitleClick = useCallback(() => {
    titleClickRef.current += 1
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    titleTimerRef.current = setTimeout(() => { titleClickRef.current = 0 }, 1500)
    if (titleClickRef.current >= 5) {
      titleClickRef.current = 0
      setTitleSecret(true)
      setTimeout(() => setTitleSecret(false), 3000)
    }
  }, [])

  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem(ONBOARDING_KEY)
  )

  const MAX_LOG_ENTRIES = 500
  const onEntry = useCallback((e: RecordingEntry) => {
    setEntries((prev) => {
      const next = [...prev, e]
      return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next
    })
  }, [])

  const updateEntry = useCallback((updated: RecordingEntry) => {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
  }, [])

  const [trimEntry, setTrimEntry] = useState<RecordingEntry | null>(null)

  const { isRecording, currentTrack, elapsed, silenceWarning, start, stop } = useRecording(onEntry)

  // Allow the user to manually dismiss the silence dialog; it re-shows if silence returns
  const [silenceDismissed, setSilenceDismissed] = useState(false)
  const silenceDismissRef = useRef<HTMLButtonElement>(null)
  const showSilenceDialog = isRecording && silenceWarning && !silenceDismissed

  // Auto-focus the dismiss button when the dialog opens so keyboard users can
  // press Enter to dismiss immediately.
  useEffect(() => {
    if (showSilenceDialog && silenceDismissRef.current) {
      silenceDismissRef.current.focus()
    }
  }, [showSilenceDialog])
  // Re-arm when silence warning changes (new warning after dismissal should show again)
  const prevSilenceWarning = useRef(false)
  useEffect(() => {
    if (silenceWarning && !prevSilenceWarning.current) setSilenceDismissed(false)
    prevSilenceWarning.current = silenceWarning
  }, [silenceWarning])

  return (
    <TooltipProvider delayDuration={600}>
    <div
      className="app-shell flex flex-col h-screen overflow-hidden"
    >
      {/* Title bar drag region — width is inset to leave room for the native
          min/max/close buttons Windows draws via titleBarOverlay */}
      <div className="h-8 shrink-0 flex items-center justify-between px-4 app-drag-region app-titlebar">
        <div className="flex items-center gap-2 select-none">
          <svg viewBox="0 0 256 256" className="w-4 h-4 shrink-0 text-zinc-500" fill="currentColor" aria-hidden="true">
              <path d="M224,44H32A20,20,0,0,0,12,64V192a20,20,0,0,0,20,20H224a20,20,0,0,0,20-20V64A20,20,0,0,0,224,44Zm-4,144H183l-12.6-16.8A8,8,0,0,0,164,168H92a8,8,0,0,0-6.4,3.2L73,188H36V68H220ZM82,152h92a34,34,0,0,0,0-68H82a34,34,0,0,0,0,68Zm0-44a10,10,0,1,1-10,10A10,10,0,0,1,82,108Zm102,10a10,10,0,1,1-10-10A10,10,0,0,1,184,118Zm-42.5,10h-27a34.08,34.08,0,0,0,0-20h27a34.08,34.08,0,0,0,0,20Z"/>
            </svg>
          <button
            className="app-no-drag text-xs font-semibold text-zinc-500 tracking-widest uppercase hover:text-zinc-400 transition-colors"
            onClick={handleTitleClick}
          >
            Autotape 3000
          </button>
          {titleSecret && (
            <span className="text-[9px] text-zinc-600 tracking-widest uppercase animate-[on-air-in_0.2s_ease_forwards]">
              Tuned in.
            </span>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="app-no-drag w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800/50 transition-colors"
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Main content — sidebar + full-height list */}
      <div className="flex-1 flex gap-3 px-4 pb-4 min-h-0">

        {/* Left sidebar: Now Playing + Record Button — the focal point */}
        <Card className="w-52 shrink-0 flex flex-col overflow-hidden">
          <CardContent className="flex-1 flex flex-col items-center pt-5 pb-5 px-4 gap-4 min-h-0 overflow-hidden">
            <div className="shrink-0 w-full flex flex-col items-center">
              <NowPlaying layout="vertical" track={track} />
            </div>
            <Separator className="w-full shrink-0" />
            <div className="shrink min-h-32 overflow-hidden flex flex-col items-center w-full">
              <RecordButton
                isRecording={isRecording}
                currentTrack={currentTrack}
                elapsed={elapsed}
                trackCount={entries.filter((e) => e.status === 'ok').length}
                onStart={start}
                onStop={stop}
                tron={tronMode}
              />
            </div>
          </CardContent>
        </Card>

        {/* Right panel: full-height Recordings + Settings */}
        <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <CardContent className="p-0 pt-0 flex-1 flex flex-col min-h-0 overflow-hidden">
            <Tabs defaultValue="recordings" className="flex flex-col flex-1 min-h-0">
              <TabsList className="w-full shrink-0 px-4">
                <TabsTrigger value="recordings">
                  <Library className="w-3 h-3" />
                  Recordings
                </TabsTrigger>
                <TabsTrigger value="settings">
                  <SlidersHorizontal className="w-3 h-3" />
                  Settings
                </TabsTrigger>
              </TabsList>

              <TabsContent value="recordings" className="flex-1 min-h-0 pt-1.5">
                <RecordingLog entries={entries} onTrimEntry={setTrimEntry} />
              </TabsContent>

              <TabsContent value="settings" className="flex-1 overflow-y-auto pt-1.5 px-4 pb-4">
                <SettingsPanel onOpenWizard={() => setShowOnboarding(true)} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      {showOnboarding && (
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      )}

      {trimEntry && (
        <SongTrimModal
          entry={trimEntry}
          onClose={() => setTrimEntry(null)}
          onSaved={(updated) => {
            updateEntry(updated)
            setTrimEntry(null)
          }}
        />
      )}

      {showSilenceDialog && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="silence-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSilenceDismissed(true)
          }}
        >
          {/* Backdrop — click to dismiss */}
          <div
            className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
            onClick={() => setSilenceDismissed(true)}
          />

          {/* Dialog card */}
          <div className="relative z-10 w-80 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-6 flex flex-col gap-4 animate-[on-air-in_0.18s_ease_forwards]">
            {/* Icon + title */}
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/30">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              </span>
              <div>
                <p id="silence-dialog-title" className="text-sm font-semibold text-zinc-100">No audio detected</p>
                <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                  Autotape is recording but picking up silence. Check that your audio device in Settings matches where your music is playing.
                </p>
              </div>
            </div>

            {/* Dismiss */}
            <button
              ref={silenceDismissRef}
              className="self-end text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 rounded"
              onClick={() => setSilenceDismissed(true)}
              aria-label="Dismiss warning"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {tronOverlay && (
        <div className="tron-overlay fixed inset-0 z-50 flex flex-col items-center justify-center select-none">
          <div className={`tron-banner-box${tronMode ? '' : ' inactive'}`}>
            <span className="tron-banner-title">
              {tronMode ? 'TRON' : 'END OF LINE'}
            </span>
          </div>
          <p className="tron-banner-sub">
            {tronMode ? 'Greetings, program.' : 'Returning to the grid.'}
          </p>
        </div>
      )}
    </div>
    </TooltipProvider>
  )
}
