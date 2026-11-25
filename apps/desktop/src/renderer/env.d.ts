import type { BrowserApi } from '@wb/contracts'

declare global {
  interface Window {
    browserApi: BrowserApi
  }
}

export {}
