/**
 * @dotdo/n8n - n8n-compatible Workflow Automation
 *
 * Drop-in compatible n8n workflow engine that runs on dotdo's
 * durable execution infrastructure. Supports n8n workflow JSON format,
 * node types, expressions, and credential management.
 *
 * @example Basic Node
 * ```typescript
 * import { HttpRequestNode, Workflow, WorkflowExecutor } from '@dotdo/n8n'
 *
 * const workflow = new Workflow({
 *   name: 'API Call',
 *   nodes: [
 *     { id: 'webhook', name: 'Webhook', type: 'n8n-nodes-base.webhook', ... },
 *     { id: 'http', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', ... },
 *   ],
 *   connections: { ... },
 * })
 *
 * const executor = new WorkflowExecutor()
 * const result = await executor.execute(workflow, { triggerData: [{ json: {} }] })
 * ```
 *
 * @see https://docs.n8n.io/ - n8n documentation (API-compatible)
 */

// =============================================================================
// TYPES
// =============================================================================

export * from './types'

// =============================================================================
// EXPRESSION PARSER
// =============================================================================

export { ExpressionParser } from './expression'

// =============================================================================
// CREDENTIALS
// =============================================================================

export { CredentialManager } from './credentials'

// =============================================================================
// NODES
// =============================================================================

export {
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
} from './nodes'

// =============================================================================
// WORKFLOW
// =============================================================================

export { Workflow, WorkflowExecutor } from './workflow'

// =============================================================================
// REGISTRY
// =============================================================================

export { NodeRegistry } from './registry'

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export { WorkflowExecutor as default } from './workflow'
