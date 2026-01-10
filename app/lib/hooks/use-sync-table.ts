/**
 * useSyncTable Hook
 *
 * TanStack Table integration with useCollection for data tables with
 * sorting, filtering, pagination, and row selection.
 *
 * @module app/lib/hooks/use-sync-table
 *
 * @example Basic table
 * ```tsx
 * const columns = [
 *   { accessorKey: 'name', header: 'Name' },
 *   { accessorKey: 'email', header: 'Email' },
 * ]
 *
 * const { table, isLoading } = useSyncTable({
 *   collection: usersCollection,
 *   columns,
 * })
 *
 * return <DataTable table={table} />
 * ```
 *
 * @example With row selection and bulk delete
 * ```tsx
 * const { table, selectedRows, deleteSelected } = useSyncTable({
 *   collection: usersCollection,
 *   columns,
 *   enableRowSelection: true,
 * })
 *
 * return (
 *   <>
 *     <button onClick={deleteSelected} disabled={selectedRows.length === 0}>
 *       Delete {selectedRows.length} selected
 *     </button>
 *     <DataTable table={table} />
 *   </>
 * )
 * ```
 */

import { useState, useMemo, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  ColumnDef,
  Table,
  RowSelectionState,
} from '@tanstack/react-table'

// =============================================================================
// Types
// =============================================================================

/**
 * Collection interface expected from useCollection
 * @typeParam T - The item type
 * @internal
 */
interface Collection<T> {
  /** Current collection data */
  data: readonly T[]
  /** Loading state */
  isLoading: boolean
  /** Delete item by ID */
  delete: (id: string) => Promise<void>
}

/**
 * Options for the useSyncTable hook
 * @typeParam T - The row data type, must have $id field
 */
export interface UseSyncTableOptions<T extends { $id: string }> {
  /**
   * The collection providing data and delete functionality
   */
  collection: Collection<T>
  /**
   * TanStack Table column definitions
   */
  columns: ColumnDef<T>[]
  /**
   * Enable column sorting
   * @default true
   */
  enableSorting?: boolean
  /**
   * Enable column filtering
   * @default true
   */
  enableFiltering?: boolean
  /**
   * Enable client-side pagination
   * @default true
   */
  enablePagination?: boolean
  /**
   * Enable row selection checkboxes
   * @default false
   */
  enableRowSelection?: boolean
  /**
   * Number of rows per page
   * @default 10
   */
  pageSize?: number
}

/**
 * Return type for the useSyncTable hook
 * @typeParam T - The row data type
 */
export interface UseSyncTableReturn<T> {
  /**
   * TanStack Table instance
   * Use for rendering table UI
   */
  table: Table<T>
  /**
   * True while collection data is loading
   */
  readonly isLoading: boolean
  /**
   * Currently selected row data
   * Empty array when no rows selected
   */
  readonly selectedRows: readonly T[]
  /**
   * Delete all selected rows
   * Clears selection after deletion
   */
  deleteSelected: () => Promise<void>
}

/**
 * Hook that integrates TanStack Table with useCollection data
 *
 * Provides a fully-configured TanStack Table instance with:
 * - Automatic data binding from collection
 * - Optional sorting, filtering, and pagination
 * - Row selection with bulk delete support
 *
 * @typeParam T - The row data type, must have $id field
 * @param options - Configuration options for the table
 * @returns Table instance, loading state, selected rows, and bulk delete function
 */
export function useSyncTable<T extends { $id: string }>({
  collection,
  columns,
  enableSorting = true,
  enableFiltering = true,
  enablePagination = true,
  enableRowSelection = false,
  pageSize = 10,
}: UseSyncTableOptions<T>): UseSyncTableReturn<T> {
  // Row selection state - tracks which row IDs are selected
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  // Convert readonly array to mutable for TanStack Table compatibility
  const tableData = useMemo(
    () => (collection.data as T[]) ?? [],
    [collection.data]
  )

  // Create the table instance with conditional features
  const table = useReactTable({
    data: tableData,
    columns,
    getRowId: (row) => row.$id,
    getCoreRowModel: getCoreRowModel(),
    // Conditionally enable sorting
    ...(enableSorting && { getSortedRowModel: getSortedRowModel() }),
    // Conditionally enable filtering
    ...(enableFiltering && { getFilteredRowModel: getFilteredRowModel() }),
    // Conditionally enable pagination
    ...(enablePagination && { getPaginationRowModel: getPaginationRowModel() }),
    // Row selection configuration
    enableRowSelection,
    onRowSelectionChange: setRowSelection,
    state: {
      rowSelection,
    },
    initialState: {
      pagination: {
        pageSize,
      },
    },
  })

  // Derive selected rows from table selection model
  // Memoized to prevent unnecessary re-renders
  const selectedRows = useMemo(
    () => table.getSelectedRowModel().rows.map((row) => row.original),
    [table, rowSelection]
  )

  // Bulk delete function
  const deleteSelected = useCallback(async () => {
    const rows = table.getSelectedRowModel().rows
    await Promise.all(rows.map((row) => collection.delete(row.original.$id)))
    setRowSelection({})
  }, [table, collection])

  return {
    table,
    isLoading: collection.isLoading,
    selectedRows,
    deleteSelected,
  }
}
