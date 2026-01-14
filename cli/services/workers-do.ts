/**
 * workers.do Client
 *
 * Client for interacting with workers.do registry.
 * Handles listing DOs, linking folders, and deployments.
 */

import { $Context } from '../../packages/client/src/index.js'

export interface Worker {
  $id: string
  name: string
  url: string
  createdAt: string
  deployedAt?: string
  accessedAt?: string
  linkedFolders?: string[]
}

export interface ListOptions {
  sortBy?: 'created' | 'deployed' | 'accessed'
  limit?: number
}

export interface LinkOptions {
  folder: string
  workerId: string
}

const WORKERS_DO_URL = 'https://workers.do'

export class WorkersDoClient {
  private token: string
  private $: ReturnType<typeof $Context>

  constructor(token: string) {
    this.token = token
    this.$ = $Context(WORKERS_DO_URL, { token })
  }

  /**
   * List user's workers sorted by activity
   */
  async list(options: ListOptions = {}): Promise<Worker[]> {
    const { sortBy = 'accessed', limit = 20 } = options

    try {
      const workers = await this.$.workers.list({ sortBy, limit })
      return workers as Worker[]
    } catch (error) {
      console.error('Failed to list workers:', error)
      return []
    }
  }

  /**
   * Link a folder to a worker
   */
  async link(options: LinkOptions): Promise<boolean> {
    const { folder, workerId } = options

    try {
      await this.$.workers.link({ folder, workerId })
      return true
    } catch (error) {
      console.error('Failed to link folder:', error)
      return false
    }
  }

  /**
   * Get a specific worker by ID
   */
  async get(workerId: string): Promise<Worker | null> {
    try {
      const worker = await this.$.workers.get(workerId)
      return worker as Worker
    } catch (error) {
      return null
    }
  }
}
