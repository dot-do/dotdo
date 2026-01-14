/**
 * Authentication Components
 *
 * Components for sign-in, sign-up, and sign-out functionality.
 *
 * @example
 * ```tsx
 * // Full sign-in form
 * <SignIn afterSignInUrl="/dashboard" />
 *
 * // Button that opens modal
 * <SignInButton mode="modal">
 *   <button>Sign In</button>
 * </SignInButton>
 * ```
 *
 * @module
 */

import { useCallback, useState, type ReactNode, type ReactElement, type MouseEvent, type FormEvent, cloneElement, isValidElement } from 'react'
import { useClerkContext } from '../context'
import type { SignInProps as SignInModalProps, SignUpProps as SignUpModalProps } from '../types'

// ============================================================================
// SIGN IN COMPONENT
// ============================================================================

/**
 * SignIn component props
 */
export interface SignInProps {
  /** Appearance customization */
  appearance?: {
    baseTheme?: unknown
    layout?: Record<string, unknown>
    variables?: Record<string, string>
    elements?: Record<string, unknown>
  }
  /** Path to redirect after sign in */
  afterSignInUrl?: string
  /** Path to redirect after sign up */
  afterSignUpUrl?: string
  /** Path to the sign up page */
  signUpUrl?: string
  /** Force redirect URL */
  forceRedirectUrl?: string
  /** Fallback redirect URL */
  fallbackRedirectUrl?: string
  /** Initial values */
  initialValues?: {
    emailAddress?: string
    phoneNumber?: string
    username?: string
  }
  /** Routing mode */
  routing?: 'path' | 'hash' | 'virtual'
  /** Path for path-based routing */
  path?: string
  /** Transfer state between sign-in and sign-up */
  transferable?: boolean
}

/**
 * Full sign-in component with email/password form.
 *
 * @example
 * ```tsx
 * <SignIn afterSignInUrl="/dashboard" />
 * ```
 */
