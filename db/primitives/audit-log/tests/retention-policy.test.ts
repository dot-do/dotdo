/**
 * Tests for RetentionPolicyEnforcer
 *
 * @see dotdo-gqku6 - [GREEN] Retention policy enforcer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createRetentionPolicyEnforcer,
  createSOC2RetentionEnforcer,
  createGDPRRetentionEnforcer,
  parseRetentionDuration,
  RetentionPolicyEnforcer,
  type RetentionPolicyDefinition,
  type EnforcementResult,
  type ComplianceReport,
} from '../retention-policy'
import { createAuditLog, type AuditLog, type CreateAuditEntryInput } from '../audit-log'
import { TestMetricsCollector } from '../../observability'

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a test audit entry input
 */
function createTestEntry(overrides: Partial<CreateAuditEntryInput> = {}): CreateAuditEntryInput {
  return {
    actor: { userId: 'test-user' },
    action: 'create',
    resource: { type: 'Document', id: `doc-${Math.random().toString(36).substring(7)}` },
    ...overrides,
  }
}

/**
 * Create an entry with a specific timestamp
 */
function createEntryWithTimestamp(daysAgo: number, overrides: Partial<CreateAuditEntryInput> = {}): CreateAuditEntryInput {
  const timestamp = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  return createTestEntry({
    timestamp: timestamp.toISOString(),
    ...overrides,
  })
}

/**
 * Populate audit log with test entries
 */
function populateAuditLog(auditLog: AuditLog, entries: CreateAuditEntryInput[]): void {
  for (const entry of entries) {
    auditLog.append(entry)
  }
}

// =============================================================================
// POLICY DEFINITION TESTS
// =============================================================================

