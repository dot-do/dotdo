'use client'

/**
 * Admin Login Route
 *
 * Authentication page for admin dashboard.
 * Uses custom auth components with data-testid attributes for E2E testing.
 */

import { useState } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { AuthLayout, LoginForm } from '~/components/auth'
import { useAuth } from '~/src/admin/auth'

interface LoginSearch {
  redirect?: string
}

export const Route = createFileRoute('/admin/_admin/login')({
  component: AdminLogin,
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
})

function AdminLogin() {
  const navigate = useNavigate()
  const { redirect } = useSearch({ from: '/admin/_admin/login' })
  const { login, isLoading } = useAuth()
  const [error, setError] = useState<string | undefined>()

  const handleSubmit = async (data: { email: string; password: string; rememberMe?: boolean }) => {
    setError(undefined)
    try {
      await login({ email: data.email, password: data.password, rememberMe: data.rememberMe })

      // Redirect to original destination or dashboard
      const destination = redirect || '/admin'
      navigate({ to: destination })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password')
    }
  }

  const handleOAuthClick = async (provider: 'google' | 'github' | 'microsoft') => {
    // TODO: Implement OAuth login
    console.log('OAuth login:', provider)
  }

  return (
    <AuthLayout
      title="Welcome Back"
      subtitle="Sign in to access the admin dashboard"
    >
      <LoginForm
        showOAuth={true}
        oauthProviders={['google', 'github', 'microsoft']}
        isLoading={isLoading}
        error={error}
        onSubmit={handleSubmit}
        onOAuthClick={handleOAuthClick}
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
