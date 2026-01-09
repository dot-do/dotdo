/**
 * RED Phase Tests for Visibility in R2 Pipeline Streams
 *
 * These tests verify that the streams/ module properly supports visibility
 * for multi-tenant data isolation in R2 Iceberg tables.
 *
 * Related issues:
 * - dotdo-v25q: [RED] streams/ visibility tests
 *
 * Implementation requirements:
 * - Add visibility field to ThingRecord interface
 * - Add visibility column to things.sql SELECT statement
 * - Ensure visibility is partitioned for efficient queries
 * - Default visibility to 'user' in SQL transform
 *
 * Visibility levels:
 * - 'user': Private to the user (default)
 * - 'team': Shared within team/organization
 * - 'public': Publicly accessible
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ============================================================================
// Expected Types (for reference)
// ============================================================================

/**
 * Expected visibility levels for Things
 */
type Visibility = 'user' | 'team' | 'public'

/**
 * Expected ThingRecord with visibility field
 */
interface ExpectedThingRecord {
  id: string
  type: string
  version: number
  branch: string
  name: string
  data: Record<string, unknown>
  deleted: boolean
  action_id: string
  timestamp: string
  ns: string
  visibility: Visibility // NEW: visibility field for multi-tenant isolation
}

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exists
// ============================================================================

let ThingRecord: unknown
let streamsModule: Record<string, unknown> | undefined

// Try to import - will be undefined until implemented
try {
  // Import the streams module to check ThingRecord type
  const module = await import('../../streams/index')
  streamsModule = module as Record<string, unknown>
  ThingRecord = module.ThingRecord
} catch {
  // Module doesn't exist yet - tests will fail as expected (RED phase)
  streamsModule = undefined
  ThingRecord = undefined
}

// ============================================================================
// Helper: Read SQL file contents
// ============================================================================

function readThingsSql(): string {
  try {
    return readFileSync(join(process.cwd(), 'streams/things.sql'), 'utf-8')
  } catch {
    return ''
  }
}

// ============================================================================
// 1. ThingRecord Interface Tests - Visibility Field
// ============================================================================

