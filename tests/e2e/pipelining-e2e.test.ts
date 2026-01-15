/**
 * E2E Pipelining Tests via HTTP Transport
 *
 * Tests the /rpc/pipeline endpoint which provides Cap'n Web-style
 * promise pipelining over HTTP.
 *
 * This tests the wiring of:
 * 1. DOCore.fetch receives pipeline requests at /rpc/pipeline
 * 2. PipelineExecutor resolves them
 * 3. NounAccessors provide thing data
 * 4. Results flow back through the pipeline
 *
 * @see do-h6p - GREEN: Wire up E2E pipelining
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Types
// =============================================================================

interface ThingData {
  $id: string
  $type: string
  $createdAt: string
  $updatedAt: string
  [key: string]: unknown
}

interface PipelineStep {
  type: 'property' | 'method'
  name: string
  args?: unknown[]
}

interface SerializedPipeline {
  target: [string, string]
  pipeline: PipelineStep[]
}

interface PipelineRequest {
  id?: string
  pipeline: SerializedPipeline
}

interface PipelineResponse {
  id?: string
  result?: unknown
  error?: string
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a DO stub for testing pipelining via HTTP
 */
function getDOStub(name = 'pipeline-http-e2e-test') {
  const id = env.DOFull.idFromName(name)
  return env.DOFull.get(id)
}

/**
 * Execute a pipeline via HTTP fetch to the /rpc/pipeline endpoint
 */
async function executePipeline(
  stub: DurableObjectStub,
  pipeline: SerializedPipeline,
  id?: string
): Promise<unknown> {
  const request: PipelineRequest = { pipeline }
  if (id) request.id = id

  const response = await stub.fetch('https://test.api.dotdo.dev/rpc/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Pipeline request failed')
  }

  const result = await response.json() as PipelineResponse
  if (result.error) {
    throw new Error(result.error)
  }

  return result.result
}

/**
 * Execute a batch of pipelines via HTTP
 */
async function executeBatchPipelines(
  stub: DurableObjectStub,
  requests: PipelineRequest[]
): Promise<PipelineResponse[]> {
  const response = await stub.fetch('https://test.api.dotdo.dev/rpc/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Batch pipeline request failed')
  }

  return response.json() as Promise<PipelineResponse[]>
}

// =============================================================================
// 1. BASIC PIPELINE EXECUTION
// =============================================================================

describe('E2E HTTP Pipeline: Basic Execution', () => {
  it('should execute a pipeline that calls a method on noun accessor', async () => {
    const doStub = getDOStub('pipeline-basic-1')

    // First create some test data via RPC
    await doStub.create('Customer', {
      $id: 'customer-basic-1',
      name: 'Alice',
      email: 'alice@example.com',
    })

    // Execute pipeline: Customer('customer-basic-1').getProfile()
    const result = await executePipeline(doStub, {
      target: ['Customer', 'customer-basic-1'],
      pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
    })

    expect(result).toBeDefined()
    expect((result as ThingData).$id).toBe('customer-basic-1')
    expect((result as ThingData).name).toBe('Alice')
  })

  it('should execute a pipeline with property access', async () => {
    const doStub = getDOStub('pipeline-prop-1')

    // Create test data with nested properties
    await doStub.create('Customer', {
      $id: 'customer-prop-1',
      name: 'Bob',
      profile: {
        email: 'bob@example.com',
        settings: { theme: 'dark' },
      },
    })

    // Execute pipeline: Customer('customer-prop-1').profile
    const result = await executePipeline(doStub, {
      target: ['Customer', 'customer-prop-1'],
      pipeline: [{ type: 'property', name: 'profile' }],
    })

    expect(result).toBeDefined()
    expect((result as { email: string }).email).toBe('bob@example.com')
  })

  it('should execute a pipeline with chained property access', async () => {
    const doStub = getDOStub('pipeline-chain-1')

    // Create test data
    await doStub.create('Customer', {
      $id: 'customer-chain-1',
      profile: {
        email: 'chain@example.com',
        settings: {
          theme: 'light',
          language: 'en',
        },
      },
    })

    // Execute pipeline: Customer('customer-chain-1').getProfile().then(profile => profile.email)
    // First get the profile, then access email
    const profile = await executePipeline(doStub, {
      target: ['Customer', 'customer-chain-1'],
      pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
    }) as ThingData

    expect(profile.profile).toBeDefined()
    expect((profile.profile as { email: string }).email).toBe('chain@example.com')
  })
})

