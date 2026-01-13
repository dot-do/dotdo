/**
 * Settings Index Route
 *
 * Account settings page at /app/settings.
 *
 * Features:
 * - Profile editing with validation
 * - Theme preferences with live preview
 * - Keyboard navigation support
 * - Save/reset functionality
 */

import { createFileRoute } from '@tanstack/react-router'
import { useState, useCallback, useRef, useEffect } from 'react'
import { PageHeader } from '../_app'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { ThemeSelector } from '~/components/ui/theme-selector'

export const Route = createFileRoute('/app/settings/')({
  component: SettingsPage,
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
// Icons
// =============================================================================

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  )
}

function PaletteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  )
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  )
}

// =============================================================================
// Component
// =============================================================================

function SettingsPage() {
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Profile form state
  const [name, setName] = useState('John Doe')
  const [originalName, setOriginalName] = useState('John Doe')
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
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 800))

      // Success!
      setOriginalName(name)
      setSubmitStatus('success')

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

  return (
    <>
      <PageHeader />
      <div className="flex-1 overflow-auto p-4 pt-0">
        <div data-testid="app-page-title" className="mb-2">
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
        <p data-testid="app-page-description" className="text-muted-foreground mb-6">
          Manage your account and preferences
        </p>

        <div className="space-y-6 max-w-2xl">
          {/* Profile Section */}
          <section className="rounded-lg border bg-card p-6" data-testid="settings-profile-section">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <UserIcon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Profile</h2>
                <p className="text-sm text-muted-foreground">Update your personal information</p>
              </div>
            </div>

            {/* Success/Error feedback */}
            {submitStatus === 'success' && (
              <div
                className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200 text-sm"
                role="status"
                aria-live="polite"
                data-testid="settings-success-message"
              >
                <div className="flex items-center gap-2">
                  <CheckIcon className="w-4 h-4" />
                  <span>Your profile has been updated successfully.</span>
                </div>
              </div>
            )}

            {submitStatus === 'error' && (
              <div
                className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200 text-sm"
                role="alert"
                aria-live="assertive"
                data-testid="settings-error-message"
              >
                <div className="flex items-center gap-2">
                  <ErrorIcon className="w-4 h-4" />
                  <span>Failed to update profile. Please try again.</span>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate data-testid="settings-form-profile">
              {/* Avatar */}
              <div className="mb-4">
                <Label className="block text-sm font-medium mb-2">Photo</Label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-medium text-lg">
                    JD
                  </div>
                  <Button type="button" variant="outline" size="sm" data-testid="settings-avatar-change">
                    Change Photo
                  </Button>
                </div>
              </div>

              {/* Name Field */}
              <div className="mb-4">
                <Label
                  htmlFor="name"
                  className={`block text-sm font-medium mb-1 ${errors.name && touched.name ? 'text-destructive' : ''}`}
                >
                  Display Name <span className="text-destructive">*</span>
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
                  aria-describedby={errors.name && touched.name ? 'name-error' : 'name-help'}
                  className={errors.name && touched.name ? 'border-destructive' : ''}
                  data-testid="settings-input-name"
                  disabled={isSubmitting}
                  autoComplete="name"
                  placeholder="Enter your name"
                />
                {errors.name && touched.name ? (
                  <p id="name-error" className="text-sm text-destructive mt-1 flex items-center gap-1" role="alert">
                    <ErrorIcon className="w-4 h-4" />
                    {errors.name}
                  </p>
                ) : (
                  <p id="name-help" className="text-xs text-muted-foreground mt-1">
                    This is how you will appear across the application.
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
                  defaultValue="john@example.com"
                  readOnly
                  className="bg-muted cursor-not-allowed"
                  data-testid="settings-input-email"
                  disabled
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Contact support to change your email address.
                </p>
              </div>

              {/* Form Actions */}
              <div className="flex items-center gap-3">
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
                  <span className="text-sm text-muted-foreground ml-auto">Unsaved changes</span>
                )}
              </div>
            </form>
          </section>

          {/* Appearance Section */}
          <section className="rounded-lg border bg-card p-6" data-testid="settings-appearance-section">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <PaletteIcon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Appearance</h2>
                <p className="text-sm text-muted-foreground">Customize the look and feel</p>
              </div>
            </div>

            <div data-testid="settings-theme-selector">
              <ThemeSelector />
            </div>
          </section>

          {/* Keyboard Shortcuts Hint */}
          <div className="p-4 rounded-lg bg-muted/50">
            <p className="text-xs text-muted-foreground">
              Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Esc</kbd> to cancel changes.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
