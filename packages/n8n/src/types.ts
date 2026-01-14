/**
 * n8n Type Definitions
 *
 * Compatible with n8n's internal types for workflow execution.
 */

// =============================================================================
// NODE EXECUTION DATA
// =============================================================================

/**
 * Single item of data flowing through the workflow
 */
export interface INodeExecutionData {
  /** JSON payload */
  json: Record<string, unknown>
  /** Binary data attachments */
  binary?: Record<string, IBinaryData>
  /** Pairing info for merge operations */
  pairedItem?: IPairedItemData | IPairedItemData[]
}

/**
 * Binary data attachment
 */
export interface IBinaryData {
  data: string
  mimeType: string
  fileName?: string
  fileSize?: number
}

/**
 * Paired item tracking for data lineage
 */
export interface IPairedItemData {
  item: number
  input?: number
}

// =============================================================================
// NODE TYPE DEFINITION
// =============================================================================

/**
 * Node type interface that all nodes must implement
 */
export interface INodeType {
  /** Node description and metadata */
  description: INodeTypeDescription
  /** Execute method for regular nodes */
  execute?: (this: IExecuteFunctions) => Promise<INodeExecutionData[][]>
  /** Webhook handler for trigger nodes */
  webhook?: (this: ITriggerFunctions) => Promise<IWebhookResponseData>
  /** Poll method for polling triggers */
  poll?: (this: ITriggerFunctions) => Promise<INodeExecutionData[][] | null>
  /** Trigger method for cron/manual triggers */
  trigger?: (this: ITriggerFunctions) => Promise<ITriggerResponse>
}

/**
 * Node description with all metadata
 */
export interface INodeTypeDescription {
  /** Display name shown in UI */
  displayName: string
  /** Internal node name (camelCase) */
  name: string
  /** Node group(s) for categorization */
  group: NodeGroup[]
  /** Version number */
  version: number
  /** Description text */
  description: string
  /** Default values for the node */
  defaults: INodeTypeDefaults
  /** Input types */
  inputs: NodeConnectionType[]
  /** Output types */
  outputs: NodeConnectionType[]
  /** Webhook definitions */
  webhooks?: IWebhookDescription[]
  /** Node properties/parameters */
  properties: INodeProperties[]
  /** Credential requirements */
  credentials?: INodeCredentialDescription[]
  /** Icon path */
  icon?: string
  /** Subtitle expression */
  subtitle?: string
}

export type NodeGroup = 'trigger' | 'transform' | 'output' | 'input'
export type NodeConnectionType = 'main' | 'ai_agent' | 'ai_tool'

export interface INodeTypeDefaults {
  name: string
  color?: string
}

export interface IWebhookDescription {
  name: string
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
  path: string
  responseMode?: 'onReceived' | 'lastNode'
}

export interface INodeCredentialDescription {
  name: string
  required?: boolean
}

// =============================================================================
// NODE PROPERTIES
// =============================================================================

/**
 * Node property/parameter definition
 */
export interface INodeProperties {
  /** Property display name */
  displayName: string
  /** Property name (camelCase) */
  name: string
  /** Property type */
  type: NodePropertyType
  /** Default value */
  default?: unknown
  /** Required flag */
  required?: boolean
  /** Description text */
  description?: string
  /** Placeholder text */
  placeholder?: string
  /** Options for select/multiOptions */
  options?: INodePropertyOption[]
  /** Show/hide conditions */
  displayOptions?: IDisplayOptions
  /** For collection type */
  typeOptions?: INodePropertyTypeOptions
}

export type NodePropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'options'
  | 'multiOptions'
  | 'collection'
  | 'fixedCollection'
  | 'json'
  | 'dateTime'

export interface INodePropertyOption {
  name: string
  value: string | number | boolean
  description?: string
}

export interface IDisplayOptions {
  show?: Record<string, unknown[]>
  hide?: Record<string, unknown[]>
}

export interface INodePropertyTypeOptions {
  multipleValues?: boolean
  multipleValueButtonText?: string
  sortable?: boolean
}

// =============================================================================
// EXECUTION FUNCTIONS
// =============================================================================

/**
 * Functions available during node execution
 */
export interface IExecuteFunctions {
  /** Get parameter value for item */
  getNodeParameter(name: string, itemIndex: number, fallback?: unknown): unknown
  /** Get all input data */
  getInputData(inputIndex?: number): INodeExecutionData[]
  /** Get credentials */
  getCredentials(type: string): Promise<ICredentialDataDecryptedObject>
  /** Helper functions */
  helpers: IExecuteFunctionHelpers
  /** Get current node info */
  getNode(): INodeInfo
  /** Check if should continue on fail */
  continueOnFail(): boolean
  /** Get workflow data proxy */
  getWorkflowDataProxy(itemIndex: number): IWorkflowDataProxy
  /** Evaluate expression */
  evaluateExpression(expression: string, itemIndex: number): unknown
}

export interface IExecuteFunctionHelpers {
  request(options: unknown): Promise<unknown>
  httpRequest(options: unknown): Promise<unknown>
}

export interface INodeInfo {
  name: string
  type?: string
  typeVersion?: number
}

export interface IWorkflowDataProxy {
  $json: Record<string, unknown>
  $item: { index: number }
  $node: Record<string, { json: Record<string, unknown> }>
  $input: {
    first: () => INodeExecutionData
    last: () => INodeExecutionData
    all: () => INodeExecutionData[]
  }
  $env: Record<string, string>
}

/**
 * Functions available during trigger execution
 */
