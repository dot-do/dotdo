/**
 * Admin Login Route
 *
 * Authentication page for admin dashboard.
 * Uses @mdxui/cockpit/auth LoginPage component.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AuthLayout, LoginPage } from '@mdxui/cockpit/auth'

export const Route = createFileRoute('/admin/login')({
  component: AdminLogin,
})

function AdminLogin() {
  const navigate = useNavigate()

  return (
    <AuthLayout
      title="Welcome Back"
      subtitle="Sign in to access the admin dashboard"
    >
      <LoginPage
        title="Admin Login"
        subtitle="Sign in to access the admin dashboard"
        showOAuth={true}
        oauthProviders={['google', 'github', 'microsoft']}
        onSubmit={async (data) => {
          // Handle login
          console.log('Login:', data)
          navigate({ to: '/admin' })
        }}
        onOAuthClick={async (provider) => {
          // Handle OAuth login
          console.log('OAuth:', provider)
        }}
        onForgotPasswordClick={() => {
          navigate({ to: '/admin/reset-password' })
        }}
        onSignupClick={() => {
          navigate({ to: '/admin/signup' })
        }}
      />
    </AuthLayout>
  )
}
