/**
 * Admin Security Settings Route
 *
 * Password, 2FA, and session management with validation and UX polish.
 *
 * Features:
 * - Password validation with strength indicator
 * - Confirmation dialogs for destructive actions (session revocation)
 * - Success/error feedback
 * - Keyboard navigation support
 */

import { createFileRoute } from '@tanstack/react-router'
import { useState, useCallback, useRef, useMemo } from 'react'
import { Shell } from '~/components/ui/shell'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { ConfirmDialog } from '~/components/ui/confirm-dialog'
import { useToast } from '~/components/ui/toast'

export const Route = createFileRoute('/admin/settings/security')({
  component: SecuritySettingsPage,
})

// =============================================================================
// Types
// =============================================================================

interface Session {
  id: string
  device: string
  lastActive: string
  isCurrent: boolean
}

interface PasswordFormErrors {
  currentPassword?: string
  newPassword?: string
  confirmPassword?: string
}

// =============================================================================
// Validation
// =============================================================================

function validateCurrentPassword(password: string): string | undefined {
  if (!password) {
    return 'Current password is required'
  }
  return undefined
}

function validateNewPassword(password: string): string | undefined {
  if (!password) {
    return 'New password is required'
  }
  if (password.length < 8) {
    return 'Password must be at least 8 characters'
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter'
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter'
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number'
  }
  return undefined
}

