/**
 * Control Components
 *
 * Components for controlling visibility based on auth state.
 *
 * @example
 * ```tsx
 * <SignedIn>
 *   <Dashboard />
 * </SignedIn>
 * <SignedOut>
 *   <SignInButton />
 * </SignedOut>
 * ```
 *
 * @module
 */

import type { ReactNode } from 'react'
import { useClerkContext } from '../context'

// ============================================================================
// SIGNED IN
// ============================================================================

/**
 * SignedIn component props
 */
export interface SignedInProps {
  /** Children to render when signed in */
  children: ReactNode
}

/**
 * Renders children only when the user is signed in.
 *
 * @example
 * ```tsx
 * <SignedIn>
 *   <p>Welcome back!</p>
 *   <UserButton />
 * </SignedIn>
 * ```
 */
export function SignedIn({ children }: SignedInProps): JSX.Element | null {
  const { isLoaded, isSignedIn } = useClerkContext()

  if (!isLoaded || !isSignedIn) {
    return null
  }

  return <>{children}</>
}

// ============================================================================
// SIGNED OUT
// ============================================================================

/**
 * SignedOut component props
 */
export interface SignedOutProps {
  /** Children to render when signed out */
  children: ReactNode
}

/**
 * Renders children only when the user is signed out.
 *
 * @example
 * ```tsx
 * <SignedOut>
 *   <p>Please sign in to continue.</p>
 *   <SignInButton />
 * </SignedOut>
 * ```
 */
export function SignedOut({ children }: SignedOutProps): JSX.Element | null {
  const { isLoaded, isSignedIn } = useClerkContext()

  if (!isLoaded || isSignedIn) {
    return null
  }

  return <>{children}</>
}

// ============================================================================
// CLERK LOADED
// ============================================================================

/**
 * ClerkLoaded component props
 */
export interface ClerkLoadedProps {
  /** Children to render when Clerk is loaded */
  children: ReactNode
}

/**
 * Renders children only when Clerk has loaded.
 *
 * @example
 * ```tsx
 * <ClerkLoaded>
 *   <App />
 * </ClerkLoaded>
 * ```
 */
export function ClerkLoaded({ children }: ClerkLoadedProps): JSX.Element | null {
  const { isLoaded } = useClerkContext()

  if (!isLoaded) {
    return null
  }

  return <>{children}</>
}

// ============================================================================
// CLERK LOADING
// ============================================================================

/**
 * ClerkLoading component props
 */
export interface ClerkLoadingProps {
  /** Children to render while Clerk is loading */
  children: ReactNode
}

/**
 * Renders children only while Clerk is loading.
 *
 * @example
 * ```tsx
 * <ClerkLoading>
 *   <div>Loading...</div>
 * </ClerkLoading>
 * ```
 */
export function ClerkLoading({ children }: ClerkLoadingProps): JSX.Element | null {
  const { isLoaded } = useClerkContext()

  if (isLoaded) {
    return null
  }

  return <>{children}</>
}
