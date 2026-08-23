const LOOPBACK_HINTS = ['stereo mix', 'wave out', 'what u hear', 'loopback', 'virtual cable', 'vb-audio']

export function isLoopbackDevice(name: string): boolean {
  const lower = name.toLowerCase()
  return LOOPBACK_HINTS.some((hint) => lower.includes(hint))
}