export function SignIn({
  appearance,
  afterSignInUrl,
  afterSignUpUrl,
  signUpUrl,
  forceRedirectUrl,
  fallbackRedirectUrl,
  initialValues,
  routing = 'path',
  path,
  transferable = true,
}: SignInProps): JSX.Element {
  const { signIn, setActive, signInUrl, afterSignInUrl: contextAfterSignIn, afterSignUpUrl: contextAfterSignUp } = useClerkContext()
  const [identifier, setIdentifier] = useState(initialValues?.emailAddress ?? initialValues?.username ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [step, setStep] = useState<'identifier' | 'password'>('identifier')

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      if (step === 'identifier') {
        // In a real implementation, this would call signIn.create({ identifier })
        // and check if password is needed
        setStep('password')
      } else {
        // In a real implementation, this would attempt to sign in
        // For now, show an error
        setError('Sign-in is not yet implemented')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }, [step])

  const finalSignUpUrl = signUpUrl ?? '/sign-up'
  const finalAfterSignInUrl = forceRedirectUrl ?? afterSignInUrl ?? contextAfterSignIn ?? '/'
  const finalAfterSignUpUrl = afterSignUpUrl ?? contextAfterSignUp ?? '/'

  return (
    <div className="cl-component cl-sign-in" data-clerk-component="sign-in">
      <div className="cl-card">
        <div className="cl-header">
          <h1 className="cl-header-title">Sign in</h1>
          <p className="cl-header-subtitle">to continue to your app</p>
        </div>

        <form onSubmit={handleSubmit} className="cl-form">
          {step === 'identifier' && (
            <div className="cl-form-field">
              <label className="cl-form-field-label" htmlFor="identifier">
                Email or username
              </label>
              <input
                id="identifier"
                type="text"
                className="cl-form-field-input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Enter your email or username"
                disabled={isLoading}
                autoFocus
              />
            </div>
          )}

          {step === 'password' && (
            <>
              <div className="cl-form-field">
                <label className="cl-form-field-label" htmlFor="identifier-display">
                  Email or username
                </label>
                <div className="cl-form-field-display">
                  {identifier}
                  <button
                    type="button"
                    className="cl-form-field-edit"
                    onClick={() => setStep('identifier')}
                  >
                    Edit
                  </button>
                </div>
              </div>
              <div className="cl-form-field">
                <label className="cl-form-field-label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="cl-form-field-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  disabled={isLoading}
                  autoFocus
                />
              </div>
            </>
          )}

          {error && (
            <div className="cl-form-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="cl-form-button-primary"
            disabled={isLoading || !identifier}
          >
            {isLoading ? 'Please wait...' : step === 'identifier' ? 'Continue' : 'Sign in'}
          </button>
        </form>

        <div className="cl-footer">
          <span className="cl-footer-text">Don't have an account?</span>
          <a href={finalSignUpUrl} className="cl-footer-link">
            Sign up
          </a>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// SIGN UP COMPONENT
// ============================================================================

/**
 * SignUp component props
 */
export interface SignUpProps {
  /** Appearance customization */
  appearance?: {
    baseTheme?: unknown
    layout?: Record<string, unknown>
    variables?: Record<string, string>
    elements?: Record<string, unknown>
  }
  /** Path to redirect after sign up */
  afterSignUpUrl?: string
  /** Path to the sign in page */
  signInUrl?: string
  /** Force redirect URL */
  forceRedirectUrl?: string
  /** Fallback redirect URL */
  fallbackRedirectUrl?: string
  /** Initial values */
  initialValues?: {
    emailAddress?: string
    phoneNumber?: string
    username?: string
    firstName?: string
    lastName?: string
  }
  /** Routing mode */
  routing?: 'path' | 'hash' | 'virtual'
  /** Path for path-based routing */
  path?: string
}

/**
 * Full sign-up component with registration form.
 *
 * @example
 * ```tsx
 * <SignUp afterSignUpUrl="/welcome" />
 * ```
 */
export function SignUp({
  appearance,
  afterSignUpUrl,
  signInUrl,
  forceRedirectUrl,
  fallbackRedirectUrl,
  initialValues,
  routing = 'path',
  path,
}: SignUpProps): JSX.Element {
  const { signUp, setActive, signUpUrl: contextSignUpUrl, afterSignUpUrl: contextAfterSignUp } = useClerkContext()
  const [email, setEmail] = useState(initialValues?.emailAddress ?? '')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState(initialValues?.firstName ?? '')
  const [lastName, setLastName] = useState(initialValues?.lastName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [step, setStep] = useState<'form' | 'verification'>('form')
  const [verificationCode, setVerificationCode] = useState('')

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      if (step === 'form') {
        // In a real implementation, this would call signUp.create({ ... })
        // and then prepare email verification
        setStep('verification')
      } else {
        // In a real implementation, this would verify the code
        setError('Sign-up is not yet implemented')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }, [step])

  const finalSignInUrl = signInUrl ?? '/sign-in'
  const finalAfterSignUpUrl = forceRedirectUrl ?? afterSignUpUrl ?? contextAfterSignUp ?? '/'

  return (
    <div className="cl-component cl-sign-up" data-clerk-component="sign-up">
      <div className="cl-card">
        <div className="cl-header">
          <h1 className="cl-header-title">Create your account</h1>
          <p className="cl-header-subtitle">to continue to your app</p>
        </div>

        <form onSubmit={handleSubmit} className="cl-form">
          {step === 'form' && (
            <>
              <div className="cl-form-field-row">
                <div className="cl-form-field">
                  <label className="cl-form-field-label" htmlFor="firstName">
                    First name
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    className="cl-form-field-input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                    disabled={isLoading}
                  />
                </div>
                <div className="cl-form-field">
                  <label className="cl-form-field-label" htmlFor="lastName">
                    Last name
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    className="cl-form-field-input"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last name"
                    disabled={isLoading}
                  />
                </div>
              </div>
              <div className="cl-form-field">
                <label className="cl-form-field-label" htmlFor="email">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  className="cl-form-field-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  disabled={isLoading}
                  required
                />
              </div>
              <div className="cl-form-field">
                <label className="cl-form-field-label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="cl-form-field-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  disabled={isLoading}
                  required
                />
              </div>
            </>
          )}

          {step === 'verification' && (
            <div className="cl-form-field">
              <label className="cl-form-field-label" htmlFor="code">
                Verification code
              </label>
              <p className="cl-form-field-hint">
                We sent a code to {email}
              </p>
              <input
                id="code"
                type="text"
                className="cl-form-field-input"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                placeholder="Enter verification code"
                disabled={isLoading}
                autoFocus
              />
            </div>
          )}

          {error && (
            <div className="cl-form-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="cl-form-button-primary"
            disabled={isLoading || (step === 'form' ? !email || !password : !verificationCode)}
          >
            {isLoading ? 'Please wait...' : step === 'form' ? 'Continue' : 'Verify'}
          </button>
        </form>

        <div className="cl-footer">
          <span className="cl-footer-text">Already have an account?</span>
          <a href={finalSignInUrl} className="cl-footer-link">
            Sign in
          </a>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// SIGN IN BUTTON
// ============================================================================

/**
 * SignInButton component props
 */
export interface SignInButtonProps {
  /** Child element (defaults to a button) */
  children?: ReactNode
  /** Mode: redirect to page or open modal */
  mode?: 'redirect' | 'modal'
  /** Redirect URL after sign in */
  afterSignInUrl?: string
  /** Redirect URL after sign up */
  afterSignUpUrl?: string
  /** Force redirect URL */
  forceRedirectUrl?: string
  /** Fallback redirect URL */
  fallbackRedirectUrl?: string
}

/**
 * Button that initiates sign-in.
 *
 * @example
 * ```tsx
 * // Default button
 * <SignInButton />
 *
 * // Custom button
 * <SignInButton mode="modal">
 *   <button className="my-button">Sign In</button>
 * </SignInButton>
 * ```
 */
export function SignInButton({
  children,
  mode = 'redirect',
  afterSignInUrl,
  afterSignUpUrl,
  forceRedirectUrl,
  fallbackRedirectUrl,
}: SignInButtonProps): JSX.Element {
  const { openSignIn, signInUrl } = useClerkContext()

  const handleClick = useCallback((e: MouseEvent) => {
    e.preventDefault()
    if (mode === 'modal') {
      openSignIn({
        afterSignInUrl,
        afterSignUpUrl,
        forceRedirectUrl,
        fallbackRedirectUrl,
      })
    } else {
      const url = forceRedirectUrl ?? signInUrl ?? '/sign-in'
      window.location.href = url
    }
  }, [mode, openSignIn, afterSignInUrl, afterSignUpUrl, forceRedirectUrl, fallbackRedirectUrl, signInUrl])

  // If children is a valid element, clone it with onClick handler
  if (isValidElement(children)) {
    return cloneElement(children as ReactElement<{ onClick?: (e: MouseEvent) => void }>, {
      onClick: handleClick,
    })
  }

  // Default button
  return (
    <button
      type="button"
      className="cl-button cl-sign-in-button"
      onClick={handleClick}
    >
      {children ?? 'Sign in'}
    </button>
  )
}

// ============================================================================
// SIGN UP BUTTON
// ============================================================================

/**
 * SignUpButton component props
 */
export interface SignUpButtonProps {
  /** Child element (defaults to a button) */
  children?: ReactNode
  /** Mode: redirect to page or open modal */
  mode?: 'redirect' | 'modal'
  /** Redirect URL after sign up */
  afterSignUpUrl?: string
  /** Force redirect URL */
  forceRedirectUrl?: string
  /** Fallback redirect URL */
  fallbackRedirectUrl?: string
}

/**
 * Button that initiates sign-up.
 *
 * @example
 * ```tsx
 * <SignUpButton mode="modal">
 *   <button>Get Started</button>
 * </SignUpButton>
 * ```
 */
export function SignUpButton({
  children,
  mode = 'redirect',
  afterSignUpUrl,
  forceRedirectUrl,
  fallbackRedirectUrl,
}: SignUpButtonProps): JSX.Element {
  const { openSignUp, signUpUrl } = useClerkContext()

  const handleClick = useCallback((e: MouseEvent) => {
    e.preventDefault()
    if (mode === 'modal') {
      openSignUp({
        afterSignUpUrl,
        forceRedirectUrl,
        fallbackRedirectUrl,
      })
    } else {
      const url = forceRedirectUrl ?? signUpUrl ?? '/sign-up'
      window.location.href = url
    }
  }, [mode, openSignUp, afterSignUpUrl, forceRedirectUrl, fallbackRedirectUrl, signUpUrl])

  if (isValidElement(children)) {
    return cloneElement(children as ReactElement<{ onClick?: (e: MouseEvent) => void }>, {
      onClick: handleClick,
    })
  }

  return (
    <button
      type="button"
      className="cl-button cl-sign-up-button"
      onClick={handleClick}
    >
      {children ?? 'Sign up'}
    </button>
  )
}

// ============================================================================
// SIGN OUT BUTTON
// ============================================================================

/**
 * SignOutButton component props
 */
export interface SignOutButtonProps {
  /** Child element (defaults to a button) */
  children?: ReactNode
  /** Redirect URL after sign out */
  redirectUrl?: string
  /** Sign out all sessions or just current */
  signOutOptions?: {
    sessionId?: string
    redirectUrl?: string
  }
}

/**
 * Button that signs the user out.
 *
 * @example
 * ```tsx
 * <SignOutButton>
 *   <button>Log out</button>
 * </SignOutButton>
 * ```
 */
export function SignOutButton({
  children,
  redirectUrl,
  signOutOptions,
}: SignOutButtonProps): JSX.Element {
  const { signOut, afterSignOutUrl } = useClerkContext()

  const handleClick = useCallback(async (e: MouseEvent) => {
    e.preventDefault()
    await signOut({
      redirectUrl: redirectUrl ?? signOutOptions?.redirectUrl ?? afterSignOutUrl,
      sessionId: signOutOptions?.sessionId,
    })
  }, [signOut, redirectUrl, signOutOptions, afterSignOutUrl])

  if (isValidElement(children)) {
    return cloneElement(children as ReactElement<{ onClick?: (e: MouseEvent) => void }>, {
      onClick: handleClick,
    })
  }

  return (
    <button
      type="button"
      className="cl-button cl-sign-out-button"
      onClick={handleClick}
    >
      {children ?? 'Sign out'}
    </button>
  )
}
