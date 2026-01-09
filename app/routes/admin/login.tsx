/**
 * Admin Login Route
 *
 * Authentication page for admin dashboard.
 * Uses @mdxui/cockpit/auth LoginPage component.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { LoginPage } from '@mdxui/cockpit/auth'

export const Route = createFileRoute('/admin/login')({
  component: AdminLogin,
})

function AdminLogin() {
  const navigate = useNavigate()

  return (
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
        // Handle forgot password
        console.log('Forgot password')
      }}
      onSignupClick={() => {
        // Handle signup navigation
        console.log('Signup')
      }}
    />
  )
}
