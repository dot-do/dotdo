'use client'

/**
 * SyncDataTable - A reusable data table component for synced collections
 *
 * This component renders a data table using TanStack Table with support for:
 * - Sorting with visual indicators
 * - Pagination controls
 * - Loading skeleton state
 * - Empty state message
 * - Row click handlers
 * - Row selection via checkboxes
 *
 * @see app/lib/hooks/use-sync-table.ts for the table instance hook
 */

import * as React from 'react'
import { flexRender, Table } from '@tanstack/react-table'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table'
import { Skeleton } from '../ui/skeleton'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { DataTablePagination } from './data-table-pagination'

/**
 * Props for the SyncDataTable component
 */
export interface SyncDataTableProps<TData> {
  /** TanStack Table instance from useSyncTable hook */
  tableInstance: Table<TData>
  /** Whether data is currently loading */
  isLoading?: boolean
  /** Callback when a row is clicked */
  onRowClick?: (row: TData) => void
  /** Message to display when table is empty */
  emptyMessage?: string
  /** Whether to show pagination controls */
  showPagination?: boolean
}

/**
 * Loading skeleton for table
 */
function TableSkeleton({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <UITable>
      <TableHeader>
        <TableRow>
          {Array.from({ length: columns }).map((_, i) => (
            <TableHead key={i}>
              <Skeleton className="h-4 w-24" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <TableRow key={rowIndex}>
            {Array.from({ length: columns }).map((_, colIndex) => (
              <TableCell key={colIndex}>
                <Skeleton className="h-4 w-full" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </UITable>
  )
}

/**
 * SyncDataTable component
 *
 * A reusable data table component that integrates with useSyncTable hook
 * and provides sorting, pagination, loading states, and row interactions.
 *
 * @example
 * ```tsx
 * const { table, isLoading } = useSyncTable({ collection, columns })
 *
 * <SyncDataTable
 *   tableInstance={table}
 *   isLoading={isLoading}
 *   onRowClick={(row) => navigate(`/items/${row.$id}`)}
 *   emptyMessage="No items found"
 * />
 * ```
 */
export function SyncDataTable<TData>({
  tableInstance,
  isLoading = false,
  onRowClick,
  emptyMessage = 'No data available',
  showPagination = true,
}: SyncDataTableProps<TData>) {
  // Show loading skeleton while data is loading
  if (isLoading) {
    const columnCount = tableInstance.getAllColumns().length || 4
    return <TableSkeleton columns={columnCount} />
  }

  const rows = tableInstance.getRowModel().rows
  const hasData = rows.length > 0

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <UITable>
          <TableHeader>
            {tableInstance.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()

                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : canSort ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-3 h-8 data-[state=open]:bg-accent"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {sorted === 'asc' ? (
                            <ArrowUp className="ml-2 h-4 w-4" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="ml-2 h-4 w-4" />
                          ) : (
                            <ArrowUpDown className="ml-2 h-4 w-4" />
                          )}
                        </Button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {hasData ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  onClick={() => onRowClick?.(row.original)}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={tableInstance.getAllColumns().length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </UITable>
      </div>
      {showPagination && hasData && <DataTablePagination table={tableInstance} />}
    </div>
  )
}

/**
 * Helper to create a selection column for the table
 *
 * @example
 * ```tsx
 * const columns = [
 *   createSelectionColumn<User>(),
 *   { accessorKey: 'name', header: 'Name' },
 *   // ...
 * ]
 * ```
 */
export function createSelectionColumn<TData>() {
  return {
    id: 'select',
    header: ({ table }: { table: Table<TData> }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }: { row: { getIsSelected: () => boolean; toggleSelected: (value: boolean) => void } }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
        onClick={(e) => e.stopPropagation()}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  }
}
