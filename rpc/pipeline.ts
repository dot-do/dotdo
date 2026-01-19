// Pipeline/Promise Chaining - Cap'n Proto style
// Allows chaining RPC calls without awaiting intermediate results

export interface PipelinePromise<T> extends Promise<T> {
  // Chain another call on the result
  pipe<U>(fn: (result: T) => Promise<U> | U): PipelinePromise<U>

  // Access nested property/method
  get<K extends keyof T>(key: K): PipelinePromise<T[K]>

  // Call a method on the result
  call<K extends keyof T>(
    method: K,
    ...args: T[K] extends (...args: infer A) => any ? A : never[]
  ): PipelinePromise<T[K] extends (...args: any[]) => infer R ? Awaited<R> : never>
}

export function createPipeline<T>(promise: Promise<T>): PipelinePromise<T> {
  const pipeline = promise as PipelinePromise<T>

  Object.defineProperty(pipeline, 'pipe', {
    value: <U>(fn: (result: T) => Promise<U> | U): PipelinePromise<U> => {
      return createPipeline(promise.then(fn))
    },
    enumerable: true
  })

  Object.defineProperty(pipeline, 'get', {
    value: <K extends keyof T>(key: K): PipelinePromise<T[K]> => {
      return createPipeline(promise.then(result => result[key]))
    },
    enumerable: true
  })

  Object.defineProperty(pipeline, 'call', {
    value: <K extends keyof T>(method: K, ...args: unknown[]): PipelinePromise<unknown> => {
      return createPipeline(promise.then(result => {
        const fn = result[method]
        if (typeof fn !== 'function') {
          throw new Error(`${String(method)} is not a function`)
        }
        return (fn as Function).apply(result, args)
      }))
    },
    enumerable: true
  })

  return pipeline
}

// Enhance client with pipeline support
export function withPipeline<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop: string) {
      const value = (target as any)[prop]
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const promise = value.apply(target, args)
          return createPipeline(promise)
        }
      }
      return value
    }
  })
}
