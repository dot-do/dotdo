// @dotdo/db - Abstract Storage Layer
// Uses digital-objects from primitives
// Base for database.do managed service

export * from './types'
export * from './branded-types'
export * from './storage'
export * from './adapters'
export * from './id'
export * from './things'
export * from './relationships'
export * from './events'
export * from './query'
export * from './digital-objects'
export * from './sqlite'
export * from './migrations'
export * from './audit'
export * from './schema'
export * from './tiered-storage'
export * from './analytics'

// IceType schema DSL (adapted from db4)
export * from './icetype'

// Magic-Map pattern for N+1 query elimination (adapted from db4)
export * from './magic-map'

// Checkpoint system for single-blob storage (do-etru.2)
// Provides up to 95% cost reduction via compressed blob checkpointing
export * from './checkpoint'

// Actions and Verbs - linguistic model (do-etru.2)
// Actions as source of truth for metadata (createdBy, updatedAt, etc.)
export * from './actions'
