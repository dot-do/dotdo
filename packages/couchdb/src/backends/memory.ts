/**
 * In-Memory Storage Backend
 *
 * Simple Map-based storage for testing and development.
 */

import type { CouchDocument, DatabaseInfo } from '../types'
import type { Backend, StoredDocument, StoredAttachment, StoredRevision } from './interface'

/**
 * Database storage structure
 */
interface DatabaseStorage {
  name: string
  documents: Map<string, StoredDocument>
  revisions: Map<string, StoredRevision[]>
  attachments: Map<string, StoredAttachment>
  seq: number
}

/**
 * In-memory backend implementation
 */
export class MemoryBackend implements Backend {
  private databases: Map<string, DatabaseStorage> = new Map()

  async createDatabase(name: string): Promise<void> {
    if (this.databases.has(name)) {
      throw new Error(`Database '${name}' already exists`)
    }
    this.databases.set(name, {
      name,
      documents: new Map(),
      revisions: new Map(),
      attachments: new Map(),
      seq: 0,
    })
  }

  async deleteDatabase(name: string): Promise<void> {
    if (!this.databases.has(name)) {
      throw new Error(`Database '${name}' not found`)
    }
    this.databases.delete(name)
  }

  async hasDatabase(name: string): Promise<boolean> {
    return this.databases.has(name)
  }

  async getDatabaseInfo(name: string): Promise<DatabaseInfo> {
    const db = this.databases.get(name)
    if (!db) {
      throw new Error(`Database '${name}' not found`)
    }

    // Count non-deleted documents
    let docCount = 0
    for (const doc of db.documents.values()) {
      if (!doc.deleted) {
        docCount++
      }
    }

    return {
      db_name: name,
      doc_count: docCount,
      update_seq: db.seq,
    }
  }

  async listDatabases(): Promise<string[]> {
    return Array.from(this.databases.keys())
  }

  async getDocument(dbName: string, id: string): Promise<StoredDocument | null> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }
    return db.documents.get(id) || null
  }

  async getDocumentRevision(dbName: string, id: string, rev: string): Promise<StoredDocument | null> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }

    // Check current document first
    const current = db.documents.get(id)
    if (current && current.rev === rev) {
      return current
    }

    // Check revision history
    const revisions = db.revisions.get(id) || []
    const found = revisions.find((r) => r.rev === rev)
    if (found) {
      return {
        id: found.id,
        rev: found.rev,
        deleted: false,
        data: found.data,
        seq: found.seq,
      }
    }

    return null
  }

  async putDocument(dbName: string, doc: CouchDocument, rev: string, seq: number): Promise<void> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }

    const id = doc._id

    // Save old revision if updating
    const existing = db.documents.get(id)
    if (existing && !existing.deleted) {
      const revisions = db.revisions.get(id) || []
      revisions.push({
        id: existing.id,
        rev: existing.rev,
        data: existing.data,
        seq: existing.seq,
      })
      db.revisions.set(id, revisions)
    }

    // Save new document
    db.documents.set(id, {
      id,
      rev,
      deleted: false,
      data: { ...doc, _rev: rev },
      seq,
    })

    db.seq = Math.max(db.seq, seq)
  }

  async deleteDocument(dbName: string, id: string, rev: string, seq: number): Promise<void> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }

    const existing = db.documents.get(id)
    if (!existing) {
      throw new Error(`Document '${id}' not found`)
    }

    // Save old revision
    const revisions = db.revisions.get(id) || []
    revisions.push({
      id: existing.id,
      rev: existing.rev,
      data: existing.data,
      seq: existing.seq,
    })
    db.revisions.set(id, revisions)

    // Mark as deleted
    db.documents.set(id, {
      id,
      rev,
      deleted: true,
      data: { _id: id, _rev: rev, _deleted: true },
      seq,
    })

    db.seq = Math.max(db.seq, seq)
  }

  async getAllDocuments(dbName: string): Promise<StoredDocument[]> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }

    return Array.from(db.documents.values())
  }

  async getNextSeq(dbName: string): Promise<number> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }
    return db.seq + 1
  }

  async getChanges(dbName: string, since: number, limit?: number): Promise<StoredDocument[]> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }

    const changes = Array.from(db.documents.values())
      .filter((doc) => doc.seq > since)
      .sort((a, b) => a.seq - b.seq)

    if (limit !== undefined) {
      return changes.slice(0, limit)
    }
    return changes
  }

  async getLatestSeq(dbName: string): Promise<number> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }
    return db.seq
  }

  async putAttachment(dbName: string, attachment: StoredAttachment): Promise<void> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }

    const key = `${attachment.docId}/${attachment.name}`
    db.attachments.set(key, attachment)
  }

  async getAttachment(dbName: string, docId: string, name: string): Promise<StoredAttachment | null> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }

    const key = `${docId}/${name}`
    return db.attachments.get(key) || null
  }

  async deleteAttachment(dbName: string, docId: string, name: string): Promise<void> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }

    const key = `${docId}/${name}`
    db.attachments.delete(key)
  }

  async getAttachments(dbName: string, docId: string): Promise<StoredAttachment[]> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }

    const result: StoredAttachment[] = []
    for (const [key, attachment] of db.attachments) {
      if (key.startsWith(`${docId}/`)) {
        result.push(attachment)
      }
    }
    return result
  }

  async compact(dbName: string): Promise<void> {
    const db = this.databases.get(dbName)
    if (!db) {
      throw new Error(`Database '${dbName}' not found`)
    }

    // Clear all revision history
    db.revisions.clear()
  }
}
