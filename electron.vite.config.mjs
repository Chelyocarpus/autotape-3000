import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Two Vite-8/Rolldown-related fixes needed on both build targets:
  //
  // 1. 'electron' itself belongs in devDependencies (it's not a runtime npm
  //    dependency — Electron's own runtime provides the module), so
  //    externalizeDepsPlugin() (which only externalizes package.json
  //    "dependencies") doesn't mark it external on its own; passing
  //    `include: ['electron']` to the plugin doesn't take effect either under
  //    Rolldown. Setting rollupOptions.external directly does. Without this,
  //    'electron' gets bundled — replacing the real native app/BrowserWindow
  //    API with the npm package's plain-Node path-resolution stub, which
  //    crashes the app on launch.
  //
  // 2. Rolldown's default output format for these lib/SSR-style builds is ESM
  //    (.mjs), but the *preload* script runs with `sandbox: true`, and Electron's
  //    sandboxed preload loader cannot execute ES module syntax ("Cannot use
  //    import statement outside a module") — it requires CommonJS. Forcing
  //    `output.format: 'cjs'` keeps both outputs as plain .js, matching what
  //    this project (package.json#main, the preload path in createWindow())
  //    has always expected.
  //
  // 3. '@ffmpeg-installer/ffmpeg' must also stay external, for a different
  //    reason: its own package code locates the bundled ffmpeg binary via
  //    `path.join(__dirname, ...)` relative to *its own* file. Inlining that
  //    code into this bundle makes `__dirname` resolve to out/main instead of
  //    the real node_modules/@ffmpeg-installer folder, so every candidate path
  //    it tries is wrong and it throws (a bare string, not an Error — which is
  //    why Electron's crash dialog just says "undefined: undefined") in any
  //    packaged build not sitting in this exact dev checkout. Keeping it a
  //    real require() lets Electron's asarUnpack path redirection work.
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts')
        },
        external: ['electron', '@ffmpeg-installer/ffmpeg'],
        output: {
          format: 'cjs'
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts')
        },
        external: ['electron'],
        output: {
          format: 'cjs'
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
