/**
 * Pipeline Wire Format Serialization
 *
 * Serializes and deserializes Cap'n Web pipeline operations for RPC transport.
 *
 * Wire Format:
 * - Target: [noun, id] tuple identifying the DO instance
 * - Pipeline: Array of property/method steps
 * - Special types are serialized with $type markers
 * - Circular references use $ref markers (JSON pointer style)
 *
 * @see do-0am: Pipeline wire format
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A step in the pipeline - either property access or method call
 */
export type PipelineStep =
  | { type: 'property'; name: string }
  | { type: 'method'; name: string; args: unknown[] }

/**
 * Serialized pipeline ready for wire transport
 */
export interface SerializedPipeline {
  target: [noun: string, id: string]
  pipeline: PipelineStep[]
}

/**
 * Deserialized pipeline ready for execution
 */
export interface DeserializedPipeline {
  target: { noun: string; id: string }
  steps: PipelineStep[]
}

/**
 * Input stub chain structure (from proxy)
 */
interface StubChain {
  $noun: string
  $id: string
  $steps: PipelineStep[]
}

/**
 * RpcPromise marker interface
 */
interface RpcPromise {
  $isRpcPromise: true
  $placeholder: string
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serialize a pipeline stub chain to wire format
 */
export function serializePipeline(stub: StubChain): SerializedPipeline {
  return {
    target: [stub.$noun, stub.$id],
    pipeline: stub.$steps.map((step) => serializeStep(step)),
  }
}

/**
 * Serialize a single pipeline step
 */
function serializeStep(step: PipelineStep): PipelineStep {
  if (step.type === 'property') {
    return { type: 'property', name: step.name }
  }

  return {
    type: 'method',
    name: step.name,
    args: serializeArgs(step.args),
  }
}

/**
 * Serialize method arguments, handling special types
 */
function serializeArgs(args: unknown[]): unknown[] {
  return args.map((arg, index) => {
    const seen = new Map<object, string>()
    // Track the root argument separately for canonical '#' refs
    const root = typeof arg === 'object' && arg !== null ? arg : null
    return serializeValue(arg, seen, `#/args/${index}`, root)
  })
}

/**
 * Serialize a single value, handling special types and circular references
 *
 * @param value - The value to serialize
 * @param seen - Map of already-seen objects to their paths
 * @param path - Current JSON pointer path
 * @param root - The root argument object (used for canonical '#' refs)
 */
function serializeValue(
  value: unknown,
  seen: Map<object, string>,
  path: string,
  root: object | null,
): unknown {
  // Handle null/undefined
  if (value === null) return null
  if (value === undefined) return undefined

  // Handle primitives
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value

  // Handle numbers with special cases
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $type: 'NaN' }
    if (value === Infinity) return { $type: 'Infinity' }
    if (value === -Infinity) return { $type: '-Infinity' }
    return value
  }

  // Handle BigInt
  if (typeof value === 'bigint') {
    return { $type: 'BigInt', value: value.toString() }
  }

  // Handle functions - throw error
  if (typeof value === 'function') {
    throw new Error('cannot serialize function')
  }

  // Handle symbols - throw error
  if (typeof value === 'symbol') {
    throw new Error('cannot serialize symbol')
  }

  // Handle Date
  if (value instanceof Date) {
    return { $type: 'Date', value: value.toISOString() }
  }

  // Handle RegExp
  if (value instanceof RegExp) {
    return { $type: 'RegExp', source: value.source, flags: value.flags }
  }

  // Handle RpcPromise
  if (isRpcPromise(value)) {
    return { $type: 'RpcPromise', $placeholder: value.$placeholder }
  }

  // Handle arrays
  if (Array.isArray(value)) {
    // Check for circular reference
    if (seen.has(value)) {
      return { $ref: seen.get(value) }
    }
    seen.set(value, path)

    return value.map((item, index) => serializeValue(item, seen, `${path}/${index}`, root))
  }

  // Handle objects
  if (typeof value === 'object') {
    // Check for circular reference
    if (seen.has(value)) {
      // Use canonical '#' for references to the root argument object
      if (root !== null && value === root) {
        return { $ref: '#' }
      }
      return { $ref: seen.get(value) }
    }
    seen.set(value, path)

    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) {
        result[key] = serializeValue(val, seen, `${path}/${key}`, root)
      }
    }
    return result
  }

  return value
}

