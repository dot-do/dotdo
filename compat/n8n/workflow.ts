/**
 * n8n Workflow Execution Engine
 *
 * DAG-based workflow execution with branching support.
 */

import type {
  IWorkflowData,
  IWorkflowNode,
  IConnections,
  INodeExecutionData,
  IExecuteFunctions,
  IExecutionResult,
  INodeExecutionInfo,
  INodeType,
  IExpressionContext,
} from './types'
import { ExpressionParser } from './expression'
import { NodeRegistry } from './registry'

// =============================================================================
// WORKFLOW CLASS
// =============================================================================

/**
 * Workflow definition and validation.
 *
 * Parses n8n workflow JSON and provides methods for:
 * - Node lookup
 * - Execution order calculation (topological sort)
 * - Cycle detection
 */
export class Workflow {
  readonly name: string
  readonly nodes: IWorkflowNode[]
  readonly connections: IConnections
  readonly settings: IWorkflowData['settings']

  private nodeMap: Map<string, IWorkflowNode> = new Map()
  private nodeNameToId: Map<string, string> = new Map()

  constructor(data: IWorkflowData) {
    // Validate
    if (!data.nodes || data.nodes.length === 0) {
      throw new Error('Workflow must have at least one node')
    }

    this.name = data.name
    this.nodes = data.nodes
    this.connections = data.connections
    this.settings = data.settings

    // Build lookup maps
    for (const node of data.nodes) {
      this.nodeMap.set(node.id, node)
      this.nodeNameToId.set(node.name, node.id)
    }

    // Detect cycles
    this.detectCycles()
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): IWorkflowNode | undefined {
    return this.nodeMap.get(id)
  }

  /**
   * Get a node by name
   */
  getNodeByName(name: string): IWorkflowNode | undefined {
    const id = this.nodeNameToId.get(name)
    return id ? this.nodeMap.get(id) : undefined
  }

  /**
   * Get node ID from name
   */
  getNodeId(name: string): string | undefined {
    return this.nodeNameToId.get(name)
  }

  /**
   * Get execution order using topological sort
   */
  getExecutionOrder(): string[] {
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    // Initialize
    for (const node of this.nodes) {
      inDegree.set(node.id, 0)
      adjacency.set(node.id, [])
    }

    // Build adjacency list and in-degrees from connections
    for (const [sourceName, nodeConnections] of Object.entries(this.connections)) {
      const sourceId = this.nodeNameToId.get(sourceName)
      if (!sourceId) continue

      for (const outputConnections of nodeConnections.main) {
        for (const connection of outputConnections) {
          const targetId = this.nodeNameToId.get(connection.node)
          if (targetId) {
            adjacency.get(sourceId)!.push(targetId)
            inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1)
          }
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = []
    const result: string[] = []

    // Find all nodes with no incoming edges
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId)
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!
      result.push(current)

      for (const neighbor of adjacency.get(current) || []) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1)
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor)
        }
      }
    }

    return result
  }

  /**
   * Detect cycles in the workflow graph
   */
  private detectCycles(): void {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const hasCycle = (nodeId: string): boolean => {
      visited.add(nodeId)
      recursionStack.add(nodeId)

      const node = this.nodeMap.get(nodeId)
      if (!node) return false

      const connections = this.connections[node.name]?.main || []
      for (const outputConnections of connections) {
        for (const connection of outputConnections) {
          const targetId = this.nodeNameToId.get(connection.node)
          if (!targetId) continue

          if (!visited.has(targetId)) {
            if (hasCycle(targetId)) return true
          } else if (recursionStack.has(targetId)) {
            return true
          }
        }
      }

      recursionStack.delete(nodeId)
      return false
    }

    for (const node of this.nodes) {
      if (!visited.has(node.id)) {
        if (hasCycle(node.id)) {
          throw new Error('Workflow cycle detected')
        }
      }
    }
  }

  /**
   * Get downstream nodes from a given node
   */
  getDownstreamNodes(nodeName: string): string[] {
    const connections = this.connections[nodeName]?.main || []
    const downstream: string[] = []

    for (const outputConnections of connections) {
      for (const connection of outputConnections) {
        const nodeId = this.nodeNameToId.get(connection.node)
        if (nodeId) {
          downstream.push(nodeId)
        }
      }
    }

    return downstream
  }

  /**
   * Get nodes connected to a specific output of a node
   */
  getNodesForOutput(nodeName: string, outputIndex: number): string[] {
    const connections = this.connections[nodeName]?.main?.[outputIndex] || []
    return connections.map((c) => this.nodeNameToId.get(c.node)).filter((id): id is string => id !== undefined)
  }
}

