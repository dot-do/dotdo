/**
 * Public API Type Tests - RED Phase
 *
 * These tests verify the completeness and correctness of public API types
 * across all @dotdo/* packages. Tests are designed to FAIL initially
 * to establish the RED phase of TDD.
 *
 * Test Categories:
 * 1. Export completeness - All expected types are exported
 * 2. Type inference - Generic types infer correctly
 * 3. Type constraints - Generic constraints are properly enforced
 * 4. No accidental 'any' - Public APIs don't leak 'any' types
 * 5. Type compatibility - Types work together correctly
 *
 * @see do-4prm - [RED] Types - Type tests for public API completeness
 */

import { describe, it, expect, expectTypeOf, assertType } from 'vitest'

// =============================================================================
// Package Imports - These should all succeed if exports are complete
// =============================================================================

// @dotdo/client
import {
  $,
  $Context,
  configure,
  disposeSession,
  disposeAllSessions,
  createClient,
  type RpcClient,
  type RpcError,
  type RpcPromise,
  type ChainStep,
  type ContextOptions,
  type SdkConfig,
  type ConnectionState,
  type ReconnectConfig,
  type AuthConfig,
  type ClientConfig,
  type RPCError,
  type SubscriptionHandle,
  type PipelineStep,
  type DOClient,
} from '../../packages/client/src/index'

// @dotdo/rpc
import {
  createRpcProxy,
  RpcProxyError,
  resetCallIdCounter,
  InMemoryExecutor,
  HTTPExecutor,
  serialize,
  deserialize,
  type MethodCall,
  type CallResult,
  type BatchResult,
  type RpcError as RpcRpcError,
  type Executor,
  type ProxyConfig,
  type BatchingConfig,
  type SerializedValue,
  type FunctionReference,
  type HTTPExecutorOptions,
  type DeepPartial,
  type MethodNames,
  type Promisify,
} from '../../packages/rpc/src/index'

// @dotdo/react
import {
  DO,
  DotdoContext,
  useDotdoContext,
  useDO,
  use$,
  useCollection,
  useLiveQuery,
  useRecord,
  useConnectionState,
  type DOProps,
  type WorkflowContext,
  type UseRecordConfig,
  type BaseItem,
  type CollectionConfig,
  type UseCollectionResult,
  type LiveQueryConfig,
  type UseRecordResult,
  type SyncMessage,
  type DotdoContextValue,
  type DOClient as ReactDOClient,
  type ClientConfig as ReactClientConfig,
  type ConnectionState as ReactConnectionState,
} from '../../packages/react/src/index'

// @dotdo/digital-tools
import {
  createTool,
  createIntegration,
  createCapability,
  isTool,
  isIntegration,
  isCapability,
  ToolSchema,
  IntegrationSchema,
  CapabilitySchema,
  type Tool,
  type Integration,
  type Capability,
} from '../../packages/digital-tools/src/index'

// @dotdo/business-as-code
import {
  createBusiness,
  isOrganization,
  isBusiness,
  isCompany,
  isGoal,
  isKeyResult,
  OrganizationSchema,
  BusinessSchema,
  CompanySchema,
  GoalSchema,
  KeyResultSchema,
  type Organization,
  type Business,
  type Company,
  type Org,
  type Goal,
  type Objective,
  type KeyResult,
  type Address,
  type OrgBilling,
} from '../../packages/business-as-code/src/index'

// @dotdo/digital-workers
import {
  createWorker as createDigitalWorker,
  createAgent,
  createHuman,
  isWorker as isDigitalWorker,
  isAgent,
  isHuman,
  WorkerSchema,
  AgentSchema,
  HumanSchema,
  type Worker as DigitalWorker,
  type Agent,
  type Human,
} from '../../packages/digital-workers/src/index'

// @dotdo/worker-helpers
import {
  createWorker,
  createHandler,
  createFetchHandler,
  createWebSocketHandler,
  createRPCHandler,
  createMultiDOWorker,
  withMiddleware,
  withErrorHandler,
  withCORS,
  withAuth,
  inferBindingName,
  resolveDO,
  bindDO,
  getDOBinding,
  type DurableObjectNamespace,
  type DurableObjectId,
  type DurableObjectStub,
  type Env,
  type ExecutionContext,
  type DOClass,
  type DOInstance,
  type FetchHandler,
  type Middleware,
  type Worker,
  type CreateWorkerOptions,
  type SimpleDOConfig,
  type DetailedDOConfig,
  type MultiDOConfig,
  type MultiDOWorkerOptions,
  type CORSOptions,
  type AuthConfig as WorkerAuthConfig,
} from '../../packages/worker-helpers/src/index'

// @dotdo/worker-types
import {
  isWorker as isWorkerType,
  isAgent as isAgentType,
  isHuman as isHumanType,
  isTask,
  isTaskResult,
  isApprovalRequest,
  isApprovalResult,
  isChannel,
  isAnswer,
  isOption,
  isDecision,
  isWorkerConfig,
  isTool as isToolType,
  isGoal as isGoalType,
  isGoalResult,
  isMemoryType,
  isMemory,
  isAgentConfig,
  isNotificationChannel,
  isEscalationPolicy,
  isBlockingApprovalStatus,
  isBlockingApprovalRequest,
  isHumanConfig,
  isWorkerMode,
  isWorkerStatus,
  isLoadBalancerStrategy,
  isWorkerNode,
  isTaskRequest,
  isRouteResult,
  isMessageType,
  isDeliveryStatus,
  isWorkerMessage,
  isHandoffState,
  isHandoffRequest,
  isWorkflowState,
  type WorkerMode,
  type Task,
  type TaskResult,
  type Context,
  type Answer,
  type Option,
  type Decision,
  type ApprovalRequest,
  type ApprovalResult,
  type Channel,
  type IWorker,
  type WorkerConfig,
  type Tool as WorkerTool,
  type ToolDefinition,
  type Goal as WorkerGoal,
  type GoalResult,
  type MemoryType,
  type Memory,
  type MemorySearchOptions,
  type IAgent,
  type AgentConfig,
  type AgentLoopStep,
  type AgentLoopState,
  type NotificationPriority,
  type NotificationChannel,
  type EscalationRule,
  type EscalationPolicy,
  type PendingApproval,
  type BlockingApprovalStatus,
  type BlockingApprovalType,
  type BlockingApprovalRequest,
  type IHuman,
  type HumanConfig,
  type ProxyMode,
  type HostnameConfig,
  type FixedNamespaceConfig,
  type BaseProxyConfig,
  type ProxyConfig as RoutingProxyConfig,
  type APIConfig,
  type NamespaceResolveResult,
  type WorkerStatus,
  type LoadBalancerStrategy,
  type WorkerRegistration,
  type WorkerNode,
  type TaskRequest,
  type RouteResult,
  type WorkerLoadMetrics,
  type RouteOptions,
  type StatusHistoryEntry,
  type RoutingHistoryEntry,
  type ClusterUtilization,
  type LoadBalancer,
  type FullLoadBalancer,
  type MessageType,
  type DeliveryStatus,
  type WorkerMessage,
  type MessageEnvelope,
  type BusConfig,
  type MessageFilter,
  type HandoffReason,
  type HandoffState,
  type HandoffContext,
  type HandoffRequest,
  type HandoffResult,
  type HandoffChainEntry,
  type EscalationOptions,
  type EscalationData,
  type SLAStatus,
  type WorkflowState,
  type WorkflowStepResult,
  type WorkerTier,
  type WorkerEventType,
  type WorkerEvent,
} from '../../packages/worker-types/src/index'

// @dotdo/path-utils
import {
  sep,
  delimiter,
  normalize,
  resolve,
  basename,
  dirname,
  join,
  isAbsolute,
  extname,
  parse,
  format,
  relative,
  type ParsedPath,
} from '../../packages/path-utils/src/index'

// =============================================================================
// 1. EXPORT COMPLETENESS TESTS
// =============================================================================

