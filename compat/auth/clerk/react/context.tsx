/**
 * @dotdo/clerk/react - Context and Provider
 *
 * ClerkProvider wraps your app and provides Clerk context to all child components.
 *
 * @example
 * ```tsx
 * import { ClerkProvider } from '@dotdo/clerk/react'
 *
 * function App() {
 *   return (
 *     <ClerkProvider publishableKey="pk_test_xxx">
 *       <MyApp />
 *     </ClerkProvider>
 *   )
 * }
 * ```
 *
 * @module
 */

import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import type {
  ClerkUser,
  ClerkSession,
  ClerkOrganization,
} from '../types'
import type {
  ClerkClient,
  UserResource,
  SessionResource,
  OrganizationResource,
  SignInResource,
  SignUpResource,
  GetTokenOptions,
  SignOutOptions,
  SetActiveParams,
  SignInProps,
  SignUpProps,
  UserProfileProps,
  OrganizationProfileProps,
  CreateOrganizationProps,
} from './types'

// ============================================================================
// CONTEXT VALUE
// ============================================================================

/**
 * The value provided by ClerkContext
 */
export interface ClerkContextValue {
  /** Whether Clerk has loaded */
  isLoaded: boolean
  /** Whether the user is signed in */
  isSignedIn: boolean
  /** Current user object */
  user: UserResource | null
  /** Current session object */
  session: SessionResource | null
  /** Current organization */
  organization: OrganizationResource | null
  /** Current user ID */
  userId: string | null
  /** Current session ID */
  sessionId: string | null
  /** Current organization ID */
  orgId: string | null
  /** Current organization slug */
  orgSlug: string | null
  /** Current organization role */
  orgRole: string | null
  /** Clerk client object */
  clerk: ClerkClient | null
  /** SignIn resource for multi-step flows */
  signIn: SignInResource | null
  /** SignUp resource for multi-step flows */
  signUp: SignUpResource | null
  /** Get auth token */
  getToken: (options?: GetTokenOptions) => Promise<string | null>
  /** Sign out */
  signOut: (options?: SignOutOptions) => Promise<void>
  /** Set active session/organization */
  setActive: (params: SetActiveParams) => Promise<void>
  /** Open sign-in modal */
  openSignIn: (props?: SignInProps) => void
  /** Close sign-in modal */
  closeSignIn: () => void
  /** Open sign-up modal */
  openSignUp: (props?: SignUpProps) => void
  /** Close sign-up modal */
  closeSignUp: () => void
  /** Open user profile modal */
  openUserProfile: (props?: UserProfileProps) => void
  /** Close user profile modal */
  closeUserProfile: () => void
  /** Open organization profile modal */
  openOrganizationProfile: (props?: OrganizationProfileProps) => void
  /** Close organization profile modal */
  closeOrganizationProfile: () => void
  /** Open create organization modal */
  openCreateOrganization: (props?: CreateOrganizationProps) => void
  /** Close create organization modal */
  closeCreateOrganization: () => void
  /** Modal states */
  signInModal: { isOpen: boolean; props?: SignInProps }
  signUpModal: { isOpen: boolean; props?: SignUpProps }
  userProfileModal: { isOpen: boolean; props?: UserProfileProps }
  organizationProfileModal: { isOpen: boolean; props?: OrganizationProfileProps }
  createOrganizationModal: { isOpen: boolean; props?: CreateOrganizationProps }
  /** Publishable key */
  publishableKey: string
  /** Redirect URLs */
  afterSignInUrl?: string
  afterSignUpUrl?: string
  afterSignOutUrl?: string
  signInUrl?: string
  signUpUrl?: string
}

/**
 * Clerk React context
 */
export const ClerkContext = createContext<ClerkContextValue | null>(null)

/**
 * Hook to access Clerk context
 */
export function useClerkContext(): ClerkContextValue {
  const context = useContext(ClerkContext)
  if (!context) {
    throw new Error('useClerkContext must be used within a ClerkProvider')
  }
  return context
}

// ============================================================================
// PROVIDER PROPS
// ============================================================================

/**
 * ClerkProvider props
 */
