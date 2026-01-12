/**
 * Admin Signup Route
 *
 * Registration page for new admin users.
 * Uses custom auth components with data-testid attributes for E2E testing.
 */

import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AuthLayout, SignupForm } from '~/components/auth'
import { useAuth } from '~/src/admin/auth'

export const Route = createFileRoute('/admin/_admin/signup')({
  component: AdminSignup,
})

function AdminSignup() {
  const navigate = useNavigate()
  const { login, isLoading } = useAuth()
  const [error, setError] = useState<string | undefined>()

  const handleSubmit = async (data: {
    fullName: string
    email: string
    password: string
    confirmPassword: string
    agreeToTerms: boolean
  }) => {
    setError(undefined)

    // Check for existing email (mock implementation)
    if (data.email === 'existing@example.com') {
      setError('An account with this email already exists')
      return
    }

    try {
      // Create account and login
      await login({ email: data.email, password: data.password })

      // Redirect to dashboard
      navigate({ to: '/admin' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    }
  }

  const handleOAuthClick = async (provider: 'google' | 'github' | 'microsoft') => {
    // TODO: Implement OAuth signup
    console.log('OAuth signup:', provider)
  }

  return (
    <AuthLayout
      title="Create Account"
      subtitle="Sign up to get started with the admin dashboard"
    >
      <SignupForm
        showOAuth={true}
        oauthProviders={['google', 'github', 'microsoft']}
        isLoading={isLoading}
        error={error}
        onSubmit={handleSubmit}
        onOAuthClick={handleOAuthClick}
        onLoginClick={() => {
          navigate({ to: '/admin/login' })
        }}
      />
    </AuthLayout>
  )
}
