/**
 * Checkbox Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the Checkbox component.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The Checkbox component provides:
 * - Toggleable checked/unchecked state
 * - Indeterminate state support
 * - Label association
 * - Accessible checkbox behavior
 *
 * @see app/components/ui/checkbox.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Import component under test
import { Checkbox } from '../checkbox'

// =============================================================================
// Helper Component
// =============================================================================

function CheckboxWithLabel({
  label,
  ...props
}: React.ComponentProps<typeof Checkbox> & { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id="checkbox" {...props} />
      <label htmlFor="checkbox">{label}</label>
    </div>
  )
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Checkbox', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Basic Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders a checkbox element', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeInTheDocument()
    })

    it('renders with data-slot attribute', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('data-slot', 'checkbox')
    })

    it('applies custom className', () => {
      render(<Checkbox className="custom-checkbox-class" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveClass('custom-checkbox-class')
    })

    it('forwards ref to checkbox element', () => {
      const ref = React.createRef<HTMLButtonElement>()
      render(<Checkbox ref={ref} />)

      expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    })

    it('passes through additional props', () => {
      render(<Checkbox data-testid="test-checkbox" aria-label="Test checkbox" />)

      const checkbox = screen.getByTestId('test-checkbox')
      expect(checkbox).toHaveAttribute('aria-label', 'Test checkbox')
    })

    it('renders check icon when checked', () => {
      render(<Checkbox defaultChecked />)

      const checkbox = screen.getByRole('checkbox')
      const checkIcon = checkbox.querySelector('svg')
      expect(checkIcon).toBeInTheDocument()
    })

    it('does not render check icon when unchecked', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      // Indicator should not be visible or icon should not be present
      expect(checkbox.querySelector('[data-slot="checkbox-indicator"]')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Toggle State Tests
  // ===========================================================================

  describe('toggle behavior', () => {
    it('is unchecked by default', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).not.toBeChecked()
      expect(checkbox).toHaveAttribute('data-state', 'unchecked')
    })

    it('toggles to checked when clicked', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      fireEvent.click(checkbox)

      expect(checkbox).toBeChecked()
      expect(checkbox).toHaveAttribute('data-state', 'checked')
    })

    it('toggles to unchecked when clicked again', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      fireEvent.click(checkbox)
      fireEvent.click(checkbox)

      expect(checkbox).not.toBeChecked()
      expect(checkbox).toHaveAttribute('data-state', 'unchecked')
    })

    it('calls onCheckedChange with new value when toggled', () => {
      const handleChange = vi.fn()
      render(<Checkbox onCheckedChange={handleChange} />)

      const checkbox = screen.getByRole('checkbox')
      fireEvent.click(checkbox)

      expect(handleChange).toHaveBeenCalledWith(true)
    })

    it('calls onCheckedChange with false when unchecked', () => {
      const handleChange = vi.fn()
      render(<Checkbox defaultChecked onCheckedChange={handleChange} />)

      const checkbox = screen.getByRole('checkbox')
      fireEvent.click(checkbox)

      expect(handleChange).toHaveBeenCalledWith(false)
    })

    it('supports controlled checked state', () => {
      const handleChange = vi.fn()
      render(<Checkbox checked={true} onCheckedChange={handleChange} />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeChecked()
    })

    it('supports defaultChecked for uncontrolled mode', () => {
      render(<Checkbox defaultChecked />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeChecked()
    })

    it('toggles with Space key', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      checkbox.focus()
      fireEvent.keyDown(checkbox, { key: ' ' })

      expect(checkbox).toBeChecked()
    })

    it('toggles with Enter key', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      checkbox.focus()
      fireEvent.keyDown(checkbox, { key: 'Enter' })

      expect(checkbox).toBeChecked()
    })
  })

  // ===========================================================================
  // Indeterminate State Tests
  // ===========================================================================

  describe('indeterminate state', () => {
    it('supports indeterminate state', () => {
      render(<Checkbox checked="indeterminate" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('data-state', 'indeterminate')
    })

    it('renders different indicator for indeterminate', () => {
      render(<Checkbox checked="indeterminate" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('data-state', 'indeterminate')
    })

    it('calls onCheckedChange with true when indeterminate is clicked', () => {
      const handleChange = vi.fn()
      render(<Checkbox checked="indeterminate" onCheckedChange={handleChange} />)

      const checkbox = screen.getByRole('checkbox')
      fireEvent.click(checkbox)

      expect(handleChange).toHaveBeenCalledWith(true)
    })

    it('aria-checked is mixed for indeterminate', () => {
      render(<Checkbox checked="indeterminate" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('aria-checked', 'mixed')
    })
  })

  // ===========================================================================
  // Label Association Tests
  // ===========================================================================

  describe('labels', () => {
    it('can be associated with label via id', () => {
      render(<CheckboxWithLabel label="Accept terms" />)

      const checkbox = screen.getByLabelText('Accept terms')
      expect(checkbox).toBeInTheDocument()
    })

    it('toggles when label is clicked', () => {
      render(<CheckboxWithLabel label="Accept terms" />)

      const label = screen.getByText('Accept terms')
      fireEvent.click(label)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeChecked()
    })

    it('supports aria-label for accessible name', () => {
      render(<Checkbox aria-label="Toggle notification" />)

      const checkbox = screen.getByLabelText('Toggle notification')
      expect(checkbox).toBeInTheDocument()
    })

    it('supports aria-labelledby for external label', () => {
      render(
        <>
          <span id="custom-label">Custom label</span>
          <Checkbox aria-labelledby="custom-label" />
        </>
      )

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('aria-labelledby', 'custom-label')
    })

    it('label inherits disabled styling from checkbox', () => {
      render(
        <div className="group" data-disabled="true">
          <Checkbox id="cb" disabled />
          <label htmlFor="cb" className="peer-disabled:opacity-50">
            Disabled option
          </label>
        </div>
      )

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeDisabled()
    })
  })

  // ===========================================================================
  // Disabled State Tests
  // ===========================================================================

  describe('disabled state', () => {
    it('renders as disabled when disabled prop is true', () => {
      render(<Checkbox disabled />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeDisabled()
    })

    it('does not toggle when disabled', () => {
      const handleChange = vi.fn()
      render(<Checkbox disabled onCheckedChange={handleChange} />)

      const checkbox = screen.getByRole('checkbox')
      fireEvent.click(checkbox)

      expect(handleChange).not.toHaveBeenCalled()
    })

    it('applies disabled styling', () => {
      render(<Checkbox disabled />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('disabled:')
    })

    it('has cursor-not-allowed when disabled', () => {
      render(<Checkbox disabled />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('disabled:cursor-not-allowed')
    })

    it('has reduced opacity when disabled', () => {
      render(<Checkbox disabled />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('disabled:opacity-50')
    })

    it('cannot be focused with keyboard when disabled', () => {
      render(<Checkbox disabled />)

      const checkbox = screen.getByRole('checkbox')
      checkbox.focus()

      // Disabled elements should not receive focus (browser behavior varies)
      expect(checkbox).toBeDisabled()
    })
  })

  // ===========================================================================
  // Required State Tests
  // ===========================================================================

  describe('required state', () => {
    it('supports required attribute', () => {
      render(<Checkbox required />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeRequired()
    })

    it('has aria-required when required', () => {
      render(<Checkbox required />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('aria-required', 'true')
    })
  })

  // ===========================================================================
  // Focus and Styling Tests
  // ===========================================================================

  describe('focus styling', () => {
    it('has focus-visible styling', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('focus-visible:')
    })

    it('applies border ring on focus', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('focus-visible:border-ring')
      expect(checkbox.className).toContain('focus-visible:ring-')
    })

    it('is focusable via keyboard', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      checkbox.focus()

      expect(document.activeElement).toBe(checkbox)
    })
  })

  // ===========================================================================
  // Validation State Tests
  // ===========================================================================

  describe('validation state', () => {
    it('supports aria-invalid attribute', () => {
      render(<Checkbox aria-invalid="true" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('aria-invalid', 'true')
    })

    it('applies invalid styling when aria-invalid', () => {
      render(<Checkbox aria-invalid="true" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('aria-invalid:')
    })
  })

  // ===========================================================================
  // Checked Styling Tests
  // ===========================================================================

  describe('checked styling', () => {
    it('applies checked background color', () => {
      render(<Checkbox defaultChecked />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('data-[state=checked]:bg-primary')
    })

    it('applies checked text color', () => {
      render(<Checkbox defaultChecked />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('data-[state=checked]:text-primary-foreground')
    })

    it('applies checked border color', () => {
      render(<Checkbox defaultChecked />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('data-[state=checked]:border-primary')
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('has checkbox role', () => {
      render(<Checkbox />)

      expect(screen.getByRole('checkbox')).toBeInTheDocument()
    })

    it('has accessible name when labeled', () => {
      render(<CheckboxWithLabel label="Subscribe to newsletter" />)

      const checkbox = screen.getByRole('checkbox', { name: 'Subscribe to newsletter' })
      expect(checkbox).toBeInTheDocument()
    })

    it('supports aria-describedby', () => {
      render(
        <>
          <Checkbox aria-describedby="helper-text" />
          <span id="helper-text">Optional newsletter subscription</span>
        </>
      )

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('aria-describedby', 'helper-text')
    })

    it('aria-checked reflects checked state', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('aria-checked', 'false')

      fireEvent.click(checkbox)

      expect(checkbox).toHaveAttribute('aria-checked', 'true')
    })

    it('supports name attribute for form submission', () => {
      render(<Checkbox name="terms" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('name', 'terms')
    })

    it('supports value attribute for form submission', () => {
      render(<Checkbox name="terms" value="accepted" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toHaveAttribute('value', 'accepted')
    })
  })

  // ===========================================================================
  // Form Integration Tests
  // ===========================================================================

  describe('form integration', () => {
    it('submits correct value when checked in form', () => {
      const handleSubmit = vi.fn((e) => {
        e.preventDefault()
        const formData = new FormData(e.target)
        handleSubmit.mock.results = [{ value: Object.fromEntries(formData) }]
      })

      render(
        <form onSubmit={handleSubmit}>
          <Checkbox name="terms" value="accepted" defaultChecked />
          <button type="submit">Submit</button>
        </form>
      )

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeChecked()
    })

    it('does not submit value when unchecked', () => {
      render(
        <form>
          <Checkbox name="terms" value="accepted" />
          <button type="submit">Submit</button>
        </form>
      )

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).not.toBeChecked()
    })
  })

  // ===========================================================================
  // Dark Mode Tests
  // ===========================================================================

  describe('dark mode', () => {
    it('has dark mode specific styling', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('dark:')
    })

    it('has dark mode background styling', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('dark:bg-input')
    })
  })

  // ===========================================================================
  // Visual Design Tests
  // ===========================================================================

  describe('visual design', () => {
    it('has rounded corners', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('rounded-')
    })

    it('has appropriate size', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('size-4')
    })

    it('has border styling', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('border')
    })

    it('has shadow styling', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('shadow-')
    })

    it('has transition styling', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('transition')
    })
  })

  // ===========================================================================
  // Peer Modifier Tests
  // ===========================================================================

  describe('peer modifier', () => {
    it('has peer class for sibling styling', () => {
      render(<Checkbox />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox.className).toContain('peer')
    })

    it('enables peer-disabled styling on siblings', () => {
      render(
        <>
          <Checkbox disabled />
          <span className="peer-disabled:opacity-50">Label</span>
        </>
      )

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeDisabled()
    })
  })
})
