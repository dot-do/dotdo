/**
 * E2E Tests: Multi-Tenant Workflow Execution
 *
 * Tests workflow execution in multi-tenant environments:
 * - Workflow instance isolation per tenant
 * - Workflow state persistence per tenant
 * - Cross-tenant workflow data isolation
 * - Concurrent workflow execution across tenants
 * - Workflow pause/resume isolation
 *
 * Run with: npx vitest run tests/e2e/multi-tenant/workflow-execution.test.ts --project=integration
 *
 * @module tests/e2e/multi-tenant/workflow-execution
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare, DurableObjectStub } from 'miniflare'

/**
 * Miniflare config with workflow execution support.
 * Each tenant has isolated workflow definitions, instances, and executions.
 */
const getMiniflareConfig = () => ({
  modules: true,
  script: `
    /**
     * WorkflowTenantDO - Multi-tenant workflow execution engine
     *
     * Features:
     * - Per-tenant workflow definitions
     * - Isolated workflow instances
     * - Step execution tracking
     * - Pause/resume per tenant
     */
    export class WorkflowTenantDO {
      constructor(state, env) {
        this.state = state
        this.storage = state.storage
        this.sql = state.storage.sql
        this.initialized = false
        this.initPromise = this.initSchema()
      }

      async initSchema() {
        if (this.initialized) return

        this.sql.exec(\`
          CREATE TABLE IF NOT EXISTS workflow_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            steps TEXT NOT NULL,
            trigger_type TEXT DEFAULT 'manual',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS workflow_instances (
            id TEXT PRIMARY KEY,
            definition_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            input TEXT,
            output TEXT,
            current_step INTEGER DEFAULT 0,
            error TEXT,
            started_at INTEGER,
            completed_at INTEGER,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (definition_id) REFERENCES workflow_definitions(id)
          );

          CREATE INDEX IF NOT EXISTS idx_instances_status ON workflow_instances(status);
          CREATE INDEX IF NOT EXISTS idx_instances_definition ON workflow_instances(definition_id);

          CREATE TABLE IF NOT EXISTS step_executions (
            id TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            step_index INTEGER NOT NULL,
            step_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            input TEXT,
            output TEXT,
            error TEXT,
            started_at INTEGER,
            completed_at INTEGER,
            FOREIGN KEY (instance_id) REFERENCES workflow_instances(id)
          );

          CREATE INDEX IF NOT EXISTS idx_steps_instance ON step_executions(instance_id);
          CREATE INDEX IF NOT EXISTS idx_steps_status ON step_executions(status);

          CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            data TEXT,
            instance_id TEXT,
            created_at INTEGER NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
          CREATE INDEX IF NOT EXISTS idx_events_instance ON events(instance_id);
        \`)

        this.initialized = true
      }

      // ==========================================
      // Workflow Definition Management
      // ==========================================

      async createWorkflowDefinition(data) {
        await this.initPromise

        const id = data.id || crypto.randomUUID()
        const now = Date.now()

        // Check for duplicate name
        const existing = this.sql.exec('SELECT id FROM workflow_definitions WHERE name = ?', data.name).toArray()
        if (existing.length > 0) {
          throw new Error('Workflow name already exists')
        }

        const definition = {
          id,
          name: data.name,
          description: data.description || '',
          steps: data.steps,
          trigger_type: data.trigger_type || 'manual',
          created_at: now,
          updated_at: now,
        }

        this.sql.exec(
          'INSERT INTO workflow_definitions (id, name, description, steps, trigger_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          definition.id,
          definition.name,
          definition.description,
          JSON.stringify(definition.steps),
          definition.trigger_type,
          definition.created_at,
          definition.updated_at
        )

        return definition
      }

      async getWorkflowDefinition(nameOrId) {
        await this.initPromise

        // Try by ID first, then by name
        let rows = this.sql.exec('SELECT * FROM workflow_definitions WHERE id = ?', nameOrId).toArray()
        if (rows.length === 0) {
          rows = this.sql.exec('SELECT * FROM workflow_definitions WHERE name = ?', nameOrId).toArray()
        }

        if (rows.length === 0) return null

        const row = rows[0]
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          steps: JSON.parse(row.steps),
          trigger_type: row.trigger_type,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }
      }

      async listWorkflowDefinitions() {
        await this.initPromise
        const rows = this.sql.exec('SELECT * FROM workflow_definitions ORDER BY name').toArray()
        return rows.map(row => ({
          id: row.id,
          name: row.name,
          description: row.description,
          steps: JSON.parse(row.steps),
          trigger_type: row.trigger_type,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }))
      }

      // ==========================================
      // Workflow Instance Management
      // ==========================================

      async startWorkflow(definitionNameOrId, input = {}) {
        await this.initPromise

        const definition = await this.getWorkflowDefinition(definitionNameOrId)
        if (!definition) {
          throw new Error('Workflow definition not found')
        }

        const id = crypto.randomUUID()
        const now = Date.now()

        const instance = {
          id,
          definition_id: definition.id,
          status: 'running',
          input,
          output: null,
          current_step: 0,
          error: null,
          started_at: now,
          completed_at: null,
          created_at: now,
        }

        this.sql.exec(
          'INSERT INTO workflow_instances (id, definition_id, status, input, current_step, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          instance.id,
          instance.definition_id,
          instance.status,
          JSON.stringify(instance.input),
          instance.current_step,
          instance.started_at,
          instance.created_at
        )

        // Execute steps (simplified - in real impl would be async/durable)
        await this.executeSteps(instance.id, definition.steps, input)

        return this.getWorkflowInstance(id)
      }

      async executeSteps(instanceId, steps, input) {
        let stepInput = input
        let stepIndex = 0

        for (const step of steps) {
          const stepExecId = crypto.randomUUID()
          const now = Date.now()

          // Create step execution record
          this.sql.exec(
            'INSERT INTO step_executions (id, instance_id, step_index, step_name, status, input, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            stepExecId,
            instanceId,
            stepIndex,
            step.name,
            'running',
            JSON.stringify(stepInput)
          )

          try {
            // Simulate step execution based on type
            let output
            switch (step.type) {
              case 'transform':
                output = { ...stepInput, transformed: true, step: step.name }
                break
              case 'validate':
                const isValid = stepInput && Object.keys(stepInput).length > 0
                if (!isValid && step.config?.required) {
                  throw new Error('Validation failed: input required')
                }
                output = { ...stepInput, validated: true }
                break
              case 'notify':
                output = { ...stepInput, notified: true, channel: step.config?.channel }
                break
              case 'wait':
                // In real impl, this would pause and wait for event
                output = { ...stepInput, waited: true }
                break
              default:
                output = { ...stepInput, processed: true, step: step.name }
            }

            // Update step execution as completed
            this.sql.exec(
              'UPDATE step_executions SET status = ?, output = ?, completed_at = ? WHERE id = ?',
              'completed',
              JSON.stringify(output),
              Date.now(),
              stepExecId
            )

            // Update instance current step
            this.sql.exec(
              'UPDATE workflow_instances SET current_step = ? WHERE id = ?',
              stepIndex + 1,
              instanceId
            )

            stepInput = output
            stepIndex++
          } catch (error) {
            // Mark step as failed
            this.sql.exec(
              'UPDATE step_executions SET status = ?, error = ?, completed_at = ? WHERE id = ?',
              'failed',
              error.message,
              Date.now(),
              stepExecId
            )

            // Mark instance as failed
            this.sql.exec(
              'UPDATE workflow_instances SET status = ?, error = ?, completed_at = ? WHERE id = ?',
              'failed',
              error.message,
              Date.now(),
              instanceId
            )

            return
          }
        }

        // All steps completed
        this.sql.exec(
          'UPDATE workflow_instances SET status = ?, output = ?, completed_at = ? WHERE id = ?',
          'completed',
          JSON.stringify(stepInput),
          Date.now(),
          instanceId
        )
      }

      async getWorkflowInstance(id) {
        await this.initPromise

        const rows = this.sql.exec('SELECT * FROM workflow_instances WHERE id = ?', id).toArray()
        if (rows.length === 0) return null

        const row = rows[0]
        return {
          id: row.id,
          definition_id: row.definition_id,
          status: row.status,
          input: row.input ? JSON.parse(row.input) : null,
          output: row.output ? JSON.parse(row.output) : null,
          current_step: row.current_step,
          error: row.error,
          started_at: row.started_at,
          completed_at: row.completed_at,
          created_at: row.created_at,
        }
      }

      async listWorkflowInstances(options = {}) {
        await this.initPromise

        let sql = 'SELECT * FROM workflow_instances'
        const params = []

        if (options.status) {
          sql += ' WHERE status = ?'
          params.push(options.status)
        }

        if (options.definition_id) {
          sql += params.length > 0 ? ' AND' : ' WHERE'
          sql += ' definition_id = ?'
          params.push(options.definition_id)
        }

        sql += ' ORDER BY created_at DESC'

        const rows = this.sql.exec(sql, ...params).toArray()
        return rows.map(row => ({
          id: row.id,
          definition_id: row.definition_id,
          status: row.status,
          input: row.input ? JSON.parse(row.input) : null,
          output: row.output ? JSON.parse(row.output) : null,
          current_step: row.current_step,
          error: row.error,
          started_at: row.started_at,
          completed_at: row.completed_at,
          created_at: row.created_at,
        }))
      }

      async getStepExecutions(instanceId) {
        await this.initPromise

        const rows = this.sql.exec(
          'SELECT * FROM step_executions WHERE instance_id = ? ORDER BY step_index',
          instanceId
        ).toArray()

        return rows.map(row => ({
          id: row.id,
          instance_id: row.instance_id,
          step_index: row.step_index,
          step_name: row.step_name,
          status: row.status,
          input: row.input ? JSON.parse(row.input) : null,
          output: row.output ? JSON.parse(row.output) : null,
          error: row.error,
          started_at: row.started_at,
          completed_at: row.completed_at,
        }))
      }

      async pauseWorkflow(instanceId) {
        await this.initPromise

        const instance = await this.getWorkflowInstance(instanceId)
        if (!instance) {
          throw new Error('Instance not found')
        }

        if (instance.status !== 'running') {
          throw new Error('Can only pause running workflows')
        }

        this.sql.exec(
          'UPDATE workflow_instances SET status = ? WHERE id = ?',
          'paused',
          instanceId
        )

        return this.getWorkflowInstance(instanceId)
      }

      async resumeWorkflow(instanceId) {
        await this.initPromise

        const instance = await this.getWorkflowInstance(instanceId)
        if (!instance) {
          throw new Error('Instance not found')
        }

        if (instance.status !== 'paused') {
          throw new Error('Can only resume paused workflows')
        }

        this.sql.exec(
          'UPDATE workflow_instances SET status = ? WHERE id = ?',
          'running',
          instanceId
        )

        return this.getWorkflowInstance(instanceId)
      }

      async cancelWorkflow(instanceId) {
        await this.initPromise

        const instance = await this.getWorkflowInstance(instanceId)
        if (!instance) {
          throw new Error('Instance not found')
        }

        if (['completed', 'failed', 'cancelled'].includes(instance.status)) {
          throw new Error('Cannot cancel terminal workflow')
        }

        this.sql.exec(
          'UPDATE workflow_instances SET status = ?, completed_at = ? WHERE id = ?',
          'cancelled',
          Date.now(),
          instanceId
        )

        return this.getWorkflowInstance(instanceId)
      }

      // ==========================================
      // Event Management
      // ==========================================

      async emitEvent(type, data, instanceId = null) {
        await this.initPromise

        const id = crypto.randomUUID()
        const now = Date.now()

        this.sql.exec(
          'INSERT INTO events (id, type, data, instance_id, created_at) VALUES (?, ?, ?, ?, ?)',
          id,
          type,
          JSON.stringify(data),
          instanceId,
          now
        )

        return { id, type, data, instance_id: instanceId, created_at: now }
      }

      async getEvents(options = {}) {
        await this.initPromise

        let sql = 'SELECT * FROM events'
        const params = []

        if (options.type) {
          sql += ' WHERE type = ?'
          params.push(options.type)
        }

        if (options.instance_id) {
          sql += params.length > 0 ? ' AND' : ' WHERE'
          sql += ' instance_id = ?'
          params.push(options.instance_id)
        }

        sql += ' ORDER BY created_at DESC'

        const rows = this.sql.exec(sql, ...params).toArray()
        return rows.map(row => ({
          id: row.id,
          type: row.type,
          data: row.data ? JSON.parse(row.data) : null,
          instance_id: row.instance_id,
          created_at: row.created_at,
        }))
      }

      async getStats() {
        await this.initPromise

        const definitions = this.sql.exec('SELECT COUNT(*) as count FROM workflow_definitions').toArray()[0].count
        const instances = this.sql.exec('SELECT COUNT(*) as count FROM workflow_instances').toArray()[0].count
        const running = this.sql.exec("SELECT COUNT(*) as count FROM workflow_instances WHERE status = 'running'").toArray()[0].count
        const completed = this.sql.exec("SELECT COUNT(*) as count FROM workflow_instances WHERE status = 'completed'").toArray()[0].count
        const failed = this.sql.exec("SELECT COUNT(*) as count FROM workflow_instances WHERE status = 'failed'").toArray()[0].count

        return { definitions, instances, running, completed, failed }
      }

      // ==========================================
      // REST Interface
      // ==========================================

      async fetch(request) {
        await this.initPromise

        const url = new URL(request.url)
        const path = url.pathname
        const method = request.method

        let body = null
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
          try {
            body = await request.json()
          } catch (e) {}
        }

        try {
          // Workflow definitions
          if (path === '/workflows' && method === 'POST') {
            const workflow = await this.createWorkflowDefinition(body)
            return new Response(JSON.stringify(workflow), {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path === '/workflows' && method === 'GET') {
            const workflows = await this.listWorkflowDefinitions()
            return new Response(JSON.stringify({ items: workflows }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/workflows\\/[^/]+$/) && method === 'GET') {
            const name = decodeURIComponent(path.split('/')[2])
            const workflow = await this.getWorkflowDefinition(name)
            if (!workflow) {
              return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              })
            }
            return new Response(JSON.stringify(workflow), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          // Workflow instances
          if (path.match(/^\\/workflows\\/[^/]+\\/start$/) && method === 'POST') {
            const name = decodeURIComponent(path.split('/')[2])
            const instance = await this.startWorkflow(name, body?.input || {})
            return new Response(JSON.stringify(instance), {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path === '/instances' && method === 'GET') {
            const options = {
              status: url.searchParams.get('status'),
              definition_id: url.searchParams.get('definition_id'),
            }
            const instances = await this.listWorkflowInstances(options)
            return new Response(JSON.stringify({ items: instances }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/instances\\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[2]
            const instance = await this.getWorkflowInstance(id)
            if (!instance) {
              return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              })
            }
            return new Response(JSON.stringify(instance), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/instances\\/[^/]+\\/steps$/) && method === 'GET') {
            const id = path.split('/')[2]
            const steps = await this.getStepExecutions(id)
            return new Response(JSON.stringify({ items: steps }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/instances\\/[^/]+\\/pause$/) && method === 'POST') {
            const id = path.split('/')[2]
            const instance = await this.pauseWorkflow(id)
            return new Response(JSON.stringify(instance), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/instances\\/[^/]+\\/resume$/) && method === 'POST') {
            const id = path.split('/')[2]
            const instance = await this.resumeWorkflow(id)
            return new Response(JSON.stringify(instance), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/instances\\/[^/]+\\/cancel$/) && method === 'POST') {
            const id = path.split('/')[2]
            const instance = await this.cancelWorkflow(id)
            return new Response(JSON.stringify(instance), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          // Events
          if (path === '/events' && method === 'POST') {
            const event = await this.emitEvent(body.type, body.data, body.instance_id)
            return new Response(JSON.stringify(event), {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path === '/events' && method === 'GET') {
            const options = {
              type: url.searchParams.get('type'),
              instance_id: url.searchParams.get('instance_id'),
            }
            const events = await this.getEvents(options)
            return new Response(JSON.stringify({ items: events }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          // Stats
          if (path === '/stats' && method === 'GET') {
            const stats = await this.getStats()
            return new Response(JSON.stringify(stats), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          })
        } catch (error) {
          const status = error.message.includes('not found') ? 404 :
                        error.message.includes('already exists') ? 409 : 400
          return new Response(JSON.stringify({ error: error.message }), {
            status,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      }
    }

    export default {
      async fetch(request, env) {
        const url = new URL(request.url)
        const parts = url.hostname.split('.')

        let tenant = 'default'
        if (parts.length >= 4) {
          tenant = parts[0]
        } else if (url.pathname.startsWith('/tenant/')) {
          const pathParts = url.pathname.split('/')
          tenant = pathParts[2]
        }

        const doId = env.TENANT_DO.idFromName(tenant)
        const stub = env.TENANT_DO.get(doId)
        return stub.fetch(request)
      }
    }
  `,
  durableObjects: {
    TENANT_DO: 'WorkflowTenantDO',
  },
})

