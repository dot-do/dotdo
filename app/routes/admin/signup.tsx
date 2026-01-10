/**
 * Admin Signup Route
 *
 * Registration page for new admin users.
 * Uses @mdxui/cockpit/auth SignupPage component.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AuthLayout, SignupPage } from '@mdxui/cockpit/auth'

export const Route = createFileRoute('/admin/signup')({
  component: AdminSignup,
})

function AdminSignup() {
  const navigate = useNavigate()

  return (
    <AuthLayout
      title="Create Account"
      subtitle="Sign up to get started with the admin dashboard"
    >
      <SignupPage
        title="Create Account"
        subtitle="Sign up to get started"
        showOAuth={true}
        oauthProviders={['google', 'github', 'microsoft']}
        onSubmit={async (_data) => {
          // TODO: Implement actual signup logic
          navigate({ to: '/admin' })
        }}
        onOAuthClick={async (_provider) => {
          // TODO: Implement OAuth signup
        }}
        onLoginClick={() => {
          navigate({ to: '/admin/login' })
        }}
      />
    </AuthLayout>
  )
}