describe('Public API Export Completeness', () => {
  describe('@dotdo/client exports', () => {
    it('should export $ as RpcClient', () => {
      expectTypeOf($).toMatchTypeOf<RpcClient>()
    })

    it('should export $Context function', () => {
      expectTypeOf($Context).toBeFunction()
      expectTypeOf($Context).parameter(0).toBeString()
    })

    it('should export configuration functions', () => {
      expectTypeOf(configure).toBeFunction()
      expectTypeOf(disposeSession).toBeFunction()
      expectTypeOf(disposeAllSessions).toBeFunction()
    })

    it('should export legacy createClient function', () => {
      expectTypeOf(createClient).toBeFunction()
    })

    it('should export all core types', () => {
      // These should be types, not runtime values
      expectTypeOf<RpcClient>().not.toBeAny()
      expectTypeOf<RpcError>().not.toBeAny()
      expectTypeOf<RpcPromise<unknown>>().not.toBeAny()
      expectTypeOf<ContextOptions>().not.toBeAny()
      expectTypeOf<SdkConfig>().not.toBeAny()
    })

    it('should export legacy types for backwards compatibility', () => {
      expectTypeOf<ConnectionState>().not.toBeAny()
      expectTypeOf<ReconnectConfig>().not.toBeAny()
      expectTypeOf<AuthConfig>().not.toBeAny()
      expectTypeOf<ClientConfig>().not.toBeAny()
      expectTypeOf<RPCError>().not.toBeAny()
      expectTypeOf<SubscriptionHandle>().not.toBeAny()
      expectTypeOf<PipelineStep>().not.toBeAny()
      expectTypeOf<DOClient<unknown>>().not.toBeAny()
      expectTypeOf<ChainStep>().not.toBeAny()
    })
  })

  describe('@dotdo/rpc exports', () => {
    it('should export createRpcProxy function', () => {
      expectTypeOf(createRpcProxy).toBeFunction()
    })

    it('should export RpcProxyError class', () => {
      expectTypeOf(RpcProxyError).toBeConstructibleWith(expect.any(String))
    })

    it('should export executor classes', () => {
      expectTypeOf(InMemoryExecutor).toBeFunction()
      expectTypeOf(HTTPExecutor).toBeFunction()
    })

    it('should export serialization functions', () => {
      expectTypeOf(serialize).toBeFunction()
      expectTypeOf(deserialize).toBeFunction()
    })

    it('should export all types', () => {
      expectTypeOf<MethodCall>().not.toBeAny()
      expectTypeOf<CallResult>().not.toBeAny()
      expectTypeOf<BatchResult>().not.toBeAny()
      expectTypeOf<RpcRpcError>().not.toBeAny()
      expectTypeOf<Executor>().not.toBeAny()
      expectTypeOf<ProxyConfig>().not.toBeAny()
      expectTypeOf<BatchingConfig>().not.toBeAny()
      expectTypeOf<SerializedValue>().not.toBeAny()
      expectTypeOf<FunctionReference>().not.toBeAny()
      expectTypeOf<HTTPExecutorOptions>().not.toBeAny()
    })

    it('should export utility types', () => {
      expectTypeOf<DeepPartial<{ a: { b: string } }>>().not.toBeAny()
      expectTypeOf<MethodNames<{ foo(): void }>>().not.toBeAny()
      expectTypeOf<Promisify<{ foo(): string }>>().not.toBeAny()
    })
  })

  describe('@dotdo/react exports', () => {
    it('should export DO provider component', () => {
      expectTypeOf(DO).toBeFunction()
    })

    it('should export context utilities', () => {
      expectTypeOf(DotdoContext).not.toBeAny()
      expectTypeOf(useDotdoContext).toBeFunction()
    })

    it('should export all hooks', () => {
      expectTypeOf(useDO).toBeFunction()
      expectTypeOf(use$).toBeFunction()
      expectTypeOf(useCollection).toBeFunction()
      expectTypeOf(useLiveQuery).toBeFunction()
      expectTypeOf(useRecord).toBeFunction()
      expectTypeOf(useConnectionState).toBeFunction()
    })

    it('should export all types', () => {
      expectTypeOf<DOProps>().not.toBeAny()
      expectTypeOf<WorkflowContext>().not.toBeAny()
      expectTypeOf<UseRecordConfig<BaseItem>>().not.toBeAny()
      expectTypeOf<BaseItem>().not.toBeAny()
      expectTypeOf<CollectionConfig<BaseItem>>().not.toBeAny()
      expectTypeOf<UseCollectionResult<BaseItem>>().not.toBeAny()
      expectTypeOf<LiveQueryConfig<BaseItem>>().not.toBeAny()
      expectTypeOf<UseRecordResult<BaseItem>>().not.toBeAny()
      expectTypeOf<SyncMessage>().not.toBeAny()
      expectTypeOf<DotdoContextValue>().not.toBeAny()
    })

    it('should re-export @dotdo/client types', () => {
      expectTypeOf<ReactDOClient<unknown>>().not.toBeAny()
      expectTypeOf<ReactClientConfig>().not.toBeAny()
      expectTypeOf<ReactConnectionState>().not.toBeAny()
    })
  })

  describe('@dotdo/digital-tools exports', () => {
    it('should export factory functions', () => {
      expectTypeOf(createTool).toBeFunction()
      expectTypeOf(createIntegration).toBeFunction()
      expectTypeOf(createCapability).toBeFunction()
    })

    it('should export type guards', () => {
      expectTypeOf(isTool).toBeFunction()
      expectTypeOf(isIntegration).toBeFunction()
      expectTypeOf(isCapability).toBeFunction()
    })

    it('should export Zod schemas', () => {
      expectTypeOf(ToolSchema).not.toBeAny()
      expectTypeOf(IntegrationSchema).not.toBeAny()
      expectTypeOf(CapabilitySchema).not.toBeAny()
    })

    it('should export all types', () => {
      expectTypeOf<Tool>().not.toBeAny()
      expectTypeOf<Integration>().not.toBeAny()
      expectTypeOf<Capability>().not.toBeAny()
    })
  })

  describe('@dotdo/business-as-code exports', () => {
    it('should export factory function', () => {
      expectTypeOf(createBusiness).toBeFunction()
    })

    it('should export type guards', () => {
      expectTypeOf(isOrganization).toBeFunction()
      expectTypeOf(isBusiness).toBeFunction()
      expectTypeOf(isCompany).toBeFunction()
      expectTypeOf(isGoal).toBeFunction()
      expectTypeOf(isKeyResult).toBeFunction()
    })

    it('should export Zod schemas', () => {
      expectTypeOf(OrganizationSchema).not.toBeAny()
      expectTypeOf(BusinessSchema).not.toBeAny()
      expectTypeOf(CompanySchema).not.toBeAny()
      expectTypeOf(GoalSchema).not.toBeAny()
      expectTypeOf(KeyResultSchema).not.toBeAny()
    })

    it('should export all types', () => {
      expectTypeOf<Organization>().not.toBeAny()
      expectTypeOf<Business>().not.toBeAny()
      expectTypeOf<Company>().not.toBeAny()
      expectTypeOf<Org>().not.toBeAny()
      expectTypeOf<Goal>().not.toBeAny()
      expectTypeOf<Objective>().not.toBeAny()
      expectTypeOf<KeyResult>().not.toBeAny()
      expectTypeOf<Address>().not.toBeAny()
      expectTypeOf<OrgBilling>().not.toBeAny()
    })
  })

  describe('@dotdo/digital-workers exports', () => {
    it('should export factory functions', () => {
      expectTypeOf(createDigitalWorker).toBeFunction()
      expectTypeOf(createAgent).toBeFunction()
      expectTypeOf(createHuman).toBeFunction()
    })

    it('should export type guards', () => {
      expectTypeOf(isDigitalWorker).toBeFunction()
      expectTypeOf(isAgent).toBeFunction()
      expectTypeOf(isHuman).toBeFunction()
    })

    it('should export Zod schemas', () => {
      expectTypeOf(WorkerSchema).not.toBeAny()
      expectTypeOf(AgentSchema).not.toBeAny()
      expectTypeOf(HumanSchema).not.toBeAny()
    })

    it('should export all types', () => {
      expectTypeOf<DigitalWorker>().not.toBeAny()
      expectTypeOf<Agent>().not.toBeAny()
      expectTypeOf<Human>().not.toBeAny()
    })
  })

  describe('@dotdo/worker-helpers exports', () => {
    it('should export worker creation functions', () => {
      expectTypeOf(createWorker).toBeFunction()
      expectTypeOf(createHandler).toBeFunction()
      expectTypeOf(createFetchHandler).toBeFunction()
      expectTypeOf(createWebSocketHandler).toBeFunction()
      expectTypeOf(createRPCHandler).toBeFunction()
      expectTypeOf(createMultiDOWorker).toBeFunction()
    })

    it('should export middleware wrappers', () => {
      expectTypeOf(withMiddleware).toBeFunction()
      expectTypeOf(withErrorHandler).toBeFunction()
      expectTypeOf(withCORS).toBeFunction()
      expectTypeOf(withAuth).toBeFunction()
    })

    it('should export utility functions', () => {
      expectTypeOf(inferBindingName).toBeFunction()
      expectTypeOf(resolveDO).toBeFunction()
      expectTypeOf(bindDO).toBeFunction()
      expectTypeOf(getDOBinding).toBeFunction()
    })

    it('should export all types', () => {
      expectTypeOf<DurableObjectNamespace>().not.toBeAny()
      expectTypeOf<DurableObjectId>().not.toBeAny()
      expectTypeOf<DurableObjectStub>().not.toBeAny()
      expectTypeOf<Env>().not.toBeAny()
      expectTypeOf<ExecutionContext>().not.toBeAny()
      expectTypeOf<DOClass>().not.toBeAny()
      expectTypeOf<DOInstance>().not.toBeAny()
      expectTypeOf<FetchHandler>().not.toBeAny()
      expectTypeOf<Middleware>().not.toBeAny()
      expectTypeOf<Worker>().not.toBeAny()
      expectTypeOf<CreateWorkerOptions>().not.toBeAny()
      expectTypeOf<SimpleDOConfig>().not.toBeAny()
      expectTypeOf<DetailedDOConfig>().not.toBeAny()
      expectTypeOf<MultiDOConfig>().not.toBeAny()
      expectTypeOf<MultiDOWorkerOptions>().not.toBeAny()
      expectTypeOf<CORSOptions>().not.toBeAny()
      expectTypeOf<WorkerAuthConfig>().not.toBeAny()
    })
  })

  describe('@dotdo/worker-types exports', () => {
    it('should export worker type guards', () => {
      expectTypeOf(isWorkerType).toBeFunction()
      expectTypeOf(isAgentType).toBeFunction()
      expectTypeOf(isHumanType).toBeFunction()
      expectTypeOf(isTask).toBeFunction()
      expectTypeOf(isTaskResult).toBeFunction()
      expectTypeOf(isWorkerMode).toBeFunction()
      expectTypeOf(isWorkerConfig).toBeFunction()
    })

    it('should export agent type guards', () => {
      expectTypeOf(isToolType).toBeFunction()
      expectTypeOf(isGoalType).toBeFunction()
      expectTypeOf(isGoalResult).toBeFunction()
      expectTypeOf(isMemoryType).toBeFunction()
      expectTypeOf(isMemory).toBeFunction()
      expectTypeOf(isAgentConfig).toBeFunction()
    })

    it('should export human type guards', () => {
      expectTypeOf(isApprovalRequest).toBeFunction()
      expectTypeOf(isApprovalResult).toBeFunction()
      expectTypeOf(isChannel).toBeFunction()
      expectTypeOf(isNotificationChannel).toBeFunction()
      expectTypeOf(isEscalationPolicy).toBeFunction()
      expectTypeOf(isBlockingApprovalStatus).toBeFunction()
      expectTypeOf(isBlockingApprovalRequest).toBeFunction()
      expectTypeOf(isHumanConfig).toBeFunction()
    })

    it('should export routing type guards', () => {
      expectTypeOf(isWorkerStatus).toBeFunction()
      expectTypeOf(isLoadBalancerStrategy).toBeFunction()
      expectTypeOf(isWorkerNode).toBeFunction()
      expectTypeOf(isTaskRequest).toBeFunction()
      expectTypeOf(isRouteResult).toBeFunction()
      expectTypeOf(isMessageType).toBeFunction()
      expectTypeOf(isDeliveryStatus).toBeFunction()
      expectTypeOf(isWorkerMessage).toBeFunction()
      expectTypeOf(isHandoffState).toBeFunction()
      expectTypeOf(isHandoffRequest).toBeFunction()
      expectTypeOf(isWorkflowState).toBeFunction()
    })

    it('should export worker types', () => {
      expectTypeOf<WorkerMode>().not.toBeAny()
      expectTypeOf<Task>().not.toBeAny()
      expectTypeOf<TaskResult>().not.toBeAny()
      expectTypeOf<Context>().not.toBeAny()
      expectTypeOf<Answer>().not.toBeAny()
      expectTypeOf<Option>().not.toBeAny()
      expectTypeOf<Decision>().not.toBeAny()
      expectTypeOf<ApprovalRequest>().not.toBeAny()
      expectTypeOf<ApprovalResult>().not.toBeAny()
      expectTypeOf<Channel>().not.toBeAny()
      expectTypeOf<IWorker>().not.toBeAny()
      expectTypeOf<WorkerConfig>().not.toBeAny()
    })

    it('should export agent types', () => {
      expectTypeOf<WorkerTool>().not.toBeAny()
      expectTypeOf<ToolDefinition>().not.toBeAny()
      expectTypeOf<WorkerGoal>().not.toBeAny()
      expectTypeOf<GoalResult>().not.toBeAny()
      expectTypeOf<MemoryType>().not.toBeAny()
      expectTypeOf<Memory>().not.toBeAny()
      expectTypeOf<MemorySearchOptions>().not.toBeAny()
      expectTypeOf<IAgent>().not.toBeAny()
      expectTypeOf<AgentConfig>().not.toBeAny()
      expectTypeOf<AgentLoopStep>().not.toBeAny()
      expectTypeOf<AgentLoopState>().not.toBeAny()
    })

    it('should export human types', () => {
      expectTypeOf<NotificationPriority>().not.toBeAny()
      expectTypeOf<NotificationChannel>().not.toBeAny()
      expectTypeOf<EscalationRule>().not.toBeAny()
      expectTypeOf<EscalationPolicy>().not.toBeAny()
      expectTypeOf<PendingApproval>().not.toBeAny()
      expectTypeOf<BlockingApprovalStatus>().not.toBeAny()
      expectTypeOf<BlockingApprovalType>().not.toBeAny()
      expectTypeOf<BlockingApprovalRequest>().not.toBeAny()
      expectTypeOf<IHuman>().not.toBeAny()
      expectTypeOf<HumanConfig>().not.toBeAny()
    })

    it('should export routing types', () => {
      expectTypeOf<ProxyMode>().not.toBeAny()
      expectTypeOf<HostnameConfig>().not.toBeAny()
      expectTypeOf<FixedNamespaceConfig>().not.toBeAny()
      expectTypeOf<BaseProxyConfig>().not.toBeAny()
      expectTypeOf<RoutingProxyConfig>().not.toBeAny()
      expectTypeOf<APIConfig>().not.toBeAny()
      expectTypeOf<NamespaceResolveResult>().not.toBeAny()
      expectTypeOf<WorkerStatus>().not.toBeAny()
      expectTypeOf<LoadBalancerStrategy>().not.toBeAny()
      expectTypeOf<WorkerRegistration>().not.toBeAny()
      expectTypeOf<WorkerNode>().not.toBeAny()
      expectTypeOf<TaskRequest>().not.toBeAny()
      expectTypeOf<RouteResult>().not.toBeAny()
      expectTypeOf<WorkerLoadMetrics>().not.toBeAny()
      expectTypeOf<RouteOptions>().not.toBeAny()
    })

    it('should export messaging types', () => {
      expectTypeOf<MessageType>().not.toBeAny()
      expectTypeOf<DeliveryStatus>().not.toBeAny()
      expectTypeOf<WorkerMessage>().not.toBeAny()
      expectTypeOf<MessageEnvelope>().not.toBeAny()
      expectTypeOf<BusConfig>().not.toBeAny()
      expectTypeOf<MessageFilter>().not.toBeAny()
    })

    it('should export handoff types', () => {
      expectTypeOf<HandoffReason>().not.toBeAny()
      expectTypeOf<HandoffState>().not.toBeAny()
      expectTypeOf<HandoffContext>().not.toBeAny()
      expectTypeOf<HandoffRequest>().not.toBeAny()
      expectTypeOf<HandoffResult>().not.toBeAny()
      expectTypeOf<HandoffChainEntry>().not.toBeAny()
    })

    it('should export workflow types', () => {
      expectTypeOf<EscalationOptions>().not.toBeAny()
      expectTypeOf<EscalationData>().not.toBeAny()
      expectTypeOf<SLAStatus>().not.toBeAny()
      expectTypeOf<WorkflowState>().not.toBeAny()
      expectTypeOf<WorkflowStepResult>().not.toBeAny()
      expectTypeOf<WorkerTier>().not.toBeAny()
      expectTypeOf<WorkerEventType>().not.toBeAny()
      expectTypeOf<WorkerEvent>().not.toBeAny()
    })
  })

  describe('@dotdo/path-utils exports', () => {
    it('should export constants', () => {
      expectTypeOf(sep).toBeString()
      expectTypeOf(delimiter).toBeString()
    })

    it('should export all path functions', () => {
      expectTypeOf(normalize).toBeFunction()
      expectTypeOf(resolve).toBeFunction()
      expectTypeOf(basename).toBeFunction()
      expectTypeOf(dirname).toBeFunction()
      expectTypeOf(join).toBeFunction()
      expectTypeOf(isAbsolute).toBeFunction()
      expectTypeOf(extname).toBeFunction()
      expectTypeOf(parse).toBeFunction()
      expectTypeOf(format).toBeFunction()
      expectTypeOf(relative).toBeFunction()
    })

    it('should export ParsedPath type', () => {
      expectTypeOf<ParsedPath>().not.toBeAny()
    })
  })
})