// ============================================================================
// Test Suites
// ============================================================================

describe('Multi-Tenant Workflow - Definition Isolation', () => {
  let mf: Miniflare
  let tenantAStub: DurableObjectStub
  let tenantBStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    tenantAStub = ns.get(ns.idFromName('workflow-tenant-a'))
    tenantBStub = ns.get(ns.idFromName('workflow-tenant-b'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('each tenant can have workflows with same name', async () => {
    const workflowName = 'order-processing'

    // Create workflow in tenant A
    const createARes = await tenantAStub.fetch('http://fake/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: workflowName,
        description: 'Tenant A order processing',
        steps: [
          { name: 'validate', type: 'validate' },
          { name: 'process', type: 'transform' },
        ],
      }),
    })
    expect(createARes.status).toBe(201)

    // Create workflow with same name in tenant B
    const createBRes = await tenantBStub.fetch('http://fake/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: workflowName,
        description: 'Tenant B order processing',
        steps: [
          { name: 'validate', type: 'validate' },
          { name: 'enrich', type: 'transform' },
          { name: 'process', type: 'transform' },
        ],
      }),
    })
    expect(createBRes.status).toBe(201)

    // Verify tenant A has 2-step workflow
    const getARes = await tenantAStub.fetch(`http://fake/workflows/${workflowName}`)
    const workflowA = (await getARes.json()) as {
      steps: { name: string }[]
      description: string
    }
    expect(workflowA.steps).toHaveLength(2)
    expect(workflowA.description).toBe('Tenant A order processing')

    // Verify tenant B has 3-step workflow
    const getBRes = await tenantBStub.fetch(`http://fake/workflows/${workflowName}`)
    const workflowB = (await getBRes.json()) as {
      steps: { name: string }[]
      description: string
    }
    expect(workflowB.steps).toHaveLength(3)
    expect(workflowB.description).toBe('Tenant B order processing')
  })

  it('workflow definitions are not visible across tenants', async () => {
    const uniqueName = `unique-workflow-${Date.now()}`

    // Create workflow only in tenant A
    await tenantAStub.fetch('http://fake/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: uniqueName,
        steps: [{ name: 'step1', type: 'transform' }],
      }),
    })

    // Should not be found in tenant B
    const getBRes = await tenantBStub.fetch(`http://fake/workflows/${uniqueName}`)
    expect(getBRes.status).toBe(404)
  })

  it('workflow list returns only tenant-specific definitions', async () => {
    const prefix = `list-workflow-${Date.now()}`

    // Create workflows in tenant A
    for (let i = 0; i < 3; i++) {
      await tenantAStub.fetch('http://fake/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: `${prefix}-a-${i}`,
          steps: [{ name: 'step', type: 'transform' }],
        }),
      })
    }

    // Create workflows in tenant B
    for (let i = 0; i < 5; i++) {
      await tenantBStub.fetch('http://fake/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: `${prefix}-b-${i}`,
          steps: [{ name: 'step', type: 'transform' }],
        }),
      })
    }

    // List tenant A workflows
    const listA = await tenantAStub.fetch('http://fake/workflows')
    const workflowsA = (await listA.json()) as { items: { name: string }[] }
    const ourWorkflowsA = workflowsA.items.filter((w) => w.name.startsWith(prefix))

    // All should be from tenant A
    for (const wf of ourWorkflowsA) {
      expect(wf.name).toContain('-a-')
    }

    // List tenant B workflows
    const listB = await tenantBStub.fetch('http://fake/workflows')
    const workflowsB = (await listB.json()) as { items: { name: string }[] }
    const ourWorkflowsB = workflowsB.items.filter((w) => w.name.startsWith(prefix))

    // All should be from tenant B
    for (const wf of ourWorkflowsB) {
      expect(wf.name).toContain('-b-')
    }
  })
})

