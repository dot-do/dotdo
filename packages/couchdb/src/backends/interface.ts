/**
 * Storage Backend Interface
 *
 * Defines the contract for CouchDB storage backends.
 * Implementations can use in-memory, SQLite, or other storage.
 */

import type { CouchDocument, DatabaseInfo } from '../types'

/**
 * Internal document storage format
 */
export interface StoredDocument {
  id: string
  rev: string
  deleted: boolean
  data: CouchDocument
  seq: number
}

/**
 * Stored revision for version history
 */
export interface StoredRevision {
  id: string
  rev: string
  data: CouchDocument
  seq: number
}

/**
 * Stored attachment
 */
export interface StoredAttachment {
  docId: string
  name: string
  contentType: string
  data: Buffer
  digest: string
  length: number
}

/**
 * Storage backend interface
 */
export interface Backend {
  /**
   * Create a new database
   */
  createDatabase(name: string): Promise<void>

  /**
   * Delete a database
   */
  deleteDatabase(name: string): Promise<void>

  /**
   * Check if database exists
   */
  hasDatabase(name: string): Promise<boolean>

  /**
   * Get database info
   */
  getDatabaseInfo(name: string): Promise<DatabaseInfo>

  /**
   * List all databases
   */
  listDatabases(): Promise<string[]>

  /**
   * Get document by ID
   */
  getDocument(db: string, id: string): Promise<StoredDocument | null>

  /**
   * Get specific revision of document
   */
  getDocumentRevision(db: string, id: string, rev: string): Promise<StoredDocument | null>

  /**
   * Put document (create or update)
   */
  putDocument(db: string, doc: CouchDocument, rev: string, seq: number): Promise<void>

  /**
   * Delete document
   */
  deleteDocument(db: string, id: string, rev: string, seq: number): Promise<void>

  /**
   * Get all documents (optionally filtered)
   */
  getAllDocuments(db: string): Promise<StoredDocument[]>

  /**
   * Get next sequence number for database
   */
  getNextSeq(db: string): Promise<number>

  /**
   * Get changes since sequence
   */
  getChanges(db: string, since: number, limit?: number): Promise<StoredDocument[]>

  /**
   * Get latest sequence number
   */
  getLatestSeq(db: string): Promise<number>

  /**
   * Put attachment
   */
  putAttachment(db: string, attachment: StoredAttachment): Promise<void>

  /**
   * Get attachment
   */
  getAttachment(db: string, docId: string, name: string): Promise<StoredAttachment | null>

  /**
   * Delete attachment
   */
  deleteAttachment(db: string, docId: string, name: string): Promise<void>

  /**
   * Get all attachments for a document
   */
  getAttachments(db: string, docId: string): Promise<StoredAttachment[]>

  /**
   * Compact database (remove old revisions)
   */
  compact(db: string): Promise<void>
}