describe('RetentionPolicyEnforcer - Policy Definition', () => {
  let auditLog: AuditLog
  let enforcer: RetentionPolicyEnforcer

  beforeEach(() => {
    auditLog = createAuditLog()
    enforcer = createRetentionPolicyEnforcer(auditLog)
  })

  describe('addPolicy', () => {
    it('should add a valid policy', () => {
      const policy: RetentionPolicyDefinition = {
        id: 'test-policy',
        name: 'Test Policy',
        retentionPeriod: { value: 90, unit: 'days' },
        enabled: true,
      }

      enforcer.addPolicy(policy)
      expect(enforcer.getPolicy('test-policy')).toEqual(policy)
    })

    it('should reject policy without ID', () => {
      expect(() => {
        enforcer.addPolicy({
          id: '',
          name: 'Test Policy',
          retentionPeriod: { value: 90, unit: 'days' },
          enabled: true,
        })
      }).toThrow('Policy must have a non-empty ID')
    })

    it('should reject policy without name', () => {
      expect(() => {
        enforcer.addPolicy({
          id: 'test',
          name: '',
          retentionPeriod: { value: 90, unit: 'days' },
          enabled: true,
        })
      }).toThrow('Policy must have a non-empty name')
    })

    it('should reject policy with zero retention period', () => {
      expect(() => {
        enforcer.addPolicy({
          id: 'test',
          name: 'Test',
          retentionPeriod: { value: 0, unit: 'days' },
          enabled: true,
        })
      }).toThrow('Retention period value must be positive')
    })

    it('should reject policy with negative retention period', () => {
      expect(() => {
        enforcer.addPolicy({
          id: 'test',
          name: 'Test',
          retentionPeriod: { value: -30, unit: 'days' },
          enabled: true,
        })
      }).toThrow('Retention period value must be positive')
    })

    it('should reject policy with invalid retention unit', () => {
      expect(() => {
        enforcer.addPolicy({
          id: 'test',
          name: 'Test',
          retentionPeriod: { value: 30, unit: 'centuries' as any },
          enabled: true,
        })
      }).toThrow('Invalid retention period unit')
    })

    it('should accept all valid retention units', () => {
      const units = ['hours', 'days', 'weeks', 'months', 'years'] as const
      for (const unit of units) {
        enforcer.addPolicy({
          id: `policy-${unit}`,
          name: `Policy ${unit}`,
          retentionPeriod: { value: 1, unit },
          enabled: true,
        })
        expect(enforcer.getPolicy(`policy-${unit}`)).toBeDefined()
      }
    })
  })

  describe('removePolicy', () => {
    it('should remove an existing policy', () => {
      enforcer.addPolicy({
        id: 'to-remove',
        name: 'To Remove',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      expect(enforcer.removePolicy('to-remove')).toBe(true)
      expect(enforcer.getPolicy('to-remove')).toBeNull()
    })

    it('should return false for non-existent policy', () => {
      expect(enforcer.removePolicy('non-existent')).toBe(false)
    })
  })

  describe('updatePolicy', () => {
    it('should update an existing policy', () => {
      enforcer.addPolicy({
        id: 'to-update',
        name: 'Original Name',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      const updated = enforcer.updatePolicy('to-update', {
        name: 'Updated Name',
        retentionPeriod: { value: 90, unit: 'days' },
      })

      expect(updated).toBe(true)
      const policy = enforcer.getPolicy('to-update')
      expect(policy?.name).toBe('Updated Name')
      expect(policy?.retentionPeriod.value).toBe(90)
    })

    it('should not change policy ID during update', () => {
      enforcer.addPolicy({
        id: 'original-id',
        name: 'Test',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      enforcer.updatePolicy('original-id', {
        id: 'different-id' as any, // Should be ignored
        name: 'Updated',
      })

      expect(enforcer.getPolicy('original-id')).toBeDefined()
      expect(enforcer.getPolicy('different-id')).toBeNull()
    })

    it('should return false for non-existent policy', () => {
      expect(enforcer.updatePolicy('non-existent', { name: 'New' })).toBe(false)
    })
  })

  describe('listPolicies', () => {
    it('should return all policies', () => {
      enforcer.addPolicy({
        id: 'policy-1',
        name: 'Policy 1',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })
      enforcer.addPolicy({
        id: 'policy-2',
        name: 'Policy 2',
        retentionPeriod: { value: 90, unit: 'days' },
        enabled: true,
      })

      const policies = enforcer.listPolicies()
      expect(policies).toHaveLength(2)
      expect(policies.map(p => p.id)).toContain('policy-1')
      expect(policies.map(p => p.id)).toContain('policy-2')
    })

    it('should return empty array when no policies', () => {
      expect(enforcer.listPolicies()).toEqual([])
    })
  })

  describe('setEnabled', () => {
    it('should enable a disabled policy', () => {
      enforcer.addPolicy({
        id: 'toggle-test',
        name: 'Toggle Test',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: false,
      })

      expect(enforcer.setEnabled('toggle-test', true)).toBe(true)
      expect(enforcer.getPolicy('toggle-test')?.enabled).toBe(true)
    })

    it('should disable an enabled policy', () => {
      enforcer.addPolicy({
        id: 'toggle-test',
        name: 'Toggle Test',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      expect(enforcer.setEnabled('toggle-test', false)).toBe(true)
      expect(enforcer.getPolicy('toggle-test')?.enabled).toBe(false)
    })

    it('should return false for non-existent policy', () => {
      expect(enforcer.setEnabled('non-existent', true)).toBe(false)
    })
  })

  describe('setLegalHold', () => {
    it('should set legal hold on a policy', () => {
      enforcer.addPolicy({
        id: 'hold-test',
        name: 'Hold Test',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      expect(enforcer.setLegalHold('hold-test', true)).toBe(true)
      expect(enforcer.getPolicy('hold-test')?.legalHold).toBe(true)
    })

    it('should remove legal hold from a policy', () => {
      enforcer.addPolicy({
        id: 'hold-test',
        name: 'Hold Test',
        retentionPeriod: { value: 30, unit: 'days' },
        legalHold: true,
        enabled: true,
      })

      expect(enforcer.setLegalHold('hold-test', false)).toBe(true)
      expect(enforcer.getPolicy('hold-test')?.legalHold).toBe(false)
    })
  })
})

// =============================================================================
// RETENTION ENFORCEMENT TESTS
// =============================================================================

describe('RetentionPolicyEnforcer - Enforcement', () => {
  let auditLog: AuditLog
  let enforcer: RetentionPolicyEnforcer

  beforeEach(() => {
    auditLog = createAuditLog()
    enforcer = createRetentionPolicyEnforcer(auditLog)
  })

  describe('enforce', () => {
    it('should identify entries exceeding retention period', async () => {
      // Add policy with 30-day retention
      enforcer.addPolicy({
        id: 'test-policy',
        name: 'Test Policy',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      // Add entries: some within retention, some expired
      populateAuditLog(auditLog, [
        createEntryWithTimestamp(5),   // 5 days ago - within retention
        createEntryWithTimestamp(10),  // 10 days ago - within retention
        createEntryWithTimestamp(45),  // 45 days ago - expired
        createEntryWithTimestamp(60),  // 60 days ago - expired
      ])

      const result = await enforcer.enforce()

      expect(result.success).toBe(true)
      expect(result.summary.evaluated).toBe(4)
      expect(result.summary.matched).toBe(2) // 2 expired entries
    })

    it('should skip disabled policies', async () => {
      enforcer.addPolicy({
        id: 'disabled-policy',
        name: 'Disabled Policy',
        retentionPeriod: { value: 1, unit: 'days' },
        enabled: false, // Disabled
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(30), // Would be expired if policy was enabled
      ])

      const result = await enforcer.enforce()

      expect(result.summary.skipped).toBe(1)
      expect(result.summary.purged).toBe(0)
    })

    it('should respect legal hold', async () => {
      enforcer.addPolicy({
        id: 'legal-hold-policy',
        name: 'Legal Hold Policy',
        retentionPeriod: { value: 1, unit: 'days' },
        legalHold: true, // Legal hold active
        enabled: true,
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(30), // Would be expired but under legal hold
      ])

      const result = await enforcer.enforce()

      expect(result.summary.retained).toBe(1)
      expect(result.summary.purged).toBe(0)
    })

    it('should respect minimum retain count', async () => {
      enforcer.addPolicy({
        id: 'min-retain-policy',
        name: 'Min Retain Policy',
        retentionPeriod: { value: 1, unit: 'days' },
        minRetainCount: 3, // Always keep at least 3 entries
        enabled: true,
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(30), // Expired
        createEntryWithTimestamp(25), // Expired
        createEntryWithTimestamp(20), // Expired
        createEntryWithTimestamp(15), // Expired
      ])

      const result = await enforcer.enforce()

      // Should only mark 1 for purge, keeping 3
      expect(result.summary.matched).toBeLessThanOrEqual(1)
    })

    it('should archive entries before deletion when configured', async () => {
      enforcer.addPolicy({
        id: 'archive-policy',
        name: 'Archive Policy',
        retentionPeriod: { value: 30, unit: 'days' },
        archiveConfig: {
          enabled: true,
        },
        enabled: true,
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(45), // Expired
        createEntryWithTimestamp(50), // Expired
      ])

      const result = await enforcer.enforce()

      expect(result.archives).toBeDefined()
      expect(result.archives).toHaveLength(1)
      expect(result.archives![0]!.success).toBe(true)
      expect(result.archives![0]!.metadata.entryCount).toBe(2)
      expect(result.summary.archived).toBe(2)
    })

    it('should record enforcement duration', async () => {
      enforcer.addPolicy({
        id: 'timing-policy',
        name: 'Timing Policy',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      populateAuditLog(auditLog, [createEntryWithTimestamp(5)])

      const result = await enforcer.enforce()

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(result.startedAt).toBeDefined()
      expect(result.completedAt).toBeDefined()
    })

    it('should work with empty audit log', async () => {
      enforcer.addPolicy({
        id: 'empty-test',
        name: 'Empty Test',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      const result = await enforcer.enforce()

      expect(result.success).toBe(true)
      expect(result.summary.evaluated).toBe(0)
      expect(result.summary.matched).toBe(0)
    })
  })

  describe('policy filtering', () => {
    it('should filter by action type', async () => {
      enforcer.addPolicy({
        id: 'action-filter',
        name: 'Action Filter',
        actionType: 'delete',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(45, { action: 'create' }),
        createEntryWithTimestamp(45, { action: 'delete' }),
        createEntryWithTimestamp(45, { action: 'update' }),
      ])

      const result = await enforcer.enforce()

      // Only the 'delete' entry should match the policy
      expect(result.summary.matched).toBe(1)
    })

    it('should filter by resource type', async () => {
      enforcer.addPolicy({
        id: 'resource-filter',
        name: 'Resource Filter',
        resourceType: 'User',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(45, { resource: { type: 'User', id: 'u1' } }),
        createEntryWithTimestamp(45, { resource: { type: 'Document', id: 'd1' } }),
        createEntryWithTimestamp(45, { resource: { type: 'User', id: 'u2' } }),
      ])

      const result = await enforcer.enforce()

      // Only the 'User' entries should match
      expect(result.summary.matched).toBe(2)
    })

    it('should respect policy priority', async () => {
      // Higher priority policy for security events
      enforcer.addPolicy({
        id: 'high-priority',
        name: 'High Priority',
        actionType: 'login',
        retentionPeriod: { value: 365, unit: 'days' }, // 1 year
        priority: 100,
        enabled: true,
      })

      // Default policy
      enforcer.addPolicy({
        id: 'default',
        name: 'Default',
        retentionPeriod: { value: 30, unit: 'days' },
        priority: 0,
        enabled: true,
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(60, { action: 'login' }),  // Matches high priority (not expired)
        createEntryWithTimestamp(60, { action: 'create' }), // Matches default (expired)
      ])

      const result = await enforcer.enforce()

      // Login entry should be retained (365 days), create should be matched (30 days)
      expect(result.policiesEnforced).toContain('high-priority')
      expect(result.policiesEnforced).toContain('default')
    })
  })

  describe('dry-run mode', () => {
    it('should not purge entries in dry-run mode', async () => {
      const dryRunEnforcer = createRetentionPolicyEnforcer(auditLog, {
        dryRun: true,
      })

      dryRunEnforcer.addPolicy({
        id: 'dry-run-test',
        name: 'Dry Run Test',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(45),
        createEntryWithTimestamp(60),
      ])

      const result = await dryRunEnforcer.enforce()

      expect(result.summary.matched).toBe(2)
      expect(result.summary.purged).toBe(0) // Not purged in dry-run
      expect(dryRunEnforcer.isDryRun()).toBe(true)
    })
  })
})

// =============================================================================
// COMPLIANCE VERIFICATION TESTS
// =============================================================================

describe('RetentionPolicyEnforcer - Compliance Verification', () => {
  let auditLog: AuditLog
  let enforcer: RetentionPolicyEnforcer

  beforeEach(() => {
    auditLog = createAuditLog()
    enforcer = createRetentionPolicyEnforcer(auditLog)
  })

  describe('verifyCompliance', () => {
    it('should report compliant when no violations', async () => {
      enforcer.addPolicy({
        id: 'compliant-policy',
        name: 'Compliant Policy',
        retentionPeriod: { value: 90, unit: 'days' },
        enabled: true,
      })

      // All entries within retention period
      populateAuditLog(auditLog, [
        createEntryWithTimestamp(5),
        createEntryWithTimestamp(10),
        createEntryWithTimestamp(30),
      ])

      const report = await enforcer.verifyCompliance()

      expect(report.compliant).toBe(true)
      expect(report.statistics.compliantPolicies).toBe(1)
      expect(report.statistics.nonCompliantPolicies).toBe(0)
    })

    it('should report non-compliant when entries exceed retention', async () => {
      enforcer.addPolicy({
        id: 'non-compliant-policy',
        name: 'Non-Compliant Policy',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(5),   // Within
        createEntryWithTimestamp(60),  // Exceeds
        createEntryWithTimestamp(90),  // Exceeds
      ])

      const report = await enforcer.verifyCompliance()

      expect(report.compliant).toBe(false)
      expect(report.statistics.nonCompliantPolicies).toBe(1)

      const policyStatus = report.policyStatus.find(s => s.policyId === 'non-compliant-policy')
      expect(policyStatus?.compliant).toBe(false)
      expect(policyStatus?.violatingEntryCount).toBe(2)
    })

    it('should report disabled policies as compliant', async () => {
      enforcer.addPolicy({
        id: 'disabled-policy',
        name: 'Disabled Policy',
        retentionPeriod: { value: 1, unit: 'days' },
        enabled: false,
      })

      populateAuditLog(auditLog, [createEntryWithTimestamp(30)])

      const report = await enforcer.verifyCompliance()

      const policyStatus = report.policyStatus.find(s => s.policyId === 'disabled-policy')
      expect(policyStatus?.compliant).toBe(true)
      expect(policyStatus?.reason).toContain('disabled')
    })

    it('should report legal hold policies as compliant', async () => {
      enforcer.addPolicy({
        id: 'legal-hold-policy',
        name: 'Legal Hold Policy',
        retentionPeriod: { value: 1, unit: 'days' },
        legalHold: true,
        enabled: true,
      })

      populateAuditLog(auditLog, [createEntryWithTimestamp(365)])

      const report = await enforcer.verifyCompliance()

      const policyStatus = report.policyStatus.find(s => s.policyId === 'legal-hold-policy')
      expect(policyStatus?.compliant).toBe(true)
      expect(policyStatus?.reason).toContain('Legal hold')
    })

    it('should provide recommendations for non-compliant policies', async () => {
      enforcer.addPolicy({
        id: 'needs-action',
        name: 'Needs Action',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      })

      populateAuditLog(auditLog, [createEntryWithTimestamp(60)])

      const report = await enforcer.verifyCompliance()

      expect(report.recommendations).toBeDefined()
      expect(report.recommendations!.length).toBeGreaterThan(0)
    })

    it('should calculate oldest entry age', async () => {
      populateAuditLog(auditLog, [
        createEntryWithTimestamp(10),
        createEntryWithTimestamp(30),
        createEntryWithTimestamp(60),
      ])

      enforcer.addPolicy({
        id: 'test',
        name: 'Test',
        retentionPeriod: { value: 90, unit: 'days' },
        enabled: true,
      })

      const report = await enforcer.verifyCompliance()

      // Oldest entry is 60 days old (with some tolerance for test timing)
      expect(report.statistics.oldestEntryAgeDays).toBeGreaterThanOrEqual(59)
      expect(report.statistics.oldestEntryAgeDays).toBeLessThanOrEqual(61)
    })

    it('should report total entries count', async () => {
      populateAuditLog(auditLog, [
        createEntryWithTimestamp(5),
        createEntryWithTimestamp(10),
        createEntryWithTimestamp(15),
      ])

      enforcer.addPolicy({
        id: 'test',
        name: 'Test',
        retentionPeriod: { value: 90, unit: 'days' },
        enabled: true,
      })

      const report = await enforcer.verifyCompliance()

      expect(report.statistics.totalEntries).toBe(3)
    })
  })
})

// =============================================================================
// ARCHIVE TESTS
// =============================================================================

describe('RetentionPolicyEnforcer - Archive', () => {
  let auditLog: AuditLog
  let enforcer: RetentionPolicyEnforcer

  beforeEach(() => {
    auditLog = createAuditLog()
    enforcer = createRetentionPolicyEnforcer(auditLog)
  })

  describe('archive handler', () => {
    it('should use default in-memory archive handler', async () => {
      enforcer.addPolicy({
        id: 'archive-test',
        name: 'Archive Test',
        retentionPeriod: { value: 30, unit: 'days' },
        archiveConfig: { enabled: true },
        enabled: true,
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(45),
        createEntryWithTimestamp(50),
      ])

      await enforcer.enforce()

      const handler = enforcer.getDefaultArchiveHandler()
      const archives = handler.listArchives()

      expect(archives).toHaveLength(1)
      expect(archives[0]!.entryCount).toBe(2)
    })

    it('should create archive with proper metadata', async () => {
      enforcer.addPolicy({
        id: 'metadata-test',
        name: 'Metadata Test',
        retentionPeriod: { value: 30, unit: 'days' },
        archiveConfig: { enabled: true },
        enabled: true,
      })

      populateAuditLog(auditLog, [createEntryWithTimestamp(45)])

      const result = await enforcer.enforce()

      expect(result.archives).toBeDefined()
      const archive = result.archives![0]!

      expect(archive.metadata.archiveId).toMatch(/^archive-/)
      expect(archive.metadata.archivedAt).toBeDefined()
      expect(archive.metadata.policyId).toBe('metadata-test')
      expect(archive.metadata.dateRange.from).toBeDefined()
      expect(archive.metadata.dateRange.to).toBeDefined()
      expect(archive.metadata.checksum).toBeDefined()
    })

    it('should allow retrieving archived entries', async () => {
      enforcer.addPolicy({
        id: 'retrieve-test',
        name: 'Retrieve Test',
        retentionPeriod: { value: 30, unit: 'days' },
        archiveConfig: { enabled: true },
        enabled: true,
      })

      populateAuditLog(auditLog, [
        createEntryWithTimestamp(45, { resource: { type: 'Doc', id: 'archived-1' } }),
      ])

      const result = await enforcer.enforce()
      const archiveId = result.archives![0]!.metadata.archiveId

      const handler = enforcer.getDefaultArchiveHandler()
      const retrieved = handler.retrieve(archiveId)

      expect(retrieved).toBeDefined()
      expect(retrieved!.entries).toHaveLength(1)
      expect(retrieved!.entries[0]!.resource.id).toBe('archived-1')
    })
  })
})

// =============================================================================
// METRICS TESTS
// =============================================================================

describe('RetentionPolicyEnforcer - Metrics', () => {
  let auditLog: AuditLog
  let metrics: TestMetricsCollector

  beforeEach(() => {
    auditLog = createAuditLog()
    metrics = new TestMetricsCollector()
  })

  it('should record enforcement latency', async () => {
    const enforcer = createRetentionPolicyEnforcer(auditLog, { metrics })

    enforcer.addPolicy({
      id: 'test',
      name: 'Test',
      retentionPeriod: { value: 30, unit: 'days' },
      enabled: true,
    })

    await enforcer.enforce()

    const latencies = metrics.getLatencies('retention.enforce.latency')
    expect(latencies.length).toBeGreaterThan(0)
  })

  it('should record entries evaluated', async () => {
    const enforcer = createRetentionPolicyEnforcer(auditLog, { metrics })

    enforcer.addPolicy({
      id: 'test',
      name: 'Test',
      retentionPeriod: { value: 30, unit: 'days' },
      enabled: true,
    })

    populateAuditLog(auditLog, [
      createEntryWithTimestamp(5),
      createEntryWithTimestamp(10),
    ])

    await enforcer.enforce()

    const total = metrics.getCounterTotal('retention.entries_evaluated')
    expect(total).toBe(2)
  })

  it('should record policy count', async () => {
    const enforcer = createRetentionPolicyEnforcer(auditLog, { metrics })

    enforcer.addPolicy({
      id: 'policy-1',
      name: 'Policy 1',
      retentionPeriod: { value: 30, unit: 'days' },
      enabled: true,
    })

    enforcer.addPolicy({
      id: 'policy-2',
      name: 'Policy 2',
      retentionPeriod: { value: 60, unit: 'days' },
      enabled: true,
    })

    const gauge = metrics.getLatestGauge('retention.policy_count')
    expect(gauge).toBe(2)
  })

  it('should record compliance check latency', async () => {
    const enforcer = createRetentionPolicyEnforcer(auditLog, { metrics })

    enforcer.addPolicy({
      id: 'test',
      name: 'Test',
      retentionPeriod: { value: 30, unit: 'days' },
      enabled: true,
    })

    await enforcer.verifyCompliance()

    const latencies = metrics.getLatencies('retention.compliance_check.latency')
    expect(latencies.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// PRE-CONFIGURED ENFORCERS TESTS
// =============================================================================

describe('Pre-configured Enforcers', () => {
  let auditLog: AuditLog

  beforeEach(() => {
    auditLog = createAuditLog()
  })

  describe('createSOC2RetentionEnforcer', () => {
    it('should create enforcer with SOC2 policies', () => {
      const enforcer = createSOC2RetentionEnforcer(auditLog)
      const policies = enforcer.listPolicies()

      expect(policies.length).toBeGreaterThanOrEqual(3)

      // Should have security policy with 7 year retention
      const securityPolicy = policies.find(p => p.id === 'soc2-security')
      expect(securityPolicy).toBeDefined()
      expect(securityPolicy!.retentionPeriod.value).toBe(7)
      expect(securityPolicy!.retentionPeriod.unit).toBe('years')
      expect(securityPolicy!.complianceStandard).toBe('SOC2')
    })

    it('should have access control policy', () => {
      const enforcer = createSOC2RetentionEnforcer(auditLog)
      const policies = enforcer.listPolicies()

      const accessPolicy = policies.find(p => p.id === 'soc2-access')
      expect(accessPolicy).toBeDefined()
      expect(accessPolicy!.resourceType).toBe('Permission')
    })
  })

  describe('createGDPRRetentionEnforcer', () => {
    it('should create enforcer with GDPR policies', () => {
      const enforcer = createGDPRRetentionEnforcer(auditLog)
      const policies = enforcer.listPolicies()

      expect(policies.length).toBeGreaterThanOrEqual(3)

      // Should have personal data policy with limited retention
      const personalDataPolicy = policies.find(p => p.id === 'gdpr-personal-data')
      expect(personalDataPolicy).toBeDefined()
      expect(personalDataPolicy!.retentionPeriod.value).toBe(3)
      expect(personalDataPolicy!.retentionPeriod.unit).toBe('years')
      expect(personalDataPolicy!.complianceStandard).toBe('GDPR')
    })

    it('should have consent records policy', () => {
      const enforcer = createGDPRRetentionEnforcer(auditLog)
      const policies = enforcer.listPolicies()

      const consentPolicy = policies.find(p => p.id === 'gdpr-consent')
      expect(consentPolicy).toBeDefined()
      expect(consentPolicy!.actionType).toBe('consent')
    })
  })
})

// =============================================================================
// UTILITY FUNCTION TESTS
// =============================================================================

describe('parseRetentionDuration', () => {
  it('should parse simple duration strings', () => {
    expect(parseRetentionDuration('90 days')).toEqual({ value: 90, unit: 'days' })
    expect(parseRetentionDuration('7 years')).toEqual({ value: 7, unit: 'years' })
    expect(parseRetentionDuration('24 hours')).toEqual({ value: 24, unit: 'hours' })
  })

  it('should handle singular units', () => {
    expect(parseRetentionDuration('1 day')).toEqual({ value: 1, unit: 'days' })
    expect(parseRetentionDuration('1 year')).toEqual({ value: 1, unit: 'years' })
    expect(parseRetentionDuration('1 hour')).toEqual({ value: 1, unit: 'hours' })
  })

  it('should handle no space between number and unit', () => {
    expect(parseRetentionDuration('90days')).toEqual({ value: 90, unit: 'days' })
    expect(parseRetentionDuration('7years')).toEqual({ value: 7, unit: 'years' })
  })

  it('should handle extra whitespace', () => {
    expect(parseRetentionDuration('  90  days  ')).toEqual({ value: 90, unit: 'days' })
  })

  it('should throw on invalid format', () => {
    expect(() => parseRetentionDuration('invalid')).toThrow('Invalid duration format')
    expect(() => parseRetentionDuration('')).toThrow('Invalid duration format')
    expect(() => parseRetentionDuration('days 90')).toThrow('Invalid duration format')
  })

  it('should support all valid units', () => {
    expect(parseRetentionDuration('1 hours')).toEqual({ value: 1, unit: 'hours' })
    expect(parseRetentionDuration('1 days')).toEqual({ value: 1, unit: 'days' })
    expect(parseRetentionDuration('1 weeks')).toEqual({ value: 1, unit: 'weeks' })
    expect(parseRetentionDuration('1 months')).toEqual({ value: 1, unit: 'months' })
    expect(parseRetentionDuration('1 years')).toEqual({ value: 1, unit: 'years' })
  })
})

// =============================================================================
// SCHEDULING TESTS
// =============================================================================

describe('RetentionPolicyEnforcer - Scheduling', () => {
  let auditLog: AuditLog

  beforeEach(() => {
    auditLog = createAuditLog()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should setup interval-based scheduling', async () => {
    const enforcer = createRetentionPolicyEnforcer(auditLog, {
      schedule: {
        type: 'interval',
        intervalMs: 60000, // 1 minute
      },
    })

    enforcer.addPolicy({
      id: 'test',
      name: 'Test',
      retentionPeriod: { value: 30, unit: 'days' },
      enabled: true,
    })

    // Fast-forward past the interval
    await vi.advanceTimersByTimeAsync(60000)

    // Cleanup
    enforcer.stopSchedule()
  })

  it('should stop scheduled enforcement', () => {
    const enforcer = createRetentionPolicyEnforcer(auditLog, {
      schedule: {
        type: 'interval',
        intervalMs: 1000,
      },
    })

    enforcer.stopSchedule()
    // Should not throw
  })
})

// =============================================================================
// DEFAULT POLICY TESTS
// =============================================================================

describe('RetentionPolicyEnforcer - Default Policy', () => {
  it('should apply default policy to unmatched entries', async () => {
    const auditLog = createAuditLog()
    const enforcer = createRetentionPolicyEnforcer(auditLog, {
      defaultPolicy: {
        id: 'default',
        name: 'Default Policy',
        retentionPeriod: { value: 30, unit: 'days' },
        enabled: true,
      },
    })

    // Add specific policy for User resources
    enforcer.addPolicy({
      id: 'user-policy',
      name: 'User Policy',
      resourceType: 'User',
      retentionPeriod: { value: 90, unit: 'days' },
      priority: 100,
      enabled: true,
    })

    // Add entries
    populateAuditLog(auditLog, [
      createEntryWithTimestamp(45, { resource: { type: 'Document', id: 'd1' } }), // Default policy
      createEntryWithTimestamp(45, { resource: { type: 'User', id: 'u1' } }),     // User policy
    ])

    const result = await enforcer.enforce()

    // Document entry (45 days) exceeds default policy (30 days) - should match
    // User entry (45 days) is within user policy (90 days) - should not match
    expect(result.summary.matched).toBe(1)
  })
})
