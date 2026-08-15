import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts')
        }
      }
    },
    plugins: [externalizeDepsPlugin({ include: ['electron'] })]
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts')
        }
      }
    },
    plugins: [externalizeDepsPlugin({ include: ['electron'] })]
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
