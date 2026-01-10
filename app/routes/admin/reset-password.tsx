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
        onRequestSubmit={async (_data) => {
          // TODO: Implement actual password reset logic
        }}
        onConfirmSubmit={async (_data) => {
          // TODO: Implement password reset confirmation
          navigate({ to: '/admin/login' })
        }}
        onBackToLogin={() => {
          navigate({ to: '/admin/login' })
        }}
      />
    </AuthLayout>
  )
}
