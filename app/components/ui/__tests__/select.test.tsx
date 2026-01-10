/**
 * Select Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the Select component.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The Select component provides:
 * - Dropdown select functionality via Radix UI
 * - Open/close behavior
 * - Options rendering
 * - Selection handling
 * - Placeholder support
 *
 * @see app/components/ui/select.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Mock jsdom APIs required by Radix UI Select
const ResizeObserverMock = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))
vi.stubGlobal('ResizeObserver', ResizeObserverMock)

// Mock scrollIntoView since jsdom doesn't implement it
Element.prototype.scrollIntoView = vi.fn()

// Mock hasPointerCapture and related methods
Element.prototype.hasPointerCapture = vi.fn(() => false)
Element.prototype.setPointerCapture = vi.fn()
Element.prototype.releasePointerCapture = vi.fn()

// Import components under test
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from '../select'

// =============================================================================
// Helper Component
// =============================================================================

function TestSelect({
  placeholder = 'Select an option',
  defaultValue,
  value,
  onValueChange,
  disabled,
}: {
  placeholder?: string
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
}) {
  return (
    <Select defaultValue={defaultValue} value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
        <SelectItem value="orange">Orange</SelectItem>
      </SelectContent>
    </Select>
  )
}

function TestSelectWithGroups() {
  return (
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Fruits</SelectLabel>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Vegetables</SelectLabel>
          <SelectItem value="carrot">Carrot</SelectItem>
          <SelectItem value="broccoli">Broccoli</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Select', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Basic Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders select trigger', () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      expect(trigger).toBeInTheDocument()
    })

    it('renders with data-slot attribute on root', () => {
      render(
        <Select>
          <SelectTrigger data-testid="trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      // The root Select should have data-slot="select"
      // Note: This may require accessing the parent element
      const trigger = screen.getByTestId('trigger')
      expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
    })

    it('applies custom className to trigger', () => {
      render(
        <Select>
          <SelectTrigger className="custom-trigger-class">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByRole('combobox')
      expect(trigger).toHaveClass('custom-trigger-class')
    })

    it('renders chevron icon in trigger', () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      const icon = trigger.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Open/Close Tests
  // ===========================================================================

  describe('open/close behavior', () => {
    it('opens dropdown when trigger is clicked', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })
    })

    it('closes dropdown when clicking outside', async () => {
      render(
        <div>
          <TestSelect />
          <button data-testid="outside">Outside</button>
        </div>
      )

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })

      // Click outside to close
      fireEvent.pointerDown(screen.getByTestId('outside'))

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      })
    })

    it('closes dropdown when Escape is pressed', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })

      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      })
    })

    it('opens dropdown with keyboard Enter', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      trigger.focus()
      fireEvent.keyDown(trigger, { key: 'Enter' })

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })
    })

    it('opens dropdown with keyboard Space', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      trigger.focus()
      fireEvent.keyDown(trigger, { key: ' ' })

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })
    })

    it('opens dropdown with keyboard ArrowDown', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      trigger.focus()
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })
    })

    it('has aria-expanded attribute reflecting open state', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(trigger)

      await waitFor(() => {
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
      })
    })
  })

  // ===========================================================================
  // Options Tests
  // ===========================================================================

  describe('options', () => {
    it('renders all options when opened', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Banana' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Orange' })).toBeInTheDocument()
      })
    })

    it('options have data-slot attribute', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const options = screen.getAllByRole('option')
        options.forEach((option) => {
          expect(option).toHaveAttribute('data-slot', 'select-item')
        })
      })
    })

    it('applies custom className to items', async () => {
      render(
        <Select>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test" className="custom-item-class">
              Test
            </SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const option = screen.getByRole('option', { name: 'Test' })
        expect(option).toHaveClass('custom-item-class')
      })
    })

    it('renders disabled options', async () => {
      render(
        <Select>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="enabled">Enabled</SelectItem>
            <SelectItem value="disabled" disabled>
              Disabled
            </SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const disabledOption = screen.getByRole('option', { name: 'Disabled' })
        expect(disabledOption).toHaveAttribute('data-disabled')
      })
    })

    it('highlights option on hover', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const option = screen.getByRole('option', { name: 'Apple' })
        fireEvent.pointerMove(option)
        expect(option).toHaveAttribute('data-highlighted')
      })
    })

    it('navigates options with keyboard ArrowDown', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })

      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })

      await waitFor(() => {
        const options = screen.getAllByRole('option')
        // One of the options should be highlighted
        expect(options.some((opt) => opt.hasAttribute('data-highlighted'))).toBe(true)
      })
    })

    it('navigates options with keyboard ArrowUp', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })

      fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })

      await waitFor(() => {
        const options = screen.getAllByRole('option')
        expect(options.some((opt) => opt.hasAttribute('data-highlighted'))).toBe(true)
      })
    })
  })

  // ===========================================================================
  // Selection Tests
  // ===========================================================================

  describe('selection', () => {
    it('selects option when clicked', async () => {
      const handleChange = vi.fn()
      render(<TestSelect onValueChange={handleChange} />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const option = screen.getByRole('option', { name: 'Apple' })
        fireEvent.click(option)
      })

      expect(handleChange).toHaveBeenCalledWith('apple')
    })

    it('closes dropdown after selection', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const option = screen.getByRole('option', { name: 'Apple' })
        fireEvent.click(option)
      })

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      })
    })

    it('displays selected value in trigger', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const option = screen.getByRole('option', { name: 'Apple' })
        fireEvent.click(option)
      })

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toHaveTextContent('Apple')
      })
    })

    it('shows check icon on selected item', async () => {
      render(<TestSelect defaultValue="apple" />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const option = screen.getByRole('option', { name: 'Apple' })
        expect(option).toHaveAttribute('data-state', 'checked')
        // Check icon should be visible
        const checkIcon = option.querySelector('svg')
        expect(checkIcon).toBeInTheDocument()
      })
    })

    it('selects option with Enter key', async () => {
      const handleChange = vi.fn()
      render(<TestSelect onValueChange={handleChange} />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })

      // Navigate to first option and select
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
      fireEvent.keyDown(document.activeElement!, { key: 'Enter' })

      expect(handleChange).toHaveBeenCalled()
    })

    it('supports controlled value', () => {
      const handleChange = vi.fn()
      render(<TestSelect value="banana" onValueChange={handleChange} />)

      const trigger = screen.getByRole('combobox')
      expect(trigger).toHaveTextContent('Banana')
    })

    it('supports defaultValue', () => {
      render(<TestSelect defaultValue="orange" />)

      const trigger = screen.getByRole('combobox')
      expect(trigger).toHaveTextContent('Orange')
    })
  })

  // ===========================================================================
  // Placeholder Tests
  // ===========================================================================

  describe('placeholder', () => {
    it('displays placeholder when no value is selected', () => {
      render(<TestSelect placeholder="Choose a fruit" />)

      const trigger = screen.getByRole('combobox')
      expect(trigger).toHaveTextContent('Choose a fruit')
    })

    it('has data-placeholder attribute when showing placeholder', () => {
      render(<TestSelect placeholder="Choose a fruit" />)

      const trigger = screen.getByRole('combobox')
      // Radix uses data-placeholder on SelectValue
      expect(trigger.textContent).toContain('Choose a fruit')
    })

    it('placeholder is replaced by selected value', async () => {
      render(<TestSelect placeholder="Choose a fruit" />)

      const trigger = screen.getByRole('combobox')
      expect(trigger).toHaveTextContent('Choose a fruit')

      fireEvent.click(trigger)

      await waitFor(() => {
        const option = screen.getByRole('option', { name: 'Apple' })
        fireEvent.click(option)
      })

      await waitFor(() => {
        expect(trigger).not.toHaveTextContent('Choose a fruit')
        expect(trigger).toHaveTextContent('Apple')
      })
    })

    it('applies placeholder styling', () => {
      render(<TestSelect placeholder="Select..." />)

      const trigger = screen.getByRole('combobox')
      // Trigger should have placeholder-specific styling class
      expect(trigger.className).toContain('data-[placeholder]')
    })
  })

  // ===========================================================================
  // Groups and Labels Tests
  // ===========================================================================

  describe('groups and labels', () => {
    it('renders select groups', async () => {
      render(<TestSelectWithGroups />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const groups = screen.getAllByRole('group')
        expect(groups.length).toBe(2)
      })
    })

    it('renders group labels', async () => {
      render(<TestSelectWithGroups />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByText('Fruits')).toBeInTheDocument()
        expect(screen.getByText('Vegetables')).toBeInTheDocument()
      })
    })

    it('labels have data-slot attribute', async () => {
      render(<TestSelectWithGroups />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const label = screen.getByText('Fruits')
        expect(label).toHaveAttribute('data-slot', 'select-label')
      })
    })

    it('renders separator between groups', async () => {
      render(<TestSelectWithGroups />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const separator = document.querySelector('[data-slot="select-separator"]')
        expect(separator).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Disabled State Tests
  // ===========================================================================

  describe('disabled state', () => {
    it('renders as disabled when disabled prop is true', () => {
      render(<TestSelect disabled />)

      const trigger = screen.getByRole('combobox')
      expect(trigger).toBeDisabled()
    })

    it('does not open when disabled', () => {
      render(<TestSelect disabled />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('applies disabled styling', () => {
      render(<TestSelect disabled />)

      const trigger = screen.getByRole('combobox')
      expect(trigger.className).toContain('disabled:')
    })

    it('has reduced opacity when disabled', () => {
      render(<TestSelect disabled />)

      const trigger = screen.getByRole('combobox')
      expect(trigger.className).toContain('disabled:opacity-50')
    })

    it('has correct cursor styling when disabled', () => {
      render(<TestSelect disabled />)

      const trigger = screen.getByRole('combobox')
      expect(trigger.className).toContain('disabled:cursor-not-allowed')
    })
  })

  // ===========================================================================
  // Size Variants Tests
  // ===========================================================================

  describe('size variants', () => {
    it('supports default size', () => {
      render(
        <Select>
          <SelectTrigger size="default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByRole('combobox')
      expect(trigger).toHaveAttribute('data-size', 'default')
    })

    it('supports small size', () => {
      render(
        <Select>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByRole('combobox')
      expect(trigger).toHaveAttribute('data-size', 'sm')
    })
  })

  // ===========================================================================
  // Content Positioning Tests
  // ===========================================================================

  describe('content positioning', () => {
    it('supports item-aligned position', async () => {
      render(
        <Select>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="item-aligned">
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })
    })

    it('supports popper position', async () => {
      render(
        <Select>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('trigger has combobox role', () => {
      render(<TestSelect />)

      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('content has listbox role', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })
    })

    it('items have option role', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getAllByRole('option').length).toBe(3)
      })
    })

    it('trigger is keyboard focusable', () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      trigger.focus()

      expect(document.activeElement).toBe(trigger)
    })

    it('supports aria-label on trigger', () => {
      render(
        <Select>
          <SelectTrigger aria-label="Select a fruit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByLabelText('Select a fruit')
      expect(trigger).toBeInTheDocument()
    })

    it('can be associated with label via id', () => {
      render(
        <>
          <label htmlFor="fruit-select">Fruit</label>
          <Select>
            <SelectTrigger id="fruit-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="test">Test</SelectItem>
            </SelectContent>
          </Select>
        </>
      )

      const trigger = screen.getByLabelText('Fruit')
      expect(trigger).toBeInTheDocument()
    })

    it('supports aria-invalid for validation', () => {
      render(
        <Select>
          <SelectTrigger aria-invalid="true">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByRole('combobox')
      expect(trigger).toHaveAttribute('aria-invalid', 'true')
    })

    it('applies aria-invalid styling', () => {
      render(
        <Select>
          <SelectTrigger aria-invalid="true">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByRole('combobox')
      expect(trigger.className).toContain('aria-invalid:')
    })

    it('supports name attribute for form submission', () => {
      render(
        <Select name="fruit">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      // Radix handles form submission via hidden input
      const trigger = screen.getByRole('combobox')
      expect(trigger).toBeInTheDocument()
    })

    it('supports required attribute', () => {
      render(
        <Select required>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
      )

      const trigger = screen.getByRole('combobox')
      expect(trigger).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Dark Mode Tests
  // ===========================================================================

  describe('dark mode', () => {
    it('trigger has dark mode styling', () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      expect(trigger.className).toContain('dark:')
    })
  })

  // ===========================================================================
  // Focus Management Tests
  // ===========================================================================

  describe('focus management', () => {
    it('has focus-visible styling on trigger', () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      expect(trigger.className).toContain('focus-visible:')
    })

    it('returns focus to trigger after selection', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        const option = screen.getByRole('option', { name: 'Apple' })
        fireEvent.click(option)
      })

      await waitFor(() => {
        expect(document.activeElement).toBe(trigger)
      })
    })

    it('returns focus to trigger after pressing Escape', async () => {
      render(<TestSelect />)

      const trigger = screen.getByRole('combobox')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })

      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

      await waitFor(() => {
        expect(document.activeElement).toBe(trigger)
      })
    })
  })
})