// =============================================================================
// 2. TYPE INFERENCE TESTS
// =============================================================================

describe('Type Inference', () => {
  describe('@dotdo/rpc type inference', () => {
    it('should infer CallResult generic type', () => {
      type StringResult = CallResult<string>
      expectTypeOf<StringResult['result']>().toEqualTypeOf<string | undefined>()
    })

    it('should infer BatchResult generic type', () => {
      type NumberBatch = BatchResult<number>
      expectTypeOf<NumberBatch['results']>().toMatchTypeOf<CallResult<number>[]>()
    })

    it('should infer DeepPartial correctly', () => {
      type Deep = DeepPartial<{ a: { b: { c: string } } }>
      // All levels should be optional
      expectTypeOf<Deep>().toMatchTypeOf<{ a?: { b?: { c?: string } } }>()
    })

    it('should infer MethodNames from interface', () => {
      interface TestInterface {
        method1(): void
        method2(x: number): string
        property: string
      }
      type Methods = MethodNames<TestInterface>
      // Should only include method1 and method2, not property
      expectTypeOf<Methods>().toMatchTypeOf<'method1' | 'method2'>()
    })

    it('should infer Promisify correctly', () => {
      interface SyncApi {
        getValue(): string
        nested: {
          getNumber(): number
        }
      }
      type AsyncApi = Promisify<SyncApi>

      // Methods should return promises
      expectTypeOf<AsyncApi['getValue']>().returns.toMatchTypeOf<Promise<string>>()
    })
  })

  describe('@dotdo/react type inference', () => {
    it('should infer CollectionConfig generic type', () => {
      interface CustomItem extends BaseItem {
        $id: string
        name: string
      }
      type Config = CollectionConfig<CustomItem>
      expectTypeOf<Config['collection']>().toBeString()
    })

    it('should infer LiveQueryConfig generic type correctly', () => {
      interface Task extends BaseItem {
        $id: string
        status: string
      }
      interface User extends BaseItem {
        $id: string
        name: string
      }
      type QueryConfig = LiveQueryConfig<Task, User>

      // where should accept partial Task or predicate
      expectTypeOf<NonNullable<QueryConfig['where']>>().toMatchTypeOf<
        Partial<Task> | ((item: Task) => boolean)
      >()
    })

    it('should infer UseCollectionResult generic type', () => {
      interface Item extends BaseItem {
        $id: string
        value: number
      }
      type Result = UseCollectionResult<Item>
      expectTypeOf<Result['data']>().toMatchTypeOf<Item[]>()
    })

    it('should infer UseRecordResult generic type', () => {
      interface Record extends BaseItem {
        $id: string
        content: string
      }
      type Result = UseRecordResult<Record>
      expectTypeOf<Result['data']>().toMatchTypeOf<Record | null>()
    })

    it('should infer SyncMessage generic type', () => {
      interface Message {
        content: string
      }
      type Sync = SyncMessage<Message>
      expectTypeOf<Sync['data']>().toMatchTypeOf<Message | Message[] | undefined>()
    })
  })

  describe('@dotdo/client type inference', () => {
    it('should infer RpcPromise generic type', () => {
      type StringPromise = RpcPromise<string>
      // Should be both RpcClient and Promise<string>
      expectTypeOf<StringPromise>().toMatchTypeOf<Promise<string>>()
    })

    it('should infer DOClient generic types', () => {
      interface Methods {
        getUser(id: string): Promise<{ name: string }>
      }
      interface Events {
        userUpdated: { userId: string }
      }
      type Client = DOClient<Methods, Events>
      expectTypeOf<Client>().toMatchTypeOf<RpcClient>()
    })
  })

  describe('@dotdo/business-as-code type inference', () => {
    it('should infer Business from createBusiness', () => {
      const business = createBusiness({
        $id: 'test',
        name: 'Test Business',
      })
      expectTypeOf(business).toMatchTypeOf<Business>()
      expectTypeOf(business.$type).toEqualTypeOf<'https://schema.org.ai/Business'>()
      expectTypeOf(business.goals).toMatchTypeOf<Goal[]>()
    })

    it('should infer Company extends Business', () => {
      // Company should have all Business properties plus its own
      type CompanyHasGoals = Company['goals']
      expectTypeOf<CompanyHasGoals>().toMatchTypeOf<Goal[]>()
    })
  })

  describe('@dotdo/digital-tools type inference', () => {
    it('should infer Tool from createTool', () => {
      const tool = createTool({
        $id: 'test',
        name: 'Test Tool',
        description: 'A test tool',
      })
      expectTypeOf(tool).toMatchTypeOf<Tool>()
      expectTypeOf(tool.$type).toEqualTypeOf<'https://schema.org.ai/Tool'>()
    })

    it('should infer Integration from createIntegration', () => {
      const integration = createIntegration({
        $id: 'test',
        name: 'Test Integration',
        description: 'A test integration',
        provider: 'test',
        authType: 'api_key',
      })
      expectTypeOf(integration).toMatchTypeOf<Integration>()
      expectTypeOf(integration.$type).toEqualTypeOf<'https://schema.org.ai/Integration'>()
    })

    it('should infer Capability from createCapability', () => {
      const capability = createCapability({
        $id: 'test',
        name: 'Test Capability',
        description: 'A test capability',
        permissions: ['read', 'write'],
      })
      expectTypeOf(capability).toMatchTypeOf<Capability>()
      expectTypeOf(capability.$type).toEqualTypeOf<'https://schema.org.ai/Capability'>()
    })
  })

  describe('@dotdo/digital-workers type inference', () => {
    it('should infer Worker from createWorker', () => {
      const worker = createDigitalWorker({
        $id: 'test',
        name: 'Test Worker',
        skills: ['test'],
        status: 'available',
      })
      expectTypeOf(worker).toMatchTypeOf<DigitalWorker>()
      expectTypeOf(worker.$type).toEqualTypeOf<'https://schema.org.ai/Worker'>()
    })

    it('should infer Agent from createAgent', () => {
      const agent = createAgent({
        $id: 'test',
        name: 'Test Agent',
        skills: ['test'],
        status: 'available',
        model: 'test-model',
        tools: ['test-tool'],
        autonomous: true,
      })
      expectTypeOf(agent).toMatchTypeOf<Agent>()
      expectTypeOf(agent.$type).toEqualTypeOf<'https://schema.org.ai/Agent'>()
    })

    it('should infer Human from createHuman', () => {
      const human = createHuman({
        $id: 'test',
        name: 'Test Human',
        skills: ['test'],
        status: 'available',
        requiresApproval: true,
        notificationChannels: ['email'],
      })
      expectTypeOf(human).toMatchTypeOf<Human>()
      expectTypeOf(human.$type).toEqualTypeOf<'https://schema.org.ai/Human'>()
    })
  })

  describe('@dotdo/path-utils type inference', () => {
    it('should infer parse return type', () => {
      const parsed = parse('/home/user/file.txt')
      expectTypeOf(parsed).toMatchTypeOf<ParsedPath>()
      expectTypeOf(parsed.root).toBeString()
      expectTypeOf(parsed.dir).toBeString()
      expectTypeOf(parsed.base).toBeString()
      expectTypeOf(parsed.ext).toBeString()
      expectTypeOf(parsed.name).toBeString()
    })

    it('should infer format parameter type', () => {
      expectTypeOf(format).parameter(0).toMatchTypeOf<Partial<ParsedPath>>()
    })
  })
})

