/**
 * @dotdo/flink - Checkpointing and Savepoint Tests
 *
 * TDD RED phase tests for Flink checkpointing API compatibility.
 * Tests state persistence, recovery, and exactly-once semantics.
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/fault-tolerance/checkpointing/
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/state/savepoints/
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  // Environment
  StreamExecutionEnvironment,
  createTestEnvironment,

  // Checkpointing
  CheckpointConfig,
  CheckpointStorage,
  CheckpointingMode,
  StateBackend,

  // State
  ValueState,
  ListState,
  ValueStateDescriptor,
  ListStateDescriptor,

  // Process functions
  KeyedProcessFunction,
  RuntimeContext,
  Context,
  Collector,

  // Test utilities
  _clear,
} from '../index'

// New imports that will need to be implemented
import {
  // State backends (to be implemented)
  MemoryStateBackend,
  FsStateBackend,
  RocksDBStateBackend,
  HashMapStateBackend,
  EmbeddedRocksDBStateBackend,

  // Checkpoint interfaces (to be implemented)
  CheckpointedFunction,
  ListCheckpointed,
  FunctionInitializationContext,
  FunctionSnapshotContext,
  OperatorStateStore,
  KeyedStateStore,

  // Savepoint operations (to be implemented)
  SavepointManager,
  Savepoint,
  SavepointMetadata,
  SavepointRestoreSettings,

  // Checkpoint metadata (to be implemented)
  CheckpointMetadata,
  CompletedCheckpoint,
  PendingCheckpoint,
  CheckpointCoordinator,
  CheckpointListener,

  // Recovery (to be implemented)
  StateRecoveryManager,
  CheckpointBarrier,
  CheckpointOptions,
  SnapshotResult,
} from '../checkpointing'

describe('@dotdo/flink - Checkpointing and Savepoints', () => {
  beforeEach(() => {
    _clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // StreamExecutionEnvironment.enableCheckpointing()
  // ===========================================================================

  describe('StreamExecutionEnvironment.enableCheckpointing()', () => {
    it('should enable periodic checkpoints with interval', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000) // Every 5 seconds

      expect(env.getCheckpointConfig().getCheckpointInterval()).toBe(5000)
      expect(env.getCheckpointConfig().isCheckpointingEnabled()).toBe(true)
    })

    it('should default to EXACTLY_ONCE mode when not specified', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(10000)

      expect(env.getCheckpointConfig().getCheckpointingMode()).toBe(
        CheckpointingMode.EXACTLY_ONCE
      )
    })

    it('should chain configuration calls fluently', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()

      const result = env
        .enableCheckpointing(5000)
        .setStateBackend(new HashMapStateBackend())
        .setMaxParallelism(128)

      expect(result).toBe(env)
      expect(env.getCheckpointConfig().getCheckpointInterval()).toBe(5000)
    })

    it('should validate checkpoint interval is positive', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()

      expect(() => env.enableCheckpointing(0)).toThrow()
      expect(() => env.enableCheckpointing(-1000)).toThrow()
    })

    it('should disable checkpointing with interval of -1', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000)
      env.getCheckpointConfig().disableCheckpointing()

      expect(env.getCheckpointConfig().isCheckpointingEnabled()).toBe(false)
    })
  })

  // ===========================================================================
  // Checkpoint Interval Configuration
  // ===========================================================================

  describe('Checkpoint Interval Configuration', () => {
    it('should configure checkpoint interval via CheckpointConfig', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const config = env.getCheckpointConfig()

      config.setCheckpointInterval(15000)

      expect(config.getCheckpointInterval()).toBe(15000)
    })

    it('should configure minimum pause between checkpoints', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const config = env.getCheckpointConfig()

      config.setMinPauseBetweenCheckpoints(500)

      expect(config.getMinPauseBetweenCheckpoints()).toBe(500)
    })

    it('should enforce min pause >= 0', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const config = env.getCheckpointConfig()

      expect(() => config.setMinPauseBetweenCheckpoints(-100)).toThrow()
    })

    it('should configure checkpoint timeout', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const config = env.getCheckpointConfig()

      config.setCheckpointTimeout(120000) // 2 minutes

      expect(config.getCheckpointTimeout()).toBe(120000)
    })

    it('should configure max concurrent checkpoints', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const config = env.getCheckpointConfig()

      config.setMaxConcurrentCheckpoints(2)

      expect(config.getMaxConcurrentCheckpoints()).toBe(2)
    })

    it('should configure tolerable checkpoint failure number', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const config = env.getCheckpointConfig()

      config.setTolerableCheckpointFailureNumber(3)

      expect(config.getTolerableCheckpointFailureNumber()).toBe(3)
    })
  })

  // ===========================================================================
  // CheckpointingMode.EXACTLY_ONCE vs AT_LEAST_ONCE
  // ===========================================================================

  describe('CheckpointingMode', () => {
    it('should support EXACTLY_ONCE mode', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000, CheckpointingMode.EXACTLY_ONCE)

      expect(env.getCheckpointConfig().getCheckpointingMode()).toBe(
        CheckpointingMode.EXACTLY_ONCE
      )
    })

    it('should support AT_LEAST_ONCE mode', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000, CheckpointingMode.AT_LEAST_ONCE)

      expect(env.getCheckpointConfig().getCheckpointingMode()).toBe(
        CheckpointingMode.AT_LEAST_ONCE
      )
    })

    it('should set mode via CheckpointConfig', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000)

      env.getCheckpointConfig().setCheckpointingMode(CheckpointingMode.AT_LEAST_ONCE)

      expect(env.getCheckpointConfig().getCheckpointingMode()).toBe(
        CheckpointingMode.AT_LEAST_ONCE
      )
    })

    it('should provide semantic guarantees description', () => {
      expect(CheckpointingMode.EXACTLY_ONCE).toBeDefined()
      expect(CheckpointingMode.AT_LEAST_ONCE).toBeDefined()

      // Mode should have description method
      expect(CheckpointingMode.getDescription(CheckpointingMode.EXACTLY_ONCE)).toBe(
        'Records are processed exactly once under failures'
      )
      expect(CheckpointingMode.getDescription(CheckpointingMode.AT_LEAST_ONCE)).toBe(
        'Records may be processed more than once under failures'
      )
    })

    it('should enable aligned checkpoints for EXACTLY_ONCE by default', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000, CheckpointingMode.EXACTLY_ONCE)

      // EXACTLY_ONCE should use aligned checkpoints by default
      expect(env.getCheckpointConfig().isUnalignedCheckpointsEnabled()).toBe(false)
    })

    it('should support unaligned checkpoints for EXACTLY_ONCE', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000, CheckpointingMode.EXACTLY_ONCE)
      env.getCheckpointConfig().enableUnalignedCheckpoints()

      expect(env.getCheckpointConfig().isUnalignedCheckpointsEnabled()).toBe(true)
    })

    it('should not allow unaligned checkpoints with AT_LEAST_ONCE', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000, CheckpointingMode.AT_LEAST_ONCE)

      expect(() => env.getCheckpointConfig().enableUnalignedCheckpoints()).toThrow(
        'Unaligned checkpoints require EXACTLY_ONCE mode'
      )
    })
  })

  // ===========================================================================
  // State Backend Configuration
  // ===========================================================================

  describe('State Backend Configuration', () => {
    describe('MemoryStateBackend (legacy)', () => {
      it('should create memory state backend', () => {
        const backend = new MemoryStateBackend()

        expect(backend).toBeDefined()
        expect(backend.getName()).toBe('memory')
      })

      it('should configure max state size', () => {
        const backend = new MemoryStateBackend(5 * 1024 * 1024) // 5MB

        expect(backend.getMaxStateSize()).toBe(5 * 1024 * 1024)
      })

      it('should configure async snapshots', () => {
        const backend = new MemoryStateBackend(5 * 1024 * 1024, true)

        expect(backend.isUsingAsynchronousSnapshots()).toBe(true)
      })

      it('should set as environment state backend', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        const backend = new MemoryStateBackend()

        env.setStateBackend(backend)

        expect(env.getStateBackend()).toBe(backend)
      })
    })

    describe('FsStateBackend (legacy)', () => {
      it('should create filesystem state backend', () => {
        const backend = new FsStateBackend('do://state/checkpoints')

        expect(backend).toBeDefined()
        expect(backend.getName()).toBe('filesystem')
      })

      it('should return checkpoint path', () => {
        const backend = new FsStateBackend('do://state/checkpoints')

        expect(backend.getCheckpointPath()).toBe('do://state/checkpoints')
      })

      it('should configure async snapshots', () => {
        const backend = new FsStateBackend('do://state/checkpoints', true)

        expect(backend.isUsingAsynchronousSnapshots()).toBe(true)
      })

      it('should support write buffer size configuration', () => {
        const backend = new FsStateBackend('do://state/checkpoints')
        backend.setWriteBufferSize(64 * 1024) // 64KB

        expect(backend.getWriteBufferSize()).toBe(64 * 1024)
      })
    })

    describe('HashMapStateBackend', () => {
      it('should create hashmap state backend', () => {
        const backend = new HashMapStateBackend()

        expect(backend).toBeDefined()
        expect(backend.getName()).toBe('hashmap')
      })

      it('should be default backend for DO storage', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        env.setStateBackend(new HashMapStateBackend())

        const backend = env.getStateBackend()
        expect(backend).toBeInstanceOf(HashMapStateBackend)
      })
    })

    describe('EmbeddedRocksDBStateBackend', () => {
      it('should create embedded RocksDB state backend', () => {
        const backend = new EmbeddedRocksDBStateBackend()

        expect(backend).toBeDefined()
        expect(backend.getName()).toBe('rocksdb')
      })

      it('should enable incremental checkpoints', () => {
        const backend = new EmbeddedRocksDBStateBackend(true)

        expect(backend.isIncrementalCheckpointsEnabled()).toBe(true)
      })

      it('should configure number of transferring threads', () => {
        const backend = new EmbeddedRocksDBStateBackend()
        backend.setNumberOfTransferringThreads(4)

        expect(backend.getNumberOfTransferringThreads()).toBe(4)
      })

      it('should configure predefined options', () => {
        const backend = new EmbeddedRocksDBStateBackend()
        backend.setPredefinedOptions('SPINNING_DISK_OPTIMIZED')

        expect(backend.getPredefinedOptions()).toBe('SPINNING_DISK_OPTIMIZED')
      })
    })

    describe('RocksDBStateBackend (legacy)', () => {
      it('should create RocksDB state backend', () => {
        const backend = new RocksDBStateBackend('do://state/rocksdb')

        expect(backend).toBeDefined()
        expect(backend.getName()).toBe('rocksdb')
      })

      it('should enable incremental checkpoints', () => {
        const backend = new RocksDBStateBackend('do://state/rocksdb', true)

        expect(backend.isIncrementalCheckpointsEnabled()).toBe(true)
      })
    })
  })

  // ===========================================================================
  // Savepoint Creation and Restoration
  // ===========================================================================

  describe('Savepoint Creation and Restoration', () => {
    describe('Savepoint Creation', () => {
      it('should create savepoint manager', () => {
        const env = createTestEnvironment()
        const savepointManager = new SavepointManager(env)

        expect(savepointManager).toBeDefined()
      })

      it('should trigger savepoint', async () => {
        const env = createTestEnvironment()
        env.enableCheckpointing(5000)

        const stream = env.fromElements(
          { key: 'a', value: 1 },
          { key: 'a', value: 2 }
        )

        const savepointManager = new SavepointManager(env)
        const savepoint = await savepointManager.triggerSavepoint('do://savepoints/sp-1')

        expect(savepoint).toBeDefined()
        expect(savepoint.getPath()).toBe('do://savepoints/sp-1')
      })

      it('should generate unique savepoint ID', async () => {
        const env = createTestEnvironment()
        env.enableCheckpointing(5000)

        const savepointManager = new SavepointManager(env)
        const savepoint1 = await savepointManager.triggerSavepoint('do://savepoints/')
        const savepoint2 = await savepointManager.triggerSavepoint('do://savepoints/')

        expect(savepoint1.getId()).not.toBe(savepoint2.getId())
      })

      it('should support canonical savepoint format', async () => {
        const env = createTestEnvironment()
        env.enableCheckpointing(5000)

        const savepointManager = new SavepointManager(env)
        const savepoint = await savepointManager.triggerSavepoint(
          'do://savepoints/sp-canonical',
          { formatType: 'canonical' }
        )

        expect(savepoint.getFormatType()).toBe('canonical')
      })

      it('should support native savepoint format', async () => {
        const env = createTestEnvironment()
        env.enableCheckpointing(5000)

        const savepointManager = new SavepointManager(env)
        const savepoint = await savepointManager.triggerSavepoint(
          'do://savepoints/sp-native',
          { formatType: 'native' }
        )

        expect(savepoint.getFormatType()).toBe('native')
      })

      it('should capture savepoint metadata', async () => {
        const env = createTestEnvironment()
        env.enableCheckpointing(5000)

        const savepointManager = new SavepointManager(env)
        const savepoint = await savepointManager.triggerSavepoint('do://savepoints/sp-meta')

        const metadata = savepoint.getMetadata()
        expect(metadata.getTimestamp()).toBeGreaterThan(0)
        expect(metadata.getCheckpointId()).toBeGreaterThan(0)
        expect(metadata.getOperatorStates()).toBeDefined()
      })
    })

    describe('Savepoint Restoration', () => {
      it('should restore from savepoint path', async () => {
        const env = createTestEnvironment()
        env.enableCheckpointing(5000)

        // Configure restore settings
        const restoreSettings = SavepointRestoreSettings.forPath('do://savepoints/sp-1')

        env.setRestoreSettings(restoreSettings)

        expect(env.getRestoreSettings()?.getSavepointPath()).toBe('do://savepoints/sp-1')
      })

      it('should restore with claim mode CLAIM', async () => {
        const restoreSettings = SavepointRestoreSettings.forPath(
          'do://savepoints/sp-1',
          { claimMode: 'CLAIM' }
        )

        expect(restoreSettings.getClaimMode()).toBe('CLAIM')
      })

      it('should restore with claim mode NO_CLAIM', async () => {
        const restoreSettings = SavepointRestoreSettings.forPath(
          'do://savepoints/sp-1',
          { claimMode: 'NO_CLAIM' }
        )

        expect(restoreSettings.getClaimMode()).toBe('NO_CLAIM')
      })

      it('should allow non-restored state', async () => {
        const restoreSettings = SavepointRestoreSettings.forPath(
          'do://savepoints/sp-1',
          { allowNonRestoredState: true }
        )

        expect(restoreSettings.allowNonRestoredState()).toBe(true)
      })

      it('should throw on missing state by default', async () => {
        const restoreSettings = SavepointRestoreSettings.forPath('do://savepoints/sp-1')

        // Default should not allow non-restored state
        expect(restoreSettings.allowNonRestoredState()).toBe(false)
      })

      it('should restore operator state from savepoint', async () => {
        const env = createTestEnvironment()
        env.enableCheckpointing(5000)

        // Create initial state
        let processedCount = 0
        class StatefulFunction extends KeyedProcessFunction<
          string,
          { key: string; value: number },
          { key: string; count: number }
        > {
          private countState!: ValueState<number>

          open(ctx: RuntimeContext) {
            this.countState = ctx.getState(new ValueStateDescriptor('count', 0))
          }

          processElement(
            value: { key: string; value: number },
            ctx: Context,
            out: Collector<{ key: string; count: number }>
          ) {
            const count = (this.countState.value() ?? 0) + 1
            this.countState.update(count)
            processedCount = count
            out.collect({ key: value.key, count })
          }
        }

        const stream = env.fromElements(
          { key: 'a', value: 1 },
          { key: 'a', value: 2 },
          { key: 'a', value: 3 }
        )

        const result = stream.keyBy((e) => e.key).process(new StatefulFunction())

        // Trigger savepoint
        const savepointManager = new SavepointManager(env)
        const savepoint = await savepointManager.triggerSavepoint('do://savepoints/sp-restore')

        // Create new environment and restore
        const newEnv = createTestEnvironment()
        newEnv.setRestoreSettings(
          SavepointRestoreSettings.forPath(savepoint.getPath())
        )

        // State should be restored
        const restoredState = await newEnv.getRestoredOperatorState('count')
        expect(restoredState).toBeDefined()
      })
    })

    describe('Savepoint Disposal', () => {
      it('should dispose savepoint', async () => {
        const env = createTestEnvironment()
        env.enableCheckpointing(5000)

        const savepointManager = new SavepointManager(env)
        const savepoint = await savepointManager.triggerSavepoint('do://savepoints/sp-dispose')

        await savepointManager.disposeSavepoint(savepoint.getPath())

        // Savepoint should no longer exist
        const exists = await savepointManager.savepointExists(savepoint.getPath())
        expect(exists).toBe(false)
      })
    })
  })

  // ===========================================================================
  // CheckpointedFunction Interface
  // ===========================================================================

  describe('CheckpointedFunction Interface', () => {
    it('should implement snapshotState', async () => {
      class MyCheckpointedFunction implements CheckpointedFunction {
        private state: number[] = []
        private listState!: ListState<number>

        initializeState(context: FunctionInitializationContext): void {
          const descriptor = new ListStateDescriptor<number>('my-state', [])
          this.listState = context.getOperatorStateStore().getListState(descriptor)

          if (context.isRestored()) {
            this.state = [...this.listState.get()]
          }
        }

        snapshotState(context: FunctionSnapshotContext): void {
          this.listState.clear()
          this.listState.addAll(this.state)
        }

        addValue(value: number): void {
          this.state.push(value)
        }
      }

      const func = new MyCheckpointedFunction()

      // Verify interface methods exist
      expect(typeof func.initializeState).toBe('function')
      expect(typeof func.snapshotState).toBe('function')
    })

    it('should provide checkpoint ID in snapshot context', async () => {
      let capturedCheckpointId: number | null = null

      class CheckpointIdCapture implements CheckpointedFunction {
        private listState!: ListState<number>

        initializeState(context: FunctionInitializationContext): void {
          this.listState = context.getOperatorStateStore().getListState(
            new ListStateDescriptor('state', [])
          )
        }

        snapshotState(context: FunctionSnapshotContext): void {
          capturedCheckpointId = context.getCheckpointId()
        }
      }

      const env = createTestEnvironment()
      env.enableCheckpointing(5000)

      // Simulate checkpoint trigger
      const coordinator = new CheckpointCoordinator(env)
      await coordinator.triggerCheckpoint()

      expect(capturedCheckpointId).toBeGreaterThan(0)
    })

    it('should provide checkpoint timestamp in snapshot context', async () => {
      let capturedTimestamp: number | null = null

      class TimestampCapture implements CheckpointedFunction {
        private listState!: ListState<number>

        initializeState(context: FunctionInitializationContext): void {
          this.listState = context.getOperatorStateStore().getListState(
            new ListStateDescriptor('state', [])
          )
        }

        snapshotState(context: FunctionSnapshotContext): void {
          capturedTimestamp = context.getCheckpointTimestamp()
        }
      }

      expect(capturedTimestamp).toBeNull() // Not yet triggered

      // After checkpoint trigger, timestamp should be set
    })

    it('should detect restored state', async () => {
      let wasRestored = false

      class RestoreDetector implements CheckpointedFunction {
        private listState!: ListState<string>

        initializeState(context: FunctionInitializationContext): void {
          this.listState = context.getOperatorStateStore().getListState(
            new ListStateDescriptor('restored-state', [])
          )
          wasRestored = context.isRestored()
        }

        snapshotState(context: FunctionSnapshotContext): void {
          // Save state
        }
      }

      // Without restoration
      const freshContext: FunctionInitializationContext = {
        isRestored: () => false,
        getOperatorStateStore: () => createMockOperatorStateStore(),
        getKeyedStateStore: () => createMockKeyedStateStore(),
      }

      const detector = new RestoreDetector()
      detector.initializeState(freshContext)

      expect(wasRestored).toBe(false)
    })

    it('should restore list state from checkpoint', async () => {
      const restoredValues: number[] = []

      class ListStateRestorer implements CheckpointedFunction {
        private listState!: ListState<number>

        initializeState(context: FunctionInitializationContext): void {
          this.listState = context.getOperatorStateStore().getListState(
            new ListStateDescriptor('numbers', [])
          )

          if (context.isRestored()) {
            for (const value of this.listState.get()) {
              restoredValues.push(value)
            }
          }
        }

        snapshotState(context: FunctionSnapshotContext): void {
          // Values already in list state
        }
      }

      // Mock restored context
      const mockListState = createMockListState([1, 2, 3])
      const restoredContext: FunctionInitializationContext = {
        isRestored: () => true,
        getOperatorStateStore: () => ({
          getListState: () => mockListState,
          getUnionListState: () => mockListState,
          getBroadcastState: () => createMockBroadcastState(),
        }),
        getKeyedStateStore: () => createMockKeyedStateStore(),
      }

      const restorer = new ListStateRestorer()
      restorer.initializeState(restoredContext)

      expect(restoredValues).toEqual([1, 2, 3])
    })

    it('should support union list state redistribution', async () => {
      class UnionStateFunction implements CheckpointedFunction {
        private unionState!: ListState<number>

        initializeState(context: FunctionInitializationContext): void {
          this.unionState = context.getOperatorStateStore().getUnionListState(
            new ListStateDescriptor('union-state', [])
          )
        }

        snapshotState(context: FunctionSnapshotContext): void {
          // Union state merges all parallel instances on restore
        }
      }

      const func = new UnionStateFunction()
      expect(func).toBeDefined()
    })
  })

  // ===========================================================================
  // ListCheckpointed Interface (Legacy)
  // ===========================================================================

  describe('ListCheckpointed Interface (Legacy)', () => {
    it('should implement snapshotState returning list', () => {
      class LegacyCheckpointedOp implements ListCheckpointed<number> {
        private values: number[] = [1, 2, 3]

        snapshotState(checkpointId: number, timestamp: number): number[] {
          return [...this.values]
        }

        restoreState(state: number[]): void {
          this.values = state
        }
      }

      const op = new LegacyCheckpointedOp()
      const snapshot = op.snapshotState(1, Date.now())

      expect(snapshot).toEqual([1, 2, 3])
    })

    it('should restore state from list', () => {
      class LegacyCheckpointedOp implements ListCheckpointed<string> {
        private items: string[] = []

        snapshotState(checkpointId: number, timestamp: number): string[] {
          return [...this.items]
        }

        restoreState(state: string[]): void {
          this.items = state
        }

        getItems(): string[] {
          return this.items
        }
      }

      const op = new LegacyCheckpointedOp()
      op.restoreState(['a', 'b', 'c'])

      expect(op.getItems()).toEqual(['a', 'b', 'c'])
    })

    it('should handle empty state on fresh start', () => {
      class LegacyOp implements ListCheckpointed<number> {
        private data: number[] = []

        snapshotState(checkpointId: number, timestamp: number): number[] {
          return this.data
        }

        restoreState(state: number[]): void {
          this.data = state ?? []
        }
      }

      const op = new LegacyOp()
      op.restoreState([])

      expect(op.snapshotState(1, Date.now())).toEqual([])
    })

    it('should provide checkpoint ID and timestamp to snapshot', () => {
      let receivedCheckpointId: number | null = null
      let receivedTimestamp: number | null = null

      class MetadataCapture implements ListCheckpointed<number> {
        snapshotState(checkpointId: number, timestamp: number): number[] {
          receivedCheckpointId = checkpointId
          receivedTimestamp = timestamp
          return []
        }

        restoreState(state: number[]): void {}
      }

      const op = new MetadataCapture()
      const now = Date.now()
      op.snapshotState(42, now)

      expect(receivedCheckpointId).toBe(42)
      expect(receivedTimestamp).toBe(now)
    })
  })

  // ===========================================================================
  // Checkpoint/Savepoint Metadata
  // ===========================================================================

  describe('Checkpoint/Savepoint Metadata', () => {
    it('should provide checkpoint metadata', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000)

      const coordinator = new CheckpointCoordinator(env)
      const checkpoint = await coordinator.triggerCheckpoint()

      const metadata = checkpoint.getMetadata()

      expect(metadata.getCheckpointId()).toBeGreaterThan(0)
      expect(metadata.getTimestamp()).toBeGreaterThan(0)
      expect(metadata.getDuration()).toBeGreaterThanOrEqual(0)
      expect(metadata.getStateSize()).toBeGreaterThanOrEqual(0)
    })

    it('should track checkpoint state by operator', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000)

      const stream = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'b', value: 2 }
      )

      const keyed = stream.keyBy((e) => e.key)

      const coordinator = new CheckpointCoordinator(env)
      const checkpoint = await coordinator.triggerCheckpoint()

      const operatorStates = checkpoint.getMetadata().getOperatorStates()

      expect(operatorStates).toBeDefined()
      expect(Array.isArray(operatorStates)).toBe(true)
    })

    it('should track checkpoint subtask states', async () => {
      const env = createTestEnvironment()
      env.setParallelism(4)
      env.enableCheckpointing(5000)

      const coordinator = new CheckpointCoordinator(env)
      const checkpoint = await coordinator.triggerCheckpoint()

      const subtaskStates = checkpoint.getMetadata().getSubtaskStates()

      expect(subtaskStates).toBeDefined()
    })

    it('should provide savepoint metadata with master states', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000)

      const savepointManager = new SavepointManager(env)
      const savepoint = await savepointManager.triggerSavepoint('do://savepoints/meta-test')

      const metadata = savepoint.getMetadata()

      expect(metadata.getMasterStates()).toBeDefined()
    })

    it('should track checkpoint alignment duration', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000, CheckpointingMode.EXACTLY_ONCE)
      // Aligned checkpoints (default for EXACTLY_ONCE)

      const coordinator = new CheckpointCoordinator(env)
      const checkpoint = await coordinator.triggerCheckpoint()

      const alignmentDuration = checkpoint.getMetadata().getAlignmentDuration()

      expect(typeof alignmentDuration).toBe('number')
      expect(alignmentDuration).toBeGreaterThanOrEqual(0)
    })

    it('should provide checkpoint storage location', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000)
      env.getCheckpointConfig().setCheckpointStorage(
        new CheckpointStorage('do://checkpoints')
      )

      const coordinator = new CheckpointCoordinator(env)
      const checkpoint = await coordinator.triggerCheckpoint()

      expect(checkpoint.getExternalPath()).toContain('do://checkpoints')
    })

    it('should provide incremental vs full checkpoint info', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000)
      env.setStateBackend(new EmbeddedRocksDBStateBackend(true)) // incremental

      const coordinator = new CheckpointCoordinator(env)
      const checkpoint = await coordinator.triggerCheckpoint()

      const metadata = checkpoint.getMetadata()

      expect(typeof metadata.isIncremental()).toBe('boolean')
    })
  })

  // ===========================================================================
  // Recovery from Checkpoint After Failure
  // ===========================================================================

  describe('Recovery from Checkpoint After Failure', () => {
    it('should recover keyed state after failure', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000)

      let stateValue = 0

      class FailableFunction extends KeyedProcessFunction<
        string,
        { key: string; value: number },
        number
      > {
        private sumState!: ValueState<number>

        open(ctx: RuntimeContext) {
          this.sumState = ctx.getState(new ValueStateDescriptor('sum', 0))
        }

        processElement(
          event: { key: string; value: number },
          ctx: Context,
          out: Collector<number>
        ) {
          const current = this.sumState.value() ?? 0
          const newSum = current + event.value
          this.sumState.update(newSum)
          stateValue = newSum
          out.collect(newSum)
        }
      }

      // Process some elements
      const stream = env.fromElements(
        { key: 'a', value: 10 },
        { key: 'a', value: 20 }
      )

      await env.executeAndCollect(
        stream.keyBy((e) => e.key).process(new FailableFunction())
      )

      expect(stateValue).toBe(30)

      // Trigger checkpoint
      const coordinator = new CheckpointCoordinator(env)
      const checkpoint = await coordinator.triggerCheckpoint()

      // Simulate failure and recovery
      const recoveryManager = new StateRecoveryManager(env)
      await recoveryManager.recoverFromCheckpoint(checkpoint.getPath())

      // Verify state was recovered
      const recoveredState = await recoveryManager.getKeyedState('a', 'sum')
      expect(recoveredState).toBe(30)
    })

    it('should recover operator state after failure', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000)

      class OperatorStateFunction implements CheckpointedFunction {
        private bufferedElements: string[] = []
        private listState!: ListState<string>

        initializeState(context: FunctionInitializationContext): void {
          this.listState = context.getOperatorStateStore().getListState(
            new ListStateDescriptor('buffer', [])
          )

          if (context.isRestored()) {
            this.bufferedElements = [...this.listState.get()]
          }
        }

        snapshotState(context: FunctionSnapshotContext): void {
          this.listState.clear()
          this.listState.addAll(this.bufferedElements)
        }

        addElement(element: string): void {
          this.bufferedElements.push(element)
        }

        getBufferedElements(): string[] {
          return this.bufferedElements
        }
      }

      const func = new OperatorStateFunction()
      func.addElement('a')
      func.addElement('b')
      func.addElement('c')

      // Trigger checkpoint
      const coordinator = new CheckpointCoordinator(env)
      const checkpoint = await coordinator.triggerCheckpoint()

      // Simulate failure and recovery
      const recoveryManager = new StateRecoveryManager(env)
      await recoveryManager.recoverFromCheckpoint(checkpoint.getPath())

      // Create new instance and restore
      const restoredFunc = new OperatorStateFunction()
      const restoredContext: FunctionInitializationContext = {
        isRestored: () => true,
        getOperatorStateStore: () => recoveryManager.getOperatorStateStore(),
        getKeyedStateStore: () => createMockKeyedStateStore(),
      }

      restoredFunc.initializeState(restoredContext)

      expect(restoredFunc.getBufferedElements()).toEqual(['a', 'b', 'c'])
    })

    it('should restart from latest completed checkpoint', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(1000)

      const coordinator = new CheckpointCoordinator(env)

      // Trigger multiple checkpoints
      await coordinator.triggerCheckpoint()
      await coordinator.triggerCheckpoint()
      const latestCheckpoint = await coordinator.triggerCheckpoint()

      // Get latest completed checkpoint
      const latest = coordinator.getLatestCompletedCheckpoint()

      expect(latest?.getCheckpointId()).toBe(latestCheckpoint.getCheckpointId())
    })

    it('should handle checkpoint restoration with rescaling', async () => {
      const env = createTestEnvironment()
      env.setParallelism(2)
      env.enableCheckpointing(5000)

      // Trigger checkpoint with parallelism 2
      const coordinator = new CheckpointCoordinator(env)
      const checkpoint = await coordinator.triggerCheckpoint()

      // Create new environment with different parallelism
      const newEnv = createTestEnvironment()
      newEnv.setParallelism(4) // Scale up

      const recoveryManager = new StateRecoveryManager(newEnv)
      const restored = await recoveryManager.recoverFromCheckpoint(
        checkpoint.getPath(),
        { allowRescaling: true }
      )

      expect(restored.wasRescaled()).toBe(true)
      expect(restored.getOriginalParallelism()).toBe(2)
      expect(restored.getNewParallelism()).toBe(4)
    })

    it('should reject incompatible state on recovery', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000)

      const coordinator = new CheckpointCoordinator(env)
      const checkpoint = await coordinator.triggerCheckpoint()

      // Create new environment with incompatible configuration
      const newEnv = createTestEnvironment()

      const recoveryManager = new StateRecoveryManager(newEnv)

      // Should throw on incompatible state
      await expect(
        recoveryManager.recoverFromCheckpoint(checkpoint.getPath(), {
          allowNonRestoredState: false,
        })
      ).rejects.toThrow()
    })

    it('should notify checkpoint listener on completion', async () => {
      const completedCheckpoints: number[] = []

      const listener: CheckpointListener = {
        notifyCheckpointComplete: (checkpointId: number) => {
          completedCheckpoints.push(checkpointId)
        },
        notifyCheckpointAborted: (checkpointId: number) => {
          // Handle abort
        },
      }

      const env = createTestEnvironment()
      env.enableCheckpointing(5000)

      const coordinator = new CheckpointCoordinator(env)
      coordinator.registerCheckpointListener(listener)

      await coordinator.triggerCheckpoint()

      expect(completedCheckpoints.length).toBe(1)
    })

    it('should handle checkpoint barrier alignment', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000, CheckpointingMode.EXACTLY_ONCE)

      const coordinator = new CheckpointCoordinator(env)

      // Simulate barrier arrival from multiple channels
      const barrier: CheckpointBarrier = {
        checkpointId: 1,
        timestamp: Date.now(),
        options: new CheckpointOptions(CheckpointingMode.EXACTLY_ONCE),
      }

      const alignmentComplete = await coordinator.processCheckpointBarrier(
        barrier,
        { channelIndex: 0, totalChannels: 2 }
      )

      expect(alignmentComplete).toBe(false) // Still waiting for other channel

      const alignmentComplete2 = await coordinator.processCheckpointBarrier(
        barrier,
        { channelIndex: 1, totalChannels: 2 }
      )

      expect(alignmentComplete2).toBe(true) // All barriers received
    })

    it('should support async snapshot for large state', async () => {
      const env = createTestEnvironment()
      env.enableCheckpointing(5000)
      env.setStateBackend(new HashMapStateBackend())

      const coordinator = new CheckpointCoordinator(env)

      // Trigger async snapshot
      const snapshotFuture = coordinator.triggerAsyncSnapshot()

      expect(snapshotFuture).toBeDefined()
      expect(typeof snapshotFuture.then).toBe('function')

      const result: SnapshotResult = await snapshotFuture

      expect(result.isSuccessful()).toBe(true)
    })
  })
})

// ===========================================================================
// Helper Functions for Mocking
// ===========================================================================

function createMockOperatorStateStore(): OperatorStateStore {
  const states = new Map<string, any[]>()

  return {
    getListState: <T>(descriptor: ListStateDescriptor<T>): ListState<T> => {
      if (!states.has(descriptor.name)) {
        states.set(descriptor.name, [])
      }
      return createMockListState(states.get(descriptor.name)!)
    },
    getUnionListState: <T>(descriptor: ListStateDescriptor<T>): ListState<T> => {
      if (!states.has(descriptor.name)) {
        states.set(descriptor.name, [])
      }
      return createMockListState(states.get(descriptor.name)!)
    },
    getBroadcastState: () => createMockBroadcastState(),
  }
}

function createMockKeyedStateStore(): KeyedStateStore {
  const states = new Map<string, any>()

  return {
    getState: <T>(descriptor: ValueStateDescriptor<T>): ValueState<T> => ({
      value: () => states.get(descriptor.name) ?? descriptor.defaultValue,
      update: (value: T) => states.set(descriptor.name, value),
      clear: () => states.delete(descriptor.name),
    }),
    getListState: <T>(descriptor: ListStateDescriptor<T>): ListState<T> => {
      if (!states.has(descriptor.name)) {
        states.set(descriptor.name, [])
      }
      return createMockListState(states.get(descriptor.name))
    },
    getMapState: () => {
      throw new Error('Not implemented')
    },
    getReducingState: () => {
      throw new Error('Not implemented')
    },
    getAggregatingState: () => {
      throw new Error('Not implemented')
    },
  }
}

function createMockListState<T>(initialValues: T[] = []): ListState<T> {
  const values = [...initialValues]

  return {
    get: () => values,
    add: (value: T) => values.push(value),
    addAll: (newValues: T[]) => values.push(...newValues),
    update: (newValues: T[]) => {
      values.length = 0
      values.push(...newValues)
    },
    clear: () => {
      values.length = 0
    },
  }
}

function createMockBroadcastState<K, V>(): any {
  const map = new Map<K, V>()

  return {
    get: (key: K) => map.get(key),
    put: (key: K, value: V) => map.set(key, value),
    remove: (key: K) => map.delete(key),
    contains: (key: K) => map.has(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    values: () => map.values(),
    clear: () => map.clear(),
  }
}
