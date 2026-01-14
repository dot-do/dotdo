/**
 * n8n TriggerEngine Bridge
 *
 * Connects n8n's node/workflow trigger system to dotdo's TriggerEngine primitive
 * for unified trigger handling, deduplication, and monitoring.
 */

import type {
  INodeType,
  INodeTypeDescription,
  INodeExecutionData,
  IExecuteFunctions,
  ITriggerFunctions,
} from './types'
import {
  TriggerEngine,
  type TriggerContext,
  type TriggerOutput,
  type WebhookConfig,
  type PollingConfig,
  type ScheduleConfig,
} from '../../primitives/trigger-engine'

// =============================================================================
// TYPES
// =============================================================================

/** Node registration options */
export interface NodeRegistrationOptions {
  /** Unique node ID */
  nodeId: string
  /** Node parameters */
  parameters?: Record<string, unknown>
  /** Workflow ID */
  workflowId?: string
  /** Workflow name */
  workflowName?: string
  /** Credentials */
  credentials?: Record<string, Record<string, unknown>>
}

/** Polling node registration options */
export interface PollingNodeRegistrationOptions extends NodeRegistrationOptions {
  /** ID field for deduplication */
  idField?: string
}

/** Webhook bridge options */
export interface N8nWebhookBridgeOptions {
  /** Webhook secret for HMAC validation */
  webhookSecret?: string
  /** Header containing signature */
  signatureHeader?: string
  /** Signature algorithm */
  signatureAlgorithm?: 'sha256' | 'sha1'
}

/** Polling bridge options */
export interface N8nPollingBridgeOptions {
  /** ID field for deduplication */
  idField?: string
  /** Default polling interval in ms */
  intervalMs?: number
  /** Minimum interval between polls */
  minIntervalMs?: number
}

/** Schedule bridge options */
export interface N8nScheduleBridgeOptions {
  /** Default timezone */
  defaultTimezone?: string
}

/** Registered node metadata */
interface NodeMetadata {
  triggerId: string
  node: INodeType
  nodeId: string
  parameters: Record<string, unknown>
  workflowId?: string
  workflowName?: string
  credentials?: Record<string, Record<string, unknown>>
  seenIds: Set<string>
  staticData: Record<string, unknown>
}

/** Trigger callback type */
type TriggerCallback = (data: INodeExecutionData[]) => void

// =============================================================================
// N8N TRIGGER BRIDGE
// =============================================================================

/**
 * Main bridge connecting n8n trigger nodes to TriggerEngine
 */
export class N8nTriggerBridge {
  protected engine: TriggerEngine
  protected nodes = new Map<string, NodeMetadata>()
  protected callbacks = new Map<string, Set<TriggerCallback>>()

  constructor(engine: TriggerEngine) {
    this.engine = engine
  }

  /**
   * Register an n8n trigger node with TriggerEngine
   */
  async registerNode(node: INodeType, options: NodeRegistrationOptions): Promise<string> {
    const { nodeId, parameters = {}, workflowId, workflowName, credentials } = options
    const triggerId = `n8n-${node.description.name}-${nodeId}-${Date.now()}`

    // Store metadata
    this.nodes.set(triggerId, {
      triggerId,
      node,
      nodeId,
      parameters,
      workflowId,
      workflowName,
      credentials,
      seenIds: new Set(),
      staticData: {},
    })

    // Register based on node type
    const group = node.description.group || []
    if (group.includes('trigger')) {
      // Check for webhook definition
      if (node.description.webhooks && node.description.webhooks.length > 0) {
        await this.registerWebhookNode(triggerId, node, options)
      } else if (node.description.name === 'scheduleTrigger' || node.description.name === 'cron') {
        await this.registerScheduleNode(triggerId, node, options)
      } else {
        // Generic trigger - treat as manual
        await this.registerManualNode(triggerId, node, options)
      }
    }

    return triggerId
  }

  /**
   * Register a webhook trigger node
   */
  protected async registerWebhookNode(
    triggerId: string,
    node: INodeType,
    options: NodeRegistrationOptions
  ): Promise<void> {
    const webhookDef = node.description.webhooks?.[0]
    const path = (options.parameters?.path as string) || webhookDef?.path || `/webhook/${options.nodeId}`

    const webhookConfig: WebhookConfig = {
      path,
    }

    this.engine.webhook(triggerId, webhookConfig, async (ctx: TriggerContext): Promise<TriggerOutput> => {
      return {
        success: true,
        triggerId,
        timestamp: ctx.timestamp,
        source: 'webhook',
        data: ctx.data,
        context: {
          n8n: {
            nodeId: options.nodeId,
            nodeName: node.description.displayName,
            nodeType: `n8n-nodes-base.${node.description.name}`,
            workflowId: options.workflowId,
            workflowName: options.workflowName,
          },
        },
      }
    })
  }