describe('Multi-Tenant Workflow - Instance Isolation', () => {
  let mf: Miniflare
  let tenantAStub: DurableObjectStub
  let tenantBStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    tenantAStub = ns.get(ns.idFromName('instance-tenant-a'))
    tenantBStub = ns.get(ns.idFromName('instance-tenant-b'))

    // Create workflow definitions in both tenants
    await tenantAStub.fetch('http://fake/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'data-pipeline',
        steps: [
          { name: 'extract', type: 'transform' },
          { name: 'transform', type: 'transform' },
          { name: 'load', type: 'transform' },
        ],
      }),
    })

    await tenantBStub.fetch('http://fake/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'data-pipeline',
        steps: [
          { name: 'ingest', type: 'transform' },
          { name: 'process', type: 'transform' },
        ],
      }),
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('workflow instances are isolated per tenant', async () => {
    // Start workflow in tenant A
    const startARes = await tenantAStub.fetch('http://fake/workflows/data-pipeline/start', {
      method: 'POST',
      body: JSON.stringify({ input: { source: 'tenant-a-source' } }),
    })
    expect(startARes.status).toBe(201)
    const instanceA = (await startARes.json()) as { id: string }

    // Start workflow in tenant B
    const startBRes = await tenantBStub.fetch('http://fake/workflows/data-pipeline/start', {
      method: 'POST',
      body: JSON.stringify({ input: { source: 'tenant-b-source' } }),
    })
    expect(startBRes.status).toBe(201)
    const instanceB = (await startBRes.json()) as { id: string }

    // Tenant A cannot access tenant B's instance
    const getBInA = await tenantAStub.fetch(`http://fake/instances/${instanceB.id}`)
    expect(getBInA.status).toBe(404)

    // Tenant B cannot access tenant A's instance
    const getAInB = await tenantBStub.fetch(`http://fake/instances/${instanceA.id}`)
    expect(getAInB.status).toBe(404)
  })

  it('instance listing returns only tenant-specific instances', async () => {
    // Start multiple instances in both tenants
    for (let i = 0; i < 3; i++) {
      await tenantAStub.fetch('http://fake/workflows/data-pipeline/start', {
        method: 'POST',
        body: JSON.stringify({ input: { batch: i, tenant: 'a' } }),
      })
    }

    for (let i = 0; i < 5; i++) {
      await tenantBStub.fetch('http://fake/workflows/data-pipeline/start', {
        method: 'POST',
        body: JSON.stringify({ input: { batch: i, tenant: 'b' } }),
      })
    }

    // List tenant A instances
    const listA = await tenantAStub.fetch('http://fake/instances')
    const instancesA = (await listA.json()) as { items: { input: { tenant: string } }[] }

    // All instances should have tenant: 'a'
    for (const inst of instancesA.items) {
      expect(inst.input.tenant).toBe('a')
    }

    // List tenant B instances
    const listB = await tenantBStub.fetch('http://fake/instances')
    const instancesB = (await listB.json()) as { items: { input: { tenant: string } }[] }

    // All instances should have tenant: 'b'
    for (const inst of instancesB.items) {
      expect(inst.input.tenant).toBe('b')
    }
  })

  it('step executions are isolated per tenant', async () => {
    // Start workflow in tenant A
    const startARes = await tenantAStub.fetch('http://fake/workflows/data-pipeline/start', {
      method: 'POST',
      body: JSON.stringify({ input: { data: 'test' } }),
    })
    const instanceA = (await startARes.json()) as { id: string }

    // Get steps from tenant A
    const stepsARes = await tenantAStub.fetch(`http://fake/instances/${instanceA.id}/steps`)
    expect(stepsARes.status).toBe(200)
    const stepsA = (await stepsARes.json()) as { items: { step_name: string }[] }
    expect(stepsA.items.length).toBeGreaterThan(0)

    // Tenant B cannot access tenant A's step executions
    const stepsBRes = await tenantBStub.fetch(`http://fake/instances/${instanceA.id}/steps`)
    // Returns empty since instance doesn't exist in B
    const stepsB = (await stepsBRes.json()) as { items: unknown[] }
    expect(stepsB.items).toHaveLength(0)
  })
})

