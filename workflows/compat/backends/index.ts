/**
 * Workflow Backend Adapters
 *
 * Provides multiple backend options for the workflow compat layers:
 *
 * - **CF Workflows** - Hot, out-of-band, cost-efficient for long waits
 * - **DO Actions** - Full consistency, real-time, higher cost
 * - **Pipelines/Iceberg** - Cheapest, higher latency (60s batch)
 *
 * The compat layers (QStash, Inngest, Trigger.dev, Temporal) can use
 * any of these backends based on durability requirements and cost.
 */

export {
  CFWorkflowsBackend,
  HybridWorkflowBackend,
  type WorkflowBinding,
  type WorkflowInstance,
  type CFWorkflowsBackendConfig,
  type StepOptions,
  type BackendMode,
} from './cloudflare-workflows'