  /**
   * Register a schedule trigger node
   */
  protected async registerScheduleNode(
    triggerId: string,
    node: INodeType,
    options: NodeRegistrationOptions
  ): Promise<void> {
    const cron = (options.parameters?.cronExpression as string) || '0 * * * *'
    const timezone = (options.parameters?.timezone as string) || 'UTC'

    const scheduleConfig: ScheduleConfig = {
      cron,
      timezone,
    }

    this.engine.registry.register({
      id: triggerId,
      type: 'schedule',
      config: scheduleConfig,
      enabled: true,
      handler: async (ctx) => ({
        success: true,
        triggerId,
        timestamp: ctx.timestamp,
        source: 'schedule',
        data: { timestamp: ctx.timestamp },
        context: {
          n8n: {
            nodeId: options.nodeId,
            nodeName: node.description.displayName,
            nodeType: `n8n-nodes-base.${node.description.name}`,
          },
        },
      }),
    })
  }

  /**
   * Register a manual trigger node
   */
  protected async registerManualNode(
    triggerId: string,
    node: INodeType,
    options: NodeRegistrationOptions
  ): Promise<void> {
    this.engine.registry.register({
      id: triggerId,
      type: 'event',
      config: { eventName: `n8n.manual.${options.nodeId}` },
      enabled: true,
      handler: async (ctx) => ({
        success: true,
        triggerId,
        timestamp: ctx.timestamp,
        source: 'event',
        data: ctx.data,
        context: {
          n8n: {
            nodeId: options.nodeId,
            nodeName: node.description.displayName,
            nodeType: `n8n-nodes-base.${node.description.name}`,
          },
        },
      }),
    })
  }

  /**
   * Handle incoming webhook
   */
  async handleWebhook(triggerId: string, request: Request): Promise<TriggerOutput> {
    const metadata = this.nodes.get(triggerId)
    if (!metadata) {
      return {
        success: false,
        error: `Unknown trigger: ${triggerId}`,
        triggerId,
        timestamp: Date.now(),
        source: 'webhook',
        data: null,
      }
    }

    const webhookDef = metadata.node.description.webhooks?.[0]
    const path = (metadata.parameters.path as string) || webhookDef?.path || `/webhook/${metadata.nodeId}`

    const result = await this.engine.handleWebhook(request, path)

    if (result.success) {
      // Emit event
      this.engine.events.emit('n8n.trigger.fired', {
        triggerId,
        nodeType: `n8n-nodes-base.${metadata.node.description.name}`,
        timestamp: Date.now(),
      })

      // Notify callbacks
      const executionData = this.toExecutionData(result.data)
      const callbacks = this.callbacks.get(triggerId)
      if (callbacks) {
        for (const callback of callbacks) {
          try {
            callback(executionData)
          } catch {
            // Continue
          }
        }
      }
    }

    return result
  }

  /**
   * Handle webhook and return as n8n execution data
   */
  async handleWebhookAsExecutionData(
    triggerId: string,
    request: Request
  ): Promise<INodeExecutionData[]> {
    const result = await this.handleWebhook(triggerId, request)
    return this.toExecutionData(result.data)
  }

  /**
   * Handle webhook and return raw TriggerOutput
   */
  async handleWebhookRaw(triggerId: string, request: Request): Promise<TriggerOutput> {
    return this.handleWebhook(triggerId, request)
  }

  /**
   * Subscribe to trigger events
   */
  onTrigger(triggerId: string, callback: TriggerCallback): () => void {
    let callbacks = this.callbacks.get(triggerId)
    if (!callbacks) {
      callbacks = new Set()
      this.callbacks.set(triggerId, callbacks)
    }
    callbacks.add(callback)

    return () => {
      callbacks?.delete(callback)
    }
  }

