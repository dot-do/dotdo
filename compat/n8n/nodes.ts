/**
 * n8n Node Implementations
 *
 * Core nodes compatible with n8n's node interface.
 */

import type {
  INodeType,
  INodeTypeDescription,
  INodeExecutionData,
  IExecuteFunctions,
  ITriggerFunctions,
  IWebhookResponseData,
} from './types'
import { ExpressionParser } from './expression'

// =============================================================================
// EXPRESSION HELPERS
// =============================================================================

const expressionParser = new ExpressionParser()

function evaluateCondition(
  condition: { value1: unknown; operation: string; value2: unknown },
  context: { $json: Record<string, unknown> }
): boolean {
  let value1 = condition.value1
  let value2 = condition.value2

  // Resolve expressions
  if (typeof value1 === 'string' && expressionParser.containsExpression(value1)) {
    value1 = expressionParser.evaluate(value1, context)
  }
  if (typeof value2 === 'string' && expressionParser.containsExpression(value2)) {
    value2 = expressionParser.evaluate(value2, context)
  }

  switch (condition.operation) {
    case 'equal':
      return value1 === value2
    case 'notEqual':
      return value1 !== value2
    case 'larger':
      return Number(value1) > Number(value2)
    case 'largerEqual':
      return Number(value1) >= Number(value2)
    case 'smaller':
      return Number(value1) < Number(value2)
    case 'smallerEqual':
      return Number(value1) <= Number(value2)
    case 'contains':
      return String(value1).includes(String(value2))
    case 'notContains':
      return !String(value1).includes(String(value2))
    case 'startsWith':
      return String(value1).startsWith(String(value2))
    case 'endsWith':
      return String(value1).endsWith(String(value2))
    case 'regex':
      return new RegExp(String(value2)).test(String(value1))
    case 'empty':
      return value1 === '' || value1 === null || value1 === undefined
    case 'notEmpty':
      return value1 !== '' && value1 !== null && value1 !== undefined
    default:
      return false
  }
}

// =============================================================================
// HTTP REQUEST NODE
// =============================================================================

export class HttpRequestNode implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'HTTP Request',
    name: 'httpRequest',
    group: ['transform'],
    version: 1,
    description: 'Makes an HTTP request and returns the response',
    defaults: {
      name: 'HTTP Request',
    },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'URL',
        name: 'url',
        type: 'string',
        default: '',
        required: true,
        description: 'The URL to make the request to',
      },
      {
        displayName: 'Method',
        name: 'method',
        type: 'options',
        default: 'GET',
        options: [
          { name: 'GET', value: 'GET' },
          { name: 'POST', value: 'POST' },
          { name: 'PUT', value: 'PUT' },
          { name: 'DELETE', value: 'DELETE' },
          { name: 'PATCH', value: 'PATCH' },
          { name: 'HEAD', value: 'HEAD' },
          { name: 'OPTIONS', value: 'OPTIONS' },
        ],
      },
      {
        displayName: 'Authentication',
        name: 'authentication',
        type: 'options',
        default: 'none',
        options: [
          { name: 'None', value: 'none' },
          { name: 'Bearer Token', value: 'bearer' },
          { name: 'Basic Auth', value: 'basic' },
          { name: 'API Key', value: 'apiKey' },
        ],
      },
      {
        displayName: 'Body',
        name: 'body',
        type: 'json',
        default: '',
        description: 'Request body (for POST, PUT, PATCH)',
      },
      {
        displayName: 'Headers',
        name: 'headers',
        type: 'fixedCollection',
        default: {},
        description: 'Custom headers',
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const returnData: INodeExecutionData[] = []

    for (let i = 0; i < items.length; i++) {
      const url = this.getNodeParameter('url', i) as string
      const method = this.getNodeParameter('method', i) as string
      const body = this.getNodeParameter('body', i) as unknown
      const authentication = this.getNodeParameter('authentication', i) as string

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // Handle authentication
      if (authentication === 'bearer') {
        const credentials = await this.getCredentials('bearer')
        headers['Authorization'] = `Bearer ${credentials.token}`
      }

      const fetchOptions: RequestInit = {
        method,
        headers,
      }

      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        fetchOptions.body = JSON.stringify(body)
      }

      const response = await fetch(url, fetchOptions)
      const contentType = response.headers.get('content-type') || ''

      let responseData: unknown
      if (contentType.includes('application/json')) {
        responseData = await response.json()
      } else {
        responseData = await response.text()
      }

      returnData.push({
        json: typeof responseData === 'object' ? (responseData as Record<string, unknown>) : { data: responseData },
      })
    }

    return [returnData]
  }
}

// =============================================================================
// CODE NODE
// =============================================================================

