import { useState, useEffect } from 'react'
import { FolderOpen, RefreshCw, FileAudio, Gauge, Radio, Timer, Headphones, FileMinus2, Cpu, Clapperboard } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Separator } from './ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { useSettings, useAudioDevices, useSourceSessions, useFfmpegPath, useAppVersion } from '../hooks/useIpc'
import type { UserSettings } from '../types'

import { ONBOARDING_KEY } from './OnboardingWizard'

// Matches AudioDevices.ts's APP_LOOPBACK_DEVICE_ID — the renderer doesn't import
// main-process modules, so this sentinel is duplicated here (same pattern used in
// OnboardingWizard.tsx).
const ISOLATED_DEVICE_ID = 'app-loopback'

/**
 * GSMTC's sourceAppId isn't always a recognizable app name. Browsers and CEF-based
 * apps (e.g. Spotify's current desktop client) often register their media session
 * under an opaque, per-install generated id — a bare hex hash, or "Chromium.<hash>"
 * — instead of the app's actual name. Showing that raw id in the source picker
 * reads as broken/unrecognized; showing just the track metadata instead is clearer.
 */
function isOpaqueSourceId(id: string): boolean {
  return /^[0-9a-f]{8,}$/i.test(id) || /^chromium\.[0-9a-z]{8,}$/i.test(id)
}

export function SettingsPanel({ onOpenWizard }: { onOpenWizard?: () => void }) {
  const { settings, save } = useSettings()
  const devices = useAudioDevices()
  const sourceSessions = useSourceSessions()
  const { resolvedPath, detecting, detect } = useFfmpegPath()
  const appVersion = useAppVersion()
  const [local, setLocal] = useState<UserSettings | null>(null)

  // Re-sync whenever settings changes to a value this panel didn't itself just save —
  // e.g. the onboarding wizard persisting a different device while this panel stays
  // mounted underneath it. update() sets both local and settings to the same object
  // in the same tick, so this doesn't clobber in-progress edits made here.
  useEffect(() => {
    if (settings && settings !== local) setLocal(settings)
  }, [settings, local])

  if (!local) {
    return <div className="text-zinc-500 text-sm p-4">Loading settings…</div>
  }

  const isolatedSupported = devices.some((d) => d.id === ISOLATED_DEVICE_ID)

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
        <Label className="flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 text-zinc-500" />Media Source</Label>
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
              const meta = [s.artist, s.title].filter(Boolean).join(' — ')
              const idLabel = isOpaqueSourceId(s.sourceAppId) ? null : s.sourceAppId
              const label = [idLabel, meta].filter(Boolean).join(' — ') || s.sourceAppId
              return (
                <SelectItem key={s.sourceAppId} value={s.sourceAppId}>
                  {`${label} (${state}, ${art})`}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <p className="text-xs text-zinc-500">
          Pick a specific app, or leave it on Auto. When Audio Capture Method below is set to
          Isolated, this is also the app you record.
        </p>
      </div>

      <Separator />

      {/* Audio capture method */}
      <div className="flex flex-col gap-1.5">
        <Label className="flex items-center gap-1.5"><Headphones className="w-3.5 h-3.5 text-zinc-500" />Audio Capture Method</Label>
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
        <p className="text-xs text-zinc-500">
          {isolatedSupported
            ? 'Isolated records only the app selected as Media Source above, automatically.'
            : "Pick a DirectShow device to capture from, such as a virtual audio cable if you want to isolate one app's audio."}
        </p>
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

      {/* Pause discard timeout */}
      <div className="flex flex-col gap-1.5">
        <Label className="flex items-center gap-1.5"><Timer className="w-3.5 h-3.5 text-zinc-500" />Discard After Paused (seconds)</Label>
        <Input
          type="number"
          min={0}
          step={1}
          value={local.pauseDiscardSeconds}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value, 10)
            const pauseDiscardSeconds = Number.isFinite(parsed) ? Math.max(0, parsed) : 0
            update({ pauseDiscardSeconds })
          }}
        />
        <p className="text-xs text-zinc-500">
          If playback stays paused this long, the in-progress recording is stopped and discarded. Set to 0 to never auto-discard.
        </p>
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
            className="flex-1 font-mono text-xs select-text"
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
        <p className="text-xs text-zinc-500 select-text">
          {local.ffmpegPath
            ? 'Custom path. Clear it to auto-detect.'
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
        <p className="text-xs text-zinc-500">Re-run the first-time setup to reconfigure ffmpeg, audio capture, or save location.</p>
      </div>

      <Separator />

      <p className="text-xs text-zinc-500 select-text">
        Autotape 3000{appVersion ? ` v${appVersion}` : ''}
      </p>
    </div>
  )
}