function validateConfirmPassword(confirmPassword: string, newPassword: string): string | undefined {
  if (!confirmPassword) {
    return 'Please confirm your new password'
  }
  if (confirmPassword !== newPassword) {
    return 'Passwords do not match'
  }
  return undefined
}

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password)) score++
  if (/[a-z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  if (score <= 2) return { score, label: 'Weak', color: 'bg-red-500' }
  if (score <= 4) return { score, label: 'Fair', color: 'bg-yellow-500' }
  return { score, label: 'Strong', color: 'bg-green-500' }
}

// =============================================================================
// Component
// =============================================================================

function SecuritySettingsPage() {
  const toast = useToast()

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<PasswordFormErrors>({})
  const [passwordTouched, setPasswordTouched] = useState<Record<string, boolean>>({})
  const [isPasswordSubmitting, setIsPasswordSubmitting] = useState(false)
  const [passwordStatus, setPasswordStatus] = useState<'idle' | 'success' | 'error'>('idle')

  // Session state
  const [sessions, setSessions] = useState<Session[]>([
    { id: '1', device: 'Chrome on macOS', lastActive: 'Just now', isCurrent: true },
    { id: '2', device: 'Safari on iPhone', lastActive: '2 hours ago', isCurrent: false },
    { id: '3', device: 'Firefox on Windows', lastActive: '1 day ago', isCurrent: false },
  ])
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null)
  const [showRevokeDialog, setShowRevokeDialog] = useState(false)
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false)
  const [isRevokingAll, setIsRevokingAll] = useState(false)

  // 2FA state
  const [is2FAEnabled, setIs2FAEnabled] = useState(false)
  const [show2FADialog, setShow2FADialog] = useState(false)

  // Refs
  const currentPasswordRef = useRef<HTMLInputElement>(null)

  // Password strength indicator
  const passwordStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword])

  // ==========================================================================
  // Password handlers
  // ==========================================================================

  const handlePasswordBlur = useCallback((field: keyof PasswordFormErrors) => {
    setPasswordTouched((prev) => ({ ...prev, [field]: true }))

    let error: string | undefined
    switch (field) {
      case 'currentPassword':
        error = validateCurrentPassword(currentPassword)
        break
      case 'newPassword':
        error = validateNewPassword(newPassword)
        break
      case 'confirmPassword':
        error = validateConfirmPassword(confirmPassword, newPassword)
        break
    }

    setPasswordErrors((prev) => ({ ...prev, [field]: error }))
  }, [currentPassword, newPassword, confirmPassword])

  const handlePasswordChange = useCallback((
    field: keyof PasswordFormErrors,
    value: string,
    setter: (v: string) => void
  ) => {
    setter(value)
    setPasswordStatus('idle')

    if (passwordTouched[field]) {
      let error: string | undefined
      switch (field) {
        case 'currentPassword':
          error = validateCurrentPassword(value)
          break
        case 'newPassword':
          error = validateNewPassword(value)
          // Also re-validate confirm password when new password changes
          if (passwordTouched.confirmPassword) {
            const confirmError = validateConfirmPassword(confirmPassword, value)
            setPasswordErrors((prev) => ({ ...prev, newPassword: error, confirmPassword: confirmError }))
            return
          }
          break
        case 'confirmPassword':
          error = validateConfirmPassword(value, newPassword)
          break
      }
      setPasswordErrors((prev) => ({ ...prev, [field]: error }))
    }
  }, [passwordTouched, confirmPassword, newPassword])

  const handlePasswordSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate all fields
    const errors: PasswordFormErrors = {
      currentPassword: validateCurrentPassword(currentPassword),
      newPassword: validateNewPassword(newPassword),
      confirmPassword: validateConfirmPassword(confirmPassword, newPassword),
    }

    setPasswordErrors(errors)
    setPasswordTouched({ currentPassword: true, newPassword: true, confirmPassword: true })

    if (errors.currentPassword || errors.newPassword || errors.confirmPassword) {
      if (errors.currentPassword) currentPasswordRef.current?.focus()
      return
    }

    setIsPasswordSubmitting(true)
    setPasswordStatus('idle')

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))
      setPasswordStatus('success')
      toast.success('Your password has been updated successfully.')
      // Reset form on success
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordTouched({})
      setPasswordErrors({})

      setTimeout(() => setPasswordStatus('idle'), 3000)
    } catch (error) {
      setPasswordStatus('error')
      toast.error('Failed to update password. Please try again.')
    } finally {
      setIsPasswordSubmitting(false)
    }
  }, [currentPassword, newPassword, confirmPassword, toast])

  const handlePasswordReset = useCallback(() => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordErrors({})
    setPasswordTouched({})
    setPasswordStatus('idle')
  }, [])

  // ==========================================================================
  // Session handlers
  // ==========================================================================

  const handleRevokeSession = useCallback((sessionId: string) => {
    setRevokingSessionId(sessionId)
    setShowRevokeDialog(true)
  }, [])

  const confirmRevokeSession = useCallback(async () => {
    if (!revokingSessionId) return

    const sessionDevice = sessions.find((s) => s.id === revokingSessionId)?.device
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500))
    setSessions((prev) => prev.filter((s) => s.id !== revokingSessionId))
    setRevokingSessionId(null)
    toast.success(`Session on "${sessionDevice}" has been revoked.`)
  }, [revokingSessionId, sessions, toast])

  const handleRevokeAllSessions = useCallback(() => {
    setShowRevokeAllDialog(true)
  }, [])

  const confirmRevokeAllSessions = useCallback(async () => {
    setIsRevokingAll(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const revokedCount = sessions.filter((s) => !s.isCurrent).length
      setSessions((prev) => prev.filter((s) => s.isCurrent))
      toast.success(`${revokedCount} session${revokedCount !== 1 ? 's' : ''} revoked successfully.`)
    } finally {
      setIsRevokingAll(false)
    }
  }, [sessions, toast])

  // ==========================================================================
  // 2FA handlers
  // ==========================================================================

  const handle2FAToggle = useCallback(() => {
    if (is2FAEnabled) {
      setShow2FADialog(true)
    } else {
      // In real app, this would open 2FA setup flow
      setIs2FAEnabled(true)
      toast.success('Two-factor authentication has been enabled.')
    }
  }, [is2FAEnabled, toast])

  const confirm2FADisable = useCallback(async () => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500))
    setIs2FAEnabled(false)
    toast.warning('Two-factor authentication has been disabled.')
  }, [toast])

  // Helper to get session to revoke
  const sessionToRevoke = sessions.find((s) => s.id === revokingSessionId)
  const hasOtherSessions = sessions.some((s) => !s.isCurrent)

  const hasPasswordChanges = currentPassword || newPassword || confirmPassword

  return (
    <Shell>
      <div className='p-6' data-testid='settings-content'>
        <div className='mb-6'>
          <h1 className='text-2xl font-semibold'>Security Settings</h1>
          <p className='text-muted-foreground mt-1'>
            Manage your password, authentication, and active sessions.
          </p>
        </div>

        <div className='space-y-6'>
          {/* Password Section */}
          <div className='bg-card rounded-lg shadow p-6'>
            <h3 className='text-lg font-semibold mb-4'>Password</h3>

            {passwordStatus === 'success' && (
              <div
                className='mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200 text-sm'
                role='status'
                aria-live='polite'
                data-testid='password-success-message'
              >
                <div className='flex items-center gap-2'>
                  <svg className='w-4 h-4' fill='currentColor' viewBox='0 0 20 20' aria-hidden='true'>
                    <path fillRule='evenodd' d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z' clipRule='evenodd' />
                  </svg>
                  <span>Your password has been updated successfully.</span>
                </div>
              </div>
            )}

            {passwordStatus === 'error' && (
              <div
                className='mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200 text-sm'
                role='alert'
                aria-live='assertive'
                data-testid='password-error-message'
              >
                <div className='flex items-center gap-2'>
                  <svg className='w-4 h-4' fill='currentColor' viewBox='0 0 20 20' aria-hidden='true'>
                    <path fillRule='evenodd' d='M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z' clipRule='evenodd' />
                  </svg>
                  <span>Failed to update password. Please try again.</span>
                </div>
              </div>
            )}

            <form className='max-w-lg' data-testid='settings-form-password' onSubmit={handlePasswordSubmit} noValidate>
              {/* Current Password */}
              <div className='mb-4'>
                <Label
                  htmlFor='current-password'
                  className={`block text-sm font-medium mb-1 ${passwordErrors.currentPassword && passwordTouched.currentPassword ? 'text-destructive' : ''}`}
                >
                  Current Password <span className='text-destructive'>*</span>
                </Label>
                <Input
                  ref={currentPasswordRef}
                  type='password'
                  id='current-password'
                  name='currentPassword'
                  value={currentPassword}
                  onChange={(e) => handlePasswordChange('currentPassword', e.target.value, setCurrentPassword)}
                  onBlur={() => handlePasswordBlur('currentPassword')}
                  aria-invalid={passwordErrors.currentPassword && passwordTouched.currentPassword ? 'true' : 'false'}
                  aria-describedby={passwordErrors.currentPassword && passwordTouched.currentPassword ? 'current-password-error' : undefined}
                  className={`w-full ${passwordErrors.currentPassword && passwordTouched.currentPassword ? 'border-destructive' : ''}`}
                  data-testid='settings-input-current-password'
                  disabled={isPasswordSubmitting}
                  autoComplete='current-password'
                />
                {passwordErrors.currentPassword && passwordTouched.currentPassword && (
                  <p id='current-password-error' className='text-sm text-destructive mt-1' role='alert'>
                    {passwordErrors.currentPassword}
                  </p>
                )}
              </div>

              {/* New Password */}
              <div className='mb-4'>
                <Label
                  htmlFor='new-password'
                  className={`block text-sm font-medium mb-1 ${passwordErrors.newPassword && passwordTouched.newPassword ? 'text-destructive' : ''}`}
                >
                  New Password <span className='text-destructive'>*</span>
                </Label>
                <Input
                  type='password'
                  id='new-password'
                  name='newPassword'
                  value={newPassword}
                  onChange={(e) => handlePasswordChange('newPassword', e.target.value, setNewPassword)}
                  onBlur={() => handlePasswordBlur('newPassword')}
                  aria-invalid={passwordErrors.newPassword && passwordTouched.newPassword ? 'true' : 'false'}
                  aria-describedby='new-password-hint'
                  className={`w-full ${passwordErrors.newPassword && passwordTouched.newPassword ? 'border-destructive' : ''}`}
                  data-testid='settings-input-new-password'
                  disabled={isPasswordSubmitting}
                  autoComplete='new-password'
                />
                {passwordErrors.newPassword && passwordTouched.newPassword ? (
                  <p className='text-sm text-destructive mt-1' role='alert'>
                    {passwordErrors.newPassword}
                  </p>
                ) : (
                  <p id='new-password-hint' className='text-xs text-muted-foreground mt-1'>
                    At least 8 characters with uppercase, lowercase, and numbers.
                  </p>
                )}

                {/* Password Strength Indicator */}
                {newPassword && (
                  <div className='mt-2' data-testid='password-strength'>
                    <div className='flex items-center gap-2 text-xs'>
                      <span className='text-muted-foreground'>Strength:</span>
                      <div className='flex-1 h-1.5 bg-muted rounded-full overflow-hidden'>
                        <div
                          className={`h-full transition-all ${passwordStrength.color}`}
                          style={{ width: `${(passwordStrength.score / 6) * 100}%` }}
                        />
                      </div>
                      <span className={passwordStrength.score <= 2 ? 'text-red-600' : passwordStrength.score <= 4 ? 'text-yellow-600' : 'text-green-600'}>
                        {passwordStrength.label}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div className='mb-4'>
                <Label
                  htmlFor='confirm-password'
                  className={`block text-sm font-medium mb-1 ${passwordErrors.confirmPassword && passwordTouched.confirmPassword ? 'text-destructive' : ''}`}
                >
                  Confirm New Password <span className='text-destructive'>*</span>
                </Label>
                <Input
                  type='password'
                  id='confirm-password'
                  name='confirmPassword'
                  value={confirmPassword}
                  onChange={(e) => handlePasswordChange('confirmPassword', e.target.value, setConfirmPassword)}
                  onBlur={() => handlePasswordBlur('confirmPassword')}
                  aria-invalid={passwordErrors.confirmPassword && passwordTouched.confirmPassword ? 'true' : 'false'}
                  aria-describedby={passwordErrors.confirmPassword && passwordTouched.confirmPassword ? 'confirm-password-error' : undefined}
                  className={`w-full ${passwordErrors.confirmPassword && passwordTouched.confirmPassword ? 'border-destructive' : ''}`}
                  data-testid='settings-input-confirm-password'
                  disabled={isPasswordSubmitting}
                  autoComplete='new-password'
                />
                {passwordErrors.confirmPassword && passwordTouched.confirmPassword && (
                  <p id='confirm-password-error' className='text-sm text-destructive mt-1' role='alert'>
                    {passwordErrors.confirmPassword}
                  </p>
                )}
              </div>

              <div className='flex gap-3 pt-2'>
                <Button
                  type='submit'
                  data-testid='settings-save-button'
                  disabled={isPasswordSubmitting || !hasPasswordChanges}
                >
                  {isPasswordSubmitting ? (
                    <span className='flex items-center gap-2'>
                      <svg className='animate-spin h-4 w-4' fill='none' viewBox='0 0 24 24' aria-hidden='true'>
                        <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
                        <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z' />
                      </svg>
                      Updating...
                    </span>
                  ) : (
                    'Update Password'
                  )}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  data-testid='settings-cancel-button'
                  onClick={handlePasswordReset}
                  disabled={isPasswordSubmitting || !hasPasswordChanges}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>

          {/* 2FA Section */}
          <div className='bg-card rounded-lg shadow p-6' data-testid='settings-form-2fa'>
            <h3 className='text-lg font-semibold mb-4'>Two-Factor Authentication (2FA/MFA)</h3>
            <p className='text-muted-foreground mb-4'>Add an extra layer of security to your account.</p>
            <div className='flex items-center gap-4'>
              <div className='flex items-center gap-2'>
                <span
                  className={`w-2 h-2 rounded-full ${is2FAEnabled ? 'bg-green-500' : 'bg-gray-400'}`}
                  aria-hidden='true'
                />
                <span className='text-sm' data-testid='settings-2fa-status'>
                  Status: {is2FAEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <Button
                type='button'
                variant={is2FAEnabled ? 'outline' : 'default'}
                data-testid='settings-2fa-enable'
                onClick={handle2FAToggle}
              >
                {is2FAEnabled ? 'Disable 2FA' : 'Enable 2FA'}
              </Button>
            </div>
          </div>

          {/* Sessions Section */}
          <div className='bg-card rounded-lg shadow p-6' data-testid='settings-sessions'>
            <div className='flex items-center justify-between mb-4'>
              <div>
                <h3 className='text-lg font-semibold'>Active Sessions</h3>
                <p className='text-muted-foreground text-sm'>Manage devices and sessions where you're logged in.</p>
              </div>
              {hasOtherSessions && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground'
                  data-testid='settings-sessions-signout-all'
                  onClick={handleRevokeAllSessions}
                >
                  Sign Out All Others
                </Button>
              )}
            </div>
            <ul className='space-y-3' data-testid='settings-sessions-list'>
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className='flex items-center justify-between py-3 px-4 rounded-lg bg-muted/50'
                  data-testid='settings-session-item'
                >
                  <div className='flex items-center gap-3'>
                    <div className='w-10 h-10 rounded-full bg-muted flex items-center justify-center'>
                      <svg className='w-5 h-5 text-muted-foreground' fill='currentColor' viewBox='0 0 20 20' aria-hidden='true'>
                        <path fillRule='evenodd' d='M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z' clipRule='evenodd' />
                      </svg>
                    </div>
                    <div>
                      <p className='font-medium'>
                        {session.device}
                        {session.isCurrent && (
                          <span className='ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full'>
                            Current
                          </span>
                        )}
                      </p>
                      <p className='text-sm text-muted-foreground'>Last active: {session.lastActive}</p>
                    </div>
                  </div>
                  {!session.isCurrent && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:text-destructive hover:bg-destructive/10'
                      data-testid='settings-session-revoke'
                      onClick={() => handleRevokeSession(session.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Revoke Single Session Dialog */}
      <ConfirmDialog
        open={showRevokeDialog}
        onOpenChange={setShowRevokeDialog}
        title='Revoke Session'
        description={`Are you sure you want to sign out "${sessionToRevoke?.device}"? This will require re-authentication on that device.`}
        confirmLabel='Revoke Session'
        variant='destructive'
        onConfirm={confirmRevokeSession}
      />

      {/* Revoke All Sessions Dialog */}
      <ConfirmDialog
        open={showRevokeAllDialog}
        onOpenChange={setShowRevokeAllDialog}
        title='Sign Out All Other Sessions'
        description='Are you sure you want to sign out all other devices? This will require re-authentication on all those devices.'
        confirmLabel='Sign Out All'
        variant='destructive'
        onConfirm={confirmRevokeAllSessions}
        isLoading={isRevokingAll}
      />

      {/* Disable 2FA Dialog */}
      <ConfirmDialog
        open={show2FADialog}
        onOpenChange={setShow2FADialog}
        title='Disable Two-Factor Authentication'
        description='Are you sure you want to disable 2FA? Your account will be less secure without this additional protection.'
        confirmLabel='Disable 2FA'
        variant='destructive'
        onConfirm={confirm2FADisable}
      />
    </Shell>
  )
}