export interface ClerkProviderProps {
  /** Your Clerk publishable key */
  publishableKey: string
  /** Child components */
  children: ReactNode
  /** URL to redirect to after sign in */
  afterSignInUrl?: string
  /** URL to redirect to after sign up */
  afterSignUpUrl?: string
  /** URL to redirect to after sign out */
  afterSignOutUrl?: string
  /** URL to the sign in page */
  signInUrl?: string
  /** URL to the sign up page */
  signUpUrl?: string
  /** Support email */
  supportEmail?: string
  /** Clerk Frontend API URL */
  frontendApi?: string
  /** Localization overrides */
  localization?: Record<string, unknown>
  /** Appearance overrides */
  appearance?: {
    baseTheme?: unknown
    layout?: Record<string, unknown>
    variables?: Record<string, string>
    elements?: Record<string, unknown>
  }
  /** Allow multiple sessions */
  allowedRedirectOrigins?: string[]
  /** Navigate function */
  navigate?: (to: string) => void | Promise<void>
  /** Router push function */
  routerPush?: (to: string) => void | Promise<void>
  /** Router replace function */
  routerReplace?: (to: string) => void | Promise<void>
  /** Initial state for SSR */
  initialState?: {
    user?: ClerkUser | null
    session?: ClerkSession | null
    organization?: ClerkOrganization | null
  }
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

/**
 * ClerkProvider component
 *
 * Wraps your application and provides Clerk authentication context.
 */
export function ClerkProvider({
  publishableKey,
  children,
  afterSignInUrl,
  afterSignUpUrl,
  afterSignOutUrl,
  signInUrl,
  signUpUrl,
  initialState,
  navigate,
  routerPush,
  routerReplace,
}: ClerkProviderProps): JSX.Element {
  // State
  const [isLoaded, setIsLoaded] = useState(!!initialState)
  const [user, setUser] = useState<UserResource | null>(
    initialState?.user ? convertToUserResource(initialState.user) : null
  )
  const [session, setSession] = useState<SessionResource | null>(
    initialState?.session ? convertToSessionResource(initialState.session, user) : null
  )
  const [organization, setOrganization] = useState<OrganizationResource | null>(
    initialState?.organization ? convertToOrganizationResource(initialState.organization) : null
  )
  const [signInState, setSignInState] = useState<SignInResource | null>(null)
  const [signUpState, setSignUpState] = useState<SignUpResource | null>(null)

  // Modal states
  const [signInModal, setSignInModal] = useState<{ isOpen: boolean; props?: SignInProps }>({ isOpen: false })
  const [signUpModal, setSignUpModal] = useState<{ isOpen: boolean; props?: SignUpProps }>({ isOpen: false })
  const [userProfileModal, setUserProfileModal] = useState<{ isOpen: boolean; props?: UserProfileProps }>({ isOpen: false })
  const [organizationProfileModal, setOrganizationProfileModal] = useState<{ isOpen: boolean; props?: OrganizationProfileProps }>({ isOpen: false })
  const [createOrganizationModal, setCreateOrganizationModal] = useState<{ isOpen: boolean; props?: CreateOrganizationProps }>({ isOpen: false })

  // Derived state
  const isSignedIn = !!session && session.status === 'active'
  const userId = user?.id ?? null
  const sessionId = session?.id ?? null
  const orgId = organization?.id ?? null
  const orgSlug = organization?.slug ?? null
  const orgRole = null // Would come from membership

  // Navigation helper
  const handleNavigate = useCallback((to: string) => {
    if (navigate) {
      navigate(to)
    } else if (routerPush) {
      routerPush(to)
    } else if (typeof window !== 'undefined') {
      window.location.href = to
    }
  }, [navigate, routerPush])

  // Get token
  const getToken = useCallback(async (options?: GetTokenOptions): Promise<string | null> => {
    if (!session) return null

    try {
      // In a real implementation, this would call the Clerk API
      // For now, return a placeholder that indicates a token request
      const template = options?.template ?? 'default'
      return `clerk-token-${session.id}-${template}`
    } catch {
      return null
    }
  }, [session])

  // Sign out
  const signOut = useCallback(async (options?: SignOutOptions): Promise<void> => {
    setUser(null)
    setSession(null)
    setOrganization(null)

    if (options?.redirectUrl) {
      handleNavigate(options.redirectUrl)
    } else if (afterSignOutUrl) {
      handleNavigate(afterSignOutUrl)
    }
  }, [afterSignOutUrl, handleNavigate])

  // Set active
  const setActive = useCallback(async (params: SetActiveParams): Promise<void> => {
    if (params.beforeEmit && session) {
      await params.beforeEmit(session)
    }

    if (params.session === null) {
      setSession(null)
    } else if (typeof params.session === 'string') {
      // Would fetch session by ID
    } else if (params.session) {
      setSession(params.session)
    }

    if (params.organization === null) {
      setOrganization(null)
    } else if (typeof params.organization === 'string') {
      // Would fetch organization by ID
    } else if (params.organization) {
      setOrganization(params.organization)
    }
  }, [session])

  // Modal handlers
  const openSignIn = useCallback((props?: SignInProps) => {
    setSignInModal({ isOpen: true, props })
  }, [])

  const closeSignIn = useCallback(() => {
    setSignInModal({ isOpen: false })
  }, [])

  const openSignUp = useCallback((props?: SignUpProps) => {
    setSignUpModal({ isOpen: true, props })
  }, [])

  const closeSignUp = useCallback(() => {
    setSignUpModal({ isOpen: false })
  }, [])

  const openUserProfile = useCallback((props?: UserProfileProps) => {
    setUserProfileModal({ isOpen: true, props })
  }, [])

  const closeUserProfile = useCallback(() => {
    setUserProfileModal({ isOpen: false })
  }, [])

  const openOrganizationProfile = useCallback((props?: OrganizationProfileProps) => {
    setOrganizationProfileModal({ isOpen: true, props })
  }, [])

  const closeOrganizationProfile = useCallback(() => {
    setOrganizationProfileModal({ isOpen: false })
  }, [])

  const openCreateOrganization = useCallback((props?: CreateOrganizationProps) => {
    setCreateOrganizationModal({ isOpen: true, props })
  }, [])

  const closeCreateOrganization = useCallback(() => {
    setCreateOrganizationModal({ isOpen: false })
  }, [])

  // Create clerk client object
  const clerk = useMemo<ClerkClient>(() => ({
    user,
    session,
    organization,
    loaded: isLoaded,
    signOut,
    openSignIn,
    closeSignIn,
    openSignUp,
    closeSignUp,
    openUserProfile,
    closeUserProfile,
    openOrganizationProfile,
    closeOrganizationProfile,
    openCreateOrganization,
    closeCreateOrganization,
    setActive,
    getToken,
  }), [
    user, session, organization, isLoaded, signOut,
    openSignIn, closeSignIn, openSignUp, closeSignUp,
    openUserProfile, closeUserProfile,
    openOrganizationProfile, closeOrganizationProfile,
    openCreateOrganization, closeCreateOrganization,
    setActive, getToken,
  ])

  // Initialize clerk
  useEffect(() => {
    if (isLoaded) return

    // In a real implementation, we would:
    // 1. Check for existing session cookie/token
    // 2. Validate the session with the Clerk API
    // 3. Load user data if session is valid

    const initializeClerk = async () => {
      try {
        // Check for session token in cookies or storage
        const sessionToken = typeof window !== 'undefined'
          ? document.cookie.split('; ').find(row => row.startsWith('__session='))?.split('=')[1]
          : null

        if (sessionToken) {
          // Would validate session and load user
          // For now, mark as loaded without a session
        }

        setIsLoaded(true)
      } catch {
        setIsLoaded(true)
      }
    }

    initializeClerk()
  }, [isLoaded])

  // Context value
  const contextValue = useMemo<ClerkContextValue>(() => ({
    isLoaded,
    isSignedIn,
    user,
    session,
    organization,
    userId,
    sessionId,
    orgId,
    orgSlug,
    orgRole,
    clerk,
    signIn: signInState,
    signUp: signUpState,
    getToken,
    signOut,
    setActive,
    openSignIn,
    closeSignIn,
    openSignUp,
    closeSignUp,
    openUserProfile,
    closeUserProfile,
    openOrganizationProfile,
    closeOrganizationProfile,
    openCreateOrganization,
    closeCreateOrganization,
    signInModal,
    signUpModal,
    userProfileModal,
    organizationProfileModal,
    createOrganizationModal,
    publishableKey,
    afterSignInUrl,
    afterSignUpUrl,
    afterSignOutUrl,
    signInUrl,
    signUpUrl,
  }), [
    isLoaded, isSignedIn, user, session, organization,
    userId, sessionId, orgId, orgSlug, orgRole, clerk,
    signInState, signUpState, getToken, signOut, setActive,
    openSignIn, closeSignIn, openSignUp, closeSignUp,
    openUserProfile, closeUserProfile,
    openOrganizationProfile, closeOrganizationProfile,
    openCreateOrganization, closeCreateOrganization,
    signInModal, signUpModal, userProfileModal,
    organizationProfileModal, createOrganizationModal,
    publishableKey, afterSignInUrl, afterSignUpUrl,
    afterSignOutUrl, signInUrl, signUpUrl,
  ])

  return (
    <ClerkContext.Provider value={contextValue}>
      {children}
    </ClerkContext.Provider>
  )
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert ClerkUser to UserResource
 */
function convertToUserResource(clerkUser: ClerkUser): UserResource {
  const primaryEmail = clerkUser.email_addresses.find(
    e => e.id === clerkUser.primary_email_address_id
  )
  const primaryPhone = clerkUser.phone_numbers.find(
    p => p.id === clerkUser.primary_phone_number_id
  )

  return {
    ...clerkUser,
    fullName: [clerkUser.first_name, clerkUser.last_name].filter(Boolean).join(' ') || null,
    primaryEmailAddress: primaryEmail ? {
      id: primaryEmail.id,
      emailAddress: primaryEmail.email_address,
      verification: primaryEmail.verification ? {
        status: primaryEmail.verification.status,
        strategy: primaryEmail.verification.strategy,
        attempts: primaryEmail.verification.attempts,
        expireAt: primaryEmail.verification.expire_at ? new Date(primaryEmail.verification.expire_at) : null,
      } : null,
      linkedTo: primaryEmail.linked_to,
      createdAt: new Date(primaryEmail.created_at),
      updatedAt: new Date(primaryEmail.updated_at),
      prepareVerification: async () => { throw new Error('Not implemented') },
      attemptVerification: async () => { throw new Error('Not implemented') },
      destroy: async () => { throw new Error('Not implemented') },
    } : null,
    primaryPhoneNumber: primaryPhone ? {
      id: primaryPhone.id,
      phoneNumber: primaryPhone.phone_number,
      verification: primaryPhone.verification ? {
        status: primaryPhone.verification.status,
        strategy: primaryPhone.verification.strategy,
        attempts: primaryPhone.verification.attempts,
        expireAt: primaryPhone.verification.expire_at ? new Date(primaryPhone.verification.expire_at) : null,
      } : null,
      linkedTo: primaryPhone.linked_to,
      reservedForSecondFactor: primaryPhone.reserved_for_second_factor,
      defaultSecondFactor: primaryPhone.default_second_factor,
      createdAt: new Date(primaryPhone.created_at),
      updatedAt: new Date(primaryPhone.updated_at),
      prepareVerification: async () => { throw new Error('Not implemented') },
      attemptVerification: async () => { throw new Error('Not implemented') },
      setReservedForSecondFactor: async () => { throw new Error('Not implemented') },
      destroy: async () => { throw new Error('Not implemented') },
    } : null,
    hasVerifiedEmailAddress: clerkUser.email_addresses.some(
      e => e.verification?.status === 'verified'
    ),
    hasVerifiedPhoneNumber: clerkUser.phone_numbers.some(
      p => p.verification?.status === 'verified'
    ),
    getOrganizationMemberships: async () => { throw new Error('Not implemented') },
    update: async () => { throw new Error('Not implemented') },
    delete: async () => { throw new Error('Not implemented') },
    setProfileImage: async () => { throw new Error('Not implemented') },
    createEmailAddress: async () => { throw new Error('Not implemented') },
    createPhoneNumber: async () => { throw new Error('Not implemented') },
    createExternalAccount: async () => { throw new Error('Not implemented') },
    createTOTP: async () => { throw new Error('Not implemented') },
    createBackupCode: async () => { throw new Error('Not implemented') },
    createPasskey: async () => { throw new Error('Not implemented') },
    getSessions: async () => { throw new Error('Not implemented') },
  }
}

/**
 * Convert ClerkSession to SessionResource
 */
function convertToSessionResource(clerkSession: ClerkSession, user: UserResource | null): SessionResource {
  return {
    ...clerkSession,
    user: user as UserResource,
    getToken: async () => `clerk-token-${clerkSession.id}`,
    revoke: async () => { throw new Error('Not implemented') },
    end: async () => { throw new Error('Not implemented') },
    touch: async () => { throw new Error('Not implemented') },
  }
}

/**
 * Convert ClerkOrganization to OrganizationResource
 */
function convertToOrganizationResource(clerkOrg: ClerkOrganization): OrganizationResource {
  return {
    ...clerkOrg,
    getMemberships: async () => { throw new Error('Not implemented') },
    getInvitations: async () => { throw new Error('Not implemented') },
    getMembershipRequests: async () => { throw new Error('Not implemented') },
    inviteMember: async () => { throw new Error('Not implemented') },
    inviteMembers: async () => { throw new Error('Not implemented') },
    addMember: async () => { throw new Error('Not implemented') },
    updateMember: async () => { throw new Error('Not implemented') },
    removeMember: async () => { throw new Error('Not implemented') },
    update: async () => { throw new Error('Not implemented') },
    destroy: async () => { throw new Error('Not implemented') },
    setLogo: async () => { throw new Error('Not implemented') },
    getRoles: async () => { throw new Error('Not implemented') },
    createRole: async () => { throw new Error('Not implemented') },
    getDomains: async () => { throw new Error('Not implemented') },
    createDomain: async () => { throw new Error('Not implemented') },
  }
}