  /**
   * Convert data to n8n execution data format
   */
  protected toExecutionData(data: unknown): INodeExecutionData[] {
    if (Array.isArray(data)) {
      return data.map((item) => ({
        json: typeof item === 'object' && item !== null ? item as Record<string, unknown> : { data: item },
      }))
    }
    if (typeof data === 'object' && data !== null) {
      return [{ json: data as Record<string, unknown> }]
    }
    return [{ json: { data } }]
  }

  /**
   * Get the underlying TriggerEngine
   */
  getEngine(): TriggerEngine {
    return this.engine
  }
}

// =============================================================================
// N8N WEBHOOK BRIDGE
// =============================================================================

/**
 * Specialized bridge for n8n webhook trigger nodes
 */
export class N8nWebhookBridge extends N8nTriggerBridge {
  private options: N8nWebhookBridgeOptions

  constructor(engine: TriggerEngine, options: N8nWebhookBridgeOptions = {}) {
    super(engine)
    this.options = options
  }

  /**
   * Register a webhook trigger node with additional security options
   */
  override async registerNode(
    node: INodeType,
    options: NodeRegistrationOptions
  ): Promise<string> {
    const triggerId = `n8n-webhook-${options.nodeId}-${Date.now()}`
    const webhookDef = node.description.webhooks?.[0]
    const path = (options.parameters?.path as string) || webhookDef?.path || `/webhook/${options.nodeId}`

    // Store metadata
    this.nodes.set(triggerId, {
      triggerId,
      node,
      nodeId: options.nodeId,
      parameters: options.parameters || {},
      workflowId: options.workflowId,
      workflowName: options.workflowName,
      credentials: options.credentials,
      seenIds: new Set(),
      staticData: {},
    })

    // Register with TriggerEngine with security options
    const webhookConfig: WebhookConfig = {
      path,
      secret: this.options.webhookSecret,
      signatureHeader: this.options.signatureHeader,
      signatureAlgorithm: this.options.signatureAlgorithm,
    }

    this.engine.webhook(triggerId, webhookConfig, async (ctx: TriggerContext): Promise<TriggerOutput> => {
      return {
        success: true,
        triggerId,
        timestamp: ctx.timestamp,
        source: 'webhook',
        data: ctx.data,
        context: {
          n8n: {
            nodeId: options.nodeId,
            nodeName: node.description.displayName,
            nodeType: `n8n-nodes-base.${node.description.name}`,
            workflowId: options.workflowId,
            workflowName: options.workflowName,
          },
        },
      }
    })

    return triggerId
  }
}

// =============================================================================
// N8N SCHEDULE BRIDGE
// =============================================================================

/**
 * Specialized bridge for n8n schedule/cron trigger nodes
 */
export class N8nScheduleBridge extends N8nTriggerBridge {
  private options: N8nScheduleBridgeOptions
  private scheduleConfigs = new Map<string, ScheduleConfig>()

  constructor(engine: TriggerEngine, options: N8nScheduleBridgeOptions = {}) {
    super(engine)
    this.options = {
      defaultTimezone: 'UTC',
      ...options,
    }
  }

  /**
   * Register a schedule trigger node
   */
  override async registerNode(
    node: INodeType,
    options: NodeRegistrationOptions
  ): Promise<string> {
    const triggerId = `n8n-schedule-${options.nodeId}-${Date.now()}`

    const cron = (options.parameters?.cronExpression as string) || '0 * * * *'
    const timezone = (options.parameters?.timezone as string) || this.options.defaultTimezone!

    // Store metadata
    this.nodes.set(triggerId, {
      triggerId,
      node,
      nodeId: options.nodeId,
      parameters: options.parameters || {},
      workflowId: options.workflowId,
      workflowName: options.workflowName,
      seenIds: new Set(),
      staticData: {},
    })

    // Store schedule config
    const scheduleConfig: ScheduleConfig = { cron, timezone }
    this.scheduleConfigs.set(triggerId, scheduleConfig)

    // Register with TriggerEngine
    this.engine.registry.register({
      id: triggerId,
      type: 'schedule',
      config: scheduleConfig,
      enabled: true,
      handler: async (ctx) => ({
        success: true,
        triggerId,
        timestamp: ctx.timestamp,
        source: 'schedule',
        data: { timestamp: ctx.timestamp },
        context: {
          n8n: {
            nodeId: options.nodeId,
            nodeName: node.description.displayName,
            nodeType: `n8n-nodes-base.${node.description.name}`,
          },
        },
      }),
    })

    return triggerId
  }

