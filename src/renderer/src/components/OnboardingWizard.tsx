import { useState, useEffect, useCallback } from 'react'
import {
  Loader2,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  Mic2,
  Disc,
  ExternalLink,
  Cable,
  Focus,
  Speaker,
  Mic,
} from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { cn } from '../lib/utils'
import { useSettings, useAudioDevices } from '../hooks/useIpc'
import type { AudioDevice, UserSettings } from '../types'

export const ONBOARDING_KEY = 'autotape-onboarding-done'

const STEP_LABELS = ['Welcome', 'Audio Capture', 'Save To'] as const

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
            <p className="text-xs text-zinc-500">Let's get you set up in 2 steps.</p>
          </div>
        </div>

        <div
          className="rounded-xl p-4 flex flex-col gap-2.5 mt-1 bg-zinc-800 border border-zinc-700"
        >
          {[
            { icon: Mic2, label: 'Choose your audio capture method' },
            { icon: FolderOpen, label: 'Set your recordings folder' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2.5 text-sm text-zinc-400">
              <Icon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              {label}
            </div>
          ))}
        </div>

        <p className="text-xs text-zinc-600 leading-relaxed px-0.5 mt-auto">
          Autotape records audio playing through your PC, splits it into individual tracks, and
          embeds metadata and album art when the source app reports them.
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

// Matches AudioDevices.ts's APP_LOOPBACK_DEVICE_ID — the renderer doesn't import
// main-process modules, so this sentinel is duplicated here (same pattern already
// used for the 'default' device id below).
const ISOLATED_DEVICE_ID = 'app-loopback'

const LOOPBACK_HINTS = ['stereo mix', 'wave out', 'what u hear', 'loopback', 'virtual cable', 'vb-audio']

function isLoopbackDevice(name: string): boolean {
  const lower = name.toLowerCase()
  return LOOPBACK_HINTS.some((hint) => lower.includes(hint))
}

type CaptureChoice = 'cable' | 'isolated' | 'standard' | 'other'

function DeviceStep({ devices, settings, save, onNext, onBack }: DeviceStepProps) {
  const [selectedId, setSelectedId] = useState<string>(() => settings?.deviceId ?? '')

  // Settings load asynchronously — seed the selection once they arrive.
  useEffect(() => {
    if (settings?.deviceId && !selectedId) {
      setSelectedId(settings.deviceId)
    }
  }, [settings, selectedId])

  const isolatedDevice = devices.find((d) => d.id === ISOLATED_DEVICE_ID)
  const standardDevice = devices.find((d) => d.id === 'default')
  const cableDevices = devices.filter((d) => d.id !== ISOLATED_DEVICE_ID && isLoopbackDevice(d.name))
  const otherDevices = devices.filter(
    (d) => d.id !== ISOLATED_DEVICE_ID && d.id !== 'default' && !isLoopbackDevice(d.name)
  )

  const choice: CaptureChoice | null =
    selectedId === ISOLATED_DEVICE_ID
      ? 'isolated'
      : selectedId === 'default'
        ? 'standard'
        : cableDevices.some((d) => d.id === selectedId)
          ? 'cable'
          : selectedId
            ? 'other'
            : null

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
          <h2 className="text-sm font-semibold text-zinc-100">Audio Capture Method</h2>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">
          {devices.length === 0
            ? 'Checking what your system supports…'
            : 'Pick how Autotape captures audio.'}
        </p>
      </div>

      {devices.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
          Loading devices…
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <ChoiceCard
              icon={Cable}
              title="Virtual Audio Cable"
              description="Routes your player through a virtual audio cable. A plain passthrough, nothing to resolve."
              selected={choice === 'cable'}
              disabled={cableDevices.length === 0}
              disabledHint="No virtual cable detected. Install one (e.g. VB-Audio) to enable this."
              onClick={() => cableDevices[0] && setSelectedId(cableDevices[0].id)}
            />
            <ChoiceCard
              icon={Focus}
              title="Isolated"
              description="Records just the app that's currently playing. No virtual audio cable needed, but less robust."
              selected={choice === 'isolated'}
              disabled={!isolatedDevice}
              disabledHint="Requires Windows 10 2004 (build 19041) or later."
              onClick={() => isolatedDevice && setSelectedId(isolatedDevice.id)}
            />
            <ChoiceCard
              icon={Speaker}
              title="Standard"
              description="Captures all system audio, including notification sounds and other apps."
              selected={choice === 'standard'}
              disabled={!standardDevice}
              onClick={() => standardDevice && setSelectedId(standardDevice.id)}
            />
            <ChoiceCard
              icon={Mic}
              title="Other"
              description="Pick a specific input device, such as a microphone or line-in."
              selected={choice === 'other'}
              disabled={otherDevices.length === 0}
              disabledHint="No other input devices found."
              onClick={() => otherDevices[0] && setSelectedId(otherDevices[0].id)}
            />
          </div>

          {choice === 'cable' && cableDevices.length > 1 && (
            <DeviceSubPicker devices={cableDevices} selectedId={selectedId} onChange={setSelectedId} />
          )}
          {choice === 'other' && (
            <DeviceSubPicker devices={otherDevices} selectedId={selectedId} onChange={setSelectedId} />
          )}

          <p className="text-[11px] text-zinc-600 leading-relaxed">
            Don't worry about selecting the wrong option. Change this anytime in Settings.
          </p>
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

function ChoiceCard({
  icon: Icon,
  title,
  description,
  selected,
  disabled,
  disabledHint,
  onClick,
}: {
  icon: typeof Cable
  title: string
  description: string
  selected: boolean
  disabled?: boolean
  disabledHint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      title={disabled ? disabledHint : undefined}
      className={cn(
        'text-left rounded-xl border p-3 flex flex-col gap-1 transition-colors',
        disabled
          ? 'border-zinc-800 bg-zinc-900/40 opacity-60 cursor-not-allowed'
          : selected
            ? 'border-amber-600 bg-amber-500/10 ring-1 ring-amber-600/30'
            : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('w-3.5 h-3.5 shrink-0', !disabled && selected ? 'text-amber-400' : 'text-zinc-500')} />
        <span className={cn('text-xs font-semibold', disabled ? 'text-zinc-600' : 'text-zinc-100')}>{title}</span>
      </div>
      <p className={cn('text-[11px] leading-snug', disabled ? 'text-zinc-700' : 'text-zinc-500')}>
        {disabled && disabledHint ? disabledHint : description}
      </p>
    </button>
  )
}

function DeviceSubPicker({
  devices,
  selectedId,
  onChange,
}: {
  devices: AudioDevice[]
  selectedId: string
  onChange: (id: string) => void
}) {
  return (
    <Select value={selectedId} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Select a device…" />
      </SelectTrigger>
      <SelectContent>
        {devices.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
          Autotape saves recordings here, named after artist and track.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            className="flex-1 font-mono text-xs select-text"
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
        Autotape saves recordings as MP3 or WAV, embedding title, artist, album, and art when the
        source app reports them. Change the format anytime in Settings.
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
