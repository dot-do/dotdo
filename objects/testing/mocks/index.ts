/**
 * Test Infrastructure Mocks
 *
 * Mock classes for testing clone operations, shard coordination,
 * replica behavior, and enhanced pipeline functionality.
 *
 * RED PHASE: These are stub implementations that will fail tests.
 */

// =============================================================================
// Types
// =============================================================================

export interface CloneOperationOptions {
  /** Progress percentage at which to simulate failure (0-100) */
  failAt?: number
  /** Progress percentage at which to simulate delay (0-100) */
  delayAt?: number
  /** Duration of delay in milliseconds */
  delayMs?: number
}

export type ShardRoutingStrategy = 'hash' | 'range' | 'roundRobin'

export interface ShardMetadata {
  index: number
  id: string
  status: 'healthy' | 'unhealthy' | 'draining'
}

export interface ShardCoordinatorOptions {
  strategy?: ShardRoutingStrategy
}

export interface ReplicaState {
  primaryRef: string
  lag: number
  consistent: boolean
  lastSyncAt: Date
}

export interface EnhancedMockPipelineOptions {
  /** If true, queue events during backpressure instead of rejecting */
  queueOnBackpressure?: boolean
  /** Inherit from base mock pipeline */
  errorOnSend?: Error
  sendDelayMs?: number
}

export type EventMatcher = Record<string, unknown> | ((event: unknown) => boolean)

// =============================================================================
// MockCloneOperation
// =============================================================================

export class MockCloneOperation {
  constructor(_options?: CloneOperationOptions) {
    // Stub: Not implemented
  }

  execute(): Promise<void> {
    throw new Error('MockCloneOperation.execute() not implemented')
  }

  getProgress(): number {
    throw new Error('MockCloneOperation.getProgress() not implemented')
  }

  onProgress(_callback: (progress: number) => void): void {
    throw new Error('MockCloneOperation.onProgress() not implemented')
  }

  reset(): void {
    throw new Error('MockCloneOperation.reset() not implemented')
  }

  setOptions(_options: CloneOperationOptions): void {
    throw new Error('MockCloneOperation.setOptions() not implemented')
  }
}

export function createMockCloneOperation(
  options?: CloneOperationOptions
): MockCloneOperation {
  return new MockCloneOperation(options)
}

// =============================================================================
// MockShardCoordinator
// =============================================================================

export class MockShardCoordinator {
  constructor(_shardCount: number, _options?: ShardCoordinatorOptions) {
    // Stub: Not implemented
  }

  route(_id: string): number {
    throw new Error('MockShardCoordinator.route() not implemented')
  }

  getStrategy(): ShardRoutingStrategy {
    throw new Error('MockShardCoordinator.getStrategy() not implemented')
  }

  getShards(): ShardMetadata[] {
    throw new Error('MockShardCoordinator.getShards() not implemented')
  }

  setShardStatus(_index: number, _status: ShardMetadata['status']): void {
    throw new Error('MockShardCoordinator.setShardStatus() not implemented')
  }
}

export function createMockShardCoordinator(
  shardCount: number,
  options?: ShardCoordinatorOptions
): MockShardCoordinator {
  return new MockShardCoordinator(shardCount, options)
}

// =============================================================================
// MockReplica
// =============================================================================

export class MockReplica {
  constructor(_primaryRef: string) {
    // Stub: Not implemented
  }

  setLag(_ms: number): void {
    throw new Error('MockReplica.setLag() not implemented')
  }

  getLag(): number {
    throw new Error('MockReplica.getLag() not implemented')
  }

  sync(): Promise<void> {
    throw new Error('MockReplica.sync() not implemented')
  }

  getState(): ReplicaState {
    throw new Error('MockReplica.getState() not implemented')
  }

  isConsistent(): boolean {
    throw new Error('MockReplica.isConsistent() not implemented')
  }

  simulateWrite(): void {
    throw new Error('MockReplica.simulateWrite() not implemented')
  }
}

export function createMockReplica(primaryRef: string): MockReplica {
  return new MockReplica(primaryRef)
}

// =============================================================================
// EnhancedMockPipeline
// =============================================================================

export interface EnhancedMockPipeline {
  events: unknown[]
  send(events: unknown[]): Promise<void>
  clear(): void
  setError(error: Error | null): void
  setDelay(ms: number): void
  getBatches(): unknown[][]
  getLastBatch(): unknown[] | undefined
  assertEventSent(matcher: EventMatcher): void
  assertNoEvents(): void
  setBackpressure(enabled: boolean): void
  hasBackpressure(): boolean
  getQueuedEvents(): unknown[]
  flushQueue(): Promise<void>
}

export function createEnhancedMockPipeline(
  _options?: EnhancedMockPipelineOptions
): EnhancedMockPipeline {
  throw new Error('createEnhancedMockPipeline() not implemented')
}
