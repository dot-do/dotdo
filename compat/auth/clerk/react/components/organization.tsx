/**
 * Organization Components
 *
 * Components for managing organizations.
 *
 * @example
 * ```tsx
 * // Organization switcher dropdown
 * <OrganizationSwitcher />
 *
 * // Full organization profile
 * <OrganizationProfile />
 *
 * // Create organization form
 * <CreateOrganization />
 * ```
 *
 * @module
 */

import { useCallback, useState, useRef, useEffect, type MouseEvent, type FormEvent } from 'react'
import { useClerkContext } from '../context'
import type { CreateOrganizationProps as CreateOrganizationModalProps } from '../types'

// ============================================================================
// ORGANIZATION SWITCHER
// ============================================================================

/**
 * OrganizationSwitcher component props
 */
export interface OrganizationSwitcherProps {
  /** Appearance customization */
  appearance?: {
    baseTheme?: unknown
    layout?: Record<string, unknown>
    variables?: Record<string, string>
    elements?: Record<string, unknown>
  }
  /** URL to redirect after selecting personal */
  afterSelectPersonalUrl?: string
  /** URL to redirect after selecting organization */
  afterSelectOrganizationUrl?: string
  /** URL to redirect after creating organization */
  afterCreateOrganizationUrl?: string
  /** URL to redirect after leaving organization */
  afterLeaveOrganizationUrl?: string
  /** Hide personal workspace option */
  hidePersonal?: boolean
  /** Create organization mode */
  createOrganizationMode?: 'modal' | 'navigation'
  /** Organization profile mode */
  organizationProfileMode?: 'modal' | 'navigation'
  /** Create organization URL */
  createOrganizationUrl?: string
  /** Organization profile URL */
  organizationProfileUrl?: string
  /** Skip invitation screen when creating */
  skipInvitationScreen?: boolean
  /** Default open state */
  defaultOpen?: boolean
}

/**
 * Organization switcher dropdown.
 *
 * @example
 * ```tsx
 * <OrganizationSwitcher
 *   afterSelectOrganizationUrl="/dashboard"
 * />
 * ```
 */
