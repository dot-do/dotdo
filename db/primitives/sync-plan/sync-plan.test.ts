/**
 * SyncPlan Tests
 *
 * TDD tests for SyncPlan schema and validation:
 * - SyncPlan validates required fields
 * - SyncPlan rejects invalid mode values
 * - SyncPlan validates field mappings reference existing fields
 * - SyncPlan serializes/deserializes correctly
 *
 * @module db/primitives/sync-plan/sync-plan.test
 */

import { describe, it, expect } from 'vitest'
import {
  SyncPlanSchema,
  SyncModeSchema,
  ConflictResolutionStrategySchema,
  ConflictResolutionSchema,
  FieldMappingSchema,
  EndpointSchemaSchema,
  FilterExpressionSchema,
  CronExpressionSchema,
  validateSyncPlan,
  validateFieldMappings,
  isSyncPlan,
  serializeSyncPlan,
  deserializeSyncPlan,
  createSyncPlan,
  createFullRefreshSyncPlan,
  createIncrementalSyncPlan,
  createBidirectionalSyncPlan,
  createUpsertSyncPlan,
  type SyncPlan,
  type EndpointSchema,
  type ConflictResolution,
} from './index'

// =============================================================================
// TEST FIXTURES
// =============================================================================

const validSource: EndpointSchema = {
  type: 'postgres',
  config: {
    host: 'localhost',
    port: 5432,
    database: 'source_db',
  },
  stream: 'users',
  namespace: 'public',
}

const validDestination: EndpointSchema = {
  type: 'salesforce',
  config: {
    instanceUrl: 'https://test.salesforce.com',
    accessToken: 'secret',
  },
  stream: 'Contact',
}

const validConflictResolution: ConflictResolution = {
  strategy: 'lww',
  timestampField: 'updatedAt',
}

const minimalValidSyncPlan: SyncPlan = {
  id: 'sync-001',
  name: 'Users to Contacts',
  source: validSource,
  destination: validDestination,
  fieldMappings: [],
  mode: 'full',
  primaryKey: 'id',
  batchSize: 1000,
  enabled: true,
}

// =============================================================================
// SYNC MODE TESTS
// =============================================================================

describe('SyncMode Schema', () => {
  it('accepts valid sync modes', () => {
    expect(SyncModeSchema.safeParse('full').success).toBe(true)
    expect(SyncModeSchema.safeParse('incremental').success).toBe(true)
    expect(SyncModeSchema.safeParse('bidirectional').success).toBe(true)
    expect(SyncModeSchema.safeParse('upsert').success).toBe(true)
  })

  it('rejects invalid sync modes', () => {
    expect(SyncModeSchema.safeParse('invalid').success).toBe(false)
    expect(SyncModeSchema.safeParse('sync').success).toBe(false)
    expect(SyncModeSchema.safeParse('').success).toBe(false)
    expect(SyncModeSchema.safeParse(123).success).toBe(false)
  })
})

// =============================================================================
// CONFLICT RESOLUTION TESTS
// =============================================================================

describe('ConflictResolutionStrategy Schema', () => {
  it('accepts valid strategies', () => {
    expect(ConflictResolutionStrategySchema.safeParse('lww').success).toBe(true)
    expect(ConflictResolutionStrategySchema.safeParse('source_wins').success).toBe(true)
    expect(ConflictResolutionStrategySchema.safeParse('destination_wins').success).toBe(true)
    expect(ConflictResolutionStrategySchema.safeParse('merge').success).toBe(true)
    expect(ConflictResolutionStrategySchema.safeParse('custom').success).toBe(true)
  })

  it('rejects invalid strategies', () => {
    expect(ConflictResolutionStrategySchema.safeParse('invalid').success).toBe(false)
    expect(ConflictResolutionStrategySchema.safeParse('').success).toBe(false)
  })
})

