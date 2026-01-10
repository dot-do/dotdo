/**
 * Admin Password Reset Route
 *
 * Password recovery page for admin users.
 * Uses @mdxui/cockpit/auth PasswordResetPage component.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AuthLayout, PasswordResetPage } from '@mdxui/cockpit/auth'

export const Route = createFileRoute('/admin/reset-password')({
  component: AdminResetPassword,
})

function AdminResetPassword() {
  const navigate = useNavigate()

  return (
    <AuthLayout
      title="Reset Password"
      subtitle="Enter your email to receive a password reset link"
    >
      <PasswordResetPage
        mode="request"
        title="Reset Password"
        subtitle="Enter your email to receive a password reset link"
        onRequestSubmit={async (data) => {
          // Handle password reset request
          console.log('Password reset request:', data)
          // TODO: Implement actual password reset logic
        }}
        onConfirmSubmit={async (data) => {
          // Handle password reset confirmation
          console.log('Password reset confirm:', data)
          navigate({ to: '/admin/login' })
        }}
        onBackToLogin={() => {
          navigate({ to: '/admin/login' })
        }}
      />
    </AuthLayout>
  )
}