// =============================================================================
// 2. BATCH PIPELINE EXECUTION
// =============================================================================

describe('E2E HTTP Pipeline: Batch Execution', () => {
  it('should execute multiple pipelines in a single request', async () => {
    const doStub = getDOStub('pipeline-batch-1')

    // Create test data for multiple customers
    await doStub.create('Customer', {
      $id: 'batch-cust-1',
      name: 'Customer 1',
    })

    await doStub.create('Customer', {
      $id: 'batch-cust-2',
      name: 'Customer 2',
    })

    await doStub.create('Customer', {
      $id: 'batch-cust-3',
      name: 'Customer 3',
    })

    // Execute batch of pipelines
    const results = await executeBatchPipelines(doStub, [
      {
        id: 'req-1',
        pipeline: {
          target: ['Customer', 'batch-cust-1'],
          pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
        },
      },
      {
        id: 'req-2',
        pipeline: {
          target: ['Customer', 'batch-cust-2'],
          pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
        },
      },
      {
        id: 'req-3',
        pipeline: {
          target: ['Customer', 'batch-cust-3'],
          pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
        },
      },
    ])

    expect(results).toHaveLength(3)
    expect(results[0].id).toBe('req-1')
    expect(results[1].id).toBe('req-2')
    expect(results[2].id).toBe('req-3')

    expect((results[0].result as ThingData).name).toBe('Customer 1')
    expect((results[1].result as ThingData).name).toBe('Customer 2')
    expect((results[2].result as ThingData).name).toBe('Customer 3')
  })

  it('should handle mixed success and error in batch', async () => {
    const doStub = getDOStub('pipeline-batch-error-1')

    // Create only one customer
    await doStub.create('Customer', {
      $id: 'batch-exists',
      name: 'Existing Customer',
    })

    // Execute batch - one exists, one doesn't
    const results = await executeBatchPipelines(doStub, [
      {
        id: 'exists',
        pipeline: {
          target: ['Customer', 'batch-exists'],
          pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
        },
      },
      {
        id: 'missing',
        pipeline: {
          target: ['Customer', 'batch-missing'],
          pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
        },
      },
    ])

    expect(results).toHaveLength(2)

    // First should succeed
    expect(results[0].id).toBe('exists')
    expect(results[0].result).toBeDefined()

    // Second should either return null (no error) or succeed with null
    expect(results[1].id).toBe('missing')
    // getProfile returns null for non-existent things
    expect(results[1].result).toBeNull()
  })
})

// =============================================================================
// 3. NOUN ACCESSOR METHODS
// =============================================================================

describe('E2E HTTP Pipeline: Noun Accessor Methods', () => {
  it('should execute update via pipeline', async () => {
    const doStub = getDOStub('pipeline-update-1')

    // Create test customer
    await doStub.create('Customer', {
      $id: 'update-cust-1',
      name: 'Original Name',
      email: 'original@example.com',
    })

    // Execute pipeline: Customer('update-cust-1').update({ name: 'Updated Name' })
    const result = await executePipeline(doStub, {
      target: ['Customer', 'update-cust-1'],
      pipeline: [
        { type: 'method', name: 'update', args: [{ name: 'Updated Name' }] },
      ],
    }) as ThingData

    expect(result.name).toBe('Updated Name')
    expect(result.$id).toBe('update-cust-1')

    // Verify the update persisted
    const profile = await executePipeline(doStub, {
      target: ['Customer', 'update-cust-1'],
      pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
    }) as ThingData

    expect(profile.name).toBe('Updated Name')
  })

  it('should execute delete via pipeline', async () => {
    const doStub = getDOStub('pipeline-delete-1')

    // Create test customer
    await doStub.create('Customer', {
      $id: 'delete-cust-1',
      name: 'To Delete',
    })

    // Verify it exists first
    const beforeDelete = await executePipeline(doStub, {
      target: ['Customer', 'delete-cust-1'],
      pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
    })
    expect(beforeDelete).toBeDefined()

    // Execute pipeline: Customer('delete-cust-1').delete()
    const deleteResult = await executePipeline(doStub, {
      target: ['Customer', 'delete-cust-1'],
      pipeline: [{ type: 'method', name: 'delete', args: [] }],
    })

    expect(deleteResult).toBe(true)

    // Verify it's gone
    const afterDelete = await executePipeline(doStub, {
      target: ['Customer', 'delete-cust-1'],
      pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
    })
    expect(afterDelete).toBeNull()
  })

  it('should execute getStatus via pipeline', async () => {
    const doStub = getDOStub('pipeline-status-1')

    // Execute pipeline: Customer('any-id').getStatus()
    // This works even without data - it's a method that returns a status
    const result = await executePipeline(doStub, {
      target: ['Customer', 'any-id'],
      pipeline: [{ type: 'method', name: 'getStatus', args: [] }],
    }) as { status: string }

    expect(result.status).toBe('active')
  })
})

