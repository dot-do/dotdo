/**
 * Workflow Compat Layers - 100% API Compatible with Major Workflow Platforms
 *
 * Drop-in replacements that run on dotdo's durable execution infrastructure:
 *
 * - @dotdo/qstash   - Upstash QStash API compatible
 * - @dotdo/inngest  - Inngest API compatible
 * - @dotdo/trigger  - Trigger.dev v3 API compatible
 * - @dotdo/temporal - Temporal API compatible
 *
 * @example
 * ```typescript
 * // QStash-style messaging
 * import { Client } from '@dotdo/qstash'
 * const client = new Client({ token: 'xxx' })
 * await client.publishJSON({ url: '...', body: { hello: 'world' } })
 *
 * // Inngest-style functions
 * import { Inngest } from '@dotdo/inngest'
 * const inngest = new Inngest({ id: 'my-app' })
 * const fn = inngest.createFunction(
 *   { id: 'hello' },
 *   { event: 'app/hello' },
 *   async ({ event, step }) => {
 *     await step.run('greet', () => console.log('Hello!'))
 *   }
 * )
 *
 * // Trigger.dev-style tasks
 * import { task } from '@dotdo/trigger'
 * export const myTask = task({
 *   id: 'my-task',
 *   run: async (payload, { ctx }) => {
 *     return await ctx.run('process', () => processPayload(payload))
 *   },
 * })
 *
 * // Temporal-style workflows
 * import { proxyActivities, sleep, condition } from '@dotdo/temporal'
 * const { sendEmail } = proxyActivities<typeof activities>({ ... })
 * export async function myWorkflow() {
 *   await sendEmail('hello')
 *   await sleep('1h')
 * }
 *
 * // Unified error handling
 * import { DotdoRetryableError, mapToNativeError } from '@dotdo/workflows/compat/errors'
 * throw new DotdoRetryableError('Service unavailable', 5000)
 * ```
 */

// QStash Compat
export {
  Client as QStashClient,
  Receiver as QStashReceiver,
  type ClientConfig as QStashClientConfig,
  type PublishRequest as QStashPublishRequest,
  type PublishResponse as QStashPublishResponse,
  type ScheduleRequest as QStashScheduleRequest,
  type Schedule as QStashSchedule,
  type VerifyRequest as QStashVerifyRequest,
  type ReceiverConfig as QStashReceiverConfig,
} from './qstash'

// Inngest Compat
export {
  Inngest,
  InngestFunction,
  NonRetriableError,
  RetryAfterError,
  StepError,
  serve as serveInngest,
  type InngestConfig,
  type FunctionConfig as InngestFunctionConfig,
  type FunctionTrigger as InngestTrigger,
  type InngestEvent,
  type StepTools as InngestStepTools,
  type FunctionContext as InngestFunctionContext,
  type InngestMiddleware,
} from './inngest'

// Trigger.dev Compat
export {
  task,
  wait,
  retry,
  queue,
  abort,
  schedules,
  configure as configureTrigger,
  AbortTaskRunError,
  type TaskConfig,
  type TaskContext,
  type RetryConfig as TriggerRetryConfig,
  type QueueConfig,
  type MachineConfig,
  type TriggerOptions,
  type TriggerResult,
  type TaskRunHandle,
  type TaskRunStatus,
  type TaskRunResult,
} from './trigger'

// Temporal Compat
export {
  defineSignal,
  defineQuery,
  defineUpdate,
  setHandler,
  proxyActivities,
  proxyLocalActivities,
  startChild,
  executeChild,
  sleep,
  condition,
  workflowInfo,
  continueAsNew,
  makeContinueAsNewFunc,
  CancellationScope,
  isCancellation,
  WorkflowClient,
  uuid4,
  random,
  configure as configureTemporal,
  type SignalDefinition,
  type QueryDefinition,
  type UpdateDefinition,
  type ActivityOptions,
  type LocalActivityOptions,
  type RetryPolicy as TemporalRetryPolicy,
  type ChildWorkflowOptions,
  type WorkflowHandle,
  type ChildWorkflowHandle,
  type WorkflowInfo,
  type WorkflowClientOptions,
  type WorkflowStartOptions,
} from './temporal'

// Unified Error Handling
export {
  // Base error types
  DotdoError,
  DotdoRetryableError,
  DotdoNonRetryableError,
  DotdoTimeoutError,
  DotdoCancellationError,
  DotdoNotImplementedError,
  DotdoStepError,
  DotdoInvokeTimeoutError,
  // Type guards
  isError,
  isDotdoError,
  isRetryableError,
  isNonRetryableError,
  isCancellationError,
  isTimeoutError,
  ensureError,
  // Platform mapping
  mapToNativeError,
  mapFromNativeError,
  // Utilities
  wrapError,
  toNonRetryable,
  toRetryable,
  // Types
  type Platform,
} from './errors'
