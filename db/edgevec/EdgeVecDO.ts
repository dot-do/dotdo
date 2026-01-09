/**
 * EdgeVecDO - Durable Object for HNSW vector index persistence
 *
 * STUB FILE - To be implemented in GREEN phase
 *
 * This is a minimal stub to allow tests to compile and fail meaningfully.
 * All methods throw "Not implemented" errors.
 */

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export interface EdgeVecConfig {
  dimension: number
  metric: 'cosine' | 'euclidean' | 'dot'
  efConstruction: number
  M: number
  maxElements: number
  autoBackup?: boolean
  backupInterval?: number
}

export interface VectorRecord {
  id: string
  vector: number[]
  metadata?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

export interface IndexStats {
  vectorCount: number
  dimension: number
  indexSize: number
  lastUpdated: number
}

export interface BackupManifest {
  timestamp: number
  vectorCount: number
  indexVersion: number
  files: {
    index: string
    vectors: string
  }
}

export interface StorageUsage {
  vectorCount: number
  indexSizeBytes: number
  vectorSizeBytes: number
  totalSizeBytes: number
  percentUsed: number
}

export interface VectorListResult {
  vectors: VectorRecord[]
  cursor?: string
  hasMore: boolean
}

export interface SearchResult {
  id: string
  score: number
  vector: number[]
  metadata?: Record<string, unknown>
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class EdgeVecStorageError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'EdgeVecStorageError'
  }
}

export class EdgeVecIndexError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'EdgeVecIndexError'
  }
}

export class EdgeVecBackupError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'EdgeVecBackupError'
  }
}

// ============================================================================
// EDGEVEC DURABLE OBJECT (STUB)
// ============================================================================

export class EdgeVecDO {
  constructor(
    private ctx: DurableObjectState,
    private env: unknown
  ) {}

  async fetch(request: Request): Promise<Response> {
    throw new Error('Not implemented')
  }

  async alarm(): Promise<void> {
    throw new Error('Not implemented')
  }

  async initialize(config: EdgeVecConfig): Promise<void> {
    throw new Error('Not implemented')
  }

  async load(): Promise<void> {
    throw new Error('Not implemented')
  }

  async getStats(): Promise<IndexStats> {
    throw new Error('Not implemented')
  }

  async insert(vector: VectorRecord): Promise<void> {
    throw new Error('Not implemented')
  }

  async insertBatch(
    vectors: VectorRecord[],
    options?: { chunkSize?: number }
  ): Promise<void> {
    throw new Error('Not implemented')
  }

  async getVector(id: string): Promise<VectorRecord | null> {
    throw new Error('Not implemented')
  }

  async delete(id: string): Promise<boolean> {
    throw new Error('Not implemented')
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    throw new Error('Not implemented')
  }

  async listVectors(options?: {
    limit?: number
    cursor?: string
    filter?: Record<string, unknown>
  }): Promise<VectorListResult> {
    throw new Error('Not implemented')
  }

  async search(
    query: number[],
    options: {
      k: number
      ef?: number
      filter?: Record<string, unknown>
    }
  ): Promise<SearchResult[]> {
    throw new Error('Not implemented')
  }

  async backup(options?: { incremental?: boolean }): Promise<void> {
    throw new Error('Not implemented')
  }

  async restore(options?: { timestamp?: number }): Promise<void> {
    throw new Error('Not implemented')
  }

  async cleanupBackups(options: { retentionDays: number }): Promise<void> {
    throw new Error('Not implemented')
  }

  async getStorageUsage(): Promise<StorageUsage> {
    throw new Error('Not implemented')
  }
}
