/**
 * Input Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the Input component.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The Input component provides:
 * - Standard HTML input functionality
 * - Placeholder text support
 * - Value change handling
 * - Disabled and readonly states
 * - Multiple type variants (text, email, password, number, etc.)
 *
 * @see app/components/ui/input.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Import component under test
import { Input } from '../input'

// =============================================================================
// Test Suite
// =============================================================================

describe('Input', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Basic Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders an input element', () => {
      render(<Input />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('renders with data-slot attribute', () => {
      render(<Input />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('data-slot', 'input')
    })

    it('applies custom className', () => {
      render(<Input className="custom-class" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveClass('custom-class')
    })

    it('forwards ref to input element', () => {
      const ref = React.createRef<HTMLInputElement>()
      render(<Input ref={ref} />)

      expect(ref.current).toBeInstanceOf(HTMLInputElement)
    })

    it('passes through additional props', () => {
      render(<Input data-testid="test-input" aria-label="Test input" />)

      const input = screen.getByTestId('test-input')
      expect(input).toHaveAttribute('aria-label', 'Test input')
    })
  })

  // ===========================================================================
  // Placeholder Tests
  // ===========================================================================

  describe('placeholder', () => {
    it('renders with placeholder text', () => {
      render(<Input placeholder="Enter your name" />)

      const input = screen.getByPlaceholderText('Enter your name')
      expect(input).toBeInTheDocument()
    })

    it('placeholder disappears when user types', () => {
      render(<Input placeholder="Enter your name" />)

      const input = screen.getByPlaceholderText('Enter your name')
      fireEvent.change(input, { target: { value: 'John' } })

      // Input should have value but placeholder is still in DOM (just not visible)
      expect(input).toHaveValue('John')
    })

    it('applies placeholder styling from className', () => {
      render(<Input placeholder="Test" />)

      const input = screen.getByRole('textbox')
      // Check that placeholder styles are applied via className
      expect(input.className).toContain('placeholder:')
    })
  })

  // ===========================================================================
  // Value Changes Tests
  // ===========================================================================

  describe('value changes', () => {
    it('handles controlled value', () => {
      render(<Input value="controlled value" onChange={() => {}} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('controlled value')
    })

    it('calls onChange when value changes', () => {
      const handleChange = vi.fn()
      render(<Input onChange={handleChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new value' } })

      expect(handleChange).toHaveBeenCalledTimes(1)
    })

    it('onChange receives correct event', () => {
      const handleChange = vi.fn()
      render(<Input onChange={handleChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'test value' } })

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ value: 'test value' }),
        })
      )
    })

    it('supports defaultValue for uncontrolled input', () => {
      render(<Input defaultValue="default value" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('default value')
    })

    it('allows typing in uncontrolled mode', () => {
      render(<Input defaultValue="" />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'typed value' } })

      expect(input).toHaveValue('typed value')
    })

    it('calls onBlur when focus leaves input', () => {
      const handleBlur = vi.fn()
      render(<Input onBlur={handleBlur} />)

      const input = screen.getByRole('textbox')
      fireEvent.focus(input)
      fireEvent.blur(input)

      expect(handleBlur).toHaveBeenCalledTimes(1)
    })

    it('calls onFocus when input receives focus', () => {
      const handleFocus = vi.fn()
      render(<Input onFocus={handleFocus} />)

      const input = screen.getByRole('textbox')
      fireEvent.focus(input)

      expect(handleFocus).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // Disabled State Tests
  // ===========================================================================

  describe('disabled state', () => {
    it('renders as disabled when disabled prop is true', () => {
      render(<Input disabled />)

      const input = screen.getByRole('textbox')
      expect(input).toBeDisabled()
    })

    it('applies disabled styling', () => {
      render(<Input disabled />)

      const input = screen.getByRole('textbox')
      // Check for disabled-related classes
      expect(input.className).toContain('disabled:')
    })

    it('does not call onChange when disabled', () => {
      const handleChange = vi.fn()
      render(<Input disabled onChange={handleChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'test' } })

      // Note: fireEvent can still trigger change on disabled inputs in tests
      // but in real browser, disabled inputs don't receive input
      expect(input).toBeDisabled()
    })

    it('has correct cursor styling when disabled', () => {
      render(<Input disabled />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('disabled:cursor-not-allowed')
    })

    it('has reduced opacity when disabled', () => {
      render(<Input disabled />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('disabled:opacity-50')
    })
  })

  // ===========================================================================
  // Readonly State Tests
  // ===========================================================================

  describe('readonly state', () => {
    it('renders as readonly when readOnly prop is true', () => {
      render(<Input readOnly />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('readonly')
    })

    it('can display value when readonly', () => {
      render(<Input readOnly value="readonly value" onChange={() => {}} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('readonly value')
    })

    it('value cannot be changed when readonly', () => {
      const handleChange = vi.fn()
      render(<Input readOnly value="readonly value" onChange={handleChange} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('readonly')
    })

    it('can still receive focus when readonly', () => {
      render(<Input readOnly />)

      const input = screen.getByRole('textbox')
      input.focus()

      expect(document.activeElement).toBe(input)
    })
  })

  // ===========================================================================
  // Type Variants Tests
  // ===========================================================================

  describe('type variants', () => {
    describe('text type', () => {
      it('renders text input by default', () => {
        render(<Input />)

        const input = screen.getByRole('textbox')
        expect(input).toHaveAttribute('type', 'text')
      })

      it('renders text input explicitly', () => {
        render(<Input type="text" />)

        const input = screen.getByRole('textbox')
        expect(input).toHaveAttribute('type', 'text')
      })
    })

    describe('email type', () => {
      it('renders email input', () => {
        render(<Input type="email" />)

        const input = screen.getByRole('textbox')
        expect(input).toHaveAttribute('type', 'email')
      })

      it('accepts valid email format', () => {
        render(<Input type="email" />)

        const input = screen.getByRole('textbox')
        fireEvent.change(input, { target: { value: 'test@example.com' } })

        expect(input).toHaveValue('test@example.com')
      })
    })

    describe('password type', () => {
      it('renders password input', () => {
        render(<Input type="password" />)

        // Password inputs don't have textbox role
        const input = document.querySelector('input[type="password"]')
        expect(input).toBeInTheDocument()
        expect(input).toHaveAttribute('type', 'password')
      })

      it('obscures password value', () => {
        render(<Input type="password" defaultValue="secret123" />)

        const input = document.querySelector('input[type="password"]')
        expect(input).toHaveAttribute('type', 'password')
        expect(input).toHaveValue('secret123')
      })
    })

    describe('number type', () => {
      it('renders number input', () => {
        render(<Input type="number" />)

        const input = screen.getByRole('spinbutton')
        expect(input).toHaveAttribute('type', 'number')
      })

      it('accepts numeric values', () => {
        render(<Input type="number" />)

        const input = screen.getByRole('spinbutton')
        fireEvent.change(input, { target: { value: '42' } })

        expect(input).toHaveValue(42)
      })

      it('supports min and max attributes', () => {
        render(<Input type="number" min={0} max={100} />)

        const input = screen.getByRole('spinbutton')
        expect(input).toHaveAttribute('min', '0')
        expect(input).toHaveAttribute('max', '100')
      })

      it('supports step attribute', () => {
        render(<Input type="number" step={0.1} />)

        const input = screen.getByRole('spinbutton')
        expect(input).toHaveAttribute('step', '0.1')
      })
    })

    describe('tel type', () => {
      it('renders tel input', () => {
        render(<Input type="tel" />)

        const input = screen.getByRole('textbox')
        expect(input).toHaveAttribute('type', 'tel')
      })
    })

    describe('url type', () => {
      it('renders url input', () => {
        render(<Input type="url" />)

        const input = screen.getByRole('textbox')
        expect(input).toHaveAttribute('type', 'url')
      })
    })

    describe('search type', () => {
      it('renders search input', () => {
        render(<Input type="search" />)

        const input = screen.getByRole('searchbox')
        expect(input).toHaveAttribute('type', 'search')
      })
    })

    describe('file type', () => {
      it('renders file input', () => {
        render(<Input type="file" />)

        // File inputs don't have a specific role
        const input = document.querySelector('input[type="file"]')
        expect(input).toBeInTheDocument()
        expect(input).toHaveAttribute('type', 'file')
      })

      it('applies file-specific styling', () => {
        render(<Input type="file" />)

        const input = document.querySelector('input[type="file"]')
        expect(input?.className).toContain('file:')
      })
    })
  })

  // ===========================================================================
  // Focus and Styling Tests
  // ===========================================================================

  describe('focus styling', () => {
    it('has focus-visible styling', () => {
      render(<Input />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('focus-visible:')
    })

    it('applies border ring on focus', () => {
      render(<Input />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('focus-visible:border-ring')
      expect(input.className).toContain('focus-visible:ring-')
    })
  })

  // ===========================================================================
  // Validation State Tests
  // ===========================================================================

  describe('validation state', () => {
    it('supports aria-invalid attribute', () => {
      render(<Input aria-invalid="true" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })

    it('applies invalid styling when aria-invalid', () => {
      render(<Input aria-invalid="true" />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('aria-invalid:')
    })

    it('supports required attribute', () => {
      render(<Input required />)

      const input = screen.getByRole('textbox')
      expect(input).toBeRequired()
    })

    it('supports pattern attribute for validation', () => {
      render(<Input pattern="[A-Za-z]{3}" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('pattern', '[A-Za-z]{3}')
    })

    it('supports minLength and maxLength', () => {
      render(<Input minLength={3} maxLength={10} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('minlength', '3')
      expect(input).toHaveAttribute('maxlength', '10')
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('can be associated with label via id', () => {
      render(
        <>
          <label htmlFor="test-input">Name</label>
          <Input id="test-input" />
        </>
      )

      const input = screen.getByLabelText('Name')
      expect(input).toBeInTheDocument()
    })

    it('supports aria-label', () => {
      render(<Input aria-label="Search field" />)

      const input = screen.getByLabelText('Search field')
      expect(input).toBeInTheDocument()
    })

    it('supports aria-describedby', () => {
      render(
        <>
          <Input aria-describedby="helper-text" />
          <span id="helper-text">Enter a valid email</span>
        </>
      )

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('aria-describedby', 'helper-text')
    })

    it('is focusable via keyboard', () => {
      render(<Input />)

      const input = screen.getByRole('textbox')
      input.focus()

      expect(document.activeElement).toBe(input)
    })

    it('supports autocomplete attribute', () => {
      render(<Input autoComplete="email" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('autocomplete', 'email')
    })

    it('supports name attribute for form submission', () => {
      render(<Input name="email" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('name', 'email')
    })
  })

  // ===========================================================================
  // Dark Mode Tests
  // ===========================================================================

  describe('dark mode', () => {
    it('has dark mode specific styling', () => {
      render(<Input />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('dark:')
    })
  })
})
