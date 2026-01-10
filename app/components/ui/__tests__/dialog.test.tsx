/**
 * Dialog Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the Dialog component.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The Dialog component provides:
 * - Modal overlay with backdrop
 * - Open/close via trigger
 * - Escape key to close
 * - Overlay click to close
 * - Focus trapping within dialog
 * - Header, description, and footer slots
 * - onOpenChange callback
 *
 * @see app/components/ui/dialog.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '../dialog'

// =============================================================================
// Test Suite
// =============================================================================

describe('Dialog', () => {
  let onOpenChange: ReturnType<typeof vi.fn>
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    onOpenChange = vi.fn()
    user = userEvent.setup()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Open/Close Tests
  // ===========================================================================

  describe('opening and closing', () => {
    it('opens on trigger click', async () => {
      render(
        <Dialog>
          <DialogTrigger>Open Dialog</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )

      // Dialog content should not be visible initially
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      // Click the trigger
      await user.click(screen.getByRole('button', { name: 'Open Dialog' }))

      // Dialog should now be visible
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('closes on overlay click', async () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      // Dialog should be open
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Find and click the overlay (backdrop)
      const overlay = document.querySelector('[data-slot="dialog-overlay"]')
      expect(overlay).toBeInTheDocument()

      await user.click(overlay!)

      // Dialog should be closed
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('closes on escape key', async () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      // Dialog should be open
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Press Escape
      await user.keyboard('{Escape}')

      // Dialog should be closed
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('closes when close button is clicked', async () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      // Dialog should be open
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Find and click the close button (X button)
      const closeButton = screen.getByRole('button', { name: /close/i })
      await user.click(closeButton)

      // Dialog should be closed
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('closes when DialogClose component is clicked', async () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Test Dialog</DialogTitle>
            <DialogClose>Custom Close</DialogClose>
          </DialogContent>
        </Dialog>
      )

      // Dialog should be open
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Click the custom close button
      await user.click(screen.getByRole('button', { name: 'Custom Close' }))

      // Dialog should be closed
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Content Rendering Tests
  // ===========================================================================

  describe('content rendering', () => {
    it('renders header correctly', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>My Dialog Title</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )

      const header = document.querySelector('[data-slot="dialog-header"]')
      expect(header).toBeInTheDocument()
      expect(screen.getByText('My Dialog Title')).toBeInTheDocument()
    })

    it('renders description correctly', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Title</DialogTitle>
              <DialogDescription>This is a helpful description</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )

      const description = document.querySelector('[data-slot="dialog-description"]')
      expect(description).toBeInTheDocument()
      expect(screen.getByText('This is a helpful description')).toBeInTheDocument()
    })

    it('renders footer correctly', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            <DialogFooter>
              <button>Cancel</button>
              <button>Confirm</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )

      const footer = document.querySelector('[data-slot="dialog-footer"]')
      expect(footer).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    })

    it('renders all slots together', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Complete Dialog</DialogTitle>
              <DialogDescription>With all sections</DialogDescription>
            </DialogHeader>
            <div>Main content area</div>
            <DialogFooter>
              <button>Action</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )

      expect(screen.getByText('Complete Dialog')).toBeInTheDocument()
      expect(screen.getByText('With all sections')).toBeInTheDocument()
      expect(screen.getByText('Main content area')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
    })

    it('can hide close button with showCloseButton={false}', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent showCloseButton={false}>
            <DialogTitle>No Close Button</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      // The built-in close button should not be present
      // Note: There might not be any close button at all in this case
      const closeButtons = screen.queryAllByRole('button', { name: /close/i })
      expect(closeButtons.length).toBe(0)
    })
  })

  // ===========================================================================
  // onOpenChange Callback Tests
  // ===========================================================================

  describe('onOpenChange callback', () => {
    it('calls onOpenChange with true when opening', async () => {
      render(
        <Dialog onOpenChange={onOpenChange}>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>Test</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      await user.click(screen.getByRole('button', { name: 'Open' }))

      expect(onOpenChange).toHaveBeenCalledWith(true)
    })

    it('calls onOpenChange with false when closing via escape', async () => {
      render(
        <Dialog defaultOpen onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Test</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      await user.keyboard('{Escape}')

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('calls onOpenChange with false when closing via close button', async () => {
      render(
        <Dialog defaultOpen onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Test</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      const closeButton = screen.getByRole('button', { name: /close/i })
      await user.click(closeButton)

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('calls onOpenChange with false when closing via overlay click', async () => {
      render(
        <Dialog defaultOpen onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Test</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      const overlay = document.querySelector('[data-slot="dialog-overlay"]')
      await user.click(overlay!)

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('respects controlled open state', async () => {
      const ControlledDialog = () => {
        const [open, setOpen] = React.useState(false)
        return (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger>Open</DialogTrigger>
            <DialogContent>
              <DialogTitle>Controlled</DialogTitle>
            </DialogContent>
          </Dialog>
        )
      }

      render(<ControlledDialog />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Open' }))

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Focus Trapping Tests
  // ===========================================================================

  describe('focus trapping', () => {
    it('moves focus to dialog when opened', async () => {
      render(
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>Focus Test</DialogTitle>
            <input data-testid="dialog-input" />
          </DialogContent>
        </Dialog>
      )

      await user.click(screen.getByRole('button', { name: 'Open' }))

      await waitFor(() => {
        const dialog = screen.getByRole('dialog')
        // Focus should be within the dialog
        expect(dialog.contains(document.activeElement)).toBe(true)
      })
    })

    it('traps focus within dialog', async () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Focus Trap</DialogTitle>
            <input data-testid="first-input" />
            <input data-testid="second-input" />
            <button data-testid="dialog-button">Button</button>
          </DialogContent>
        </Dialog>
      )

      const dialog = screen.getByRole('dialog')
      const firstInput = screen.getByTestId('first-input')
      const secondInput = screen.getByTestId('second-input')
      const button = screen.getByTestId('dialog-button')

      // Tab through focusable elements
      firstInput.focus()
      expect(document.activeElement).toBe(firstInput)

      await user.tab()
      expect(document.activeElement).toBe(secondInput)

      await user.tab()
      expect(document.activeElement).toBe(button)

      // Should cycle back (focus trap)
      // Note: The close button may be in the tab order as well
      await user.tab()
      // Focus should remain within dialog
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    it('returns focus to trigger when closed', async () => {
      render(
        <Dialog>
          <DialogTrigger>Open Dialog</DialogTrigger>
          <DialogContent>
            <DialogTitle>Return Focus Test</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      const trigger = screen.getByRole('button', { name: 'Open Dialog' })

      // Open dialog
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Close with escape
      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // Focus should return to trigger
      expect(document.activeElement).toBe(trigger)
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('has proper role="dialog"', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Accessible Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('associates title with dialog via aria-labelledby', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      const dialog = screen.getByRole('dialog')
      const title = screen.getByText('Dialog Title')

      // Dialog should reference the title
      expect(dialog).toHaveAccessibleName('Dialog Title')
    })

    it('associates description with dialog via aria-describedby', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Title</DialogTitle>
              <DialogDescription>Dialog description text</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )

      const dialog = screen.getByRole('dialog')
      const description = screen.getByText('Dialog description text')

      // Dialog should have accessible description
      expect(dialog).toHaveAccessibleDescription('Dialog description text')
    })

    it('close button has accessible name', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Test</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      const closeButton = screen.getByRole('button', { name: /close/i })
      expect(closeButton).toHaveAccessibleName()
    })

    it('overlay has proper attributes', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Test</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      const overlay = document.querySelector('[data-slot="dialog-overlay"]')
      expect(overlay).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Data Slot Attribute Tests
  // ===========================================================================

  describe('data-slot attributes', () => {
    it('applies data-slot="dialog-content" to content', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Test</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      const content = document.querySelector('[data-slot="dialog-content"]')
      expect(content).toBeInTheDocument()
    })

    it('applies data-slot="dialog-header" to header', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )

      const header = document.querySelector('[data-slot="dialog-header"]')
      expect(header).toBeInTheDocument()
    })

    it('applies data-slot="dialog-footer" to footer', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Test</DialogTitle>
            <DialogFooter>Footer content</DialogFooter>
          </DialogContent>
        </Dialog>
      )

      const footer = document.querySelector('[data-slot="dialog-footer"]')
      expect(footer).toBeInTheDocument()
    })

    it('applies data-slot="dialog-title" to title', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Test Title</DialogTitle>
          </DialogContent>
        </Dialog>
      )

      const title = document.querySelector('[data-slot="dialog-title"]')
      expect(title).toBeInTheDocument()
    })

    it('applies data-slot="dialog-description" to description', () => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Test</DialogTitle>
            <DialogDescription>Test Description</DialogDescription>
          </DialogContent>
        </Dialog>
      )

      const description = document.querySelector('[data-slot="dialog-description"]')
      expect(description).toBeInTheDocument()
    })
  })
})
