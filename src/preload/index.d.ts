import type { ChorusApi } from './index'

declare global {
  interface Window {
    chorus: ChorusApi
  }
}

export {}
