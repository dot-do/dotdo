// Core schema exports
export * from './nouns'
export * from './verbs'
export * from './things'
export * from './relationships'
export * from './objects'
export * from './actions'
export * from './events'
export * from './search'

// Re-export all tables as schema object for Drizzle
import { nouns } from './nouns'
import { verbs } from './verbs'
import { things } from './things'
import { relationships } from './relationships'
import { objects } from './objects'
import { actions } from './actions'
import { events } from './events'
import { search } from './search'

export const schema = {
  nouns,
  verbs,
  things,
  relationships,
  objects,
  actions,
  events,
  search,
}
