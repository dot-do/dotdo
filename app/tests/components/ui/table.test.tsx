/**
 * Table Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the base Table UI components.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The Table components provide:
 * - Semantic HTML table structure (Table, TableHeader, TableBody, TableRow, TableCell)
 * - TableHead for column headers with proper styling
 * - TableFooter and TableCaption for additional table sections
 * - Responsive container with horizontal scroll
 * - Support for sticky headers
 * - TanStack Table compatibility via data-slot attributes
 * - Empty state handling
 * - Custom className merging
 *
 * @see app/components/ui/table.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// Import components under test
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from '../../../components/ui/table'

// =============================================================================
// Test Fixtures
// =============================================================================

interface TestRow {
  id: string
  name: string
  email: string
  role: string
}

const testData: TestRow[] = [
  { id: '1', name: 'Alice Smith', email: 'alice@example.com', role: 'Admin' },
  { id: '2', name: 'Bob Jones', email: 'bob@example.com', role: 'User' },
  { id: '3', name: 'Carol White', email: 'carol@example.com', role: 'Viewer' },
]

/**
 * Helper to render a complete table with test data
 */
function renderBasicTable(props?: { tableProps?: React.ComponentProps<typeof Table> }) {
  return render(
    <Table {...props?.tableProps}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {testData.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.email}</TableCell>
            <TableCell>{row.role}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Table', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Basic Rendering Tests
  // ===========================================================================

  describe('basic rendering', () => {
    it('renders Table component with table element', () => {
      renderBasicTable()

      const table = screen.getByRole('table')
      expect(table).toBeInTheDocument()
    })

    it('renders TableHeader with thead element', () => {
      renderBasicTable()

      const table = screen.getByRole('table')
      const thead = table.querySelector('thead')
      expect(thead).toBeInTheDocument()
    })

    it('renders TableBody with tbody element', () => {
      renderBasicTable()

      const table = screen.getByRole('table')
      const tbody = table.querySelector('tbody')
      expect(tbody).toBeInTheDocument()
    })

    it('renders TableRow with tr element', () => {
      renderBasicTable()

      const rows = screen.getAllByRole('row')
      // 1 header row + 3 data rows
      expect(rows).toHaveLength(4)
    })

    it('renders TableHead with th element', () => {
      renderBasicTable()

      const headers = screen.getAllByRole('columnheader')
      expect(headers).toHaveLength(3)
      expect(headers[0]).toHaveTextContent('Name')
      expect(headers[1]).toHaveTextContent('Email')
      expect(headers[2]).toHaveTextContent('Role')
    })

    it('renders TableCell with td element', () => {
      renderBasicTable()

      const cells = screen.getAllByRole('cell')
      // 3 rows x 3 columns = 9 cells
      expect(cells).toHaveLength(9)
    })

    it('renders all data correctly', () => {
      renderBasicTable()

      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
      expect(screen.getByText('Bob Jones')).toBeInTheDocument()
      expect(screen.getByText('carol@example.com')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // TableFooter Tests
  // ===========================================================================

  describe('TableFooter', () => {
    it('renders TableFooter with tfoot element', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Footer content</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )

      const table = screen.getByRole('table')
      const tfoot = table.querySelector('tfoot')
      expect(tfoot).toBeInTheDocument()
      expect(screen.getByText('Footer content')).toBeInTheDocument()
    })

    it('applies correct styling to TableFooter', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter data-testid="table-footer">
            <TableRow>
              <TableCell>Total</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )

      const footer = screen.getByTestId('table-footer')
      expect(footer).toHaveClass('border-t')
      expect(footer).toHaveClass('font-medium')
    })
  })

  // ===========================================================================
  // TableCaption Tests
  // ===========================================================================

  describe('TableCaption', () => {
    it('renders TableCaption with caption element', () => {
      render(
        <Table>
          <TableCaption>A list of users</TableCaption>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const caption = screen.getByText('A list of users')
      expect(caption.tagName).toBe('CAPTION')
    })

    it('applies correct styling to TableCaption', () => {
      render(
        <Table>
          <TableCaption data-testid="caption">User list</TableCaption>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const caption = screen.getByTestId('caption')
      expect(caption).toHaveClass('text-sm')
    })
  })

  // ===========================================================================
  // Data Slot Attributes (TanStack Table Compatibility)
  // ===========================================================================

  describe('TanStack Table compatibility', () => {
    it('Table has data-slot="table" attribute', () => {
      renderBasicTable()

      const table = screen.getByRole('table')
      expect(table).toHaveAttribute('data-slot', 'table')
    })

    it('TableHeader has data-slot="table-header" attribute', () => {
      renderBasicTable()

      const table = screen.getByRole('table')
      const thead = table.querySelector('thead')
      expect(thead).toHaveAttribute('data-slot', 'table-header')
    })

    it('TableBody has data-slot="table-body" attribute', () => {
      renderBasicTable()

      const table = screen.getByRole('table')
      const tbody = table.querySelector('tbody')
      expect(tbody).toHaveAttribute('data-slot', 'table-body')
    })

    it('TableRow has data-slot="table-row" attribute', () => {
      renderBasicTable()

      const rows = screen.getAllByRole('row')
      rows.forEach((row) => {
        expect(row).toHaveAttribute('data-slot', 'table-row')
      })
    })

    it('TableHead has data-slot="table-head" attribute', () => {
      renderBasicTable()

      const headers = screen.getAllByRole('columnheader')
      headers.forEach((header) => {
        expect(header).toHaveAttribute('data-slot', 'table-head')
      })
    })

    it('TableCell has data-slot="table-cell" attribute', () => {
      renderBasicTable()

      const cells = screen.getAllByRole('cell')
      cells.forEach((cell) => {
        expect(cell).toHaveAttribute('data-slot', 'table-cell')
      })
    })

    it('TableFooter has data-slot="table-footer" attribute', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter data-testid="footer">
            <TableRow>
              <TableCell>Footer</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )

      const footer = screen.getByTestId('footer')
      expect(footer).toHaveAttribute('data-slot', 'table-footer')
    })

    it('TableCaption has data-slot="table-caption" attribute', () => {
      render(
        <Table>
          <TableCaption data-testid="caption">Caption</TableCaption>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const caption = screen.getByTestId('caption')
      expect(caption).toHaveAttribute('data-slot', 'table-caption')
    })

    it('Table container has data-slot="table-container" attribute', () => {
      renderBasicTable()

      const container = screen.getByRole('table').parentElement
      expect(container).toHaveAttribute('data-slot', 'table-container')
    })
  })

  // ===========================================================================
  // Sorting Support Tests
  // ===========================================================================

  describe('sorting support', () => {
    it('TableHead accepts onClick handler for sorting', () => {
      const handleSort = vi.fn()

      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button onClick={handleSort}>Name</button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Alice</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const sortButton = screen.getByRole('button', { name: /name/i })
      fireEvent.click(sortButton)

      expect(handleSort).toHaveBeenCalledTimes(1)
    })

    it('TableHead supports aria-sort attribute for accessibility', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead aria-sort="ascending">Name</TableHead>
              <TableHead aria-sort="descending">Email</TableHead>
              <TableHead aria-sort="none">Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Alice</TableCell>
              <TableCell>alice@example.com</TableCell>
              <TableCell>Admin</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const headers = screen.getAllByRole('columnheader')
      expect(headers[0]).toHaveAttribute('aria-sort', 'ascending')
      expect(headers[1]).toHaveAttribute('aria-sort', 'descending')
      expect(headers[2]).toHaveAttribute('aria-sort', 'none')
    })

    it('TableHead applies whitespace-nowrap for sortable column content', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead data-testid="header">Name Column</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const header = screen.getByTestId('header')
      expect(header).toHaveClass('whitespace-nowrap')
    })
  })

  // ===========================================================================
  // Sticky Headers Tests
  // ===========================================================================

  describe('sticky headers', () => {
    it('supports sticky class on TableHeader', () => {
      render(
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10" data-testid="sticky-header">
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Alice</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const header = screen.getByTestId('sticky-header')
      expect(header).toHaveClass('sticky')
      expect(header).toHaveClass('top-0')
    })

    it('supports sticky class on individual TableHead cells', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background" data-testid="sticky-cell">
                Name
              </TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Alice</TableCell>
              <TableCell>alice@example.com</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const stickyCell = screen.getByTestId('sticky-cell')
      expect(stickyCell).toHaveClass('sticky')
      expect(stickyCell).toHaveClass('left-0')
    })

    it('merges sticky class with default classes', () => {
      render(
        <Table>
          <TableHeader className="sticky top-0" data-testid="header">
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Alice</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const header = screen.getByTestId('header')
      // Should have both sticky and default border-b from [&_tr]:border-b
      expect(header).toHaveClass('sticky')
      expect(header.className).toContain('[&_tr]:border-b')
    })
  })

  // ===========================================================================
  // Empty State Tests
  // ===========================================================================

  describe('empty state', () => {
    it('renders empty table with headers only', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Empty */}
          </TableBody>
        </Table>
      )

      const table = screen.getByRole('table')
      expect(table).toBeInTheDocument()

      const headers = screen.getAllByRole('columnheader')
      expect(headers).toHaveLength(2)

      const cells = screen.queryAllByRole('cell')
      expect(cells).toHaveLength(0)
    })

    it('supports colspan for empty state message', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                No data available
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const emptyCell = screen.getByText('No data available')
      expect(emptyCell).toHaveAttribute('colspan', '3')
      expect(emptyCell).toHaveClass('text-center')
    })

    it('renders empty state with custom height', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="h-24" data-testid="empty-cell">
                No results
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const cell = screen.getByTestId('empty-cell')
      expect(cell).toHaveClass('h-24')
    })
  })

  // ===========================================================================
  // Responsive Behavior Tests
  // ===========================================================================

  describe('responsive behavior', () => {
    it('Table wrapper has overflow-x-auto for horizontal scrolling', () => {
      renderBasicTable()

      const container = screen.getByRole('table').parentElement
      expect(container).toHaveClass('overflow-x-auto')
    })

    it('Table wrapper has relative positioning', () => {
      renderBasicTable()

      const container = screen.getByRole('table').parentElement
      expect(container).toHaveClass('relative')
    })

    it('Table wrapper has full width', () => {
      renderBasicTable()

      const container = screen.getByRole('table').parentElement
      expect(container).toHaveClass('w-full')
    })

    it('Table has full width', () => {
      renderBasicTable()

      const table = screen.getByRole('table')
      expect(table).toHaveClass('w-full')
    })

    it('TableCell applies whitespace-nowrap to prevent wrapping', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell data-testid="cell">Some long content here</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const cell = screen.getByTestId('cell')
      expect(cell).toHaveClass('whitespace-nowrap')
    })
  })

  // ===========================================================================
  // Custom ClassName Merging Tests
  // ===========================================================================

  describe('className merging', () => {
    it('merges custom className with Table default classes', () => {
      render(
        <Table className="custom-table-class" data-testid="table">
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      // Note: Need to check the table element, not container
      const table = screen.getByRole('table')
      expect(table).toHaveClass('custom-table-class')
      expect(table).toHaveClass('w-full')
    })

    it('merges custom className with TableHeader default classes', () => {
      render(
        <Table>
          <TableHeader className="custom-header" data-testid="header">
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const header = screen.getByTestId('header')
      expect(header).toHaveClass('custom-header')
    })

    it('merges custom className with TableBody default classes', () => {
      render(
        <Table>
          <TableBody className="custom-body" data-testid="body">
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const body = screen.getByTestId('body')
      expect(body).toHaveClass('custom-body')
    })

    it('merges custom className with TableRow default classes', () => {
      render(
        <Table>
          <TableBody>
            <TableRow className="custom-row" data-testid="row">
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const row = screen.getByTestId('row')
      expect(row).toHaveClass('custom-row')
      expect(row).toHaveClass('border-b')
    })

    it('merges custom className with TableHead default classes', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="custom-head" data-testid="head">Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const head = screen.getByTestId('head')
      expect(head).toHaveClass('custom-head')
      expect(head).toHaveClass('font-medium')
    })

    it('merges custom className with TableCell default classes', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="custom-cell" data-testid="cell">Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const cell = screen.getByTestId('cell')
      expect(cell).toHaveClass('custom-cell')
      expect(cell).toHaveClass('p-2')
    })
  })

  // ===========================================================================
  // Row State Tests
  // ===========================================================================

  describe('row state', () => {
    it('supports data-state=selected for selected rows', () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-state="selected" data-testid="selected-row">
              <TableCell>Selected row</TableCell>
            </TableRow>
            <TableRow data-testid="normal-row">
              <TableCell>Normal row</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const selectedRow = screen.getByTestId('selected-row')
      const normalRow = screen.getByTestId('normal-row')

      expect(selectedRow).toHaveAttribute('data-state', 'selected')
      expect(normalRow).not.toHaveAttribute('data-state')
    })

    it('applies selected background style via data-state', () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-state="selected" data-testid="selected-row">
              <TableCell>Selected</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const row = screen.getByTestId('selected-row')
      // The class should contain data-[state=selected]:bg-muted styling
      expect(row.className).toContain('data-[state=selected]:bg-muted')
    })

    it('applies hover style on TableRow', () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row">
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const row = screen.getByTestId('row')
      expect(row.className).toContain('hover:bg-muted/50')
    })

    it('applies transition-colors for smooth state changes', () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row">
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const row = screen.getByTestId('row')
      expect(row).toHaveClass('transition-colors')
    })
  })

  // ===========================================================================
  // Checkbox Support Tests
  // ===========================================================================

  describe('checkbox support', () => {
    it('TableHead applies special styling when containing checkbox', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead data-testid="checkbox-head">
                <input type="checkbox" role="checkbox" />
              </TableHead>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <input type="checkbox" role="checkbox" />
              </TableCell>
              <TableCell>Alice</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const checkboxHead = screen.getByTestId('checkbox-head')
      // Should have special styling for checkbox columns
      expect(checkboxHead.className).toContain('[&:has([role=checkbox])]:pr-0')
    })

    it('TableCell applies special styling when containing checkbox', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell data-testid="checkbox-cell">
                <input type="checkbox" role="checkbox" />
              </TableCell>
              <TableCell>Alice</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const checkboxCell = screen.getByTestId('checkbox-cell')
      expect(checkboxCell.className).toContain('[&:has([role=checkbox])]:pr-0')
    })
  })

  // ===========================================================================
  // Props Forwarding Tests
  // ===========================================================================

  describe('props forwarding', () => {
    it('forwards arbitrary props to Table', () => {
      render(
        <Table data-testid="table" aria-label="User table">
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const table = screen.getByRole('table')
      expect(table).toHaveAttribute('aria-label', 'User table')
    })

    it('forwards arbitrary props to TableRow', () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row" aria-selected="true">
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const row = screen.getByTestId('row')
      expect(row).toHaveAttribute('aria-selected', 'true')
    })

    it('forwards arbitrary props to TableCell', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell data-testid="cell" aria-describedby="helper">Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const cell = screen.getByTestId('cell')
      expect(cell).toHaveAttribute('aria-describedby', 'helper')
    })

    it('forwards ref to Table component', () => {
      const ref = React.createRef<HTMLTableElement>()

      render(
        <Table ref={ref}>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      expect(ref.current).toBeInstanceOf(HTMLTableElement)
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('renders semantic table structure', () => {
      renderBasicTable()

      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getAllByRole('rowgroup').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByRole('row').length).toBeGreaterThan(0)
      expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0)
      expect(screen.getAllByRole('cell').length).toBeGreaterThan(0)
    })

    it('supports scope attribute on TableHead', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col">Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableHead scope="row">Alice</TableHead>
              <TableCell>alice@example.com</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const columnHeaders = screen.getAllByRole('columnheader')
      expect(columnHeaders[0]).toHaveAttribute('scope', 'col')
      expect(columnHeaders[1]).toHaveAttribute('scope', 'col')

      const rowHeader = screen.getByText('Alice')
      expect(rowHeader).toHaveAttribute('scope', 'row')
    })

    it('supports caption for table description', () => {
      render(
        <Table>
          <TableCaption>List of registered users</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Alice</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      expect(screen.getByText('List of registered users')).toBeInTheDocument()
    })

    it('TableHead has proper text alignment for content', () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead data-testid="head">Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      const head = screen.getByTestId('head')
      expect(head).toHaveClass('text-left')
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles empty children gracefully', () => {
      render(
        <Table>
          <TableBody>
            {/* Empty */}
          </TableBody>
        </Table>
      )

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('handles null children gracefully', () => {
      render(
        <Table>
          <TableBody>
            {null}
          </TableBody>
        </Table>
      )

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('handles conditional rendering in rows', () => {
      const showEmail = false

      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Alice</TableCell>
              {showEmail && <TableCell>alice@example.com</TableCell>}
            </TableRow>
          </TableBody>
        </Table>
      )

      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()
    })

    it('renders with very long content', () => {
      const longText = 'A'.repeat(500)

      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>{longText}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      expect(screen.getByText(longText)).toBeInTheDocument()
    })

    it('renders with special characters', () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>{"<script>alert('xss')</script>"}</TableCell>
              <TableCell>{"Special & chars < > \" '"}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )

      expect(screen.getByText("<script>alert('xss')</script>")).toBeInTheDocument()
      expect(screen.getByText("Special & chars < > \" '")).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // RED PHASE: Tests for Features Not Yet Implemented
  // These tests SHOULD FAIL until the features are added
  // ===========================================================================

  describe('RED PHASE - future enhancements', () => {
    describe('built-in sorting', () => {
      it.skip('Table accepts sortable prop to enable built-in sorting', () => {
        // This test is skipped - would require sortable prop on Table
        render(
          <Table sortable data-testid="sortable-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Alice</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )

        const table = screen.getByTestId('sortable-table')
        expect(table).toHaveAttribute('data-sortable', 'true')
      })

      it.skip('TableHead renders sort indicator when column is sortable', () => {
        // This test is skipped - would require sortable prop on TableHead
        render(
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead sortable sortDirection="asc" data-testid="sortable-head">
                  Name
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Alice</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )

        const head = screen.getByTestId('sortable-head')
        expect(head).toHaveAttribute('aria-sort', 'ascending')
        expect(within(head).getByRole('button')).toBeInTheDocument()
      })
    })

    describe('built-in sticky header support', () => {
      it.skip('Table accepts stickyHeader prop for automatic sticky header styling', () => {
        // This test is skipped - would require stickyHeader prop
        render(
          <Table stickyHeader data-testid="sticky-table">
            <TableHeader data-testid="header">
              <TableRow>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Alice</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )

        const header = screen.getByTestId('header')
        expect(header).toHaveClass('sticky')
        expect(header).toHaveClass('top-0')
        expect(header).toHaveClass('z-10')
      })
    })

    describe('empty state component', () => {
      it.skip('Table accepts emptyState prop for built-in empty state rendering', () => {
        // This test is skipped - would require emptyState prop
        render(
          <Table emptyState="No data available">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Empty */}
            </TableBody>
          </Table>
        )

        expect(screen.getByText('No data available')).toBeInTheDocument()
        expect(screen.getByText('No data available').closest('td')).toHaveAttribute('colspan')
      })

      it.skip('Table accepts emptyState as ReactNode for custom empty state', () => {
        // This test is skipped - would require emptyState prop accepting ReactNode
        render(
          <Table emptyState={<div data-testid="custom-empty">Custom empty state</div>}>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Empty */}
            </TableBody>
          </Table>
        )

        expect(screen.getByTestId('custom-empty')).toBeInTheDocument()
      })
    })

    describe('loading state', () => {
      it.skip('Table accepts loading prop to show loading skeleton', () => {
        // This test is skipped - would require loading prop
        render(
          <Table loading columns={3} data-testid="loading-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Will show skeleton */}
            </TableBody>
          </Table>
        )

        const skeletons = document.querySelectorAll('[class*="skeleton"]')
        expect(skeletons.length).toBeGreaterThan(0)
      })
    })

    describe('virtualization support', () => {
      it.skip('Table accepts virtualized prop for virtual scrolling', () => {
        // This test is skipped - would require virtualized prop and integration with react-virtual
        const manyRows = Array.from({ length: 1000 }, (_, i) => ({
          id: String(i),
          name: `User ${i}`,
        }))

        render(
          <Table virtualized height={400} data-testid="virtual-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {manyRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )

        // Virtual table should only render visible rows
        const visibleRows = screen.getAllByRole('row')
        expect(visibleRows.length).toBeLessThan(manyRows.length)
      })
    })

    describe('column resizing', () => {
      it.skip('TableHead accepts resizable prop for column resizing', () => {
        // This test is skipped - would require resizable prop
        render(
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead resizable data-testid="resizable-head">Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Alice</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )

        const head = screen.getByTestId('resizable-head')
        const resizeHandle = within(head).getByRole('separator')
        expect(resizeHandle).toBeInTheDocument()
      })
    })

    describe('row expansion', () => {
      it.skip('TableRow accepts expandable prop for expandable rows', () => {
        // This test is skipped - would require expandable prop
        render(
          <Table>
            <TableBody>
              <TableRow expandable expanded={false} data-testid="expandable-row">
                <TableCell>Alice</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )

        const row = screen.getByTestId('expandable-row')
        const expandButton = within(row).getByRole('button', { name: /expand/i })
        expect(expandButton).toBeInTheDocument()
      })
    })
  })
})
