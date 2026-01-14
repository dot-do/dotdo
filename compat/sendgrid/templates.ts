/**
 * @dotdo/sendgrid - Template Management
 *
 * SendGrid-compatible template management with local storage support.
 * Provides CRUD operations for dynamic templates with version control.
 *
 * @example
 * ```typescript
 * import { TemplateManager } from '@dotdo/sendgrid/templates'
 *
 * const manager = new TemplateManager({ storage: kv })
 *
 * // Create template
 * const template = await manager.create({
 *   name: 'Welcome Email',
 *   generation: 'dynamic',
 * })
 *
 * // Create version
 * await manager.createVersion(template.id, {
 *   name: 'Version 1',
 *   subject: 'Welcome {{name}}!',
 *   html_content: '<h1>Hello {{name}}</h1>',
 *   active: 1,
 * })
 *
 * // Render template
 * const rendered = await manager.render(template.id, { name: 'John' })
 * ```
 */

/// <reference types="@cloudflare/workers-types" />

import {
  TemplateStorage,
  InMemoryTemplateStorage,
  KVTemplateStorage,
  SQLiteTemplateStorage,
  TemplateRenderer,
  extractVariables,
} from '../emails/templates'
import type { EmailTemplate } from '../emails/types'

// =============================================================================
// Types
// =============================================================================

export interface Template {
  id: string
  name: string
  generation: 'legacy' | 'dynamic'
  updated_at: string
  versions: TemplateVersion[]
}

export interface TemplateVersion {
  id: string
  template_id: string
  name: string
  subject: string
  html_content?: string
  plain_content?: string
  active: 0 | 1
  editor: 'code' | 'design'
  generate_plain_content: boolean
  updated_at: string
}

export interface TemplateCreateParams {
  name: string
  generation?: 'legacy' | 'dynamic'
}

export interface TemplateUpdateParams {
  name?: string
}

export interface TemplateVersionCreateParams {
  name: string
  subject?: string
  html_content?: string
  plain_content?: string
  active?: 0 | 1
  editor?: 'code' | 'design'
  generate_plain_content?: boolean
  test_data?: string
}

export interface TemplateVersionUpdateParams {
  name?: string
  subject?: string
  html_content?: string
  plain_content?: string
  active?: 0 | 1
  editor?: 'code' | 'design'
  generate_plain_content?: boolean
}

export interface TemplateListParams {
  generations?: 'legacy' | 'dynamic' | 'legacy,dynamic'
  page_size?: number
  page_token?: string
}

export interface RenderResult {
  subject: string
  html: string
  text?: string
}

export interface TemplateManagerConfig {
  /** KVNamespace for template storage */
  kv?: KVNamespace
  /** SQLStorage for DO-based storage */
  sql?: SqlStorage
  /** Custom template storage */
  storage?: TemplateStorage
  /** Prefix for storage keys */
  prefix?: string
}

// =============================================================================
// Internal Storage Types
// =============================================================================

interface StoredTemplate {
  id: string
  name: string
  generation: 'legacy' | 'dynamic'
  updated_at: string
  versions: StoredVersion[]
}

interface StoredVersion {
  id: string
  template_id: string
  name: string
  subject: string
  html_content: string
  plain_content?: string
  active: 0 | 1
  editor: 'code' | 'design'
  generate_plain_content: boolean
  updated_at: string
  test_data?: string
}

// =============================================================================
// Template Manager
// =============================================================================

export class TemplateManager {
  private storage: TemplateStorage
  private templates: Map<string, StoredTemplate> = new Map()
  private renderer: TemplateRenderer

  constructor(config: TemplateManagerConfig = {}) {
    // Initialize storage
    if (config.storage) {
      this.storage = config.storage
    } else if (config.kv) {
      this.storage = new KVTemplateStorage(config.kv, config.prefix)
    } else if (config.sql) {
      this.storage = new SQLiteTemplateStorage(config.sql)
    } else {
      this.storage = new InMemoryTemplateStorage()
    }

    this.renderer = new TemplateRenderer(this.storage)
  }

  // ===========================================================================
  // Template CRUD
  // ===========================================================================

