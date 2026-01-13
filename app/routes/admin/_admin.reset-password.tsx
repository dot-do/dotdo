'use client'

/**
 * Admin Password Reset Route
 *
 * Password recovery page for admin users.
 * Uses custom auth components with data-testid attributes for E2E testing.
 */

import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AuthLayout, PasswordResetForm } from '~/components/auth'

export const Route = createFileRoute('/admin/_admin/reset-password')({
  component: AdminResetPassword,
})

function AdminResetPassword() {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const handleRequestSubmit = async (data: { email: string }) => {
    setIsLoading(true)
    setError(undefined)

    try {
      // Simulate API call to send reset email
      await new Promise((resolve) => setTimeout(resolve, 1000))
      console.log('Reset email sent to:', data.email)
      // Success - form will show confirmation
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email')
    } finally {
      setIsLoading(false)
    }
  }

  const handleConfirmSubmit = async (data: { password: string; confirmPassword: string }) => {
    setIsLoading(true)
    setError(undefined)

    try {
      // Simulate password reset API call
      await new Promise((resolve) => setTimeout(resolve, 1000))
      console.log('Password reset successful')
      navigate({ to: '/admin/login' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Reset Password"
      subtitle="Enter your email to receive a password reset link"
    >
      <PasswordResetForm
        mode="request"
        isLoading={isLoading}
        error={error}
        onRequestSubmit={handleRequestSubmit}
        onConfirmSubmit={handleConfirmSubmit}
        onBackToLogin={() => {
          navigate({ to: '/admin/login' })
        }}
      />
    </AuthLayout>
  )
}
