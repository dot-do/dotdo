/**
 * RelationalStore - Typed relational storage with Drizzle ORM integration
 *
 * @see README.md for API documentation
 */

export { RelationalStore } from './store'
export { migrate, SchemaEvolution } from './migrate'
export type {
  CDCEvent,
  CDCEventType,
  CDCOp,
  CDCEventHandler,
  ForeignKeyReference,
  TableConstraints,
  Migration,
  MigrationHistoryEntry,
  MigrationDB,
  EvolutionMode,
  SchemaChange,
  CompatibilityResult,
  AnyTable,
  SchemaMap,
  InferSelect,
  InferInsert,
} from './types'
