/**
 * DocumentStore
 *
 * Schema-free JSON document storage with JSONPath queries.
 */

export { DocumentStore } from './store'
export * from './types'
export { buildWhereClause, buildOrderByClause, toJsonPath } from './queries'
