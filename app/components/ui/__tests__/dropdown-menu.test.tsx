/**
 * DropdownMenu Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the DropdownMenu component.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The DropdownMenu component provides:
 * - Opens on trigger click
 * - Renders menu items
 * - Handles item selection
 * - Sub-menu support
 * - Closes on selection
 * - Keyboard navigation
 * - Checkbox and radio items
 * - Separators and labels
 *
 * @see app/components/ui/dropdown-menu.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
} from '../dropdown-menu'

// =============================================================================
// Test Suite
// =============================================================================

describe('DropdownMenu', () => {
  let onSelect: ReturnType<typeof vi.fn>
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    onSelect = vi.fn()
    user = userEvent.setup()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Opening Tests
  // ===========================================================================

  describe('opening', () => {
    it('opens on trigger click', async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuItem>Item 2</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      // Menu content should not be visible initially
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()

      // Click the trigger
      await user.click(screen.getByRole('button', { name: 'Open Menu' }))

      // Menu should now be visible
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })
    })

    it('opens with keyboard Enter on trigger', async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      const trigger = screen.getByRole('button', { name: 'Open Menu' })
      trigger.focus()

      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })
    })

    it('opens with keyboard Space on trigger', async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      const trigger = screen.getByRole('button', { name: 'Open Menu' })
      trigger.focus()

      await user.keyboard(' ')

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Menu Items Tests
  // ===========================================================================

  describe('menu items', () => {
    it('renders menu items', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
      })
    })

    it('renders menu items with icons', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>
              <span data-testid="icon">Icon</span>
              Edit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByTestId('icon')).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument()
      })
    })

    it('renders menu items with shortcuts', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>
              Save
              <DropdownMenuShortcut>Cmd+S</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByText('Cmd+S')).toBeInTheDocument()
      })
    })

    it('supports disabled items', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem disabled>Disabled Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        const item = screen.getByRole('menuitem', { name: 'Disabled Item' })
        expect(item).toHaveAttribute('data-disabled')
      })
    })

    it('supports destructive variant', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        const item = screen.getByRole('menuitem', { name: 'Delete' })
        expect(item).toHaveAttribute('data-variant', 'destructive')
      })
    })
  })

  // ===========================================================================
  // Selection Tests
  // ===========================================================================

  describe('selection', () => {
    it('handles item selection via click', async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onSelect}>Select Me</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await user.click(screen.getByRole('button', { name: 'Menu' }))

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: 'Select Me' }))

      expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('handles item selection via Enter key', async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onSelect}>Select Me</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await user.click(screen.getByRole('button', { name: 'Menu' }))

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Navigate to item and select with Enter
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{Enter}')

      expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('closes on selection', async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await user.click(screen.getByRole('button', { name: 'Menu' }))

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: 'Item' }))

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })
    })

    it('does not select disabled items', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem disabled onSelect={onSelect}>
              Disabled
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      const disabledItem = screen.getByRole('menuitem', { name: 'Disabled' })
      await user.click(disabledItem)

      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Sub-menu Tests
  // ===========================================================================

  describe('sub-menus', () => {
    it('renders sub-menu trigger', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More Options</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item 1</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /More Options/i })).toBeInTheDocument()
      })
    })

    it('opens sub-menu on hover', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More Options</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item 1</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      const subTrigger = screen.getByRole('menuitem', { name: /More Options/i })
      await user.hover(subTrigger)

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: 'Sub Item 1' })).toBeInTheDocument()
      })
    })

    it('opens sub-menu on ArrowRight', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More Options</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item 1</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Navigate to sub-menu trigger
      await user.keyboard('{ArrowDown}')
      // Open sub-menu
      await user.keyboard('{ArrowRight}')

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: 'Sub Item 1' })).toBeInTheDocument()
      })
    })

    it('closes sub-menu on ArrowLeft', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More Options</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item 1</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Open sub-menu
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{ArrowRight}')

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: 'Sub Item 1' })).toBeInTheDocument()
      })

      // Close sub-menu
      await user.keyboard('{ArrowLeft}')

      await waitFor(() => {
        expect(screen.queryByRole('menuitem', { name: 'Sub Item 1' })).not.toBeInTheDocument()
      })
    })

    it('sub-menu has chevron indicator', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More Options</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        const subTrigger = screen.getByRole('menuitem', { name: /More Options/i })
        // Should contain a chevron icon
        const chevron = subTrigger.querySelector('svg')
        expect(chevron).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Closing Tests
  // ===========================================================================

  describe('closing', () => {
    it('closes on Escape key', async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await user.click(screen.getByRole('button', { name: 'Menu' }))

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })
    })

    it('closes on click outside', async () => {
      render(
        <div>
          <button data-testid="outside">Outside Button</button>
          <DropdownMenu>
            <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )

      await user.click(screen.getByRole('button', { name: 'Menu' }))

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('outside'))

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Keyboard Navigation Tests
  // ===========================================================================

  describe('keyboard navigation', () => {
    it('navigates with ArrowDown', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuItem>Item 2</DropdownMenuItem>
            <DropdownMenuItem>Item 3</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      await user.keyboard('{ArrowDown}')

      // First item should be focused/highlighted
      const item1 = screen.getByRole('menuitem', { name: 'Item 1' })
      expect(item1).toHaveFocus()

      await user.keyboard('{ArrowDown}')

      const item2 = screen.getByRole('menuitem', { name: 'Item 2' })
      expect(item2).toHaveFocus()
    })

    it('navigates with ArrowUp', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuItem>Item 2</DropdownMenuItem>
            <DropdownMenuItem>Item 3</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Go down first
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{ArrowDown}')

      const item2 = screen.getByRole('menuitem', { name: 'Item 2' })
      expect(item2).toHaveFocus()

      // Navigate up
      await user.keyboard('{ArrowUp}')

      const item1 = screen.getByRole('menuitem', { name: 'Item 1' })
      expect(item1).toHaveFocus()
    })

    it('wraps navigation at boundaries', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuItem>Item 2</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Navigate to last item
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{ArrowDown}')

      const item2 = screen.getByRole('menuitem', { name: 'Item 2' })
      expect(item2).toHaveFocus()

      // Should wrap to first item
      await user.keyboard('{ArrowDown}')

      const item1 = screen.getByRole('menuitem', { name: 'Item 1' })
      expect(item1).toHaveFocus()
    })

    it('navigates to item by first letter', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Apple</DropdownMenuItem>
            <DropdownMenuItem>Banana</DropdownMenuItem>
            <DropdownMenuItem>Cherry</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Type 'b' to jump to Banana
      await user.keyboard('b')

      const banana = screen.getByRole('menuitem', { name: 'Banana' })
      expect(banana).toHaveFocus()
    })

    it('skips disabled items during navigation', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuItem disabled>Item 2 (disabled)</DropdownMenuItem>
            <DropdownMenuItem>Item 3</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      await user.keyboard('{ArrowDown}')

      const item1 = screen.getByRole('menuitem', { name: 'Item 1' })
      expect(item1).toHaveFocus()

      await user.keyboard('{ArrowDown}')

      // Should skip disabled item and go to Item 3
      const item3 = screen.getByRole('menuitem', { name: 'Item 3' })
      expect(item3).toHaveFocus()
    })

    it('navigates to first item with Home key', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuItem>Item 2</DropdownMenuItem>
            <DropdownMenuItem>Item 3</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Navigate to last item first
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{ArrowDown}')

      // Press Home to go to first
      await user.keyboard('{Home}')

      const item1 = screen.getByRole('menuitem', { name: 'Item 1' })
      expect(item1).toHaveFocus()
    })

    it('navigates to last item with End key', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuItem>Item 2</DropdownMenuItem>
            <DropdownMenuItem>Item 3</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      await user.keyboard('{End}')

      const item3 = screen.getByRole('menuitem', { name: 'Item 3' })
      expect(item3).toHaveFocus()
    })
  })

  // ===========================================================================
  // Checkbox Items Tests
  // ===========================================================================

  describe('checkbox items', () => {
    it('renders checkbox items', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked>Show Status Bar</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitemcheckbox', { name: 'Show Status Bar' })).toBeInTheDocument()
      })
    })

    it('toggles checkbox on click', async () => {
      const onCheckedChange = vi.fn()

      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
              Toggle Me
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await user.click(screen.getByRole('button', { name: 'Menu' }))

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Toggle Me' }))

      expect(onCheckedChange).toHaveBeenCalledWith(true)
    })

    it('displays check indicator when checked', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked>Checked Item</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        const checkbox = screen.getByRole('menuitemcheckbox', { name: 'Checked Item' })
        expect(checkbox).toHaveAttribute('data-state', 'checked')
      })
    })
  })

  // ===========================================================================
  // Radio Items Tests
  // ===========================================================================

  describe('radio items', () => {
    it('renders radio group with items', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="medium">
              <DropdownMenuRadioItem value="small">Small</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="large">Large</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitemradio', { name: 'Small' })).toBeInTheDocument()
        expect(screen.getByRole('menuitemradio', { name: 'Medium' })).toBeInTheDocument()
        expect(screen.getByRole('menuitemradio', { name: 'Large' })).toBeInTheDocument()
      })
    })

    it('selects radio item on click', async () => {
      const onValueChange = vi.fn()

      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="small" onValueChange={onValueChange}>
              <DropdownMenuRadioItem value="small">Small</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="large">Large</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await user.click(screen.getByRole('button', { name: 'Menu' }))

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitemradio', { name: 'Large' }))

      expect(onValueChange).toHaveBeenCalledWith('large')
    })

    it('displays indicator for selected radio item', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="medium">
              <DropdownMenuRadioItem value="small">Small</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        const mediumItem = screen.getByRole('menuitemradio', { name: 'Medium' })
        expect(mediumItem).toHaveAttribute('data-state', 'checked')

        const smallItem = screen.getByRole('menuitemradio', { name: 'Small' })
        expect(smallItem).toHaveAttribute('data-state', 'unchecked')
      })
    })
  })

  // ===========================================================================
  // Labels and Separators Tests
  // ===========================================================================

  describe('labels and separators', () => {
    it('renders menu label', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuItem>Profile</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByText('My Account')).toBeInTheDocument()
      })
    })

    it('renders separator', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Item 2</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        const separator = document.querySelector('[data-slot="dropdown-menu-separator"]')
        expect(separator).toBeInTheDocument()
      })
    })

    it('renders groups', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Group 1</DropdownMenuLabel>
              <DropdownMenuItem>Item 1a</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Group 2</DropdownMenuLabel>
              <DropdownMenuItem>Item 2a</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByText('Group 1')).toBeInTheDocument()
        expect(screen.getByText('Group 2')).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Item 1a' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Item 2a' })).toBeInTheDocument()
      })
    })

    it('supports inset label', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel inset>Inset Label</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        const label = document.querySelector('[data-slot="dropdown-menu-label"]')
        expect(label).toHaveAttribute('data-inset', 'true')
      })
    })
  })

  // ===========================================================================
  // Data Slot Attribute Tests
  // ===========================================================================

  describe('data-slot attributes', () => {
    it('applies data-slot="dropdown-menu-content" to content', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        const content = document.querySelector('[data-slot="dropdown-menu-content"]')
        expect(content).toBeInTheDocument()
      })
    })

    it('applies data-slot="dropdown-menu-item" to items', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        const item = document.querySelector('[data-slot="dropdown-menu-item"]')
        expect(item).toBeInTheDocument()
      })
    })

    it('applies data-slot="dropdown-menu-trigger" to trigger', () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      const trigger = document.querySelector('[data-slot="dropdown-menu-trigger"]')
      expect(trigger).toBeInTheDocument()
    })

    it('applies data-slot="dropdown-menu-sub-trigger" to sub-trigger', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Sub Menu</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        const subTrigger = document.querySelector('[data-slot="dropdown-menu-sub-trigger"]')
        expect(subTrigger).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('has proper role="menu" on content', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })
    })

    it('has proper role="menuitem" on items', async () => {
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: 'Item' })).toBeInTheDocument()
      })
    })

    it('trigger has aria-expanded attribute', async () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      const trigger = screen.getByRole('button', { name: 'Menu' })
      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      await user.click(trigger)

      await waitFor(() => {
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
      })
    })

    it('trigger has aria-haspopup="menu"', () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      const trigger = screen.getByRole('button', { name: 'Menu' })
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    })
  })
})
