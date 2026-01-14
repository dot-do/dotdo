/**
 * VirtualizedList - Efficient list rendering for large datasets
 *
 * Uses Intersection Observer for viewport-based rendering without
 * requiring external virtualization libraries. Provides:
 *
 * - Progressive rendering as items enter viewport
 * - Smooth scrolling with overscan buffer
 * - Memory-efficient for large lists
 * - Accessible with proper ARIA attributes
 *
 * @example
 * ```tsx
 * <VirtualizedList
 *   items={largeDataset}
 *   renderItem={(item, index) => <Card key={item.id}>{item.name}</Card>}
 *   estimatedItemHeight={60}
 *   overscan={5}
 * />
 * ```
 */

import * as React from 'react'
import { useRef, useState, useEffect, useCallback, useMemo, memo } from 'react'

// =============================================================================
// Types
// =============================================================================

export interface VirtualizedListProps<T> {
  /** Array of items to render */
  items: T[]
  /** Function to render each item */
  renderItem: (item: T, index: number) => React.ReactNode
  /** Estimated height of each item in pixels */
  estimatedItemHeight?: number
  /** Number of items to render outside visible area */
  overscan?: number
  /** Maximum height of the list container */
  maxHeight?: number | string
  /** Custom className for the container */
  className?: string
  /** Callback when an item becomes visible */
  onItemVisible?: (item: T, index: number) => void
  /** Whether to enable virtualization (can be disabled for small lists) */
  enabled?: boolean
  /** Threshold for list size before virtualization kicks in */
  virtualizationThreshold?: number
  /** Loading state placeholder */
  loadingPlaceholder?: React.ReactNode
  /** Empty state placeholder */
  emptyPlaceholder?: React.ReactNode
  /** Test ID for the container */
  testId?: string
  /** ARIA label for the list */
  ariaLabel?: string
  /** Unique key extractor function */
  keyExtractor?: (item: T, index: number) => string | number
}

interface VisibilityState {
  [key: number]: boolean
}

// =============================================================================
// VirtualizedListItem Component
// =============================================================================

interface VirtualizedListItemProps {
  index: number
  height: number
  isVisible: boolean
  onVisibilityChange: (index: number, isVisible: boolean) => void
  children: React.ReactNode
}

/**
 * Individual list item with intersection observer.
 * Memoized to prevent unnecessary re-renders.
 */
const VirtualizedListItem = memo(function VirtualizedListItem({
  index,
  height,
  isVisible,
  onVisibilityChange,
  children,
}: VirtualizedListItemProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          onVisibilityChange(index, entry.isIntersecting)
        })
      },
      {
        rootMargin: '100px 0px', // Preload items slightly before they're visible
        threshold: 0,
      }
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [index, onVisibilityChange])

  return (
    <div
      ref={ref}
      data-virtualized-item
      data-index={index}
      data-visible={isVisible}
      style={{
        minHeight: isVisible ? undefined : height,
      }}
    >
      {isVisible ? children : null}
    </div>
  )
})

// =============================================================================
// VirtualizedList Component
// =============================================================================

/**
 * A performant list component that only renders visible items.
 * Uses Intersection Observer for efficient viewport detection.
 */
