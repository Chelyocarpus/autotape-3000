import { useState, useEffect, useRef } from 'react'
import type { ComponentType } from 'react'
import {
  FolderOpen, RefreshCw, FileAudio, Gauge, Radio, Timer, Headphones, FileMinus2, Cpu, Clapperboard,
  Disc3, Waves, SlidersHorizontal, Wrench
} from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Separator } from './ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { DeviceSelectItems } from './DeviceSelectItems'
import { useSettings, useAudioDevices, useSourceSessions, useFfmpegPath, useAppVersion } from '../hooks/useIpc'
import type { UserSettings } from '../types'

// Groups fields into named chunks (≤4 fields each) so the panel doesn't read as one flat
// undifferentiated list — the "muted" variant de-emphasizes the rarely-touched Advanced block.
function SectionHeader({
  icon: Icon,
  children,
  muted = false
}: {
  icon: ComponentType<{ className?: string }>
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <h3
      className={`flex items-center gap-1.5 text-[0.65625rem] font-semibold uppercase tracking-widest select-none ${
        muted ? 'text-zinc-600' : 'text-zinc-500'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {children}
    </h3>
  )
}

export function SettingsPanel({ onOpenWizard }: { onOpenWizard?: () => void }) {
  const { settings, save } = useSettings()
  const devices = useAudioDevices()
  const sourceSessions = useSourceSessions()
  const { resolvedPath, detecting, detect } = useFfmpegPath()
  const appVersion = useAppVersion()
  const [local, setLocal] = useState<UserSettings | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef<UserSettings | null>(null)

  useEffect(() => {
    if (settings && !local) setLocal(settings)
  }, [settings, local])

  // Flush any debounced save that hasn't fired yet so a change isn't lost if the panel closes quickly.
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        if (pendingSaveRef.current) save(pendingSaveRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!local) {
    return <div className="text-zinc-500 text-sm p-4">Loading settings…</div>
  }

  function update(patch: Partial<UserSettings>) {
    const next = { ...local!, ...patch }
    setLocal(next)
    pendingSaveRef.current = next
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      pendingSaveRef.current = null
      save(next)
    }, 500)
  }

  async function pickFolder() {
    const dir = await window.electronAPI.pickOutputDir()
    if (dir) update({ outputDir: dir })
  }

  return (
    <div className="flex flex-col gap-6 p-1">
      {/* ── Output ── */}
      <div className="flex flex-col gap-3">
        <SectionHeader icon={Disc3}>Output</SectionHeader>

        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5 text-zinc-500" />Output Folder</Label>
          <div className="flex gap-2">
            <Input
              value={local.outputDir}
              onChange={(e) => update({ outputDir: e.target.value })}
              className="flex-1 font-mono text-xs select-text"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={pickFolder}>
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Browse…</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5"><FileAudio className="w-3.5 h-3.5 text-zinc-500" />Format</Label>
          <Select
            value={local.format}
            onValueChange={(v) => update({ format: v as 'mp3' | 'wav' })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mp3">MP3</SelectItem>
              <SelectItem value="wav">WAV (lossless)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {local.format === 'mp3' && (
          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-zinc-500" />Bitrate</Label>
            <Select
              value={String(local.bitrate)}
              onValueChange={(v) => update({ bitrate: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="128">128 kbps</SelectItem>
                <SelectItem value="160">160 kbps (Spotify High)</SelectItem>
                <SelectItem value="192">192 kbps</SelectItem>
                <SelectItem value="256">256 kbps</SelectItem>
                <SelectItem value="320">320 kbps</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Separator />

      {/* ── Source ── */}
      <div className="flex flex-col gap-3">
        <SectionHeader icon={Waves}>Source</SectionHeader>

        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 text-zinc-500" />Media Source (for track detection &amp; artwork)</Label>
          <Select
            value={local.sessionFilter}
            onValueChange={(v) => update({ sessionFilter: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select source…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (best detected stream)</SelectItem>
              {sourceSessions.map((s) => {
                const state = s.isPlaying ? 'Playing' : 'Idle'
                const art = s.hasArtwork ? 'Art' : 'No art'
                const title = [s.artist, s.title].filter(Boolean).join(' — ') || s.sourceAppId
                return (
                  <SelectItem key={s.sourceAppId} value={s.sourceAppId}>
                    {`${title} (${state}, ${art})`}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <p className="text-xs text-zinc-500">Pick a specific stream/app, or keep Auto.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5"><Headphones className="w-3.5 h-3.5 text-zinc-500" />Audio Device (WASAPI)</Label>
          <Select
            value={local.deviceId}
            onValueChange={(v) => update({ deviceId: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select device…" />
            </SelectTrigger>
            <SelectContent>
              {devices.length === 0 && (
                <SelectItem value="default">Default Audio Output</SelectItem>
              )}
              <DeviceSelectItems devices={devices} />
            </SelectContent>
          </Select>
          <p className="text-xs text-zinc-500">Select a virtual audio cable for isolated capture</p>
        </div>
      </div>

      <Separator />

      {/* ── Behavior ── */}
      <div className="flex flex-col gap-3">
        <SectionHeader icon={SlidersHorizontal}>Behavior</SectionHeader>

        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5"><Timer className="w-3.5 h-3.5 text-zinc-500" />Don't Save Below (seconds)</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={local.minSaveSeconds}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10)
              const minSaveSeconds = Number.isFinite(parsed) ? Math.max(0, parsed) : 0
              update({ minSaveSeconds })
            }}
          />
          <p className="text-xs text-zinc-500">Any recording shorter than this is skipped.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5"><FileMinus2 className="w-3.5 h-3.5 text-zinc-500" />If File Already Exists</Label>
          <Select
            value={local.duplicateAction}
            onValueChange={(v) => update({ duplicateAction: v as UserSettings['duplicateAction'] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="increment">Add number suffix  (Artist - Title (2))</SelectItem>
              <SelectItem value="overwrite">Overwrite existing</SelectItem>
              <SelectItem value="skip">Skip (don't record)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      {/* ── Advanced (rarely touched — de-emphasized) ── */}
      <div className="flex flex-col gap-3">
        <SectionHeader icon={Wrench} muted>Advanced</SectionHeader>

        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5 text-zinc-500" />ffmpeg Binary</Label>
          <div className="flex gap-2">
            <Input
              value={local.ffmpegPath}
              onChange={(e) => update({ ffmpegPath: e.target.value })}
              placeholder={resolvedPath || 'Auto-detect…'}
              className="flex-1 font-mono text-xs select-text"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    const detected = await detect()
                    // Only clear the custom override if detection actually found something —
                    // a failed detect() shouldn't silently wipe a working custom path.
                    if (detected) update({ ffmpegPath: '' })
                  }}
                  disabled={detecting}
                >
                  <RefreshCw className={`w-4 h-4${detecting ? ' animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Auto-detect ffmpeg</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-xs text-zinc-500 select-text">
            {local.ffmpegPath
              ? 'Custom path — clear the field to auto-detect.'
              : resolvedPath
                ? `Auto-detected: ${resolvedPath}`
                : 'Leave blank to auto-detect (bundled, then system PATH).'}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5">
            <Clapperboard className="w-3.5 h-3.5 text-zinc-500" />
            Setup
          </Label>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => onOpenWizard?.()}
          >
            Open setup wizard
          </Button>
          <p className="text-xs text-zinc-500">Re-run the first-time setup to reconfigure FFmpeg, audio device, or save location.</p>
        </div>
      </div>

      <Separator />

      <p className="text-xs text-zinc-500 select-text">
        Autotape 3000{appVersion ? ` v${appVersion}` : ''}
      </p>
    </div>
  )
}
