/**
 * useDotdoCollection hook - Reactive collection data with optimistic updates
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSyncContext } from './context'
import type { UseDotdoCollectionOptions, UseDotdoCollectionResult } from './types'

/**
 * WebSocket message types for sync
 */
interface SyncMessage {
  type: 'initial' | 'insert' | 'update' | 'delete'
  collection: string
  key?: string
  data?: unknown
  txid: number
}

/**
 * Hook for reactive collection data with optimistic updates
 */
export function useDotdoCollection<T extends { $id: string }>(
  options: UseDotdoCollectionOptions<T>
): UseDotdoCollectionResult<T> {
  const { collection, schema, filter, enabled = true } = options
  const { connectionState, doUrl, lastError } = useSyncContext()

  // State
  const [data, setData] = useState<T[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [txid, setTxid] = useState(0)
  const [pendingMutations, setPendingMutations] = useState(0)

  // Refs for optimistic updates
  const optimisticUpdatesRef = useRef<Map<string, { original: T | null; type: 'insert' | 'update' | 'delete' }>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)

  // Get the base URL for RPC calls
  const baseUrl = useMemo(() => {
    try {
      const url = new URL(doUrl)
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
      return url.origin
    } catch {
      return ''
    }
  }, [doUrl])

  // Message handler
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data) as SyncMessage

      if (message.collection !== collection) return

      switch (message.type) {
        case 'initial':
          setData((message.data as T[]) ?? [])
          setTxid(message.txid)
          setIsLoading(false)
          break

        case 'insert':
          setData(prev => {
            // Don't add if it already exists (from optimistic update)
            if (prev.some(item => item.$id === message.key)) {
              return prev
            }
            return [...prev, message.data as T]
          })
          setTxid(message.txid)
          break

        case 'update':
          setData(prev =>
            prev.map(item =>
              item.$id === message.key ? { ...item, ...(message.data as Partial<T>) } : item
            )
          )
          setTxid(message.txid)
          break

        case 'delete':
          setData(prev => prev.filter(item => item.$id !== message.key))
          setTxid(message.txid)
          break
      }
    } catch {
      // Ignore invalid messages
    }
  }, [collection])

  // Setup WebSocket listener
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }

    // Create WebSocket for this collection
    try {
      const ws = new WebSocket(doUrl)
      wsRef.current = ws

      ws.onopen = () => {
        // Request initial data for this collection
        ws.send(JSON.stringify({ type: 'subscribe', collection }))
      }

      ws.onmessage = handleMessage

      ws.onerror = () => {
        setError(new Error('WebSocket connection error'))
      }

      ws.onclose = () => {
        // Will be handled by reconnection logic in SyncProvider
      }

      return () => {
        ws.close()
        wsRef.current = null
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to connect'))
      setIsLoading(false)
    }
  }, [doUrl, collection, enabled, handleMessage])

  // Update error from context
  useEffect(() => {
    if (lastError) {
      setError(lastError)
    }
  }, [lastError])

  // Filtered data
  const filteredData = useMemo(() => {
    return filter ? data.filter(filter) : data
  }, [data, filter])

  // Insert with optimistic update
  const insert = useCallback(async (item: T): Promise<void> => {
    if (!enabled) return

    // Validate
    try {
      schema.parse(item)
    } catch (e) {
      throw new Error(`Validation failed: ${e instanceof Error ? e.message : 'Invalid data'}`)
    }

    // Optimistic insert
    setData(prev => [...prev, item])
    setPendingMutations(prev => prev + 1)
    optimisticUpdatesRef.current.set(item.$id, { original: null, type: 'insert' })

    try {
      const response = await fetch(`${baseUrl}/rpc/${collection}.create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `HTTP ${response.status}`)
      }
    } catch (e) {
      // Rollback optimistic update
      setData(prev => prev.filter(i => i.$id !== item.$id))
      optimisticUpdatesRef.current.delete(item.$id)
      throw e
    } finally {
      setPendingMutations(prev => prev - 1)
      optimisticUpdatesRef.current.delete(item.$id)
    }
  }, [enabled, baseUrl, collection, schema])

  // Update with optimistic update
  const update = useCallback(async (id: string, updates: Partial<T>): Promise<void> => {
    if (!enabled) return

    // Find original
    const original = data.find(item => item.$id === id)
    if (!original) {
      throw new Error(`Item not found: ${id}`)
    }

    // Optimistic update
    setData(prev =>
      prev.map(item => (item.$id === id ? { ...item, ...updates } : item))
    )
    setPendingMutations(prev => prev + 1)
    optimisticUpdatesRef.current.set(id, { original, type: 'update' })

    try {
      const response = await fetch(`${baseUrl}/rpc/${collection}.update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `HTTP ${response.status}`)
      }
    } catch (e) {
      // Rollback optimistic update
      setData(prev =>
        prev.map(item => (item.$id === id ? original : item))
      )
      optimisticUpdatesRef.current.delete(id)
      throw e
    } finally {
      setPendingMutations(prev => prev - 1)
      optimisticUpdatesRef.current.delete(id)
    }
  }, [enabled, baseUrl, collection, data])

  // Delete with optimistic update
  const deleteItem = useCallback(async (id: string): Promise<void> => {
    if (!enabled) return

    // Find original
    const original = data.find(item => item.$id === id)
    if (!original) {
      throw new Error(`Item not found: ${id}`)
    }

    // Optimistic delete
    setData(prev => prev.filter(item => item.$id !== id))
    setPendingMutations(prev => prev + 1)
    optimisticUpdatesRef.current.set(id, { original, type: 'delete' })

    try {
      const response = await fetch(`${baseUrl}/rpc/${collection}.delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `HTTP ${response.status}`)
      }
    } catch (e) {
      // Rollback optimistic delete
      setData(prev => [...prev, original])
      optimisticUpdatesRef.current.delete(id)
      throw e
    } finally {
      setPendingMutations(prev => prev - 1)
      optimisticUpdatesRef.current.delete(id)
    }
  }, [enabled, baseUrl, collection, data])

  // Find by ID
  const findById = useCallback((id: string): T | undefined => {
    return filteredData.find(item => item.$id === id)
  }, [filteredData])

  // Find by IDs
  const findByIds = useCallback((ids: string[]): T[] => {
    const idSet = new Set(ids)
    return filteredData.filter(item => idSet.has(item.$id))
  }, [filteredData])

  // Filter by predicate
  const filterItems = useCallback((predicate: (item: T) => boolean): T[] => {
    return filteredData.filter(predicate)
  }, [filteredData])

  // Refetch
  const refetch = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', collection }))
      setIsLoading(true)
    }
  }, [collection])

  return {
    data: filteredData,
    isLoading,
    error,
    txid,
    pendingMutations,
    insert,
    update,
    delete: deleteItem,
    findById,
    findByIds,
    filter: filterItems,
    refetch,
  }
}