  /**
   * Create a new template
   */
  async create(params: TemplateCreateParams): Promise<Template> {
    const id = `d-${crypto.randomUUID()}`
    const now = new Date().toISOString()

    const template: StoredTemplate = {
      id,
      name: params.name,
      generation: params.generation || 'dynamic',
      updated_at: now,
      versions: [],
    }

    this.templates.set(id, template)

    return this.toTemplate(template)
  }

  /**
   * Get a template by ID
   */
  async get(id: string): Promise<Template | null> {
    const template = this.templates.get(id)
    return template ? this.toTemplate(template) : null
  }

  /**
   * Update a template
   */
  async update(id: string, params: TemplateUpdateParams): Promise<Template> {
    const template = this.templates.get(id)
    if (!template) {
      throw new Error(`Template not found: ${id}`)
    }

    if (params.name !== undefined) {
      template.name = params.name
    }
    template.updated_at = new Date().toISOString()

    this.templates.set(id, template)

    return this.toTemplate(template)
  }

  /**
   * Delete a template
   */
  async delete(id: string): Promise<void> {
    if (!this.templates.has(id)) {
      throw new Error(`Template not found: ${id}`)
    }

    // Delete all versions from storage
    const template = this.templates.get(id)!
    for (const version of template.versions) {
      await this.storage.delete(`${id}:${version.id}`)
    }

    this.templates.delete(id)
  }

  /**
   * List all templates
   */
  async list(params?: TemplateListParams): Promise<{ result: Template[]; _metadata?: { count?: number } }> {
    let templates = Array.from(this.templates.values())

    // Filter by generation
    if (params?.generations) {
      const gens = params.generations.split(',')
      templates = templates.filter((t) => gens.includes(t.generation))
    }

    // Pagination
    const pageSize = params?.page_size || 50
    const pageToken = params?.page_token ? parseInt(params.page_token, 10) : 0
    const paginatedTemplates = templates.slice(pageToken, pageToken + pageSize)

    return {
      result: paginatedTemplates.map((t) => this.toTemplate(t)),
      _metadata: {
        count: templates.length,
      },
    }
  }

  // ===========================================================================
  // Version CRUD
  // ===========================================================================

  /**
   * Create a template version
   */
  async createVersion(templateId: string, params: TemplateVersionCreateParams): Promise<TemplateVersion> {
    const template = this.templates.get(templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }

    const versionId = crypto.randomUUID()
    const now = new Date().toISOString()

    const version: StoredVersion = {
      id: versionId,
      template_id: templateId,
      name: params.name,
      subject: params.subject || '',
      html_content: params.html_content || '',
      plain_content: params.plain_content,
      active: params.active || 0,
      editor: params.editor || 'code',
      generate_plain_content: params.generate_plain_content || false,
      updated_at: now,
      test_data: params.test_data,
    }

    // If this version is active, deactivate others
    if (version.active === 1) {
      template.versions.forEach((v) => (v.active = 0))
    }

    template.versions.push(version)
    template.updated_at = now
    this.templates.set(templateId, template)

    // Store in template storage for rendering
    await this.syncVersionToStorage(version)

    return this.toVersion(version)
  }

  /**
   * Get a template version
   */
  async getVersion(templateId: string, versionId: string): Promise<TemplateVersion | null> {
    const template = this.templates.get(templateId)
    if (!template) return null

    const version = template.versions.find((v) => v.id === versionId)
    return version ? this.toVersion(version) : null
  }

