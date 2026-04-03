/**
 * Generates app icon assets from the Phosphor "cassette-tape" SVG icon.
 * Outputs:
 *   resources/icon.png  (512×512) — used by Electron as the app icon
 *   build/icon.png      (512×512) — packaging source
 *   build/icon.ico      (multi-size) — Windows taskbar / installer
 *
 * Usage: node scripts/generate-icon.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ── Colours matching the app's warm theme ──────────────────────────────────
// --z-500 in light mode (#6b4e3e) matches the window title color.
// The app defaults to light mode, so this is the colour users see most.
const ICON_COLOR = '#6b4e3e'      // --z-500 light-mode warm brown
const ICON_SIZE = 512
const PADDING = 16                // tight padding — fills the canvas
const INNER = ICON_SIZE - PADDING * 2

// ── Read the Phosphor cassette-tape-bold SVG ─────────────────────────────────
const phosphorPath = resolve(
  root,
  'node_modules/@phosphor-icons/core/assets/bold/cassette-tape-bold.svg'
)
const rawSvg = readFileSync(phosphorPath, 'utf8')

// Replace Phosphor's default currentColor with our icon colour, and
// resize the inner viewBox content to fill the padded area.
const innerSvg = rawSvg
  .replace(/currentColor/g, ICON_COLOR)
  // Remove the outer <svg> wrapper; we'll wrap it ourselves with precise sizing
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>$/, '')
  .trim()

// ── Build the final composed SVG ─────────────────────────────────────────────
// Phosphor icons use a 256×256 viewBox
const composedSvg = `<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${ICON_SIZE}"
  height="${ICON_SIZE}"
  viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}"
>
  <!-- Background -->
  <!-- Cassette tape icon from Phosphor Icons (bold weight) -->
  <g transform="translate(${PADDING}, ${PADDING}) scale(${INNER / 256})" fill="${ICON_COLOR}">
    ${innerSvg}
  </g>
</svg>`

// ── Render SVG → PNG via resvg ────────────────────────────────────────────────
console.log('Generating icon assets…')

const resvg = new Resvg(composedSvg, {
  fitTo: { mode: 'width', value: ICON_SIZE },
})
const pngData = resvg.render().asPng()

// Write 512×512 PNGs
const resourcesIconPath = resolve(root, 'resources/icon.png')
const buildIconPngPath = resolve(root, 'build/icon.png')
const rendererIconPath = resolve(root, 'src/renderer/assets/icon.png')

writeFileSync(resourcesIconPath, pngData)
console.log('  ✓ resources/icon.png')

writeFileSync(buildIconPngPath, pngData)
console.log('  ✓ build/icon.png')

writeFileSync(rendererIconPath, pngData)
console.log('  ✓ src/renderer/assets/icon.png')

// ── Generate multi-size .ico ─────────────────────────────────────────────────
// Render smaller sizes for the ICO file
function renderAt(size) {
  const r = new Resvg(composedSvg, { fitTo: { mode: 'width', value: size } })
  return r.render().asPng()
}

const icoBuffers = [renderAt(16), renderAt(32), renderAt(48), renderAt(256)]

const icoBuffer = await pngToIco(icoBuffers)
const buildIconIcoPath = resolve(root, 'build/icon.ico')
writeFileSync(buildIconIcoPath, icoBuffer)
console.log('  ✓ build/icon.ico')

console.log('Done.')
