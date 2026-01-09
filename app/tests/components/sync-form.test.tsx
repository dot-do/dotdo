/**
 * SyncForm Component Tests (TDD RED Phase)
 *
 * These tests define the contract for the SyncForm component.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The SyncForm component provides:
 * - Form rendering with TanStack Form integration
 * - Multiple field types (text, email, select, checkbox, textarea)
 * - Validation error display
 * - Loading/submitting states
 * - Submit and cancel handlers
 *
 * @see app/components/sync/sync-form.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// Import component under test
import { SyncForm, type FieldConfig, type MinimalFormApi } from '../../components/sync/sync-form'

// =============================================================================
// Mock Form API
// =============================================================================

interface TestFormData {
  name: string
  email: string
  role: string
  status: string
  bio: string
  active: boolean
}

/**
 * Creates a mock TanStack Form API for testing
 */
function createMockFormApi(values: Partial<TestFormData> = {}): MinimalFormApi<TestFormData> {
  const state = {
    values: {
      name: '',
      email: '',
      role: '',
      status: '',
      bio: '',
      active: false,
      ...values,
    },
    isSubmitting: false,
    canSubmit: true,
  }

  const fieldMeta: Record<string, { errors?: string[]; isTouched?: boolean }> = {}

  // Mock Field component
  const Field: React.FC<{
    name: string
    children: (field: {
      name: string
      state: { value: unknown; meta: { errors?: string[]; isTouched?: boolean } }
      handleChange: (value: unknown) => void
      handleBlur: () => void
    }) => React.ReactNode
  }> = ({ name, children }) => {
    const value = state.values[name as keyof TestFormData]
    return (
      <>
        {children({
          name,
          state: {
            value,
            meta: fieldMeta[name] || {},
          },
          handleChange: vi.fn(),
          handleBlur: vi.fn(),
        })}
      </>
    )
  }

  return {
    state,
    Field,
  }
}

/**
 * Creates a mock form API with field errors
 */
function createMockFormApiWithErrors(
  values: Partial<TestFormData>,
  errors: Record<string, string[]>
): MinimalFormApi<TestFormData> {
  const form = createMockFormApi(values)

  // Override Field to include errors
  const OriginalField = form.Field
  form.Field = ({ name, children }) => {
    const value = form.state.values[name as keyof TestFormData]
    return (
      <>
        {children({
          name,
          state: {
            value,
            meta: {
              errors: errors[name] || [],
              isTouched: true,
            },
          },
          handleChange: vi.fn(),
          handleBlur: vi.fn(),
        })}
      </>
    )
  }

  return form
}

// =============================================================================
// Test Fixtures
// =============================================================================

const basicFields: FieldConfig[] = [
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
]

const allFieldTypes: FieldConfig[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Enter name' },
  { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'Enter email' },
  {
    name: 'role',
    label: 'Role',
    type: 'select',
    options: [
      { value: 'admin', label: 'Admin' },
      { value: 'user', label: 'User' },
      { value: 'viewer', label: 'Viewer' },
    ],
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'Active', label: 'Active' },
      { value: 'Inactive', label: 'Inactive' },
    ],
    description: 'User account status',
  },
  { name: 'bio', label: 'Biography', type: 'textarea', placeholder: 'Tell us about yourself' },
  { name: 'active', label: 'Active Account', type: 'checkbox' },
]

// =============================================================================
// Test Suite
// =============================================================================

