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

  // Time utilities
  Time,

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
  ChangelogStateBackend,

  // Checkpoint storage (to be implemented)
  JobManagerCheckpointStorage,
  FileSystemCheckpointStorage,

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
// Incremental Checkpoints
// ===========================================================================

describe('Incremental Checkpoints', () => {
  it('should enable incremental checkpointing on RocksDB backend', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const backend = new EmbeddedRocksDBStateBackend(true)

    env.setStateBackend(backend)

    expect(backend.isIncrementalCheckpointsEnabled()).toBe(true)
  })

  it('should configure incremental checkpoint threshold', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const backend = new EmbeddedRocksDBStateBackend(true)

    // Configure minimum delta size for incremental checkpoint
    backend.setIncrementalCheckpointThreshold(1024 * 1024) // 1MB

    expect(backend.getIncrementalCheckpointThreshold()).toBe(1024 * 1024)
  })

  it('should track incremental checkpoint size delta', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.setStateBackend(new EmbeddedRocksDBStateBackend(true))

    const coordinator = new CheckpointCoordinator(env)

    // Trigger first (full) checkpoint
    const fullCheckpoint = await coordinator.triggerCheckpoint()
    const fullSize = fullCheckpoint.getMetadata().getStateSize()

    // Trigger second (incremental) checkpoint
    const incrCheckpoint = await coordinator.triggerCheckpoint()
    const incrSize = incrCheckpoint.getMetadata().getIncrementalSize()

    // Incremental should be smaller (only delta)
    expect(incrSize).toBeLessThanOrEqual(fullSize)
    expect(incrCheckpoint.getMetadata().isIncremental()).toBe(true)
  })

  it('should fall back to full checkpoint when incremental fails', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.setStateBackend(new EmbeddedRocksDBStateBackend(true))

    const coordinator = new CheckpointCoordinator(env)

    // Force fallback to full checkpoint
    coordinator.setForceFullCheckpoint(true)

    const checkpoint = await coordinator.triggerCheckpoint()

    expect(checkpoint.getMetadata().isIncremental()).toBe(false)
  })

  it('should track number of shared state files', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.setStateBackend(new EmbeddedRocksDBStateBackend(true))

    const coordinator = new CheckpointCoordinator(env)

    await coordinator.triggerCheckpoint()
    await coordinator.triggerCheckpoint()

    const stats = coordinator.getCheckpointStats()

    expect(stats.getSharedStateFileCount()).toBeGreaterThanOrEqual(0)
    expect(stats.getSharedStateBytes()).toBeGreaterThanOrEqual(0)
  })

  it('should configure native savepoint format for incremental', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.setStateBackend(new EmbeddedRocksDBStateBackend(true))

    const savepointManager = new SavepointManager(env)

    // Native format preserves incremental structure
    const savepoint = await savepointManager.triggerSavepoint(
      'do://savepoints/incremental-native',
      { formatType: 'native' }
    )

    expect(savepoint.getFormatType()).toBe('native')
    expect(savepoint.getMetadata().preservesIncrementalStructure()).toBe(true)
  })
})

// ===========================================================================
// Checkpoint Retention Policies
// ===========================================================================

