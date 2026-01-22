// do tool - Execute code in a secure sandbox with ai-evaluate
import { evaluate } from 'ai-evaluate/node'
import type { MCPTool } from './server.js'

export interface DoParams {
  code: string
  timeout?: number
}

export const doTool: MCPTool = {
  name: 'do',
  description: 'Execute code in a secure sandbox with $ context. Runs JavaScript/TypeScript code with timeout and memory limits for safety.',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript/TypeScript code to execute. Use "return" to return a value.'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 5000)',
        default: 5000
      }
    },
    required: ['code']
  },
  execute: async (params: unknown) => {
    // Validate parameters
    if (!params || typeof params !== 'object') {
      throw new Error('Parameters must be an object')
    }

    const { code, timeout = 5000 } = params as DoParams

    if (!code || typeof code !== 'string') {
      throw new Error('Parameter "code" is required and must be a string')
    }

    // Execute code in sandbox with ai-evaluate
    const result = await evaluate({
      script: code,
      timeout,
      fetch: null // Block network access for safety
    })

    return result
  }
}
