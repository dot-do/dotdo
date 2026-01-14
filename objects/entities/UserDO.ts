/**
 * @module UserDO
 * @description Durable Object for User entity storage and management
 *
 * UserDO provides the DO implementation for user entities as defined in
 * the schema.org.ai/User type. It manages user profiles, preferences,
 * sessions, and permissions.
 *
 * **Note:** This is different from the `User` class in `objects/identity/User.ts`.
 * - **User (Identity)**: Full identity implementation with auth and session management
 * - **UserDO (Entity)**: Lightweight storage for user entity definitions
 *
 * **Core Features:**
 * - User profile storage (name, email, avatar)
 * - Preferences management
 * - Session tracking
 * - Permission/role management
 * - User metadata and settings
 *
 * **User Properties (from schema.org.ai):**
 * | Property | Type | Description |
 * |----------|------|-------------|
 * | email | string | User's email address |
 * | name | string | Display name |
 * | profile | object | Profile metadata |
 * | preferences | object | User preferences |
 * | roles | string[] | Assigned roles |
 * | permissions | string[] | Granted permissions |
 *
 * @example Creating a UserDO
 * ```typescript
 * const stub = env.UserDO.get(env.UserDO.idFromName('user@example.com'))
 * await stub.createProfile({
 *   email: 'user@example.com',
 *   name: 'Alice Smith',
 *   profile: { avatar: 'https://...' }
 * })
 * ```
 *
 * @example Managing Preferences
 * ```typescript
 * await stub.setPreferences({
 *   theme: 'dark',
 *   notifications: true,
 *   language: 'en'
 * })
 * ```
 *
 * @see User - Full identity implementation in objects/identity/User.ts
 * @see Identity - Base identity class
 */

import { DO, type Env } from '../core/DO'
import { User as UserNoun } from '../../nouns/identity/User'
import type { AnyNoun } from '../../nouns/types'

/**
 * User profile data
 */
export interface UserProfile {
  /** User's email address */
  email: string
  /** Display name */
  name: string
  /** Avatar URL */
  avatar?: string
  /** Bio/description */
  bio?: string
  /** Additional profile metadata */
  metadata?: Record<string, unknown>
  /** Whether email is verified */
  emailVerified?: boolean
  /** ISO 8601 timestamp when created */
  createdAt?: string
  /** ISO 8601 timestamp when last updated */
  updatedAt?: string
}

/**
 * User preferences
 */
export interface UserPreferences {
  /** UI theme */
  theme?: 'light' | 'dark' | 'system'
  /** Language/locale */
  language?: string
  /** Timezone */
  timezone?: string
  /** Notification settings */
  notifications?: {
    email?: boolean
    push?: boolean
    sms?: boolean
  }
  /** Additional preferences */
  [key: string]: unknown
}

/**
 * User session info (lightweight tracking)
 */
export interface UserSessionInfo {
  /** Session ID */
  id: string
  /** Device/client info */
  device?: string
  /** IP address */
  ip?: string
  /** Last active timestamp */
  lastActiveAt: string
  /** Session creation timestamp */
  createdAt: string
}

/**
 * UserDO - Durable Object for User entity storage
 *
 * Provides profile, preferences, and session storage for user entities.
 * This is a lightweight entity DO, not the full User identity implementation.
 */
export class UserDO extends DO {
  /** Type identifier from schema.org.ai */
  static readonly $type: string = UserNoun.$type
  /** Noun definition for User */
  static readonly noun: AnyNoun = UserNoun

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get the user profile
   */
  async getProfile(): Promise<UserProfile | null> {
    const profile = await this.ctx.storage.get<UserProfile>('profile')
    return profile ?? null
  }

