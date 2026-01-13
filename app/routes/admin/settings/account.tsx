/**
 * Admin Account Settings Route
 *
 * User profile and account settings with validation and UX polish.
 *
 * Features:
 * - Form validation with helpful error messages
 * - Optimistic updates with loading states
 * - Success/error toast notifications
 * - Keyboard navigation support (Enter to submit, Escape to cancel)
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useCallback, useRef, useEffect } from 'react'
import { Shell, UserProfile } from '~/components/ui/shell'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

export const Route = createFileRoute('/admin/settings/account')({
  component: AccountSettingsPage,
})

// =============================================================================
// Validation
// =============================================================================

interface FormErrors {
  name?: string
}

function validateName(name: string): string | undefined {
  if (!name.trim()) {
    return 'Name is required'
  }
  if (name.trim().length < 2) {
    return 'Name must be at least 2 characters'
  }
  if (name.trim().length > 100) {
    return 'Name must be less than 100 characters'
  }
  return undefined
}

// =============================================================================
// Component
// =============================================================================

function AccountSettingsPage() {
  const navigate = useNavigate()
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [name, setName] = useState('John Doe')
  const [originalName] = useState('John Doe')
  const [errors, setErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')

  // Track if form has unsaved changes
  const hasChanges = name !== originalName

  // Validate on blur
  const handleNameBlur = useCallback(() => {
    setTouched((prev) => ({ ...prev, name: true }))
    const error = validateName(name)
    setErrors((prev) => ({ ...prev, name: error }))
  }, [name])

  // Validate on change after touched
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)
    setSubmitStatus('idle')

    if (touched.name) {
      const error = validateName(newName)
      setErrors((prev) => ({ ...prev, name: error }))
    }
  }, [touched.name])

  // Handle form submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate all fields
    const nameError = validateName(name)
    setErrors({ name: nameError })
    setTouched({ name: true })

    if (nameError) {
      nameInputRef.current?.focus()
      return
    }

    setIsSubmitting(true)
    setSubmitStatus('idle')

    try {
      // Simulate API call with optimistic update
      await new Promise((resolve) => setTimeout(resolve, 800))

      // Success!
      setSubmitStatus('success')

      // Clear success status after a delay
      setTimeout(() => setSubmitStatus('idle'), 3000)
    } catch (error) {
      setSubmitStatus('error')
    } finally {
      setIsSubmitting(false)
    }
  }, [name])

  // Handle cancel - reset to original values
  const handleCancel = useCallback(() => {
    setName(originalName)
    setErrors({})
    setTouched({})
    setSubmitStatus('idle')
  }, [originalName])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel()
    }
  }, [handleCancel])

  // Focus name input on mount
  useEffect(() => {
    nameInputRef.current?.focus()
  }, [])

  return (
    <Shell>
      <div className="p-6" data-testid="settings-content">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Account Settings</h1>
          <p className="text-muted-foreground mt-1">
            Manage your profile information and preferences.
          </p>
        </div>

        {/* Success/Error feedback banner */}
        {submitStatus === 'success' && (
          <div
            className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200"
            role="status"
            aria-live="polite"
            data-testid="settings-success-message"
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">Your changes have been saved successfully.</span>
            </div>
          </div>
        )}

        {submitStatus === 'error' && (
          <div
            className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200"
            role="alert"
            aria-live="assertive"
            data-testid="settings-error-message"
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">Failed to save changes. Please try again.</span>
            </div>
          </div>
        )}

        <form
          className="bg-card rounded-lg shadow p-6 max-w-lg"
          data-testid="settings-form-account"
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          noValidate
        >
          {/* Profile Photo Section */}
          <div className="mb-6">
            <Label htmlFor="avatar" className="block text-sm font-medium mb-2">
              Profile Photo
            </Label>
            <div className="flex items-center gap-4">
              <img
                src="/avatar.png"
                alt="Current avatar"
                className="w-16 h-16 rounded-full object-cover border-2 border-muted"
                data-testid="settings-avatar"
              />
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" size="sm" data-testid="settings-avatar-change">
                  Change Photo
                </Button>
                <span className="text-xs text-muted-foreground">
                  JPG, PNG or GIF. Max 2MB.
                </span>
              </div>
            </div>
          </div>

          {/* Name Field */}
          <div className="mb-4">
            <Label
              htmlFor="name"
              className={`block text-sm font-medium mb-1 ${errors.name && touched.name ? 'text-destructive' : ''}`}
            >
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              ref={nameInputRef}
              type="text"
              id="name"
              name="name"
              value={name}
              onChange={handleNameChange}
              onBlur={handleNameBlur}
              aria-invalid={errors.name && touched.name ? 'true' : 'false'}
              aria-describedby={errors.name && touched.name ? 'name-error' : undefined}
              className={`w-full ${errors.name && touched.name ? 'border-destructive focus:ring-destructive' : ''}`}
              data-testid="settings-input-name"
              disabled={isSubmitting}
              autoComplete="name"
            />
            {errors.name && touched.name && (
              <p
                id="name-error"
                className="text-sm text-destructive mt-1 flex items-center gap-1"
                role="alert"
                data-testid="settings-name-error"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {errors.name}
              </p>
            )}
          </div>

          {/* Email Field (Read-only) */}
          <div className="mb-6">
            <Label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </Label>
            <Input
              type="email"
              id="email"
              name="email"
              defaultValue="john@example.com.ai"
              readOnly
              className="w-full bg-muted cursor-not-allowed"
              data-testid="settings-input-email"
              disabled
            />
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              Contact support to change your email address.
            </p>
          </div>

          {/* Form Actions */}
          <div className="flex items-center gap-3 pt-4 border-t">
            <Button
              type="submit"
              data-testid="settings-save-button"
              disabled={isSubmitting || !hasChanges || !!errors.name}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Saving...
                </span>
              ) : (
                'Save Changes'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="settings-cancel-button"
              onClick={handleCancel}
              disabled={isSubmitting || !hasChanges}
            >
              Cancel
            </Button>
            {hasChanges && !errors.name && (
              <span className="text-sm text-muted-foreground ml-auto">
                You have unsaved changes
              </span>
            )}
          </div>
        </form>

        {/* Keyboard shortcuts hint */}
        <p className="text-xs text-muted-foreground mt-4 max-w-lg">
          Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Esc</kbd> to cancel changes.
        </p>
      </div>
    </Shell>
  )
}
