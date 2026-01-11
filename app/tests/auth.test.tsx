/**
 * Auth Flow Component Tests (TDD RED Phase)
 *
 * These tests define the contract for auth components from @mdxui/cockpit/auth.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The auth components provide:
 * - AuthLayout: Wrapper for auth pages with branding
 * - LoginPage: Email/password authentication
 * - SignupPage: User registration with validation
 * - PasswordResetPage: Password recovery flow
 * - OTPPage: One-time password verification
 *
 * @see @mdxui/cockpit/auth
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'

// =============================================================================
// Placeholder Component Stubs (TDD RED Phase)
// =============================================================================
// These stubs represent the API contract for @mdxui/cockpit/auth components.
// Tests will FAIL until actual implementation is created in @mdxui/cockpit/auth.
// The stubs return null to make tests fail with clear expectations.

interface AuthLayoutProps {
  children: React.ReactNode
  logo?: React.ReactNode
  title?: string
  subtitle?: string
  className?: string
  footerLinks?: Array<{ label: string; href: string }>
}

interface LoginPageProps {
  onSubmit: (credentials: { email: string; password: string; rememberMe?: boolean }) => Promise<unknown> | void
  onForgotPassword?: () => void
  onSignupClick?: () => void
  onSuccess?: () => void
  error?: string
  showRememberMe?: boolean
  redirectTo?: string
}

interface SignupPageProps {
  onSubmit: (data: { name: string; email: string; password: string; acceptedTerms?: boolean }) => Promise<unknown> | void
  onLoginClick?: () => void
  requireTerms?: boolean
  termsUrl?: string
  privacyUrl?: string
}

interface PasswordResetPageProps {
  onSubmit: (data: { email: string }) => Promise<unknown> | void
  onBackToLogin?: () => void
}

interface OTPPageProps {
  onSubmit: (data: { code: string }) => Promise<unknown> | void
  onResend?: () => Promise<unknown> | void
  sentTo?: string
  autoSubmitOnComplete?: boolean
  clearOnError?: boolean
  resendCooldown?: number
}

// Stub components - return null to make tests fail clearly
const AuthLayout: React.FC<AuthLayoutProps> = () => null
const LoginPage: React.FC<LoginPageProps> = () => null
const SignupPage: React.FC<SignupPageProps> = () => null
const PasswordResetPage: React.FC<PasswordResetPageProps> = () => null
const OTPPage: React.FC<OTPPageProps> = () => null

// TODO: Replace stubs with actual imports when @mdxui/cockpit/auth is implemented:
// import { AuthLayout, LoginPage, SignupPage, PasswordResetPage, OTPPage } from '@mdxui/cockpit/auth'

// =============================================================================
// Mock Helpers
// =============================================================================

// Mock router for navigation testing
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useRouter: () => ({ navigate: mockNavigate }),
  }
})

// Helper to type into an input field
async function typeIntoInput(input: HTMLElement, text: string) {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: text } })
  fireEvent.blur(input)
}

// =============================================================================
// Test Suite: AuthLayout
// =============================================================================

describe('AuthLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rendering', () => {
    it('renders children within layout', () => {
      render(
        <AuthLayout>
          <div data-testid="child-content">Login Form</div>
        </AuthLayout>
      )

      expect(screen.getByTestId('child-content')).toBeInTheDocument()
    })

    it('renders with logo/branding', () => {
      render(
        <AuthLayout logo={<img src="/logo.svg" alt="Logo" />}>
          <div>Content</div>
        </AuthLayout>
      )

      expect(screen.getByRole('img', { name: /logo/i })).toBeInTheDocument()
    })

    it('renders with custom title', () => {
      render(
        <AuthLayout title="Welcome Back">
          <div>Content</div>
        </AuthLayout>
      )

      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    })

    it('renders with custom subtitle', () => {
      render(
        <AuthLayout subtitle="Sign in to your account">
          <div>Content</div>
        </AuthLayout>
      )

      expect(screen.getByText(/sign in to your account/i)).toBeInTheDocument()
    })

    it('applies custom className', () => {
      render(
        <AuthLayout className="custom-auth-layout">
          <div>Content</div>
        </AuthLayout>
      )

      expect(screen.getByTestId('auth-layout')).toHaveClass('custom-auth-layout')
    })

    it('renders footer links when provided', () => {
      render(
        <AuthLayout
          footerLinks={[
            { label: 'Privacy Policy', href: '/privacy' },
            { label: 'Terms of Service', href: '/terms' },
          ]}
        >
          <div>Content</div>
        </AuthLayout>
      )

      expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy')
      expect(screen.getByRole('link', { name: /terms of service/i })).toHaveAttribute('href', '/terms')
    })
  })

  describe('responsive design', () => {
    it('has centered layout', () => {
      render(
        <AuthLayout>
          <div>Content</div>
        </AuthLayout>
      )

      const layout = screen.getByTestId('auth-layout')
      expect(layout).toHaveClass('flex', 'items-center', 'justify-center')
    })

    it('has max-width constraint for content', () => {
      render(
        <AuthLayout>
          <div>Content</div>
        </AuthLayout>
      )

      const contentContainer = screen.getByTestId('auth-content')
      expect(contentContainer).toHaveClass('max-w-md')
    })
  })
})

// =============================================================================
// Test Suite: LoginPage
// =============================================================================

describe('LoginPage', () => {
  let onSubmit: ReturnType<typeof vi.fn>
  let onForgotPassword: ReturnType<typeof vi.fn>
  let onSignupClick: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSubmit = vi.fn()
    onForgotPassword = vi.fn()
    onSignupClick = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders email input field', () => {
      render(<LoginPage onSubmit={onSubmit} />)

      const emailInput = screen.getByRole('textbox', { name: /email/i })
      expect(emailInput).toBeInTheDocument()
      expect(emailInput).toHaveAttribute('type', 'email')
    })

    it('renders password input field', () => {
      render(<LoginPage onSubmit={onSubmit} />)

      const passwordInput = document.querySelector('input[type="password"]')
      expect(passwordInput).toBeInTheDocument()
    })

    it('renders submit button with login label', () => {
      render(<LoginPage onSubmit={onSubmit} />)

      expect(screen.getByRole('button', { name: /sign in|log in|login/i })).toBeInTheDocument()
    })

    it('renders forgot password link', () => {
      render(<LoginPage onSubmit={onSubmit} onForgotPassword={onForgotPassword} />)

      expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument()
    })

    it('renders signup link when onSignupClick provided', () => {
      render(<LoginPage onSubmit={onSubmit} onSignupClick={onSignupClick} />)

      expect(screen.getByRole('link', { name: /sign up|create account|register/i })).toBeInTheDocument()
    })

    it('renders email input with placeholder', () => {
      render(<LoginPage onSubmit={onSubmit} />)

      expect(screen.getByPlaceholderText(/email|you@example.com.ai/i)).toBeInTheDocument()
    })

    it('renders password input with placeholder', () => {
      render(<LoginPage onSubmit={onSubmit} />)

      expect(screen.getByPlaceholderText(/password|enter your password/i)).toBeInTheDocument()
    })

    it('renders remember me checkbox when enabled', () => {
      render(<LoginPage onSubmit={onSubmit} showRememberMe />)

      expect(screen.getByRole('checkbox', { name: /remember me/i })).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe('validation', () => {
    it('shows error when email is empty on submit', async () => {
      render(<LoginPage onSubmit={onSubmit} />)

      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'password123')
      fireEvent.click(screen.getByRole('button', { name: /sign in|log in|login/i }))

      await waitFor(() => {
        expect(screen.getByText(/email is required|please enter your email/i)).toBeInTheDocument()
      })
    })

    it('shows error when password is empty on submit', async () => {
      render(<LoginPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      fireEvent.click(screen.getByRole('button', { name: /sign in|log in|login/i }))

      await waitFor(() => {
        expect(screen.getByText(/password is required|please enter your password/i)).toBeInTheDocument()
      })
    })

    it('shows error for invalid email format', async () => {
      render(<LoginPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'invalid-email')
      fireEvent.click(screen.getByRole('button', { name: /sign in|log in|login/i }))

      await waitFor(() => {
        expect(screen.getByText(/invalid email|please enter a valid email/i)).toBeInTheDocument()
      })
    })

    it('marks required fields with asterisk or aria-required', () => {
      render(<LoginPage onSubmit={onSubmit} />)

      const emailInput = screen.getByRole('textbox', { name: /email/i })
      expect(emailInput).toHaveAttribute('required')
    })
  })

  // ===========================================================================
  // Submit Handler Tests
  // ===========================================================================

  describe('submit handling', () => {
    it('calls onSubmit with credentials on valid submission', async () => {
      render(<LoginPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'password123')
      fireEvent.click(screen.getByRole('button', { name: /sign in|log in|login/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          email: 'test@example.com.ai',
          password: 'password123',
        })
      })
    })

    it('includes rememberMe in submit when checked', async () => {
      render(<LoginPage onSubmit={onSubmit} showRememberMe />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'password123')
      fireEvent.click(screen.getByRole('checkbox', { name: /remember me/i }))
      fireEvent.click(screen.getByRole('button', { name: /sign in|log in|login/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            rememberMe: true,
          })
        )
      })
    })

    it('disables submit button while submitting', async () => {
      const slowSubmit = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 1000)))
      render(<LoginPage onSubmit={slowSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'password123')
      fireEvent.click(screen.getByRole('button', { name: /sign in|log in|login/i }))

      expect(screen.getByRole('button', { name: /sign in|log in|login|signing in|loading/i })).toBeDisabled()
    })

    it('shows loading indicator while submitting', async () => {
      const slowSubmit = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 1000)))
      render(<LoginPage onSubmit={slowSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'password123')
      fireEvent.click(screen.getByRole('button', { name: /sign in|log in|login/i }))

      const submitButton = screen.getByRole('button', { name: /sign in|log in|login|signing in|loading/i })
      expect(submitButton.querySelector('svg.animate-spin')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Error Display Tests
  // ===========================================================================

  describe('error display', () => {
    it('displays error message when provided', () => {
      render(<LoginPage onSubmit={onSubmit} error="Invalid credentials" />)

      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()
    })

    it('displays error with destructive styling', () => {
      render(<LoginPage onSubmit={onSubmit} error="Invalid credentials" />)

      const errorElement = screen.getByRole('alert')
      expect(errorElement).toHaveClass('text-destructive')
    })

    it('clears error when user starts typing', async () => {
      const { rerender } = render(<LoginPage onSubmit={onSubmit} error="Invalid credentials" />)

      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'a')

      // Component should call onErrorClear or similar
      rerender(<LoginPage onSubmit={onSubmit} error={undefined} />)
      expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Redirect on Success Tests
  // ===========================================================================

  describe('redirect on success', () => {
    it('calls onSuccess callback after successful login', async () => {
      const onSuccess = vi.fn()
      onSubmit.mockResolvedValueOnce({ success: true })
      render(<LoginPage onSubmit={onSubmit} onSuccess={onSuccess} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'password123')
      fireEvent.click(screen.getByRole('button', { name: /sign in|log in|login/i }))

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
      })
    })

    it('redirects to specified URL on success', async () => {
      onSubmit.mockResolvedValueOnce({ success: true })
      render(<LoginPage onSubmit={onSubmit} redirectTo="/dashboard" />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'password123')
      fireEvent.click(screen.getByRole('button', { name: /sign in|log in|login/i }))

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard' })
      })
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('has accessible form', () => {
      render(<LoginPage onSubmit={onSubmit} />)

      expect(screen.getByRole('form')).toBeInTheDocument()
    })

    it('labels are associated with inputs', () => {
      render(<LoginPage onSubmit={onSubmit} />)

      const emailInput = screen.getByRole('textbox', { name: /email/i })
      expect(emailInput).toHaveAccessibleName()
    })

    it('submit button has accessible name', () => {
      render(<LoginPage onSubmit={onSubmit} />)

      const submitButton = screen.getByRole('button', { name: /sign in|log in|login/i })
      expect(submitButton).toHaveAccessibleName()
    })

    it('error messages have role="alert"', () => {
      render(<LoginPage onSubmit={onSubmit} error="Invalid credentials" />)

      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })
})

// =============================================================================
// Test Suite: SignupPage
// =============================================================================

describe('SignupPage', () => {
  let onSubmit: ReturnType<typeof vi.fn>
  let onLoginClick: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSubmit = vi.fn()
    onLoginClick = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders name input field', () => {
      render(<SignupPage onSubmit={onSubmit} />)

      expect(screen.getByRole('textbox', { name: /name|full name/i })).toBeInTheDocument()
    })

    it('renders email input field', () => {
      render(<SignupPage onSubmit={onSubmit} />)

      const emailInput = screen.getByRole('textbox', { name: /email/i })
      expect(emailInput).toBeInTheDocument()
      expect(emailInput).toHaveAttribute('type', 'email')
    })

    it('renders password input field', () => {
      render(<SignupPage onSubmit={onSubmit} />)

      const passwordInput = document.querySelector('input[name="password"]')
      expect(passwordInput).toBeInTheDocument()
      expect(passwordInput).toHaveAttribute('type', 'password')
    })

    it('renders confirm password input field', () => {
      render(<SignupPage onSubmit={onSubmit} />)

      const confirmInput = document.querySelector('input[name="confirmPassword"]')
      expect(confirmInput).toBeInTheDocument()
      expect(confirmInput).toHaveAttribute('type', 'password')
    })

    it('renders submit button with signup label', () => {
      render(<SignupPage onSubmit={onSubmit} />)

      expect(screen.getByRole('button', { name: /sign up|create account|register/i })).toBeInTheDocument()
    })

    it('renders login link when onLoginClick provided', () => {
      render(<SignupPage onSubmit={onSubmit} onLoginClick={onLoginClick} />)

      expect(screen.getByRole('link', { name: /sign in|log in|already have an account/i })).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Password Strength Indicator Tests
  // ===========================================================================

  describe('password strength indicator', () => {
    it('renders password strength indicator', () => {
      render(<SignupPage onSubmit={onSubmit} />)

      expect(screen.getByTestId('password-strength')).toBeInTheDocument()
    })

    it('shows weak strength for short passwords', async () => {
      render(<SignupPage onSubmit={onSubmit} />)

      const passwordInput = document.querySelector('input[name="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, '123')

      await waitFor(() => {
        const strengthIndicator = screen.getByTestId('password-strength')
        expect(strengthIndicator).toHaveTextContent(/weak/i)
      })
    })

    it('shows medium strength for basic passwords', async () => {
      render(<SignupPage onSubmit={onSubmit} />)

      const passwordInput = document.querySelector('input[name="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'Password1')

      await waitFor(() => {
        const strengthIndicator = screen.getByTestId('password-strength')
        expect(strengthIndicator).toHaveTextContent(/medium|fair/i)
      })
    })

    it('shows strong strength for complex passwords', async () => {
      render(<SignupPage onSubmit={onSubmit} />)

      const passwordInput = document.querySelector('input[name="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'P@ssw0rd!Complex123')

      await waitFor(() => {
        const strengthIndicator = screen.getByTestId('password-strength')
        expect(strengthIndicator).toHaveTextContent(/strong/i)
      })
    })

    it('displays password requirements list', () => {
      render(<SignupPage onSubmit={onSubmit} />)

      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()
      expect(screen.getByText(/uppercase letter/i)).toBeInTheDocument()
      expect(screen.getByText(/lowercase letter/i)).toBeInTheDocument()
      expect(screen.getByText(/number/i)).toBeInTheDocument()
    })

    it('checks off requirements as they are met', async () => {
      render(<SignupPage onSubmit={onSubmit} />)

      const passwordInput = document.querySelector('input[name="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'Aa1')

      await waitFor(() => {
        // Uppercase, lowercase, and number should be checked
        const uppercaseReq = screen.getByTestId('req-uppercase')
        const lowercaseReq = screen.getByTestId('req-lowercase')
        const numberReq = screen.getByTestId('req-number')

        expect(uppercaseReq).toHaveClass('text-green-500')
        expect(lowercaseReq).toHaveClass('text-green-500')
        expect(numberReq).toHaveClass('text-green-500')
      })
    })
  })

  // ===========================================================================
  // Terms Checkbox Tests
  // ===========================================================================

  describe('terms checkbox', () => {
    it('renders terms acceptance checkbox', () => {
      render(<SignupPage onSubmit={onSubmit} requireTerms />)

      expect(screen.getByRole('checkbox', { name: /terms|agree/i })).toBeInTheDocument()
    })

    it('renders link to terms of service', () => {
      render(<SignupPage onSubmit={onSubmit} requireTerms termsUrl="/terms" />)

      expect(screen.getByRole('link', { name: /terms of service/i })).toHaveAttribute('href', '/terms')
    })

    it('renders link to privacy policy', () => {
      render(<SignupPage onSubmit={onSubmit} requireTerms privacyUrl="/privacy" />)

      expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy')
    })

    it('prevents submission when terms not accepted', async () => {
      render(<SignupPage onSubmit={onSubmit} requireTerms />)

      await typeIntoInput(screen.getByRole('textbox', { name: /name/i }), 'Test User')
      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      const passwordInput = document.querySelector('input[name="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'P@ssw0rd123')
      const confirmInput = document.querySelector('input[name="confirmPassword"]') as HTMLInputElement
      await typeIntoInput(confirmInput, 'P@ssw0rd123')
      fireEvent.click(screen.getByRole('button', { name: /sign up|create account/i }))

      await waitFor(() => {
        expect(screen.getByText(/please accept the terms/i)).toBeInTheDocument()
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('allows submission when terms accepted', async () => {
      render(<SignupPage onSubmit={onSubmit} requireTerms />)

      await typeIntoInput(screen.getByRole('textbox', { name: /name/i }), 'Test User')
      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      const passwordInput = document.querySelector('input[name="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'P@ssw0rd123')
      const confirmInput = document.querySelector('input[name="confirmPassword"]') as HTMLInputElement
      await typeIntoInput(confirmInput, 'P@ssw0rd123')
      fireEvent.click(screen.getByRole('checkbox', { name: /terms|agree/i }))
      fireEvent.click(screen.getByRole('button', { name: /sign up|create account/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })
  })

  // ===========================================================================
  // Email Verification Tests
  // ===========================================================================

  describe('email verification', () => {
    it('shows email verification message after successful signup', async () => {
      onSubmit.mockResolvedValueOnce({ success: true, requiresVerification: true })
      render(<SignupPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /name/i }), 'Test User')
      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      const passwordInput = document.querySelector('input[name="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'P@ssw0rd123')
      const confirmInput = document.querySelector('input[name="confirmPassword"]') as HTMLInputElement
      await typeIntoInput(confirmInput, 'P@ssw0rd123')
      fireEvent.click(screen.getByRole('button', { name: /sign up|create account/i }))

      await waitFor(() => {
        expect(screen.getByText(/verification email|check your email/i)).toBeInTheDocument()
      })
    })

    it('displays resend verification link', async () => {
      onSubmit.mockResolvedValueOnce({ success: true, requiresVerification: true })
      render(<SignupPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /name/i }), 'Test User')
      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      const passwordInput = document.querySelector('input[name="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'P@ssw0rd123')
      const confirmInput = document.querySelector('input[name="confirmPassword"]') as HTMLInputElement
      await typeIntoInput(confirmInput, 'P@ssw0rd123')
      fireEvent.click(screen.getByRole('button', { name: /sign up|create account/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /resend/i })).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe('validation', () => {
    it('shows error when passwords do not match', async () => {
      render(<SignupPage onSubmit={onSubmit} />)

      const passwordInput = document.querySelector('input[name="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, 'P@ssw0rd123')
      const confirmInput = document.querySelector('input[name="confirmPassword"]') as HTMLInputElement
      await typeIntoInput(confirmInput, 'P@ssw0rd456')
      fireEvent.click(screen.getByRole('button', { name: /sign up|create account/i }))

      await waitFor(() => {
        expect(screen.getByText(/passwords do not match|passwords must match/i)).toBeInTheDocument()
      })
    })

    it('shows error for invalid email format', async () => {
      render(<SignupPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'invalid-email')
      fireEvent.click(screen.getByRole('button', { name: /sign up|create account/i }))

      await waitFor(() => {
        expect(screen.getByText(/invalid email|please enter a valid email/i)).toBeInTheDocument()
      })
    })

    it('shows error for weak password', async () => {
      render(<SignupPage onSubmit={onSubmit} />)

      const passwordInput = document.querySelector('input[name="password"]') as HTMLInputElement
      await typeIntoInput(passwordInput, '123')
      fireEvent.click(screen.getByRole('button', { name: /sign up|create account/i }))

      await waitFor(() => {
        expect(screen.getByText(/password.*weak|password.*requirements/i)).toBeInTheDocument()
      })
    })
  })
})

// =============================================================================
// Test Suite: PasswordResetPage
// =============================================================================

describe('PasswordResetPage', () => {
  let onSubmit: ReturnType<typeof vi.fn>
  let onBackToLogin: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSubmit = vi.fn()
    onBackToLogin = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders email input field', () => {
      render(<PasswordResetPage onSubmit={onSubmit} />)

      const emailInput = screen.getByRole('textbox', { name: /email/i })
      expect(emailInput).toBeInTheDocument()
      expect(emailInput).toHaveAttribute('type', 'email')
    })

    it('renders submit button', () => {
      render(<PasswordResetPage onSubmit={onSubmit} />)

      expect(screen.getByRole('button', { name: /reset|send|submit/i })).toBeInTheDocument()
    })

    it('renders back to login link', () => {
      render(<PasswordResetPage onSubmit={onSubmit} onBackToLogin={onBackToLogin} />)

      expect(screen.getByRole('link', { name: /back to login|sign in/i })).toBeInTheDocument()
    })

    it('renders helpful instructions', () => {
      render(<PasswordResetPage onSubmit={onSubmit} />)

      expect(screen.getByText(/enter your email|we.*ll send/i)).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Submit Tests
  // ===========================================================================

  describe('submit handling', () => {
    it('calls onSubmit with email', async () => {
      render(<PasswordResetPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      fireEvent.click(screen.getByRole('button', { name: /reset|send|submit/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({ email: 'test@example.com.ai' })
      })
    })

    it('validates email before submission', async () => {
      render(<PasswordResetPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'invalid-email')
      fireEvent.click(screen.getByRole('button', { name: /reset|send|submit/i }))

      await waitFor(() => {
        expect(screen.getByText(/invalid email|please enter a valid email/i)).toBeInTheDocument()
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('disables button while submitting', async () => {
      const slowSubmit = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 1000)))
      render(<PasswordResetPage onSubmit={slowSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      fireEvent.click(screen.getByRole('button', { name: /reset|send|submit/i }))

      expect(screen.getByRole('button', { name: /reset|send|submit|sending|loading/i })).toBeDisabled()
    })
  })

  // ===========================================================================
  // Confirmation Message Tests
  // ===========================================================================

  describe('confirmation message', () => {
    it('shows confirmation message after successful submission', async () => {
      onSubmit.mockResolvedValueOnce({ success: true })
      render(<PasswordResetPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      fireEvent.click(screen.getByRole('button', { name: /reset|send|submit/i }))

      await waitFor(() => {
        expect(screen.getByText(/check your email|reset link sent|email sent/i)).toBeInTheDocument()
      })
    })

    it('hides form after successful submission', async () => {
      onSubmit.mockResolvedValueOnce({ success: true })
      render(<PasswordResetPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      fireEvent.click(screen.getByRole('button', { name: /reset|send|submit/i }))

      await waitFor(() => {
        expect(screen.queryByRole('textbox', { name: /email/i })).not.toBeInTheDocument()
      })
    })

    it('displays resend option in confirmation', async () => {
      onSubmit.mockResolvedValueOnce({ success: true })
      render(<PasswordResetPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      fireEvent.click(screen.getByRole('button', { name: /reset|send|submit/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /resend|try again/i })).toBeInTheDocument()
      })
    })

    it('allows resending reset email', async () => {
      onSubmit.mockResolvedValue({ success: true })
      render(<PasswordResetPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'test@example.com.ai')
      fireEvent.click(screen.getByRole('button', { name: /reset|send|submit/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /resend|try again/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /resend|try again/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(2)
      })
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('displays error message on failure', async () => {
      onSubmit.mockRejectedValueOnce(new Error('User not found'))
      render(<PasswordResetPage onSubmit={onSubmit} />)

      await typeIntoInput(screen.getByRole('textbox', { name: /email/i }), 'notfound@example.com.ai')
      fireEvent.click(screen.getByRole('button', { name: /reset|send|submit/i }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })
    })
  })
})

// =============================================================================
// Test Suite: OTPPage
// =============================================================================

describe('OTPPage', () => {
  let onSubmit: ReturnType<typeof vi.fn>
  let onResend: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSubmit = vi.fn()
    onResend = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders 6-digit input fields', () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      expect(inputs).toHaveLength(6)
    })

    it('renders with OTP input group', () => {
      render(<OTPPage onSubmit={onSubmit} />)

      expect(screen.getByTestId('otp-input-group')).toBeInTheDocument()
    })

    it('renders submit button', () => {
      render(<OTPPage onSubmit={onSubmit} />)

      expect(screen.getByRole('button', { name: /verify|submit|confirm/i })).toBeInTheDocument()
    })

    it('renders resend code button', () => {
      render(<OTPPage onSubmit={onSubmit} onResend={onResend} />)

      expect(screen.getByRole('button', { name: /resend|didn.*t receive/i })).toBeInTheDocument()
    })

    it('renders instructions', () => {
      render(<OTPPage onSubmit={onSubmit} />)

      expect(screen.getByText(/enter.*code|verification code/i)).toBeInTheDocument()
    })

    it('shows where code was sent', () => {
      render(<OTPPage onSubmit={onSubmit} sentTo="test@example.com.ai" />)

      expect(screen.getByText(/test@example.com.ai/)).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Auto-focus Tests
  // ===========================================================================

  describe('auto-focus behavior', () => {
    it('auto-focuses first input on mount', () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      expect(inputs[0]).toHaveFocus()
    })

    it('auto-focuses next input after entering digit', async () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0], { target: { value: '1' } })

      await waitFor(() => {
        expect(inputs[1]).toHaveFocus()
      })
    })

    it('auto-focuses previous input on backspace when empty', async () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0], { target: { value: '1' } })

      await waitFor(() => {
        expect(inputs[1]).toHaveFocus()
      })

      fireEvent.keyDown(inputs[1], { key: 'Backspace' })

      await waitFor(() => {
        expect(inputs[0]).toHaveFocus()
      })
    })

    it('clears current input on backspace when has value', async () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0], { target: { value: '1' } })
      fireEvent.change(inputs[1], { target: { value: '2' } })

      fireEvent.keyDown(inputs[1], { key: 'Backspace' })

      await waitFor(() => {
        expect(inputs[1]).toHaveValue('')
      })
    })
  })

  // ===========================================================================
  // Paste Handling Tests
  // ===========================================================================

  describe('paste handling', () => {
    it('handles paste of full OTP code', async () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      const clipboardData = {
        getData: () => '123456',
      }

      fireEvent.paste(inputs[0], { clipboardData })

      await waitFor(() => {
        expect(inputs[0]).toHaveValue('1')
        expect(inputs[1]).toHaveValue('2')
        expect(inputs[2]).toHaveValue('3')
        expect(inputs[3]).toHaveValue('4')
        expect(inputs[4]).toHaveValue('5')
        expect(inputs[5]).toHaveValue('6')
      })
    })

    it('ignores non-numeric characters in paste', async () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      const clipboardData = {
        getData: () => '12-34-56',
      }

      fireEvent.paste(inputs[0], { clipboardData })

      await waitFor(() => {
        expect(inputs[0]).toHaveValue('1')
        expect(inputs[1]).toHaveValue('2')
        expect(inputs[2]).toHaveValue('3')
        expect(inputs[3]).toHaveValue('4')
        expect(inputs[4]).toHaveValue('5')
        expect(inputs[5]).toHaveValue('6')
      })
    })

    it('handles partial paste', async () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      const clipboardData = {
        getData: () => '123',
      }

      fireEvent.paste(inputs[0], { clipboardData })

      await waitFor(() => {
        expect(inputs[0]).toHaveValue('1')
        expect(inputs[1]).toHaveValue('2')
        expect(inputs[2]).toHaveValue('3')
        expect(inputs[3]).toHaveValue('')
        expect(inputs[4]).toHaveValue('')
        expect(inputs[5]).toHaveValue('')
      })
    })

    it('auto-submits on complete paste', async () => {
      render(<OTPPage onSubmit={onSubmit} autoSubmitOnComplete />)

      const inputs = screen.getAllByRole('textbox')
      const clipboardData = {
        getData: () => '123456',
      }

      fireEvent.paste(inputs[0], { clipboardData })

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({ code: '123456' })
      })
    })
  })

  // ===========================================================================
  // Verification Tests
  // ===========================================================================

  describe('code verification', () => {
    it('calls onSubmit with complete code', async () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      for (let i = 0; i < 6; i++) {
        fireEvent.change(inputs[i], { target: { value: String(i + 1) } })
      }

      fireEvent.click(screen.getByRole('button', { name: /verify|submit|confirm/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({ code: '123456' })
      })
    })

    it('prevents submission with incomplete code', async () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0], { target: { value: '1' } })
      fireEvent.change(inputs[1], { target: { value: '2' } })
      fireEvent.change(inputs[2], { target: { value: '3' } })

      fireEvent.click(screen.getByRole('button', { name: /verify|submit|confirm/i }))

      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByText(/complete.*code|enter all digits/i)).toBeInTheDocument()
    })

    it('displays error on invalid code', async () => {
      onSubmit.mockRejectedValueOnce(new Error('Invalid code'))
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      for (let i = 0; i < 6; i++) {
        fireEvent.change(inputs[i], { target: { value: String(i + 1) } })
      }

      fireEvent.click(screen.getByRole('button', { name: /verify|submit|confirm/i }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
        expect(screen.getByText(/invalid code|incorrect code/i)).toBeInTheDocument()
      })
    })

    it('clears inputs on error', async () => {
      onSubmit.mockRejectedValueOnce(new Error('Invalid code'))
      render(<OTPPage onSubmit={onSubmit} clearOnError />)

      const inputs = screen.getAllByRole('textbox')
      for (let i = 0; i < 6; i++) {
        fireEvent.change(inputs[i], { target: { value: String(i + 1) } })
      }

      fireEvent.click(screen.getByRole('button', { name: /verify|submit|confirm/i }))

      await waitFor(() => {
        inputs.forEach((input) => {
          expect(input).toHaveValue('')
        })
      })
    })

    it('shows loading state during verification', async () => {
      const slowSubmit = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 1000)))
      render(<OTPPage onSubmit={slowSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      for (let i = 0; i < 6; i++) {
        fireEvent.change(inputs[i], { target: { value: String(i + 1) } })
      }

      fireEvent.click(screen.getByRole('button', { name: /verify|submit|confirm/i }))

      expect(screen.getByRole('button', { name: /verify|submit|confirm|verifying|loading/i })).toBeDisabled()
    })
  })

  // ===========================================================================
  // Resend Code Tests
  // ===========================================================================

  describe('resend code', () => {
    it('calls onResend when clicked', async () => {
      render(<OTPPage onSubmit={onSubmit} onResend={onResend} />)

      fireEvent.click(screen.getByRole('button', { name: /resend|didn.*t receive/i }))

      expect(onResend).toHaveBeenCalled()
    })

    it('shows cooldown timer after resend', async () => {
      onResend.mockResolvedValueOnce({ success: true })
      render(<OTPPage onSubmit={onSubmit} onResend={onResend} resendCooldown={60} />)

      fireEvent.click(screen.getByRole('button', { name: /resend|didn.*t receive/i }))

      await waitFor(() => {
        expect(screen.getByText(/\d+.*seconds/i)).toBeInTheDocument()
      })
    })

    it('disables resend button during cooldown', async () => {
      onResend.mockResolvedValueOnce({ success: true })
      render(<OTPPage onSubmit={onSubmit} onResend={onResend} resendCooldown={60} />)

      fireEvent.click(screen.getByRole('button', { name: /resend|didn.*t receive/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /resend|didn.*t receive|\d+.*seconds/i })).toBeDisabled()
      })
    })
  })

  // ===========================================================================
  // Input Validation Tests
  // ===========================================================================

  describe('input validation', () => {
    it('only accepts numeric input', async () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0], { target: { value: 'a' } })

      expect(inputs[0]).toHaveValue('')
    })

    it('limits each input to single digit', async () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0], { target: { value: '12' } })

      // Should only take the first digit and move to next
      expect(inputs[0]).toHaveValue('1')
    })

    it('has inputMode="numeric" for mobile keyboards', () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      inputs.forEach((input) => {
        expect(input).toHaveAttribute('inputmode', 'numeric')
      })
    })

    it('has pattern attribute for validation', () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      inputs.forEach((input) => {
        expect(input).toHaveAttribute('pattern', '[0-9]*')
      })
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('inputs have accessible labels', () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      inputs.forEach((input, index) => {
        expect(input).toHaveAttribute('aria-label', `Digit ${index + 1}`)
      })
    })

    it('error messages have role="alert"', async () => {
      onSubmit.mockRejectedValueOnce(new Error('Invalid code'))
      render(<OTPPage onSubmit={onSubmit} />)

      const inputs = screen.getAllByRole('textbox')
      for (let i = 0; i < 6; i++) {
        fireEvent.change(inputs[i], { target: { value: String(i + 1) } })
      }

      fireEvent.click(screen.getByRole('button', { name: /verify|submit|confirm/i }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })
    })

    it('form has accessible description', () => {
      render(<OTPPage onSubmit={onSubmit} />)

      const form = screen.getByRole('form')
      expect(form).toHaveAccessibleDescription()
    })
  })
})
