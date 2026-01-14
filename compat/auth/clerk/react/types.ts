/**
 * @dotdo/clerk/react - Type Definitions
 *
 * Types for Clerk React SDK compatibility layer.
 *
 * @module
 */

import type {
  ClerkUser,
  ClerkSession,
  ClerkOrganization,
  ClerkOrganizationMembership,
  ClerkSignIn,
  ClerkSignUp,
} from '../types'

// ============================================================================
// CLERK OBJECT
// ============================================================================

/**
 * Clerk client object available via useClerk()
 */
export interface ClerkClient {
  /** Current user */
  user: ClerkUser | null
  /** Current session */
  session: ClerkSession | null
  /** Current organization */
  organization: ClerkOrganization | null
  /** Whether Clerk has loaded */
  loaded: boolean
  /** Sign out the current user */
  signOut: (options?: SignOutOptions) => Promise<void>
  /** Open the sign-in modal */
  openSignIn: (props?: SignInProps) => void
  /** Close the sign-in modal */
  closeSignIn: () => void
  /** Open the sign-up modal */
  openSignUp: (props?: SignUpProps) => void
  /** Close the sign-up modal */
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
  /** Set active session/organization */
  setActive: (params: SetActiveParams) => Promise<void>
  /** Get token for API calls */
  getToken: (options?: GetTokenOptions) => Promise<string | null>
}

// ============================================================================
// HOOK RETURN TYPES
// ============================================================================

/**
 * Return type for useAuth hook
 */
export interface UseAuthReturn {
  /** Whether auth state has loaded */
  isLoaded: boolean
  /** Whether user is signed in */
  isSignedIn: boolean
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
  /** Current organization permissions */
  orgPermissions: string[] | null
  /** Get authentication token */
  getToken: (options?: GetTokenOptions) => Promise<string | null>
  /** Check if user has specific permission */
  has: (params: HasParams) => boolean
  /** Sign out current user */
  signOut: (options?: SignOutOptions) => Promise<void>
}

/**
 * Return type for useUser hook
 */
export interface UseUserReturn {
  /** Whether user data has loaded */
  isLoaded: boolean
  /** Whether user is signed in */
  isSignedIn: boolean
  /** Current user object */
  user: UserResource | null | undefined
}

/**
 * Return type for useSession hook
 */
export interface UseSessionReturn {
  /** Whether session data has loaded */
  isLoaded: boolean
  /** Whether there is an active session */
  isSignedIn: boolean
  /** Current session object */
  session: SessionResource | null | undefined
}

/**
 * Return type for useSignIn hook
 */
export interface UseSignInReturn {
  /** Whether sign-in resource has loaded */
  isLoaded: boolean
  /** Sign-in resource for multi-step flows */
  signIn: SignInResource | null | undefined
  /** Set the active session after sign-in */
  setActive: (params: SetActiveParams) => Promise<void>
}

/**
 * Return type for useSignUp hook
 */
export interface UseSignUpReturn {
  /** Whether sign-up resource has loaded */
  isLoaded: boolean
  /** Sign-up resource for multi-step flows */
  signUp: SignUpResource | null | undefined
  /** Set the active session after sign-up */
  setActive: (params: SetActiveParams) => Promise<void>
}

/**
 * Return type for useOrganization hook
 */
export interface UseOrganizationReturn {
  /** Whether organization data has loaded */
  isLoaded: boolean
  /** Current organization */
  organization: OrganizationResource | null | undefined
  /** Current user's membership in the organization */
  membership: OrganizationMembershipResource | null | undefined
  /** Invite a user to the organization */
  invitations: OrganizationInvitationResource[]
  /** Organization members */
  memberships: OrganizationMembershipResource[]
}

/**
 * Return type for useOrganizationList hook
 */
export interface UseOrganizationListReturn {
  /** Whether the list has loaded */
  isLoaded: boolean
  /** Create a new organization */
  createOrganization: (params: CreateOrganizationParams) => Promise<OrganizationResource>
  /** Set the active organization */
  setActive: (params: SetActiveParams) => Promise<void>
  /** User's organization memberships */
  userMemberships: PaginatedResources<OrganizationMembershipResource>
  /** User's pending invitations */
  userInvitations: PaginatedResources<OrganizationInvitationResource>
  /** User's suggestions */
  userSuggestions: PaginatedResources<OrganizationSuggestionResource>
}

// ============================================================================
// RESOURCE TYPES
// ============================================================================

/**
 * User resource with methods
 */
