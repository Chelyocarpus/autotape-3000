import { useState, useEffect, useCallback } from 'react'
import {
  Loader2,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  Mic2,
  Disc,
  ExternalLink,
} from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { cn } from '../lib/utils'
import { useSettings, useAudioDevices } from '../hooks/useIpc'
import type { AudioDevice, UserSettings } from '../types'

export const ONBOARDING_KEY = 'autotape-onboarding-done'

const STEP_LABELS = ['Welcome', 'Audio Device', 'Save To'] as const

// ─── Root wizard ──────────────────────────────────────────────────────────────

export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const { settings, save } = useSettings()
  const devices = useAudioDevices()

  const handleComplete = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, '1')
    onComplete()
  }, [onComplete])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="First-time setup"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div
        className="w-115 rounded-2xl overflow-hidden flex flex-col wizard-card"
      >
        {/* Step indicator header */}
        <div
          className="px-7 pt-5 pb-4 flex items-center gap-2 bg-zinc-950 border-b border-zinc-800"
        >
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'transition-all duration-300 rounded-full',
                    i < step
                      ? 'w-2 h-2 bg-amber-500'
                      : i === step
                        ? 'w-2.5 h-2.5 bg-amber-400 shadow-[0_0_6px_#e2b59a55]'
                        : 'w-2 h-2 bg-zinc-700'
                  )}
                />
                <span
                  className={cn(
                    'text-[10px] font-semibold tracking-wider uppercase transition-colors duration-200',
                    i === step ? 'text-zinc-300' : 'text-zinc-600'
                  )}
                >
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div
                  className={cn(
                    'h-px w-6 transition-all duration-500',
                    i < step ? 'bg-amber-700' : 'bg-zinc-800'
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step body */}
        <div className="px-7 py-6 flex flex-col gap-4 min-h-75 bg-zinc-900">
          {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
          {step === 1 && (
            <DeviceStep
              devices={devices}
              settings={settings}
              save={save}
              onNext={() => setStep(2)}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && (
            <OutputStep
              settings={settings}
              save={save}
              onComplete={handleComplete}
              onBack={() => setStep(1)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col flex-1 gap-6">
      <div className="flex flex-col gap-3 flex-1">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-zinc-800 border border-zinc-700"
          >
            <Disc className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-zinc-100">Welcome to Autotape 3000</h1>
            <p className="text-xs text-zinc-500">Let's get you set up in 3 steps.</p>
          </div>
        </div>

        <div
          className="rounded-xl p-4 flex flex-col gap-2.5 mt-1 bg-zinc-800 border border-zinc-700"
        >
          {[
            { icon: Mic2, label: 'Choose your audio capture device' },
            { icon: FolderOpen, label: 'Set your recordings folder' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2.5 text-sm text-zinc-400">
              <Icon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              {label}
            </div>
          ))}
        </div>

        <p className="text-xs text-zinc-600 leading-relaxed px-0.5 mt-auto">
          Autotape records audio playing through your PC and splits it into individual tracks.
          Track metadata and album art are embedded when the source app reports them.
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={onNext} size="sm" className="gap-1.5">
          Get started
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ─── Step 2: Audio device ─────────────────────────────────────────────────────

interface DeviceStepProps {
  devices: AudioDevice[]
  settings: UserSettings | null
  save: (s: UserSettings) => Promise<void>
  onNext: () => void
  onBack: () => void
}

const LOOPBACK_HINTS = ['stereo mix', 'wave out', 'what u hear', 'loopback', 'virtual cable', 'vb-audio']

function isLoopbackDevice(name: string): boolean {
  const lower = name.toLowerCase()
  return LOOPBACK_HINTS.some((hint) => lower.includes(hint))
}

function DeviceStep({ devices, settings, save, onNext, onBack }: DeviceStepProps) {
  const [selectedId, setSelectedId] = useState<string>(() => settings?.deviceId ?? 'default')

  // When settings load, seed the selection (keep 'default' if nothing else is set)
  useEffect(() => {
    if (settings?.deviceId && !selectedId) {
      setSelectedId(settings.deviceId)
    }
  }, [settings, selectedId])

  const loopbackDevices = devices.filter((d) => isLoopbackDevice(d.name))
  const otherDevices = devices.filter((d) => !isLoopbackDevice(d.name))

  const handleContinue = async () => {
    if (settings && selectedId) {
      await save({ ...settings, deviceId: selectedId })
    }
    onNext()
  }

  return (
    <div className="flex flex-col flex-1 gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Mic2 className="w-4 h-4 text-amber-400 shrink-0" />
          <h2 className="text-sm font-semibold text-zinc-100">Audio Capture Device</h2>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Choose the audio output device to record from. "Default Audio Output" works for most setups.
          For music-only capture, use a virtual cable to isolate the source.
        </p>
      </div>

      {devices.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
          Loading devices…
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a capture device…" />
            </SelectTrigger>
            <SelectContent>
              {loopbackDevices.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-[10px] font-semibold tracking-wider text-amber-500 uppercase">
                    Recommended
                  </div>
                  {loopbackDevices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                  {otherDevices.length > 0 && (
                    <div className="px-2 py-1.5 text-[10px] font-semibold tracking-wider text-zinc-600 uppercase mt-1">
                      Other devices
                    </div>
                  )}
                </>
              )}
              {otherDevices.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedId && selectedId !== 'default' && !isLoopbackDevice(devices.find((d) => d.id === selectedId)?.name ?? '') && (
            <p className="text-[11px] text-zinc-600 leading-relaxed">
              For best results, route your music player through a virtual cable (e.g. VB-Audio) so
              only music is captured, not all system audio.
            </p>
          )}
        </div>
      )}

      <NavRow
        onBack={onBack}
        onNext={handleContinue}
        nextDisabled={!selectedId}
        nextLabel="Continue"
      />
    </div>
  )
}

// ─── Step 4: Output folder ────────────────────────────────────────────────────

interface OutputStepProps {
  settings: UserSettings | null
  save: (s: UserSettings) => Promise<void>
  onComplete: () => void
  onBack: () => void
}

function OutputStep({ settings, save, onComplete, onBack }: OutputStepProps) {
  const [dir, setDir] = useState<string>(() => settings?.outputDir ?? '')

  useEffect(() => {
    if (settings?.outputDir && !dir) {
      setDir(settings.outputDir)
    }
  }, [settings, dir])

  const pickFolder = async () => {
    const picked = await window.electronAPI.pickOutputDir()
    if (picked) setDir(picked)
  }

  const handleComplete = async () => {
    if (settings) {
      await save({ ...settings, outputDir: dir })
    }
    onComplete()
  }

  return (
    <div className="flex flex-col flex-1 gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
          <h2 className="text-sm font-semibold text-zinc-100">Save Location</h2>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Recordings will be saved here with artist and track name as the file name.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            className="flex-1 font-mono text-xs"
            spellCheck={false}
          />
          <Button variant="outline" size="icon" onClick={pickFolder} aria-label="Browse…">
            <FolderOpen className="w-4 h-4" />
          </Button>
        </div>
        {dir && (
          <button
            onClick={() => window.electronAPI.openPath(dir)}
            className="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors w-fit"
          >
            <ExternalLink className="w-3 h-3" />
            Open in Explorer
          </button>
        )}
      </div>

      <div className="rounded-xl px-4 py-3 text-[11px] text-zinc-500 leading-relaxed mt-auto bg-zinc-800 border border-zinc-700">
        Recordings are saved as MP3 (or WAV) files. Metadata — title, artist, album, and album art
        — is embedded when the source app reports it. You can change the format in Settings at any time.
      </div>

      <NavRow
        onBack={onBack}
        onNext={handleComplete}
        nextDisabled={!dir.trim()}
        nextLabel="Start recording"
      />
    </div>
  )
}

// ─── Shared nav row ───────────────────────────────────────────────────────────

function NavRow({
  onBack,
  onNext,
  nextDisabled,
  nextLabel,
}: {
  onBack: () => void
  onNext: () => void
  nextDisabled?: boolean
  nextLabel: string
}) {
  return (
    <div className="flex items-center justify-between mt-auto pt-2">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 text-zinc-500">
        <ChevronLeft className="w-3.5 h-3.5" />
        Back
      </Button>
      <Button size="sm" onClick={onNext} disabled={nextDisabled} className="gap-1.5">
        {nextLabel}
        <ChevronRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  )
}
