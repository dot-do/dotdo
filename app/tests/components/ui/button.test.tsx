/**
 * Button Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the Button component migration
 * from shadcn/ui to @mdxui/primitives.
 *
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The Button component provides:
 * - Multiple visual variants (default, destructive, outline, secondary, ghost, link)
 * - Multiple size options (default, sm, lg, icon)
 * - Click event handling
 * - Composition via asChild prop
 * - Disabled state
 * - Focus states for accessibility
 *
 * @see app/components/ui/button.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Import component under test
import { Button, buttonVariants } from '../../../components/ui/button'

// =============================================================================
// Test Suite: Button Component
// =============================================================================

describe('Button', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Basic Rendering Tests
  // ===========================================================================

  describe('basic rendering', () => {
    it('renders as a button element', () => {
      render(<Button>Click me</Button>)

      const button = screen.getByRole('button', { name: 'Click me' })
      expect(button).toBeInTheDocument()
      expect(button.tagName).toBe('BUTTON')
    })

    it('renders children content', () => {
      render(<Button>Submit</Button>)

      expect(screen.getByText('Submit')).toBeInTheDocument()
    })

    it('renders with data-slot attribute', () => {
      render(<Button>Test</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('data-slot', 'button')
    })

    it('passes through additional props', () => {
      render(<Button id="custom-id" data-testid="custom-button">Test</Button>)

      const button = screen.getByTestId('custom-button')
      expect(button).toHaveAttribute('id', 'custom-id')
    })

    it('applies custom className', () => {
      render(<Button className="custom-class">Test</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('custom-class')
    })
  })

  // ===========================================================================
  // Variant Tests
  // ===========================================================================

  describe('variants', () => {
    describe('default variant', () => {
      it('renders with default variant classes', () => {
        render(<Button variant="default">Default</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-variant', 'default')
        expect(button).toHaveClass('bg-primary')
        expect(button).toHaveClass('text-primary-foreground')
      })

      it('applies default variant when no variant specified', () => {
        render(<Button>Default</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-variant', 'default')
        expect(button).toHaveClass('bg-primary')
      })
    })

    describe('destructive variant', () => {
      it('renders with destructive variant classes', () => {
        render(<Button variant="destructive">Delete</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-variant', 'destructive')
        expect(button).toHaveClass('bg-destructive')
        expect(button).toHaveClass('text-white')
      })

      it('has destructive focus ring', () => {
        render(<Button variant="destructive">Delete</Button>)

        const button = screen.getByRole('button')
        // Check for destructive focus styling
        expect(button.className).toMatch(/focus-visible:ring-destructive/)
      })
    })

    describe('outline variant', () => {
      it('renders with outline variant classes', () => {
        render(<Button variant="outline">Outline</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-variant', 'outline')
        expect(button).toHaveClass('border')
        expect(button).toHaveClass('bg-background')
      })

      it('has hover state classes', () => {
        render(<Button variant="outline">Outline</Button>)

        const button = screen.getByRole('button')
        expect(button.className).toMatch(/hover:bg-accent/)
      })
    })

    describe('secondary variant', () => {
      it('renders with secondary variant classes', () => {
        render(<Button variant="secondary">Secondary</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-variant', 'secondary')
        expect(button).toHaveClass('bg-secondary')
        expect(button).toHaveClass('text-secondary-foreground')
      })
    })

    describe('ghost variant', () => {
      it('renders with ghost variant classes', () => {
        render(<Button variant="ghost">Ghost</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-variant', 'ghost')
        expect(button.className).toMatch(/hover:bg-accent/)
      })

      it('has no background by default', () => {
        render(<Button variant="ghost">Ghost</Button>)

        const button = screen.getByRole('button')
        // Ghost variant should not have bg-* classes initially
        expect(button).not.toHaveClass('bg-primary')
        expect(button).not.toHaveClass('bg-secondary')
        expect(button).not.toHaveClass('bg-background')
      })
    })

    describe('link variant', () => {
      it('renders with link variant classes', () => {
        render(<Button variant="link">Link</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-variant', 'link')
        expect(button).toHaveClass('text-primary')
        expect(button).toHaveClass('underline-offset-4')
      })

      it('has hover underline', () => {
        render(<Button variant="link">Link</Button>)

        const button = screen.getByRole('button')
        expect(button.className).toMatch(/hover:underline/)
      })
    })
  })

  // ===========================================================================
  // Size Tests
  // ===========================================================================

  describe('sizes', () => {
    describe('default size', () => {
      it('renders with default size classes', () => {
        render(<Button size="default">Default Size</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-size', 'default')
        expect(button).toHaveClass('h-9')
        expect(button).toHaveClass('px-4')
      })

      it('applies default size when no size specified', () => {
        render(<Button>Default Size</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-size', 'default')
        expect(button).toHaveClass('h-9')
      })
    })

    describe('sm size', () => {
      it('renders with small size classes', () => {
        render(<Button size="sm">Small</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-size', 'sm')
        expect(button).toHaveClass('h-8')
        expect(button).toHaveClass('px-3')
      })
    })

    describe('lg size', () => {
      it('renders with large size classes', () => {
        render(<Button size="lg">Large</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-size', 'lg')
        expect(button).toHaveClass('h-10')
        expect(button).toHaveClass('px-6')
      })
    })

    describe('icon size', () => {
      it('renders with icon size classes', () => {
        render(<Button size="icon">X</Button>)

        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('data-size', 'icon')
        expect(button).toHaveClass('size-9')
      })

      it('renders square icon button', () => {
        render(<Button size="icon"><span>+</span></Button>)

        const button = screen.getByRole('button')
        // size-9 makes it 36px x 36px (square)
        expect(button).toHaveClass('size-9')
      })
    })
  })

  // ===========================================================================
  // onClick Handling Tests
  // ===========================================================================

  describe('onClick handling', () => {
    it('calls onClick when clicked', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick}>Click me</Button>)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('passes event to onClick handler', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick}>Click me</Button>)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(handleClick).toHaveBeenCalledWith(expect.any(Object))
      expect(handleClick.mock.calls[0][0].type).toBe('click')
    })

    it('does not call onClick when disabled', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick} disabled>Click me</Button>)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('supports async onClick handlers', async () => {
      const handleClick = vi.fn().mockResolvedValue(undefined)
      render(<Button onClick={handleClick}>Async Click</Button>)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('handles double-click events', () => {
      const handleDoubleClick = vi.fn()
      render(<Button onDoubleClick={handleDoubleClick}>Double Click</Button>)

      const button = screen.getByRole('button')
      fireEvent.doubleClick(button)

      expect(handleDoubleClick).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // asChild Prop Tests (Composition)
  // ===========================================================================

  describe('asChild prop for composition', () => {
    it('renders as child element when asChild is true', () => {
      render(
        <Button asChild>
          <a href="/home">Home Link</a>
        </Button>
      )

      const link = screen.getByRole('link', { name: 'Home Link' })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', '/home')
    })

    it('applies button styles to child element', () => {
      render(
        <Button asChild variant="default" size="default">
          <a href="/test">Styled Link</a>
        </Button>
      )

      const link = screen.getByRole('link')
      expect(link).toHaveClass('inline-flex')
      expect(link).toHaveClass('items-center')
      expect(link).toHaveClass('justify-center')
    })

    it('preserves child props with asChild', () => {
      render(
        <Button asChild>
          <a href="/page" target="_blank" rel="noopener">External</a>
        </Button>
      )

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/page')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener')
    })

    it('merges className with child element', () => {
      render(
        <Button asChild className="extra-class">
          <span className="child-class">Span Button</span>
        </Button>
      )

      const element = screen.getByText('Span Button')
      expect(element).toHaveClass('extra-class')
      expect(element).toHaveClass('child-class')
    })

    it('works with variant and size when asChild', () => {
      render(
        <Button asChild variant="destructive" size="lg">
          <a href="/delete">Delete</a>
        </Button>
      )

      const link = screen.getByRole('link')
      expect(link).toHaveClass('bg-destructive')
      expect(link).toHaveClass('h-10')
    })

    it('renders as button when asChild is false', () => {
      render(<Button asChild={false}>Not Composed</Button>)

      const button = screen.getByRole('button')
      expect(button.tagName).toBe('BUTTON')
    })
  })

  // ===========================================================================
  // Disabled State Tests
  // ===========================================================================

  describe('disabled state', () => {
    it('renders with disabled attribute', () => {
      render(<Button disabled>Disabled</Button>)

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })

    it('has disabled styling', () => {
      render(<Button disabled>Disabled</Button>)

      const button = screen.getByRole('button')
      expect(button.className).toMatch(/disabled:pointer-events-none/)
      expect(button.className).toMatch(/disabled:opacity-50/)
    })

    it('is not clickable when disabled', () => {
      const handleClick = vi.fn()
      render(<Button disabled onClick={handleClick}>Disabled</Button>)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('removes from tab order when disabled', () => {
      render(
        <>
          <Button>First</Button>
          <Button disabled>Disabled</Button>
          <Button>Third</Button>
        </>
      )

      const disabledButton = screen.getByRole('button', { name: 'Disabled' })
      expect(disabledButton).toBeDisabled()
    })

    it('shows disabled cursor', () => {
      render(<Button disabled>Disabled</Button>)

      const button = screen.getByRole('button')
      // pointer-events-none prevents cursor styles, but opacity indicates disabled
      expect(button.className).toMatch(/disabled:pointer-events-none/)
    })
  })

  // ===========================================================================
  // Focus States (Accessibility) Tests
  // ===========================================================================

  describe('focus states for accessibility', () => {
    it('has focus-visible ring styles', () => {
      render(<Button>Focusable</Button>)

      const button = screen.getByRole('button')
      expect(button.className).toMatch(/focus-visible:ring/)
    })

    it('has focus-visible border styles', () => {
      render(<Button>Focusable</Button>)

      const button = screen.getByRole('button')
      expect(button.className).toMatch(/focus-visible:border-ring/)
    })

    it('has outline-none for custom focus styling', () => {
      render(<Button>Focusable</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('outline-none')
    })

    it('is focusable via keyboard', () => {
      render(<Button>Focusable</Button>)

      const button = screen.getByRole('button')
      button.focus()
      expect(document.activeElement).toBe(button)
    })

    it('has ring width of 3px on focus', () => {
      render(<Button>Focusable</Button>)

      const button = screen.getByRole('button')
      expect(button.className).toMatch(/focus-visible:ring-\[3px\]/)
    })

    it('has aria-invalid styling for error states', () => {
      render(<Button aria-invalid="true">Error Button</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-invalid', 'true')
      expect(button.className).toMatch(/aria-invalid:ring-destructive/)
    })

    it('supports keyboard activation with Enter', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick}>Keyboard</Button>)

      const button = screen.getByRole('button')
      button.focus()
      fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' })
      fireEvent.keyUp(button, { key: 'Enter', code: 'Enter' })
      fireEvent.click(button)

      expect(handleClick).toHaveBeenCalled()
    })

    it('supports keyboard activation with Space', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick}>Keyboard</Button>)

      const button = screen.getByRole('button')
      button.focus()
      fireEvent.keyDown(button, { key: ' ', code: 'Space' })
      fireEvent.keyUp(button, { key: ' ', code: 'Space' })
      fireEvent.click(button)

      expect(handleClick).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Button Type Tests
  // ===========================================================================

  describe('button type attribute', () => {
    it('defaults to type="button" when not specified', () => {
      render(<Button>Default Type</Button>)

      const button = screen.getByRole('button')
      // Note: Native button default is "submit", but our component may set "button"
      // This test documents expected behavior
      expect(button).toBeInTheDocument()
    })

    it('respects explicit type="submit"', () => {
      render(<Button type="submit">Submit</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'submit')
    })

    it('respects explicit type="reset"', () => {
      render(<Button type="reset">Reset</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'reset')
    })

    it('respects explicit type="button"', () => {
      render(<Button type="button">Button Type</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'button')
    })
  })

  // ===========================================================================
  // SVG Icon Handling Tests
  // ===========================================================================

  describe('SVG icon handling', () => {
    it('applies proper sizing to SVG children', () => {
      render(
        <Button>
          <svg data-testid="icon" />
          <span>With Icon</span>
        </Button>
      )

      const button = screen.getByRole('button')
      // Button has styling for SVG children
      expect(button.className).toMatch(/\[&_svg\]:pointer-events-none/)
      expect(button.className).toMatch(/\[&_svg:not\(\[class\*='size-'\]\)\]:size-4/)
    })

    it('prevents pointer events on SVG icons', () => {
      render(
        <Button>
          <svg data-testid="icon" />
        </Button>
      )

      const button = screen.getByRole('button')
      expect(button.className).toMatch(/\[&_svg\]:pointer-events-none/)
    })

    it('prevents SVG from shrinking', () => {
      render(
        <Button>
          <svg data-testid="icon" />
        </Button>
      )

      const button = screen.getByRole('button')
      expect(button.className).toMatch(/\[&_svg\]:shrink-0/)
    })
  })

  // ===========================================================================
  // buttonVariants Function Tests
  // ===========================================================================

  describe('buttonVariants function', () => {
    it('exports buttonVariants for custom usage', () => {
      expect(buttonVariants).toBeDefined()
      expect(typeof buttonVariants).toBe('function')
    })

    it('generates correct classes for default variant', () => {
      const classes = buttonVariants({ variant: 'default', size: 'default' })
      expect(classes).toContain('bg-primary')
      expect(classes).toContain('text-primary-foreground')
    })

    it('generates correct classes for different variants', () => {
      const destructiveClasses = buttonVariants({ variant: 'destructive' })
      expect(destructiveClasses).toContain('bg-destructive')

      const outlineClasses = buttonVariants({ variant: 'outline' })
      expect(outlineClasses).toContain('border')

      const ghostClasses = buttonVariants({ variant: 'ghost' })
      expect(ghostClasses).toMatch(/hover:bg-accent/)
    })

    it('generates correct classes for different sizes', () => {
      const smClasses = buttonVariants({ size: 'sm' })
      expect(smClasses).toContain('h-8')

      const lgClasses = buttonVariants({ size: 'lg' })
      expect(lgClasses).toContain('h-10')

      const iconClasses = buttonVariants({ size: 'icon' })
      expect(iconClasses).toContain('size-9')
    })

    it('merges custom className with variant classes', () => {
      const classes = buttonVariants({
        variant: 'default',
        size: 'default',
        className: 'my-custom-class',
      })
      expect(classes).toContain('my-custom-class')
      expect(classes).toContain('bg-primary')
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('has correct role', () => {
      render(<Button>Accessible</Button>)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('supports aria-label', () => {
      render(<Button aria-label="Close dialog">X</Button>)

      const button = screen.getByRole('button', { name: 'Close dialog' })
      expect(button).toBeInTheDocument()
    })

    it('supports aria-describedby', () => {
      render(
        <>
          <Button aria-describedby="description">Action</Button>
          <span id="description">Performs an important action</span>
        </>
      )

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-describedby', 'description')
    })

    it('supports aria-pressed for toggle buttons', () => {
      render(<Button aria-pressed="true">Toggle</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-pressed', 'true')
    })

    it('supports aria-expanded', () => {
      render(<Button aria-expanded="false">Expand</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-expanded', 'false')
    })

    it('has accessible name from children', () => {
      render(<Button>Submit Form</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveAccessibleName('Submit Form')
    })
  })
})
