/**
 * User Components
 *
 * Components for displaying and managing user profile.
 *
 * @example
 * ```tsx
 * // User button with dropdown
 * <UserButton afterSignOutUrl="/" />
 *
 * // Full user profile
 * <UserProfile />
 * ```
 *
 * @module
 */

import { useCallback, useState, useRef, useEffect, type MouseEvent } from 'react'
import { useClerkContext } from '../context'
import type { UserProfileProps as UserProfileModalProps } from '../types'

// ============================================================================
// USER BUTTON
// ============================================================================

/**
 * UserButton component props
 */
export interface UserButtonProps {
  /** Appearance customization */
  appearance?: {
    baseTheme?: unknown
    layout?: Record<string, unknown>
    variables?: Record<string, string>
    elements?: Record<string, unknown>
  }
  /** URL to redirect after sign out */
  afterSignOutUrl?: string
  /** URL to redirect after switching sessions */
  afterSwitchSessionUrl?: string
  /** URL to redirect after switching organizations */
  afterMultiSessionSingleSignOutUrl?: string
  /** Show user's name next to the avatar */
  showName?: boolean
  /** Sign in URL */
  signInUrl?: string
  /** User profile URL */
  userProfileUrl?: string
  /** User profile mode */
  userProfileMode?: 'modal' | 'navigation'
  /** Default open state */
  defaultOpen?: boolean
}

/**
 * User button with avatar and dropdown menu.
 *
 * @example
 * ```tsx
 * <UserButton
 *   afterSignOutUrl="/"
 *   showName
 * />
 * ```
 */