describe('Checkpoint Retention Policies', () => {
  it('should configure retained checkpoints', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const config = env.getCheckpointConfig()

    config.setMaxRetainedCheckpoints(3)

    expect(config.getMaxRetainedCheckpoints()).toBe(3)
  })

  it('should configure checkpoint cleanup on cancellation', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const config = env.getCheckpointConfig()

    config.setExternalizedCheckpointCleanup(
      CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION
    )

    expect(config.getExternalizedCheckpointCleanup()).toBe(
      CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION
    )
  })

  it('should delete old checkpoints when max retained exceeded', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.getCheckpointConfig().setMaxRetainedCheckpoints(2)

    const coordinator = new CheckpointCoordinator(env)

    // Trigger 4 checkpoints
    const cp1 = await coordinator.triggerCheckpoint()
    await coordinator.triggerCheckpoint()
    await coordinator.triggerCheckpoint()
    await coordinator.triggerCheckpoint()

    // Only 2 should be retained
    const completedCheckpoints = coordinator.getCompletedCheckpoints()

    expect(completedCheckpoints.length).toBe(2)
    // First checkpoint should have been cleaned up
    expect(completedCheckpoints.some((c) => c.getCheckpointId() === cp1.getCheckpointId())).toBe(
      false
    )
  })

  it('should support checkpoint history configuration', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const config = env.getCheckpointConfig()

    config.setCheckpointHistorySize(10)

    expect(config.getCheckpointHistorySize()).toBe(10)
  })

  it('should configure checkpoint expiration time', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const config = env.getCheckpointConfig()

    // Checkpoints older than 1 hour are eligible for cleanup
    config.setCheckpointExpirationTime(Time.hours(1).toMilliseconds())

    expect(config.getCheckpointExpirationTime()).toBe(3600000)
  })

  it('should support NEVER_RETAIN_AFTER_TERMINATION cleanup', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const config = env.getCheckpointConfig()

    config.setExternalizedCheckpointCleanup(
      CheckpointConfig.ExternalizedCheckpointCleanup.NO_EXTERNALIZED_CHECKPOINTS
    )

    expect(config.getExternalizedCheckpointCleanup()).toBe(
      CheckpointConfig.ExternalizedCheckpointCleanup.NO_EXTERNALIZED_CHECKPOINTS
    )
  })
})

// ===========================================================================
// Changelog State Backend
// ===========================================================================

describe('Changelog State Backend', () => {
  it('should create changelog state backend wrapping another backend', () => {
    const hashMapBackend = new HashMapStateBackend()
    const changelogBackend = new ChangelogStateBackend(hashMapBackend)

    expect(changelogBackend).toBeDefined()
    expect(changelogBackend.getDelegatedStateBackend()).toBe(hashMapBackend)
  })

  it('should enable changelog with configuration', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()

    env.enableChangelogStateBackend(true)

    expect(env.isChangelogStateBackendEnabled()).toBe(true)
  })

  it('should configure changelog storage', () => {
    const changelogBackend = new ChangelogStateBackend(new HashMapStateBackend())

    changelogBackend.setChangelogStorage('do://changelog')

    expect(changelogBackend.getChangelogStorage()).toBe('do://changelog')
  })

  it('should configure changelog materialization interval', () => {
    const changelogBackend = new ChangelogStateBackend(new HashMapStateBackend())

    changelogBackend.setMaterializationInterval(Time.minutes(10).toMilliseconds())

    expect(changelogBackend.getMaterializationInterval()).toBe(600000)
  })

  it('should configure changelog max state size for materialization', () => {
    const changelogBackend = new ChangelogStateBackend(new HashMapStateBackend())

    // Materialize when changelog exceeds 128MB
    changelogBackend.setMaterializationMaxSize(128 * 1024 * 1024)

    expect(changelogBackend.getMaterializationMaxSize()).toBe(128 * 1024 * 1024)
  })

  it('should track changelog size in checkpoint metadata', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.enableChangelogStateBackend(true)

    const coordinator = new CheckpointCoordinator(env)
    const checkpoint = await coordinator.triggerCheckpoint()

    const changelogSize = checkpoint.getMetadata().getChangelogSize()

    expect(typeof changelogSize).toBe('number')
    expect(changelogSize).toBeGreaterThanOrEqual(0)
  })

  it('should support periodic materialization', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const changelogBackend = new ChangelogStateBackend(new HashMapStateBackend())
    changelogBackend.setMaterializationInterval(1000) // 1 second

    env.setStateBackend(changelogBackend)

    const coordinator = new CheckpointCoordinator(env)

    // Wait for materialization
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const materializationCount = coordinator.getMaterializationCount()

    expect(materializationCount).toBeGreaterThanOrEqual(1)
  })
})

// ===========================================================================
// Checkpoint Storage Configuration
// ===========================================================================

