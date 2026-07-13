#!/usr/bin/env node
// Builds the WASAPI process-loopback capture helper (native/loopback-capture, a Rust
// crate) and copies the release binary into resources/native/ so electron-builder's
// extraResources config can bundle it. Requires the Rust toolchain (rustup) — see
// README.md "Building" for setup.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const crateDir = join(rootDir, 'native', 'loopback-capture')
const builtExe = join(crateDir, 'target', 'release', 'loopback-capture.exe')
const destDir = join(rootDir, 'resources', 'native')
const destExe = join(destDir, 'loopback-capture.exe')

console.log('[build-native] cargo build --release')
const result = spawnSync('cargo', ['build', '--release'], { cwd: crateDir, stdio: 'inherit', shell: true })
if (result.error || result.status !== 0) {
  console.error('[build-native] cargo build failed — is the Rust toolchain (rustup) installed and on PATH?')
  process.exit(result.status ?? 1)
}

if (!existsSync(builtExe)) {
  console.error(`[build-native] expected build output not found at ${builtExe}`)
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })
copyFileSync(builtExe, destExe)
console.log(`[build-native] copied helper to ${destExe}`)