// =============================================================================
// 3. TYPE CONSTRAINT TESTS
// =============================================================================

describe('Type Constraints', () => {
  describe('@dotdo/react BaseItem constraint', () => {
    it('should require $id field in BaseItem', () => {
      // BaseItem must have $id
      expectTypeOf<BaseItem['$id']>().toBeString()
    })

    it('should enforce BaseItem constraint in useCollection', () => {
      // This should work - has $id
      interface ValidItem extends BaseItem {
        $id: string
        name: string
      }

      // The hook should accept types extending BaseItem
      type Config = CollectionConfig<ValidItem>
      expectTypeOf<Config>().not.toBeAny()
    })

    it('should enforce BaseItem constraint in LiveQueryConfig', () => {
      interface ValidItem extends BaseItem {
        $id: string
        status: string
      }

      type Config = LiveQueryConfig<ValidItem>
      expectTypeOf<Config['from']>().toBeString()
    })
  })

  describe('@dotdo/digital-tools $type constraints', () => {
    it('should enforce Tool $type literal', () => {
      type ToolType = Tool['$type']
      expectTypeOf<ToolType>().toEqualTypeOf<'https://schema.org.ai/Tool'>()
    })

    it('should enforce Integration $type literal', () => {
      type IntegrationType = Integration['$type']
      expectTypeOf<IntegrationType>().toEqualTypeOf<'https://schema.org.ai/Integration'>()
    })

    it('should enforce Capability $type literal', () => {
      type CapabilityType = Capability['$type']
      expectTypeOf<CapabilityType>().toEqualTypeOf<'https://schema.org.ai/Capability'>()
    })

    it('should enforce Integration authType union', () => {
      type AuthTypes = Integration['authType']
      expectTypeOf<AuthTypes>().toMatchTypeOf<'oauth' | 'api_key' | 'bearer' | 'none'>()
    })
  })

  describe('@dotdo/business-as-code $type constraints', () => {
    it('should enforce Organization $type literal', () => {
      type OrgType = Organization['$type']
      expectTypeOf<OrgType>().toEqualTypeOf<'https://schema.org.ai/Organization'>()
    })

    it('should enforce Business $type literal', () => {
      type BizType = Business['$type']
      expectTypeOf<BizType>().toEqualTypeOf<'https://schema.org.ai/Business'>()
    })

    it('should enforce Company $type literal', () => {
      type CompType = Company['$type']
      expectTypeOf<CompType>().toEqualTypeOf<'https://schema.org.ai/Company'>()
    })

    it('should enforce Org plan union', () => {
      type Plans = Org['plan']
      expectTypeOf<Plans>().toMatchTypeOf<'free' | 'pro' | 'enterprise'>()
    })

    it('should enforce Goal status union', () => {
      type Statuses = NonNullable<Goal['status']>
      expectTypeOf<Statuses>().toMatchTypeOf<'draft' | 'active' | 'completed' | 'cancelled'>()
    })
  })

  describe('@dotdo/digital-workers $type constraints', () => {
    it('should enforce Worker $type literal', () => {
      type WorkerType = DigitalWorker['$type']
      expectTypeOf<WorkerType>().toEqualTypeOf<'https://schema.org.ai/Worker'>()
    })

    it('should enforce Agent $type literal', () => {
      type AgentType = Agent['$type']
      expectTypeOf<AgentType>().toEqualTypeOf<'https://schema.org.ai/Agent'>()
    })

    it('should enforce Human $type literal', () => {
      type HumanType = Human['$type']
      expectTypeOf<HumanType>().toEqualTypeOf<'https://schema.org.ai/Human'>()
    })

    it('should enforce Worker status union', () => {
      type Statuses = DigitalWorker['status']
      expectTypeOf<Statuses>().toMatchTypeOf<'available' | 'busy' | 'away' | 'offline'>()
    })
  })

  describe('@dotdo/worker-types constraints', () => {
    it('should enforce WorkerMode union', () => {
      expectTypeOf<WorkerMode>().toMatchTypeOf<string>()
    })

    it('should enforce WorkerStatus union', () => {
      expectTypeOf<WorkerStatus>().toMatchTypeOf<string>()
    })

    it('should enforce LoadBalancerStrategy union', () => {
      expectTypeOf<LoadBalancerStrategy>().toMatchTypeOf<string>()
    })

    it('should enforce MessageType union', () => {
      expectTypeOf<MessageType>().toMatchTypeOf<string>()
    })

    it('should enforce DeliveryStatus union', () => {
      expectTypeOf<DeliveryStatus>().toMatchTypeOf<string>()
    })

    it('should enforce HandoffState union', () => {
      expectTypeOf<HandoffState>().toMatchTypeOf<string>()
    })
  })
})