describe('ConflictResolution Schema', () => {
  it('validates lww requires timestampField', () => {
    const lwwWithTimestamp = {
      strategy: 'lww',
      timestampField: 'updatedAt',
    }
    expect(ConflictResolutionSchema.safeParse(lwwWithTimestamp).success).toBe(true)

    const lwwWithoutTimestamp = {
      strategy: 'lww',
    }
    expect(ConflictResolutionSchema.safeParse(lwwWithoutTimestamp).success).toBe(false)
  })

  it('validates custom requires customHandler', () => {
    const customWithHandler = {
      strategy: 'custom',
      customHandler: 'myHandler',
    }
    expect(ConflictResolutionSchema.safeParse(customWithHandler).success).toBe(true)

    const customWithoutHandler = {
      strategy: 'custom',
    }
    expect(ConflictResolutionSchema.safeParse(customWithoutHandler).success).toBe(false)
  })

  it('accepts merge with preferSourceFields', () => {
    const mergeConfig = {
      strategy: 'merge',
      preferSourceFields: ['name', 'email'],
      preferDestinationFields: ['phone'],
    }
    expect(ConflictResolutionSchema.safeParse(mergeConfig).success).toBe(true)
  })

  it('accepts source_wins without additional config', () => {
    const sourceWins = {
      strategy: 'source_wins',
    }
    expect(ConflictResolutionSchema.safeParse(sourceWins).success).toBe(true)
  })

  it('accepts destination_wins without additional config', () => {
    const destWins = {
      strategy: 'destination_wins',
    }
    expect(ConflictResolutionSchema.safeParse(destWins).success).toBe(true)
  })
})

// =============================================================================
// FIELD MAPPING TESTS
// =============================================================================

describe('FieldMapping Schema', () => {
  it('validates basic field mapping', () => {
    const mapping = {
      source: 'first_name',
      destination: 'FirstName',
    }
    expect(FieldMappingSchema.safeParse(mapping).success).toBe(true)
  })

  it('validates mapping with transform', () => {
    const mapping = {
      source: 'email',
      destination: 'Email',
      transform: 'lowercase',
    }
    expect(FieldMappingSchema.safeParse(mapping).success).toBe(true)
  })

  it('validates mapping with nested paths', () => {
    const mapping = {
      source: 'address.city',
      destination: 'MailingCity',
    }
    expect(FieldMappingSchema.safeParse(mapping).success).toBe(true)
  })

  it('validates mapping with defaultValue', () => {
    const mapping = {
      source: 'status',
      destination: 'Status__c',
      defaultValue: 'Active',
    }
    expect(FieldMappingSchema.safeParse(mapping).success).toBe(true)
  })

  it('validates bidirectional mapping', () => {
    const mapping = {
      source: 'name',
      destination: 'Name',
      bidirectional: true,
    }
    expect(FieldMappingSchema.safeParse(mapping).success).toBe(true)
  })

  it('rejects empty source field', () => {
    const mapping = {
      source: '',
      destination: 'Name',
    }
    expect(FieldMappingSchema.safeParse(mapping).success).toBe(false)
  })

  it('rejects empty destination field', () => {
    const mapping = {
      source: 'name',
      destination: '',
    }
    expect(FieldMappingSchema.safeParse(mapping).success).toBe(false)
  })

  it('rejects invalid transform', () => {
    const mapping = {
      source: 'name',
      destination: 'Name',
      transform: 'invalid_transform',
    }
    expect(FieldMappingSchema.safeParse(mapping).success).toBe(false)
  })
})

// =============================================================================
// ENDPOINT SCHEMA TESTS
// =============================================================================

