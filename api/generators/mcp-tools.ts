/**
 * MCP Tool Generator
 *
 * Auto-generates MCP tools from DO public methods.
 * Integrates with the auto-wiring system to discover exposed methods
 * and generate JSON Schema for their parameters.
 *
 * @example
 * ```typescript
 * import { generateMCPTools } from './mcp-tools'
 * import { MyDO } from '../objects/MyDO'
 *
 * const tools = generateMCPTools(MyDO)
 * // Returns array of MCP tools with names, descriptions, and input schemas
 * ```
 */

import {
  getExposedMethods,
  getMethodSignature,
  getMethodMetadata,
  type ParameterInfo,
} from '../../objects/auto-wiring'

// ============================================================================
// TYPES
// ============================================================================

/**
 * MCP Tool definition matching the MCP protocol specification
 */
export interface McpTool {
  /** The name of the tool (used in tools/call) */
  name: string
  /** Human-readable description of what the tool does */
  description: string
  /** JSON Schema for the tool's input parameters */
  inputSchema: Record<string, unknown>
}

// ============================================================================
// JSON SCHEMA GENERATOR
// ============================================================================

/**
 * Generate a JSON Schema object from method parameter information.
 *
 * Creates a standard JSON Schema object with:
 * - type: "object"
 * - properties: Each parameter as a property with type "string" (default)
 * - required: Array of non-optional parameter names
 *
 * @param parameters - Array of parameter info from auto-wiring
 * @returns JSON Schema object
 *
 * @example
 * ```typescript
 * const params = [
 *   { name: 'id', optional: false },
 *   { name: 'config', optional: true }
 * ]
 * const schema = generateJSONSchema(params)
 * // {
 * //   type: 'object',
 * //   properties: { id: { type: 'string' }, config: { type: 'string' } },
 * //   required: ['id']
 * // }
 * ```
 */
export function generateJSONSchema(parameters: ParameterInfo[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const param of parameters) {
    // Default to string type - basic type inference
    // In a more advanced implementation, we could infer types from
    // TypeScript metadata or JSDoc annotations
    properties[param.name] = { type: 'string' }

    if (!param.optional) {
      required.push(param.name)
    }
  }

  return {
    type: 'object',
    properties,
    required,
  }
}

// ============================================================================
// MCP TOOLS GENERATOR
// ============================================================================

/**
 * Generate MCP tools from a DO class.
 *
 * Discovers all public methods on the DO class (and its subclasses) using
 * the auto-wiring system and generates MCP tool definitions for each.
 *
 * Features:
 * - Auto-discovers exposed methods (excludes private/protected)
 * - Generates JSON Schema for method parameters
 * - Uses method metadata for descriptions
 * - Handles required vs optional parameters
 *
 * @param DOClass - The DO class constructor to generate tools from
 * @returns Array of MCP tool definitions
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   async greet(name: string): Promise<string> {
 *     return `Hello, ${name}`
 *   }
 * }
 *
 * const tools = generateMCPTools(MyDO)
 * // [
 * //   {
 * //     name: 'greet',
 * //     description: 'Greet',
 * //     inputSchema: {
 * //       type: 'object',
 * //       properties: { name: { type: 'string' } },
 * //       required: ['name']
 * //     }
 * //   }
 * // ]
 * ```
 */
export function generateMCPTools<T extends Function>(DOClass: T): McpTool[] {
  // Get list of exposed (public) method names
  const methods = getExposedMethods(DOClass)

  // Generate tool for each method
  return methods.map((methodName) => {
    // Get method signature (parameters, async, etc.)
    const signature = getMethodSignature(DOClass, methodName)

    // Get method metadata (description, etc.)
    const metadata = getMethodMetadata(DOClass, methodName)

    // Generate JSON Schema from parameters
    const inputSchema = generateJSONSchema(signature?.parameters || [])

    return {
      name: methodName,
      description: metadata?.description || `${methodName} method`,
      inputSchema,
    }
  })
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default generateMCPTools
