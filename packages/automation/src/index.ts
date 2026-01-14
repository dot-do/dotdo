/**
 * @dotdo/automation
 *
 * n8n-compatible workflow automation for edge environments.
 *
 * Provides a complete workflow automation system with:
 * - Triggers: Webhook, Cron, Polling
 * - Actions: HTTP Request, Code, Set, Function
 * - Flow Control: If, Switch, Loop, Merge, Split, Filter, Wait
 * - Workflow Engine: Definition, execution, versioning, persistence
 *
 * @example
 * ```typescript
 * import {
 *   Workflow,
 *   WorkflowEngine,
 *   WebhookTrigger,
 *   CodeAction,
 *   IfNode,
 * } from '@dotdo/automation'
 *
 * // Create a workflow
 * const workflow = new Workflow({
 *   name: 'Order Processing',
 *   nodes: [
 *     { id: 'webhook', type: 'webhook', config: { path: '/orders', method: 'POST' } },
 *     { id: 'validate', type: 'code', config: { code: 'return { valid: input.amount > 0 }' } },
 *     { id: 'process', type: 'http', config: { method: 'POST', url: 'https://api.example.com/orders' } },
 *   ],
 *   connections: [
 *     { from: 'webhook', to: 'validate' },
 *     { from: 'validate', to: 'process' },
 *   ],
 * })
 *
 * // Create engine and register workflow
 * const engine = new WorkflowEngine()
 * engine.register(workflow)
 * engine.activate(workflow.id)
 *
 * // Execute workflow
 * const result = await engine.execute(workflow.id, { input: { amount: 100 } })
 * ```
 */

// Triggers
export {
  WebhookTrigger,
  CronTrigger,
  PollingTrigger,
  type TriggerEvent,
  type TriggerConfig,
  type TriggerResult,
  type WebhookTriggerConfig,
  type WebhookAuthentication,
  type CronTriggerConfig,
  type PollingTriggerConfig,
  type PollResult,
  type BackoffConfig,
  type StateStorage,
  type HttpMethod,
} from './triggers'

// Actions
export {
  HttpRequestAction,
  CodeAction,
  SetAction,
  FunctionAction,
  type ActionContext,
  type ActionResult,
  type HttpRequestActionConfig,
  type HttpAuthentication,
  type RetryConfig,
  type CodeActionConfig,
  type SetActionConfig,
  type SetValue,
  type FunctionActionConfig,
  type FunctionHelpers,
} from './actions'

// Flow Control Nodes
export {
  IfNode,
  SwitchNode,
  LoopNode,
  MergeNode,
  SplitNode,
  FilterNode,
  NoOpNode,
  WaitNode,
  type Condition,
  type ComparisonOperator,
  type NodeOutput,
  type IfResult,
  type IfNodeConfig,
  type SwitchResult,
  type SwitchNodeConfig,
  type SwitchRule,
  type LoopNodeConfig,
  type LoopCallbacks,
  type LoopResult,
  type MergeNodeConfig,
  type MergeInput,
  type MergeResult,
  type SplitNodeConfig,
  type SplitResult,
  type FilterNodeConfig,
  type FilterResult,
  type NoOpNodeConfig,
  type NoOpResult,
  type WaitNodeConfig,
  type WaitResult,
} from './nodes'

// Workflow Engine
export {
  Workflow,
  WorkflowEngine,
  type WorkflowConfig,
  type WorkflowNode,
  type WorkflowNodeHooks,
  type WorkflowConnection,
  type WorkflowSettings,
  type WorkflowExecution,
  type ExecutionOptions,
  type NodeExecution,
  type ExecutionListener,
  type WorkflowStorage,
  type WorkflowEngineConfig,
} from './workflows'
