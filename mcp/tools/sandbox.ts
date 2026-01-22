// sandbox tool - Execute code in a secure sandbox with $ context injection
import type { MCPTool } from '../server'
import { createSandbox, type SandboxOptions, type SandboxResult, type SandboxPermissions, type ResourceLimits } from '../sandbox'
import type { WorkflowContext } from '@dotdo/do/context'

export interface SandboxParams {
  code: string
  timeout?: number
  permissions?: SandboxPermissions
  resourceLimits?: ResourceLimits
  audit?: boolean
}

export interface SandboxToolDeps {
  context: WorkflowContext
  defaultPermissions?: SandboxPermissions
  defaultResourceLimits?: ResourceLimits
}

/**
 * Create a sandbox MCP tool with full $ context support
 *
 * This tool differs from the basic 'do' tool in that it:
 * - Provides the full $ context (send, try, do, on, every)
 * - Supports permission-based access control
 * - Includes audit logging capabilities
 * - Reports detailed resource usage
 */
export function createSandboxTool(deps: SandboxToolDeps): MCPTool {
  const { context, defaultPermissions, defaultResourceLimits } = deps

  return {
    name: 'sandbox',
    description: 'Execute code in a secure sandbox with $ context. Provides access to $.send(), $.try(), $.do(), $.on, and $.every for workflow operations. Supports permission control, resource limits, and audit logging.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript/TypeScript code to execute. The $ context is available for workflow operations. Use "return" to return a value.'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 5000, max: 30000)',
          default: 5000,
          maximum: 30000
        },
        permissions: {
          type: 'object',
          description: 'Permission flags to control $ context access',
          properties: {
            allowSend: { type: 'boolean', description: 'Allow $.send() for event emission', default: true },
            allowTry: { type: 'boolean', description: 'Allow $.try() for single attempts', default: true },
            allowDo: { type: 'boolean', description: 'Allow $.do() for durable operations', default: true },
            allowOn: { type: 'boolean', description: 'Allow $.on for event handlers', default: true },
            allowEvery: { type: 'boolean', description: 'Allow $.every for scheduling', default: true }
          }
        },
        resourceLimits: {
          type: 'object',
          description: 'Resource limits for execution',
          properties: {
            timeout: { type: 'number', description: 'Maximum execution time in ms' },
            maxCodeSize: { type: 'number', description: 'Maximum code size in bytes' },
            maxOutputSize: { type: 'number', description: 'Maximum output size in bytes' }
          }
        },
        audit: {
          type: 'boolean',
          description: 'Enable audit logging for $ operations',
          default: false
        }
      },
      required: ['code']
    },
    execute: async (params: unknown): Promise<SandboxResult & { auditLog?: unknown[] }> => {
      // Validate parameters
      if (!params || typeof params !== 'object') {
        throw new Error('Parameters must be an object')
      }

      const {
        code,
        timeout,
        permissions,
        resourceLimits,
        audit = false
      } = params as SandboxParams

      if (!code || typeof code !== 'string') {
        throw new Error('Parameter "code" is required and must be a string')
      }

      // Cap timeout at 30 seconds
      const effectiveTimeout = Math.min(timeout ?? 5000, 30000)

      // Collect audit logs if enabled
      const auditLog: unknown[] = []
      const onAudit = audit ? (log: unknown) => auditLog.push(log) : undefined

      // Merge permissions and resource limits with defaults
      const sandboxOptions: SandboxOptions = {
        context,
        permissions: { ...defaultPermissions, ...permissions },
        resourceLimits: {
          ...defaultResourceLimits,
          ...resourceLimits,
          timeout: effectiveTimeout
        },
        audit,
        ...(onAudit !== undefined && { onAudit })
      }

      // Create and execute sandbox
      const sandbox = createSandbox(sandboxOptions)
      const result = await sandbox.execute(code)

      // Return result with optional audit log
      if (audit && auditLog.length > 0) {
        return { ...result, auditLog }
      }

      return result
    }
  }
}

/**
 * Default sandbox tool instance (requires context to be set later)
 * For use when context is not available at import time
 */
export const sandboxToolMetadata: Omit<MCPTool, 'execute'> = {
  name: 'sandbox',
  description: 'Execute code in a secure sandbox with $ context. Provides access to $.send(), $.try(), $.do(), $.on, and $.every for workflow operations.',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript/TypeScript code to execute with $ context available'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 5000)',
        default: 5000
      },
      permissions: {
        type: 'object',
        description: 'Permission flags for $ context operations'
      },
      audit: {
        type: 'boolean',
        description: 'Enable audit logging',
        default: false
      }
    },
    required: ['code']
  }
}
