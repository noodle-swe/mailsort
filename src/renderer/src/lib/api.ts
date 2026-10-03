import { useEffect, useRef } from 'react'
import type { AppEvent, MailApi } from '../../../preload/api'

declare global {
  interface Window {
    api: MailApi
  }
}

export const api = window.api

/** Subscribes to main-process events for the component's lifetime. */
export function useAppEvents(listener: (e: AppEvent) => void): void {
  const ref = useRef(listener)
  ref.current = listener
  useEffect(() => api.onEvent((e) => ref.current(e)), [])
}
