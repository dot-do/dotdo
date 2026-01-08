// Core schema exports
export * from './nouns'
export * from './verbs'
export * from './things'
export * from './relationships'
export * from './objects'
export * from './actions'
export * from './events'
export * from './search'
export * from './branches'
export * from './auth'

// Re-export all tables as schema object for Drizzle
import { nouns } from './nouns'
import { verbs } from './verbs'
import { things } from './things'
import { relationships } from './relationships'
import { objects } from './objects'
import { actions } from './actions'
import { events } from './events'
import { search } from './search'
import { branches } from './branches'
import { users, sessions, accounts, verifications } from './auth'

export const schema = {
  // Core DO tables
  nouns,
  verbs,
  things,
  relationships,
  objects,
  actions,
  events,
  search,
  branches,
  // Auth tables (better-auth)
  users,
  sessions,
  accounts,
  verifications,
}
