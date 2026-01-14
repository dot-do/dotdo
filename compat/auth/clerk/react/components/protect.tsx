/**
 * Protect Components
 *
 * Components for protecting routes and content based on auth state.
 *
 * @example
 * ```tsx
 * // Require authentication
 * <Protect>
 *   <Dashboard />
 * </Protect>
 *
 * // Require specific role
 * <Protect role="admin">
 *   <AdminPanel />
 * </Protect>
 *
 * // Require specific permission
 * <Protect permission="org:billing:manage">
 *   <BillingSettings />
 * </Protect>
 * ```
 *
 * @module
 */

import { useEffect, type ReactNode } from 'react'
import { useClerkContext } from '../context'

// ============================================================================
// PROTECT
// ============================================================================

/**
 * Protect component props
 */
export interface ProtectProps {
  /** Children to render when authorized */
  children: ReactNode
  /** Fallback content when not authorized */
  fallback?: ReactNode
  /** Required role */
  role?: string
  /** Required permission */
  permission?: string
  /** Condition function */
  condition?: () => boolean
}

/**
 * Protects content based on authentication and authorization.
 *
 * @example
 * ```tsx
 * // Basic protection (requires sign in)
 * <Protect fallback={<p>Please sign in</p>}>
 *   <Dashboard />
 * </Protect>
 *
 * // Role-based protection
 * <Protect role="admin" fallback={<p>Admin access required</p>}>
 *   <AdminPanel />
 * </Protect>
 *
 * // Permission-based protection
 * <Protect permission="org:billing:manage">
 *   <BillingSettings />
 * </Protect>
 *
 * // Custom condition
 * <Protect condition={() => user.publicMetadata.isPremium}>
 *   <PremiumFeatures />
 * </Protect>
 * ```
 */
export function Protect({
  children,
  fallback = null,
  role,
  permission,
  condition,
}: ProtectProps): JSX.Element | null {
  const { isLoaded, isSignedIn, orgRole } = useClerkContext()

  // Not loaded yet
  if (!isLoaded) {
    return null
  }

  // Not signed in
  if (!isSignedIn) {
    return <>{fallback}</>
  }

  // Check role
  if (role && orgRole !== role) {
    return <>{fallback}</>
  }

  // Check permission (simplified - would need full permission check)
  if (permission) {
    // In a real implementation, check against org permissions
    // For now, always deny permission checks
    return <>{fallback}</>
  }

  // Check custom condition
  if (condition && !condition()) {
    return <>{fallback}</>
  }

  return <>{children}</>
}

// ============================================================================
// REDIRECT TO SIGN IN
// ============================================================================

/**
 * RedirectToSignIn component props
 */
export interface RedirectToSignInProps {
  /** Redirect URL after sign in */
  afterSignInUrl?: string
  /** Redirect URL after sign up */
  afterSignUpUrl?: string
  /** Sign in URL */
  signInUrl?: string
  /** Sign in force redirect URL */
  signInForceRedirectUrl?: string
  /** Sign in fallback redirect URL */
  signInFallbackRedirectUrl?: string
  /** Initial values */
  initialValues?: {
    emailAddress?: string
    phoneNumber?: string
    username?: string
  }
}

/**
 * Redirects to sign-in page if not authenticated.
 *
 * @example
 * ```tsx
 * function ProtectedPage() {
 *   const { isLoaded, isSignedIn } = useAuth()
 *
 *   if (!isLoaded) return <div>Loading...</div>
 *   if (!isSignedIn) return <RedirectToSignIn />
 *
 *   return <Dashboard />
 * }
 * ```
 */
export function RedirectToSignIn({
  afterSignInUrl,
  afterSignUpUrl,
  signInUrl,
  signInForceRedirectUrl,
  signInFallbackRedirectUrl,
  initialValues,
}: RedirectToSignInProps): null {
  const { isLoaded, isSignedIn, signInUrl: contextSignInUrl } = useClerkContext()

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn) return

    // Build redirect URL
    const baseUrl = signInForceRedirectUrl ?? signInUrl ?? contextSignInUrl ?? '/sign-in'
    const url = new URL(baseUrl, window.location.origin)

    if (afterSignInUrl) {
      url.searchParams.set('redirect_url', afterSignInUrl)
    } else {
      // Default to current page
      url.searchParams.set('redirect_url', window.location.href)
    }

    if (afterSignUpUrl) {
      url.searchParams.set('after_sign_up_url', afterSignUpUrl)
    }

    if (initialValues?.emailAddress) {
      url.searchParams.set('email_address', initialValues.emailAddress)
    }

    window.location.href = url.toString()
  }, [isLoaded, isSignedIn, afterSignInUrl, afterSignUpUrl, signInUrl, signInForceRedirectUrl, contextSignInUrl, initialValues])

  return null
}

// ============================================================================
// REDIRECT TO SIGN UP
// ============================================================================

/**
 * RedirectToSignUp component props
 */
export interface RedirectToSignUpProps {
  /** Redirect URL after sign up */
  afterSignUpUrl?: string
  /** Sign up URL */
  signUpUrl?: string
  /** Sign up force redirect URL */
  signUpForceRedirectUrl?: string
  /** Sign up fallback redirect URL */
  signUpFallbackRedirectUrl?: string
  /** Initial values */
  initialValues?: {
    emailAddress?: string
    phoneNumber?: string
    username?: string
    firstName?: string
    lastName?: string
  }
}

/**
 * Redirects to sign-up page if not authenticated.
 *
 * @example
 * ```tsx
 * function OnboardingPage() {
 *   const { isLoaded, isSignedIn } = useAuth()
 *
 *   if (!isLoaded) return <div>Loading...</div>
 *   if (!isSignedIn) return <RedirectToSignUp afterSignUpUrl="/welcome" />
 *
 *   return <Onboarding />
 * }
 * ```
 */
export function RedirectToSignUp({
  afterSignUpUrl,
  signUpUrl,
  signUpForceRedirectUrl,
  signUpFallbackRedirectUrl,
  initialValues,
}: RedirectToSignUpProps): null {
  const { isLoaded, isSignedIn, signUpUrl: contextSignUpUrl } = useClerkContext()

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn) return

    // Build redirect URL
    const baseUrl = signUpForceRedirectUrl ?? signUpUrl ?? contextSignUpUrl ?? '/sign-up'
    const url = new URL(baseUrl, window.location.origin)

    if (afterSignUpUrl) {
      url.searchParams.set('redirect_url', afterSignUpUrl)
    } else {
      // Default to current page
      url.searchParams.set('redirect_url', window.location.href)
    }

    if (initialValues?.emailAddress) {
      url.searchParams.set('email_address', initialValues.emailAddress)
    }

    if (initialValues?.firstName) {
      url.searchParams.set('first_name', initialValues.firstName)
    }

    if (initialValues?.lastName) {
      url.searchParams.set('last_name', initialValues.lastName)
    }

    window.location.href = url.toString()
  }, [isLoaded, isSignedIn, afterSignUpUrl, signUpUrl, signUpForceRedirectUrl, contextSignUpUrl, initialValues])

  return null
}
