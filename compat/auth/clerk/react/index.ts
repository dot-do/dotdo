/**
 * @dotdo/clerk/react - Clerk React SDK Compatibility Layer
 *
 * Drop-in replacement for @clerk/clerk-react that works with the dotdo Clerk backend.
 * Provides all the standard Clerk React hooks and components.
 *
 * @example Basic Setup
 * ```tsx
 * import { ClerkProvider, SignedIn, SignedOut, UserButton } from '@dotdo/clerk/react'
 *
 * function App() {
 *   return (
 *     <ClerkProvider publishableKey="pk_test_xxx">
 *       <SignedIn>
 *         <UserButton />
 *         <Dashboard />
 *       </SignedIn>
 *       <SignedOut>
 *         <SignInButton />
 *       </SignedOut>
 *     </ClerkProvider>
 *   )
 * }
 * ```
 *
 * @example Hooks
 * ```tsx
 * import { useUser, useAuth, useClerk, useSession } from '@dotdo/clerk/react'
 *
 * function Profile() {
 *   const { user, isLoaded, isSignedIn } = useUser()
 *   const { getToken, signOut } = useAuth()
 *
 *   if (!isLoaded) return <div>Loading...</div>
 *   if (!isSignedIn) return <div>Please sign in</div>
 *
 *   return <div>Hello, {user.firstName}!</div>
 * }
 * ```
 *
 * @see https://clerk.com/docs/references/react
 * @module
 */

// Context and Provider
export { ClerkProvider, ClerkContext, useClerkContext } from './context'
export type { ClerkProviderProps, ClerkContextValue } from './context'

// Core hooks
export { useAuth } from './hooks/use-auth'
export { useClerk } from './hooks/use-clerk'
export { useUser } from './hooks/use-user'
export { useSession } from './hooks/use-session'
export { useSignIn } from './hooks/use-sign-in'
export { useSignUp } from './hooks/use-sign-up'
export { useOrganization } from './hooks/use-organization'
export { useOrganizationList } from './hooks/use-organization-list'

// Control components
export { SignedIn, SignedOut, ClerkLoaded, ClerkLoading } from './components/control'

// Authentication components
export { SignIn, SignUp, SignInButton, SignUpButton, SignOutButton } from './components/auth'

// User components
export { UserButton, UserProfile } from './components/user'

// Organization components
export {
  OrganizationSwitcher,
  OrganizationProfile,
  OrganizationList,
  CreateOrganization,
} from './components/organization'

// Protected components
export { Protect, RedirectToSignIn, RedirectToSignUp } from './components/protect'

// Types
export type {
  UseAuthReturn,
  UseUserReturn,
  UseSessionReturn,
  UseSignInReturn,
  UseSignUpReturn,
  UseOrganizationReturn,
  UseOrganizationListReturn,
} from './types'
