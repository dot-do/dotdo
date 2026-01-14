/**
 * @dotdo/emails - Email Templates
 *
 * Template storage and rendering for email templates.
 * Supports both Handlebars-style and React Email templates.
 */

/// <reference types="@cloudflare/workers-types" />

import type { EmailTemplate } from './types'

// ============================================================================
// Template Storage
// ============================================================================

export interface TemplateStorage {
  get(id: string): Promise<EmailTemplate | null>
  set(template: EmailTemplate): Promise<void>
  delete(id: string): Promise<void>
  list(): Promise<EmailTemplate[]>
}

/**
 * In-memory template storage (for testing and simple use cases)
 */
export class InMemoryTemplateStorage implements TemplateStorage {
  private templates: Map<string, EmailTemplate> = new Map()

  async get(id: string): Promise<EmailTemplate | null> {
    return this.templates.get(id) || null
  }

  async set(template: EmailTemplate): Promise<void> {
    this.templates.set(template.id, template)
  }

  async delete(id: string): Promise<void> {
    this.templates.delete(id)
  }

  async list(): Promise<EmailTemplate[]> {
    return Array.from(this.templates.values())
  }

  clear(): void {
    this.templates.clear()
  }
}

/**
 * KV-backed template storage (for Cloudflare Workers)
 */
export class KVTemplateStorage implements TemplateStorage {
  private kv: KVNamespace
  private prefix: string

  constructor(kv: KVNamespace, prefix = 'email_template:') {
    this.kv = kv
    this.prefix = prefix
  }

  async get(id: string): Promise<EmailTemplate | null> {
    const data = await this.kv.get(this.prefix + id, 'json')
    return data as EmailTemplate | null
  }

  async set(template: EmailTemplate): Promise<void> {
    await this.kv.put(this.prefix + template.id, JSON.stringify(template))
  }

  async delete(id: string): Promise<void> {
    await this.kv.delete(this.prefix + id)
  }

  async list(): Promise<EmailTemplate[]> {
    const keys = await this.kv.list({ prefix: this.prefix })
    const templates: EmailTemplate[] = []

    for (const key of keys.keys) {
      const template = await this.get(key.name.slice(this.prefix.length))
      if (template) {
        templates.push(template)
      }
    }

    return templates
  }
}

/**
 * SQLite-backed template storage (for DO storage)
 */
export class SQLiteTemplateStorage implements TemplateStorage {
  private sql: SqlStorage

  constructor(sql: SqlStorage) {
    this.sql = sql
    this.init()
  }

  private init(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        html TEXT NOT NULL,
        text TEXT,
        variables TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
  }

  async get(id: string): Promise<EmailTemplate | null> {
    const cursor = this.sql.exec(
      'SELECT * FROM email_templates WHERE id = ?',
      id
    )
    const rows = cursor.toArray()
    if (rows.length === 0) return null

    const row = rows[0] as Record<string, unknown>
    return {
      id: row.id as string,
      name: row.name as string,
      subject: row.subject as string,
      html: row.html as string,
      text: row.text as string | undefined,
      variables: row.variables ? JSON.parse(row.variables as string) : undefined,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    }
  }

