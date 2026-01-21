/**
 * User Durable Object
 *
 * Demonstrates:
 * - Password hashing with Web Crypto API
 * - SQLite storage for user data
 * - Authentication state management
 * - Secure credential handling
 */

import { Hono } from 'hono'

// ============================================================================
// Types
// ============================================================================

export interface User {
  id: string
  email: string
  name: string
  createdAt: number
  updatedAt: number
}

interface UserRow {
  id: string
  email: string
  name: string
  password_hash: string
  created_at: number
  updated_at: number
  [key: string]: string | number | null | ArrayBuffer  // Index signature for SqlStorageValue compatibility
}

// ============================================================================
// Password Utilities
// ============================================================================

async function hashPassword(password: string): Promise<string> {
  // Generate a random salt
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // Encode password
  const encoder = new TextEncoder()
  const passwordData = encoder.encode(password)

  // Combine salt and password
  const combined = new Uint8Array(salt.length + passwordData.length)
  combined.set(salt)
  combined.set(passwordData, salt.length)

  // Hash with SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined)

  // Combine salt and hash for storage
  const hashArray = new Uint8Array(hashBuffer)
  const result = new Uint8Array(salt.length + hashArray.length)
  result.set(salt)
  result.set(hashArray, salt.length)

  // Encode as base64
  return btoa(String.fromCharCode(...result))
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Decode stored hash
  const decoded = new Uint8Array(
    atob(storedHash)
      .split('')
      .map((c) => c.charCodeAt(0))
  )

  // Extract salt (first 16 bytes)
  const salt = decoded.slice(0, 16)
  const originalHash = decoded.slice(16)

  // Hash the provided password with the same salt
  const encoder = new TextEncoder()
  const passwordData = encoder.encode(password)

  const combined = new Uint8Array(salt.length + passwordData.length)
  combined.set(salt)
  combined.set(passwordData, salt.length)

  const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
  const hashArray = new Uint8Array(hashBuffer)

  // Compare hashes (constant-time comparison)
  if (hashArray.length !== originalHash.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < hashArray.length; i++) {
    const hashByte = hashArray[i]
    const originalByte = originalHash[i]
    if (hashByte === undefined || originalByte === undefined) {
      return false
    }
    result |= hashByte ^ originalByte
  }

  return result === 0
}

// ============================================================================
// Durable Object
// ============================================================================

export class UserDO implements DurableObject {
  private state: DurableObjectState
  private app: Hono
  private sql: SqlStorage
  private initialized = false

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state
    this.sql = state.storage.sql
    this.app = new Hono()
    this.setupRoutes()
  }

  // Initialize the database schema
  private async initialize(): Promise<void> {
    if (this.initialized) return

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.initialized = true
  }

  // Generate a unique ID
  private generateId(): string {
    return `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  // Get the user (if exists)
  private getUser(): UserRow | null {
    const cursor = this.sql.exec<UserRow>(
      'SELECT id, email, name, password_hash, created_at, updated_at FROM users LIMIT 1'
    )
    const rows = [...cursor]
    return rows.length > 0 ? rows[0]! : null
  }

  // Convert row to public user (no password)
  private rowToUser(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  // Setup Hono routes
  private setupRoutes(): void {
    // Health check
    this.app.get('/', (c) =>
      c.json({
        status: 'ok',
        id: this.state.id.toString(),
        type: 'UserDO',
      })
    )

    // Register new user
    this.app.post('/register', async (c) => {
      await this.initialize()

      const body = await c.req.json<{
        email: string
        password: string
        name: string
      }>()

      // Check if user already exists
      const existing = this.getUser()
      if (existing) {
        return c.json({ error: 'User already exists' }, 409)
      }

      // Hash password
      const passwordHash = await hashPassword(body.password)

      // Create user
      const id = this.generateId()
      const now = Date.now()

      this.sql.exec(
        'INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        body.email,
        body.name,
        passwordHash,
        now,
        now
      )

      const user: User = {
        id,
        email: body.email,
        name: body.name,
        createdAt: now,
        updatedAt: now,
      }

      return c.json(user, 201)
    })

    // Login
    this.app.post('/login', async (c) => {
      await this.initialize()

      const body = await c.req.json<{ password: string }>()

      const user = this.getUser()
      if (!user) {
        return c.json({ error: 'Invalid email or password' }, 401)
      }

      // Verify password
      const valid = await verifyPassword(body.password, user.password_hash)
      if (!valid) {
        return c.json({ error: 'Invalid email or password' }, 401)
      }

      return c.json(this.rowToUser(user))
    })

    // Get profile
    this.app.get('/profile', async (c) => {
      await this.initialize()

      const user = this.getUser()
      if (!user) {
        return c.json({ error: 'User not found' }, 404)
      }

      return c.json(this.rowToUser(user))
    })

    // Update profile
    this.app.patch('/profile', async (c) => {
      await this.initialize()

      const body = await c.req.json<{ name?: string; password?: string }>()

      const user = this.getUser()
      if (!user) {
        return c.json({ error: 'User not found' }, 404)
      }

      const now = Date.now()
      const updates: string[] = ['updated_at = ?']
      const values: (string | number)[] = [now]

      if (body.name !== undefined) {
        if (!body.name.trim()) {
          return c.json({ error: 'Name cannot be empty' }, 400)
        }
        updates.push('name = ?')
        values.push(body.name.trim())
      }

      if (body.password !== undefined) {
        if (body.password.length < 8) {
          return c.json({ error: 'Password must be at least 8 characters' }, 400)
        }
        const passwordHash = await hashPassword(body.password)
        updates.push('password_hash = ?')
        values.push(passwordHash)
      }

      values.push(user.id)

      this.sql.exec(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...values)

      // Return updated user
      const updated = this.getUser()!
      return c.json(this.rowToUser(updated))
    })
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}