describe('Checkpoint Storage Configuration', () => {
  it('should configure job manager checkpoint storage', () => {
    const storage = new JobManagerCheckpointStorage()

    expect(storage).toBeDefined()
    expect(storage.getName()).toBe('jobmanager')
  })

  it('should configure job manager storage with max state size', () => {
    const storage = new JobManagerCheckpointStorage(10 * 1024 * 1024) // 10MB

    expect(storage.getMaxStateSize()).toBe(10 * 1024 * 1024)
  })

  it('should configure filesystem checkpoint storage', () => {
    const storage = new FileSystemCheckpointStorage('do://checkpoints')

    expect(storage).toBeDefined()
    expect(storage.getName()).toBe('filesystem')
    expect(storage.getCheckpointPath()).toBe('do://checkpoints')
  })

  it('should configure write buffer size for filesystem storage', () => {
    const storage = new FileSystemCheckpointStorage('do://checkpoints')

    storage.setWriteBufferSize(256 * 1024) // 256KB

    expect(storage.getWriteBufferSize()).toBe(256 * 1024)
  })

  it('should configure file state threshold', () => {
    const storage = new FileSystemCheckpointStorage('do://checkpoints')

    // States larger than 20KB are written to files
    storage.setFileSizeThreshold(20 * 1024)

    expect(storage.getFileSizeThreshold()).toBe(20 * 1024)
  })

  it('should support custom checkpoint storage implementation', () => {
    class CustomCheckpointStorage extends CheckpointStorage {
      constructor() {
        super('custom://storage')
      }

      getName(): string {
        return 'custom'
      }

      writeCheckpoint(data: Uint8Array): Promise<string> {
        throw new Error('Not implemented')
      }

      readCheckpoint(path: string): Promise<Uint8Array> {
        throw new Error('Not implemented')
      }
    }

    const storage = new CustomCheckpointStorage()

    expect(storage.getName()).toBe('custom')
  })

  it('should configure checkpoint storage via environment', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const storage = new FileSystemCheckpointStorage('do://checkpoints/job1')

    env.getCheckpointConfig().setCheckpointStorage(storage)

    expect(env.getCheckpointConfig().getCheckpointStorage()).toBe(storage)
  })

  it('should support checkpoint storage with credentials', () => {
    const storage = new FileSystemCheckpointStorage('do://checkpoints')

    storage.setCredentials({
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    })

    expect(storage.hasCredentials()).toBe(true)
  })
})

// ===========================================================================
// Distributed Snapshot Algorithm (Chandy-Lamport)
// ===========================================================================

