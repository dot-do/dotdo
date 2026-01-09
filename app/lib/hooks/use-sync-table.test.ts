/**
 * useSyncTable Hook Tests (TDD RED Phase)
 *
 * These tests define the contract for the useSyncTable hook.
 * Tests SHOULD FAIL until the implementation is complete.
 *
 * The useSyncTable hook wraps TanStack Table to provide:
 * - Seamless integration with useDotdoCollection data
 * - Built-in sorting, filtering, pagination support
 * - Row selection with bulk action support
 * - Automatic loading state management
 *
 * Expected Hook Interface:
 * ```typescript
 * interface UseSyncTableOptions<T extends { $id: string }> {
 *   collection: {
 *     data: T[]
 *     isLoading: boolean
 *     delete: (id: string) => Promise<void>
 *   }
 *   columns: ColumnDef<T>[]
 *   enableSorting?: boolean      // default: true
 *   enableFiltering?: boolean    // default: true
 *   enablePagination?: boolean   // default: true
 *   enableRowSelection?: boolean // default: false
 *   pageSize?: number            // default: 10
 * }
 *
 * interface UseSyncTableReturn<T> {
 *   table: Table<T>              // TanStack Table instance
 *   isLoading: boolean           // Reflects collection.isLoading
 *   selectedRows: T[]            // Currently selected row data
 *   deleteSelected: () => Promise<void>  // Bulk delete selected rows
 * }
 * ```
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

const HOOK_PATH = 'app/lib/hooks/use-sync-table.ts'

// ============================================================================
// File Structure Tests
// ============================================================================

describe('useSyncTable', () => {
  describe('file structure', () => {
    it('should exist at app/lib/hooks/use-sync-table.ts', () => {
      expect(existsSync(HOOK_PATH)).toBe(true)
    })

    it('should export useSyncTable function', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toMatch(/export\s+(function|const)\s+useSyncTable/)
    })

    it('should import useReactTable from @tanstack/react-table', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('@tanstack/react-table')
      expect(content).toContain('useReactTable')
    })

    it('should import getCoreRowModel from @tanstack/react-table', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('getCoreRowModel')
    })
  })

  // ============================================================================
  // Initialization Tests
  // ============================================================================

  describe('initialization', () => {
    it('returns TanStack Table instance via table property', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should return object with table property
      expect(content).toMatch(/return\s*\{[\s\S]*table[\s\S]*\}/)
    })

    it('returns isLoading property from collection', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should pass through isLoading from collection
      expect(content).toMatch(/isLoading.*collection\.isLoading|collection\.isLoading.*isLoading/)
    })

    it('uses $id as row key via getRowId', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should configure getRowId to use $id
      expect(content).toMatch(/getRowId[\s\S]*\$id/)
    })
  })

  // ============================================================================
  // Data Binding Tests
  // ============================================================================

  describe('data binding', () => {
    it('passes collection.data to useReactTable', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should use collection.data as table data
      expect(content).toMatch(/data:\s*collection\.data|data:[\s\S]*collection\.data/)
    })

    it('handles empty data array by defaulting to empty array', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should handle undefined/null data gracefully
      expect(content).toMatch(/collection\.data\s*\?\?|collection\.data\s*\|\||\[\]/)
    })

    it('passes columns to useReactTable', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should accept and use columns
      expect(content).toMatch(/columns/)
    })
  })

  // ============================================================================
  // Sorting Tests
  // ============================================================================

  describe('sorting', () => {
    it('imports getSortedRowModel from @tanstack/react-table', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('getSortedRowModel')
    })

    it('accepts enableSorting option', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('enableSorting')
    })

    it('configures getSortedRowModel based on enableSorting', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should conditionally apply sorting
      expect(content).toMatch(/enableSorting[\s\S]*getSortedRowModel/)
    })
  })

  // ============================================================================
  // Filtering Tests
  // ============================================================================

  describe('filtering', () => {
    it('imports getFilteredRowModel from @tanstack/react-table', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('getFilteredRowModel')
    })

    it('accepts enableFiltering option', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('enableFiltering')
    })

    it('configures getFilteredRowModel based on enableFiltering', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should conditionally apply filtering
      expect(content).toMatch(/enableFiltering[\s\S]*getFilteredRowModel/)
    })
  })

  // ============================================================================
  // Pagination Tests
  // ============================================================================

  describe('pagination', () => {
    it('imports getPaginationRowModel from @tanstack/react-table', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('getPaginationRowModel')
    })

    it('accepts enablePagination option', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('enablePagination')
    })

    it('accepts pageSize option', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('pageSize')
    })

    it('configures initial pagination state with pageSize', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should set initial pageSize in pagination state
      expect(content).toMatch(/initialState[\s\S]*pagination[\s\S]*pageSize|pagination[\s\S]*pageSize/)
    })
  })

  // ============================================================================
  // Selection Tests
  // ============================================================================

  describe('selection', () => {
    it('accepts enableRowSelection option', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('enableRowSelection')
    })

    it('maintains row selection state with useState', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should use useState for row selection
      expect(content).toMatch(/useState.*rowSelection|rowSelection.*useState|RowSelectionState/)
    })

    it('provides selectedRows in return value', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should return selectedRows array
      expect(content).toMatch(/selectedRows/)
    })

    it('derives selectedRows from table selection model', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should get selected rows from table
      expect(content).toMatch(/getSelectedRowModel|selectedRows/)
    })
  })

  // ============================================================================
  // Bulk Actions Tests
  // ============================================================================

  describe('bulk actions', () => {
    it('provides deleteSelected function in return value', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toMatch(/deleteSelected/)
    })

    it('deleteSelected calls collection.delete for each selected row', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should iterate over selected rows and call delete
      expect(content).toMatch(/deleteSelected[\s\S]*collection\.delete|Promise\.all[\s\S]*delete/)
    })

    it('deleteSelected clears selection after deletion', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should reset selection state after delete
      expect(content).toMatch(/deleteSelected[\s\S]*setRowSelection[\s\S]*\{\}|setRowSelection\(\{\}\)/)
    })
  })

  // ============================================================================
  // Type Safety Tests
  // ============================================================================

  describe('type safety', () => {
    it('uses generic type parameter for row data', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should have generic type parameter
      expect(content).toMatch(/useSyncTable<T|function useSyncTable<|const useSyncTable.*=.*</)
    })

    it('constrains generic type to have $id property', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      // Should constrain T to have $id
      expect(content).toMatch(/extends\s*\{\s*\$id:\s*string\s*\}|T\s+extends/)
    })

    it('imports ColumnDef type from @tanstack/react-table', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toContain('ColumnDef')
    })
  })

  // ============================================================================
  // Default Values Tests
  // ============================================================================

  describe('default values', () => {
    it('enableSorting defaults to true', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toMatch(/enableSorting\s*=\s*true/)
    })

    it('enableFiltering defaults to true', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toMatch(/enableFiltering\s*=\s*true/)
    })

    it('enablePagination defaults to true', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toMatch(/enablePagination\s*=\s*true/)
    })

    it('enableRowSelection defaults to false', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toMatch(/enableRowSelection\s*=\s*false/)
    })

    it('pageSize defaults to 10', async () => {
      const content = await readFile(HOOK_PATH, 'utf-8')
      expect(content).toMatch(/pageSize\s*=\s*10/)
    })
  })
})