export interface UserResource extends ClerkUser {
  /** Full name */
  fullName: string | null
  /** Primary email address */
  primaryEmailAddress: EmailAddressResource | null
  /** Primary phone number */
  primaryPhoneNumber: PhoneNumberResource | null
  /** Has the user verified their primary email */
  hasVerifiedEmailAddress: boolean
  /** Has the user verified their primary phone */
  hasVerifiedPhoneNumber: boolean
  /** Get organization memberships */
  getOrganizationMemberships: (params?: GetOrganizationMembershipsParams) => Promise<PaginatedResources<OrganizationMembershipResource>>
  /** Update user profile */
  update: (params: UpdateUserParams) => Promise<UserResource>
  /** Delete user account */
  delete: () => Promise<void>
  /** Set profile image */
  setProfileImage: (params: SetProfileImageParams) => Promise<ImageResource>
  /** Create email address */
  createEmailAddress: (params: CreateEmailAddressParams) => Promise<EmailAddressResource>
  /** Create phone number */
  createPhoneNumber: (params: CreatePhoneNumberParams) => Promise<PhoneNumberResource>
  /** Create external account (OAuth) */
  createExternalAccount: (params: CreateExternalAccountParams) => Promise<ExternalAccountResource>
  /** Create TOTP */
  createTOTP: () => Promise<TOTPResource>
  /** Create backup codes */
  createBackupCode: () => Promise<BackupCodeResource>
  /** Create passkey */
  createPasskey: () => Promise<PasskeyResource>
  /** Get sessions */
  getSessions: () => Promise<SessionResource[]>
}

/**
 * Session resource with methods
 */
export interface SessionResource extends ClerkSession {
  /** Get session token */
  getToken: (options?: GetTokenOptions) => Promise<string | null>
  /** Revoke session */
  revoke: () => Promise<SessionResource>
  /** End session */
  end: () => Promise<SessionResource>
  /** Touch session (update last active) */
  touch: () => Promise<SessionResource>
  /** Get user for this session */
  user: UserResource
}

/**
 * Organization resource with methods
 */
export interface OrganizationResource extends ClerkOrganization {
  /** Get members */
  getMemberships: (params?: GetMembershipsParams) => Promise<PaginatedResources<OrganizationMembershipResource>>
  /** Get pending invitations */
  getInvitations: (params?: GetInvitationsParams) => Promise<PaginatedResources<OrganizationInvitationResource>>
  /** Get membership requests */
  getMembershipRequests: (params?: GetMembershipRequestsParams) => Promise<PaginatedResources<OrganizationMembershipRequestResource>>
  /** Invite member */
  inviteMember: (params: InviteMemberParams) => Promise<OrganizationInvitationResource>
  /** Invite members in bulk */
  inviteMembers: (params: InviteMembersParams) => Promise<OrganizationInvitationResource[]>
  /** Add member directly */
  addMember: (params: AddMemberParams) => Promise<OrganizationMembershipResource>
  /** Update member */
  updateMember: (params: UpdateMemberParams) => Promise<OrganizationMembershipResource>
  /** Remove member */
  removeMember: (userId: string) => Promise<OrganizationMembershipResource>
  /** Update organization */
  update: (params: UpdateOrganizationParams) => Promise<OrganizationResource>
  /** Delete organization */
  destroy: () => Promise<void>
  /** Set organization logo */
  setLogo: (params: SetLogoParams) => Promise<OrganizationResource>
  /** Get roles */
  getRoles: () => Promise<PaginatedResources<RoleResource>>
  /** Create role */
  createRole: (params: CreateRoleParams) => Promise<RoleResource>
  /** Get domains */
  getDomains: () => Promise<PaginatedResources<OrganizationDomainResource>>
  /** Create domain */
  createDomain: (name: string) => Promise<OrganizationDomainResource>
}

/**
 * Sign-in resource for multi-step flows
 */
export interface SignInResource extends ClerkSignIn {
  /** Create sign-in attempt */
  create: (params: SignInCreateParams) => Promise<SignInResource>
  /** Prepare first factor */
  prepareFirstFactor: (params: PrepareFirstFactorParams) => Promise<SignInResource>
  /** Attempt first factor */
  attemptFirstFactor: (params: AttemptFirstFactorParams) => Promise<SignInResource>
  /** Prepare second factor */
  prepareSecondFactor: (params: PrepareSecondFactorParams) => Promise<SignInResource>
  /** Attempt second factor */
  attemptSecondFactor: (params: AttemptSecondFactorParams) => Promise<SignInResource>
  /** Reset password */
  resetPassword: (params: ResetPasswordParams) => Promise<SignInResource>
  /** Authenticate with redirect */
  authenticateWithRedirect: (params: AuthenticateWithRedirectParams) => Promise<void>
  /** Authenticate with metamask */
  authenticateWithMetamask: () => Promise<SignInResource>
  /** Authenticate with passkey */
  authenticateWithPasskey: () => Promise<SignInResource>
}