describe('EndpointSchema', () => {
  it('validates valid endpoint', () => {
    expect(EndpointSchemaSchema.safeParse(validSource).success).toBe(true)
    expect(EndpointSchemaSchema.safeParse(validDestination).success).toBe(true)
  })

  it('rejects missing type', () => {
    const invalid = {
      config: {},
      stream: 'users',
    }
    expect(EndpointSchemaSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects missing stream', () => {
    const invalid = {
      type: 'postgres',
      config: {},
    }
    expect(EndpointSchemaSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts endpoint without namespace', () => {
    const endpoint = {
      type: 'salesforce',
      config: {},
      stream: 'Contact',
    }
    expect(EndpointSchemaSchema.safeParse(endpoint).success).toBe(true)
  })
})

// =============================================================================
// FILTER EXPRESSION TESTS
// =============================================================================

describe('FilterExpression Schema', () => {
  it('validates eq filter', () => {
    const filter = {
      field: 'status',
      operator: 'eq',
      value: 'active',
    }
    expect(FilterExpressionSchema.safeParse(filter).success).toBe(true)
  })

  it('validates in filter with array', () => {
    const filter = {
      field: 'status',
      operator: 'in',
      value: ['active', 'pending'],
    }
    expect(FilterExpressionSchema.safeParse(filter).success).toBe(true)
  })

  it('validates is_null without value', () => {
    const filter = {
      field: 'deletedAt',
      operator: 'is_null',
    }
    expect(FilterExpressionSchema.safeParse(filter).success).toBe(true)
  })

  it('validates numeric comparison', () => {
    const filter = {
      field: 'age',
      operator: 'gte',
      value: 18,
    }
    expect(FilterExpressionSchema.safeParse(filter).success).toBe(true)
  })

  it('rejects invalid operator', () => {
    const filter = {
      field: 'status',
      operator: 'invalid',
      value: 'active',
    }
    expect(FilterExpressionSchema.safeParse(filter).success).toBe(false)
  })

  it('rejects empty field', () => {
    const filter = {
      field: '',
      operator: 'eq',
      value: 'test',
    }
    expect(FilterExpressionSchema.safeParse(filter).success).toBe(false)
  })
})

// =============================================================================
// CRON EXPRESSION TESTS
// =============================================================================

describe('CronExpression Schema', () => {
  it('validates standard CRON expressions', () => {
    expect(CronExpressionSchema.safeParse('* * * * *').success).toBe(true)
    expect(CronExpressionSchema.safeParse('0 * * * *').success).toBe(true)
    expect(CronExpressionSchema.safeParse('0 0 * * *').success).toBe(true)
    expect(CronExpressionSchema.safeParse('0 9 * * 1').success).toBe(true)
    expect(CronExpressionSchema.safeParse('30 4 1 * *').success).toBe(true)
  })

  it('validates CRON with ranges', () => {
    expect(CronExpressionSchema.safeParse('0 9-17 * * 1-5').success).toBe(true)
    expect(CronExpressionSchema.safeParse('0 0 1-15 * *').success).toBe(true)
  })

  it('validates CRON with intervals', () => {
    expect(CronExpressionSchema.safeParse('*/5 * * * *').success).toBe(true)
    expect(CronExpressionSchema.safeParse('0 */2 * * *').success).toBe(true)
  })

  it('validates CRON with lists', () => {
    expect(CronExpressionSchema.safeParse('0 0 * * 1,3,5').success).toBe(true)
    expect(CronExpressionSchema.safeParse('0 8,12,18 * * *').success).toBe(true)
  })

  it('rejects invalid CRON expressions', () => {
    expect(CronExpressionSchema.safeParse('invalid').success).toBe(false)
    expect(CronExpressionSchema.safeParse('* * *').success).toBe(false)
    expect(CronExpressionSchema.safeParse('60 * * * *').success).toBe(false)
    expect(CronExpressionSchema.safeParse('* 25 * * *').success).toBe(false)
  })
})

// =============================================================================
// SYNC PLAN SCHEMA TESTS
// =============================================================================

describe('SyncPlan Schema', () => {
  describe('validates required fields', () => {
    it('accepts valid minimal SyncPlan', () => {
      const result = SyncPlanSchema.safeParse(minimalValidSyncPlan)
      expect(result.success).toBe(true)
    })

    it('rejects missing id', () => {
      const { id, ...noId } = minimalValidSyncPlan
      expect(SyncPlanSchema.safeParse(noId).success).toBe(false)
    })

    it('rejects missing name', () => {
      const { name, ...noName } = minimalValidSyncPlan
      expect(SyncPlanSchema.safeParse(noName).success).toBe(false)
    })

    it('rejects missing source', () => {
      const { source, ...noSource } = minimalValidSyncPlan
      expect(SyncPlanSchema.safeParse(noSource).success).toBe(false)
    })

    it('rejects missing destination', () => {
      const { destination, ...noDest } = minimalValidSyncPlan
      expect(SyncPlanSchema.safeParse(noDest).success).toBe(false)
    })

    it('rejects missing mode', () => {
      const { mode, ...noMode } = minimalValidSyncPlan
      expect(SyncPlanSchema.safeParse(noMode).success).toBe(false)
    })

    it('rejects missing primaryKey', () => {
      const { primaryKey, ...noPK } = minimalValidSyncPlan
      expect(SyncPlanSchema.safeParse(noPK).success).toBe(false)
    })
  })

  describe('rejects invalid mode values', () => {
    it('rejects unknown mode', () => {
      const invalidMode = {
        ...minimalValidSyncPlan,
        mode: 'invalid_mode',
      }
      expect(SyncPlanSchema.safeParse(invalidMode).success).toBe(false)
    })

    it('rejects numeric mode', () => {
      const numericMode = {
        ...minimalValidSyncPlan,
        mode: 123,
      }
      expect(SyncPlanSchema.safeParse(numericMode).success).toBe(false)
    })
  })

  describe('validates mode-specific requirements', () => {
    it('requires conflictResolution for bidirectional mode', () => {
      const bidirectional = {
        ...minimalValidSyncPlan,
        mode: 'bidirectional',
        conflictResolution: validConflictResolution,
      }
      expect(SyncPlanSchema.safeParse(bidirectional).success).toBe(true)

      const bidirectionalNoResolution = {
        ...minimalValidSyncPlan,
        mode: 'bidirectional',
      }
      expect(SyncPlanSchema.safeParse(bidirectionalNoResolution).success).toBe(false)
    })

    it('requires cursorField for incremental mode', () => {
      const incremental = {
        ...minimalValidSyncPlan,
        mode: 'incremental',
        cursorField: 'updatedAt',
      }
      expect(SyncPlanSchema.safeParse(incremental).success).toBe(true)

      const incrementalNoCursor = {
        ...minimalValidSyncPlan,
        mode: 'incremental',
      }
      expect(SyncPlanSchema.safeParse(incrementalNoCursor).success).toBe(false)
    })

    it('accepts full mode without extra config', () => {
      expect(SyncPlanSchema.safeParse(minimalValidSyncPlan).success).toBe(true)
    })

    it('accepts upsert mode without extra config', () => {
      const upsert = {
        ...minimalValidSyncPlan,
        mode: 'upsert',
      }
      expect(SyncPlanSchema.safeParse(upsert).success).toBe(true)
    })
  })

  describe('validates optional fields', () => {
    it('accepts with schedule', () => {
      const withSchedule = {
        ...minimalValidSyncPlan,
        schedule: '0 * * * *',
      }
      expect(SyncPlanSchema.safeParse(withSchedule).success).toBe(true)
    })

    it('accepts with filters', () => {
      const withFilters = {
        ...minimalValidSyncPlan,
        filters: [
          { field: 'status', operator: 'eq', value: 'active' },
          { field: 'deletedAt', operator: 'is_null' },
        ],
      }
      expect(SyncPlanSchema.safeParse(withFilters).success).toBe(true)
    })

    it('accepts with field mappings', () => {
      const withMappings = {
        ...minimalValidSyncPlan,
        fieldMappings: [
          { source: 'first_name', destination: 'FirstName' },
          { source: 'email', destination: 'Email', transform: 'lowercase' },
        ],
      }
      expect(SyncPlanSchema.safeParse(withMappings).success).toBe(true)
    })

    it('accepts array primaryKey', () => {
      const arrayPK = {
        ...minimalValidSyncPlan,
        primaryKey: ['tenant_id', 'user_id'],
      }
      expect(SyncPlanSchema.safeParse(arrayPK).success).toBe(true)
    })

    it('accepts with metadata', () => {
      const withMeta = {
        ...minimalValidSyncPlan,
        metadata: {
          createdBy: 'admin',
          tags: ['production', 'crm'],
        },
      }
      expect(SyncPlanSchema.safeParse(withMeta).success).toBe(true)
    })

    it('accepts with rateLimit', () => {
      const withRate = {
        ...minimalValidSyncPlan,
        rateLimit: 100,
      }
      expect(SyncPlanSchema.safeParse(withRate).success).toBe(true)
    })

    it('rejects negative batchSize', () => {
      const negativeBatch = {
        ...minimalValidSyncPlan,
        batchSize: -100,
      }
      expect(SyncPlanSchema.safeParse(negativeBatch).success).toBe(false)
    })

    it('rejects zero batchSize', () => {
      const zeroBatch = {
        ...minimalValidSyncPlan,
        batchSize: 0,
      }
      expect(SyncPlanSchema.safeParse(zeroBatch).success).toBe(false)
    })
  })
})

// =============================================================================
// VALIDATION FUNCTION TESTS
// =============================================================================

describe('validateSyncPlan', () => {
  it('returns success for valid plan', () => {
    const result = validateSyncPlan(minimalValidSyncPlan)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('sync-001')
    }
  })

  it('returns error for invalid plan', () => {
    const result = validateSyncPlan({ invalid: true })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0)
    }
  })
})

