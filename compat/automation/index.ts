/**
 * @dotdo/automation - Zapier/n8n-compatible Workflow Automation
 *
 * Drop-in compatible workflow automation engine that runs on dotdo's
 * durable execution infrastructure.
 *
 * @example Basic Workflow
 * ```typescript
 * import { Workflow, WorkflowEngine, WebhookTrigger } from '@dotdo/automation'
 *
 * const engine = new WorkflowEngine()
 *
 * const workflow = new Workflow({
 *   name: 'Order Processing',
 *   nodes: [
 *     {
 *       id: 'webhook',
 *       type: 'webhook',
 *       config: { path: '/webhook/order', method: 'POST' },
 *     },
 *     {
 *       id: 'validate',
 *       type: 'if',
 *       config: {
 *         conditions: [
 *           { field: 'amount', operator: 'greaterThan', value: 0 },
 *         ],
 *       },
 *     },
 *     {
 *       id: 'process',
 *       type: 'http',
 *       config: {
 *         method: 'POST',
 *         url: 'https://api.example.com/orders',
 *       },
 *     },
 *   ],
 *   connections: [
 *     { from: 'webhook', to: 'validate' },
 *     { from: 'validate', to: 'process' },
 *   ],
 * })
 *
 * engine.register(workflow)
 * engine.activate(workflow.id)
 * ```
 *
 * @example Scheduled Workflow
 * ```typescript
 * const scheduledWorkflow = new Workflow({
 *   name: 'Daily Report',
 *   nodes: [
 *     {
 *       id: 'schedule',
 *       type: 'cron',
 *       config: { expression: '0 9 * * *', timezone: 'America/New_York' },
 *     },
 *     {
 *       id: 'fetch-data',
 *       type: 'http',
 *       config: { method: 'GET', url: 'https://api.example.com/report' },
 *     },
 *     {
 *       id: 'send-email',
 *       type: 'http',
 *       config: {
 *         method: 'POST',
 *         url: 'https://api.sendgrid.com/v3/mail/send',
 *         authentication: { type: 'bearer', token: '{{env.SENDGRID_API_KEY}}' },
 *       },
 *     },
 *   ],
 *   connections: [
 *     { from: 'schedule', to: 'fetch-data' },
 *     { from: 'fetch-data', to: 'send-email' },
 *   ],
 * })
 * ```
 *
 * @example Flow Control
 * ```typescript
 * const workflow = new Workflow({
 *   name: 'Conditional Processing',
 *   nodes: [
 *     { id: 'trigger', type: 'webhook', config: { path: '/process' } },
 *     {
 *       id: 'switch',
 *       type: 'switch',
 *       config: {
 *         rules: [
 *           { output: 'email', conditions: [{ field: 'channel', operator: 'equals', value: 'email' }] },
 *           { output: 'sms', conditions: [{ field: 'channel', operator: 'equals', value: 'sms' }] },
 *         ],
 *         fallbackOutput: 'default',
 *       },
 *     },
 *     { id: 'email-action', type: 'http', config: { url: '/send-email' } },
 *     { id: 'sms-action', type: 'http', config: { url: '/send-sms' } },
 *     { id: 'default-action', type: 'http', config: { url: '/log' } },
 *   ],
 *   connections: [
 *     { from: 'trigger', to: 'switch' },
 *     { from: 'switch', to: 'email-action', outputIndex: 0 },
 *     { from: 'switch', to: 'sms-action', outputIndex: 1 },
 *     { from: 'switch', to: 'default-action', outputIndex: 2 },
 *   ],
 * })
 * ```
 *
 * @see https://docs.n8n.io/ - n8n documentation (API-compatible)
 */

// ============================================================================
// TRIGGERS
// ============================================================================

export {
  // Classes
  WebhookTrigger,
  CronTrigger,
  PollingTrigger,
  // Types
  type TriggerEvent,
  type TriggerConfig,
  type TriggerResult,
  type TriggerListener,
  type ErrorListener,
  type HttpMethod,
  type WebhookAuthentication,
  type WebhookTriggerConfig,
  type CronTriggerConfig,
  type BackoffConfig,
  type StateStorage,
  type PollResult,
  type PollingTriggerConfig,
} from './triggers'

// ============================================================================
// ACTIONS
// ============================================================================

export {
  // Classes
  HttpRequestAction,
  CodeAction,
  SetAction,
  FunctionAction,
  // Types
  type ActionResult,
  type ActionContext,
  type ActionHelpers,
  type HttpMethod as HttpRequestMethod,
  type HttpAuthentication,
  type HttpRetryConfig,
  type HttpRequestConfig,
  type CodeActionConfig,
  type SetValue,
  type SetActionConfig,
  type FunctionActionConfig,
} from './actions'

// ============================================================================
// FLOW CONTROL NODES
// ============================================================================

export {
  // Classes
  IfNode,
  SwitchNode,
  LoopNode,
  MergeNode,
  SplitNode,
  FilterNode,
  NoOpNode,
  WaitNode,
  // Types
  type ComparisonOperator,
  type Condition,
  type ExecutionBranch,
  type NodeOutput,
  type IfNodeConfig,
  type SwitchRule,
  type SwitchNodeConfig,
  type SwitchResult,
  type LoopNodeConfig,
  type LoopCallbacks,
  type LoopResult,
  type MergeMode,
  type MergeNodeConfig,
  type MergeInput,
  type MergeResult,
  type SplitNodeConfig,
  type SplitResult,
  type FilterNodeConfig,
  type FilterResult,
  type NoOpNodeConfig,
  type WaitNodeConfig,
  type WaitResult,
} from './nodes'

// ============================================================================
// WORKFLOW ENGINE
// ============================================================================

export {
  // Classes
  Workflow,
  WorkflowEngine,
  WorkflowExecution,
  // Types
  type WorkflowStatus,
  type ExecutionStatus,
  type WorkflowNodeConfig,
  type WorkflowConnection,
  type WorkflowSettings,
  type WorkflowDefinition,
  type NodeExecution,
  type ExecutionOptions,
  type Storage,
  type WorkflowEngineConfig,
} from './workflows'

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export { WorkflowEngine as default } from './workflows'