// =============================================================================
// WORKFLOW EXECUTOR
// =============================================================================

/**
 * Workflow execution engine.
 *
 * Executes workflows with:
 * - DAG traversal
 * - Branching support (IF, Switch nodes)
 * - Data passing between nodes
 * - Execution timing and tracking
 */
export class WorkflowExecutor {
  private registry: NodeRegistry
  private expressionParser: ExpressionParser

  constructor(registry?: NodeRegistry) {
    this.registry = registry || new NodeRegistry()
    this.expressionParser = new ExpressionParser()
  }

  /**
   * Execute a workflow
   *
   * @param workflow - Workflow to execute
   * @param options - Execution options including trigger data
   * @returns Execution result with status, data, and timing info
   */
  async execute(
    workflow: Workflow,
    options: { triggerData?: INodeExecutionData[] } = {}
  ): Promise<IExecutionResult> {
    const startedAt = Date.now()
    const nodeExecutions: Record<string, INodeExecutionInfo> = {}
    const nodeOutputs: Map<string, INodeExecutionData[][]> = new Map()

    try {
      // Get execution order
      const executionOrder = workflow.getExecutionOrder()

      // Execute each node in order
      for (const nodeId of executionOrder) {
        const node = workflow.getNode(nodeId)
        if (!node) continue

        // Skip disabled nodes
        if (node.disabled) continue

        const nodeStartTime = Date.now()

        // Get input data for this node
        const inputData = this.getInputDataForNode(workflow, node, nodeOutputs, options.triggerData)

        // Skip if no input data (branch not taken)
        if (inputData.length === 0 && !this.isTriggerNode(node)) {
          continue
        }

        // Get node type implementation (optional for trigger nodes)
        const nodeType = this.getNodeType(node.type)

        // Build execution context
        const executeFunctions = this.buildExecuteFunctions(node, inputData, nodeOutputs, workflow)

        // Execute the node
        let outputData: INodeExecutionData[][]
        try {
          if (this.isTriggerNode(node)) {
            // Trigger nodes just pass through their input data
            outputData = [inputData]
          } else if (!nodeType) {
            throw new Error(`Unknown node type: ${node.type}`)
          } else if (nodeType.execute) {
            outputData = await nodeType.execute.call(executeFunctions)
          } else {
            // Nodes without execute just pass through
            outputData = [inputData]
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)

          // Check if continue on fail is enabled
          if (node.continueOnFail) {
            outputData = [[{ json: { error: errorMessage } }]]
          } else {
            return {
              status: 'error',
              data: [],
              error: errorMessage,
              errorNode: nodeId,
              executionTime: Date.now() - startedAt,
              nodeExecutions,
              startedAt,
              finishedAt: Date.now(),
            }
          }
        }

        // Store output data
        nodeOutputs.set(nodeId, outputData)

        // Record execution info
        nodeExecutions[nodeId] = {
          nodeId,
          executionTime: Date.now() - nodeStartTime,
          inputData,
          outputData,
        }
      }

      // Get final output (from last node with output)
      const finalOutput = this.getFinalOutput(workflow, nodeOutputs)

      return {
        status: 'success',
        data: finalOutput,
        executionTime: Date.now() - startedAt,
        nodeExecutions,
        startedAt,
        finishedAt: Date.now(),
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        status: 'error',
        data: [],
        error: errorMessage,
        executionTime: Date.now() - startedAt,
        nodeExecutions,
        startedAt,
        finishedAt: Date.now(),
      }
    }
  }

  /**
   * Get input data for a node based on incoming connections
   */
  private getInputDataForNode(
    workflow: Workflow,
    node: IWorkflowNode,
    nodeOutputs: Map<string, INodeExecutionData[][]>,
    triggerData?: INodeExecutionData[]
  ): INodeExecutionData[] {
    // For trigger nodes, use trigger data
    if (this.isTriggerNode(node)) {
      return triggerData || [{ json: {} }]
    }

    // Find incoming connections
    const inputData: INodeExecutionData[] = []

    for (const [sourceName, nodeConnections] of Object.entries(workflow.connections)) {
      for (let outputIndex = 0; outputIndex < nodeConnections.main.length; outputIndex++) {
        for (const connection of nodeConnections.main[outputIndex]) {
          if (connection.node === node.name) {
            const sourceId = workflow.getNodeId(sourceName)
            if (sourceId) {
              const sourceOutputs = nodeOutputs.get(sourceId)
              if (sourceOutputs && sourceOutputs[outputIndex]) {
                inputData.push(...sourceOutputs[outputIndex])
              }
            }
          }
        }
      }
    }

    return inputData
  }