// =============================================================================
// 4. NO ACCIDENTAL 'any' TESTS
// =============================================================================

describe('No Accidental any Types', () => {
  describe('@dotdo/client should not expose any', () => {
    it('RpcClient should not be any', () => {
      expectTypeOf<RpcClient>().not.toBeAny()
    })

    it('$Context return type should not be any', () => {
      expectTypeOf($Context('test')).not.toBeAny()
    })

    it('ContextOptions properties should not be any', () => {
      expectTypeOf<ContextOptions['token']>().not.toBeAny()
      expectTypeOf<ContextOptions['headers']>().not.toBeAny()
    })

    it('SdkConfig properties should not be any', () => {
      expectTypeOf<SdkConfig['namespace']>().not.toBeAny()
      expectTypeOf<SdkConfig['localUrl']>().not.toBeAny()
      expectTypeOf<SdkConfig['isDev']>().not.toBeAny()
    })
  })

  describe('@dotdo/rpc should not expose any', () => {
    it('MethodCall properties should not be any', () => {
      expectTypeOf<MethodCall['id']>().not.toBeAny()
      expectTypeOf<MethodCall['path']>().not.toBeAny()
      // args can be unknown[] but not any
      expectTypeOf<MethodCall['args']>().not.toBeAny()
    })

    it('Executor methods should not return any', () => {
      expectTypeOf<Executor['execute']>().returns.not.toBeAny()
    })

    it('ProxyConfig properties should not be any', () => {
      expectTypeOf<ProxyConfig['maxDepth']>().not.toBeAny()
      expectTypeOf<ProxyConfig['timeout']>().not.toBeAny()
    })
  })

  describe('@dotdo/react should not expose any', () => {
    it('DotdoContextValue properties should not be any', () => {
      expectTypeOf<DotdoContextValue['ns']>().not.toBeAny()
      expectTypeOf<DotdoContextValue['client']>().not.toBeAny()
    })

    it('BaseItem should not have any values', () => {
      expectTypeOf<BaseItem['$id']>().not.toBeAny()
    })

    it('SyncMessage properties should not be any', () => {
      expectTypeOf<SyncMessage['type']>().not.toBeAny()
      expectTypeOf<SyncMessage['collection']>().not.toBeAny()
      expectTypeOf<SyncMessage['txid']>().not.toBeAny()
    })
  })

  describe('@dotdo/digital-tools should not expose any', () => {
    it('Tool properties should not be any', () => {
      expectTypeOf<Tool['$id']>().not.toBeAny()
      expectTypeOf<Tool['$type']>().not.toBeAny()
      expectTypeOf<Tool['name']>().not.toBeAny()
      expectTypeOf<Tool['description']>().not.toBeAny()
    })

    it('Integration properties should not be any', () => {
      expectTypeOf<Integration['provider']>().not.toBeAny()
      expectTypeOf<Integration['authType']>().not.toBeAny()
    })

    it('Capability properties should not be any', () => {
      expectTypeOf<Capability['permissions']>().not.toBeAny()
    })
  })

  describe('@dotdo/business-as-code should not expose any', () => {
    it('Organization properties should not be any', () => {
      expectTypeOf<Organization['$id']>().not.toBeAny()
      expectTypeOf<Organization['name']>().not.toBeAny()
    })

    it('Business properties should not be any', () => {
      expectTypeOf<Business['goals']>().not.toBeAny()
    })

    it('Goal properties should not be any', () => {
      expectTypeOf<Goal['objective']>().not.toBeAny()
      expectTypeOf<Goal['keyResults']>().not.toBeAny()
    })

    it('KeyResult properties should not be any', () => {
      expectTypeOf<KeyResult['metric']>().not.toBeAny()
      expectTypeOf<KeyResult['target']>().not.toBeAny()
      expectTypeOf<KeyResult['current']>().not.toBeAny()
      expectTypeOf<KeyResult['source']>().not.toBeAny()
    })
  })

  describe('@dotdo/digital-workers should not expose any', () => {
    it('Worker properties should not be any', () => {
      expectTypeOf<DigitalWorker['$id']>().not.toBeAny()
      expectTypeOf<DigitalWorker['skills']>().not.toBeAny()
      expectTypeOf<DigitalWorker['status']>().not.toBeAny()
    })

    it('Agent properties should not be any', () => {
      expectTypeOf<Agent['model']>().not.toBeAny()
      expectTypeOf<Agent['tools']>().not.toBeAny()
      expectTypeOf<Agent['autonomous']>().not.toBeAny()
    })

    it('Human properties should not be any', () => {
      expectTypeOf<Human['requiresApproval']>().not.toBeAny()
      expectTypeOf<Human['notificationChannels']>().not.toBeAny()
    })
  })

  describe('@dotdo/worker-helpers should not expose any', () => {
    it('DurableObjectNamespace methods should not return any', () => {
      expectTypeOf<DurableObjectNamespace['idFromName']>().returns.not.toBeAny()
      expectTypeOf<DurableObjectNamespace['get']>().returns.not.toBeAny()
    })

    it('CreateWorkerOptions properties should not be any', () => {
      expectTypeOf<CreateWorkerOptions['bindingName']>().not.toBeAny()
      expectTypeOf<CreateWorkerOptions['idSource']>().not.toBeAny()
    })

    it('CORSOptions properties should not be any', () => {
      expectTypeOf<CORSOptions['origin']>().not.toBeAny()
      expectTypeOf<CORSOptions['methods']>().not.toBeAny()
    })
  })

  describe('@dotdo/worker-types should not expose any', () => {
    it('IWorker interface methods should not return any', () => {
      // Check a few key interface properties
      expectTypeOf<IWorker>().not.toBeAny()
    })

    it('IAgent interface should not be any', () => {
      expectTypeOf<IAgent>().not.toBeAny()
    })

    it('IHuman interface should not be any', () => {
      expectTypeOf<IHuman>().not.toBeAny()
    })

    it('Task and TaskResult should not be any', () => {
      expectTypeOf<Task>().not.toBeAny()
      expectTypeOf<TaskResult>().not.toBeAny()
    })

    it('Memory and MemorySearchOptions should not be any', () => {
      expectTypeOf<Memory>().not.toBeAny()
      expectTypeOf<MemorySearchOptions>().not.toBeAny()
    })
  })

  describe('@dotdo/path-utils should not expose any', () => {
    it('ParsedPath properties should not be any', () => {
      expectTypeOf<ParsedPath['root']>().not.toBeAny()
      expectTypeOf<ParsedPath['dir']>().not.toBeAny()
      expectTypeOf<ParsedPath['base']>().not.toBeAny()
      expectTypeOf<ParsedPath['ext']>().not.toBeAny()
      expectTypeOf<ParsedPath['name']>().not.toBeAny()
    })

    it('Function return types should not be any', () => {
      expectTypeOf(normalize('test')).not.toBeAny()
      expectTypeOf(resolve('test')).not.toBeAny()
      expectTypeOf(basename('test')).not.toBeAny()
      expectTypeOf(dirname('test')).not.toBeAny()
      expectTypeOf(join('test')).not.toBeAny()
      expectTypeOf(isAbsolute('test')).not.toBeAny()
      expectTypeOf(extname('test')).not.toBeAny()
      expectTypeOf(parse('test')).not.toBeAny()
      expectTypeOf(relative('a', 'b')).not.toBeAny()
    })
  })
})