describe('validateFieldMappings', () => {
  it('validates mappings exist in schemas', () => {
    const mappings = [
      { source: 'name', destination: 'Name' },
      { source: 'email', destination: 'Email' },
    ]
    const sourceFields = ['id', 'name', 'email', 'phone']
    const destFields = ['Id', 'Name', 'Email', 'Phone']

    const result = validateFieldMappings(mappings, sourceFields, destFields)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('reports missing source fields', () => {
    const mappings = [{ source: 'missing_field', destination: 'Name' }]
    const sourceFields = ['id', 'name']
    const destFields = ['Id', 'Name']

    const result = validateFieldMappings(mappings, sourceFields, destFields)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Source field 'missing_field' not found in source schema")
  })

  it('reports missing destination fields', () => {
    const mappings = [{ source: 'name', destination: 'MissingField' }]
    const sourceFields = ['name']
    const destFields = ['Name']

    const result = validateFieldMappings(mappings, sourceFields, destFields)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Destination field 'MissingField' not found in destination schema")
  })

  it('handles nested field paths', () => {
    const mappings = [{ source: 'address.city', destination: 'MailingCity' }]
    const sourceFields = ['id', 'address']
    const destFields = ['Id', 'MailingCity']

    const result = validateFieldMappings(mappings, sourceFields, destFields)
    expect(result.valid).toBe(true)
  })
})

describe('isSyncPlan', () => {
  it('returns true for valid plan', () => {
    expect(isSyncPlan(minimalValidSyncPlan)).toBe(true)
  })

  it('returns false for invalid plan', () => {
    expect(isSyncPlan({ invalid: true })).toBe(false)
    expect(isSyncPlan(null)).toBe(false)
    expect(isSyncPlan(undefined)).toBe(false)
    expect(isSyncPlan('string')).toBe(false)
  })
})

// =============================================================================
// SERIALIZATION TESTS
// =============================================================================

describe('Serialization', () => {
  it('serializes/deserializes correctly', () => {
    const json = serializeSyncPlan(minimalValidSyncPlan)
    expect(typeof json).toBe('string')

    const result = deserializeSyncPlan(json)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe(minimalValidSyncPlan.id)
      expect(result.data.name).toBe(minimalValidSyncPlan.name)
      expect(result.data.mode).toBe(minimalValidSyncPlan.mode)
    }
  })

  it('handles invalid JSON', () => {
    const result = deserializeSyncPlan('not valid json')
    expect(result.success).toBe(false)
  })

  it('validates during deserialization', () => {
    const invalidPlan = JSON.stringify({ id: 'test' }) // Missing required fields
    const result = deserializeSyncPlan(invalidPlan)
    expect(result.success).toBe(false)
  })
})

// =============================================================================
// FACTORY FUNCTION TESTS
// =============================================================================

describe('Factory Functions', () => {
  describe('createSyncPlan', () => {
    it('creates plan with defaults', () => {
      const plan = createSyncPlan({
        id: 'test-001',
        name: 'Test Plan',
        source: validSource,
        destination: validDestination,
        mode: 'full',
        primaryKey: 'id',
      })

      expect(plan.id).toBe('test-001')
      expect(plan.batchSize).toBe(1000)
      expect(plan.enabled).toBe(true)
      expect(plan.fieldMappings).toEqual([])
      expect(plan.createdAt).toBeDefined()
      expect(plan.updatedAt).toBeDefined()
    })

    it('allows overriding defaults', () => {
      const plan = createSyncPlan({
        id: 'test-001',
        name: 'Test Plan',
        source: validSource,
        destination: validDestination,
        mode: 'full',
        primaryKey: 'id',
        batchSize: 500,
        enabled: false,
      })

      expect(plan.batchSize).toBe(500)
      expect(plan.enabled).toBe(false)
    })
  })

  describe('createFullRefreshSyncPlan', () => {
    it('creates full refresh plan', () => {
      const plan = createFullRefreshSyncPlan(
        'full-001',
        'Full Refresh Test',
        validSource,
        validDestination,
        'id',
      )

      expect(plan.mode).toBe('full')
      expect(plan.primaryKey).toBe('id')
      expect(SyncPlanSchema.safeParse(plan).success).toBe(true)
    })
  })

  describe('createIncrementalSyncPlan', () => {
    it('creates incremental plan with cursor', () => {
      const plan = createIncrementalSyncPlan(
        'inc-001',
        'Incremental Test',
        validSource,
        validDestination,
        'id',
        'updatedAt',
      )

      expect(plan.mode).toBe('incremental')
      expect(plan.cursorField).toBe('updatedAt')
      expect(SyncPlanSchema.safeParse(plan).success).toBe(true)
    })
  })

  describe('createBidirectionalSyncPlan', () => {
    it('creates bidirectional plan with conflict resolution', () => {
      const plan = createBidirectionalSyncPlan(
        'bidi-001',
        'Bidirectional Test',
        validSource,
        validDestination,
        'id',
        validConflictResolution,
      )

      expect(plan.mode).toBe('bidirectional')
      expect(plan.conflictResolution).toEqual(validConflictResolution)
      expect(SyncPlanSchema.safeParse(plan).success).toBe(true)
    })
  })

  describe('createUpsertSyncPlan', () => {
    it('creates upsert plan', () => {
      const plan = createUpsertSyncPlan(
        'upsert-001',
        'Upsert Test',
        validSource,
        validDestination,
        ['tenant_id', 'user_id'],
      )

      expect(plan.mode).toBe('upsert')
      expect(plan.primaryKey).toEqual(['tenant_id', 'user_id'])
      expect(SyncPlanSchema.safeParse(plan).success).toBe(true)
    })
  })
})

// =============================================================================
// COMPLETE SYNC PLAN TESTS
// =============================================================================

describe('Complete SyncPlan', () => {
  it('validates a fully configured sync plan', () => {
    const fullPlan: SyncPlan = {
      id: 'sync-full-001',
      name: 'Production CRM Sync',
      description: 'Sync users from Postgres to Salesforce',
      source: validSource,
      destination: validDestination,
      fieldMappings: [
        { source: 'first_name', destination: 'FirstName' },
        { source: 'last_name', destination: 'LastName' },
        { source: 'email', destination: 'Email', transform: 'lowercase' },
        { source: 'phone', destination: 'Phone', bidirectional: true },
        { source: 'status', destination: 'Status__c', defaultValue: 'Active' },
      ],
      mode: 'bidirectional',
      primaryKey: 'id',
      schedule: '0 */6 * * *',
      filters: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'deletedAt', operator: 'is_null' },
      ],
      conflictResolution: {
        strategy: 'lww',
        timestampField: 'updatedAt',
      },
      batchSize: 500,
      enabled: true,
      rateLimit: 100,
      metadata: {
        createdBy: 'admin',
        environment: 'production',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-15T12:00:00.000Z',
    }

    const result = SyncPlanSchema.safeParse(fullPlan)
    expect(result.success).toBe(true)
  })
})