  /**
   * Check if a node is a trigger node
   */
  private isTriggerNode(node: IWorkflowNode): boolean {
    return (
      node.type.includes('trigger') ||
      node.type.includes('webhook') ||
      node.type.includes('manualTrigger') ||
      node.type.includes('scheduleTrigger')
    )
  }

  /**
   * Get node type implementation
   */
  private getNodeType(typeName: string): INodeType | undefined {
    // Strip prefix if present (e.g., "n8n-nodes-base.httpRequest" -> "httpRequest")
    const name = typeName.replace(/^n8n-nodes-base\./, '')
    return this.registry.get(name)
  }

  /**
   * Build execution functions context for a node
   */
  private buildExecuteFunctions(
    node: IWorkflowNode,
    inputData: INodeExecutionData[],
    nodeOutputs: Map<string, INodeExecutionData[][]>,
    workflow: Workflow
  ): IExecuteFunctions {
    // Build $node context from previous node outputs
    const $node: Record<string, { json: Record<string, unknown> }> = {}
    for (const [nodeId, outputs] of nodeOutputs) {
      const nodeInfo = workflow.getNode(nodeId)
      if (nodeInfo && outputs[0]?.[0]) {
        $node[nodeInfo.name] = { json: outputs[0][0].json }
      }
    }

    return {
      getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
        const value = node.parameters[name]
        if (value === undefined) return fallback

        // Resolve expressions if string
        if (typeof value === 'string' && this.expressionParser.containsExpression(value)) {
          const context: IExpressionContext = {
            $json: inputData[itemIndex]?.json || {},
            $item: { index: itemIndex },
            $node,
          }
          return this.expressionParser.evaluate(value, context)
        }

        return value
      },
      getInputData: (inputIndex?: number) => {
        if (inputIndex !== undefined) {
          // For multi-input nodes like Merge, get specific input
          // This is handled specially in the node implementations
          return inputData
        }
        return inputData
      },
      getCredentials: async (type: string) => {
        // Return credentials from node config
        const creds = node.credentials?.[type]
        if (creds) {
          return { id: creds.id, name: creds.name }
        }
        return {}
      },
      helpers: {
        request: async (options: unknown) => {
          // HTTP request helper
          const opts = options as { url: string; method?: string; body?: unknown }
          const response = await fetch(opts.url, {
            method: opts.method || 'GET',
            body: opts.body ? JSON.stringify(opts.body) : undefined,
          })
          return response.json()
        },
        httpRequest: async (options: unknown) => {
          const opts = options as { url: string; method?: string; body?: unknown }
          const response = await fetch(opts.url, {
            method: opts.method || 'GET',
            body: opts.body ? JSON.stringify(opts.body) : undefined,
          })
          return response.json()
        },
      },
      getNode: () => ({ name: node.name, type: node.type, typeVersion: node.typeVersion }),
      continueOnFail: () => node.continueOnFail || false,
      getWorkflowDataProxy: (itemIndex: number) => ({
        $json: inputData[itemIndex]?.json || {},
        $item: { index: itemIndex },
        $node,
        $input: {
          first: () => inputData[0] || { json: {} },
          last: () => inputData[inputData.length - 1] || { json: {} },
          all: () => inputData,
        },
        $env: {},
      }),
      evaluateExpression: (expression: string, itemIndex: number) => {
        const context: IExpressionContext = {
          $json: inputData[itemIndex]?.json || {},
          $item: { index: itemIndex },
          $node,
        }
        return this.expressionParser.evaluate(expression, context)
      },
    }
  }

  /**
   * Get the final output of the workflow
   */
  private getFinalOutput(
    workflow: Workflow,
    nodeOutputs: Map<string, INodeExecutionData[][]>
  ): INodeExecutionData[] {
    // Find leaf nodes (nodes with no outgoing connections)
    const leafNodes: string[] = []

    for (const node of workflow.nodes) {
      const hasOutgoing = workflow.connections[node.name]?.main?.some((conns) => conns.length > 0)
      if (!hasOutgoing) {
        leafNodes.push(node.id)
      }
    }

    // Collect outputs from leaf nodes
    const finalOutput: INodeExecutionData[] = []
    for (const nodeId of leafNodes) {
      const outputs = nodeOutputs.get(nodeId)
      if (outputs) {
        for (const output of outputs) {
          finalOutput.push(...output)
        }
      }
    }

    return finalOutput
  }
}