describe('Multi-Tenant Workflow - Control Operations Isolation', () => {
  let mf: Miniflare
  let tenantAStub: DurableObjectStub
  let tenantBStub: DurableObjectStub
  let instanceAId: string

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    tenantAStub = ns.get(ns.idFromName('control-tenant-a'))
    tenantBStub = ns.get(ns.idFromName('control-tenant-b'))

    // Create workflow
    await tenantAStub.fetch('http://fake/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'long-process',
        steps: [
          { name: 'start', type: 'transform' },
          { name: 'middle', type: 'transform' },
          { name: 'end', type: 'transform' },
        ],
      }),
    })

    // Start instance
    const startRes = await tenantAStub.fetch('http://fake/workflows/long-process/start', {
      method: 'POST',
      body: JSON.stringify({ input: {} }),
    })
    const instance = (await startRes.json()) as { id: string }
    instanceAId = instance.id
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('tenant B cannot pause tenant A workflow instance', async () => {
    const pauseRes = await tenantBStub.fetch(`http://fake/instances/${instanceAId}/pause`, {
      method: 'POST',
    })
    expect(pauseRes.status).toBe(404)
  })

  it('tenant B cannot resume tenant A workflow instance', async () => {
    const resumeRes = await tenantBStub.fetch(`http://fake/instances/${instanceAId}/resume`, {
      method: 'POST',
    })
    expect(resumeRes.status).toBe(404)
  })

  it('tenant B cannot cancel tenant A workflow instance', async () => {
    const cancelRes = await tenantBStub.fetch(`http://fake/instances/${instanceAId}/cancel`, {
      method: 'POST',
    })
    expect(cancelRes.status).toBe(404)
  })
})