  /**
   * Get schedule configuration
   */
  getScheduleConfig(triggerId: string): ScheduleConfig {
    const config = this.scheduleConfigs.get(triggerId)
    if (!config) {
      throw new Error(`Unknown schedule trigger: ${triggerId}`)
    }
    return config
  }

  /**
   * Manually fire a scheduled trigger
   */
  async fireTrigger(triggerId: string): Promise<void> {
    const metadata = this.nodes.get(triggerId)
    if (!metadata) {
      throw new Error(`Unknown trigger: ${triggerId}`)
    }

    const executionData: INodeExecutionData[] = [
      { json: { timestamp: Date.now() } },
    ]

    // Notify callbacks
    const callbacks = this.callbacks.get(triggerId)
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(executionData)
        } catch {
          // Continue
        }
      }
    }
  }
}

// =============================================================================
// N8N POLLING BRIDGE
// =============================================================================

/** Polling node with poll method */
interface PollingNode extends INodeType {
  poll: (context: { staticData: Record<string, unknown>; credentials?: Record<string, unknown> }) => Promise<INodeExecutionData[][]>
}

/**
 * Specialized bridge for n8n polling trigger nodes
 */
export class N8nPollingBridge extends N8nTriggerBridge {
  private options: N8nPollingBridgeOptions
  private pollingNodes = new Map<string, PollingNode>()

  constructor(engine: TriggerEngine, options: N8nPollingBridgeOptions = {}) {
    super(engine)
    this.options = {
      idField: 'id',
      intervalMs: 60_000,
      minIntervalMs: 5_000,
      ...options,
    }
  }

  /**
   * Register a polling node
   */
  async registerPollingNode(
    node: PollingNode,
    options: PollingNodeRegistrationOptions
  ): Promise<string> {
    const triggerId = `n8n-poll-${options.nodeId || node.description.name}-${Date.now()}`

    // Store metadata
    this.nodes.set(triggerId, {
      triggerId,
      node,
      nodeId: options.nodeId,
      parameters: options.parameters || {},
      workflowId: options.workflowId,
      workflowName: options.workflowName,
      credentials: options.credentials,
      seenIds: new Set(),
      staticData: {},
    })

    this.pollingNodes.set(triggerId, node)

    // Register with TriggerEngine polling scheduler
    const pollingConfig: PollingConfig = {
      url: '', // n8n polling doesn't use direct URL
      intervalMs: this.options.intervalMs!,
      minIntervalMs: this.options.minIntervalMs,
      idField: options.idField || this.options.idField,
    }

    this.engine.polling.register(triggerId, pollingConfig)

    // Register with registry
    this.engine.registry.register({
      id: triggerId,
      type: 'polling',
      config: pollingConfig,
      enabled: true,
      handler: async (ctx) => ({
        success: true,
        triggerId,
        timestamp: ctx.timestamp,
        source: 'polling',
        data: ctx.data,
        context: {
          n8n: {
            nodeId: options.nodeId,
            nodeName: node.description.displayName,
            nodeType: `n8n-nodes-base.${node.description.name}`,
          },
        },
      }),
    })

    return triggerId
  }

  /**
   * Execute polling
   */
  async poll(triggerId: string): Promise<INodeExecutionData[]> {
    const metadata = this.nodes.get(triggerId)
    const pollingNode = this.pollingNodes.get(triggerId)

    if (!metadata || !pollingNode) {
      throw new Error(`Unknown polling trigger: ${triggerId}`)
    }

    try {
      // Execute poll function
      const results = await pollingNode.poll({
        staticData: metadata.staticData,
        credentials: metadata.credentials,
      })

      // Flatten results (n8n poll returns INodeExecutionData[][])
      const flatResults = results.flat()

      // Update stats
      const stats = this.engine.getStats(triggerId)
      stats.fireCount++
      stats.successCount++
      stats.lastFiredAt = Date.now()

      // Deduplicate
      const idField = this.options.idField || 'id'
      const newItems = flatResults.filter((item) => {
        const id = String(item.json[idField] ?? '')
        if (metadata.seenIds.has(id)) {
          return false
        }
        metadata.seenIds.add(id)
        return true
      })

      // Notify callbacks
      const callbacks = this.callbacks.get(triggerId)
      if (callbacks) {
        for (const callback of callbacks) {
          try {
            callback(newItems)
          } catch {
            // Continue
          }
        }
      }

      return newItems
    } catch (error) {
      // Update stats
      const stats = this.engine.getStats(triggerId)
      stats.fireCount++
      stats.failureCount++
      throw error
    }
  }