describe('Distributed Snapshot Algorithm', () => {
  it('should initiate checkpoint with unique barrier', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000, CheckpointingMode.EXACTLY_ONCE)

    const coordinator = new CheckpointCoordinator(env)

    const barrier = coordinator.initiateCheckpoint()

    expect(barrier.checkpointId).toBeGreaterThan(0)
    expect(barrier.timestamp).toBeGreaterThan(0)
    expect(barrier.options.getCheckpointingMode()).toBe(CheckpointingMode.EXACTLY_ONCE)
  })

  it('should track barrier progress across operators', async () => {
    const env = createTestEnvironment()
    env.setParallelism(4)
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)
    const barrier = coordinator.initiateCheckpoint()

    // Simulate barrier acknowledgement from 4 parallel subtasks
    for (let i = 0; i < 4; i++) {
      await coordinator.acknowledgeBarrier(barrier.checkpointId, {
        operatorId: 'source',
        subtaskIndex: i,
      })
    }

    const progress = coordinator.getCheckpointProgress(barrier.checkpointId)

    expect(progress.acknowledgedTasks).toBe(4)
    expect(progress.pendingTasks).toBe(0)
  })

  it('should handle barrier alignment for exactly-once', async () => {
    const env = createTestEnvironment()
    env.setParallelism(2)
    env.enableCheckpointing(5000, CheckpointingMode.EXACTLY_ONCE)

    const coordinator = new CheckpointCoordinator(env)
    const barrier = coordinator.initiateCheckpoint()

    // First channel receives barrier
    const aligned1 = await coordinator.processCheckpointBarrier(barrier, {
      channelIndex: 0,
      totalChannels: 2,
    })

    expect(aligned1).toBe(false) // Still waiting

    // Second channel receives barrier
    const aligned2 = await coordinator.processCheckpointBarrier(barrier, {
      channelIndex: 1,
      totalChannels: 2,
    })

    expect(aligned2).toBe(true) // All aligned
  })

  it('should skip alignment for at-least-once', async () => {
    const env = createTestEnvironment()
    env.setParallelism(2)
    env.enableCheckpointing(5000, CheckpointingMode.AT_LEAST_ONCE)

    const coordinator = new CheckpointCoordinator(env)
    const barrier = coordinator.initiateCheckpoint()

    // First barrier immediately triggers local snapshot (no alignment)
    const result = await coordinator.processCheckpointBarrier(barrier, {
      channelIndex: 0,
      totalChannels: 2,
    })

    // AT_LEAST_ONCE doesn't wait for alignment
    expect(result).toBe(true)
  })

  it('should track in-flight records during aligned checkpoint', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000, CheckpointingMode.EXACTLY_ONCE)

    const coordinator = new CheckpointCoordinator(env)

    // Simulate records in channel buffers during alignment
    coordinator.recordInflightData({
      channelId: 'channel-1',
      records: [
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
      ],
    })

    const checkpoint = await coordinator.triggerCheckpoint()

    // In-flight records should be persisted with checkpoint
    const inflightData = checkpoint.getMetadata().getInflightData()

    expect(inflightData).toBeDefined()
    expect(inflightData.length).toBeGreaterThan(0)
  })

  it('should support unaligned checkpoints with buffer persistence', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000, CheckpointingMode.EXACTLY_ONCE)
    env.getCheckpointConfig().enableUnalignedCheckpoints()

    const coordinator = new CheckpointCoordinator(env)

    const checkpoint = await coordinator.triggerCheckpoint()

    expect(checkpoint.getMetadata().isUnaligned()).toBe(true)
    expect(checkpoint.getMetadata().getPersistedBuffers()).toBeDefined()
  })

  it('should handle checkpoint decline from operator', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)
    const barrier = coordinator.initiateCheckpoint()

    // Operator declines checkpoint
    coordinator.declineCheckpoint(barrier.checkpointId, {
      operatorId: 'failing-operator',
      reason: 'State size exceeded limit',
    })

    const checkpoint = coordinator.getPendingCheckpoint(barrier.checkpointId)

    expect(checkpoint?.isDiscarded()).toBe(true)
  })

  it('should abort checkpoint on timeout', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.getCheckpointConfig().setCheckpointTimeout(100) // 100ms

    const coordinator = new CheckpointCoordinator(env)
    const barrier = coordinator.initiateCheckpoint()

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 150))

    const checkpoint = coordinator.getPendingCheckpoint(barrier.checkpointId)

    expect(checkpoint?.isDiscarded()).toBe(true)
  })
})

// ===========================================================================
// Checkpoint Statistics and Metrics
// ===========================================================================

