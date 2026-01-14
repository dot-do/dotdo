/**
 * Wrangler Pipeline Configuration Tests
 *
 * Validates that the unified_events pipeline is correctly configured
 * in wrangler.jsonc for streaming events to R2 Iceberg.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// Type definitions for wrangler.jsonc structure
interface PipelineConfig {
  pipeline: string
  binding: string
}

interface R2BucketConfig {
  binding: string
  bucket_name: string
}

interface WranglerConfig {
  name?: string
  main?: string
  compatibility_date?: string
  pipelines?: PipelineConfig[]
  r2_buckets?: R2BucketConfig[]
  durable_objects?: {
    bindings?: Array<{ name: string; class_name: string }>
  }
}

/**
 * Parse JSONC (JSON with comments) by stripping comments
 */
function parseJsonc(content: string): unknown {
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*/g, '') // Remove line comments
  return JSON.parse(stripped)
}

describe('Wrangler Pipeline Config', () => {
  let config: WranglerConfig
  const wranglerPath = path.join(process.cwd(), 'wrangler.jsonc')

  beforeAll(() => {
    const content = fs.readFileSync(wranglerPath, 'utf-8')
    config = parseJsonc(content) as WranglerConfig
  })

  describe('unified_events pipeline', () => {
    it('has unified_events pipeline configured', () => {
      expect(config.pipelines).toBeDefined()
      expect(Array.isArray(config.pipelines)).toBe(true)

      const pipeline = config.pipelines?.find((p) => p.pipeline === 'unified_events')
      expect(pipeline).toBeDefined()
    })

    it('has UNIFIED_EVENTS_PIPELINE binding', () => {
      const pipeline = config.pipelines?.find((p) => p.pipeline === 'unified_events')
      expect(pipeline?.binding).toBe('UNIFIED_EVENTS_PIPELINE')
    })
  })

  describe('R2 bucket configuration', () => {
    it('has events-iceberg bucket configured', () => {
      expect(config.r2_buckets).toBeDefined()
      expect(Array.isArray(config.r2_buckets)).toBe(true)

      const bucket = config.r2_buckets?.find((b) => b.bucket_name === 'events-iceberg')
      expect(bucket).toBeDefined()
    })

    it('has EVENTS_ICEBERG_BUCKET binding', () => {
      const bucket = config.r2_buckets?.find((b) => b.bucket_name === 'events-iceberg')
      expect(bucket?.binding).toBe('EVENTS_ICEBERG_BUCKET')
    })
  })

  describe('pipeline SQL transform', () => {
    it('has unified_events.sql transform file', () => {
      const sqlPath = path.join(process.cwd(), 'db/streams/unified_events.sql')
      expect(fs.existsSync(sqlPath)).toBe(true)
    })

    it('transform SQL contains required columns', () => {
      const sqlPath = path.join(process.cwd(), 'db/streams/unified_events.sql')
      const sql = fs.readFileSync(sqlPath, 'utf-8')

      // Check for partition columns
      expect(sql).toContain('day')
      expect(sql).toContain('ns')
      expect(sql).toContain('event_source')

      // Check for sort columns
      expect(sql).toContain('timestamp')
      expect(sql).toContain('trace_id')
    })

    it('transform SQL inserts into unified_events table', () => {
      const sqlPath = path.join(process.cwd(), 'db/streams/unified_events.sql')
      const sql = fs.readFileSync(sqlPath, 'utf-8')

      expect(sql).toMatch(/INSERT INTO unified_events/i)
    })

    it('transform SQL reads from unified_events_stream', () => {
      const sqlPath = path.join(process.cwd(), 'db/streams/unified_events.sql')
      const sql = fs.readFileSync(sqlPath, 'utf-8')

      expect(sql).toMatch(/FROM unified_events_stream/i)
    })
  })

  describe('existing configuration preserved', () => {
    it('preserves DO binding', () => {
      expect(config.durable_objects?.bindings).toBeDefined()
      const doBinding = config.durable_objects?.bindings?.find((b) => b.name === 'DO')
      expect(doBinding).toBeDefined()
      expect(doBinding?.class_name).toBe('DO')
    })

    it('preserves existing R2 bucket', () => {
      const dotdoLakeBucket = config.r2_buckets?.find((b) => b.bucket_name === 'dotdo-lake')
      expect(dotdoLakeBucket).toBeDefined()
      expect(dotdoLakeBucket?.binding).toBe('R2')
    })
  })
})
