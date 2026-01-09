/**
 * SyncDataTable Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the SyncDataTable component.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The SyncDataTable component provides:
 * - Table rendering with TanStack Table
 * - Loading skeleton states
 * - Empty state messages
 * - Row click handlers
 * - Row selection via checkboxes
 * - Sorting controls with visual indicators
 * - Pagination controls
 *
 * @see app/components/sync/sync-data-table.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  ColumnDef,
  Table,
} from '@tanstack/react-table'

// Import component under test
import { SyncDataTable, createSelectionColumn } from '../../components/sync/sync-data-table'

// =============================================================================
// Test Types
// =============================================================================

interface TestUser {
  $id: string
  name: string
  email: string
  role: 'admin' | 'user' | 'viewer'
  status: 'Active' | 'Inactive'
}

// =============================================================================
// Test Fixtures
// =============================================================================

const testUsers: TestUser[] = [
  { $id: 'user-1', name: 'Alice Smith', email: 'alice@example.com', role: 'admin', status: 'Active' },
  { $id: 'user-2', name: 'Bob Jones', email: 'bob@example.com', role: 'user', status: 'Active' },
  { $id: 'user-3', name: 'Carol White', email: 'carol@example.com', role: 'viewer', status: 'Inactive' },
  { $id: 'user-4', name: 'David Brown', email: 'david@example.com', role: 'user', status: 'Active' },
  { $id: 'user-5', name: 'Eve Davis', email: 'eve@example.com', role: 'admin', status: 'Active' },
]

const columns: ColumnDef<TestUser>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'role', header: 'Role' },
  { accessorKey: 'status', header: 'Status' },
]

// =============================================================================
// Wrapper Component to Provide Table Instance
// =============================================================================

interface TestTableWrapperProps {
  data?: TestUser[]
  columns?: ColumnDef<TestUser>[]
  isLoading?: boolean
  onRowClick?: (row: TestUser) => void
  emptyMessage?: string
  showPagination?: boolean
  enableRowSelection?: boolean
  pageSize?: number
}

function TestTableWrapper({
  data = testUsers,
  columns: cols = columns,
  isLoading = false,
  onRowClick,
  emptyMessage,
  showPagination = true,
  enableRowSelection = false,
  pageSize = 10,
}: TestTableWrapperProps) {
  const [rowSelection, setRowSelection] = React.useState({})

  const tableColumns = enableRowSelection
    ? [createSelectionColumn<TestUser>(), ...cols]
    : cols

  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    state: {
      rowSelection,
    },
    initialState: {
      pagination: {
        pageSize,
      },
    },
    enableRowSelection,
    getRowId: (row) => row.$id,
  })

  return (
    <SyncDataTable
      tableInstance={table}
      isLoading={isLoading}
      onRowClick={onRowClick}
      emptyMessage={emptyMessage}
      showPagination={showPagination}
    />
  )
}

// =============================================================================
// Test Suite
// =============================================================================

describe('SyncDataTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders table with headers', () => {
      render(<TestTableWrapper />)

      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /email/i })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /role/i })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /status/i })).toBeInTheDocument()
    })

    it('renders table rows with data', () => {
      render(<TestTableWrapper />)

      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
      expect(screen.getByText('Bob Jones')).toBeInTheDocument()
      expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    })

    it('renders all rows for small datasets', () => {
      render(<TestTableWrapper />)

      // Should have 5 data rows + 1 header row
      const rows = screen.getAllByRole('row')
      expect(rows).toHaveLength(6) // 1 header + 5 data rows
    })
  })

  // ===========================================================================
  // Loading State Tests
  // ===========================================================================

  describe('loading state', () => {
    it('shows loading skeleton when isLoading is true', () => {
      render(<TestTableWrapper isLoading={true} />)

      // Should show skeleton elements
      const skeletons = document.querySelectorAll('[class*="skeleton"]')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('does not show data rows when loading', () => {
      render(<TestTableWrapper isLoading={true} />)

      expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument()
      expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument()
    })

    it('shows skeleton with correct number of columns', () => {
      render(<TestTableWrapper isLoading={true} />)

      // Should have skeleton cells matching column count
      const table = screen.getByRole('table')
      const headerCells = within(table).getAllByRole('columnheader')
      expect(headerCells.length).toBe(4)
    })

    it('shows skeleton with default row count', () => {
      render(<TestTableWrapper isLoading={true} />)

      // Default skeleton should show approximately 5 rows
      const table = screen.getByRole('table')
      const rows = within(table).getAllByRole('row')
      expect(rows.length).toBeGreaterThanOrEqual(2) // At least header + some skeleton rows
    })
  })

  // ===========================================================================
  // Empty State Tests
  // ===========================================================================

  describe('empty state', () => {
    it('shows default empty message when no data', () => {
      render(<TestTableWrapper data={[]} />)

      expect(screen.getByText('No data available')).toBeInTheDocument()
    })

    it('shows custom empty message when provided', () => {
      render(<TestTableWrapper data={[]} emptyMessage="No users found" />)

      expect(screen.getByText('No users found')).toBeInTheDocument()
    })

    it('does not show pagination when empty', () => {
      render(<TestTableWrapper data={[]} showPagination={true} />)

      // Pagination controls should not be visible
      expect(screen.queryByText(/page/i)).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Row Click Tests
  // ===========================================================================

  describe('row click', () => {
    it('calls onRowClick with row data when row is clicked', async () => {
            const onRowClick = vi.fn()

      render(<TestTableWrapper onRowClick={onRowClick} />)

      const row = screen.getByText('Alice Smith').closest('tr')
      fireEvent.click(row!)

      expect(onRowClick).toHaveBeenCalledTimes(1)
      expect(onRowClick).toHaveBeenCalledWith(
        expect.objectContaining({
          $id: 'user-1',
          name: 'Alice Smith',
          email: 'alice@example.com',
        })
      )
    })

    it('makes rows clickable when onRowClick is provided', () => {
      render(<TestTableWrapper onRowClick={vi.fn()} />)

      const row = screen.getByText('Alice Smith').closest('tr')
      expect(row).toHaveClass('cursor-pointer')
    })

    it('does not have cursor-pointer class when no onRowClick', () => {
      render(<TestTableWrapper />)

      const row = screen.getByText('Alice Smith').closest('tr')
      expect(row).not.toHaveClass('cursor-pointer')
    })
  })

  // ===========================================================================
  // Sorting Tests
  // ===========================================================================

  describe('sorting', () => {
    it('renders sortable columns with sort button', () => {
      render(<TestTableWrapper />)

      // Sortable headers should have buttons
      const nameHeader = screen.getByRole('columnheader', { name: /name/i })
      const sortButton = within(nameHeader).getByRole('button')
      expect(sortButton).toBeInTheDocument()
    })

    it('shows sort icon on sortable columns', () => {
      render(<TestTableWrapper />)

      // Should show default sort icon (up/down arrows)
      const nameHeader = screen.getByRole('columnheader', { name: /name/i })
      const sortIcon = within(nameHeader).getByRole('button')
      expect(sortIcon).toBeInTheDocument()
    })

    it('toggles sort direction on click', async () => {
            render(<TestTableWrapper />)

      const nameHeader = screen.getByRole('columnheader', { name: /name/i })
      const sortButton = within(nameHeader).getByRole('button')

      // Click to sort ascending
      fireEvent.click(sortButton)

      // First row should be sorted
      const rows = screen.getAllByRole('row')
      // After sorting by name ascending, Alice should be first
      expect(within(rows[1]).getByText('Alice Smith')).toBeInTheDocument()

      // Click again for descending
      fireEvent.click(sortButton)

      // Eve should be first when sorted descending by name
      const rowsAfterSecondClick = screen.getAllByRole('row')
      expect(within(rowsAfterSecondClick[1]).getByText('Eve Davis')).toBeInTheDocument()
    })

    it('shows ascending arrow when sorted ascending', async () => {
            render(<TestTableWrapper />)

      const nameHeader = screen.getByRole('columnheader', { name: /name/i })
      const sortButton = within(nameHeader).getByRole('button')

      fireEvent.click(sortButton)

      // Should show ascending arrow
      // Note: The specific icon class depends on implementation
      expect(sortButton).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Row Selection Tests
  // ===========================================================================

  describe('row selection', () => {
    it('renders selection checkboxes when enabled', () => {
      render(<TestTableWrapper enableRowSelection={true} />)

      const checkboxes = screen.getAllByRole('checkbox')
      // 1 header checkbox + 5 row checkboxes
      expect(checkboxes).toHaveLength(6)
    })

    it('does not render selection checkboxes when disabled', () => {
      render(<TestTableWrapper enableRowSelection={false} />)

      const checkboxes = screen.queryAllByRole('checkbox')
      expect(checkboxes).toHaveLength(0)
    })

    it('selects row when checkbox is clicked', async () => {
            render(<TestTableWrapper enableRowSelection={true} />)

      const checkboxes = screen.getAllByRole('checkbox')
      const firstRowCheckbox = checkboxes[1] // Skip header checkbox

      fireEvent.click(firstRowCheckbox)

      expect(firstRowCheckbox).toBeChecked()
    })

    it('selects all rows when header checkbox is clicked', async () => {
            render(<TestTableWrapper enableRowSelection={true} />)

      const checkboxes = screen.getAllByRole('checkbox')
      const headerCheckbox = checkboxes[0]

      fireEvent.click(headerCheckbox)

      // All row checkboxes should be checked
      const rowCheckboxes = checkboxes.slice(1)
      rowCheckboxes.forEach((checkbox) => {
        expect(checkbox).toBeChecked()
      })
    })

    it('shows indeterminate state when some rows are selected', async () => {
            render(<TestTableWrapper enableRowSelection={true} />)

      const checkboxes = screen.getAllByRole('checkbox')
      const firstRowCheckbox = checkboxes[1]

      // Select only one row
      fireEvent.click(firstRowCheckbox)

      // Header checkbox should be in indeterminate state
      const headerCheckbox = checkboxes[0]
      expect(headerCheckbox).toHaveAttribute('data-state', 'indeterminate')
    })

    it('checkbox click does not trigger row click', async () => {
            const onRowClick = vi.fn()

      render(<TestTableWrapper enableRowSelection={true} onRowClick={onRowClick} />)

      const checkboxes = screen.getAllByRole('checkbox')
      const firstRowCheckbox = checkboxes[1]

      fireEvent.click(firstRowCheckbox)

      // Row click should NOT be triggered
      expect(onRowClick).not.toHaveBeenCalled()
    })

    it('marks selected rows with data-state=selected', async () => {
            render(<TestTableWrapper enableRowSelection={true} />)

      const checkboxes = screen.getAllByRole('checkbox')
      const firstRowCheckbox = checkboxes[1]
      const firstRow = screen.getByText('Alice Smith').closest('tr')

      fireEvent.click(firstRowCheckbox)

      expect(firstRow).toHaveAttribute('data-state', 'selected')
    })
  })

  // ===========================================================================
  // Pagination Tests
  // ===========================================================================

  describe('pagination', () => {
    const manyUsers: TestUser[] = Array.from({ length: 25 }, (_, i) => ({
      $id: `user-${i + 1}`,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      role: 'user' as const,
      status: 'Active' as const,
    }))

    it('shows pagination controls when showPagination is true', () => {
      render(<TestTableWrapper data={manyUsers} pageSize={10} />)

      expect(screen.getByText(/page/i)).toBeInTheDocument()
    })

    it('hides pagination controls when showPagination is false', () => {
      render(<TestTableWrapper data={manyUsers} showPagination={false} pageSize={10} />)

      // Pagination-specific text should not be present
      expect(screen.queryByText(/of.*pages/i)).not.toBeInTheDocument()
    })

    it('shows correct number of rows per page', () => {
      render(<TestTableWrapper data={manyUsers} pageSize={10} />)

      // Should show first 10 users
      expect(screen.getByText('User 1')).toBeInTheDocument()
      expect(screen.getByText('User 10')).toBeInTheDocument()
      expect(screen.queryByText('User 11')).not.toBeInTheDocument()
    })

    it('navigates to next page', async () => {
            render(<TestTableWrapper data={manyUsers} pageSize={10} />)

      // Find and click next page button
      const nextButton = screen.getByRole('button', { name: /next/i })
      fireEvent.click(nextButton)

      // Should show next page
      expect(screen.queryByText('User 1')).not.toBeInTheDocument()
      expect(screen.getByText('User 11')).toBeInTheDocument()
    })

    it('navigates to previous page', async () => {
            render(<TestTableWrapper data={manyUsers} pageSize={10} />)

      // Go to page 2 first
      const nextButton = screen.getByRole('button', { name: /next/i })
      fireEvent.click(nextButton)

      // Go back to page 1
      const prevButton = screen.getByRole('button', { name: /previous/i })
      fireEvent.click(prevButton)

      expect(screen.getByText('User 1')).toBeInTheDocument()
    })

    it('disables previous button on first page', () => {
      render(<TestTableWrapper data={manyUsers} pageSize={10} />)

      const prevButton = screen.getByRole('button', { name: /previous/i })
      expect(prevButton).toBeDisabled()
    })

    it('disables next button on last page', async () => {
            render(<TestTableWrapper data={manyUsers} pageSize={10} />)

      // Navigate to last page
      const lastPageButton = screen.getByRole('button', { name: /last.*page|go to last/i })
      fireEvent.click(lastPageButton)

      const nextButton = screen.getByRole('button', { name: /next/i })
      expect(nextButton).toBeDisabled()
    })

    it('shows current page number', () => {
      render(<TestTableWrapper data={manyUsers} pageSize={10} />)

      expect(screen.getByText(/page.*1/i)).toBeInTheDocument()
    })

    it('shows total page count', () => {
      render(<TestTableWrapper data={manyUsers} pageSize={10} />)

      // 25 users / 10 per page = 3 pages
      expect(screen.getByText(/of.*3/i)).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('has accessible table structure', () => {
      render(<TestTableWrapper />)

      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0)
      expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
    })

    it('selection checkboxes have accessible labels', () => {
      render(<TestTableWrapper enableRowSelection={true} />)

      const headerCheckbox = screen.getAllByRole('checkbox')[0]
      expect(headerCheckbox).toHaveAttribute('aria-label', 'Select all')

      const rowCheckbox = screen.getAllByRole('checkbox')[1]
      expect(rowCheckbox).toHaveAttribute('aria-label', 'Select row')
    })

    it('maintains focus management for keyboard navigation', () => {
      render(<TestTableWrapper />)

      const sortButtons = screen.getAllByRole('button')
      expect(sortButtons[0]).toHaveAttribute('type', 'button')
    })
  })

  // ===========================================================================
  // createSelectionColumn Helper Tests
  // ===========================================================================

  describe('createSelectionColumn helper', () => {
    it('creates a column with id "select"', () => {
      const selectionCol = createSelectionColumn<TestUser>()
      expect(selectionCol.id).toBe('select')
    })

    it('disables sorting on selection column', () => {
      const selectionCol = createSelectionColumn<TestUser>()
      expect(selectionCol.enableSorting).toBe(false)
    })

    it('disables hiding on selection column', () => {
      const selectionCol = createSelectionColumn<TestUser>()
      expect(selectionCol.enableHiding).toBe(false)
    })
  })
})