export function OrganizationSwitcher({
  appearance,
  afterSelectPersonalUrl,
  afterSelectOrganizationUrl,
  afterCreateOrganizationUrl,
  afterLeaveOrganizationUrl,
  hidePersonal = false,
  createOrganizationMode = 'modal',
  organizationProfileMode = 'modal',
  createOrganizationUrl,
  organizationProfileUrl,
  skipInvitationScreen = false,
  defaultOpen = false,
}: OrganizationSwitcherProps): JSX.Element | null {
  const { user, organization, isSignedIn, setActive, openCreateOrganization, openOrganizationProfile } = useClerkContext()
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

  const handleSelectPersonal = useCallback(async (e: MouseEvent) => {
    e.preventDefault()
    setIsOpen(false)
    await setActive({ organization: null })
    if (afterSelectPersonalUrl) {
      window.location.href = afterSelectPersonalUrl
    }
  }, [setActive, afterSelectPersonalUrl])

  const handleCreateOrganization = useCallback((e: MouseEvent) => {
    e.preventDefault()
    setIsOpen(false)
    if (createOrganizationMode === 'modal') {
      openCreateOrganization({
        afterCreateOrganizationUrl,
        skipInvitationScreen,
      })
    } else if (createOrganizationUrl) {
      window.location.href = createOrganizationUrl
    }
  }, [createOrganizationMode, openCreateOrganization, afterCreateOrganizationUrl, skipInvitationScreen, createOrganizationUrl])

  const handleManageOrganization = useCallback((e: MouseEvent) => {
    e.preventDefault()
    setIsOpen(false)
    if (organizationProfileMode === 'modal') {
      openOrganizationProfile({ afterLeaveOrganizationUrl })
    } else if (organizationProfileUrl) {
      window.location.href = organizationProfileUrl
    }
  }, [organizationProfileMode, openOrganizationProfile, afterLeaveOrganizationUrl, organizationProfileUrl])

  if (!isSignedIn || !user) {
    return null
  }

  const displayName = organization?.name ?? 'Personal workspace'
  const initials = organization ? getOrgInitials(organization.name) : getUserInitials(user.first_name, user.last_name)

  return (
    <div className="cl-organization-switcher" ref={dropdownRef} data-clerk-component="organization-switcher">
      <button
        type="button"
        className="cl-organization-switcher-trigger"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="cl-organization-switcher-avatar">
          {organization?.has_image && organization.image_url ? (
            <img
              src={organization.image_url}
              alt={organization.name}
              className="cl-organization-switcher-avatar-image"
            />
          ) : (
            <span className="cl-organization-switcher-avatar-initials">{initials}</span>
          )}
        </span>
        <span className="cl-organization-switcher-name">{displayName}</span>
        <ChevronDownIcon />
      </button>

      {isOpen && (
        <div className="cl-organization-switcher-popover" role="menu">
          <div className="cl-organization-switcher-popover-card">
            {!hidePersonal && (
              <button
                type="button"
                className={`cl-organization-switcher-popover-item ${!organization ? 'cl-active' : ''}`}
                onClick={handleSelectPersonal}
                role="menuitem"
              >
                <span className="cl-organization-switcher-popover-avatar">
                  {user.has_image && user.image_url ? (
                    <img
                      src={user.image_url}
                      alt="Personal"
                      className="cl-organization-switcher-popover-avatar-image"
                    />
                  ) : (
                    <span className="cl-organization-switcher-popover-avatar-initials">
                      {getUserInitials(user.first_name, user.last_name)}
                    </span>
                  )}
                </span>
                <span className="cl-organization-switcher-popover-name">Personal workspace</span>
                {!organization && <CheckIcon />}
              </button>
            )}

            <div className="cl-organization-switcher-popover-divider" />

            {organization && (
              <>
                <button
                  type="button"
                  className="cl-organization-switcher-popover-action"
                  onClick={handleManageOrganization}
                  role="menuitem"
                >
                  <SettingsIcon />
                  Manage organization
                </button>
                <div className="cl-organization-switcher-popover-divider" />
              </>
            )}

            <button
              type="button"
              className="cl-organization-switcher-popover-action"
              onClick={handleCreateOrganization}
              role="menuitem"
            >
              <PlusIcon />
              Create organization
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// ORGANIZATION PROFILE
// ============================================================================

/**
 * OrganizationProfile component props
 */
export interface OrganizationProfileProps {
  /** Appearance customization */
  appearance?: {
    baseTheme?: unknown
    layout?: Record<string, unknown>
    variables?: Record<string, string>
    elements?: Record<string, unknown>
  }
  /** URL to redirect after leaving organization */
  afterLeaveOrganizationUrl?: string
  /** Routing mode */
  routing?: 'path' | 'hash' | 'virtual'
  /** Path for path-based routing */
  path?: string
}

/**
 * Full organization profile management component.
 *
 * @example
 * ```tsx
 * <OrganizationProfile />
 * ```
 */
export function OrganizationProfile({
  appearance,
  afterLeaveOrganizationUrl,
  routing = 'path',
  path,
}: OrganizationProfileProps): JSX.Element | null {
  const { organization, isSignedIn, isLoaded } = useClerkContext()
  const [activeTab, setActiveTab] = useState<'general' | 'members'>('general')

  if (!isLoaded) {
    return (
      <div className="cl-organization-profile" data-clerk-component="organization-profile">
        <div className="cl-loading">Loading...</div>
      </div>
    )
  }

  if (!isSignedIn || !organization) {
    return null
  }

  const initials = getOrgInitials(organization.name)

  return (
    <div className="cl-organization-profile" data-clerk-component="organization-profile">
      <div className="cl-organization-profile-header">
        <span className="cl-organization-profile-avatar">
          {organization.has_image && organization.image_url ? (
            <img
              src={organization.image_url}
              alt={organization.name}
              className="cl-organization-profile-avatar-image"
            />
          ) : (
            <span className="cl-organization-profile-avatar-initials">{initials}</span>
          )}
        </span>
        <div className="cl-organization-profile-info">
          <h2 className="cl-organization-profile-name">{organization.name}</h2>
          <p className="cl-organization-profile-slug">{organization.slug}</p>
        </div>
      </div>

      <nav className="cl-organization-profile-nav">
        <button
          type="button"
          className={`cl-organization-profile-nav-item ${activeTab === 'general' ? 'cl-active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
        <button
          type="button"
          className={`cl-organization-profile-nav-item ${activeTab === 'members' ? 'cl-active' : ''}`}
          onClick={() => setActiveTab('members')}
        >
          Members
        </button>
      </nav>

      <div className="cl-organization-profile-content">
        {activeTab === 'general' && (
          <div className="cl-organization-profile-section">
            <h3 className="cl-organization-profile-section-title">Organization details</h3>

            <div className="cl-organization-profile-field">
              <span className="cl-organization-profile-field-label">Name</span>
              <span className="cl-organization-profile-field-value">{organization.name}</span>
            </div>

            <div className="cl-organization-profile-field">
              <span className="cl-organization-profile-field-label">Slug</span>
              <span className="cl-organization-profile-field-value">{organization.slug}</span>
            </div>

            <div className="cl-organization-profile-field">
              <span className="cl-organization-profile-field-label">Members</span>
              <span className="cl-organization-profile-field-value">{organization.members_count}</span>
            </div>

            <div className="cl-organization-profile-field">
              <span className="cl-organization-profile-field-label">Pending invitations</span>
              <span className="cl-organization-profile-field-value">{organization.pending_invitations_count}</span>
            </div>
          </div>
        )}

        {activeTab === 'members' && (
          <div className="cl-organization-profile-section">
            <h3 className="cl-organization-profile-section-title">Members</h3>
            <p className="cl-organization-profile-empty">
              Member management is not yet implemented.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// ORGANIZATION LIST
// ============================================================================

/**
 * OrganizationList component props
 */
export interface OrganizationListProps {
  /** Appearance customization */
  appearance?: {
    baseTheme?: unknown
    layout?: Record<string, unknown>
    variables?: Record<string, string>
    elements?: Record<string, unknown>
  }
  /** URL to redirect after selecting organization */
  afterSelectOrganizationUrl?: string
  /** URL to redirect after selecting personal */
  afterSelectPersonalUrl?: string
  /** URL to redirect after creating organization */
  afterCreateOrganizationUrl?: string
  /** Hide the personal workspace option */
  hidePersonal?: boolean
  /** Skip invitation screen when creating */
  skipInvitationScreen?: boolean
}

/**
 * List of user's organizations with selection.
 *
 * @example
 * ```tsx
 * <OrganizationList
 *   afterSelectOrganizationUrl="/dashboard"
 * />
 * ```
 */
export function OrganizationList({
  appearance,
  afterSelectOrganizationUrl,
  afterSelectPersonalUrl,
  afterCreateOrganizationUrl,
  hidePersonal = false,
  skipInvitationScreen = false,
}: OrganizationListProps): JSX.Element | null {
  const { user, organization, isSignedIn, isLoaded, setActive, openCreateOrganization } = useClerkContext()

  const handleSelectPersonal = useCallback(async (e: MouseEvent) => {
    e.preventDefault()
    await setActive({ organization: null })
    if (afterSelectPersonalUrl) {
      window.location.href = afterSelectPersonalUrl
    }
  }, [setActive, afterSelectPersonalUrl])

  const handleCreateOrganization = useCallback((e: MouseEvent) => {
    e.preventDefault()
    openCreateOrganization({
      afterCreateOrganizationUrl,
      skipInvitationScreen,
    })
  }, [openCreateOrganization, afterCreateOrganizationUrl, skipInvitationScreen])

  if (!isLoaded) {
    return (
      <div className="cl-organization-list" data-clerk-component="organization-list">
        <div className="cl-loading">Loading...</div>
      </div>
    )
  }

  if (!isSignedIn || !user) {
    return null
  }

  return (
    <div className="cl-organization-list" data-clerk-component="organization-list">
      <h2 className="cl-organization-list-title">Select an organization</h2>

      <div className="cl-organization-list-items">
        {!hidePersonal && (
          <button
            type="button"
            className={`cl-organization-list-item ${!organization ? 'cl-active' : ''}`}
            onClick={handleSelectPersonal}
          >
            <span className="cl-organization-list-item-avatar">
              {user.has_image && user.image_url ? (
                <img
                  src={user.image_url}
                  alt="Personal"
                  className="cl-organization-list-item-avatar-image"
                />
              ) : (
                <span className="cl-organization-list-item-avatar-initials">
                  {getUserInitials(user.first_name, user.last_name)}
                </span>
              )}
            </span>
            <span className="cl-organization-list-item-name">Personal workspace</span>
            {!organization && <CheckIcon />}
          </button>
        )}

        <p className="cl-organization-list-empty">
          You don't have any organizations yet.
        </p>
      </div>

      <div className="cl-organization-list-footer">
        <button
          type="button"
          className="cl-organization-list-create"
          onClick={handleCreateOrganization}
        >
          <PlusIcon />
          Create organization
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// CREATE ORGANIZATION
// ============================================================================

/**
 * CreateOrganization component props
 */
export interface CreateOrganizationProps {
  /** Appearance customization */
  appearance?: {
    baseTheme?: unknown
    layout?: Record<string, unknown>
    variables?: Record<string, string>
    elements?: Record<string, unknown>
  }
  /** URL to redirect after creation */
  afterCreateOrganizationUrl?: string
  /** Skip the invitation screen */
  skipInvitationScreen?: boolean
  /** Routing mode */
  routing?: 'path' | 'hash' | 'virtual'
  /** Path for path-based routing */
  path?: string
}

/**
 * Form to create a new organization.
 *
 * @example
 * ```tsx
 * <CreateOrganization
 *   afterCreateOrganizationUrl="/org/settings"
 * />
 * ```
 */
export function CreateOrganization({
  appearance,
  afterCreateOrganizationUrl,
  skipInvitationScreen = false,
  routing = 'path',
  path,
}: CreateOrganizationProps): JSX.Element | null {
  const { isSignedIn, isLoaded, setActive } = useClerkContext()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Auto-generate slug from name
  useEffect(() => {
    const generatedSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    setSlug(generatedSlug)
  }, [name])

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      // In a real implementation, this would call the Clerk API
      setError('Organization creation is not yet implemented')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }, [name, slug])

  if (!isLoaded) {
    return (
      <div className="cl-create-organization" data-clerk-component="create-organization">
        <div className="cl-loading">Loading...</div>
      </div>
    )
  }

  if (!isSignedIn) {
    return null
  }

  return (
    <div className="cl-create-organization" data-clerk-component="create-organization">
      <div className="cl-card">
        <div className="cl-header">
          <h1 className="cl-header-title">Create organization</h1>
          <p className="cl-header-subtitle">Create a new organization to collaborate with your team</p>
        </div>

        <form onSubmit={handleSubmit} className="cl-form">
          <div className="cl-form-field">
            <label className="cl-form-field-label" htmlFor="org-name">
              Organization name
            </label>
            <input
              id="org-name"
              type="text"
              className="cl-form-field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter organization name"
              disabled={isLoading}
              required
              autoFocus
            />
          </div>

          <div className="cl-form-field">
            <label className="cl-form-field-label" htmlFor="org-slug">
              Organization slug
            </label>
            <input
              id="org-slug"
              type="text"
              className="cl-form-field-input"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="organization-slug"
              disabled={isLoading}
            />
            <p className="cl-form-field-hint">
              Used in URLs: example.com/org/{slug || 'your-org'}
            </p>
          </div>

          {error && (
            <div className="cl-form-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="cl-form-button-primary"
            disabled={isLoading || !name}
          >
            {isLoading ? 'Creating...' : 'Create organization'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get initials from organization name
 */
function getOrgInitials(name: string): string {
  const words = name.split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

/**
 * Get initials from user name
 */
function getUserInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.[0]?.toUpperCase() ?? ''
  const last = lastName?.[0]?.toUpperCase() ?? ''
  return first + last || 'U'
}

// ============================================================================
// ICONS
// ============================================================================

function ChevronDownIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="16"
      height="16"
      className="cl-icon"
    >
      <path d="M7 10l5 5 5-5z" />
    </svg>
  )
}

function CheckIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="16"
      height="16"
      className="cl-icon cl-check"
    >
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  )
}

function PlusIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="16"
      height="16"
      className="cl-icon"
    >
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  )
}

function SettingsIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="16"
      height="16"
      className="cl-icon"
    >
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  )
}