  async set(template: EmailTemplate): Promise<void> {
    this.sql.exec(
      `INSERT OR REPLACE INTO email_templates
       (id, name, subject, html, text, variables, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      template.id,
      template.name,
      template.subject,
      template.html,
      template.text || null,
      template.variables ? JSON.stringify(template.variables) : null,
      template.created_at.toISOString(),
      template.updated_at.toISOString()
    )
  }

  async delete(id: string): Promise<void> {
    this.sql.exec('DELETE FROM email_templates WHERE id = ?', id)
  }

  async list(): Promise<EmailTemplate[]> {
    const cursor = this.sql.exec('SELECT * FROM email_templates ORDER BY updated_at DESC')
    const rows = cursor.toArray()
    return rows.map((row) => {
      const r = row as Record<string, unknown>
      return {
        id: r.id as string,
        name: r.name as string,
        subject: r.subject as string,
        html: r.html as string,
        text: r.text as string | undefined,
        variables: r.variables ? JSON.parse(r.variables as string) : undefined,
        created_at: new Date(r.created_at as string),
        updated_at: new Date(r.updated_at as string),
      }
    })
  }
}

// ============================================================================
// Template Rendering
// ============================================================================

export interface RenderOptions {
  data: Record<string, unknown>
  escapeHtml?: boolean
}

/**
 * Simple Handlebars-style template renderer
 *
 * Supports:
 * - {{variable}} - Variable substitution
 * - {{#if condition}}...{{/if}} - Conditionals
 * - {{#each array}}...{{/each}} - Loops
 */
export class TemplateRenderer {
  private storage: TemplateStorage

  constructor(storage: TemplateStorage) {
    this.storage = storage
  }

  /**
   * Render a template by ID with data
   */
  async render(
    templateId: string,
    data: Record<string, unknown>
  ): Promise<{ subject: string; html: string; text?: string } | null> {
    const template = await this.storage.get(templateId)
    if (!template) return null

    return {
      subject: this.renderString(template.subject, data),
      html: this.renderString(template.html, data, true),
      text: template.text ? this.renderString(template.text, data) : undefined,
    }
  }

  /**
   * Render a string template with data
   */
  renderString(template: string, data: Record<string, unknown>, escapeHtml = false): string {
    let result = template

    // Handle {{#each array}}...{{/each}}
    result = this.processEach(result, data, escapeHtml)

    // Handle {{#if condition}}...{{/if}}
    result = this.processIf(result, data, escapeHtml)

    // Handle {{variable}}
    result = this.processVariables(result, data, escapeHtml)

    return result
  }

  private processVariables(
    template: string,
    data: Record<string, unknown>,
    escapeHtml: boolean
  ): string {
    return template.replace(/\{\{([^#/}]+)\}\}/g, (_, key) => {
      const value = this.getValue(data, key.trim())
      const stringValue = value === undefined || value === null ? '' : String(value)
      return escapeHtml ? this.escape(stringValue) : stringValue
    })
  }

  private processIf(
    template: string,
    data: Record<string, unknown>,
    escapeHtml: boolean
  ): string {
    const ifRegex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g

    return template.replace(ifRegex, (_, condition, content) => {
      const value = this.getValue(data, condition.trim())
      if (this.isTruthy(value)) {
        return this.renderString(content, data, escapeHtml)
      }
      return ''
    })
  }

  private processEach(
    template: string,
    data: Record<string, unknown>,
    escapeHtml: boolean
  ): string {
    const eachRegex = /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g

    return template.replace(eachRegex, (_, arrayKey, content) => {
      const array = this.getValue(data, arrayKey.trim())
      if (!Array.isArray(array)) return ''

      return array
        .map((item, index) => {
          const itemData = {
            ...data,
            this: item,
            '@index': index,
            '@first': index === 0,
            '@last': index === array.length - 1,
          }
          return this.renderString(content, itemData, escapeHtml)
        })
        .join('')
    })
  }

  private getValue(data: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.')
    let value: unknown = data

    for (const key of keys) {
      if (value === null || value === undefined) return undefined
      value = (value as Record<string, unknown>)[key]
    }

    return value
  }

  private isTruthy(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0
    return Boolean(value)
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }
}

// ============================================================================
// Pre-built Templates
// ============================================================================

export const BUILT_IN_TEMPLATES: EmailTemplate[] = [
  {
    id: 'welcome',
    name: 'Welcome Email',
    subject: 'Welcome to {{company_name}}!',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; color: #333;">Welcome, {{name}}!</h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.5; color: #555;">
                Thank you for joining {{company_name}}. We're excited to have you on board!
              </p>
              {{#if cta_url}}
              <a href="{{cta_url}}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
                {{cta_text}}
              </a>
              {{/if}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Welcome, {{name}}!

Thank you for joining {{company_name}}. We're excited to have you on board!

{{#if cta_url}}{{cta_text}}: {{cta_url}}{{/if}}`,
    variables: ['name', 'company_name', 'cta_url', 'cta_text'],
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'password-reset',
    name: 'Password Reset',
    subject: 'Reset your {{company_name}} password',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; color: #333;">Reset Your Password</h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.5; color: #555;">
                We received a request to reset your password. Click the button below to create a new password.
              </p>
              <a href="{{reset_url}}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
                Reset Password
              </a>
              <p style="margin: 20px 0 0; font-size: 14px; color: #888;">
                This link will expire in {{expiry_hours}} hours. If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Reset Your Password

We received a request to reset your password. Click the link below to create a new password:

{{reset_url}}

This link will expire in {{expiry_hours}} hours. If you didn't request this, you can safely ignore this email.`,
    variables: ['reset_url', 'expiry_hours', 'company_name'],
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'notification',
    name: 'Generic Notification',
    subject: '{{subject}}',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; color: #333;">{{title}}</h1>
              <p style="margin: 0; font-size: 16px; line-height: 1.5; color: #555;">{{message}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `{{title}}

{{message}}`,
    variables: ['subject', 'title', 'message'],
    created_at: new Date(),
    updated_at: new Date(),
  },
]

// ============================================================================
// Template Utilities
// ============================================================================

/**
 * Initialize storage with built-in templates
 */
export async function initializeBuiltInTemplates(storage: TemplateStorage): Promise<void> {
  for (const template of BUILT_IN_TEMPLATES) {
    await storage.set(template)
  }
}

/**
 * Extract variables from a template string
 */
export function extractVariables(template: string): string[] {
  const variables = new Set<string>()

  // Match {{variable}}, {{#if variable}}, {{#each variable}}
  const regex = /\{\{(?:#(?:if|each)\s+)?([^/#}]+?)(?:\s*\}\})/g
  let match

  while ((match = regex.exec(template)) !== null) {
    const variable = match[1].trim()
    // Skip special variables
    if (!variable.startsWith('@') && variable !== 'this') {
      // Handle nested paths
      const rootVar = variable.split('.')[0]
      variables.add(rootVar)
    }
  }

  return Array.from(variables)
}

/**
 * Validate that all required variables are provided
 */
export function validateTemplateData(
  template: EmailTemplate,
  data: Record<string, unknown>
): { valid: boolean; missing: string[] } {
  const missing: string[] = []

  if (template.variables) {
    for (const variable of template.variables) {
      if (!(variable in data)) {
        missing.push(variable)
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  }
}