/**
 * Sign-up resource for multi-step flows
 */
export interface SignUpResource extends ClerkSignUp {
  /** Create sign-up attempt */
  create: (params: SignUpCreateParams) => Promise<SignUpResource>
  /** Update sign-up */
  update: (params: SignUpUpdateParams) => Promise<SignUpResource>
  /** Prepare email verification */
  prepareEmailAddressVerification: (params?: PrepareVerificationParams) => Promise<SignUpResource>
  /** Attempt email verification */
  attemptEmailAddressVerification: (params: AttemptVerificationParams) => Promise<SignUpResource>
  /** Prepare phone verification */
  preparePhoneNumberVerification: (params?: PrepareVerificationParams) => Promise<SignUpResource>
  /** Attempt phone verification */
  attemptPhoneNumberVerification: (params: AttemptVerificationParams) => Promise<SignUpResource>
  /** Authenticate with redirect */
  authenticateWithRedirect: (params: AuthenticateWithRedirectParams) => Promise<void>
  /** Authenticate with metamask */
  authenticateWithMetamask: () => Promise<SignUpResource>
}

// ============================================================================
// PARAMS TYPES
// ============================================================================

export interface GetTokenOptions {
  /** JWT template name */
  template?: string
  /** Skip cache */
  skipCache?: boolean
  /** Leeway in seconds */
  leewayInSeconds?: number
}

export interface SignOutOptions {
  /** Redirect URL after sign out */
  redirectUrl?: string
  /** Session ID to sign out (if not provided, signs out current session) */
  sessionId?: string
}

export interface SetActiveParams {
  /** Session to set as active */
  session?: SessionResource | string | null
  /** Organization to set as active */
  organization?: OrganizationResource | string | null
  /** Callback before session change */
  beforeEmit?: (session: SessionResource | null) => void | Promise<void>
}

export interface HasParams {
  /** Role to check */
  role?: string
  /** Permission to check */
  permission?: string
}

export interface SignInProps {
  /** Redirect URL after sign in */
  afterSignInUrl?: string
  /** Redirect URL after sign up */
  afterSignUpUrl?: string
  /** Initial values */
  initialValues?: {
    emailAddress?: string
    phoneNumber?: string
    username?: string
  }
  /** Sign up URL */
  signUpUrl?: string
  /** Force redirect URL */
  forceRedirectUrl?: string
  /** Fallback redirect URL */
  fallbackRedirectUrl?: string
}

export interface SignUpProps {
  /** Redirect URL after sign up */
  afterSignUpUrl?: string
  /** Initial values */
  initialValues?: {
    emailAddress?: string
    phoneNumber?: string
    username?: string
    firstName?: string
    lastName?: string
  }
  /** Sign in URL */
  signInUrl?: string
  /** Force redirect URL */
  forceRedirectUrl?: string
  /** Fallback redirect URL */
  fallbackRedirectUrl?: string
}

export interface UserProfileProps {
  /** Additional pages */
  additionalOAuthScopes?: Record<string, string[]>
  /** Custom pages */
  customPages?: Array<{
    label: string
    url: string
    mount?: (el: HTMLElement) => void
    unmount?: (el: HTMLElement) => void
  }>
}

export interface OrganizationProfileProps {
  /** Redirect after leaving org */
  afterLeaveOrganizationUrl?: string
  /** Custom pages */
  customPages?: Array<{
    label: string
    url: string
    mount?: (el: HTMLElement) => void
    unmount?: (el: HTMLElement) => void
  }>
}

export interface CreateOrganizationProps {
  /** Redirect after creation */
  afterCreateOrganizationUrl?: string
  /** Skip invitation screen */
  skipInvitationScreen?: boolean
}

export interface CreateOrganizationParams {
  name: string
  slug?: string
}

export interface UpdateUserParams {
  firstName?: string
  lastName?: string
  username?: string
  primaryEmailAddressId?: string
  primaryPhoneNumberId?: string
  primaryWeb3WalletId?: string
  unsafeMetadata?: Record<string, unknown>
}

export interface UpdateOrganizationParams {
  name?: string
  slug?: string
}

export interface SetProfileImageParams {
  file: File | Blob | null
}

