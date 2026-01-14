/**
 * n8n Compat Layer Tests
 *
 * TDD tests for n8n-compatible workflow automation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Types
  type INodeType,
  type INodeTypeDescription,
  type INodeExecutionData,
  type IExecuteFunctions,
  type ITriggerFunctions,
  type ICredentialType,
  type INodeProperties,
  type IWorkflowData,
  type IConnection,
  type INodeCredentials,
  // Expression language
  ExpressionParser,
  // Core nodes
  HttpRequestNode,
  CodeNode,
  IfNode,
  SwitchNode,
  SetNode,
  MergeNode,
  // Triggers
  WebhookTrigger,
  CronTrigger,
  ManualTrigger,
  // Credentials
  CredentialManager,
  // Workflow
  Workflow,
  WorkflowExecutor,
  // Registry
  NodeRegistry,
} from '../index'

// =============================================================================
// EXPRESSION LANGUAGE TESTS
// =============================================================================

describe('ExpressionParser', () => {
  let parser: ExpressionParser

  beforeEach(() => {
    parser = new ExpressionParser()
  })

  describe('$json expressions', () => {
    it('should resolve $json.field from current item', () => {
      const context = {
        $json: { name: 'John', age: 30 },
      }
      expect(parser.evaluate('{{ $json.name }}', context)).toBe('John')
      expect(parser.evaluate('{{ $json.age }}', context)).toBe(30)
    })

    it('should resolve nested $json paths', () => {
      const context = {
        $json: { user: { profile: { email: 'john@example.com' } } },
      }
      expect(parser.evaluate('{{ $json.user.profile.email }}', context)).toBe('john@example.com')
    })

    it('should handle array access in $json', () => {
      const context = {
        $json: { items: ['a', 'b', 'c'] },
      }
      expect(parser.evaluate('{{ $json.items[0] }}', context)).toBe('a')
      expect(parser.evaluate('{{ $json.items[2] }}', context)).toBe('c')
    })
  })

  describe('$item expressions', () => {
    it('should access current item index', () => {
      const context = {
        $item: { index: 2 },
      }
      expect(parser.evaluate('{{ $item.index }}', context)).toBe(2)
    })
  })

  describe('$node expressions', () => {
    it('should access output from previous nodes', () => {
      const context = {
        $node: {
          'HTTP Request': {
            json: { status: 'ok', data: { id: 123 } },
          },
        },
      }
      expect(parser.evaluate("{{ $node['HTTP Request'].json.status }}", context)).toBe('ok')
      expect(parser.evaluate("{{ $node['HTTP Request'].json.data.id }}", context)).toBe(123)
    })
  })

  describe('$input expressions', () => {
    it('should access input data', () => {
      const context = {
        $input: {
          first: { json: { value: 'first-value' } },
          last: { json: { value: 'last-value' } },
          all: [{ json: { value: 'a' } }, { json: { value: 'b' } }],
        },
      }
      expect(parser.evaluate('{{ $input.first.json.value }}', context)).toBe('first-value')
      expect(parser.evaluate('{{ $input.last.json.value }}', context)).toBe('last-value')
    })
  })

  describe('JavaScript expressions', () => {
    it('should evaluate simple JavaScript', () => {
      const context = { $json: { a: 5, b: 3 } }
      expect(parser.evaluate('{{ $json.a + $json.b }}', context)).toBe(8)
      expect(parser.evaluate('{{ $json.a * $json.b }}', context)).toBe(15)
    })

    it('should support string operations', () => {
      const context = { $json: { name: 'john doe' } }
      expect(parser.evaluate('{{ $json.name.toUpperCase() }}', context)).toBe('JOHN DOE')
      expect(parser.evaluate("{{ $json.name.split(' ')[0] }}", context)).toBe('john')
    })

    it('should support ternary expressions', () => {
      const context = { $json: { age: 25 } }
      expect(parser.evaluate("{{ $json.age >= 18 ? 'adult' : 'minor' }}", context)).toBe('adult')
    })
  })

  describe('$env expressions', () => {
    it('should access environment variables', () => {
      const context = {
        $env: { API_KEY: 'secret-key-123' },
      }
      expect(parser.evaluate('{{ $env.API_KEY }}', context)).toBe('secret-key-123')
    })
  })

  describe('date/time helpers', () => {
    it('should provide $now helper', () => {
      const context = {}
      const result = parser.evaluate('{{ $now }}', context)
      expect(result).toBeInstanceOf(Date)
    })

    it('should provide $today helper', () => {
      const context = {}
      const result = parser.evaluate('{{ $today }}', context) as Date
      expect(result).toBeInstanceOf(Date)
      expect(result.getHours()).toBe(0)
      expect(result.getMinutes()).toBe(0)
    })
  })
})

// =============================================================================
// NODE TYPE TESTS
// =============================================================================

describe('HttpRequestNode', () => {
  let node: HttpRequestNode

  beforeEach(() => {
    node = new HttpRequestNode()
  })

  it('should have correct description', () => {
    expect(node.description.displayName).toBe('HTTP Request')
    expect(node.description.name).toBe('httpRequest')
    expect(node.description.group).toContain('transform')
    expect(node.description.inputs).toContain('main')
    expect(node.description.outputs).toContain('main')
  })

  it('should have required properties', () => {
    const props = node.description.properties
    expect(props.find((p) => p.name === 'url')).toBeDefined()
    expect(props.find((p) => p.name === 'method')).toBeDefined()
  })

  it('should execute GET request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
      headers: new Headers({ 'content-type': 'application/json' }),
    })
    global.fetch = mockFetch

    const executeFunctions = createMockExecuteFunctions({
      url: 'https://api.example.com/data',
      method: 'GET',
    })

    const result = await node.execute.call(executeFunctions)

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(1)
    expect(result[0][0].json).toEqual({ success: true })
  })

  it('should execute POST request with body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ id: 123 }),
      headers: new Headers({ 'content-type': 'application/json' }),
    })
    global.fetch = mockFetch

    const executeFunctions = createMockExecuteFunctions({
      url: 'https://api.example.com/items',
      method: 'POST',
      body: { name: 'Test Item' },
    })

    const result = await node.execute.call(executeFunctions)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Test Item' }),
      })
    )
    expect(result[0][0].json).toEqual({ id: 123 })
  })

  it('should handle authentication headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      headers: new Headers({ 'content-type': 'application/json' }),
    })
    global.fetch = mockFetch

    const executeFunctions = createMockExecuteFunctions({
      url: 'https://api.example.com/data',
      method: 'GET',
      authentication: 'bearer',
    })
    executeFunctions.getCredentials = vi
      .fn()
      .mockResolvedValue({ token: 'my-secret-token' })

    await node.execute.call(executeFunctions)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-secret-token',
        }),
      })
    )
  })
})

describe('CodeNode', () => {
  let node: CodeNode

  beforeEach(() => {
    node = new CodeNode()
  })

  it('should have correct description', () => {
    expect(node.description.displayName).toBe('Code')
    expect(node.description.name).toBe('code')
    expect(node.description.group).toContain('transform')
  })

  it('should execute JavaScript code', async () => {
    const executeFunctions = createMockExecuteFunctions({
      language: 'javascript',
      code: 'return items.map(item => ({ json: { doubled: item.json.value * 2 } }))',
    })
    executeFunctions.getInputData = () => [{ json: { value: 5 } }]

    const result = await node.execute.call(executeFunctions)

    expect(result[0][0].json.doubled).toBe(10)
  })

  it('should provide $input helper in code', async () => {
    const executeFunctions = createMockExecuteFunctions({
      language: 'javascript',
      code: 'return [{ json: { first: $input.first().json.name } }]',
    })
    executeFunctions.getInputData = () => [{ json: { name: 'Alice' } }, { json: { name: 'Bob' } }]

    const result = await node.execute.call(executeFunctions)

    expect(result[0][0].json.first).toBe('Alice')
  })

  it('should handle code execution errors gracefully', async () => {
    const executeFunctions = createMockExecuteFunctions({
      language: 'javascript',
      code: 'throw new Error("Test error")',
    })

    await expect(node.execute.call(executeFunctions)).rejects.toThrow('Test error')
  })
})

describe('IfNode', () => {
  let node: IfNode

  beforeEach(() => {
    node = new IfNode()
  })

  it('should have correct description', () => {
    expect(node.description.displayName).toBe('IF')
    expect(node.description.name).toBe('if')
    expect(node.description.outputs).toHaveLength(2)
  })

  it('should route to true output when condition passes', async () => {
    const executeFunctions = createMockExecuteFunctions({
      conditions: {
        boolean: [
          { value1: '{{ $json.active }}', operation: 'equal', value2: true },
        ],
      },
    })
    executeFunctions.getInputData = () => [{ json: { active: true } }]

    const result = await node.execute.call(executeFunctions)

    expect(result[0]).toHaveLength(1) // true branch
    expect(result[1]).toHaveLength(0) // false branch
  })

  it('should route to false output when condition fails', async () => {
    const executeFunctions = createMockExecuteFunctions({
      conditions: {
        boolean: [
          { value1: '{{ $json.active }}', operation: 'equal', value2: true },
        ],
      },
    })
    executeFunctions.getInputData = () => [{ json: { active: false } }]

    const result = await node.execute.call(executeFunctions)

    expect(result[0]).toHaveLength(0) // true branch
    expect(result[1]).toHaveLength(1) // false branch
  })

  it('should support multiple conditions with AND', async () => {
    const executeFunctions = createMockExecuteFunctions({
      conditions: {
        boolean: [
          { value1: '{{ $json.age }}', operation: 'larger', value2: 18 },
          { value1: '{{ $json.verified }}', operation: 'equal', value2: true },
        ],
      },
      combineOperation: 'and',
    })
    executeFunctions.getInputData = () => [{ json: { age: 25, verified: true } }]

    const result = await node.execute.call(executeFunctions)

    expect(result[0]).toHaveLength(1)
  })
})

describe('SwitchNode', () => {
  let node: SwitchNode

  beforeEach(() => {
    node = new SwitchNode()
  })

  it('should have correct description', () => {
    expect(node.description.displayName).toBe('Switch')
    expect(node.description.name).toBe('switch')
  })

  it('should route based on value', async () => {
    const executeFunctions = createMockExecuteFunctions({
      mode: 'rules',
      rules: {
        values: [
          { conditions: [{ value1: '{{ $json.status }}', operation: 'equal', value2: 'pending' }], output: 0 },
          { conditions: [{ value1: '{{ $json.status }}', operation: 'equal', value2: 'active' }], output: 1 },
          { conditions: [{ value1: '{{ $json.status }}', operation: 'equal', value2: 'completed' }], output: 2 },
        ],
      },
      fallbackOutput: 3,
    })
    executeFunctions.getInputData = () => [{ json: { status: 'active' } }]

    const result = await node.execute.call(executeFunctions)

    expect(result[0]).toHaveLength(0) // output 0
    expect(result[1]).toHaveLength(1) // output 1 (active)
    expect(result[2]).toHaveLength(0) // output 2
    expect(result[3]).toHaveLength(0) // fallback
  })

  it('should use fallback when no rules match', async () => {
    const executeFunctions = createMockExecuteFunctions({
      mode: 'rules',
      rules: {
        values: [
          { conditions: [{ value1: '{{ $json.status }}', operation: 'equal', value2: 'known' }], output: 0 },
        ],
      },
      fallbackOutput: 1,
    })
    executeFunctions.getInputData = () => [{ json: { status: 'unknown' } }]

    const result = await node.execute.call(executeFunctions)

    expect(result[0]).toHaveLength(0)
    expect(result[1]).toHaveLength(1)
  })
})

describe('SetNode', () => {
  let node: SetNode

  beforeEach(() => {
    node = new SetNode()
  })

  it('should have correct description', () => {
    expect(node.description.displayName).toBe('Set')
    expect(node.description.name).toBe('set')
  })

  it('should set new fields', async () => {
    const executeFunctions = createMockExecuteFunctions({
      mode: 'manual',
      assignments: {
        values: [
          { name: 'fullName', value: 'John Doe', type: 'string' },
          { name: 'score', value: 100, type: 'number' },
        ],
      },
    })
    executeFunctions.getInputData = () => [{ json: {} }]

    const result = await node.execute.call(executeFunctions)

    expect(result[0][0].json.fullName).toBe('John Doe')
    expect(result[0][0].json.score).toBe(100)
  })

  it('should support expressions in values', async () => {
    const executeFunctions = createMockExecuteFunctions({
      mode: 'manual',
      assignments: {
        values: [
          { name: 'greeting', value: 'Hello, {{ $json.name }}!', type: 'string' },
        ],
      },
    })
    executeFunctions.getInputData = () => [{ json: { name: 'Alice' } }]

    const result = await node.execute.call(executeFunctions)

    expect(result[0][0].json.greeting).toBe('Hello, Alice!')
  })

  it('should preserve existing data in merge mode', async () => {
    const executeFunctions = createMockExecuteFunctions({
      mode: 'manual',
      keepOnlySet: false,
      assignments: {
        values: [{ name: 'new', value: 'value', type: 'string' }],
      },
    })
    executeFunctions.getInputData = () => [{ json: { existing: 'data' } }]

    const result = await node.execute.call(executeFunctions)

    expect(result[0][0].json.existing).toBe('data')
    expect(result[0][0].json.new).toBe('value')
  })
})

describe('MergeNode', () => {
  let node: MergeNode

  beforeEach(() => {
    node = new MergeNode()
  })

  it('should have correct description', () => {
    expect(node.description.displayName).toBe('Merge')
    expect(node.description.name).toBe('merge')
    expect(node.description.inputs).toHaveLength(2)
  })

  it('should append inputs in append mode', async () => {
    const executeFunctions = createMockMergeExecuteFunctions({
      mode: 'append',
    })

    const result = await node.execute.call(executeFunctions)

    expect(result[0]).toHaveLength(4) // 2 + 2 items
  })

  it('should combine by position in combine mode', async () => {
    const executeFunctions = createMockMergeExecuteFunctions({
      mode: 'combine',
      combinationMode: 'mergeByPosition',
    })

    const result = await node.execute.call(executeFunctions)

    expect(result[0][0].json).toEqual({ a: 1, b: 3 }) // merged
    expect(result[0][1].json).toEqual({ a: 2, b: 4 })
  })

  it('should combine by key in merge mode', async () => {
    const executeFunctions = createMockMergeExecuteFunctions({
      mode: 'combine',
      combinationMode: 'mergeByKey',
      joinKey: 'id',
    })
    executeFunctions.getInputData = (inputIndex: number) => {
      if (inputIndex === 0) {
        return [{ json: { id: 1, name: 'Alice' } }, { json: { id: 2, name: 'Bob' } }]
      }
      return [{ json: { id: 1, age: 30 } }, { json: { id: 2, age: 25 } }]
    }

    const result = await node.execute.call(executeFunctions)

    expect(result[0][0].json).toEqual({ id: 1, name: 'Alice', age: 30 })
    expect(result[0][1].json).toEqual({ id: 2, name: 'Bob', age: 25 })
  })
})

// =============================================================================
// TRIGGER NODE TESTS
// =============================================================================

describe('WebhookTrigger', () => {
  let trigger: WebhookTrigger

  beforeEach(() => {
    trigger = new WebhookTrigger()
  })

  it('should have correct description', () => {
    expect(trigger.description.displayName).toBe('Webhook')
    expect(trigger.description.name).toBe('webhook')
    expect(trigger.description.group).toContain('trigger')
    expect(trigger.description.inputs).toHaveLength(0)
    expect(trigger.description.outputs).toContain('main')
  })

  it('should have webhook configuration', () => {
    expect(trigger.description.webhooks).toBeDefined()
    expect(trigger.description.webhooks![0].httpMethod).toBe('POST')
  })

  it('should handle webhook request', async () => {
    const triggerFunctions = createMockTriggerFunctions({
      path: '/webhook/test',
      httpMethod: 'POST',
    })
    triggerFunctions.getRequestObject = vi.fn().mockReturnValue({
      body: { event: 'user.created', data: { id: 123 } },
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    const result = await trigger.webhook.call(triggerFunctions)

    expect(result.workflowData).toBeDefined()
    expect(result.workflowData![0][0].json).toEqual({
      event: 'user.created',
      data: { id: 123 },
    })
  })
})

describe('CronTrigger', () => {
  let trigger: CronTrigger

  beforeEach(() => {
    trigger = new CronTrigger()
  })

  it('should have correct description', () => {
    expect(trigger.description.displayName).toBe('Schedule Trigger')
    expect(trigger.description.name).toBe('scheduleTrigger')
    expect(trigger.description.group).toContain('trigger')
  })

  it('should have cron expression property', () => {
    const cronProp = trigger.description.properties.find((p) => p.name === 'cronExpression')
    expect(cronProp).toBeDefined()
    expect(cronProp!.type).toBe('string')
  })
})

describe('ManualTrigger', () => {
  let trigger: ManualTrigger

  beforeEach(() => {
    trigger = new ManualTrigger()
  })

  it('should have correct description', () => {
    expect(trigger.description.displayName).toBe('Manual Trigger')
    expect(trigger.description.name).toBe('manualTrigger')
    expect(trigger.description.group).toContain('trigger')
  })

  it('should pass through execution', async () => {
    const executeFunctions = createMockExecuteFunctions({})
    executeFunctions.getInputData = () => [{ json: { manual: true } }]

    const result = await trigger.execute.call(executeFunctions)

    expect(result[0][0].json.manual).toBe(true)
  })
})

// =============================================================================
// CREDENTIAL TESTS
// =============================================================================

describe('CredentialManager', () => {
  let manager: CredentialManager

  beforeEach(() => {
    manager = new CredentialManager()
  })

  it('should store and retrieve credentials', async () => {
    await manager.store('api-cred-1', 'apiKey', { apiKey: 'secret-123' })

    const cred = await manager.get('api-cred-1')

    expect(cred).toBeDefined()
    expect(cred!.type).toBe('apiKey')
  })

  it('should encrypt credentials at rest', async () => {
    await manager.store('secret-cred', 'apiKey', { apiKey: 'my-secret' })

    const encrypted = manager.getEncrypted('secret-cred')

    expect(encrypted).not.toContain('my-secret')
  })

  it('should decrypt credentials when retrieved', async () => {
    await manager.store('secret-cred', 'apiKey', { apiKey: 'my-secret' })

    const cred = await manager.get('secret-cred')

    expect(cred!.data.apiKey).toBe('my-secret')
  })

  it('should support different credential types', async () => {
    await manager.store('oauth-cred', 'oauth2', {
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      expiresAt: Date.now() + 3600000,
    })

    const cred = await manager.get('oauth-cred')

    expect(cred!.type).toBe('oauth2')
    expect(cred!.data.accessToken).toBe('access-123')
  })

  it('should delete credentials', async () => {
    await manager.store('temp-cred', 'apiKey', { apiKey: 'temp' })
    await manager.delete('temp-cred')

    const cred = await manager.get('temp-cred')

    expect(cred).toBeUndefined()
  })

  it('should list all credential IDs', async () => {
    await manager.store('cred-1', 'apiKey', { apiKey: 'a' })
    await manager.store('cred-2', 'apiKey', { apiKey: 'b' })

    const ids = manager.list()

    expect(ids).toContain('cred-1')
    expect(ids).toContain('cred-2')
  })
})

// =============================================================================
// WORKFLOW TESTS
// =============================================================================

describe('Workflow', () => {
  it('should parse n8n workflow JSON', () => {
    const workflowJson: IWorkflowData = {
      name: 'Test Workflow',
      nodes: [
        {
          id: 'node1',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [250, 300],
          parameters: { path: '/test' },
        },
        {
          id: 'node2',
          name: 'HTTP Request',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 1,
          position: [450, 300],
          parameters: { url: 'https://api.example.com' },
        },
      ],
      connections: {
        Webhook: {
          main: [[{ node: 'HTTP Request', type: 'main', index: 0 }]],
        },
      },
    }

    const workflow = new Workflow(workflowJson)

    expect(workflow.name).toBe('Test Workflow')
    expect(workflow.nodes).toHaveLength(2)
    expect(workflow.getNode('node1')).toBeDefined()
    expect(workflow.getNode('node2')).toBeDefined()
  })

  it('should validate workflow structure', () => {
    const invalidWorkflow: IWorkflowData = {
      name: 'Invalid',
      nodes: [],
      connections: {},
    }

    expect(() => new Workflow(invalidWorkflow)).toThrow(/must have at least one node/)
  })

  it('should detect cycles in workflow', () => {
    const cyclicWorkflow: IWorkflowData = {
      name: 'Cyclic',
      nodes: [
        { id: 'a', name: 'A', type: 'test', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'b', name: 'B', type: 'test', typeVersion: 1, position: [0, 0], parameters: {} },
      ],
      connections: {
        A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
        B: { main: [[{ node: 'A', type: 'main', index: 0 }]] },
      },
    }

    expect(() => new Workflow(cyclicWorkflow)).toThrow(/cycle detected/)
  })

  it('should get execution order (topological sort)', () => {
    const workflow = new Workflow({
      name: 'Linear',
      nodes: [
        { id: '1', name: 'Start', type: 'trigger', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: '2', name: 'Middle', type: 'transform', typeVersion: 1, position: [100, 0], parameters: {} },
        { id: '3', name: 'End', type: 'action', typeVersion: 1, position: [200, 0], parameters: {} },
      ],
      connections: {
        Start: { main: [[{ node: 'Middle', type: 'main', index: 0 }]] },
        Middle: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
      },
    })

    const order = workflow.getExecutionOrder()

    expect(order).toEqual(['1', '2', '3'])
  })

  it('should handle branching workflows', () => {
    const workflow = new Workflow({
      name: 'Branching',
      nodes: [
        { id: 'trigger', name: 'Trigger', type: 'webhook', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'if', name: 'IF', type: 'if', typeVersion: 1, position: [100, 0], parameters: {} },
        { id: 'true', name: 'True Branch', type: 'action', typeVersion: 1, position: [200, -50], parameters: {} },
        { id: 'false', name: 'False Branch', type: 'action', typeVersion: 1, position: [200, 50], parameters: {} },
      ],
      connections: {
        Trigger: { main: [[{ node: 'IF', type: 'main', index: 0 }]] },
        IF: {
          main: [
            [{ node: 'True Branch', type: 'main', index: 0 }],
            [{ node: 'False Branch', type: 'main', index: 0 }],
          ],
        },
      },
    })

    const order = workflow.getExecutionOrder()

    expect(order[0]).toBe('trigger')
    expect(order[1]).toBe('if')
    expect(order).toContain('true')
    expect(order).toContain('false')
  })
})

describe('WorkflowExecutor', () => {
  let executor: WorkflowExecutor
  let nodeRegistry: NodeRegistry

  beforeEach(() => {
    nodeRegistry = new NodeRegistry()
    nodeRegistry.register(new ManualTrigger())
    nodeRegistry.register(new SetNode())
    nodeRegistry.register(new HttpRequestNode())

    executor = new WorkflowExecutor(nodeRegistry)
  })

  it('should execute simple workflow', async () => {
    const workflow = new Workflow({
      name: 'Simple',
      nodes: [
        {
          id: 'trigger',
          name: 'Manual',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
        {
          id: 'set',
          name: 'Set',
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [200, 0],
          parameters: {
            mode: 'manual',
            assignments: { values: [{ name: 'result', value: 'success', type: 'string' }] },
          },
        },
      ],
      connections: {
        Manual: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
      },
    })

    const result = await executor.execute(workflow, { triggerData: [{ json: {} }] })

    expect(result.status).toBe('success')
    expect(result.data[0].json.result).toBe('success')
  })

  it('should pass data between nodes', async () => {
    const workflow = new Workflow({
      name: 'Data Flow',
      nodes: [
        {
          id: 'trigger',
          name: 'Manual',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
        {
          id: 'set1',
          name: 'Set 1',
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [200, 0],
          parameters: {
            mode: 'manual',
            assignments: { values: [{ name: 'step', value: 'first', type: 'string' }] },
          },
        },
        {
          id: 'set2',
          name: 'Set 2',
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [400, 0],
          parameters: {
            mode: 'manual',
            keepOnlySet: false,
            assignments: { values: [{ name: 'step', value: 'second', type: 'string' }] },
          },
        },
      ],
      connections: {
        Manual: { main: [[{ node: 'Set 1', type: 'main', index: 0 }]] },
        'Set 1': { main: [[{ node: 'Set 2', type: 'main', index: 0 }]] },
      },
    })

    const result = await executor.execute(workflow, { triggerData: [{ json: {} }] })

    expect(result.data[0].json.step).toBe('second')
  })

  it('should handle node execution errors', async () => {
    const workflow = new Workflow({
      name: 'Error',
      nodes: [
        {
          id: 'trigger',
          name: 'Manual',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
        {
          id: 'http',
          name: 'HTTP',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 1,
          position: [200, 0],
          parameters: { url: 'invalid-url', method: 'GET' },
        },
      ],
      connections: {
        Manual: { main: [[{ node: 'HTTP', type: 'main', index: 0 }]] },
      },
    })

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    global.fetch = mockFetch

    const result = await executor.execute(workflow, { triggerData: [{ json: {} }] })

    expect(result.status).toBe('error')
    expect(result.error).toContain('Network error')
  })

  it('should track node execution times', async () => {
    const workflow = new Workflow({
      name: 'Timing',
      nodes: [
        {
          id: 'trigger',
          name: 'Manual',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
        {
          id: 'set',
          name: 'Set',
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [200, 0],
          parameters: { mode: 'manual', assignments: { values: [] } },
        },
      ],
      connections: {
        Manual: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
      },
    })

    const result = await executor.execute(workflow, { triggerData: [{ json: {} }] })

    expect(result.executionTime).toBeGreaterThanOrEqual(0)
    expect(result.nodeExecutions['trigger']).toBeDefined()
    expect(result.nodeExecutions['set']).toBeDefined()
    expect(result.nodeExecutions['trigger'].executionTime).toBeGreaterThanOrEqual(0)
  })
})

// =============================================================================
// NODE REGISTRY TESTS
// =============================================================================

describe('NodeRegistry', () => {
  let registry: NodeRegistry

  beforeEach(() => {
    registry = new NodeRegistry()
  })

  it('should register and retrieve nodes', () => {
    const httpNode = new HttpRequestNode()
    registry.register(httpNode)

    const retrieved = registry.get('httpRequest')

    expect(retrieved).toBe(httpNode)
  })

  it('should list all registered nodes', () => {
    registry.register(new HttpRequestNode())
    registry.register(new CodeNode())
    registry.register(new IfNode())

    const nodes = registry.list()

    expect(nodes).toContain('httpRequest')
    expect(nodes).toContain('code')
    expect(nodes).toContain('if')
  })

  it('should return undefined for unknown nodes', () => {
    const node = registry.get('unknown')

    expect(node).toBeUndefined()
  })

  it('should throw on duplicate registration', () => {
    registry.register(new HttpRequestNode())

    expect(() => registry.register(new HttpRequestNode())).toThrow(/already registered/)
  })
})

// =============================================================================
// TEST HELPERS
// =============================================================================

function createMockExecuteFunctions(parameters: Record<string, unknown>): IExecuteFunctions {
  return {
    getNodeParameter: vi.fn((name: string, _itemIndex: number) => parameters[name]),
    getInputData: vi.fn(() => [{ json: {} }]),
    getCredentials: vi.fn().mockResolvedValue({}),
    helpers: {
      request: vi.fn(),
      httpRequest: vi.fn(),
    },
    getNode: vi.fn(() => ({ name: 'Test Node' })),
    continueOnFail: vi.fn(() => false),
    getWorkflowDataProxy: vi.fn(() => ({})),
    evaluateExpression: vi.fn((expr: string) => expr),
  } as unknown as IExecuteFunctions
}

function createMockTriggerFunctions(parameters: Record<string, unknown>): ITriggerFunctions {
  return {
    getNodeParameter: vi.fn((name: string) => parameters[name]),
    getRequestObject: vi.fn(),
    getResponseObject: vi.fn(),
    getCredentials: vi.fn().mockResolvedValue({}),
    helpers: {
      httpRequest: vi.fn(),
    },
  } as unknown as ITriggerFunctions
}

function createMockMergeExecuteFunctions(parameters: Record<string, unknown>): IExecuteFunctions {
  return {
    getNodeParameter: vi.fn((name: string) => parameters[name]),
    getInputData: vi.fn((inputIndex?: number) => {
      if (inputIndex === 0) {
        return [{ json: { a: 1 } }, { json: { a: 2 } }]
      }
      return [{ json: { b: 3 } }, { json: { b: 4 } }]
    }),
    getCredentials: vi.fn().mockResolvedValue({}),
    helpers: {},
    getNode: vi.fn(() => ({ name: 'Merge' })),
    continueOnFail: vi.fn(() => false),
  } as unknown as IExecuteFunctions
}
