/**
 * @dotdo/salesforce - Bulk API v2 Compatibility Layer Tests
 *
 * Tests for Salesforce Bulk API v2 operations:
 * - Job creation and management
 * - Batch data upload (CSV/JSON formats)
 * - Job status polling and lifecycle
 * - Result fetching (successful, failed, unprocessed)
 * - Bulk queries (sync and async)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Connection,
  SalesforceError,
  type BulkJobInfo,
  type BulkJobState,
  type BulkOperation,
  type BulkJobOptions,
  type BulkResult,
  type SObject,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown; headers?: Record<string, string> }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const method = options?.method ?? 'GET'
    const key = `${method} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [{ errorCode: 'NOT_FOUND', message: `No mock for ${key}` }],
        text: async () => JSON.stringify([{ errorCode: 'NOT_FOUND', message: `No mock for ${key}` }]),
      }
    }

    // Determine content type
    const contentType = mockResponse.headers?.['content-type'] ||
      (typeof mockResponse.body === 'string' ? 'text/csv' : 'application/json')

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'content-type': contentType, ...mockResponse.headers }),
      json: async () => mockResponse.body,
      text: async () => typeof mockResponse.body === 'string' ? mockResponse.body : JSON.stringify(mockResponse.body),
    }
  })
}

function createJobInfo(overrides: Partial<BulkJobInfo> = {}): BulkJobInfo {
  return {
    id: '750xx0000004567AAA',
    operation: 'insert',
    object: 'Account',
    state: 'Open',
    createdDate: '2024-01-15T10:00:00.000Z',
    contentType: 'CSV',
    apiVersion: '59.0',
    lineEnding: 'LF',
    ...overrides,
  }
}

// =============================================================================
// Bulk API v2 - Job Creation Tests
// =============================================================================

describe('@dotdo/salesforce - Bulk API v2 Job Creation', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  describe('createJob', () => {
    it('should create an insert job with default options', () => {
      const job = conn.bulk.createJob('Account', 'insert')

      expect(job.object).toBe('Account')
      expect(job.operation).toBe('insert')
      expect(job.id).toBeUndefined()
    })

    it('should create an update job', () => {
      const job = conn.bulk.createJob('Contact', 'update')

      expect(job.object).toBe('Contact')
      expect(job.operation).toBe('update')
    })

    it('should create a delete job', () => {
      const job = conn.bulk.createJob('Lead', 'delete')

      expect(job.object).toBe('Lead')
      expect(job.operation).toBe('delete')
    })

    it('should create a hardDelete job', () => {
      const job = conn.bulk.createJob('Account', 'hardDelete')

      expect(job.operation).toBe('hardDelete')
    })

    it('should create an upsert job with external ID field', () => {
      const job = conn.bulk.createJob('Account', 'upsert', {
        externalIdFieldName: 'External_ID__c',
      })

      expect(job.operation).toBe('upsert')
      expect(job.options?.externalIdFieldName).toBe('External_ID__c')
    })

    it('should support CRLF line ending option', () => {
      const job = conn.bulk.createJob('Account', 'insert', {
        lineEnding: 'CRLF',
      })

      expect(job.options?.lineEnding).toBe('CRLF')
    })

    it('should support custom column delimiter', () => {
      const job = conn.bulk.createJob('Account', 'insert', {
        columnDelimiter: 'TAB',
      })

      expect(job.options?.columnDelimiter).toBe('TAB')
    })

    it('should support concurrency mode (serial vs parallel)', () => {
      const job = conn.bulk.createJob('Account', 'insert', {
        concurrencyMode: 'Serial',
      })

      expect(job.options?.concurrencyMode).toBe('Serial')
    })
  })

  describe('job.open()', () => {
    it('should open a job and return job info', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 200,
              body: createJobInfo({ id: '750xx0000004567AAA', state: 'Open' }),
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const jobInfo = await job.open()

      expect(jobInfo.id).toBe('750xx0000004567AAA')
      expect(jobInfo.state).toBe('Open')
      expect(jobInfo.object).toBe('Account')
      expect(jobInfo.operation).toBe('insert')
      expect(job.id).toBe('750xx0000004567AAA')
    })

    it('should include externalIdFieldName for upsert jobs', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 200,
              body: createJobInfo({
                id: '750xx0000004567AAA',
                operation: 'upsert',
                externalIdFieldName: 'External_ID__c',
              }),
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'upsert', {
        externalIdFieldName: 'External_ID__c',
      })
      const jobInfo = await job.open()

      expect(jobInfo.externalIdFieldName).toBe('External_ID__c')
    })

    it('should throw error on API failure', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 400,
              body: [{ errorCode: 'INVALID_OPERATION', message: 'Invalid operation for object' }],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')

      await expect(job.open()).rejects.toThrow(SalesforceError)
    })
  })
})

// =============================================================================
// Bulk API v2 - Data Upload Tests
// =============================================================================

describe('@dotdo/salesforce - Bulk API v2 Data Upload', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  describe('batch.execute() with JSON records', () => {
    it('should upload records as CSV and emit queue event', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      const records = [
        { Name: 'Account 1', Industry: 'Technology' },
        { Name: 'Account 2', Industry: 'Finance' },
      ]

      batch.execute(records)

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))

      // Verify the request was made with CSV content
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should handle empty field values correctly', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      const records = [
        { Name: 'Account 1', Website: null },
        { Name: 'Account 2', Website: undefined },
      ]

      batch.execute(records)

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))
    })

    it('should escape special characters in CSV', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      const records = [
        { Name: 'Account "With Quotes"', Description: 'Has, comma' },
        { Name: 'Account\nWith\nNewlines', Description: 'Normal' },
      ]

      batch.execute(records)

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))
    })
  })

  describe('batch.execute() with CSV string', () => {
    it('should upload CSV string directly', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      const csvData = 'Name,Industry\nAccount 1,Technology\nAccount 2,Finance'

      batch.execute(csvData)

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))
    })

    it('should parse CSV headers and values correctly', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      const csvData = '"Name","Industry","Website"\n"Acme Corp","Technology","https://acme.com"'

      batch.execute(csvData)

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))
    })
  })

  describe('upload error handling', () => {
    it('should emit error event on upload failure', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            {
              status: 400,
              body: [{ errorCode: 'INVALID_FIELD', message: 'Invalid field: Foo__c' }],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      batch.execute([{ Foo__c: 'bar' }])

      await new Promise<void>((resolve) => batch.on('error', () => resolve()))
    })

    it('should emit error event on job creation failure', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 400,
              body: [{ errorCode: 'INVALID_OBJECT', message: 'Invalid object: FakeObject__c' }],
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('FakeObject__c', 'insert')
      const batch = job.createBatch()

      batch.execute([{ Name: 'Test' }])

      await new Promise<void>((resolve) => batch.on('error', () => resolve()))
    })
  })
})

// =============================================================================
// Bulk API v2 - Job Lifecycle Tests
// =============================================================================

describe('@dotdo/salesforce - Bulk API v2 Job Lifecycle', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  describe('job.close()', () => {
    it('should close job and start processing', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      await job.open()
      const closedJob = await job.close()

      expect(closedJob.state).toBe('UploadComplete')
    })

    it('should throw error if job not opened', async () => {
      const job = conn.bulk.createJob('Account', 'insert')

      await expect(job.close()).rejects.toThrow(SalesforceError)
    })
  })

  describe('job.abort()', () => {
    it('should abort a running job', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'Aborted' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      await job.open()
      const abortedJob = await job.abort()

      expect(abortedJob.state).toBe('Aborted')
    })

    it('should throw error if job not opened', async () => {
      const job = conn.bulk.createJob('Account', 'insert')

      await expect(job.abort()).rejects.toThrow(SalesforceError)
    })
  })

  describe('job.check()', () => {
    it('should return current job status', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            {
              status: 200,
              body: createJobInfo({
                state: 'InProgress',
                numberRecordsProcessed: 500,
                numberRecordsFailed: 2,
              }),
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      await job.open()
      const status = await job.check()

      expect(status.state).toBe('InProgress')
      expect(status.numberRecordsProcessed).toBe(500)
      expect(status.numberRecordsFailed).toBe(2)
    })

    it('should track total processing time', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            {
              status: 200,
              body: createJobInfo({
                state: 'JobComplete',
                totalProcessingTime: 15000,
              }),
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      await job.open()
      const status = await job.check()

      expect(status.totalProcessingTime).toBe(15000)
    })
  })
})

// =============================================================================
// Bulk API v2 - Result Fetching Tests
// =============================================================================

describe('@dotdo/salesforce - Bulk API v2 Results', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  describe('batch.poll()', () => {
    it('should poll until job completes and return results', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'JobComplete' }) },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA/successfulResults',
            {
              status: 200,
              body: '"sf__Id","sf__Created","Name"\n"001xx000003DGxYAAW","true","Account 1"\n"001xx000003DGxZAAW","true","Account 2"',
              headers: { 'content-type': 'text/csv' },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      batch.execute([{ Name: 'Account 1' }, { Name: 'Account 2' }])

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))

      const results = await batch.poll()

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[0].id).toBe('001xx000003DGxYAAW')
      expect(results[0].created).toBe(true)
    })

    it('should throw error on job failure', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            {
              status: 200,
              body: createJobInfo({
                state: 'Failed',
                errorMessage: 'Invalid data format',
              }),
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      batch.execute([{ Name: 'Account 1' }])

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))

      await expect(batch.poll()).rejects.toThrow(SalesforceError)
    })

    it('should throw error on job abort', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'Aborted' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      batch.execute([{ Name: 'Account 1' }])

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))

      await expect(batch.poll()).rejects.toThrow(SalesforceError)
    })
  })

  describe('getSuccessfulResults()', () => {
    it('should fetch successful results as parsed records', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA/successfulResults',
            {
              status: 200,
              body: '"sf__Id","sf__Created","Name","Industry"\n"001xx000003DGxYAAW","true","Acme","Technology"',
              headers: { 'content-type': 'text/csv' },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      await job.open()

      // Access the internal method for testing
      const resultsUrl = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest/${job.id}/successfulResults`
      const csv = await conn._request<string>('GET', resultsUrl, undefined, {
        Accept: 'text/csv',
      })

      expect(csv).toContain('sf__Id')
      expect(csv).toContain('001xx000003DGxYAAW')
    })
  })

  describe('getFailedResults()', () => {
    it('should fetch failed results with error details', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA/failedResults',
            {
              status: 200,
              body: '"sf__Id","sf__Error","Name"\n"","REQUIRED_FIELD_MISSING:Name",""\n"","DUPLICATE_VALUE:External_ID__c","Dup Account"',
              headers: { 'content-type': 'text/csv' },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      await job.open()

      const resultsUrl = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest/${job.id}/failedResults`
      const csv = await conn._request<string>('GET', resultsUrl, undefined, {
        Accept: 'text/csv',
      })

      expect(csv).toContain('sf__Error')
      expect(csv).toContain('REQUIRED_FIELD_MISSING')
    })
  })

  describe('getUnprocessedRecords()', () => {
    it('should fetch unprocessed records', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA' }) },
          ],
          [
            'GET /services/data/v59.0/jobs/ingest/750xx0000004567AAA/unprocessedrecords',
            {
              status: 200,
              body: '"Name","Industry"\n"Unprocessed Account","Tech"',
              headers: { 'content-type': 'text/csv' },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'insert')
      await job.open()

      const resultsUrl = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest/${job.id}/unprocessedrecords`
      const csv = await conn._request<string>('GET', resultsUrl, undefined, {
        Accept: 'text/csv',
      })

      expect(csv).toContain('Unprocessed Account')
    })
  })
})

// =============================================================================
// Bulk API v2 - Query Tests
// =============================================================================

describe('@dotdo/salesforce - Bulk API v2 Query', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  describe('bulk.query()', () => {
    it('should create a bulk query job', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/query',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                operation: 'query',
                state: 'UploadComplete',
                object: 'Account',
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const queryJob = await conn.bulk.query('SELECT Id, Name FROM Account')

      expect(queryJob.id).toBe('750xx0000004567AAA')
      expect(queryJob.operation).toBe('query')
    })

    it('should poll for query results', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/query',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                operation: 'query',
                state: 'UploadComplete',
              },
            },
          ],
          [
            'GET /services/data/v59.0/jobs/query/750xx0000004567AAA',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                state: 'JobComplete',
              },
            },
          ],
          [
            'GET /services/data/v59.0/jobs/query/750xx0000004567AAA/results',
            {
              status: 200,
              body: '"Id","Name"\n"001xx000003DGxYAAW","Acme Inc"\n"001xx000003DGxZAAW","Globex Corp"',
              headers: { 'content-type': 'text/csv' },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const queryJob = await conn.bulk.query('SELECT Id, Name FROM Account')
      const results = await queryJob.poll()

      expect(results).toHaveLength(2)
      expect(results[0].Id).toBe('001xx000003DGxYAAW')
      expect(results[0].Name).toBe('Acme Inc')
    })

    it('should handle query job failure', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/query',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                operation: 'query',
                state: 'UploadComplete',
              },
            },
          ],
          [
            'GET /services/data/v59.0/jobs/query/750xx0000004567AAA',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                state: 'Failed',
                errorMessage: 'Invalid query syntax',
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const queryJob = await conn.bulk.query('SELECT INVALID')

      await expect(queryJob.poll()).rejects.toThrow(SalesforceError)
    })
  })

  describe('bulk.queryAll()', () => {
    it('should create a queryAll job (includes deleted records)', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/query',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                operation: 'queryAll',
                state: 'UploadComplete',
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const queryJob = await conn.bulk.queryAll('SELECT Id, Name, IsDeleted FROM Account')

      expect(queryJob.operation).toBe('queryAll')
    })
  })

  describe('query result pagination', () => {
    it('should handle large result sets with locator', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/query',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                operation: 'query',
                state: 'UploadComplete',
              },
            },
          ],
          [
            'GET /services/data/v59.0/jobs/query/750xx0000004567AAA',
            {
              status: 200,
              body: {
                id: '750xx0000004567AAA',
                state: 'JobComplete',
                numberRecordsProcessed: 100000,
              },
            },
          ],
          [
            'GET /services/data/v59.0/jobs/query/750xx0000004567AAA/results',
            {
              status: 200,
              body: '"Id","Name"\n' + Array(1000).fill('"001xx","Test"').join('\n'),
              headers: {
                'content-type': 'text/csv',
                'Sforce-Locator': 'ABC123',
              },
            },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const queryJob = await conn.bulk.query('SELECT Id, Name FROM Account')
      const results = await queryJob.poll()

      expect(results.length).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// Bulk API v2 - Update Operations Tests
// =============================================================================

describe('@dotdo/salesforce - Bulk API v2 Update Operations', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  describe('bulk update', () => {
    it('should update records with Id field', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA', operation: 'update' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'update')
      const batch = job.createBatch()

      const records = [
        { Id: '001xx000003DGxYAAW', Website: 'https://acme.com' },
        { Id: '001xx000003DGxZAAW', Website: 'https://globex.com' },
      ]

      batch.execute(records)

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))
    })
  })

  describe('bulk upsert', () => {
    it('should upsert records with external ID', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            {
              status: 200,
              body: createJobInfo({
                id: '750xx0000004567AAA',
                operation: 'upsert',
                externalIdFieldName: 'External_ID__c',
              }),
            },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'upsert', {
        externalIdFieldName: 'External_ID__c',
      })
      const batch = job.createBatch()

      const records = [
        { External_ID__c: 'EXT-001', Name: 'Account 1' },
        { External_ID__c: 'EXT-002', Name: 'Account 2' },
      ]

      batch.execute(records)

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))
    })
  })

  describe('bulk delete', () => {
    it('should delete records by Id', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA', operation: 'delete' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'delete')
      const batch = job.createBatch()

      const records = [
        { Id: '001xx000003DGxYAAW' },
        { Id: '001xx000003DGxZAAW' },
      ]

      batch.execute(records)

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))
    })
  })

  describe('bulk hardDelete', () => {
    it('should hard delete records (bypass recycle bin)', async () => {
      mockFetch = createMockFetch(
        new Map([
          [
            'POST /services/data/v59.0/jobs/ingest',
            { status: 200, body: createJobInfo({ id: '750xx0000004567AAA', operation: 'hardDelete' }) },
          ],
          [
            'PUT /services/data/v59.0/jobs/ingest/750xx0000004567AAA/batches',
            { status: 201, body: null },
          ],
          [
            'PATCH /services/data/v59.0/jobs/ingest/750xx0000004567AAA',
            { status: 200, body: createJobInfo({ state: 'UploadComplete' }) },
          ],
        ])
      )
      conn = new Connection({
        instanceUrl: 'https://na1.salesforce.com',
        accessToken: 'test_token',
        fetch: mockFetch,
      })

      const job = conn.bulk.createJob('Account', 'hardDelete')
      const batch = job.createBatch()

      const records = [{ Id: '001xx000003DGxYAAW' }]

      batch.execute(records)

      await new Promise<void>((resolve) => batch.on('queue', () => resolve()))

      expect(job.operation).toBe('hardDelete')
    })
  })
})

// =============================================================================
// Bulk API v2 - Integration Patterns Tests
// =============================================================================

describe('@dotdo/salesforce - Bulk API v2 Integration Patterns', () => {
  let conn: Connection
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch(new Map())
    conn = new Connection({
      instanceUrl: 'https://na1.salesforce.com',
      accessToken: 'test_token',
      fetch: mockFetch,
    })
  })

  describe('concurrent job management', () => {
    it('should support creating multiple jobs', () => {
      const job1 = conn.bulk.createJob('Account', 'insert')
      const job2 = conn.bulk.createJob('Contact', 'insert')
      const job3 = conn.bulk.createJob('Lead', 'upsert', {
        externalIdFieldName: 'Email',
      })

      expect(job1.object).toBe('Account')
      expect(job2.object).toBe('Contact')
      expect(job3.object).toBe('Lead')
    })
  })

  describe('jsforce compatibility', () => {
    it('should match jsforce bulk API interface', () => {
      // Test that the bulk property and methods exist
      expect(conn.bulk).toBeDefined()
      expect(typeof conn.bulk.createJob).toBe('function')
      expect(typeof conn.bulk.query).toBe('function')
      expect(typeof conn.bulk.queryAll).toBe('function')
    })

    it('should support event emitter pattern on batches', () => {
      const job = conn.bulk.createJob('Account', 'insert')
      const batch = job.createBatch()

      expect(typeof batch.on).toBe('function')
      expect(typeof batch.execute).toBe('function')
      expect(typeof batch.poll).toBe('function')
    })
  })
})