export interface SetLogoParams {
  file: File | Blob | null
}

export interface GetOrganizationMembershipsParams {
  initialPage?: number
  pageSize?: number
}

export interface GetMembershipsParams {
  initialPage?: number
  pageSize?: number
  role?: string[]
}

export interface GetInvitationsParams {
  initialPage?: number
  pageSize?: number
  status?: 'pending' | 'accepted' | 'revoked'
}

export interface GetMembershipRequestsParams {
  initialPage?: number
  pageSize?: number
  status?: 'pending' | 'accepted' | 'rejected'
}

export interface InviteMemberParams {
  emailAddress: string
  role: string
  redirectUrl?: string
}

export interface InviteMembersParams {
  emailAddresses: string[]
  role: string
  redirectUrl?: string
}

export interface AddMemberParams {
  userId: string
  role: string
}

export interface UpdateMemberParams {
  userId: string
  role: string
}

export interface CreateRoleParams {
  name: string
  key: string
  description?: string
  permissions?: string[]
}

export interface CreateEmailAddressParams {
  email: string
}

export interface CreatePhoneNumberParams {
  phoneNumber: string
}

export interface CreateExternalAccountParams {
  strategy: OAuthStrategy
  redirectUrl?: string
  additionalScopes?: string[]
}

export interface SignInCreateParams {
  identifier?: string
  strategy?: string
  password?: string
  ticket?: string
  redirectUrl?: string
  transfer?: boolean
}

export interface SignUpCreateParams {
  emailAddress?: string
  phoneNumber?: string
  web3Wallet?: string
  username?: string
  password?: string
  firstName?: string
  lastName?: string
  unsafeMetadata?: Record<string, unknown>
  strategy?: string
  redirectUrl?: string
  actionCompleteRedirectUrl?: string
  transfer?: boolean
  ticket?: string
  captchaToken?: string
  captchaWidgetType?: 'invisible' | 'smart'
}

export interface SignUpUpdateParams {
  emailAddress?: string
  phoneNumber?: string
  web3Wallet?: string
  username?: string
  password?: string
  firstName?: string
  lastName?: string
  unsafeMetadata?: Record<string, unknown>
}

export interface PrepareFirstFactorParams {
  strategy: string
  emailAddressId?: string
  phoneNumberId?: string
  web3WalletId?: string
  redirectUrl?: string
}

export interface AttemptFirstFactorParams {
  strategy: string
  code?: string
  password?: string
  signature?: string
  redirectUrl?: string
}

export interface PrepareSecondFactorParams {
  strategy: string
  phoneNumberId?: string
}

export interface AttemptSecondFactorParams {
  strategy: string
  code?: string
}

export interface ResetPasswordParams {
  password: string
  signOutOfOtherSessions?: boolean
}

export interface AuthenticateWithRedirectParams {
  strategy: OAuthStrategy
  redirectUrl: string
  redirectUrlComplete: string
}

export interface PrepareVerificationParams {
  strategy?: 'phone_code' | 'email_code' | 'email_link'
}

export interface AttemptVerificationParams {
  code: string
}

// ============================================================================
// OTHER RESOURCE TYPES
// ============================================================================

export interface EmailAddressResource {
  id: string
  emailAddress: string
  verification: VerificationResource | null
  linkedTo: Array<{ id: string; type: string }>
  createdAt: Date
  updatedAt: Date
  prepareVerification: (params?: PrepareVerificationParams) => Promise<EmailAddressResource>
  attemptVerification: (params: AttemptVerificationParams) => Promise<EmailAddressResource>
  destroy: () => Promise<void>
}

export interface PhoneNumberResource {
  id: string
  phoneNumber: string
  verification: VerificationResource | null
  linkedTo: Array<{ id: string; type: string }>
  reservedForSecondFactor: boolean
  defaultSecondFactor: boolean
  createdAt: Date
  updatedAt: Date
  prepareVerification: (params?: PrepareVerificationParams) => Promise<PhoneNumberResource>
  attemptVerification: (params: AttemptVerificationParams) => Promise<PhoneNumberResource>
  setReservedForSecondFactor: (reserved: boolean) => Promise<PhoneNumberResource>
  destroy: () => Promise<void>
}

export interface VerificationResource {
  status: 'unverified' | 'verified' | 'transferable' | 'failed' | 'expired'
  strategy: string
  attempts: number | null
  expireAt: Date | null
  verifiedAtClient?: string
  externalVerificationRedirectURL?: URL | null
}