describe('Multi-Tenant Workflow - Event Isolation', () => {
  let mf: Miniflare
  let tenantAStub: DurableObjectStub
  let tenantBStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    tenantAStub = ns.get(ns.idFromName('event-tenant-a'))
    tenantBStub = ns.get(ns.idFromName('event-tenant-b'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('events are isolated per tenant', async () => {
    // Emit events in tenant A
    await tenantAStub.fetch('http://fake/events', {
      method: 'POST',
      body: JSON.stringify({ type: 'order.created', data: { orderId: 'a-001' } }),
    })
    await tenantAStub.fetch('http://fake/events', {
      method: 'POST',
      body: JSON.stringify({ type: 'order.created', data: { orderId: 'a-002' } }),
    })

    // Emit events in tenant B
    await tenantBStub.fetch('http://fake/events', {
      method: 'POST',
      body: JSON.stringify({ type: 'order.created', data: { orderId: 'b-001' } }),
    })

    // List tenant A events
    const eventsARes = await tenantAStub.fetch('http://fake/events?type=order.created')
    const eventsA = (await eventsARes.json()) as { items: { data: { orderId: string } }[] }

    // All should be tenant A events
    for (const event of eventsA.items) {
      expect(event.data.orderId).toMatch(/^a-/)
    }
    expect(eventsA.items.length).toBe(2)

    // List tenant B events
    const eventsBRes = await tenantBStub.fetch('http://fake/events?type=order.created')
    const eventsB = (await eventsBRes.json()) as { items: { data: { orderId: string } }[] }

    // All should be tenant B events
    for (const event of eventsB.items) {
      expect(event.data.orderId).toMatch(/^b-/)
    }
    expect(eventsB.items.length).toBe(1)
  })
})

describe('Multi-Tenant Workflow - Concurrent Execution', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('multiple tenants can execute workflows concurrently', async () => {
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    const tenantCount = 5

    // Create tenant stubs
    const tenants = Array.from({ length: tenantCount }, (_, i) =>
      ns.get(ns.idFromName(`concurrent-tenant-${i}`))
    )

    // Create workflows in all tenants
    const setupPromises = tenants.map((stub, i) =>
      stub.fetch('http://fake/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: 'concurrent-workflow',
          steps: [
            { name: 'step1', type: 'transform' },
            { name: 'step2', type: 'transform' },
          ],
        }),
      })
    )
    await Promise.all(setupPromises)

    // Start workflows concurrently across all tenants
    const startPromises = tenants.map((stub, tenantIndex) =>
      stub.fetch('http://fake/workflows/concurrent-workflow/start', {
        method: 'POST',
        body: JSON.stringify({ input: { tenant: tenantIndex } }),
      })
    )

    const responses = await Promise.all(startPromises)

    // All should succeed
    for (const res of responses) {
      expect(res.status).toBe(201)
    }

    // Verify each tenant has exactly their instances
    for (let i = 0; i < tenantCount; i++) {
      const listRes = await tenants[i].fetch('http://fake/instances')
      const instances = (await listRes.json()) as {
        items: { input: { tenant: number } }[]
      }

      // All instances should belong to this tenant
      for (const inst of instances.items) {
        expect(inst.input.tenant).toBe(i)
      }
    }
  })

  it('high concurrent workflow starts across tenants', async () => {
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    const tenantCount = 3
    const workflowsPerTenant = 10

    // Create tenant stubs
    const tenants = Array.from({ length: tenantCount }, (_, i) =>
      ns.get(ns.idFromName(`stress-tenant-${i}`))
    )

    // Setup workflows
    await Promise.all(
      tenants.map((stub) =>
        stub.fetch('http://fake/workflows', {
          method: 'POST',
          body: JSON.stringify({
            name: 'stress-workflow',
            steps: [{ name: 'process', type: 'transform' }],
          }),
        })
      )
    )

    // Start many workflows concurrently
    const allStarts = tenants.flatMap((stub, tenantIndex) =>
      Array.from({ length: workflowsPerTenant }, (_, wfIndex) =>
        stub.fetch('http://fake/workflows/stress-workflow/start', {
          method: 'POST',
          body: JSON.stringify({
            input: { tenant: tenantIndex, workflow: wfIndex },
          }),
        })
      )
    )

    const responses = await Promise.all(allStarts)

    // All should succeed
    const successCount = responses.filter((r) => r.status === 201).length
    expect(successCount).toBe(tenantCount * workflowsPerTenant)
  })
})

