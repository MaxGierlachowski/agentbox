import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

/** False during prerender and hydration, true afterwards. For values only the browser has. */
export function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