describe('SyncForm', () => {
  let mockForm: MinimalFormApi<TestFormData>
  let onSubmit: ReturnType<typeof vi.fn>
  let onCancel: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockForm = createMockFormApi()
    onSubmit = vi.fn()
    onCancel = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders form element', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      expect(screen.getByRole('form')).toBeInTheDocument()
    })

    it('renders all field labels', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      expect(screen.getByText('Name')).toBeInTheDocument()
      expect(screen.getByText('Email')).toBeInTheDocument()
    })

    it('renders required indicator for required fields', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      // Required indicator (*) should be present
      const nameLabel = screen.getByText('Name')
      const container = nameLabel.closest('label') || nameLabel.parentElement
      expect(container?.textContent).toContain('*')
    })

    it('renders submit button with default label', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    })

    it('renders submit button with custom label', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
          submitLabel="Save User"
        />
      )

      expect(screen.getByRole('button', { name: 'Save User' })).toBeInTheDocument()
    })

    it('renders cancel button when onCancel is provided', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })

    it('renders cancel button with custom label', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
          onCancel={onCancel}
          cancelLabel="Go Back"
        />
      )

      expect(screen.getByRole('button', { name: 'Go Back' })).toBeInTheDocument()
    })

    it('does not render cancel button when onCancel is not provided', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    it('applies custom className to form', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
          className="custom-form-class"
        />
      )

      const form = screen.getByRole('form')
      expect(form).toHaveClass('custom-form-class')
    })
  })

  // ===========================================================================
  // Field Type Tests
  // ===========================================================================

  describe('field types', () => {
    describe('text input', () => {
      it('renders text input field', () => {
        render(
          <SyncForm
            form={mockForm}
            fields={[{ name: 'name', label: 'Name', type: 'text' }]}
            onSubmit={onSubmit}
          />
        )

        const input = screen.getByRole('textbox', { name: /name/i })
        expect(input).toBeInTheDocument()
        expect(input).toHaveAttribute('type', 'text')
      })

      it('renders text input with placeholder', () => {
        render(
          <SyncForm
            form={mockForm}
            fields={[{ name: 'name', label: 'Name', type: 'text', placeholder: 'Enter name' }]}
            onSubmit={onSubmit}
          />
        )

        expect(screen.getByPlaceholderText('Enter name')).toBeInTheDocument()
      })
    })

    describe('email input', () => {
      it('renders email input field', () => {
        render(
          <SyncForm
            form={mockForm}
            fields={[{ name: 'email', label: 'Email', type: 'email' }]}
            onSubmit={onSubmit}
          />
        )

        const input = screen.getByRole('textbox', { name: /email/i })
        expect(input).toBeInTheDocument()
        expect(input).toHaveAttribute('type', 'email')
      })
    })

    describe('password input', () => {
      it('renders password input field', () => {
        render(
          <SyncForm
            form={mockForm}
            fields={[{ name: 'password', label: 'Password', type: 'password' }]}
            onSubmit={onSubmit}
          />
        )

        // Password inputs don't have 'textbox' role
        const input = document.querySelector('input[type="password"]')
        expect(input).toBeInTheDocument()
      })
    })

    describe('number input', () => {
      it('renders number input field', () => {
        render(
          <SyncForm
            form={mockForm}
            fields={[{ name: 'age', label: 'Age', type: 'number' }]}
            onSubmit={onSubmit}
          />
        )

        const input = screen.getByRole('spinbutton', { name: /age/i })
        expect(input).toBeInTheDocument()
        expect(input).toHaveAttribute('type', 'number')
      })
    })

    describe('textarea', () => {
      it('renders textarea field', () => {
        render(
          <SyncForm
            form={mockForm}
            fields={[{ name: 'bio', label: 'Biography', type: 'textarea' }]}
            onSubmit={onSubmit}
          />
        )

        const textarea = screen.getByRole('textbox', { name: /biography/i })
        expect(textarea).toBeInTheDocument()
        expect(textarea.tagName.toLowerCase()).toBe('textarea')
      })

      it('renders textarea with placeholder', () => {
        render(
          <SyncForm
            form={mockForm}
            fields={[{ name: 'bio', label: 'Biography', type: 'textarea', placeholder: 'Tell us about yourself' }]}
            onSubmit={onSubmit}
          />
        )

        expect(screen.getByPlaceholderText('Tell us about yourself')).toBeInTheDocument()
      })
    })

    describe('select', () => {
      it('renders select field', () => {
        render(
          <SyncForm
            form={mockForm}
            fields={[
              {
                name: 'role',
                label: 'Role',
                type: 'select',
                options: [
                  { value: 'admin', label: 'Admin' },
                  { value: 'user', label: 'User' },
                ],
              },
            ]}
            onSubmit={onSubmit}
          />
        )

        // Select component might render as a button/trigger
        const select = screen.getByRole('combobox', { name: /role/i })
        expect(select).toBeInTheDocument()
      })

      it('renders all select options when opened', async () => {
        
        render(
          <SyncForm
            form={mockForm}
            fields={[
              {
                name: 'role',
                label: 'Role',
                type: 'select',
                options: [
                  { value: 'admin', label: 'Admin' },
                  { value: 'user', label: 'User' },
                  { value: 'viewer', label: 'Viewer' },
                ],
              },
            ]}
            onSubmit={onSubmit}
          />
        )

        const select = screen.getByRole('combobox', { name: /role/i })
        fireEvent.click(select)

        await waitFor(() => {
          expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument()
          expect(screen.getByRole('option', { name: 'User' })).toBeInTheDocument()
          expect(screen.getByRole('option', { name: 'Viewer' })).toBeInTheDocument()
        })
      })
    })

    describe('checkbox', () => {
      it('renders checkbox field', () => {
        render(
          <SyncForm
            form={mockForm}
            fields={[{ name: 'active', label: 'Active Account', type: 'checkbox' }]}
            onSubmit={onSubmit}
          />
        )

        const checkbox = screen.getByRole('checkbox', { name: /active account/i })
        expect(checkbox).toBeInTheDocument()
      })

      it('checkbox label is associated with checkbox', () => {
        render(
          <SyncForm
            form={mockForm}
            fields={[{ name: 'active', label: 'Active Account', type: 'checkbox' }]}
            onSubmit={onSubmit}
          />
        )

        const checkbox = screen.getByRole('checkbox', { name: /active account/i })
        expect(checkbox).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Field Description Tests
  // ===========================================================================

  describe('field descriptions', () => {
    it('renders field description when provided', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={[
            {
              name: 'email',
              label: 'Email',
              type: 'email',
              description: 'We will never share your email',
            },
          ]}
          onSubmit={onSubmit}
        />
      )

      expect(screen.getByText('We will never share your email')).toBeInTheDocument()
    })

    it('does not render description element when not provided', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={[{ name: 'email', label: 'Email', type: 'email' }]}
          onSubmit={onSubmit}
        />
      )

      // Only the label and input should be present, no description
      const emailContainer = screen.getByText('Email').closest('div')
      const descriptions = emailContainer?.querySelectorAll('p.text-muted-foreground')
      expect(descriptions?.length || 0).toBe(0)
    })
  })

  // ===========================================================================
  // Disabled State Tests
  // ===========================================================================

  describe('disabled state', () => {
    it('disables fields when field config has disabled: true', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={[{ name: 'name', label: 'Name', type: 'text', disabled: true }]}
          onSubmit={onSubmit}
        />
      )

      const input = screen.getByRole('textbox', { name: /name/i })
      expect(input).toBeDisabled()
    })

    it('disables all fields when isSubmitting is true', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
          isSubmitting={true}
        />
      )

      const inputs = screen.getAllByRole('textbox')
      inputs.forEach((input) => {
        expect(input).toBeDisabled()
      })
    })

    it('disables submit button when isSubmitting is true', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
          isSubmitting={true}
        />
      )

      expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
    })

    it('disables cancel button when isSubmitting is true', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
          onCancel={onCancel}
          isSubmitting={true}
        />
      )

      expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
    })

    it('shows loading spinner in submit button when isSubmitting', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
          isSubmitting={true}
        />
      )

      // Should have loading spinner (Loader2 icon)
      const submitButton = screen.getByRole('button', { name: /submit/i })
      const spinner = submitButton.querySelector('svg.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Validation Error Tests
  // ===========================================================================

  describe('validation errors', () => {
    it('displays field error message', () => {
      const formWithErrors = createMockFormApiWithErrors(
        { name: '', email: '' },
        { name: ['Name is required'] }
      )

      render(
        <SyncForm
          form={formWithErrors}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      expect(screen.getByText('Name is required')).toBeInTheDocument()
    })

    it('displays multiple errors joined', () => {
      const formWithErrors = createMockFormApiWithErrors(
        { email: 'invalid' },
        { email: ['Invalid email format', 'Email must be unique'] }
      )

      render(
        <SyncForm
          form={formWithErrors}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      expect(screen.getByText('Invalid email format, Email must be unique')).toBeInTheDocument()
    })

    it('error message has role="alert"', () => {
      const formWithErrors = createMockFormApiWithErrors(
        { name: '' },
        { name: ['Name is required'] }
      )

      render(
        <SyncForm
          form={formWithErrors}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('applies error styling to label when field has error', () => {
      const formWithErrors = createMockFormApiWithErrors(
        { name: '' },
        { name: ['Name is required'] }
      )

      render(
        <SyncForm
          form={formWithErrors}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      const label = screen.getByText('Name')
      expect(label).toHaveClass('text-destructive')
    })

    it('sets aria-invalid on input with error', () => {
      const formWithErrors = createMockFormApiWithErrors(
        { name: '' },
        { name: ['Name is required'] }
      )

      render(
        <SyncForm
          form={formWithErrors}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      const input = screen.getByRole('textbox', { name: /name/i })
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })
  })

  // ===========================================================================
  // Submit Handler Tests
  // ===========================================================================

  describe('submit handler', () => {
    it('calls onSubmit when form is submitted', async () => {
      
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('prevents default form submission', async () => {
      
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      const form = screen.getByRole('form')
      const submitEvent = vi.fn()
      form.addEventListener('submit', submitEvent)

      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

      // Form submission should be handled, not propagated
      expect(onSubmit).toHaveBeenCalled()
    })

    it('handles async onSubmit', async () => {
            const asyncOnSubmit = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={asyncOnSubmit}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

      expect(asyncOnSubmit).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // Cancel Handler Tests
  // ===========================================================================

  describe('cancel handler', () => {
    it('calls onCancel when cancel button is clicked', async () => {
      
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('cancel button has type="button" to prevent form submission', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      expect(cancelButton).toHaveAttribute('type', 'button')
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('labels are associated with inputs via htmlFor', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      const nameInput = screen.getByRole('textbox', { name: /name/i })
      const emailInput = screen.getByRole('textbox', { name: /email/i })

      expect(nameInput).toHaveAccessibleName()
      expect(emailInput).toHaveAccessibleName()
    })

    it('submit button has type="submit"', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={basicFields}
          onSubmit={onSubmit}
        />
      )

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      expect(submitButton).toHaveAttribute('type', 'submit')
    })

    it('required inputs have required attribute', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={[{ name: 'name', label: 'Name', type: 'text', required: true }]}
          onSubmit={onSubmit}
        />
      )

      const input = screen.getByRole('textbox', { name: /name/i })
      expect(input).toHaveAttribute('required')
    })

    it('form has proper structure for screen readers', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={allFieldTypes}
          onSubmit={onSubmit}
        />
      )

      // Form should be navigable
      expect(screen.getByRole('form')).toBeInTheDocument()

      // All form controls should be labeled
      const textInputs = screen.getAllByRole('textbox')
      textInputs.forEach((input) => {
        expect(input).toHaveAccessibleName()
      })
    })
  })

  // ===========================================================================
  // Integration with all field types
  // ===========================================================================

  describe('integration with all field types', () => {
    it('renders form with all field types correctly', () => {
      render(
        <SyncForm
          form={mockForm}
          fields={allFieldTypes}
          onSubmit={onSubmit}
        />
      )

      // Text input
      expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument()

      // Email input
      expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument()

      // Select (role combobox)
      expect(screen.getAllByRole('combobox')).toHaveLength(2) // Role and Status

      // Textarea (bio)
      expect(screen.getByRole('textbox', { name: /biography/i })).toBeInTheDocument()

      // Checkbox
      expect(screen.getByRole('checkbox', { name: /active account/i })).toBeInTheDocument()
    })
  })
})