  /**
   * Update a template version
   */
  async updateVersion(
    templateId: string,
    versionId: string,
    params: TemplateVersionUpdateParams
  ): Promise<TemplateVersion> {
    const template = this.templates.get(templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }

    const versionIdx = template.versions.findIndex((v) => v.id === versionId)
    if (versionIdx === -1) {
      throw new Error(`Version not found: ${versionId}`)
    }

    const version = template.versions[versionIdx]
    const now = new Date().toISOString()

    if (params.name !== undefined) version.name = params.name
    if (params.subject !== undefined) version.subject = params.subject
    if (params.html_content !== undefined) version.html_content = params.html_content
    if (params.plain_content !== undefined) version.plain_content = params.plain_content
    if (params.editor !== undefined) version.editor = params.editor
    if (params.generate_plain_content !== undefined) version.generate_plain_content = params.generate_plain_content
    if (params.active !== undefined) {
      if (params.active === 1) {
        // Deactivate others
        template.versions.forEach((v) => (v.active = 0))
      }
      version.active = params.active
    }
    version.updated_at = now

    template.versions[versionIdx] = version
    template.updated_at = now
    this.templates.set(templateId, template)

    // Update storage
    await this.syncVersionToStorage(version)

    return this.toVersion(version)
  }

  /**
   * Activate a template version
   */
  async activateVersion(templateId: string, versionId: string): Promise<TemplateVersion> {
    return this.updateVersion(templateId, versionId, { active: 1 })
  }

  /**
   * Delete a template version
   */
  async deleteVersion(templateId: string, versionId: string): Promise<void> {
    const template = this.templates.get(templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }

    const versionIdx = template.versions.findIndex((v) => v.id === versionId)
    if (versionIdx === -1) {
      throw new Error(`Version not found: ${versionId}`)
    }

    template.versions.splice(versionIdx, 1)
    template.updated_at = new Date().toISOString()
    this.templates.set(templateId, template)

    // Remove from storage
    await this.storage.delete(`${templateId}:${versionId}`)
  }

  // ===========================================================================
  // Rendering
  // ===========================================================================

  /**
   * Render a template with data
   */
  async render(templateId: string, data: Record<string, unknown>): Promise<RenderResult | null> {
    const template = this.templates.get(templateId)
    if (!template) return null

    // Find active version
    const activeVersion = template.versions.find((v) => v.active === 1) || template.versions[0]
    if (!activeVersion) return null

    // Render using the template renderer
    const rendered = this.renderer.renderString(activeVersion.html_content, data)
    const subject = this.renderer.renderString(activeVersion.subject, data)
    const text = activeVersion.plain_content
      ? this.renderer.renderString(activeVersion.plain_content, data)
      : activeVersion.generate_plain_content
        ? this.stripHtml(rendered)
        : undefined

    return {
      subject,
      html: rendered,
      text,
    }
  }

  /**
   * Get variables used in a template
   */
  async getVariables(templateId: string, versionId?: string): Promise<string[]> {
    const template = this.templates.get(templateId)
    if (!template) return []

    const version = versionId
      ? template.versions.find((v) => v.id === versionId)
      : template.versions.find((v) => v.active === 1) || template.versions[0]

    if (!version) return []

    const subjectVars = extractVariables(version.subject)
    const htmlVars = extractVariables(version.html_content)
    const textVars = version.plain_content ? extractVariables(version.plain_content) : []

    return Array.from(new Set([...subjectVars, ...htmlVars, ...textVars]))
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private toTemplate(stored: StoredTemplate): Template {
    return {
      id: stored.id,
      name: stored.name,
      generation: stored.generation,
      updated_at: stored.updated_at,
      versions: stored.versions.map((v) => this.toVersion(v)),
    }
  }

  private toVersion(stored: StoredVersion): TemplateVersion {
    return {
      id: stored.id,
      template_id: stored.template_id,
      name: stored.name,
      subject: stored.subject,
      html_content: stored.html_content,
      plain_content: stored.plain_content,
      active: stored.active,
      editor: stored.editor,
      generate_plain_content: stored.generate_plain_content,
      updated_at: stored.updated_at,
    }
  }

  private async syncVersionToStorage(version: StoredVersion): Promise<void> {
    const emailTemplate: EmailTemplate = {
      id: `${version.template_id}:${version.id}`,
      name: version.name,
      subject: version.subject,
      html: version.html_content,
      text: version.plain_content,
      variables: extractVariables(version.html_content + version.subject),
      created_at: new Date(),
      updated_at: new Date(version.updated_at),
    }

    await this.storage.set(emailTemplate)
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
}

// =============================================================================
// Exports
// =============================================================================

export default TemplateManager