export function UserButton({
  appearance,
  afterSignOutUrl,
  afterSwitchSessionUrl,
  afterMultiSessionSingleSignOutUrl,
  showName = false,
  signInUrl,
  userProfileUrl,
  userProfileMode = 'modal',
  defaultOpen = false,
}: UserButtonProps): JSX.Element | null {
  const { user, isSignedIn, signOut, openUserProfile, afterSignOutUrl: contextAfterSignOutUrl } = useClerkContext()
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleToggle = useCallback((e: MouseEvent) => {
    e.preventDefault()
    setIsOpen(prev => !prev)
  }, [])

  const handleManageAccount = useCallback((e: MouseEvent) => {
    e.preventDefault()
    setIsOpen(false)
    if (userProfileMode === 'modal') {
      openUserProfile()
    } else if (userProfileUrl) {
      window.location.href = userProfileUrl
    }
  }, [userProfileMode, openUserProfile, userProfileUrl])

  const handleSignOut = useCallback(async (e: MouseEvent) => {
    e.preventDefault()
    setIsOpen(false)
    await signOut({
      redirectUrl: afterSignOutUrl ?? contextAfterSignOutUrl,
    })
  }, [signOut, afterSignOutUrl, contextAfterSignOutUrl])

  if (!isSignedIn || !user) {
    return null
  }

  const displayName = user.first_name ?? user.username ?? user.email_addresses[0]?.email_address ?? 'User'
  const initials = getInitials(user.first_name, user.last_name) || displayName[0]?.toUpperCase() || 'U'

  return (
    <div className="cl-user-button" ref={dropdownRef} data-clerk-component="user-button">
      <button
        type="button"
        className="cl-user-button-trigger"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="cl-user-button-avatar">
          {user.has_image && user.image_url ? (
            <img
              src={user.image_url}
              alt={displayName}
              className="cl-user-button-avatar-image"
            />
          ) : (
            <span className="cl-user-button-avatar-initials">{initials}</span>
          )}
        </span>
        {showName && (
          <span className="cl-user-button-name">{displayName}</span>
        )}
      </button>

      {isOpen && (
        <div className="cl-user-button-popover" role="menu">
          <div className="cl-user-button-popover-card">
            <div className="cl-user-button-popover-header">
              <span className="cl-user-button-popover-avatar">
                {user.has_image && user.image_url ? (
                  <img
                    src={user.image_url}
                    alt={displayName}
                    className="cl-user-button-popover-avatar-image"
                  />
                ) : (
                  <span className="cl-user-button-popover-avatar-initials">{initials}</span>
                )}
              </span>
              <div className="cl-user-button-popover-info">
                {(user.first_name || user.last_name) && (
                  <p className="cl-user-button-popover-name">
                    {[user.first_name, user.last_name].filter(Boolean).join(' ')}
                  </p>
                )}
                {user.email_addresses[0] && (
                  <p className="cl-user-button-popover-email">
                    {user.email_addresses[0].email_address}
                  </p>
                )}
              </div>
            </div>

            <div className="cl-user-button-popover-actions">
              <button
                type="button"
                className="cl-user-button-popover-action"
                onClick={handleManageAccount}
                role="menuitem"
              >
                <ManageAccountIcon />
                Manage account
              </button>
              <button
                type="button"
                className="cl-user-button-popover-action"
                onClick={handleSignOut}
                role="menuitem"
              >
                <SignOutIcon />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// USER PROFILE
// ============================================================================

/**
 * UserProfile component props
 */
export interface UserProfileProps {
  /** Appearance customization */
  appearance?: {
    baseTheme?: unknown
    layout?: Record<string, unknown>
    variables?: Record<string, string>
    elements?: Record<string, unknown>
  }
  /** Additional OAuth scopes */
  additionalOAuthScopes?: Record<string, string[]>
  /** Routing mode */
  routing?: 'path' | 'hash' | 'virtual'
  /** Path for path-based routing */
  path?: string
}

/**
 * Full user profile management component.
 *
 * @example
 * ```tsx
 * <UserProfile />
 * ```
 */
export function UserProfile({
  appearance,
  additionalOAuthScopes,
  routing = 'path',
  path,
}: UserProfileProps): JSX.Element | null {
  const { user, isSignedIn, isLoaded } = useClerkContext()
  const [activeTab, setActiveTab] = useState<'profile' | 'security'>('profile')

  if (!isLoaded) {
    return (
      <div className="cl-user-profile" data-clerk-component="user-profile">
        <div className="cl-loading">Loading...</div>
      </div>
    )
  }

  if (!isSignedIn || !user) {
    return null
  }

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'User'
  const initials = getInitials(user.first_name, user.last_name) || displayName[0]?.toUpperCase() || 'U'

  return (
    <div className="cl-user-profile" data-clerk-component="user-profile">
      <div className="cl-user-profile-header">
        <span className="cl-user-profile-avatar">
          {user.has_image && user.image_url ? (
            <img
              src={user.image_url}
              alt={displayName}
              className="cl-user-profile-avatar-image"
            />
          ) : (
            <span className="cl-user-profile-avatar-initials">{initials}</span>
          )}
        </span>
        <div className="cl-user-profile-info">
          <h2 className="cl-user-profile-name">{displayName}</h2>
          {user.email_addresses[0] && (
            <p className="cl-user-profile-email">
              {user.email_addresses[0].email_address}
            </p>
          )}
        </div>
      </div>

      <nav className="cl-user-profile-nav">
        <button
          type="button"
          className={`cl-user-profile-nav-item ${activeTab === 'profile' ? 'cl-active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          Profile
        </button>
        <button
          type="button"
          className={`cl-user-profile-nav-item ${activeTab === 'security' ? 'cl-active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          Security
        </button>
      </nav>

      <div className="cl-user-profile-content">
        {activeTab === 'profile' && (
          <div className="cl-user-profile-section">
            <h3 className="cl-user-profile-section-title">Profile details</h3>

            <div className="cl-user-profile-field">
              <span className="cl-user-profile-field-label">First name</span>
              <span className="cl-user-profile-field-value">
                {user.first_name || <span className="cl-empty">Not set</span>}
              </span>
            </div>

            <div className="cl-user-profile-field">
              <span className="cl-user-profile-field-label">Last name</span>
              <span className="cl-user-profile-field-value">
                {user.last_name || <span className="cl-empty">Not set</span>}
              </span>
            </div>

            <div className="cl-user-profile-field">
              <span className="cl-user-profile-field-label">Username</span>
              <span className="cl-user-profile-field-value">
                {user.username || <span className="cl-empty">Not set</span>}
              </span>
            </div>

            <h3 className="cl-user-profile-section-title">Email addresses</h3>
            {user.email_addresses.map((email) => (
              <div key={email.id} className="cl-user-profile-field">
                <span className="cl-user-profile-field-value">
                  {email.email_address}
                  {email.id === user.primary_email_address_id && (
                    <span className="cl-badge">Primary</span>
                  )}
                  {email.verification?.status === 'verified' && (
                    <span className="cl-badge cl-verified">Verified</span>
                  )}
                </span>
              </div>
            ))}

            {user.phone_numbers.length > 0 && (
              <>
                <h3 className="cl-user-profile-section-title">Phone numbers</h3>
                {user.phone_numbers.map((phone) => (
                  <div key={phone.id} className="cl-user-profile-field">
                    <span className="cl-user-profile-field-value">
                      {phone.phone_number}
                      {phone.id === user.primary_phone_number_id && (
                        <span className="cl-badge">Primary</span>
                      )}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === 'security' && (
          <div className="cl-user-profile-section">
            <h3 className="cl-user-profile-section-title">Password</h3>
            <div className="cl-user-profile-field">
              <span className="cl-user-profile-field-label">Password</span>
              <span className="cl-user-profile-field-value">
                {user.password_enabled ? '********' : <span className="cl-empty">Not set</span>}
              </span>
            </div>

            <h3 className="cl-user-profile-section-title">Two-factor authentication</h3>
            <div className="cl-user-profile-field">
              <span className="cl-user-profile-field-label">Authenticator app</span>
              <span className="cl-user-profile-field-value">
                {user.totp_enabled ? (
                  <span className="cl-badge cl-verified">Enabled</span>
                ) : (
                  <span className="cl-empty">Not enabled</span>
                )}
              </span>
            </div>
            <div className="cl-user-profile-field">
              <span className="cl-user-profile-field-label">Backup codes</span>
              <span className="cl-user-profile-field-value">
                {user.backup_code_enabled ? (
                  <span className="cl-badge cl-verified">Generated</span>
                ) : (
                  <span className="cl-empty">Not generated</span>
                )}
              </span>
            </div>

            {user.external_accounts.length > 0 && (
              <>
                <h3 className="cl-user-profile-section-title">Connected accounts</h3>
                {user.external_accounts.map((account) => (
                  <div key={account.id} className="cl-user-profile-field">
                    <span className="cl-user-profile-field-value">
                      <span className="cl-provider-icon">{getProviderIcon(account.provider)}</span>
                      {account.provider}
                      {account.email_address && ` - ${account.email_address}`}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get initials from first and last name
 */
function getInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.[0]?.toUpperCase() ?? ''
  const last = lastName?.[0]?.toUpperCase() ?? ''
  return first + last
}

/**
 * Get icon for OAuth provider
 */
function getProviderIcon(provider: string): string {
  const icons: Record<string, string> = {
    google: 'G',
    github: 'GH',
    facebook: 'FB',
    apple: 'A',
    microsoft: 'MS',
    twitter: 'TW',
    linkedin: 'LI',
    discord: 'DC',
  }
  return icons[provider.toLowerCase()] ?? provider[0]?.toUpperCase() ?? '?'
}

// ============================================================================
// ICONS
// ============================================================================

function ManageAccountIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="16"
      height="16"
      className="cl-icon"
    >
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  )
}

function SignOutIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="16"
      height="16"
      className="cl-icon"
    >
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
    </svg>
  )
}
