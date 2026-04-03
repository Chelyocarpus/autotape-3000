import { useState, useEffect, useCallback } from 'react'
import { FolderOpen, RefreshCw, FileAudio, Gauge, Radio, Timer, Headphones, FileMinus2, Cpu, Clapperboard } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Separator } from './ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { useSettings, useAudioDevices, useSourceSessions, useFfmpegPath } from '../hooks/useIpc'
import type { UserSettings } from '../types'

import { ONBOARDING_KEY } from './OnboardingWizard'

export function SettingsPanel({ onOpenWizard }: { onOpenWizard?: () => void }) {
  const { settings, save } = useSettings()
  const devices = useAudioDevices()
  const sourceSessions = useSourceSessions()
  const { resolvedPath, detecting, detect } = useFfmpegPath()
  const [local, setLocal] = useState<UserSettings | null>(null)

  useEffect(() => {
    if (settings && !local) setLocal(settings)
  }, [settings, local])

  if (!local) {
    return <div className="text-zinc-500 text-sm p-4">Loading settings…</div>
  }

  function update(patch: Partial<UserSettings>) {
    const next = { ...local!, ...patch }
    setLocal(next)
    save(next)
  }

  async function pickFolder() {
    const dir = await window.electronAPI.pickOutputDir()
    if (dir) update({ outputDir: dir })
  }

  return (
    <div className="flex flex-col gap-5 p-1">
      {/* Output directory */}
      <div className="flex flex-col gap-1.5">
        <Label className="flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5 text-zinc-500" />Output Folder</Label>
        <div className="flex gap-2">
          <Input
            value={local.outputDir}
            onChange={(e) => update({ outputDir: e.target.value })}
            className="flex-1 font-mono text-xs"
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

      <Separator />

      {/* Format */}
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

      {/* Bitrate — only for MP3 */}
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

      <Separator />

      {/* Source stream */}
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

      <Separator />

      {/* Minimum save duration */}
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

      <Separator />

      {/* Audio device */}
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
            {devices.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-zinc-500">Select a virtual audio cable for isolated capture</p>
      </div>

      <Separator />

      {/* Duplicate handling */}
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

      <Separator />

      {/* ffmpeg binary */}
      <div className="flex flex-col gap-1.5">
        <Label className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5 text-zinc-500" />ffmpeg Binary</Label>
        <div className="flex gap-2">
          <Input
            value={local.ffmpegPath}
            onChange={(e) => update({ ffmpegPath: e.target.value })}
            placeholder={resolvedPath || 'Auto-detect…'}
            className="flex-1 font-mono text-xs"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={async () => {
                  const detected = await detect()
                  update({ ffmpegPath: '' })
                  void detected
                }}
                disabled={detecting}
              >
                <RefreshCw className={`w-4 h-4${detecting ? ' animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Auto-detect ffmpeg</TooltipContent>
          </Tooltip>
        </div>
        <p className="text-xs text-zinc-500">
          {local.ffmpegPath
            ? 'Custom path — clear the field to auto-detect.'
            : resolvedPath
              ? `Auto-detected: ${resolvedPath}`
              : 'Leave blank to auto-detect (bundled, then system PATH).'}
        </p>
      </div>

      <Separator />

      {/* Setup wizard re-open */}
      <div className="flex flex-col gap-1.5">
        <Label className="flex items-center gap-1.5">
          <Clapperboard className="w-3.5 h-3.5 text-zinc-500" />
          Setup
        </Label>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => {
            localStorage.removeItem(ONBOARDING_KEY)
            onOpenWizard?.()
          }}
        >
          Open setup wizard
        </Button>
        <p className="text-xs text-zinc-500">Re-run the first-time setup to reconfigure FFmpeg, audio device, or save location.</p>
      </div>
    </div>
  )
}