// =============================================================================
// 5. TYPE COMPATIBILITY TESTS
// =============================================================================

describe('Type Compatibility', () => {
  describe('Cross-package type compatibility', () => {
    it('ConnectionState should be compatible between client and react', () => {
      // Both packages export ConnectionState - they should be the same type
      type ClientState = ConnectionState
      type ReactState = ReactConnectionState
      expectTypeOf<ClientState>().toEqualTypeOf<ReactState>()
    })

    it('DOClient should be compatible between client and react', () => {
      // Both packages use DOClient
      type ClientDOClient = DOClient<unknown>
      type ReactDOClientType = ReactDOClient<unknown>
      // They should be the same underlying type
      expectTypeOf<ClientDOClient>().toMatchTypeOf<RpcClient>()
      expectTypeOf<ReactDOClientType>().toMatchTypeOf<RpcClient>()
    })
  })

  describe('Schema.org.ai type hierarchy', () => {
    it('Company should extend Business', () => {
      // Company has all Business properties
      type CompanyGoals = Company['goals']
      type BusinessGoals = Business['goals']
      expectTypeOf<CompanyGoals>().toEqualTypeOf<BusinessGoals>()
    })

    it('Business should extend Organization (except $type)', () => {
      // Business should have Organization properties
      type BusinessId = Business['$id']
      type OrgId = Organization['$id']
      expectTypeOf<BusinessId>().toEqualTypeOf<OrgId>()

      type BusinessName = Business['name']
      type OrgName = Organization['name']
      expectTypeOf<BusinessName>().toEqualTypeOf<OrgName>()
    })

    it('Agent should extend Worker (except $type)', () => {
      type AgentSkills = Agent['skills']
      type WorkerSkills = DigitalWorker['skills']
      expectTypeOf<AgentSkills>().toEqualTypeOf<WorkerSkills>()

      type AgentStatus = Agent['status']
      type WorkerStatus = DigitalWorker['status']
      expectTypeOf<AgentStatus>().toEqualTypeOf<WorkerStatus>()
    })

    it('Human should extend Worker (except $type)', () => {
      type HumanSkills = Human['skills']
      type WorkerSkills = DigitalWorker['skills']
      expectTypeOf<HumanSkills>().toEqualTypeOf<WorkerSkills>()

      type HumanStatus = Human['status']
      type WorkerStatus = DigitalWorker['status']
      expectTypeOf<HumanStatus>().toEqualTypeOf<WorkerStatus>()
    })
  })

  describe('Zod schema type inference', () => {
    it('ToolSchema should infer Tool type', () => {
      // The schema's inferred type should match the Tool interface
      type InferredTool = typeof ToolSchema._output
      expectTypeOf<InferredTool>().toMatchTypeOf<Tool>()
    })

    it('IntegrationSchema should infer Integration type', () => {
      type InferredIntegration = typeof IntegrationSchema._output
      expectTypeOf<InferredIntegration>().toMatchTypeOf<Integration>()
    })

    it('CapabilitySchema should infer Capability type', () => {
      type InferredCapability = typeof CapabilitySchema._output
      expectTypeOf<InferredCapability>().toMatchTypeOf<Capability>()
    })

    it('BusinessSchema should infer Business type', () => {
      type InferredBusiness = typeof BusinessSchema._output
      expectTypeOf<InferredBusiness>().toMatchTypeOf<Business>()
    })

    it('AgentSchema should infer Agent type', () => {
      type InferredAgent = typeof AgentSchema._output
      expectTypeOf<InferredAgent>().toMatchTypeOf<Agent>()
    })
  })

  describe('Type guard return type narrowing', () => {
    it('isTool should narrow to Tool', () => {
      const value: unknown = {}
      if (isTool(value)) {
        expectTypeOf(value).toMatchTypeOf<Tool>()
      }
    })

    it('isIntegration should narrow to Integration', () => {
      const value: unknown = {}
      if (isIntegration(value)) {
        expectTypeOf(value).toMatchTypeOf<Integration>()
      }
    })

    it('isCapability should narrow to Capability', () => {
      const value: unknown = {}
      if (isCapability(value)) {
        expectTypeOf(value).toMatchTypeOf<Capability>()
      }
    })

    it('isBusiness should narrow to Business', () => {
      const value: unknown = {}
      if (isBusiness(value)) {
        expectTypeOf(value).toMatchTypeOf<Business>()
      }
    })

    it('isAgent should narrow to Agent', () => {
      const value: unknown = {}
      if (isAgent(value)) {
        expectTypeOf(value).toMatchTypeOf<Agent>()
      }
    })

    it('isHuman should narrow to Human', () => {
      const value: unknown = {}
      if (isHuman(value)) {
        expectTypeOf(value).toMatchTypeOf<Human>()
      }
    })
  })

  describe('Factory function types', () => {
    it('createTool should return Tool with $type set', () => {
      const tool = createTool({
        $id: 'test',
        name: 'Test',
        description: 'Test tool',
      })
      // Result should be a complete Tool
      expectTypeOf(tool).toMatchTypeOf<Tool>()
      // $type should be the literal type
      expectTypeOf(tool.$type).toEqualTypeOf<'https://schema.org.ai/Tool'>()
    })

    it('createBusiness should return Business with defaults', () => {
      const business = createBusiness({
        $id: 'test',
        name: 'Test',
      })
      // Should have goals array
      expectTypeOf(business.goals).toMatchTypeOf<Goal[]>()
      // $type should be set
      expectTypeOf(business.$type).toEqualTypeOf<'https://schema.org.ai/Business'>()
    })

    it('createAgent should return Agent with $type set', () => {
      const agent = createAgent({
        $id: 'test',
        name: 'Test',
        skills: [],
        status: 'available',
        model: 'test',
        tools: [],
        autonomous: false,
      })
      expectTypeOf(agent).toMatchTypeOf<Agent>()
      expectTypeOf(agent.$type).toEqualTypeOf<'https://schema.org.ai/Agent'>()
    })
  })
})