export interface ITriggerFunctions {
  /** Get parameter value */
  getNodeParameter(name: string, fallback?: unknown): unknown
  /** Get request object (for webhooks) */
  getRequestObject(): IWebhookRequest
  /** Get response object (for webhooks) */
  getResponseObject(): IWebhookResponse
  /** Get credentials */
  getCredentials(type: string): Promise<ICredentialDataDecryptedObject>
  /** Helper functions */
  helpers: ITriggerFunctionHelpers
}

export interface ITriggerFunctionHelpers {
  httpRequest(options: unknown): Promise<unknown>
}

export interface IWebhookRequest {
  body: unknown
  headers: Record<string, string>
  method: string
  query: Record<string, string>
  params: Record<string, string>
}

export interface IWebhookResponse {
  status(code: number): IWebhookResponse
  json(data: unknown): void
  send(data: unknown): void
}

export interface IWebhookResponseData {
  workflowData?: INodeExecutionData[][]
  webhookResponse?: unknown
  noWebhookResponse?: boolean
}

export interface ITriggerResponse {
  closeFunction?: () => Promise<void>
  manualTriggerFunction?: () => Promise<void>
}

// =============================================================================
// CREDENTIALS
// =============================================================================

/**
 * Credential type definition
 */
export interface ICredentialType {
  /** Display name */
  displayName: string
  /** Internal name */
  name: string
  /** Description */
  description?: string
  /** Credential properties */
  properties: INodeProperties[]
  /** Authentication method */
  authenticate?: ICredentialAuthenticate
}

export interface ICredentialAuthenticate {
  type: 'header' | 'query' | 'body'
  properties: Record<string, string>
}

export interface ICredentialDataDecryptedObject {
  [key: string]: unknown
}

export interface INodeCredentials {
  [key: string]: {
    id: string
    name: string
  }
}

// =============================================================================
// WORKFLOW DATA
// =============================================================================

/**
 * Complete workflow definition (n8n JSON format)
 */
export interface IWorkflowData {
  /** Workflow name */
  name: string
  /** Workflow nodes */
  nodes: IWorkflowNode[]
  /** Node connections */
  connections: IConnections
  /** Workflow settings */
  settings?: IWorkflowSettings
  /** Static data storage */
  staticData?: Record<string, unknown>
  /** Pinned data for testing */
  pinData?: Record<string, INodeExecutionData[]>
}

/**
 * Node instance in a workflow
 */
export interface IWorkflowNode {
  /** Unique node ID */
  id: string
  /** Display name */
  name: string
  /** Node type (e.g., 'n8n-nodes-base.httpRequest') */
  type: string
  /** Type version */
  typeVersion: number
  /** Canvas position */
  position: [number, number]
  /** Node parameters */
  parameters: Record<string, unknown>
  /** Credentials reference */
  credentials?: INodeCredentials
  /** Disabled flag */
  disabled?: boolean
  /** Notes */
  notes?: string
  /** Continue on fail */
  continueOnFail?: boolean
  /** Retry on fail */
  retryOnFail?: boolean
  /** Max tries */
  maxTries?: number
  /** Wait between tries */
  waitBetweenTries?: number
}

/**
 * Workflow connections map
 */
export interface IConnections {
  [nodeName: string]: INodeConnections
}

export interface INodeConnections {
  main: IConnection[][]
}

/**
 * Single connection between nodes
 */
export interface IConnection {
  node: string
  type: NodeConnectionType
  index: number
}

export interface IWorkflowSettings {
  /** Timezone */
  timezone?: string
  /** Error workflow ID */
  errorWorkflow?: string
  /** Save successful executions */
  saveDataSuccessExecution?: 'all' | 'none' | 'default'
  /** Save failed executions */
  saveDataErrorExecution?: 'all' | 'none' | 'default'
  /** Execution timeout */
  executionTimeout?: number
  /** Max execution time */
  maxExecutionTime?: number
}

// =============================================================================
// EXECUTION RESULT
// =============================================================================

/**
 * Result of workflow execution
 */
export interface IExecutionResult {
  /** Execution status */
  status: 'success' | 'error' | 'running' | 'waiting'
  /** Final output data */
  data: INodeExecutionData[]
  /** Error message if failed */
  error?: string
  /** Error node ID */
  errorNode?: string
  /** Total execution time in ms */
  executionTime: number
  /** Per-node execution info */
  nodeExecutions: Record<string, INodeExecutionInfo>
  /** Started timestamp */
  startedAt: number
  /** Finished timestamp */
  finishedAt?: number
}

export interface INodeExecutionInfo {
  /** Node ID */
  nodeId: string
  /** Execution time in ms */
  executionTime: number
  /** Input data */
  inputData: INodeExecutionData[]
  /** Output data */
  outputData: INodeExecutionData[][]
  /** Error if failed */
  error?: string
}

// =============================================================================
// EXPRESSION CONTEXT
// =============================================================================

/**
 * Context available during expression evaluation
 */
export interface IExpressionContext {
  /** Current item JSON data */
  $json?: Record<string, unknown>
  /** Current item info */
  $item?: { index: number }
  /** Previous node outputs */
  $node?: Record<string, { json: Record<string, unknown> }>
  /** Input helpers */
  $input?: {
    first: { json: Record<string, unknown> }
    last: { json: Record<string, unknown> }
    all: Array<{ json: Record<string, unknown> }>
  }
  /** Environment variables */
  $env?: Record<string, string>
  /** Execution ID */
  $execution?: { id: string }
  /** Workflow info */
  $workflow?: { id: string; name: string }
  /** Now date */
  $now?: Date
  /** Today date */
  $today?: Date
}
