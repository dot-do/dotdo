/**
 * Runtime Validation Module
 *
 * Provides consistent runtime validation using Zod at API boundaries.
 * Includes validation middleware, schema registry, and error transformation.
 *
 * @module lib/validation
 */

export * from './middleware'
export * from './schema-registry'
export * from './error-transform'
export * from './env-validation'
export * from './validated-handler'
export * from './input-validators'
export * from './store-schemas'

// Re-export Zod for convenience
export { z, ZodError, ZodSchema, ZodType } from 'zod'
export type { ZodIssue, ZodFormattedError } from 'zod'
