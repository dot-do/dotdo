/**
 * Auth Components
 *
 * Custom authentication components with data-testid attributes for E2E testing.
 * These components wrap @mdxui primitives and add the required test IDs.
 *
 * Components:
 * - AuthLayout: Layout wrapper for auth pages
 * - AuthLoading: Full-page loading indicator for auth operations
 * - AuthLoadingInline: Inline loading indicator
 * - AuthErrorBoundary: Error boundary for auth flows
 * - AuthErrorFallback: Default error fallback UI
 * - LoginForm, SignupForm, PasswordResetForm: Form components
 */

// Layout
export { AuthLayout, type AuthLayoutProps } from './AuthLayout'

// Loading states
export { AuthLoading, AuthLoadingInline, type AuthLoadingProps } from './AuthLoading'

// Error handling
export {
  AuthErrorBoundary,
  AuthErrorFallback,
  getErrorFromUrl,
  getAuthErrorMessage,
  AUTH_ERROR_MESSAGES,
  type AuthErrorFallbackProps,
  type AuthErrorBoundaryProps,
} from './AuthErrorBoundary'

// Forms
export { LoginForm, type LoginFormProps } from './LoginForm'
export { SignupForm, type SignupFormProps } from './SignupForm'
export { PasswordResetForm, type PasswordResetFormProps } from './PasswordResetForm'