describe('Multi-Tenant Workflow - Stats Isolation', () => {
  let mf: Miniflare
  let tenantAStub: DurableObjectStub
  let tenantBStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    tenantAStub = ns.get(ns.idFromName('stats-wf-tenant-a'))
    tenantBStub = ns.get(ns.idFromName('stats-wf-tenant-b'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('stats reflect only tenant-specific workflow data', async () => {
    // Create workflows in tenant A
    await tenantAStub.fetch('http://fake/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'stats-workflow-1',
        steps: [{ name: 'step', type: 'transform' }],
      }),
    })
    await tenantAStub.fetch('http://fake/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'stats-workflow-2',
        steps: [{ name: 'step', type: 'transform' }],
      }),
    })

    // Start instances in tenant A
    for (let i = 0; i < 5; i++) {
      await tenantAStub.fetch('http://fake/workflows/stats-workflow-1/start', {
        method: 'POST',
        body: JSON.stringify({ input: {} }),
      })
    }

    // Create one workflow in tenant B
    await tenantBStub.fetch('http://fake/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'stats-workflow-b',
        steps: [{ name: 'step', type: 'transform' }],
      }),
    })

    // Start 2 instances in tenant B
    for (let i = 0; i < 2; i++) {
      await tenantBStub.fetch('http://fake/workflows/stats-workflow-b/start', {
        method: 'POST',
        body: JSON.stringify({ input: {} }),
      })
    }

    // Check tenant A stats
    const statsARes = await tenantAStub.fetch('http://fake/stats')
    const statsA = (await statsARes.json()) as {
      definitions: number
      instances: number
    }
    expect(statsA.definitions).toBe(2)
    expect(statsA.instances).toBe(5)

    // Check tenant B stats
    const statsBRes = await tenantBStub.fetch('http://fake/stats')
    const statsB = (await statsBRes.json()) as {
      definitions: number
      instances: number
    }
    expect(statsB.definitions).toBe(1)
    expect(statsB.instances).toBe(2)
  })
})