describe('Checkpoint Statistics and Metrics', () => {
  it('should track checkpoint duration', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)
    const checkpoint = await coordinator.triggerCheckpoint()

    const duration = checkpoint.getMetadata().getDuration()

    expect(duration).toBeGreaterThanOrEqual(0)
  })

  it('should track checkpoint state size', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    // Create some state
    const stream = env.fromElements(
      { key: 'a', value: 1 },
      { key: 'b', value: 2 }
    )

    const coordinator = new CheckpointCoordinator(env)
    const checkpoint = await coordinator.triggerCheckpoint()

    const stateSize = checkpoint.getMetadata().getStateSize()

    expect(stateSize).toBeGreaterThanOrEqual(0)
  })

  it('should track checkpoint count and history', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)

    await coordinator.triggerCheckpoint()
    await coordinator.triggerCheckpoint()
    await coordinator.triggerCheckpoint()

    const stats = coordinator.getCheckpointStats()

    expect(stats.getCompletedCheckpointCount()).toBe(3)
    expect(stats.getFailedCheckpointCount()).toBe(0)
  })

  it('should track checkpoint failure reason', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)

    // Simulate failed checkpoint
    coordinator.simulateCheckpointFailure({
      reason: 'State size limit exceeded',
      operatorId: 'large-state-operator',
    })

    await expect(coordinator.triggerCheckpoint()).rejects.toThrow()

    const stats = coordinator.getCheckpointStats()

    expect(stats.getFailedCheckpointCount()).toBe(1)
    expect(stats.getLastFailureReason()).toBe('State size limit exceeded')
  })

  it('should provide checkpoint summary statistics', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)

    await coordinator.triggerCheckpoint()
    await coordinator.triggerCheckpoint()
    await coordinator.triggerCheckpoint()

    const stats = coordinator.getCheckpointStats()

    expect(stats.getAverageDuration()).toBeGreaterThanOrEqual(0)
    expect(stats.getAverageStateSize()).toBeGreaterThanOrEqual(0)
    expect(stats.getMinDuration()).toBeLessThanOrEqual(stats.getMaxDuration())
  })

  it('should track end-to-end checkpoint duration', async () => {
    const env = createTestEnvironment()
    env.setParallelism(4)
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)
    const checkpoint = await coordinator.triggerCheckpoint()

    const e2eDuration = checkpoint.getMetadata().getEndToEndDuration()

    expect(e2eDuration).toBeGreaterThanOrEqual(0)
  })

  it('should track per-operator checkpoint metrics', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    // Add operators to pipeline
    env.fromElements({ key: 'a', value: 1 })
      .filter((x) => x.value > 0)
      .map((x) => x.value * 2)

    const coordinator = new CheckpointCoordinator(env)
    const checkpoint = await coordinator.triggerCheckpoint()

    const operatorMetrics = checkpoint.getMetadata().getOperatorCheckpointMetrics()

    expect(operatorMetrics).toBeDefined()
    // Should have metrics for each operator
    for (const metric of operatorMetrics) {
      expect(metric.operatorId).toBeDefined()
      expect(metric.duration).toBeGreaterThanOrEqual(0)
      expect(metric.stateSize).toBeGreaterThanOrEqual(0)
    }
  })

  it('should track savepoint trigger latency', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const savepointManager = new SavepointManager(env)

    const startTime = Date.now()
    const savepoint = await savepointManager.triggerSavepoint('do://savepoints/latency-test')
    const endTime = Date.now()

    const metadata = savepoint.getMetadata()

    expect(metadata.getTriggerLatency()).toBeLessThanOrEqual(endTime - startTime)
  })

  it('should expose checkpoint metrics via JMX-style interface', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    env.enableCheckpointing(5000)

    const metrics = env.getMetricGroup().getCheckpointMetrics()

    expect(metrics.numberOfCompletedCheckpoints).toBeDefined()
    expect(metrics.numberOfInProgressCheckpoints).toBeDefined()
    expect(metrics.numberOfFailedCheckpoints).toBeDefined()
    expect(metrics.lastCheckpointDuration).toBeDefined()
    expect(metrics.lastCheckpointSize).toBeDefined()
    expect(metrics.lastCheckpointRestoreTimestamp).toBeDefined()
  })
})

// ===========================================================================
// Savepoint Version Compatibility
// ===========================================================================