export class CodeNode implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Code',
    name: 'code',
    group: ['transform'],
    version: 1,
    description: 'Execute custom JavaScript code',
    defaults: {
      name: 'Code',
    },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Language',
        name: 'language',
        type: 'options',
        default: 'javascript',
        options: [{ name: 'JavaScript', value: 'javascript' }],
      },
      {
        displayName: 'Code',
        name: 'code',
        type: 'string',
        default: 'return items',
        description: 'The JavaScript code to execute',
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const code = this.getNodeParameter('code', 0) as string
    const items = this.getInputData()

    // Build $input helper
    const $input = {
      first: () => items[0],
      last: () => items[items.length - 1],
      all: () => items,
    }

    // Create the function with items and $input available
    // eslint-disable-next-line no-new-func
    const fn = new Function('items', '$input', code)

    const result = await fn(items, $input)

    // Ensure result is in correct format
    if (Array.isArray(result)) {
      return [result]
    }

    return [[{ json: result }]]
  }
}

// =============================================================================
// IF NODE
// =============================================================================

export class IfNode implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'IF',
    name: 'if',
    group: ['transform'],
    version: 1,
    description: 'Route items based on conditions',
    defaults: {
      name: 'IF',
    },
    inputs: ['main'],
    outputs: ['main', 'main'], // true, false
    properties: [
      {
        displayName: 'Conditions',
        name: 'conditions',
        type: 'fixedCollection',
        default: { boolean: [] },
      },
      {
        displayName: 'Combine',
        name: 'combineOperation',
        type: 'options',
        default: 'and',
        options: [
          { name: 'AND', value: 'and' },
          { name: 'OR', value: 'or' },
        ],
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const conditions = this.getNodeParameter('conditions', 0) as { boolean: Array<{ value1: unknown; operation: string; value2: unknown }> }
    const combineOperation = this.getNodeParameter('combineOperation', 0) as string

    const trueItems: INodeExecutionData[] = []
    const falseItems: INodeExecutionData[] = []

    for (const item of items) {
      const context = { $json: item.json }

      let result: boolean
      if (combineOperation === 'and') {
        result = conditions.boolean.every((cond) => evaluateCondition(cond, context))
      } else {
        result = conditions.boolean.some((cond) => evaluateCondition(cond, context))
      }

      if (result) {
        trueItems.push(item)
      } else {
        falseItems.push(item)
      }
    }

    return [trueItems, falseItems]
  }
}

// =============================================================================
// SWITCH NODE
// =============================================================================

export class SwitchNode implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Switch',
    name: 'switch',
    group: ['transform'],
    version: 1,
    description: 'Route items to different outputs based on rules',
    defaults: {
      name: 'Switch',
    },
    inputs: ['main'],
    outputs: ['main', 'main', 'main', 'main'], // Up to 4 outputs + fallback
    properties: [
      {
        displayName: 'Mode',
        name: 'mode',
        type: 'options',
        default: 'rules',
        options: [{ name: 'Rules', value: 'rules' }],
      },
      {
        displayName: 'Rules',
        name: 'rules',
        type: 'fixedCollection',
        default: { values: [] },
      },
      {
        displayName: 'Fallback Output',
        name: 'fallbackOutput',
        type: 'number',
        default: 0,
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const rules = this.getNodeParameter('rules', 0) as { values: Array<{ conditions: Array<{ value1: unknown; operation: string; value2: unknown }>; output: number }> }
    const fallbackOutput = this.getNodeParameter('fallbackOutput', 0) as number

    // Initialize output arrays
    const maxOutput = Math.max(fallbackOutput, ...rules.values.map((r) => r.output))
    const outputs: INodeExecutionData[][] = Array.from({ length: maxOutput + 1 }, () => [])

    for (const item of items) {
      const context = { $json: item.json }

      let matched = false
      for (const rule of rules.values) {
        const ruleMatches = rule.conditions.every((cond) => evaluateCondition(cond, context))
        if (ruleMatches) {
          outputs[rule.output].push(item)
          matched = true
          break
        }
      }

      if (!matched) {
        outputs[fallbackOutput].push(item)
      }
    }

    return outputs
  }
}

// =============================================================================
// SET NODE
// =============================================================================

export class SetNode implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Set',
    name: 'set',
    group: ['transform'],
    version: 1,
    description: 'Set or modify item values',
    defaults: {
      name: 'Set',
    },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Mode',
        name: 'mode',
        type: 'options',
        default: 'manual',
        options: [{ name: 'Manual', value: 'manual' }],
      },
      {
        displayName: 'Keep Only Set',
        name: 'keepOnlySet',
        type: 'boolean',
        default: true,
      },
      {
        displayName: 'Assignments',
        name: 'assignments',
        type: 'fixedCollection',
        default: { values: [] },
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const keepOnlySet = this.getNodeParameter('keepOnlySet', 0) as boolean
    const assignments = this.getNodeParameter('assignments', 0) as { values: Array<{ name: string; value: unknown; type: string }> }

    const returnData: INodeExecutionData[] = []

    for (const item of items) {
      const context = { $json: item.json }
      const newJson: Record<string, unknown> = keepOnlySet ? {} : { ...item.json }

      for (const assignment of assignments.values) {
        let value = assignment.value

        // Resolve expressions
        if (typeof value === 'string' && expressionParser.containsExpression(value)) {
          value = expressionParser.evaluate(value, context)
        }

        // Type coercion
        switch (assignment.type) {
          case 'number':
            value = Number(value)
            break
          case 'boolean':
            value = Boolean(value)
            break
          case 'string':
            value = String(value)
            break
        }

        newJson[assignment.name] = value
      }

      returnData.push({ json: newJson })
    }

    return [returnData]
  }
}

