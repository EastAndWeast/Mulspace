import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // Bundle all workspace & pure-JS runtime deps into out/main/index.js so electron-builder packaging works cleanly without pnpm symlink issues.
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@wb/ai-runtime',
          '@wb/contracts',
          '@wb/extension-host',
          '@wb/kernel',
          '@wb/proxy-engine',
          '@wb/storage',
          '@wb/tab-lifecycle',
          '@wb/themes',
          '@wb/updater',
          '@wb/workspace-core',
          '@electron-toolkit/utils',
          '@material/material-color-utilities',
          'yaml',
          'fflate',
        ],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@wb/contracts'],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
      },
    },
    plugins: [react()],
  },
})
