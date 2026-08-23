import { SelectItem } from './ui/select'
import { isLoopbackDevice } from '../lib/audioDevice'
import type { AudioDevice } from '../types'

/**
 * Grouped `SelectItem` children for an audio-device picker — recommended
 * (loopback/virtual-cable) devices under a "Recommended" header, then
 * everything else. Shared between the first-run wizard and Settings, which
 * both point at the same device list; render inside a `<SelectContent>`.
 */
export function DeviceSelectItems({ devices }: { devices: AudioDevice[] }) {
  const loopbackDevices = devices.filter((d) => isLoopbackDevice(d.name))
  const otherDevices = devices.filter((d) => !isLoopbackDevice(d.name))

  return (
    <>
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
    </>
  )
}