export interface ExternalAccountResource {
  id: string
  provider: string
  identificationId: string
  providerUserId: string
  emailAddress: string
  approvedScopes: string
  firstName: string | null
  lastName: string | null
  imageUrl: string | null
  username: string | null
  publicMetadata: Record<string, unknown>
  label: string | null
  verification: VerificationResource | null
  createdAt: Date
  updatedAt: Date
  destroy: () => Promise<void>
  reauthorize: (params: { redirectUrl: string; additionalScopes?: string[] }) => Promise<ExternalAccountResource>
}

export interface ImageResource {
  id: string
  name: string
  publicUrl: string
}

export interface TOTPResource {
  id: string
  secret: string
  uri: string
  verified: boolean
  backupCodes: string[]
  createdAt: Date
  updatedAt: Date
  verify: (params: { code: string }) => Promise<TOTPResource>
}

export interface BackupCodeResource {
  id: string
  codes: string[]
  createdAt: Date
  updatedAt: Date
}

export interface PasskeyResource {
  id: string
  name: string
  verification: VerificationResource | null
  createdAt: Date
  updatedAt: Date
  update: (params: { name: string }) => Promise<PasskeyResource>
  delete: () => Promise<void>
}

export interface OrganizationMembershipResource extends ClerkOrganizationMembership {
  destroy: () => Promise<OrganizationMembershipResource>
  update: (params: { role: string }) => Promise<OrganizationMembershipResource>
}

export interface OrganizationInvitationResource {
  id: string
  emailAddress: string
  role: string
  organizationId: string
  status: 'pending' | 'accepted' | 'revoked'
  createdAt: Date
  updatedAt: Date
  revoke: () => Promise<OrganizationInvitationResource>
}

export interface OrganizationMembershipRequestResource {
  id: string
  organizationId: string
  status: 'pending' | 'accepted' | 'rejected'
  publicUserData: {
    userId: string
    identifier: string
    firstName: string | null
    lastName: string | null
    imageUrl: string
  }
  createdAt: Date
  updatedAt: Date
  accept: () => Promise<OrganizationMembershipRequestResource>
  reject: () => Promise<OrganizationMembershipRequestResource>
}

export interface OrganizationSuggestionResource {
  id: string
  organizationId: string
  status: 'pending' | 'accepted'
  organization: OrganizationResource
  createdAt: Date
  updatedAt: Date
  accept: () => Promise<OrganizationMembershipResource>
}

export interface RoleResource {
  id: string
  name: string
  key: string
  description: string
  permissions: string[]
  isCreatorEligible: boolean
  createdAt: Date
  updatedAt: Date
  update: (params: { name?: string; description?: string; permissions?: string[] }) => Promise<RoleResource>
  delete: () => Promise<void>
}

export interface OrganizationDomainResource {
  id: string
  name: string
  organizationId: string
  enrollmentMode: 'manual_invitation' | 'automatic_invitation' | 'automatic_suggestion'
  verification: { status: 'unverified' | 'verified'; strategy: string } | null
  affiliationEmailAddress: string | null
  totalPendingInvitations: number
  totalPendingSuggestions: number
  createdAt: Date
  updatedAt: Date
  prepareDomainVerification: (params: { affiliationEmailAddress: string }) => Promise<OrganizationDomainResource>
  attemptDomainVerification: (params: { code: string }) => Promise<OrganizationDomainResource>
  delete: () => Promise<void>
}

// ============================================================================
// PAGINATION
// ============================================================================

export interface PaginatedResources<T> {
  data: T[]
  count: number
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  page: number
  pageCount: number
  fetchPage: (page: number) => void
  fetchPrevious: () => void
  fetchNext: () => void
  hasNextPage: boolean
  hasPreviousPage: boolean
  revalidate: () => void
  setSize: (size: number) => void
}

// ============================================================================
// OAUTH STRATEGIES
// ============================================================================

export type OAuthStrategy =
  | 'oauth_google'
  | 'oauth_github'
  | 'oauth_facebook'
  | 'oauth_apple'
  | 'oauth_microsoft'
  | 'oauth_twitter'
  | 'oauth_linkedin'
  | 'oauth_discord'
  | 'oauth_spotify'
  | 'oauth_twitch'
  | 'oauth_slack'
  | 'oauth_notion'
  | 'oauth_dropbox'
  | 'oauth_hubspot'
  | 'oauth_gitlab'
  | 'oauth_bitbucket'
  | 'oauth_linear'
  | 'oauth_tiktok'
  | 'oauth_coinbase'
  | 'oauth_line'
  | 'oauth_x'
  | 'oauth_custom'