describe('Savepoint Version Compatibility', () => {
  it('should store savepoint format version', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const savepointManager = new SavepointManager(env)
    const savepoint = await savepointManager.triggerSavepoint('do://savepoints/versioned')

    expect(savepoint.getMetadata().getFormatVersion()).toBeDefined()
    expect(typeof savepoint.getMetadata().getFormatVersion()).toBe('number')
  })

  it('should validate savepoint version on restore', async () => {
    const env = createTestEnvironment()

    // Try to restore from incompatible version
    const restoreSettings = SavepointRestoreSettings.forPath(
      'do://savepoints/old-version',
      { validateVersion: true }
    )

    await expect(
      env.restore(restoreSettings)
    ).rejects.toThrow('Incompatible savepoint version')
  })

  it('should support savepoint upgrade path', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const savepointManager = new SavepointManager(env)

    // Upgrade savepoint to latest format
    const upgradedPath = await savepointManager.upgradeSavepoint(
      'do://savepoints/old-format',
      'do://savepoints/upgraded'
    )

    expect(upgradedPath).toContain('do://savepoints/upgraded')
  })

  it('should include operator UID mapping in savepoint', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    // Add operators with explicit UIDs
    const stream = env.fromElements({ key: 'a', value: 1 })
    stream.uid('source-operator')
      .map((x) => x.value).uid('map-operator')

    const savepointManager = new SavepointManager(env)
    const savepoint = await savepointManager.triggerSavepoint('do://savepoints/with-uids')

    const operatorMapping = savepoint.getMetadata().getOperatorUIDMapping()

    expect(operatorMapping).toBeDefined()
    expect(operatorMapping.get('source-operator')).toBeDefined()
    expect(operatorMapping.get('map-operator')).toBeDefined()
  })
})

// ===========================================================================
// Checkpoint Failure Handling
// ===========================================================================

describe('Checkpoint Failure Handling', () => {
  it('should configure tolerable failure number', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const config = env.getCheckpointConfig()

    config.setTolerableCheckpointFailureNumber(5)

    expect(config.getTolerableCheckpointFailureNumber()).toBe(5)
  })

  it('should fail job when tolerance exceeded', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.getCheckpointConfig().setTolerableCheckpointFailureNumber(2)

    const coordinator = new CheckpointCoordinator(env)

    // Simulate 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      coordinator.simulateCheckpointFailure({
        reason: `Failure ${i + 1}`,
        operatorId: 'failing-op',
      })
      try {
        await coordinator.triggerCheckpoint()
      } catch {
        // Expected
      }
    }

    // Job should be marked as failed
    expect(coordinator.isJobFailed()).toBe(true)
    expect(coordinator.getFailureReason()).toContain('exceeded tolerable checkpoint failure')
  })

  it('should reset failure count after successful checkpoint', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.getCheckpointConfig().setTolerableCheckpointFailureNumber(3)

    const coordinator = new CheckpointCoordinator(env)

    // 2 failures
    for (let i = 0; i < 2; i++) {
      coordinator.simulateCheckpointFailure({
        reason: `Failure ${i + 1}`,
        operatorId: 'op',
      })
      try {
        await coordinator.triggerCheckpoint()
      } catch {
        // Expected
      }
    }

    // Clear failure simulation
    coordinator.clearFailureSimulation()

    // Successful checkpoint
    await coordinator.triggerCheckpoint()

    expect(coordinator.getConsecutiveFailureCount()).toBe(0)
  })

  it('should handle partial checkpoint failure', async () => {
    const env = createTestEnvironment()
    env.setParallelism(4)
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)
    const barrier = coordinator.initiateCheckpoint()

    // 3 of 4 subtasks succeed
    for (let i = 0; i < 3; i++) {
      await coordinator.acknowledgeBarrier(barrier.checkpointId, {
        operatorId: 'source',
        subtaskIndex: i,
      })
    }

    // 4th subtask fails
    coordinator.declineCheckpoint(barrier.checkpointId, {
      operatorId: 'source',
      subtaskIndex: 3,
      reason: 'OOM',
    })

    // Checkpoint should be aborted
    expect(coordinator.getPendingCheckpoint(barrier.checkpointId)?.isDiscarded()).toBe(true)
  })

  it('should support checkpoint failure callback', async () => {
    const failureCallbacks: { checkpointId: number; reason: string }[] = []

    const listener: CheckpointListener = {
      notifyCheckpointComplete: () => {},
      notifyCheckpointAborted: (checkpointId: number, reason?: string) => {
        failureCallbacks.push({ checkpointId, reason: reason ?? 'unknown' })
      },
    }

    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)
    coordinator.registerCheckpointListener(listener)

    // Force failure
    coordinator.simulateCheckpointFailure({
      reason: 'Test failure',
      operatorId: 'op',
    })

    try {
      await coordinator.triggerCheckpoint()
    } catch {
      // Expected
    }

    expect(failureCallbacks.length).toBe(1)
    expect(failureCallbacks[0]?.reason).toBe('Test failure')
  })
})

