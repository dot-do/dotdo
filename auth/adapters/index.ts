/**
 * Auth Adapters - Database adapters for better-auth
 *
 * This module provides database adapters that allow better-auth to store
 * auth entities in different storage backends.
 *
 * Available adapters:
 * - GraphAuthAdapter: Uses the DO Graph model to store auth entities as Things
 */

export {
  createGraphAuthAdapter,
  graphAuthAdapter,
  type GraphAuthAdapter,
  type User,
  type Session,
  type Account,
} from './graph'