/**
 * Check if a value is an RpcPromise
 */
function isRpcPromise(value: unknown): value is RpcPromise {
  return (
    value !== null &&
    typeof value === 'object' &&
    '$isRpcPromise' in value &&
    (value as RpcPromise).$isRpcPromise === true
  )
}

// ============================================================================
// DESERIALIZATION
// ============================================================================

/**
 * Deserialize a wire format pipeline to executable form
 */
export function deserializePipeline(serialized: SerializedPipeline): DeserializedPipeline {
  const [noun, id] = serialized.target

  // First pass: deserialize all values without resolving refs
  const steps = serialized.pipeline.map((step) => deserializeStep(step))

  // Second pass: resolve circular references
  resolveRefs(steps)

  return {
    target: { noun, id },
    steps,
  }
}

/**
 * Deserialize a single pipeline step
 */
function deserializeStep(step: PipelineStep): PipelineStep {
  if (step.type === 'property') {
    return { type: 'property', name: step.name }
  }

  return {
    type: 'method',
    name: step.name,
    args: step.args.map((arg) => deserializeValue(arg)),
  }
}

/**
 * Deserialize a single value, handling special types
 */
function deserializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value

  // Handle $type markers
  if ('$type' in value) {
    const typed = value as Record<string, unknown>
    switch (typed.$type) {
      case 'Date':
        return new Date(typed.value as string)
      case 'NaN':
        return NaN
      case 'Infinity':
        return Infinity
      case '-Infinity':
        return -Infinity
      case 'BigInt':
        return BigInt(typed.value as string)
      case 'RegExp':
        return new RegExp(typed.source as string, typed.flags as string)
      case 'RpcPromise':
        // Return the placeholder for now; actual resolution happens at execution time
        return { $type: 'RpcPromise', $placeholder: typed.$placeholder }
    }
  }

  // Handle $ref markers - leave them for resolution pass
  if ('$ref' in value) {
    return value
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => deserializeValue(item))
  }

  // Handle plain objects
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    result[key] = deserializeValue(val)
  }
  return result
}

/**
 * Resolve $ref markers in the deserialized steps
 *
 * This walks the entire structure and replaces $ref markers with
 * actual references to the target objects.
 */
function resolveRefs(steps: PipelineStep[]): void {
  // Build a map of all objects by path
  const pathMap = new Map<string, unknown>()

  // Walk each step and build path map
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (step.type === 'method') {
      for (let j = 0; j < step.args.length; j++) {
        buildPathMap(step.args[j], `#/args/${j}`, pathMap)
      }
    }
  }

  // Now resolve refs
  for (const step of steps) {
    if (step.type === 'method') {
      for (let j = 0; j < step.args.length; j++) {
        step.args[j] = resolveRefsInValue(step.args[j], pathMap, step.args[j])
      }
    }
  }
}

/**
 * Build a map of paths to objects for ref resolution
 */
function buildPathMap(value: unknown, path: string, map: Map<string, unknown>): void {
  if (value === null || value === undefined || typeof value !== 'object') {
    return
  }

  // Skip $ref markers - they will be resolved
  if ('$ref' in value) {
    return
  }

  // Store this object's path
  map.set(path, value)

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      buildPathMap(value[i], `${path}/${i}`, map)
    }
  } else {
    for (const [key, val] of Object.entries(value)) {
      buildPathMap(val, `${path}/${key}`, map)
    }
  }
}

/**
 * Resolve $ref markers in a value, replacing them with actual references
 */
function resolveRefsInValue(value: unknown, pathMap: Map<string, unknown>, root: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }

  // Handle $ref markers
  if ('$ref' in value) {
    const ref = (value as { $ref: string }).$ref
    if (ref === '#') {
      // Self-reference to the root argument
      return root
    }
    // Look up in path map
    const resolved = pathMap.get(ref)
    if (resolved !== undefined) {
      return resolved
    }
    // If not found, return as-is (shouldn't happen in valid data)
    return value
  }

  // Handle arrays
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const resolved = resolveRefsInValue(value[i], pathMap, root)
      if (resolved !== value[i]) {
        value[i] = resolved
      }
    }
    return value
  }

  // Handle objects
  for (const [key, val] of Object.entries(value)) {
    const resolved = resolveRefsInValue(val, pathMap, root)
    if (resolved !== val) {
      ;(value as Record<string, unknown>)[key] = resolved
    }
  }

  return value
}