// ===========================================================================
// Local Recovery (Task-Local State)
// ===========================================================================

describe('Local Recovery', () => {
  it('should enable local recovery', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const config = env.getCheckpointConfig()

    config.enableLocalRecovery(true)

    expect(config.isLocalRecoveryEnabled()).toBe(true)
  })

  it('should configure local state directory', () => {
    const env = StreamExecutionEnvironment.getExecutionEnvironment()
    const config = env.getCheckpointConfig()

    config.setLocalRecoveryPath('/tmp/flink-local-state')

    expect(config.getLocalRecoveryPath()).toBe('/tmp/flink-local-state')
  })

  it('should prefer local state on recovery when available', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.getCheckpointConfig().enableLocalRecovery(true)
    env.getCheckpointConfig().setLocalRecoveryPath('/tmp/local-state')

    const coordinator = new CheckpointCoordinator(env)
    const checkpoint = await coordinator.triggerCheckpoint()

    // Simulate recovery with local state available
    const recoveryManager = new StateRecoveryManager(env)
    const result = await recoveryManager.recoverFromCheckpoint(checkpoint.getPath(), {
      preferLocalState: true,
    })

    expect(result.usedLocalState()).toBe(true)
    expect(result.getLocalStateHitRate()).toBeGreaterThan(0)
  })

  it('should fall back to remote state when local unavailable', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)
    env.getCheckpointConfig().enableLocalRecovery(true)

    const coordinator = new CheckpointCoordinator(env)
    const checkpoint = await coordinator.triggerCheckpoint()

    // Simulate recovery with local state unavailable
    const recoveryManager = new StateRecoveryManager(env)
    recoveryManager.setLocalStateAvailable(false)

    const result = await recoveryManager.recoverFromCheckpoint(checkpoint.getPath(), {
      preferLocalState: true,
    })

    expect(result.usedLocalState()).toBe(false)
    expect(result.fellBackToRemote()).toBe(true)
  })
})

// ===========================================================================
// Checkpoint ID and Sequence
// ===========================================================================

describe('Checkpoint ID and Sequence', () => {
  it('should generate monotonically increasing checkpoint IDs', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)

    const cp1 = await coordinator.triggerCheckpoint()
    const cp2 = await coordinator.triggerCheckpoint()
    const cp3 = await coordinator.triggerCheckpoint()

    expect(cp2.getCheckpointId()).toBeGreaterThan(cp1.getCheckpointId())
    expect(cp3.getCheckpointId()).toBeGreaterThan(cp2.getCheckpointId())
  })

  it('should start from specified checkpoint ID on restore', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)

    // Restore from checkpoint with ID 100
    await coordinator.restoreFromCheckpointId(100)

    const nextCheckpoint = await coordinator.triggerCheckpoint()

    expect(nextCheckpoint.getCheckpointId()).toBeGreaterThan(100)
  })

  it('should track checkpoint subsumed status', async () => {
    const env = createTestEnvironment()
    env.enableCheckpointing(5000)

    const coordinator = new CheckpointCoordinator(env)

    const cp1 = await coordinator.triggerCheckpoint()
    const cp2 = await coordinator.triggerCheckpoint()

    // cp1 should be subsumed by cp2
    expect(coordinator.isCheckpointSubsumed(cp1.getCheckpointId())).toBe(true)
    expect(coordinator.isCheckpointSubsumed(cp2.getCheckpointId())).toBe(false)
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
