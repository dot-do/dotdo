/**
 * VirtualizedList Tests
 *
 * Tests for the virtualized list components that enable efficient
 * rendering of large datasets using Intersection Observer.
 *
 * Covers:
 * - VirtualizedList: Progressive rendering of items
 * - VirtualizedTable: Table with row virtualization
 * - useDataCache: Stale-while-revalidate data caching
 *
 * @see app/components/cockpit/virtualized-list.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'

import {
  VirtualizedList,
  VirtualizedTable,
  useDataCache,
  clearDataCache,
  invalidateCacheByPattern,
} from '../virtualized-list'

// =============================================================================
// Test Data
// =============================================================================

const generateItems = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    name: `Item ${i}`,
    value: i * 100,
  }))

const smallDataset = generateItems(10)
const largeDataset = generateItems(200)

// =============================================================================
// Mock IntersectionObserver
// =============================================================================

class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  elements: Set<Element> = new Set()
  static instances: MockIntersectionObserver[] = []

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }

  observe(element: Element) {
    this.elements.add(element)
    // Simulate immediate visibility for first few items
    const index = parseInt(element.getAttribute('data-index') || '0', 10)
    if (index < 10) {
      this.callback(
        [{ isIntersecting: true, target: element }] as IntersectionObserverEntry[],
        this as unknown as IntersectionObserver
      )
    }
  }

  unobserve(element: Element) {
    this.elements.delete(element)
  }

  disconnect() {
    this.elements.clear()
  }

  static simulateIntersection(index: number, isIntersecting: boolean) {
    MockIntersectionObserver.instances.forEach((instance) => {
      instance.elements.forEach((element) => {
        if (element.getAttribute('data-index') === String(index)) {
          instance.callback(
            [{ isIntersecting, target: element }] as IntersectionObserverEntry[],
            instance as unknown as IntersectionObserver
          )
        }
      })
    })
  }

  static reset() {
    MockIntersectionObserver.instances = []
  }
}

beforeEach(() => {
  MockIntersectionObserver.reset()
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  clearDataCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// =============================================================================
// VirtualizedList Tests
// =============================================================================

describe('VirtualizedList', () => {
  it('renders small lists without virtualization', () => {
    render(
      <VirtualizedList
        items={smallDataset}
        renderItem={(item) => <div key={item.id}>{item.name}</div>}
        testId="small-list"
      />
    )

    const list = screen.getByTestId('small-list')
    expect(list).toHaveAttribute('data-virtualized', 'false')
    expect(screen.getByText('Item 0')).toBeInTheDocument()
    expect(screen.getByText('Item 9')).toBeInTheDocument()
  })

  it('renders large lists with virtualization', () => {
    render(
      <VirtualizedList
        items={largeDataset}
        renderItem={(item) => <div key={item.id}>{item.name}</div>}
        testId="large-list"
      />
    )

    const list = screen.getByTestId('large-list')
    expect(list).toHaveAttribute('data-virtualized', 'true')
    expect(list).toHaveAttribute('data-item-count', '200')
  })

  it('shows empty placeholder when no items', () => {
    render(
      <VirtualizedList
        items={[]}
        renderItem={(item: { id: string; name: string }) => <div key={item.id}>{item.name}</div>}
        testId="empty-list"
      />
    )

    expect(screen.getByTestId('empty-list-empty')).toBeInTheDocument()
    expect(screen.getByText('No items to display')).toBeInTheDocument()
  })

  it('shows custom empty placeholder', () => {
    render(
      <VirtualizedList
        items={[]}
        renderItem={(item: { id: string; name: string }) => <div key={item.id}>{item.name}</div>}
        emptyPlaceholder={<span>Custom empty message</span>}
        testId="custom-empty"
      />
    )

    expect(screen.getByText('Custom empty message')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(
      <VirtualizedList
        items={smallDataset}
        renderItem={(item) => <div key={item.id}>{item.name}</div>}
        className="custom-class"
        testId="styled-list"
      />
    )

    const list = screen.getByTestId('styled-list')
    expect(list).toHaveClass('custom-class')
  })

  it('has accessible attributes', () => {
    render(
      <VirtualizedList
        items={smallDataset}
        renderItem={(item) => <div key={item.id}>{item.name}</div>}
        ariaLabel="Test list"
        testId="accessible-list"
      />
    )

    const list = screen.getByTestId('accessible-list')
    expect(list).toHaveAttribute('role', 'list')
    expect(list).toHaveAttribute('aria-label', 'Test list')
  })

  it('uses keyExtractor for item keys', () => {
    const customKeyExtractor = vi.fn((item: { id: string }) => `custom-${item.id}`)

    render(
      <VirtualizedList
        items={smallDataset}
        renderItem={(item) => <div>{item.name}</div>}
        keyExtractor={customKeyExtractor}
        testId="keyed-list"
      />
    )

    expect(customKeyExtractor).toHaveBeenCalled()
  })

  it('respects virtualization threshold', () => {
    render(
      <VirtualizedList
        items={generateItems(30)}
        renderItem={(item) => <div key={item.id}>{item.name}</div>}
        virtualizationThreshold={25}
        testId="threshold-list"
      />
    )

    const list = screen.getByTestId('threshold-list')
    expect(list).toHaveAttribute('data-virtualized', 'true')
  })

  it('can disable virtualization', () => {
    render(
      <VirtualizedList
        items={largeDataset}
        renderItem={(item) => <div key={item.id}>{item.name}</div>}
        enabled={false}
        testId="disabled-virtual"
      />
    )

    const list = screen.getByTestId('disabled-virtual')
    expect(list).toHaveAttribute('data-virtualized', 'false')
  })

  it('calls onItemVisible when item becomes visible', async () => {
    const onItemVisible = vi.fn()

    render(
      <VirtualizedList
        items={largeDataset}
        renderItem={(item) => <div key={item.id}>{item.name}</div>}
        onItemVisible={onItemVisible}
        testId="visibility-list"
      />
    )

    // The mock triggers visibility for first 10 items
    await waitFor(() => {
      expect(onItemVisible).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// VirtualizedTable Tests
// =============================================================================

describe('VirtualizedTable', () => {
  const columns = [
    { accessorKey: 'id', header: 'ID', width: 100 },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'value', header: 'Value', width: 120 },
  ]

  it('renders table headers', () => {
    render(
      <VirtualizedTable
        columns={columns}
        data={smallDataset}
        testId="table-headers"
      />
    )

    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Value')).toBeInTheDocument()
  })

  it('renders table rows', () => {
    render(
      <VirtualizedTable
        columns={columns}
        data={smallDataset}
        testId="table-rows"
      />
    )

    expect(screen.getByText('item-0')).toBeInTheDocument()
    expect(screen.getByText('Item 0')).toBeInTheDocument()
  })

  it('applies virtualization to large datasets', () => {
    render(
      <VirtualizedTable
        columns={columns}
        data={largeDataset}
        virtualize={true}
        testId="virtualized-table"
      />
    )

    const table = screen.getByTestId('virtualized-table')
    expect(table).toHaveAttribute('data-virtualized', 'true')
  })

  it('can disable virtualization', () => {
    render(
      <VirtualizedTable
        columns={columns}
        data={largeDataset}
        virtualize={false}
        testId="non-virtual-table"
      />
    )

    const table = screen.getByTestId('non-virtual-table')
    expect(table).toHaveAttribute('data-virtualized', 'false')
  })

  it('supports custom cell renderers', () => {
    const customColumns = [
      ...columns,
      {
        header: 'Custom',
        cell: ({ row }: { row: { original: { name: string } } }) => (
          <strong data-testid="custom-cell">{row.original.name.toUpperCase()}</strong>
        ),
      },
    ]

    render(
      <VirtualizedTable
        columns={customColumns}
        data={smallDataset}
        testId="custom-cell-table"
      />
    )

    expect(screen.getAllByTestId('custom-cell').length).toBeGreaterThan(0)
  })

  it('has correct component attribute', () => {
    render(
      <VirtualizedTable
        columns={columns}
        data={smallDataset}
        testId="component-attr"
      />
    )

    const table = screen.getByTestId('component-attr')
    expect(table).toHaveAttribute('data-component', 'VirtualizedTable')
  })
})

// =============================================================================
// useDataCache Hook Tests
// =============================================================================

describe('useDataCache', () => {
  beforeEach(() => {
    clearDataCache()
  })

  it('fetches data on mount', async () => {
    const fetcher = vi.fn().mockResolvedValue({ result: 'test' })

    const { result } = renderHook(() =>
      useDataCache({
        key: 'test-key',
        fetcher,
      })
    )

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(fetcher).toHaveBeenCalledOnce()
    expect(result.current.data).toEqual({ result: 'test' })
  })

  it('returns cached data on subsequent renders', async () => {
    const fetcher = vi.fn().mockResolvedValue({ result: 'cached' })

    const { result, rerender } = renderHook(() =>
      useDataCache({
        key: 'cache-test',
        fetcher,
      })
    )

    await waitFor(() => {
      expect(result.current.data).toEqual({ result: 'cached' })
    })

    rerender()

    // Should not fetch again
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('handles fetch errors', async () => {
    const error = new Error('Fetch failed')
    const fetcher = vi.fn().mockRejectedValue(error)

    const { result } = renderHook(() =>
      useDataCache({
        key: 'error-test',
        fetcher,
      })
    )

    await waitFor(() => {
      expect(result.current.error).toEqual(error)
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toBeUndefined()
  })

  it('refetches when called manually', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ result: 'first' })
      .mockResolvedValueOnce({ result: 'second' })

    const { result } = renderHook(() =>
      useDataCache({
        key: 'refetch-test',
        fetcher,
      })
    )

    await waitFor(() => {
      expect(result.current.data).toEqual({ result: 'first' })
    })

    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.data).toEqual({ result: 'second' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('invalidates cache', async () => {
    const fetcher = vi.fn().mockResolvedValue({ result: 'data' })

    const { result } = renderHook(() =>
      useDataCache({
        key: 'invalidate-test',
        fetcher,
      })
    )

    await waitFor(() => {
      expect(result.current.data).toEqual({ result: 'data' })
    })

    act(() => {
      result.current.invalidate()
    })

    expect(result.current.isStale).toBe(true)
  })
})

// =============================================================================
// Cache Utility Tests
// =============================================================================

describe('Cache utilities', () => {
  it('clearDataCache removes all cached data', async () => {
    const fetcher1 = vi.fn().mockResolvedValue({ id: 1 })
    const fetcher2 = vi.fn().mockResolvedValue({ id: 2 })

    const { result: result1 } = renderHook(() =>
      useDataCache({ key: 'cache-1', fetcher: fetcher1 })
    )

    const { result: result2 } = renderHook(() =>
      useDataCache({ key: 'cache-2', fetcher: fetcher2 })
    )

    await waitFor(() => {
      expect(result1.current.data).toBeDefined()
      expect(result2.current.data).toBeDefined()
    })

    clearDataCache()

    // New hooks should need to fetch again
    const fetcher3 = vi.fn().mockResolvedValue({ id: 3 })
    const { result: result3 } = renderHook(() =>
      useDataCache({ key: 'cache-1', fetcher: fetcher3 })
    )

    await waitFor(() => {
      expect(result3.current.data).toEqual({ id: 3 })
    })

    expect(fetcher3).toHaveBeenCalled()
  })

  it('invalidateCacheByPattern removes matching keys', async () => {
    const fetcher1 = vi.fn().mockResolvedValue({ type: 'user' })
    const fetcher2 = vi.fn().mockResolvedValue({ type: 'product' })

    renderHook(() => useDataCache({ key: 'user-123', fetcher: fetcher1 }))
    renderHook(() => useDataCache({ key: 'product-456', fetcher: fetcher2 }))

    await waitFor(() => {
      expect(fetcher1).toHaveBeenCalled()
      expect(fetcher2).toHaveBeenCalled()
    })

    // Invalidate only user keys
    invalidateCacheByPattern(/^user-/)

    // New fetch should be needed for user keys
    const fetcher3 = vi.fn().mockResolvedValue({ type: 'user-new' })
    const { result } = renderHook(() =>
      useDataCache({ key: 'user-123', fetcher: fetcher3 })
    )

    await waitFor(() => {
      expect(fetcher3).toHaveBeenCalled()
    })
  })
})
