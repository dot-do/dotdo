/**
 * Label Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the Label component.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The Label component provides:
 * - Semantic label element via Radix UI
 * - Association with form controls via htmlFor
 * - Rendering of children content
 * - Accessible labeling behavior
 *
 * @see app/components/ui/label.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Import component under test
import { Label } from '../label'

// =============================================================================
// Test Suite
// =============================================================================

describe('Label', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Basic Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders a label element', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label).toBeInTheDocument()
    })

    it('renders with data-slot attribute', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label).toHaveAttribute('data-slot', 'label')
    })

    it('applies custom className', () => {
      render(<Label className="custom-label-class">Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label).toHaveClass('custom-label-class')
    })

    it('forwards ref to label element', () => {
      const ref = React.createRef<HTMLLabelElement>()
      render(<Label ref={ref}>Test Label</Label>)

      expect(ref.current).toBeInstanceOf(HTMLLabelElement)
    })

    it('passes through additional props', () => {
      render(
        <Label data-testid="test-label" aria-hidden="true">
          Test Label
        </Label>
      )

      const label = screen.getByTestId('test-label')
      expect(label).toHaveAttribute('aria-hidden', 'true')
    })
  })

  // ===========================================================================
  // htmlFor Association Tests
  // ===========================================================================

  describe('htmlFor association', () => {
    it('associates label with input via htmlFor', () => {
      render(
        <>
          <Label htmlFor="test-input">Username</Label>
          <input id="test-input" type="text" />
        </>
      )

      const input = screen.getByLabelText('Username')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('id', 'test-input')
    })

    it('clicking label focuses associated input', () => {
      render(
        <>
          <Label htmlFor="test-input">Email</Label>
          <input id="test-input" type="email" />
        </>
      )

      const label = screen.getByText('Email')
      fireEvent.click(label)

      const input = screen.getByLabelText('Email')
      expect(document.activeElement).toBe(input)
    })

    it('associates label with textarea via htmlFor', () => {
      render(
        <>
          <Label htmlFor="test-textarea">Description</Label>
          <textarea id="test-textarea" />
        </>
      )

      const textarea = screen.getByLabelText('Description')
      expect(textarea).toBeInTheDocument()
    })

    it('associates label with select via htmlFor', () => {
      render(
        <>
          <Label htmlFor="test-select">Country</Label>
          <select id="test-select">
            <option value="us">United States</option>
          </select>
        </>
      )

      const select = screen.getByLabelText('Country')
      expect(select).toBeInTheDocument()
    })

    it('associates label with checkbox via htmlFor', () => {
      render(
        <>
          <Label htmlFor="test-checkbox">Accept terms</Label>
          <input id="test-checkbox" type="checkbox" />
        </>
      )

      const checkbox = screen.getByLabelText('Accept terms')
      expect(checkbox).toBeInTheDocument()
    })

    it('clicking label toggles associated checkbox', () => {
      render(
        <>
          <Label htmlFor="test-checkbox">Accept terms</Label>
          <input id="test-checkbox" type="checkbox" />
        </>
      )

      const label = screen.getByText('Accept terms')
      const checkbox = screen.getByLabelText('Accept terms') as HTMLInputElement

      expect(checkbox.checked).toBe(false)
      fireEvent.click(label)
      expect(checkbox.checked).toBe(true)
    })

    it('renders for attribute on label element', () => {
      render(<Label htmlFor="my-input">My Label</Label>)

      const label = screen.getByText('My Label')
      expect(label).toHaveAttribute('for', 'my-input')
    })
  })

  // ===========================================================================
  // Children Rendering Tests
  // ===========================================================================

  describe('children', () => {
    it('renders text children', () => {
      render(<Label>Simple text label</Label>)

      expect(screen.getByText('Simple text label')).toBeInTheDocument()
    })

    it('renders element children', () => {
      render(
        <Label>
          <span data-testid="nested-span">Nested content</span>
        </Label>
      )

      expect(screen.getByTestId('nested-span')).toBeInTheDocument()
    })

    it('renders multiple children', () => {
      render(
        <Label>
          <span>First</span>
          <span>Second</span>
        </Label>
      )

      expect(screen.getByText('First')).toBeInTheDocument()
      expect(screen.getByText('Second')).toBeInTheDocument()
    })

    it('renders icon alongside text', () => {
      render(
        <Label>
          <svg data-testid="label-icon" />
          Label with icon
        </Label>
      )

      expect(screen.getByTestId('label-icon')).toBeInTheDocument()
      expect(screen.getByText('Label with icon')).toBeInTheDocument()
    })

    it('renders required indicator', () => {
      render(
        <Label>
          Username <span className="text-destructive">*</span>
        </Label>
      )

      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('renders optional text', () => {
      render(
        <Label>
          Nickname <span className="text-muted-foreground">(optional)</span>
        </Label>
      )

      expect(screen.getByText('(optional)')).toBeInTheDocument()
    })

    it('renders description tooltip', () => {
      render(
        <Label>
          Password
          <span title="Must be at least 8 characters" data-testid="tooltip-trigger">
            ?
          </span>
        </Label>
      )

      expect(screen.getByTestId('tooltip-trigger')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Styling Tests
  // ===========================================================================

  describe('styling', () => {
    it('has flex display for layout', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('flex')
    })

    it('has items-center for vertical alignment', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('items-center')
    })

    it('has gap for spacing between children', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('gap-')
    })

    it('has small text size', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('text-sm')
    })

    it('has medium font weight', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('font-medium')
    })

    it('has no text selection', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('select-none')
    })

    it('has tight leading for compact text', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('leading-none')
    })
  })

  // ===========================================================================
  // Disabled State Tests
  // ===========================================================================

  describe('disabled styling', () => {
    it('has peer-disabled styling for associated disabled input', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('peer-disabled:')
    })

    it('has reduced opacity when peer is disabled', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('peer-disabled:opacity-50')
    })

    it('has cursor not allowed when peer is disabled', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('peer-disabled:cursor-not-allowed')
    })

    it('responds to group data-disabled attribute', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('group-data-[disabled=true]:')
    })

    it('has pointer-events-none when group is disabled', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('group-data-[disabled=true]:pointer-events-none')
    })

    it('has reduced opacity when group is disabled', () => {
      render(<Label>Test Label</Label>)

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('group-data-[disabled=true]:opacity-50')
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('provides accessible name to associated input', () => {
      render(
        <>
          <Label htmlFor="accessible-input">Accessible Field</Label>
          <input id="accessible-input" type="text" />
        </>
      )

      const input = screen.getByRole('textbox', { name: 'Accessible Field' })
      expect(input).toBeInTheDocument()
    })

    it('label text is read by screen readers', () => {
      render(<Label>Screen Reader Label</Label>)

      const label = screen.getByText('Screen Reader Label')
      expect(label).toBeVisible()
    })

    it('works with aria-describedby for additional description', () => {
      render(
        <>
          <Label htmlFor="described-input">Email</Label>
          <input id="described-input" type="email" aria-describedby="email-hint" />
          <span id="email-hint">We will never share your email</span>
        </>
      )

      const input = screen.getByLabelText('Email')
      expect(input).toHaveAttribute('aria-describedby', 'email-hint')
    })

    it('supports multiple labels for same input', () => {
      render(
        <>
          <Label htmlFor="multi-label-input">Primary Label</Label>
          <Label htmlFor="multi-label-input">Secondary Label</Label>
          <input id="multi-label-input" type="text" />
        </>
      )

      // Both labels should be present
      expect(screen.getByText('Primary Label')).toBeInTheDocument()
      expect(screen.getByText('Secondary Label')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('integration with form controls', () => {
    it('works with text input', () => {
      render(
        <div>
          <Label htmlFor="text-field">Full Name</Label>
          <input id="text-field" type="text" />
        </div>
      )

      const input = screen.getByLabelText('Full Name')
      fireEvent.change(input, { target: { value: 'John Doe' } })
      expect(input).toHaveValue('John Doe')
    })

    it('works with password input', () => {
      render(
        <div>
          <Label htmlFor="password-field">Password</Label>
          <input id="password-field" type="password" />
        </div>
      )

      const input = screen.getByLabelText('Password')
      expect(input).toHaveAttribute('type', 'password')
    })

    it('works with number input', () => {
      render(
        <div>
          <Label htmlFor="number-field">Age</Label>
          <input id="number-field" type="number" />
        </div>
      )

      const input = screen.getByLabelText('Age')
      fireEvent.change(input, { target: { value: '25' } })
      expect(input).toHaveValue(25)
    })

    it('works with radio buttons', () => {
      render(
        <fieldset>
          <legend>Gender</legend>
          <div>
            <input id="male" type="radio" name="gender" value="male" />
            <Label htmlFor="male">Male</Label>
          </div>
          <div>
            <input id="female" type="radio" name="gender" value="female" />
            <Label htmlFor="female">Female</Label>
          </div>
        </fieldset>
      )

      const maleRadio = screen.getByLabelText('Male')
      const femaleRadio = screen.getByLabelText('Female')

      fireEvent.click(screen.getByText('Male'))
      expect(maleRadio).toBeChecked()
      expect(femaleRadio).not.toBeChecked()
    })

    it('works with file input', () => {
      render(
        <div>
          <Label htmlFor="file-upload">Upload Document</Label>
          <input id="file-upload" type="file" />
        </div>
      )

      const input = screen.getByLabelText('Upload Document')
      expect(input).toHaveAttribute('type', 'file')
    })
  })

  // ===========================================================================
  // Edge Cases Tests
  // ===========================================================================

  describe('edge cases', () => {
    it('renders empty label', () => {
      render(<Label data-testid="empty-label" />)

      const label = screen.getByTestId('empty-label')
      expect(label).toBeInTheDocument()
    })

    it('handles special characters in text', () => {
      render(<Label>Email & Password</Label>)

      expect(screen.getByText('Email & Password')).toBeInTheDocument()
    })

    it('handles unicode characters', () => {
      render(<Label>Username</Label>)

      expect(screen.getByText('Username')).toBeInTheDocument()
    })

    it('handles very long text', () => {
      const longText = 'A'.repeat(200)
      render(<Label>{longText}</Label>)

      expect(screen.getByText(longText)).toBeInTheDocument()
    }),

    it('handles whitespace-only children', () => {
      render(<Label data-testid="whitespace-label">   </Label>)

      const label = screen.getByTestId('whitespace-label')
      expect(label).toBeInTheDocument()
    })

    it('handles null children', () => {
      render(<Label data-testid="null-label">{null}</Label>)

      const label = screen.getByTestId('null-label')
      expect(label).toBeInTheDocument()
    })

    it('handles fragment children', () => {
      render(
        <Label>
          <>Part 1</>
          <>Part 2</>
        </Label>
      )

      expect(screen.getByText('Part 1')).toBeInTheDocument()
      expect(screen.getByText('Part 2')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Event Handling Tests
  // ===========================================================================

  describe('event handling', () => {
    it('handles onClick on label', () => {
      const handleClick = vi.fn()
      render(<Label onClick={handleClick}>Clickable Label</Label>)

      fireEvent.click(screen.getByText('Clickable Label'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('handles onMouseEnter', () => {
      const handleMouseEnter = vi.fn()
      render(<Label onMouseEnter={handleMouseEnter}>Hover Label</Label>)

      fireEvent.mouseEnter(screen.getByText('Hover Label'))

      expect(handleMouseEnter).toHaveBeenCalledTimes(1)
    })

    it('handles onMouseLeave', () => {
      const handleMouseLeave = vi.fn()
      render(<Label onMouseLeave={handleMouseLeave}>Leave Label</Label>)

      const label = screen.getByText('Leave Label')
      fireEvent.mouseEnter(label)
      fireEvent.mouseLeave(label)

      expect(handleMouseLeave).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // Composition Tests
  // ===========================================================================

  describe('composition patterns', () => {
    it('works inside form group pattern', () => {
      render(
        <div className="form-group">
          <Label htmlFor="grouped-input">Grouped Field</Label>
          <input id="grouped-input" type="text" className="peer" />
          <span className="peer-invalid:visible">Error message</span>
        </div>
      )

      const input = screen.getByLabelText('Grouped Field')
      expect(input).toBeInTheDocument()
    })

    it('works with fieldset and legend', () => {
      render(
        <fieldset>
          <legend>Personal Information</legend>
          <div>
            <Label htmlFor="first-name">First Name</Label>
            <input id="first-name" type="text" />
          </div>
          <div>
            <Label htmlFor="last-name">Last Name</Label>
            <input id="last-name" type="text" />
          </div>
        </fieldset>
      )

      expect(screen.getByLabelText('First Name')).toBeInTheDocument()
      expect(screen.getByLabelText('Last Name')).toBeInTheDocument()
    })

    it('works in grid layout', () => {
      render(
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="grid-field-1">Field 1</Label>
            <input id="grid-field-1" type="text" />
          </div>
          <div>
            <Label htmlFor="grid-field-2">Field 2</Label>
            <input id="grid-field-2" type="text" />
          </div>
        </div>
      )

      expect(screen.getByLabelText('Field 1')).toBeInTheDocument()
      expect(screen.getByLabelText('Field 2')).toBeInTheDocument()
    })
  })
})