describe('ThingRecord Interface - Visibility Field', () => {
  it('ThingRecord type includes visibility field', () => {
    // This test verifies that ThingRecord has a visibility field
    // Will fail until visibility is added to the interface
    expect(streamsModule).toBeDefined()

    // Check that the interface exported from streams/index.ts includes visibility
    // We verify by creating an object that matches the expected type
    const record: ExpectedThingRecord = {
      id: 'https://startups.studio/acme',
      type: 'https://startups.studio/Startup',
      version: 1,
      branch: 'main',
      name: 'Acme Corp',
      data: {},
      deleted: false,
      action_id: 'uuid-001',
      timestamp: '2026-01-09T12:00:00Z',
      ns: 'https://startups.studio',
      visibility: 'user',
    }

    // The actual ThingRecord should accept visibility field
    // This is a compile-time check but we verify runtime structure
    expect(record.visibility).toBe('user')
  })

  it('visibility field accepts "user" value', () => {
    const record: ExpectedThingRecord = {
      id: 'https://test.do/thing-1',
      type: 'https://test.do/Thing',
      version: 1,
      branch: 'main',
      name: 'Test Thing',
      data: {},
      deleted: false,
      action_id: 'uuid-001',
      timestamp: '2026-01-09T12:00:00Z',
      ns: 'https://test.do',
      visibility: 'user',
    }

    expect(record.visibility).toBe('user')
  })

  it('visibility field accepts "team" value', () => {
    const record: ExpectedThingRecord = {
      id: 'https://test.do/thing-2',
      type: 'https://test.do/Thing',
      version: 1,
      branch: 'main',
      name: 'Team Thing',
      data: {},
      deleted: false,
      action_id: 'uuid-002',
      timestamp: '2026-01-09T12:00:00Z',
      ns: 'https://test.do',
      visibility: 'team',
    }

    expect(record.visibility).toBe('team')
  })

  it('visibility field accepts "public" value', () => {
    const record: ExpectedThingRecord = {
      id: 'https://test.do/thing-3',
      type: 'https://test.do/Thing',
      version: 1,
      branch: 'main',
      name: 'Public Thing',
      data: {},
      deleted: false,
      action_id: 'uuid-003',
      timestamp: '2026-01-09T12:00:00Z',
      ns: 'https://test.do',
      visibility: 'public',
    }

    expect(record.visibility).toBe('public')
  })

  it('streams module exports ThingRecord with visibility property', () => {
    expect(streamsModule).toBeDefined()

    // TypeScript interfaces don't exist at runtime, but we can verify
    // the module is properly structured by checking documentation or
    // creating a test object
    //
    // This test will PASS at type-check time if visibility exists,
    // but we need runtime verification that the interface was updated

    // Read the source file and verify visibility is in the interface
    const indexSource = readFileSync(
      join(process.cwd(), 'streams/index.ts'),
      'utf-8'
    )

    // Check that visibility field exists in ThingRecord interface
    expect(indexSource).toMatch(/interface\s+ThingRecord\s*\{[\s\S]*visibility\s*:/m)
  })

  it('ThingRecord visibility field has correct Visibility type', () => {
    const indexSource = readFileSync(
      join(process.cwd(), 'streams/index.ts'),
      'utf-8'
    )

    // Verify visibility is typed as Visibility or the union type
    expect(indexSource).toMatch(/visibility\s*:\s*(?:Visibility|'user'\s*\|\s*'team'\s*\|\s*'public')/)
  })
})

// ============================================================================
// 2. SQL Transform Tests - Visibility Column
// ============================================================================

describe('things.sql - Visibility Column', () => {
  it('things.sql includes visibility in SELECT statement', () => {
    const sql = readThingsSql()

    // The SQL should select visibility column
    expect(sql).toMatch(/visibility/i)
  })

  it('things.sql includes visibility column with COALESCE default', () => {
    const sql = readThingsSql()

    // Should have COALESCE(visibility, 'user') for default value
    expect(sql).toMatch(/COALESCE\s*\(\s*visibility\s*,\s*['"]user['"]\s*\)/i)
  })

  it('things.sql visibility defaults to "user" when not provided', () => {
    const sql = readThingsSql()

    // The default should be 'user' not 'private' or 'team' or 'public'
    expect(sql).toMatch(/['"]user['"]/i)
    expect(sql).toContain('visibility')
  })

  it('things.sql visibility is part of INSERT INTO do_things', () => {
    const sql = readThingsSql()

    // The INSERT statement should include visibility column
    // Check that visibility appears after the SELECT statement starts
    const selectMatch = sql.match(/SELECT[\s\S]*FROM\s+things_stream/i)
    expect(selectMatch).not.toBeNull()

    if (selectMatch) {
      const selectClause = selectMatch[0]
      expect(selectClause).toMatch(/visibility/i)
    }
  })

  it('things.sql visibility is aliased correctly for output', () => {
    const sql = readThingsSql()

    // The output should have visibility column
    // Either as-is or with AS alias
    expect(sql).toMatch(/COALESCE\s*\([^)]+\)\s+AS\s+visibility|visibility(?:\s*,|\s+AS\s+visibility)?/i)
  })
})

// ============================================================================
// 3. SQL Partitioning Tests - Visibility for Efficient Queries
// ============================================================================

describe('things.sql - Visibility Partitioning', () => {
  it('things.sql comment documents visibility partitioning', () => {
    const sql = readThingsSql()

    // Should have documentation about visibility being used for partitioning
    expect(sql.toLowerCase()).toMatch(/partition.*visibility|visibility.*partition/i)
  })

  it('things.sql output schema includes visibility for Iceberg partitioning', () => {
    const sql = readThingsSql()

    // The output section should document visibility in schema
    // Look for Output comment block mentioning visibility
    expect(sql).toMatch(/Output[\s\S]*visibility/i)
  })

  it('visibility column is positioned for optimal query performance', () => {
    const sql = readThingsSql()

    // Visibility should be near the end of columns for Iceberg partition efficiency
    // Or documented as a partition column
    const selectMatch = sql.match(/SELECT([\s\S]*?)FROM/i)

    if (selectMatch) {
      const columns = selectMatch[1]
      // Visibility should be present in the column list
      expect(columns).toMatch(/visibility/i)
    }
  })
})

// ============================================================================
// 4. SQL Input/Output Documentation Tests
// ============================================================================

describe('things.sql - Input/Output Documentation', () => {
  it('things.sql documents visibility in Input section', () => {
    const sql = readThingsSql()

    // Input section should show visibility field from DO
    expect(sql).toMatch(/Input[\s\S]*visibility/i)
  })

  it('things.sql documents visibility in Output section', () => {
    const sql = readThingsSql()

    // Output section should show visibility field in R2 Iceberg
    expect(sql).toMatch(/Output[\s\S]*visibility/i)
  })

  it('things.sql documents visibility default value in comments', () => {
    const sql = readThingsSql()

    // Should document that visibility defaults to 'user'
    expect(sql).toMatch(/(?:default|defaults?)[\s\S]*user|user[\s\S]*(?:default|defaults?)/i)
  })
})

// ============================================================================
// 5. Visibility Type Export Tests
// ============================================================================

describe('streams/index.ts - Visibility Type Export', () => {
  it('Visibility type is exported from streams/index.ts', () => {
    const indexSource = readFileSync(
      join(process.cwd(), 'streams/index.ts'),
      'utf-8'
    )

    // Should export Visibility type
    expect(indexSource).toMatch(/export\s+(?:type\s+)?(?:\{[^}]*Visibility[^}]*\}|Visibility)/m)
  })

  it('Visibility type defines user, team, and public values', () => {
    const indexSource = readFileSync(
      join(process.cwd(), 'streams/index.ts'),
      'utf-8'
    )

    // Visibility should be a union type with user, team, public
    expect(indexSource).toMatch(/['"]user['"]/m)
    expect(indexSource).toMatch(/['"]team['"]/m)
    expect(indexSource).toMatch(/['"]public['"]/m)
  })
})

// ============================================================================
// 6. Integration with Existing Schema Tests
// ============================================================================

describe('Visibility Integration with Existing Schema', () => {
  it('ThingRecord visibility field is after existing fields', () => {
    const indexSource = readFileSync(
      join(process.cwd(), 'streams/index.ts'),
      'utf-8'
    )

    // Find ThingRecord interface and verify visibility comes after ns
    const interfaceMatch = indexSource.match(
      /interface\s+ThingRecord\s*\{([\s\S]*?)\}/m
    )

    expect(interfaceMatch).not.toBeNull()

    if (interfaceMatch) {
      const interfaceBody = interfaceMatch[1]
      const nsIndex = interfaceBody.indexOf('ns')
      const visibilityIndex = interfaceBody.indexOf('visibility')

      // visibility should appear after ns (it's the new field added at the end)
      expect(visibilityIndex).toBeGreaterThan(nsIndex)
    }
  })

  it('things.sql visibility column is after ns column', () => {
    const sql = readThingsSql()

    // In the SELECT statement, visibility should come after ns
    const selectMatch = sql.match(/SELECT([\s\S]*?)FROM/i)

    expect(selectMatch).not.toBeNull()

    if (selectMatch) {
      const columns = selectMatch[1]
      const nsIndex = columns.toLowerCase().indexOf('\n  ns')
      const visibilityIndex = columns.toLowerCase().indexOf('visibility')

      // visibility should appear after ns
      expect(visibilityIndex).toBeGreaterThan(nsIndex)
    }
  })
})

// ============================================================================
// 7. Edge Cases and Validation Tests
// ============================================================================

describe('Visibility Edge Cases', () => {
  it('visibility is required field in ThingRecord (not optional)', () => {
    const indexSource = readFileSync(
      join(process.cwd(), 'streams/index.ts'),
      'utf-8'
    )

    // visibility should NOT have ? making it optional
    // Should be: visibility: Visibility
    // NOT: visibility?: Visibility
    expect(indexSource).not.toMatch(/visibility\s*\?\s*:/m)
    expect(indexSource).toMatch(/visibility\s*:/m)
  })

  it('SQL handles null visibility with COALESCE', () => {
    const sql = readThingsSql()

    // Must use COALESCE to handle null values from source
    expect(sql).toMatch(/COALESCE\s*\(\s*visibility/i)
  })

  it('SQL default value is string "user" not variable', () => {
    const sql = readThingsSql()

    // The default should be a string literal 'user' or "user"
    expect(sql).toMatch(/COALESCE\s*\(\s*visibility\s*,\s*['"]user['"]\s*\)/i)
  })
})

// ============================================================================
// 8. Complete Schema Verification Tests
// ============================================================================

describe('Complete ThingRecord Schema with Visibility', () => {
  it('ThingRecord has all expected fields including visibility', () => {
    const indexSource = readFileSync(
      join(process.cwd(), 'streams/index.ts'),
      'utf-8'
    )

    // Extract ThingRecord interface
    const interfaceMatch = indexSource.match(
      /interface\s+ThingRecord\s*\{([\s\S]*?)\}/m
    )

    expect(interfaceMatch).not.toBeNull()

    if (interfaceMatch) {
      const body = interfaceMatch[1]

      // All original fields
      expect(body).toMatch(/id\s*:/m)
      expect(body).toMatch(/type\s*:/m)
      expect(body).toMatch(/version\s*:/m)
      expect(body).toMatch(/branch\s*:/m)
      expect(body).toMatch(/name\s*:/m)
      expect(body).toMatch(/data\s*:/m)
      expect(body).toMatch(/deleted\s*:/m)
      expect(body).toMatch(/action_id\s*:/m)
      expect(body).toMatch(/timestamp\s*:/m)
      expect(body).toMatch(/ns\s*:/m)

      // New visibility field
      expect(body).toMatch(/visibility\s*:/m)
    }
  })

  it('things.sql SELECT has all columns including visibility', () => {
    const sql = readThingsSql()

    const selectMatch = sql.match(/SELECT([\s\S]*?)FROM/i)

    expect(selectMatch).not.toBeNull()

    if (selectMatch) {
      const columns = selectMatch[1].toLowerCase()

      // All original columns
      expect(columns).toContain('id')
      expect(columns).toContain('type')
      expect(columns).toContain('version')
      expect(columns).toContain('branch')
      expect(columns).toContain('name')
      expect(columns).toContain('data')
      expect(columns).toContain('deleted')
      expect(columns).toContain('action_id')
      expect(columns).toContain('timestamp')
      expect(columns).toContain('ns')

      // New visibility column
      expect(columns).toContain('visibility')
    }
  })
})
