import { sqliteTable, text, integer, blob, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// SEARCH - Full-Text + Vector Index (URL-based)
// ============================================================================

export const search = sqliteTable(
  'search',
  {
    // URL of the indexed Thing
    $id: text('$id').primaryKey(), // 'startups.studio/Startup/acme'
    $type: text('$type').notNull(), // 'Startup' (denormalized for filtering)

    // Searchable content
    content: text('content').notNull(),

    // Vector embedding (128-dim MRL for local, 768-dim streamed to Vectorize)
    embedding: blob('embedding', { mode: 'buffer' }),
    embeddingDim: integer('embedding_dim'), // 128, 256, 512, or 768

    // Pre-computed for R2 SQL (see search/README.md)
    cluster: integer('cluster'),
    lsh1: text('lsh1'),
    lsh2: text('lsh2'),
    lsh3: text('lsh3'),
    semanticL1: text('semantic_l1'),
    semanticL2: text('semantic_l2'),
    semanticL3: text('semantic_l3'),

    indexedAt: integer('indexed_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    typeIdx: index('search_type_idx').on(table.$type),
    clusterIdx: index('search_cluster_idx').on(table.cluster),
    semanticIdx: index('search_semantic_idx').on(table.semanticL1, table.semanticL2),
  }),
)
