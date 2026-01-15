/**
 * Record-Replay Pattern for .map() Operations
 *
 * This module implements the record-replay pattern that allows:
 * ```typescript
 * const names = await this.Users(['alice', 'bob']).map(user => user.name)
 * // Recording mode captures: [{ type: 'property', name: 'name' }]
 * // Server replays on each user, returns ['Alice', 'Bob']
 * ```
 *
 * @see do-1ms: GREEN: Implement record-replay .map()
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single recorded operation - either property access or method call
 */
export type RecordedOperation =
  | { type: 'property'; name: string }
  | { type: 'method'; name: string; args: unknown[] }

/**
 * A complete recording of operations to be replayed
 */
export interface Recording {
  operations: RecordedOperation[]
}

/**
 * The RecordingStub interface - a proxy that records property access and method calls
 */
export interface RecordingStub<T> {
  getRecording(): Recording
}

// Properties that should not be recorded (Promise-like, debugging, internal)
const IGNORED_PROPERTIES = new Set(['then', 'catch', 'finally', 'getRecording'])

// ============================================================================
// RECORDING STUB IMPLEMENTATION
// ============================================================================

/**
 * Creates a recording stub that captures property access and method calls.
 *
 * The stub uses Proxy to intercept all property access and method invocations,
 * recording them for later replay on actual elements.
 */
export function createRecordingStub<T>(): RecordingStub<T> & T {
  // Shared operations array for the entire chain
  const operations: RecordedOperation[] = []

  return createChainedProxy<T>(operations)
}

/**
 * Creates a chained proxy that records operations to a shared array
 */
function createChainedProxy<T>(operations: RecordedOperation[]): RecordingStub<T> & T {
  const proxy = new Proxy(function () {} as any, {
    get(target, prop, receiver) {
      // Handle Symbols specially - don't record them
      if (typeof prop === 'symbol') {
        if (prop === Symbol.toStringTag) {
          return 'RecordingStub'
        }
        return undefined
      }

      const propName = String(prop)

      // Handle getRecording - return the recording without recording it
      if (propName === 'getRecording') {
        return () => ({
          // Return a copy to maintain immutability
          operations: operations.map((op) => ({ ...op })),
        })
      }

      // Don't record Promise-like properties
      if (IGNORED_PROPERTIES.has(propName)) {
        return undefined
      }

      // Record the property access
      operations.push({ type: 'property', name: propName })

      // Return a new chained proxy that shares the same operations array
      return createChainedProxy(operations)
    },

    apply(target, thisArg, args) {
      // This is called when the proxy is invoked as a function
      // We need to record this as a method call on the last recorded property
      // But since we already recorded the property access in 'get', we need to convert it to a method

      // Get the last operation and convert it from property to method
      const lastOp = operations[operations.length - 1]
      if (lastOp && lastOp.type === 'property') {
        // Convert the property access to a method call
        operations[operations.length - 1] = {
          type: 'method',
          name: lastOp.name,
          args: [...args],
        }
      }

      // Return a new chained proxy for further chaining
      return createChainedProxy(operations)
    },
  })

  return proxy
}

// ============================================================================
// REPLAY IMPLEMENTATION
// ============================================================================

/**
 * Replays a recording on a target element, returning the final result.
 *
 * @param recording - The recording to replay
 * @param element - The element to replay on
 * @returns The result of replaying all operations
 */
export function replayRecording<T, R>(recording: Recording, element: T): R {
  let current: any = element

  for (let i = 0; i < recording.operations.length; i++) {
    const op = recording.operations[i]

    // Check if current is null/undefined before accessing
    if (current === null || current === undefined) {
      const opName = op.type === 'property' ? op.name : op.name
      throw new Error(
        `Cannot read property '${opName}' of ${current} at step ${i}. ` +
          `Recording path: ${formatRecordingPath(recording.operations.slice(0, i + 1))}`
      )
    }

    if (op.type === 'property') {
      current = current[op.name]
    } else if (op.type === 'method') {
      const method = current[op.name]
      if (typeof method !== 'function') {
        throw new Error(
          `'${op.name}' is not a function at step ${i}. ` +
            `Got ${typeof method}: ${JSON.stringify(method)}`
        )
      }
      current = method.apply(current, op.args)
    }

    // Handle promises - if the result is a promise, we need to await it
    if (current instanceof Promise) {
      // Create a continuation that replays remaining operations on the resolved value
      const remainingOps = recording.operations.slice(i + 1)
      if (remainingOps.length > 0) {
        return current.then((resolved: any) =>
          replayRecording({ operations: remainingOps }, resolved)
        ) as R
      }
      return current as R
    }
  }

  return current as R
}

/**
 * Format a recording path for error messages
 */
function formatRecordingPath(operations: RecordedOperation[]): string {
  return operations
    .map((op) => {
      if (op.type === 'property') {
        return `.${op.name}`
      }
      const argsStr = op.args.map((a) => JSON.stringify(a)).join(', ')
      return `.${op.name}(${argsStr})`
    })
    .join('')
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serializes a recording to a JSON-compatible format for wire transmission.
 *
 * @param recording - The recording to serialize
 * @returns A JSON-compatible object
 */
export function serializeRecording(recording: Recording): Recording {
  return {
    operations: recording.operations.map((op) => {
      if (op.type === 'property') {
        return { type: 'property' as const, name: op.name }
      }
      return {
        type: 'method' as const,
        name: op.name,
        args: op.args,
      }
    }),
  }
}

/**
 * Deserializes a recording from a JSON object received over the wire.
 *
 * @param json - The JSON object to deserialize
 * @returns A Recording object
 */
export function deserializeRecording(json: Recording): Recording {
  return {
    operations: json.operations.map((op) => {
      if (op.type === 'property') {
        return { type: 'property' as const, name: op.name }
      }
      return {
        type: 'method' as const,
        name: op.name,
        args: (op as any).args ?? [],
      }
    }),
  }
}
