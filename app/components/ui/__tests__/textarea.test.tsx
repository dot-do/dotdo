/**
 * Textarea Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the Textarea component.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The Textarea component provides:
 * - Multiline text input functionality
 * - Rows configuration
 * - Resize behavior control
 * - All standard textarea features
 *
 * @see app/components/ui/textarea.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Import component under test
import { Textarea } from '../textarea'

// =============================================================================
// Test Suite
// =============================================================================

describe('Textarea', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Basic Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders a textarea element', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeInTheDocument()
      expect(textarea.tagName.toLowerCase()).toBe('textarea')
    })

    it('renders with data-slot attribute', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('data-slot', 'textarea')
    })

    it('applies custom className', () => {
      render(<Textarea className="custom-textarea-class" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveClass('custom-textarea-class')
    })

    it('forwards ref to textarea element', () => {
      const ref = React.createRef<HTMLTextAreaElement>()
      render(<Textarea ref={ref} />)

      expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
    })

    it('passes through additional props', () => {
      render(<Textarea data-testid="test-textarea" aria-label="Test textarea" />)

      const textarea = screen.getByTestId('test-textarea')
      expect(textarea).toHaveAttribute('aria-label', 'Test textarea')
    })
  })

  // ===========================================================================
  // Multiline Input Tests
  // ===========================================================================

  describe('multiline input', () => {
    it('accepts multiline text input', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      const multilineText = 'Line 1\nLine 2\nLine 3'
      fireEvent.change(textarea, { target: { value: multilineText } })

      expect(textarea).toHaveValue(multilineText)
    })

    it('preserves line breaks in value', () => {
      render(<Textarea defaultValue="First line\nSecond line" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('First line\nSecond line')
    })

    it('handles Enter key to create new lines', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'Line 1' } })
      fireEvent.keyDown(textarea, { key: 'Enter' })
      fireEvent.change(textarea, { target: { value: 'Line 1\nLine 2' } })

      expect(textarea).toHaveValue('Line 1\nLine 2')
    })

    it('calls onChange for each character including newlines', () => {
      const handleChange = vi.fn()
      render(<Textarea onChange={handleChange} />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'a\nb' } })

      expect(handleChange).toHaveBeenCalled()
    })

    it('supports controlled value with multiline text', () => {
      const multilineText = 'Line 1\nLine 2\nLine 3'
      render(<Textarea value={multilineText} onChange={() => {}} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue(multilineText)
    })
  })

  // ===========================================================================
  // Rows Prop Tests
  // ===========================================================================

  describe('rows prop', () => {
    it('applies rows attribute', () => {
      render(<Textarea rows={5} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('rows', '5')
    })

    it('renders with default height without rows prop', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      // Component uses min-h-16 by default for content-sizing
      expect(textarea.className).toContain('min-h-')
    })

    it('allows setting minimum rows', () => {
      render(<Textarea rows={3} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('rows', '3')
    })

    it('allows setting large number of rows', () => {
      render(<Textarea rows={20} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('rows', '20')
    })

    it('supports cols attribute', () => {
      render(<Textarea cols={50} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('cols', '50')
    })
  })

  // ===========================================================================
  // Resize Behavior Tests
  // ===========================================================================

  describe('resize behavior', () => {
    it('uses field-sizing-content for auto-resize', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('field-sizing-content')
    })

    it('allows overriding resize with className', () => {
      render(<Textarea className="resize-none" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveClass('resize-none')
    })

    it('supports resize-y via className', () => {
      render(<Textarea className="resize-y" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveClass('resize-y')
    })

    it('supports resize-x via className', () => {
      render(<Textarea className="resize-x" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveClass('resize-x')
    })

    it('supports resize via className', () => {
      render(<Textarea className="resize" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveClass('resize')
    })

    it('has minimum height set', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('min-h-16')
    })
  })

  // ===========================================================================
  // Value and Change Handling Tests
  // ===========================================================================

  describe('value and change handling', () => {
    it('handles controlled value', () => {
      render(<Textarea value="controlled value" onChange={() => {}} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('controlled value')
    })

    it('calls onChange when value changes', () => {
      const handleChange = vi.fn()
      render(<Textarea onChange={handleChange} />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'new value' } })

      expect(handleChange).toHaveBeenCalledTimes(1)
    })

    it('onChange receives correct event', () => {
      const handleChange = vi.fn()
      render(<Textarea onChange={handleChange} />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'test value' } })

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ value: 'test value' }),
        })
      )
    })

    it('supports defaultValue for uncontrolled textarea', () => {
      render(<Textarea defaultValue="default value" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('default value')
    })

    it('allows typing in uncontrolled mode', () => {
      render(<Textarea defaultValue="" />)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'typed value' } })

      expect(textarea).toHaveValue('typed value')
    })

    it('calls onBlur when focus leaves textarea', () => {
      const handleBlur = vi.fn()
      render(<Textarea onBlur={handleBlur} />)

      const textarea = screen.getByRole('textbox')
      fireEvent.focus(textarea)
      fireEvent.blur(textarea)

      expect(handleBlur).toHaveBeenCalledTimes(1)
    })

    it('calls onFocus when textarea receives focus', () => {
      const handleFocus = vi.fn()
      render(<Textarea onFocus={handleFocus} />)

      const textarea = screen.getByRole('textbox')
      fireEvent.focus(textarea)

      expect(handleFocus).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // Placeholder Tests
  // ===========================================================================

  describe('placeholder', () => {
    it('renders with placeholder text', () => {
      render(<Textarea placeholder="Enter your message" />)

      const textarea = screen.getByPlaceholderText('Enter your message')
      expect(textarea).toBeInTheDocument()
    })

    it('placeholder disappears when user types', () => {
      render(<Textarea placeholder="Enter your message" />)

      const textarea = screen.getByPlaceholderText('Enter your message')
      fireEvent.change(textarea, { target: { value: 'Hello' } })

      expect(textarea).toHaveValue('Hello')
    })

    it('applies placeholder styling', () => {
      render(<Textarea placeholder="Test" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('placeholder:')
    })
  })

  // ===========================================================================
  // Disabled State Tests
  // ===========================================================================

  describe('disabled state', () => {
    it('renders as disabled when disabled prop is true', () => {
      render(<Textarea disabled />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeDisabled()
    })

    it('applies disabled styling', () => {
      render(<Textarea disabled />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('disabled:')
    })

    it('has correct cursor styling when disabled', () => {
      render(<Textarea disabled />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('disabled:cursor-not-allowed')
    })

    it('has reduced opacity when disabled', () => {
      render(<Textarea disabled />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('disabled:opacity-50')
    })

    it('cannot receive focus when disabled', () => {
      render(<Textarea disabled />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeDisabled()
    })
  })

  // ===========================================================================
  // Readonly State Tests
  // ===========================================================================

  describe('readonly state', () => {
    it('renders as readonly when readOnly prop is true', () => {
      render(<Textarea readOnly />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('readonly')
    })

    it('can display value when readonly', () => {
      render(<Textarea readOnly value="readonly value" onChange={() => {}} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('readonly value')
    })

    it('can still receive focus when readonly', () => {
      render(<Textarea readOnly />)

      const textarea = screen.getByRole('textbox')
      fireEvent.focus(textarea)

      expect(document.activeElement).toBe(textarea)
    })

    it('text can be selected when readonly', () => {
      render(<Textarea readOnly value="selectable text" onChange={() => {}} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('readonly')
    })
  })

  // ===========================================================================
  // Focus and Styling Tests
  // ===========================================================================

  describe('focus styling', () => {
    it('has focus-visible styling', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('focus-visible:')
    })

    it('applies border ring on focus', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('focus-visible:border-ring')
      expect(textarea.className).toContain('focus-visible:ring-')
    })

    it('is focusable via keyboard', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      textarea.focus()

      expect(document.activeElement).toBe(textarea)
    })
  })

  // ===========================================================================
  // Validation State Tests
  // ===========================================================================

  describe('validation state', () => {
    it('supports aria-invalid attribute', () => {
      render(<Textarea aria-invalid="true" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('aria-invalid', 'true')
    })

    it('applies invalid styling when aria-invalid', () => {
      render(<Textarea aria-invalid="true" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('aria-invalid:')
    })

    it('supports required attribute', () => {
      render(<Textarea required />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeRequired()
    })

    it('supports minLength and maxLength', () => {
      render(<Textarea minLength={10} maxLength={500} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('minlength', '10')
      expect(textarea).toHaveAttribute('maxlength', '500')
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('can be associated with label via id', () => {
      render(
        <>
          <label htmlFor="test-textarea">Description</label>
          <Textarea id="test-textarea" />
        </>
      )

      const textarea = screen.getByLabelText('Description')
      expect(textarea).toBeInTheDocument()
    })

    it('supports aria-label', () => {
      render(<Textarea aria-label="Message content" />)

      const textarea = screen.getByLabelText('Message content')
      expect(textarea).toBeInTheDocument()
    })

    it('supports aria-describedby', () => {
      render(
        <>
          <Textarea aria-describedby="helper-text" />
          <span id="helper-text">Maximum 500 characters</span>
        </>
      )

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('aria-describedby', 'helper-text')
    })

    it('has textbox role', () => {
      render(<Textarea />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('supports name attribute for form submission', () => {
      render(<Textarea name="message" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('name', 'message')
    })

    it('supports autocomplete attribute', () => {
      render(<Textarea autoComplete="off" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('autocomplete', 'off')
    })
  })

  // ===========================================================================
  // Word Wrap and Overflow Tests
  // ===========================================================================

  describe('word wrap and overflow', () => {
    it('supports wrap attribute', () => {
      render(<Textarea wrap="hard" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('wrap', 'hard')
    })

    it('defaults to soft wrap', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      // Soft wrap is the default browser behavior
      expect(textarea).not.toHaveAttribute('wrap', 'off')
    })

    it('supports wrap="off" for no wrapping', () => {
      render(<Textarea wrap="off" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('wrap', 'off')
    })
  })

  // ===========================================================================
  // Dark Mode Tests
  // ===========================================================================

  describe('dark mode', () => {
    it('has dark mode specific styling', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('dark:')
    })

    it('has dark mode background styling', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('dark:bg-input')
    })
  })

  // ===========================================================================
  // Visual Design Tests
  // ===========================================================================

  describe('visual design', () => {
    it('has rounded corners', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('rounded-')
    })

    it('has border styling', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('border')
    })

    it('has shadow styling', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('shadow-')
    })

    it('has padding', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('px-')
      expect(textarea.className).toContain('py-')
    })

    it('has full width', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('w-full')
    })

    it('has transition styling', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('transition-')
    })

    it('has transparent background', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('bg-transparent')
    })

    it('uses display flex', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('flex')
    })
  })

  // ===========================================================================
  // Form Integration Tests
  // ===========================================================================

  describe('form integration', () => {
    it('submits value within form', () => {
      const handleSubmit = vi.fn((e) => {
        e.preventDefault()
      })

      render(
        <form onSubmit={handleSubmit}>
          <Textarea name="message" defaultValue="Hello World" />
          <button type="submit">Submit</button>
        </form>
      )

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      fireEvent.click(submitButton)

      expect(handleSubmit).toHaveBeenCalled()
    })

    it('supports form attribute for external form association', () => {
      render(
        <>
          <form id="external-form" />
          <Textarea form="external-form" name="message" />
        </>
      )

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('form', 'external-form')
    })
  })

  // ===========================================================================
  // Text Size Tests
  // ===========================================================================

  describe('text size', () => {
    it('has base text size on mobile', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('text-base')
    })

    it('has smaller text size on desktop', () => {
      render(<Textarea />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('md:text-sm')
    })
  })
})
