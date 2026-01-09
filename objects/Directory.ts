/**
 * Directory - Hierarchical entity organization
 *
 * Organizes entities in a tree structure with paths.
 * Examples: file systems, category trees, org charts
 */

import { Entity, EntityRecord } from './Entity'
import { Env } from './DO'

export interface DirectoryEntry {
  id: string
  name: string
  path: string
  type: 'file' | 'folder'
  parentId?: string
  data?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export class Directory extends Entity {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Create a directory entry
   */
  async createEntry(entry: Omit<DirectoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<DirectoryEntry> {
    const id = crypto.randomUUID()
    const now = new Date()

    const record: DirectoryEntry = {
      ...entry,
      id,
      createdAt: now,
      updatedAt: now,
    }

    await this.ctx.storage.put(`entry:${id}`, record)

    // Index by path for fast lookups
    await this.ctx.storage.put(`path:${entry.path}`, id)

    await this.emit('entry.created', { entry: record })
    return record
  }

  /**
   * Get entry by ID
   */
  async getEntry(id: string): Promise<DirectoryEntry | null> {
    return (await this.ctx.storage.get(`entry:${id}`)) as DirectoryEntry | null
  }

  /**
   * Get entry by path
   */
  async getByPath(path: string): Promise<DirectoryEntry | null> {
    const id = (await this.ctx.storage.get(`path:${path}`)) as string | undefined
    if (!id) return null
    return this.getEntry(id)
  }

  /**
   * List children of a path
   */
  async listChildren(parentPath: string): Promise<DirectoryEntry[]> {
    const map = await this.ctx.storage.list({ prefix: 'entry:' })
    const entries = Array.from(map.values()) as DirectoryEntry[]

    return entries.filter((e) => {
      if (parentPath === '/') {
        // Root level - no parent path component
        const parts = e.path.split('/').filter((p) => p)
        return parts.length === 1
      }
      // Check if parent path matches
      return (
        e.path.startsWith(parentPath + '/') &&
        e.path
          .slice(parentPath.length + 1)
          .split('/')
          .filter((p) => p).length === 1
      )
    })
  }

  /**
   * List all entries under a path (recursive)
   */
  async listRecursive(path: string): Promise<DirectoryEntry[]> {
    const map = await this.ctx.storage.list({ prefix: 'entry:' })
    const entries = Array.from(map.values()) as DirectoryEntry[]

    if (path === '/') {
      return entries
    }

    return entries.filter((e) => e.path.startsWith(path + '/') || e.path === path)
  }

  /**
   * Move entry to new path
   */
  async moveEntry(id: string, newPath: string): Promise<DirectoryEntry | null> {
    const entry = await this.getEntry(id)
    if (!entry) return null

    const oldPath = entry.path

    // Remove old path index
    await this.ctx.storage.delete(`path:${oldPath}`)

    // Update entry
    entry.path = newPath
    entry.updatedAt = new Date()

    await this.ctx.storage.put(`entry:${id}`, entry)
    await this.ctx.storage.put(`path:${newPath}`, id)

    // If folder, update children paths
    if (entry.type === 'folder') {
      const children = await this.listRecursive(oldPath)
      for (const child of children) {
        if (child.id === id) continue
        const newChildPath = child.path.replace(oldPath, newPath)
        await this.ctx.storage.delete(`path:${child.path}`)
        child.path = newChildPath
        child.updatedAt = new Date()
        await this.ctx.storage.put(`entry:${child.id}`, child)
        await this.ctx.storage.put(`path:${newChildPath}`, child.id)
      }
    }

    await this.emit('entry.moved', { id, oldPath, newPath })
    return entry
  }

  /**
   * Rename entry
   */
  async rename(id: string, newName: string): Promise<DirectoryEntry | null> {
    const entry = await this.getEntry(id)
    if (!entry) return null

    const pathParts = entry.path.split('/')
    pathParts[pathParts.length - 1] = newName
    const newPath = pathParts.join('/')

    entry.name = newName
    return this.moveEntry(id, newPath)
  }

  /**
   * Delete entry (and children if folder)
   */
  async deleteEntry(id: string): Promise<boolean> {
    const entry = await this.getEntry(id)
    if (!entry) return false

    // Delete children if folder
    if (entry.type === 'folder') {
      const children = await this.listRecursive(entry.path)
      for (const child of children) {
        await this.ctx.storage.delete(`entry:${child.id}`)
        await this.ctx.storage.delete(`path:${child.path}`)
      }
    }

    await this.ctx.storage.delete(`entry:${id}`)
    await this.ctx.storage.delete(`path:${entry.path}`)

    await this.emit('entry.deleted', { id, path: entry.path })
    return true
  }

  /**
   * Create folder
   */
  async createFolder(path: string, name: string): Promise<DirectoryEntry> {
    return this.createEntry({
      name,
      path: `${path}/${name}`.replace('//', '/'),
      type: 'folder',
    })
  }

  /**
   * Create file
   */
  async createFile(path: string, name: string, data?: Record<string, unknown>): Promise<DirectoryEntry> {
    return this.createEntry({
      name,
      path: `${path}/${name}`.replace('//', '/'),
      type: 'file',
      data,
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/entries') {
      const path = url.searchParams.get('path') || '/'
      const entries = await this.listChildren(path)
      return new Response(JSON.stringify(entries), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/entry' && request.method === 'POST') {
      const entry = (await request.json()) as Omit<DirectoryEntry, 'id' | 'createdAt' | 'updatedAt'>
      const created = await this.createEntry(entry)
      return new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/folder' && request.method === 'POST') {
      const { path, name } = (await request.json()) as { path: string; name: string }
      const folder = await this.createFolder(path, name)
      return new Response(JSON.stringify(folder), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/file' && request.method === 'POST') {
      const { path, name, data } = (await request.json()) as { path: string; name: string; data?: Record<string, unknown> }
      const file = await this.createFile(path, name, data)
      return new Response(JSON.stringify(file), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default Directory
