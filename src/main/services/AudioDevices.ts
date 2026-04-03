import { execFile } from 'child_process'
import { getFfmpegPath } from './FfmpegResolver'
import { log } from './log'

export interface AudioDevice {
  id: string
  name: string
}

/**
 * Lists available DirectShow audio capture devices by asking ffmpeg.
 */
export async function listAudioDevices(): Promise<AudioDevice[]> {
  const binary = getFfmpegPath()
  log(`[AudioDevices] ffmpeg path: ${binary}`)
  const output = await runFfmpeg(binary, ['-hide_banner', '-f', 'dshow', '-list_devices', 'true', '-i', 'dummy'])
  log(`[AudioDevices] dshow raw output: ${output.slice(0, 500)}`)
  return parseDshowDevices(output)
}

function runFfmpeg(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) {
        log(`[AudioDevices] ffmpeg spawn error: ${err.message}`)
      }
      // Combine both streams — different ffmpeg builds write to different streams
      resolve(`${stdout ?? ''}\n${stderr ?? ''}`)
    })
  })
}

function parseDshowDevices(output: string): AudioDevice[] {
  const devices: AudioDevice[] = []

  // Only scan within the audio devices section to exclude video device names
  const audioSectionIdx = output.indexOf('DirectShow audio devices')
  const audioSection = audioSectionIdx >= 0 ? output.slice(audioSectionIdx) : output

  // Match device name lines: [dshow @ addr]  "Device Name"
  // Alternative-name lines have text before the first quote so \s+" won't match them.
  const lineRe = /\[dshow[^\]]*\]\s+"([^"]+)"/g
  let m: RegExpExecArray | null

  while ((m = lineRe.exec(audioSection)) !== null) {
    const name = m[1].trim()
    // Skip empty, dummy placeholder, and raw @device_... alternative-name strings
    if (!name || name === 'dummy' || name.startsWith('@device_')) continue
    const id = `dshow:audio=${name}`
    if (!devices.find((d) => d.id === id)) {
      devices.push({ id, name })
    }
  }

  // Keep backward compatibility with old saved settings that used "default"
  if (!devices.find((d) => d.id === 'default')) {
    devices.unshift({ id: 'default', name: 'Default Audio Output' })
  }

  return devices
}