  /**
   * Create or update the user profile
   */
  async createProfile(profile: UserProfile): Promise<UserProfile> {
    const now = new Date().toISOString()
    const existing = await this.getProfile()

    const fullProfile: UserProfile = {
      ...profile,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    await this.ctx.storage.put('profile', fullProfile)
    await this.emit('user.profile.created', { profile: fullProfile })
    return fullProfile
  }

  /**
   * Update profile fields
   */
  async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile | null> {
    const current = await this.getProfile()
    if (!current) return null

    const updated: UserProfile = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    await this.ctx.storage.put('profile', updated)
    await this.emit('user.profile.updated', { profile: updated, changes: updates })
    return updated
  }

  /**
   * Get user preferences
   */
  async getPreferences(): Promise<UserPreferences> {
    const prefs = await this.ctx.storage.get<UserPreferences>('preferences')
    return prefs ?? {}
  }

  /**
   * Set user preferences (merge with existing)
   */
  async setPreferences(preferences: UserPreferences): Promise<UserPreferences> {
    const current = await this.getPreferences()
    const updated = { ...current, ...preferences }
    await this.ctx.storage.put('preferences', updated)
    await this.emit('user.preferences.updated', { preferences: updated })
    return updated
  }

  /**
   * Get a specific preference value
   */
  async getPreference<T>(key: string): Promise<T | undefined> {
    const prefs = await this.getPreferences()
    return prefs[key] as T | undefined
  }

  /**
   * Set a specific preference value
   */
  async setPreference(key: string, value: unknown): Promise<void> {
    const prefs = await this.getPreferences()
    prefs[key] = value
    await this.ctx.storage.put('preferences', prefs)
    await this.emit('user.preference.set', { key, value })
  }

  /**
   * Get user roles
   */
  async getRoles(): Promise<string[]> {
    const roles = await this.ctx.storage.get<string[]>('roles')
    return roles ?? []
  }

  /**
   * Set user roles
   */
  async setRoles(roles: string[]): Promise<void> {
    await this.ctx.storage.put('roles', roles)
    await this.emit('user.roles.updated', { roles })
  }

  /**
   * Add a role
   */
  async addRole(role: string): Promise<void> {
    const roles = await this.getRoles()
    if (!roles.includes(role)) {
      roles.push(role)
      await this.ctx.storage.put('roles', roles)
      await this.emit('user.role.added', { role })
    }
  }

  /**
   * Remove a role
   */
  async removeRole(role: string): Promise<boolean> {
    const roles = await this.getRoles()
    const index = roles.indexOf(role)
    if (index === -1) return false

    roles.splice(index, 1)
    await this.ctx.storage.put('roles', roles)
    await this.emit('user.role.removed', { role })
    return true
  }

  /**
   * Check if user has a role
   */
  async hasRole(role: string): Promise<boolean> {
    const roles = await this.getRoles()
    return roles.includes(role)
  }

  /**
   * Get user permissions
   */
  async getPermissions(): Promise<string[]> {
    const permissions = await this.ctx.storage.get<string[]>('permissions')
    return permissions ?? []
  }

  /**
   * Set user permissions
   */
  async setPermissions(permissions: string[]): Promise<void> {
    await this.ctx.storage.put('permissions', permissions)
    await this.emit('user.permissions.updated', { permissions })
  }

  /**
   * Grant a permission
   */
  async grantPermission(permission: string): Promise<void> {
    const permissions = await this.getPermissions()
    if (!permissions.includes(permission)) {
      permissions.push(permission)
      await this.ctx.storage.put('permissions', permissions)
      await this.emit('user.permission.granted', { permission })
    }
  }

  /**
   * Revoke a permission
   */
  async revokePermission(permission: string): Promise<boolean> {
    const permissions = await this.getPermissions()
    const index = permissions.indexOf(permission)
    if (index === -1) return false

    permissions.splice(index, 1)
    await this.ctx.storage.put('permissions', permissions)
    await this.emit('user.permission.revoked', { permission })
    return true
  }

  /**
   * Check if user has a permission
   */
  async hasPermission(permission: string): Promise<boolean> {
    const permissions = await this.getPermissions()
    return permissions.includes(permission)
  }

  /**
   * Get active sessions
   */
  async getSessions(): Promise<UserSessionInfo[]> {
    const sessions = await this.ctx.storage.get<UserSessionInfo[]>('sessions')
    return sessions ?? []
  }

  /**
   * Add a session
   */
  async addSession(session: Omit<UserSessionInfo, 'createdAt'>): Promise<UserSessionInfo> {
    const sessions = await this.getSessions()
    const newSession: UserSessionInfo = {
      ...session,
      createdAt: new Date().toISOString(),
    }
    sessions.push(newSession)
    await this.ctx.storage.put('sessions', sessions)
    await this.emit('user.session.created', { session: newSession })
    return newSession
  }

  /**
   * Update session last active time
   */
  async touchSession(sessionId: string): Promise<boolean> {
    const sessions = await this.getSessions()
    const session = sessions.find(s => s.id === sessionId)
    if (!session) return false

    session.lastActiveAt = new Date().toISOString()
    await this.ctx.storage.put('sessions', sessions)
    return true
  }

  /**
   * Remove a session
   */
  async removeSession(sessionId: string): Promise<boolean> {
    const sessions = await this.getSessions()
    const filteredSessions = sessions.filter(s => s.id !== sessionId)
    if (filteredSessions.length === sessions.length) return false

    await this.ctx.storage.put('sessions', filteredSessions)
    await this.emit('user.session.removed', { sessionId })
    return true
  }

  /**
   * Remove all sessions (logout everywhere)
   */
  async clearSessions(): Promise<void> {
    await this.ctx.storage.put('sessions', [])
    await this.emit('user.sessions.cleared', {})
  }
}

export default UserDO