// =============================================================================
// MERGE NODE
// =============================================================================

export class MergeNode implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Merge',
    name: 'merge',
    group: ['transform'],
    version: 1,
    description: 'Merge data from multiple inputs',
    defaults: {
      name: 'Merge',
    },
    inputs: ['main', 'main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Mode',
        name: 'mode',
        type: 'options',
        default: 'append',
        options: [
          { name: 'Append', value: 'append' },
          { name: 'Combine', value: 'combine' },
        ],
      },
      {
        displayName: 'Combination Mode',
        name: 'combinationMode',
        type: 'options',
        default: 'mergeByPosition',
        options: [
          { name: 'Merge By Position', value: 'mergeByPosition' },
          { name: 'Merge By Key', value: 'mergeByKey' },
        ],
      },
      {
        displayName: 'Join Key',
        name: 'joinKey',
        type: 'string',
        default: 'id',
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const mode = this.getNodeParameter('mode', 0) as string
    const input1 = this.getInputData(0)
    const input2 = this.getInputData(1)

    const returnData: INodeExecutionData[] = []

    if (mode === 'append') {
      // Append all items from both inputs
      returnData.push(...input1, ...input2)
    } else if (mode === 'combine') {
      const combinationMode = this.getNodeParameter('combinationMode', 0) as string

      if (combinationMode === 'mergeByPosition') {
        // Merge items by position
        const maxLength = Math.max(input1.length, input2.length)
        for (let i = 0; i < maxLength; i++) {
          const item1 = input1[i]?.json || {}
          const item2 = input2[i]?.json || {}
          returnData.push({ json: { ...item1, ...item2 } })
        }
      } else if (combinationMode === 'mergeByKey') {
        const joinKey = this.getNodeParameter('joinKey', 0) as string

        // Create lookup from input2
        const lookup = new Map<unknown, Record<string, unknown>>()
        for (const item of input2) {
          lookup.set(item.json[joinKey], item.json)
        }

        // Merge input1 with matching items from input2
        for (const item of input1) {
          const key = item.json[joinKey]
          const matchingItem = lookup.get(key) || {}
          returnData.push({ json: { ...item.json, ...matchingItem } })
        }
      }
    }

    return [returnData]
  }
}

// =============================================================================
// TRIGGER NODES
// =============================================================================

export class WebhookTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Webhook',
    name: 'webhook',
    group: ['trigger'],
    version: 1,
    description: 'Starts workflow on webhook call',
    defaults: {
      name: 'Webhook',
    },
    inputs: [],
    outputs: ['main'],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        path: '/webhook',
      },
    ],
    properties: [
      {
        displayName: 'Path',
        name: 'path',
        type: 'string',
        default: '/webhook',
      },
      {
        displayName: 'HTTP Method',
        name: 'httpMethod',
        type: 'options',
        default: 'POST',
        options: [
          { name: 'GET', value: 'GET' },
          { name: 'POST', value: 'POST' },
          { name: 'PUT', value: 'PUT' },
          { name: 'DELETE', value: 'DELETE' },
          { name: 'PATCH', value: 'PATCH' },
        ],
      },
    ],
  }

  async webhook(this: ITriggerFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject()

    return {
      workflowData: [[{ json: req.body as Record<string, unknown> }]],
    }
  }
}

export class CronTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Schedule Trigger',
    name: 'scheduleTrigger',
    group: ['trigger'],
    version: 1,
    description: 'Starts workflow on a schedule',
    defaults: {
      name: 'Schedule',
    },
    inputs: [],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Cron Expression',
        name: 'cronExpression',
        type: 'string',
        default: '0 * * * *',
        description: 'Cron expression for schedule',
      },
      {
        displayName: 'Timezone',
        name: 'timezone',
        type: 'string',
        default: 'UTC',
      },
    ],
  }

  async trigger(): Promise<{ closeFunction?: () => Promise<void> }> {
    // In real implementation, this would set up the cron job
    return {}
  }
}

export class ManualTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Manual Trigger',
    name: 'manualTrigger',
    group: ['trigger'],
    version: 1,
    description: 'Starts workflow manually',
    defaults: {
      name: 'Manual',
    },
    inputs: [],
    outputs: ['main'],
    properties: [],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    // Pass through input data or empty item
    const items = this.getInputData()
    return [items.length > 0 ? items : [{ json: {} }]]
  }
}
