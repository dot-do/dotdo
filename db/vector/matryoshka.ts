/**
 * Matryoshka Embedding Handler
 *
 * Re-exports from core implementation with VectorStore-specific additions.
 *
 * @module db/vector/matryoshka
 */

export {
  MatryoshkaHandler,
  truncateEmbedding,
  batchTruncate,
  isValidMatryoshkaDimension,
  computeStorageSavings,
  truncateAndQuantize,
} from '../core/vector/matryoshka'

export type {
  StorageSavings,
  TruncateOptions,
  BatchTruncateOptions,
  MatryoshkaHandlerOptions,
} from '../core/vector/matryoshka'