// =============================================================================
// 4. ERROR HANDLING
// =============================================================================

describe('E2E HTTP Pipeline: Error Handling', () => {
  it('should handle method not found error', async () => {
    const doStub = getDOStub('pipeline-error-1')

    try {
      await executePipeline(doStub, {
        target: ['Customer', 'any-id'],
        pipeline: [{ type: 'method', name: 'nonExistentMethod', args: [] }],
      })
      expect.fail('Should have thrown error')
    } catch (error) {
      expect((error as Error).message).toMatch(/not a function|not defined/i)
    }
  })

  it('should handle property access on null', async () => {
    const doStub = getDOStub('pipeline-error-2')

    // Try to access property on null (getData returns null for non-existent thing)
    try {
      await executePipeline(doStub, {
        target: ['Customer', 'non-existent'],
        pipeline: [
          { type: 'method', name: 'getData', args: [] },
          { type: 'property', name: 'name' },
        ],
      })
      expect.fail('Should have thrown error')
    } catch (error) {
      expect((error as Error).message).toMatch(/null|undefined|not found/i)
    }
  })

  it('should handle malformed pipeline request', async () => {
    const doStub = getDOStub('pipeline-error-3')

    const response = await doStub.fetch('https://test.api.dotdo.dev/rpc/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    })

    expect(response.status).toBe(400)
  })
})

// =============================================================================
// 5. INTEGRATION WITH REAL THING CRUD
// =============================================================================

describe('E2E HTTP Pipeline: Full CRUD Integration', () => {
  it('should support complete thing lifecycle via pipelines', async () => {
    const doStub = getDOStub('pipeline-crud-1')

    // 1. Create via direct RPC (not pipeline - that's for testing the noun accessor)
    const created = await doStub.create('Customer', {
      $id: 'crud-lifecycle-1',
      name: 'New Customer',
      email: 'new@example.com',
      status: 'pending',
    })

    expect(created.$id).toBe('crud-lifecycle-1')

    // 2. Read via pipeline
    const read = await executePipeline(doStub, {
      target: ['Customer', 'crud-lifecycle-1'],
      pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
    }) as ThingData

    expect(read.name).toBe('New Customer')
    expect(read.status).toBe('pending')

    // 3. Update via pipeline
    const updated = await executePipeline(doStub, {
      target: ['Customer', 'crud-lifecycle-1'],
      pipeline: [
        {
          type: 'method',
          name: 'update',
          args: [{ status: 'active', activatedAt: new Date().toISOString() }],
        },
      ],
    }) as ThingData

    expect(updated.status).toBe('active')
    expect(updated.activatedAt).toBeDefined()

    // 4. Delete via pipeline
    const deleted = await executePipeline(doStub, {
      target: ['Customer', 'crud-lifecycle-1'],
      pipeline: [{ type: 'method', name: 'delete', args: [] }],
    })

    expect(deleted).toBe(true)

    // 5. Verify deletion
    const afterDelete = await executePipeline(doStub, {
      target: ['Customer', 'crud-lifecycle-1'],
      pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
    })

    expect(afterDelete).toBeNull()
  })
})
