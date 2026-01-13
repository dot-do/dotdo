/**
 * StepDO - Durable Object for Step Execution with State
 *
 * Handles:
 * - Step memoization (caching results for replay)
 * - Durable sleep via DO alarms
 * - Step retries with exponential backoff
 * - Step state persistence
 */

import {
  type StepState,
  parseDuration,
  generateStepId,
  ensureError,
} from './types'

/**
 * SQL schema for step state storage
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS steps (
    step_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    error TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    sleep_until INTEGER,
    attempts INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_steps_run_id ON steps(run_id);
  CREATE INDEX IF NOT EXISTS idx_steps_status ON steps(status);
  CREATE INDEX IF NOT EXISTS idx_steps_sleep_until ON steps(sleep_until) WHERE sleep_until IS NOT NULL;
`

/**
 * StepDO - Manages step execution state
 */
export class StepDO implements DurableObject {
  private state: DurableObjectState
  private initialized = false

  constructor(state: DurableObjectState) {
    this.state = state
  }

  /**
   * Initialize the database schema
   */
  private async init(): Promise<void> {
    if (this.initialized) return

    await this.state.storage.sql.exec(SCHEMA)
    this.initialized = true
  }

  /**
   * Handle incoming requests
   */
  async fetch(request: Request): Promise<Response> {
    await this.init()

    const url = new URL(request.url)
    const method = request.method

    try {
      // GET /step/:runId/:stepId - Get step state
      if (method === 'GET' && url.pathname.startsWith('/step/')) {
        const [, , runId, stepId] = url.pathname.split('/')
        const step = await this.getStep(runId, stepId)
        return Response.json(step)
      }

      // POST /step/run - Execute a step
      if (method === 'POST' && url.pathname === '/step/run') {
        const body = await request.json() as {
          runId: string
          stepId: string
          fn: string // Serialized function (not actually executed here)
        }
        const result = await this.runStep(body.runId, body.stepId)
        return Response.json(result)
      }

      // POST /step/complete - Mark step as complete
      if (method === 'POST' && url.pathname === '/step/complete') {
        const body = await request.json() as {
          runId: string
          stepId: string
          result: unknown
        }
        await this.completeStep(body.runId, body.stepId, body.result)
        return Response.json({ success: true })
      }

      // POST /step/fail - Mark step as failed
      if (method === 'POST' && url.pathname === '/step/fail') {
        const body = await request.json() as {
          runId: string
          stepId: string
          error: string
        }
        await this.failStep(body.runId, body.stepId, body.error)
        return Response.json({ success: true })
      }

      // POST /step/sleep - Schedule a sleep
      if (method === 'POST' && url.pathname === '/step/sleep') {
        const body = await request.json() as {
          runId: string
          stepId: string
          duration: string | number
        }
        await this.sleepStep(body.runId, body.stepId, body.duration)
        return Response.json({ success: true })
      }

      // POST /step/sleep-until - Sleep until timestamp
      if (method === 'POST' && url.pathname === '/step/sleep-until') {
        const body = await request.json() as {
          runId: string
          stepId: string
          timestamp: number
        }
        await this.sleepUntilStep(body.runId, body.stepId, body.timestamp)
        return Response.json({ success: true })
      }

      // GET /steps/:runId - Get all steps for a run
      if (method === 'GET' && url.pathname.startsWith('/steps/')) {
        const runId = url.pathname.split('/')[2]
        const steps = await this.getStepsForRun(runId)
        return Response.json(steps)
      }

      // DELETE /steps/:runId - Delete all steps for a run
      if (method === 'DELETE' && url.pathname.startsWith('/steps/')) {
        const runId = url.pathname.split('/')[2]
        await this.deleteStepsForRun(runId)
        return Response.json({ success: true })
      }

      // GET /sleeping - Get all sleeping steps
      if (method === 'GET' && url.pathname === '/sleeping') {
        const steps = await this.getSleepingSteps()
        return Response.json(steps)
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      const err = ensureError(error)
      return Response.json({ error: err.message }, { status: 500 })
    }
  }

  /**
   * Handle DO alarm for sleep completion
   */
  async alarm(): Promise<void> {
    await this.init()

    const now = Date.now()

    // Find all steps that should wake up
    const sleepingSteps = this.state.storage.sql.exec<{
      step_id: string
      run_id: string
      sleep_until: number
    }>(
      `SELECT step_id, run_id, sleep_until FROM steps
       WHERE status = 'sleeping' AND sleep_until <= ?`,
      now
    ).toArray()

    // Wake up each step
    for (const step of sleepingSteps) {
      await this.wakeStep(step.run_id, step.step_id)
    }

    // Schedule next alarm if there are more sleeping steps
    await this.scheduleNextAlarm()
  }

  /**
   * Get step state
   */
  private async getStep(runId: string, stepId: string): Promise<StepState | null> {
    const row = this.state.storage.sql.exec<{
      step_id: string
      run_id: string
      status: string
      result: string | null
      error: string | null
      started_at: number | null
      completed_at: number | null
      sleep_until: number | null
      attempts: number
    }>(
      `SELECT * FROM steps WHERE run_id = ? AND step_id = ?`,
      runId, stepId
    ).one()

    if (!row) return null

    return {
      stepId: row.step_id,
      runId: row.run_id,
      status: row.status as StepState['status'],
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      sleepUntil: row.sleep_until ?? undefined,
      attempts: row.attempts,
    }
  }

  /**
   * Start or get memoized step result
   */
  private async runStep(runId: string, stepId: string): Promise<{
    status: 'new' | 'completed' | 'failed' | 'sleeping'
    result?: unknown
    error?: string
    sleepUntil?: number
  }> {
    const existing = await this.getStep(runId, stepId)

    if (existing) {
      switch (existing.status) {
        case 'completed':
          return { status: 'completed', result: existing.result }
        case 'failed':
          return { status: 'failed', error: existing.error }
        case 'sleeping':
          return { status: 'sleeping', sleepUntil: existing.sleepUntil }
      }
    }

    // Create new step
    this.state.storage.sql.exec(
      `INSERT INTO steps (step_id, run_id, status, started_at, attempts)
       VALUES (?, ?, 'running', ?, 1)
       ON CONFLICT(step_id) DO UPDATE SET
         status = 'running',
         started_at = excluded.started_at,
         attempts = attempts + 1`,
      stepId, runId, Date.now()
    )

    return { status: 'new' }
  }

  /**
   * Mark step as completed
   */
  private async completeStep(runId: string, stepId: string, result: unknown): Promise<void> {
    this.state.storage.sql.exec(
      `UPDATE steps SET
         status = 'completed',
         result = ?,
         completed_at = ?
       WHERE run_id = ? AND step_id = ?`,
      JSON.stringify(result),
      Date.now(),
      runId,
      stepId
    )
  }

  /**
   * Mark step as failed
   */
  private async failStep(runId: string, stepId: string, error: string): Promise<void> {
    this.state.storage.sql.exec(
      `UPDATE steps SET
         status = 'failed',
         error = ?,
         completed_at = ?
       WHERE run_id = ? AND step_id = ?`,
      error,
      Date.now(),
      runId,
      stepId
    )
  }

  /**
   * Schedule step to sleep for duration
   */
  private async sleepStep(runId: string, stepId: string, duration: string | number): Promise<void> {
    const ms = parseDuration(duration)
    const sleepUntil = Date.now() + ms

    await this.sleepUntilStep(runId, stepId, sleepUntil)
  }

  /**
   * Schedule step to sleep until timestamp
   */
  private async sleepUntilStep(runId: string, stepId: string, timestamp: number): Promise<void> {
    this.state.storage.sql.exec(
      `INSERT INTO steps (step_id, run_id, status, sleep_until, started_at)
       VALUES (?, ?, 'sleeping', ?, ?)
       ON CONFLICT(step_id) DO UPDATE SET
         status = 'sleeping',
         sleep_until = excluded.sleep_until`,
      stepId, runId, timestamp, Date.now()
    )

    // Schedule alarm
    await this.scheduleNextAlarm()
  }

  /**
   * Wake a sleeping step
   */
  private async wakeStep(runId: string, stepId: string): Promise<void> {
    this.state.storage.sql.exec(
      `UPDATE steps SET
         status = 'completed',
         result = ?,
         completed_at = ?,
         sleep_until = NULL
       WHERE run_id = ? AND step_id = ?`,
      JSON.stringify(null),
      Date.now(),
      runId,
      stepId
    )
  }

  /**
   * Get all steps for a run
   */
  private async getStepsForRun(runId: string): Promise<StepState[]> {
    const rows = this.state.storage.sql.exec<{
      step_id: string
      run_id: string
      status: string
      result: string | null
      error: string | null
      started_at: number | null
      completed_at: number | null
      sleep_until: number | null
      attempts: number
    }>(
      `SELECT * FROM steps WHERE run_id = ? ORDER BY started_at`,
      runId
    ).toArray()

    return rows.map(row => ({
      stepId: row.step_id,
      runId: row.run_id,
      status: row.status as StepState['status'],
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      sleepUntil: row.sleep_until ?? undefined,
      attempts: row.attempts,
    }))
  }

  /**
   * Delete all steps for a run (cleanup)
   */
  private async deleteStepsForRun(runId: string): Promise<void> {
    this.state.storage.sql.exec(
      `DELETE FROM steps WHERE run_id = ?`,
      runId
    )
  }

  /**
   * Get all sleeping steps
   */
  private async getSleepingSteps(): Promise<StepState[]> {
    const rows = this.state.storage.sql.exec<{
      step_id: string
      run_id: string
      status: string
      result: string | null
      error: string | null
      started_at: number | null
      completed_at: number | null
      sleep_until: number | null
      attempts: number
    }>(
      `SELECT * FROM steps WHERE status = 'sleeping' ORDER BY sleep_until`
    ).toArray()

    return rows.map(row => ({
      stepId: row.step_id,
      runId: row.run_id,
      status: row.status as StepState['status'],
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      sleepUntil: row.sleep_until ?? undefined,
      attempts: row.attempts,
    }))
  }

  /**
   * Schedule the next alarm for sleeping steps
   */
  private async scheduleNextAlarm(): Promise<void> {
    const nextSleep = this.state.storage.sql.exec<{ sleep_until: number }>(
      `SELECT MIN(sleep_until) as sleep_until FROM steps
       WHERE status = 'sleeping' AND sleep_until IS NOT NULL`
    ).one()

    if (nextSleep?.sleep_until) {
      await this.state.storage.setAlarm(nextSleep.sleep_until)
    }
  }
}
