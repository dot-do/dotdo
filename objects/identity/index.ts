/**
 * @module identity
 * @description Identity management Durable Objects
 *
 * This module exports identity-related Durable Objects for managing users,
 * sessions, and authentication in the dotdo framework. Types follow the
 * id.org.ai specification for interoperability.
 *
 * **Exported Classes:**
 * - {@link Identity} - Base identity DO with core fields
 * - {@link User} - Human user identity with email, name, profile
 * - {@link Session} - Authentication session management
 *
 * **DO Hierarchy:**
 * ```
 *                 ┌──────────────┐
 *                 │   Identity   │
 *                 │  (Base DO)   │
 *                 └──────┬───────┘
 *                        │
 *          ┌─────────────┴─────────────┐
 *          │                           │
 *    ┌─────┴─────┐               ┌─────┴─────┐
 *    │   User    │               │  Session  │
 *    │ (Human)   │               │  (Auth)   │
 *    └───────────┘               └───────────┘
 * ```
 *
 * @example Using Identity Classes
 * ```typescript
 * import { User, Session } from 'dotdo/objects/identity'
 *
 * // Create a user
 * const userStub = env.User.get(env.User.idFromName('user@example.com'))
 * const user = await userStub.createUser({
 *   email: 'user@example.com',
 *   name: 'Alice Smith'
 * })
 *
 * // Create a session for the user
 * const sessionStub = env.Session.get(env.Session.idFromName(sessionId))
 * const session = await sessionStub.createSession({
 *   identityId: user.$id
 * })
 *
 * // Validate the session
 * const isValid = await sessionStub.isValid()
 * ```
 *
 * @see https://schema.org.ai - Schema definitions
 */

// Base identity
export {
  Identity,
  type IdentityData,
  type CreateIdentityOptions,
  type UpdateIdentityOptions,
} from './Identity'

// User identity
export {
  User,
  type UserData,
  type CreateUserOptions,
  type UpdateUserOptions,
} from './User'

// Session management
export {
  Session,
  type SessionData,
  type CreateSessionOptions,
  type RefreshSessionOptions,
  type SessionValidation,
} from './Session'
