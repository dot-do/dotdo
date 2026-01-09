/**
 * useSyncTable - TanStack Table integration with useDotdoCollection
 *
 * This hook wraps TanStack Table to provide seamless integration with
 * collection data, including sorting, filtering, pagination, and row selection.
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

/**
 * Collection interface expected from useDotdoCollection
 */
interface Collection<T> {
  data: T[]
  isLoading: boolean
  delete: (id: string) => Promise<void>
}

/**
 * Options for useSyncTable hook
 */
export interface UseSyncTableOptions<T extends { $id: string }> {
  collection: Collection<T>
  columns: ColumnDef<T>[]
  enableSorting?: boolean
  enableFiltering?: boolean
  enablePagination?: boolean
  enableRowSelection?: boolean
  pageSize?: number
}

/**
 * Return type for useSyncTable hook
 */
export interface UseSyncTableReturn<T> {
  table: Table<T>
  isLoading: boolean
  selectedRows: T[]
  deleteSelected: () => Promise<void>
}

/**
 * Hook that integrates TanStack Table with useDotdoCollection data
 *
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
  // Row selection state
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  // Create the table instance
  const table = useReactTable({
    data: collection.data ?? [],
    columns,
    getRowId: (row) => row.$id,
    getCoreRowModel: getCoreRowModel(),
    // Sorting
    ...(enableSorting && { getSortedRowModel: getSortedRowModel() }),
    // Filtering
    ...(enableFiltering && { getFilteredRowModel: getFilteredRowModel() }),
    // Pagination
    ...(enablePagination && { getPaginationRowModel: getPaginationRowModel() }),
    // Row selection
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
  const selectedRows = useMemo(() => {
    return table.getSelectedRowModel().rows.map((row) => row.original)
  }, [table, rowSelection])

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
