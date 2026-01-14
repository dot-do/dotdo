// Identity domain Nouns
// These types are used for authentication and identity management

export { Identity } from './Identity'
export { User } from './User'
export { AgentIdentity } from './AgentIdentity'
export { Session } from './Session'
export { Credential } from './Credential'

// Re-export type guards and factory functions from id.org.ai
export {
  isIdentity,
  isUser,
  isAgentIdentity,
  isSession,
  isCredential,
  isSessionExpired,
  createIdentity,
  createUser,
  createAgentIdentity,
  createSession,
  createCredential,
} from '../../ai/primitives/packages/id.org.ai/src'

// Re-export TypeScript types
export type {
  Identity as IdentityType,
  User as UserType,
  AgentIdentity as AgentIdentityType,
  Session as SessionType,
  Credential as CredentialType,
  CredentialType as CredentialTypeEnum,
} from '../../ai/primitives/packages/id.org.ai/src'