export function VirtualizedList<T>({
  items,
  renderItem,
  estimatedItemHeight = 60,
  overscan = 5,
  maxHeight = '100%',
  className = '',
  onItemVisible,
  enabled = true,
  virtualizationThreshold = 50,
  loadingPlaceholder,
  emptyPlaceholder,
  testId = 'virtualized-list',
  ariaLabel = 'List',
  keyExtractor,
}: VirtualizedListProps<T>) {
  const [visibilityState, setVisibilityState] = useState<VisibilityState>({})
  const containerRef = useRef<HTMLDivElement>(null)

  // Determine if virtualization should be active
  const shouldVirtualize = enabled && items.length >= virtualizationThreshold

  // Handle visibility changes for items
  const handleVisibilityChange = useCallback(
    (index: number, isVisible: boolean) => {
      setVisibilityState((prev) => {
        if (prev[index] === isVisible) return prev
        return { ...prev, [index]: isVisible }
      })

      if (isVisible && onItemVisible) {
        onItemVisible(items[index], index)
      }
    },
    [items, onItemVisible]
  )

  // Calculate visible range with overscan
  const visibleRange = useMemo(() => {
    if (!shouldVirtualize) {
      return { start: 0, end: items.length }
    }

    const visibleIndices = Object.entries(visibilityState)
      .filter(([, visible]) => visible)
      .map(([index]) => parseInt(index, 10))

    if (visibleIndices.length === 0) {
      // Initially render first batch
      return { start: 0, end: Math.min(overscan * 2, items.length) }
    }

    const minVisible = Math.min(...visibleIndices)
    const maxVisible = Math.max(...visibleIndices)

    return {
      start: Math.max(0, minVisible - overscan),
      end: Math.min(items.length, maxVisible + overscan + 1),
    }
  }, [items.length, visibilityState, shouldVirtualize, overscan])

  // Get key for an item
  const getKey = useCallback(
    (item: T, index: number) => {
      if (keyExtractor) return keyExtractor(item, index)
      // Try common id properties
      const anyItem = item as Record<string, unknown>
      if (anyItem.id !== undefined) return anyItem.id as string | number
      if (anyItem.key !== undefined) return anyItem.key as string | number
      return index
    },
    [keyExtractor]
  )

  // Handle empty state
  if (items.length === 0) {
    return (
      <div
        data-testid={`${testId}-empty`}
        className="text-muted-foreground text-center py-8"
        role="status"
      >
        {emptyPlaceholder || 'No items to display'}
      </div>
    )
  }

  // Render without virtualization for small lists
  if (!shouldVirtualize) {
    return (
      <div
        ref={containerRef}
        data-testid={testId}
        data-virtualized="false"
        className={`overflow-auto ${className}`}
        style={{ maxHeight }}
        role="list"
        aria-label={ariaLabel}
      >
        {items.map((item, index) => (
          <div key={getKey(item, index)} role="listitem">
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    )
  }

  // Render with virtualization
  return (
    <div
      ref={containerRef}
      data-testid={testId}
      data-virtualized="true"
      data-item-count={items.length}
      data-visible-range={`${visibleRange.start}-${visibleRange.end}`}
      className={`overflow-auto ${className}`}
      style={{ maxHeight }}
      role="list"
      aria-label={ariaLabel}
    >
      {items.map((item, index) => (
        <VirtualizedListItem
          key={getKey(item, index)}
          index={index}
          height={estimatedItemHeight}
          isVisible={visibilityState[index] ?? index < overscan * 2}
          onVisibilityChange={handleVisibilityChange}
        >
          <div role="listitem">{renderItem(item, index)}</div>
        </VirtualizedListItem>
      ))}
    </div>
  )
}

// =============================================================================
// VirtualizedTable Component
// =============================================================================

export interface VirtualizedTableProps<T> {
  /** Table columns configuration */
  columns: Array<{
    accessorKey?: string
    header: string | (() => React.ReactNode)
    cell?: (info: { row: { original: T } }) => React.ReactNode
    width?: number | string
  }>
  /** Row data */
  data: T[]
  /** Estimated row height */
  estimatedRowHeight?: number
  /** Maximum height of the table body */
  maxHeight?: number | string
  /** Enable virtualization */
  virtualize?: boolean
  /** Number of rows to render outside visible area */
  overscan?: number
  /** Test ID */
  testId?: string
  /** Key extractor */
  rowKey?: (row: T, index: number) => string | number
}

/**
 * VirtualizedTable - Data table with optional row virtualization.
 * Combines VirtualizedList behavior with table semantics.
 */
export const VirtualizedTable = memo(function VirtualizedTable<T extends Record<string, unknown>>({
  columns,
  data,
  estimatedRowHeight = 48,
  maxHeight = 400,
  virtualize = true,
  overscan = 5,
  testId = 'virtualized-table',
  rowKey,
}: VirtualizedTableProps<T>) {
  const shouldVirtualize = virtualize && data.length >= 50

  // Render a single table row
  const renderRow = useCallback(
    (row: T, rowIndex: number) => (
      <tr
        key={rowKey ? rowKey(row, rowIndex) : rowIndex}
        className="hover:bg-muted/50 border-b transition-colors"
      >
        {columns.map((col, colIndex) => (
          <td
            key={colIndex}
            className="p-3"
            style={{ width: col.width }}
          >
            {col.cell
              ? col.cell({ row: { original: row } })
              : col.accessorKey
                ? String(row[col.accessorKey] ?? '')
                : ''}
          </td>
        ))}
      </tr>
    ),
    [columns, rowKey]
  )

  return (
    <div
      data-testid={testId}
      data-component="VirtualizedTable"
      data-virtualized={shouldVirtualize}
      className="overflow-hidden rounded-lg border"
    >
      {/* Fixed table header */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              {columns.map((col, index) => (
                <th
                  key={index}
                  className="p-3 text-left font-medium"
                  style={{ width: col.width }}
                >
                  {typeof col.header === 'function' ? col.header() : col.header}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>

      {/* Scrollable table body */}
      <div
        className="overflow-auto"
        style={{ maxHeight }}
      >
        <table className="w-full border-collapse">
          <tbody>
            {shouldVirtualize ? (
              <VirtualizedList
                items={data}
                renderItem={renderRow}
                estimatedItemHeight={estimatedRowHeight}
                overscan={overscan}
                enabled={true}
                virtualizationThreshold={0}
                testId={`${testId}-body`}
              />
            ) : (
              data.map(renderRow)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}) as <T extends Record<string, unknown>>(props: VirtualizedTableProps<T>) => JSX.Element

// =============================================================================
// useDataCache Hook
// =============================================================================

interface CacheEntry<T> {
  data: T
  timestamp: number
  staleAt: number
}

interface UseDataCacheOptions<T> {
  /** Cache key */
  key: string
  /** Fetch function */
  fetcher: () => Promise<T>
  /** Time in ms before data is considered stale */
  staleTime?: number
  /** Time in ms before cached data is garbage collected */
  gcTime?: number
  /** Whether to refetch on mount */
  refetchOnMount?: boolean
  /** Whether to refetch when window regains focus */
  refetchOnWindowFocus?: boolean
}

interface UseDataCacheResult<T> {
  data: T | undefined
  isLoading: boolean
  isStale: boolean
  error: Error | null
  refetch: () => Promise<void>
  invalidate: () => void
}

// Simple in-memory cache
const dataCache = new Map<string, CacheEntry<unknown>>()

/**
 * Hook for caching data fetched from async sources.
 * Provides stale-while-revalidate behavior.
 */
export function useDataCache<T>({
  key,
  fetcher,
  staleTime = 30000, // 30 seconds
  gcTime = 300000, // 5 minutes
  refetchOnMount = false,
  refetchOnWindowFocus = false,
}: UseDataCacheOptions<T>): UseDataCacheResult<T> {
  const [data, setData] = useState<T | undefined>(() => {
    const cached = dataCache.get(key) as CacheEntry<T> | undefined
    return cached?.data
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await fetcher()
      const now = Date.now()

      const entry: CacheEntry<T> = {
        data: result,
        timestamp: now,
        staleAt: now + staleTime,
      }

      dataCache.set(key, entry as CacheEntry<unknown>)
      setData(result)
      setIsStale(false)

      // Schedule garbage collection
      setTimeout(() => {
        const cached = dataCache.get(key)
        if (cached && Date.now() - cached.timestamp > gcTime) {
          dataCache.delete(key)
        }
      }, gcTime)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }, [key, fetcher, staleTime, gcTime])

  const invalidate = useCallback(() => {
    dataCache.delete(key)
    setIsStale(true)
  }, [key])

  // Check staleness
  useEffect(() => {
    const cached = dataCache.get(key)
    if (cached && Date.now() > cached.staleAt) {
      setIsStale(true)
    }
  }, [key])

  // Initial fetch or refetch on mount
  useEffect(() => {
    const cached = dataCache.get(key)
    if (!cached || refetchOnMount) {
      fetchData()
    }
  }, [key]) // Intentionally minimal deps - only refetch on key change

  // Refetch on window focus
  useEffect(() => {
    if (!refetchOnWindowFocus) return

    const handleFocus = () => {
      const cached = dataCache.get(key)
      if (!cached || Date.now() > cached.staleAt) {
        fetchData()
      }
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [key, refetchOnWindowFocus, fetchData])

  return {
    data,
    isLoading,
    isStale,
    error,
    refetch: fetchData,
    invalidate,
  }
}

/**
 * Clear all cached data.
 * Useful for logout or data reset scenarios.
 */
export function clearDataCache(): void {
  dataCache.clear()
}

/**
 * Invalidate specific cache entries by key pattern.
 */
export function invalidateCacheByPattern(pattern: string | RegExp): void {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  for (const key of dataCache.keys()) {
    if (regex.test(key)) {
      dataCache.delete(key)
    }
  }
}