  /**
   * Get static data for a trigger
   */
  async getStaticData(triggerId: string): Promise<Record<string, unknown>> {
    const metadata = this.nodes.get(triggerId)
    if (!metadata) {
      throw new Error(`Unknown trigger: ${triggerId}`)
    }
    return metadata.staticData
  }

  /**
   * Set static data for a trigger
   */
  async setStaticData(triggerId: string, data: Record<string, unknown>): Promise<void> {
    const metadata = this.nodes.get(triggerId)
    if (!metadata) {
      throw new Error(`Unknown trigger: ${triggerId}`)
    }
    Object.assign(metadata.staticData, data)
  }
}

// =============================================================================
// N8N WORKFLOW BRIDGE
// =============================================================================

import { Workflow, WorkflowExecutor } from './workflow'

/**
 * Bridge connecting n8n workflows to TriggerEngine
 */
export class N8nWorkflowBridge extends N8nTriggerBridge {
  private workflows = new Map<string, Workflow>()
  private executor: WorkflowExecutor

  constructor(engine: TriggerEngine) {
    super(engine)
    this.executor = new WorkflowExecutor()
  }

  /**
   * Register a workflow with its trigger nodes
   */
  async registerWorkflow(workflow: Workflow): Promise<string> {
    const workflowId = `n8n-workflow-${workflow.name}-${Date.now()}`

    this.workflows.set(workflowId, workflow)

    // Find trigger nodes
    const triggerNodes = workflow.nodes.filter((node) => {
      const nodeType = node.type.replace('n8n-nodes-base.', '')
      return ['webhook', 'scheduleTrigger', 'cron', 'manualTrigger'].includes(nodeType)
    })

    // Register each trigger
    for (const node of triggerNodes) {
      const nodeType = node.type.replace('n8n-nodes-base.', '')

      // Create a basic node implementation for registration
      const nodeImpl: INodeType = {
        description: {
          displayName: node.name,
          name: nodeType,
          group: ['trigger'],
          version: 1,
          inputs: [],
          outputs: ['main'],
          webhooks: nodeType === 'webhook' ? [{ name: 'default', httpMethod: 'POST', path: node.parameters?.path as string || '/webhook' }] : undefined,
        },
      }

      await this.registerNode(nodeImpl, {
        nodeId: node.id,
        parameters: node.parameters as Record<string, unknown>,
        workflowId,
        workflowName: workflow.name,
      })
    }

    return workflowId
  }

  /**
   * Trigger a workflow via webhook
   */
  async triggerWorkflow(workflowId: string, request: Request): Promise<TriggerOutput> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      return {
        success: false,
        error: `Unknown workflow: ${workflowId}`,
        triggerId: workflowId,
        timestamp: Date.now(),
        source: 'webhook',
        data: null,
      }
    }

    try {
      // Parse request body
      const contentType = request.headers.get('content-type') || ''
      let triggerData: unknown
      if (contentType.includes('application/json')) {
        triggerData = await request.json()
      } else {
        triggerData = await request.text()
      }

      // Execute workflow
      const result = await this.executor.execute(workflow, {
        triggerData: [{ json: triggerData as Record<string, unknown> }],
      })

      // Check if workflow execution failed
      if (result.status === 'error') {
        return {
          success: false,
          error: result.error || 'Workflow execution failed',
          triggerId: workflowId,
          timestamp: Date.now(),
          source: 'webhook',
          data: null,
        }
      }

      // result.data is INodeExecutionData[] - get the last item's json or merge all
      const outputData = result.data
      if (outputData.length === 0) {
        // No output data - return the trigger data as the output
        return {
          success: true,
          triggerId: workflowId,
          timestamp: Date.now(),
          source: 'webhook',
          data: triggerData,
        }
      }

      // Return the last item's json (or merged if multiple)
      const finalOutput = outputData.length === 1
        ? outputData[0].json
        : outputData.map((d) => d.json)

      return {
        success: true,
        triggerId: workflowId,
        timestamp: Date.now(),
        source: 'webhook',
        data: finalOutput,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        triggerId: workflowId,
        timestamp: Date.now(),
        source: 'webhook',
        data: null,
      }
    }
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { TriggerEngine, createHmacSignature } from '../../primitives/trigger-engine'