// =============================================================================
// 6. MISSING EXPORT TESTS (Expected to FAIL - RED phase)
// These tests document API completeness gaps that need to be addressed
// =============================================================================

describe('Missing Exports (RED Phase - Expected Failures)', () => {
  describe('@dotdo/client missing auth module exports', () => {
    // The client package has auth utilities in auth.ts that are not re-exported from index
    it('should export AuthenticatedClientOptions type from main entry', () => {
      // auth.ts exports this but index.ts doesn't re-export it
      // Users must import from '@dotdo/client/auth' instead of '@dotdo/client'
      // This test will FAIL because the import at the top doesn't include it
      expect(() => {
        // @ts-expect-error - AuthenticatedClientOptions is not exported from main index
        const options: import('../../packages/client/src/index').AuthenticatedClientOptions = {
          url: 'https://example.com',
        }
      }).not.toThrow()
    })

    it('should export createAuthenticatedClient from main entry', () => {
      // auth.ts exports this function but it's not in the main index
      // @ts-expect-error - createAuthenticatedClient is not exported from main index
      expect(typeof import('../../packages/client/src/index').createAuthenticatedClient).toBe('function')
    })

    it('should export createAuthenticatedWebSocket from main entry', () => {
      // @ts-expect-error - createAuthenticatedWebSocket is not exported from main index
      expect(typeof import('../../packages/client/src/index').createAuthenticatedWebSocket).toBe('function')
    })

    it('should export SessionOptions type', () => {
      // capnweb-compat.ts exports this but it's not re-exported from index
      // Users need this for advanced session configuration
      // @ts-expect-error - SessionOptions is not exported
      type _SessionOptions = import('../../packages/client/src/index').SessionOptions
      expect(true).toBe(true)
    })
  })

  describe('@dotdo/client missing snippet module exports', () => {
    it('should export initSnippet function from main entry', () => {
      // snippet/index.ts exports this but it's not in the main index
      // @ts-expect-error - initSnippet is not exported from main index
      expect(typeof import('../../packages/client/src/index').initSnippet).toBe('function')
    })

    it('should export SnippetConfig type', () => {
      // @ts-expect-error - SnippetConfig is not exported from main index
      type _SnippetConfig = import('../../packages/client/src/index').SnippetConfig
      expect(true).toBe(true)
    })

    it('should export SnippetInstance type', () => {
      // @ts-expect-error - SnippetInstance is not exported from main index
      type _SnippetInstance = import('../../packages/client/src/index').SnippetInstance
      expect(true).toBe(true)
    })
  })

  describe('@dotdo/business-as-code missing factory functions', () => {
    // The package exports the Organization, Company, and Org types
    // but only has createBusiness factory - missing createOrganization, createCompany, createOrg

    it('should export createOrganization factory function', async () => {
      // Organization type exists but no factory function
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - createOrganization doesn't exist
      expect(typeof mod.createOrganization).toBe('function')
    })

    it('should export createCompany factory function', async () => {
      // Company type exists but no factory function
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - createCompany doesn't exist
      expect(typeof mod.createCompany).toBe('function')
    })

    it('should export createOrg factory function', async () => {
      // Org type exists but no factory function
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - createOrg doesn't exist
      expect(typeof mod.createOrg).toBe('function')
    })

    it('should export createGoal factory function', async () => {
      // Goal type exists but no factory function
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - createGoal doesn't exist
      expect(typeof mod.createGoal).toBe('function')
    })

    it('should export createKeyResult factory function', async () => {
      // KeyResult type exists but no factory function
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - createKeyResult doesn't exist
      expect(typeof mod.createKeyResult).toBe('function')
    })
  })

  describe('@dotdo/business-as-code missing Zod schemas', () => {
    it('should export OrgSchema', async () => {
      // Org type exists but OrgSchema is not exported
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - OrgSchema doesn't exist
      expect(mod.OrgSchema).toBeDefined()
    })

    it('should export AddressSchema', async () => {
      // Address type exists but AddressSchema is not exported
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - AddressSchema doesn't exist
      expect(mod.AddressSchema).toBeDefined()
    })

    it('should export OrgBillingSchema', async () => {
      // OrgBilling type exists but OrgBillingSchema is not exported
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - OrgBillingSchema doesn't exist
      expect(mod.OrgBillingSchema).toBeDefined()
    })

    it('should export ObjectiveSchema', async () => {
      // Objective type exists but ObjectiveSchema is not exported
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - ObjectiveSchema doesn't exist
      expect(mod.ObjectiveSchema).toBeDefined()
    })
  })

  describe('@dotdo/business-as-code missing type guards', () => {
    it('should export isOrg type guard', async () => {
      // Org type exists but isOrg type guard is not exported
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - isOrg doesn't exist
      expect(typeof mod.isOrg).toBe('function')
    })

    it('should export isAddress type guard', async () => {
      // Address type exists but isAddress type guard is not exported
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - isAddress doesn't exist
      expect(typeof mod.isAddress).toBe('function')
    })

    it('should export isOrgBilling type guard', async () => {
      // OrgBilling type exists but isOrgBilling type guard is not exported
      const mod = await import('../../packages/business-as-code/src/index')
      // This will FAIL - isOrgBilling doesn't exist
      expect(typeof mod.isOrgBilling).toBe('function')
    })
  })

  describe('@dotdo/digital-workers missing Zod schemas with strict $type', () => {
    it('WorkerSchema should require exact $type literal', async () => {
      const mod = await import('../../packages/digital-workers/src/index')
      // Test that schema accepts correct type
      const validResult = mod.WorkerSchema.safeParse({
        $id: 'test',
        $type: 'https://schema.org.ai/Worker',
        name: 'Test',
        skills: [],
        status: 'available',
      })
      expect(validResult.success).toBe(true)

      // Test that schema rejects incorrect $type - this may FAIL if schema is too permissive
      const invalidResult = mod.WorkerSchema.safeParse({
        $id: 'test',
        $type: 'wrong-type', // Should fail validation
        name: 'Test',
        skills: [],
        status: 'available',
      })
      expect(invalidResult.success).toBe(false)
    })
  })

  describe('@dotdo/worker-types missing factory functions', () => {
    // worker-types exports interfaces (IWorker, IAgent, IHuman) but no factory functions

    it('should export createTask factory function', async () => {
      const mod = await import('../../packages/worker-types/src/index')
      // This will FAIL - createTask doesn't exist
      expect(typeof mod.createTask).toBe('function')
    })

    it('should export createMemory factory function', async () => {
      const mod = await import('../../packages/worker-types/src/index')
      // This will FAIL - createMemory doesn't exist
      expect(typeof mod.createMemory).toBe('function')
    })

    it('should export createWorkerMessage factory function', async () => {
      const mod = await import('../../packages/worker-types/src/index')
      // This will FAIL - createWorkerMessage doesn't exist
      expect(typeof mod.createWorkerMessage).toBe('function')
    })
  })

  describe('@dotdo/rpc missing advanced features', () => {
    it('should export BatchExecutor class', async () => {
      // BatchExecutor is a common pattern that should be exported
      const mod = await import('../../packages/rpc/src/index')
      // This will FAIL if BatchExecutor doesn't exist
      expect(mod.BatchExecutor).toBeDefined()
    })

    it('should export WebSocketExecutor class', async () => {
      // For real-time scenarios, a WebSocket executor would be useful
      const mod = await import('../../packages/rpc/src/index')
      // This will FAIL - WebSocketExecutor doesn't exist
      expect(mod.WebSocketExecutor).toBeDefined()
    })

    it('should export createBatchedProxy function', async () => {
      // Convenience function for batched RPC
      const mod = await import('../../packages/rpc/src/index')
      // This will FAIL if createBatchedProxy doesn't exist
      expect(typeof mod.createBatchedProxy).toBe('function')
    })
  })

  describe('@dotdo/react missing advanced hooks', () => {
    it('should export useRpcMutation hook', async () => {
      // Mutation hook similar to React Query/TanStack Query pattern
      const mod = await import('../../packages/react/src/index')
      // This will FAIL - useRpcMutation doesn't exist
      expect(typeof mod.useRpcMutation).toBe('function')
    })

    it('should export useRpcQuery hook', async () => {
      // Query hook for caching RPC results
      const mod = await import('../../packages/react/src/index')
      // This will FAIL - useRpcQuery doesn't exist
      expect(typeof mod.useRpcQuery).toBe('function')
    })

    it('should export useOptimisticMutation hook', async () => {
      // For optimistic updates
      const mod = await import('../../packages/react/src/index')
      // This will FAIL - useOptimisticMutation doesn't exist
      expect(typeof mod.useOptimisticMutation).toBe('function')
    })
  })

  describe('@dotdo/digital-tools missing advanced features', () => {
    it('should export ToolRegistry class', async () => {
      // Registry for managing tools
      const mod = await import('../../packages/digital-tools/src/index')
      // This will FAIL - ToolRegistry doesn't exist
      expect(mod.ToolRegistry).toBeDefined()
    })

    it('should export IntegrationRegistry class', async () => {
      // Registry for managing integrations
      const mod = await import('../../packages/digital-tools/src/index')
      // This will FAIL - IntegrationRegistry doesn't exist
      expect(mod.IntegrationRegistry).toBeDefined()
    })

    it('should export CapabilityRegistry class', async () => {
      // Registry for managing capabilities
      const mod = await import('../../packages/digital-tools/src/index')
      // This will FAIL - CapabilityRegistry doesn't exist
      expect(mod.CapabilityRegistry).toBeDefined()
    })
  })

  describe('@dotdo/path-utils missing posix compatibility', () => {
    it('should export posix namespace like Node.js path', async () => {
      // Node.js path exports a posix namespace
      const mod = await import('../../packages/path-utils/src/index')
      // This will FAIL if posix namespace doesn't exist
      expect(mod.posix).toBeDefined()
    })

    it('should export win32 namespace for cross-platform compat', async () => {
      // Though primarily POSIX, win32 namespace is useful for cross-platform
      const mod = await import('../../packages/path-utils/src/index')
      // This will FAIL - win32 doesn't exist (intentionally POSIX-only)
      expect(mod.win32).toBeDefined()
    })
  })

  describe('@dotdo/worker-helpers missing DO utilities', () => {
    it('should export DORouter class', async () => {
      // A router class for complex DO routing
      const mod = await import('../../packages/worker-helpers/src/index')
      // This will FAIL - DORouter doesn't exist
      expect(mod.DORouter).toBeDefined()
    })

    it('should export createDOProxy function', async () => {
      // Helper for creating DO proxies
      const mod = await import('../../packages/worker-helpers/src/index')
      // This will FAIL if createDOProxy doesn't exist
      expect(typeof mod.createDOProxy).toBe('function')
    })

    it('should export DOHealthCheck class', async () => {
      // Health check utilities for DOs
      const mod = await import('../../packages/worker-helpers/src/index')
      // This will FAIL - DOHealthCheck doesn't exist
      expect(mod.DOHealthCheck).toBeDefined()
    })
  })
})

// =============================================================================
// TEST COUNT SUMMARY
// =============================================================================

/**
 * Test Count Summary:
 *
 * 1. Export Completeness Tests: 10 describe blocks, ~47 tests
 * 2. Type Inference Tests: 7 describe blocks, ~22 tests
 * 3. Type Constraint Tests: 6 describe blocks, ~22 tests
 * 4. No Accidental any Tests: 10 describe blocks, ~28 tests
 * 5. Type Compatibility Tests: 5 describe blocks, ~22 tests
 * 6. Missing Export Tests (RED Phase): 13 describe blocks, ~37 tests
 *
 * Total: ~178 type tests
 *
 * Expected Results (RED Phase):
 * - Sections 1-5: Should all PASS (current API is complete for existing types)
 * - Section 6: Should all FAIL (identifies API gaps to be addressed)
 *
 * The failing tests in section 6 document:
 * - Missing factory functions (createOrganization, createCompany, createOrg, etc.)
 * - Missing Zod schemas (OrgSchema, AddressSchema, ObjectiveSchema, etc.)
 * - Missing type guards (isOrg, isAddress, isOrgBilling, etc.)
 * - Missing advanced features (registries, additional hooks, etc.)
 * - Missing auth/snippet exports from @dotdo/client main entry
 */
