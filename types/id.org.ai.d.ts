/**
 * Type declarations for id.org.ai module
 *
 * Identity schema types from id.org.ai for user and agent identities.
 *
 * @module id.org.ai
 */

declare module 'id.org.ai' {
  /**
   * Base identity type
   */
  export interface Identity {
    /** Unique identifier URI (JSON-LD @id) */
    $id: string
    /** Type discriminator (JSON-LD @type) */
    $type: 'https://schema.org.ai/Identity'
    /** ISO 8601 timestamp when identity was created */
    createdAt: string
    /** ISO 8601 timestamp when identity was last updated */
    updatedAt: string
  }

  /**
   * User identity type
   */
  export interface User extends Identity {
    /** Type discriminator (JSON-LD @type) */
    $type: 'https://schema.org.ai/User'
    /** User's email address */
    email: string
    /** User's display name */
    name: string
    /** Optional profile metadata */
    profile?: Record<string, unknown>
    /** Whether email has been verified */
    emailVerified?: boolean
    /** ISO 8601 timestamp when email was verified */
    emailVerifiedAt?: string
  }

  /**
   * Session type for authentication
   */
  export interface Session {
    /** Unique identifier URI (JSON-LD @id) */
    $id: string
    /** Type discriminator (JSON-LD @type) */
    $type: 'https://schema.org.ai/Session'
    /** Reference to the authenticated identity */
    identityId: string
    /** Secure session token */
    token: string
    /** ISO 8601 timestamp when session expires */
    expiresAt: string
    /** Optional session metadata */
    metadata?: Record<string, unknown>
  }

  /**
   * Agent identity type for AI agents
   */
  export interface AgentIdentity extends Identity {
    /** Type discriminator (JSON-LD @type) */
    $type: 'https://schema.org.ai/Agent'
    /** Agent's display name */
    name: string
    /** Agent's capabilities */
    capabilities?: string[]
    /** Agent's model information */
    model?: string
  }
}
