/**
 * Shim for use-sync-external-store/shim/with-selector
 *
 * React 19 has useSyncExternalStore built-in, but the shim package
 * doesn't work correctly. This provides a compatible implementation.
 */
import { useSyncExternalStore } from 'react'
import { useRef, useCallback, useMemo } from 'react'

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean
): Selection {
  const instRef = useRef<{
    hasValue: boolean
    value: Selection
  } | null>(null)

  if (instRef.current === null) {
    instRef.current = { hasValue: false, value: undefined as Selection }
  }

  const getSelection = useCallback(() => {
    const nextSnapshot = getSnapshot()
    const nextSelection = selector(nextSnapshot)

    if (instRef.current!.hasValue) {
      const prevSelection = instRef.current!.value
      if (isEqual !== undefined ? isEqual(prevSelection, nextSelection) : prevSelection === nextSelection) {
        return prevSelection
      }
    }

    instRef.current!.hasValue = true
    instRef.current!.value = nextSelection
    return nextSelection
  }, [getSnapshot, selector, isEqual])

  const getServerSelection = useMemo(() => {
    if (getServerSnapshot === undefined || getServerSnapshot === null) {
      return undefined
    }
    return () => selector(getServerSnapshot())
  }, [getServerSnapshot, selector])

  return useSyncExternalStore(subscribe, getSelection, getServerSelection)
}
