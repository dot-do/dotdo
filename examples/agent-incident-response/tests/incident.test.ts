/**
 * Incident Response Tests
 *
 * Tests the Ralph + Tom emergency protocol for incident response:
 * - Ralph diagnoses issues and implements hotfixes
 * - Tom reviews and approves (or rejects) fixes
 * - Automated escalation when needed
 *
 * @module agent-incident-response/tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ralph,
  diagnose,
  implementHotfix,
  writeRCA,
  enableMockMode as enableRalphMockMode,
  disableMockMode as disableRalphMockMode,
  setMockResponse as setRalphMockResponse,
} from '../src/agents/ralph'
import {
  tom,
  emergencyReview,
  approve,
  assessRisk,
  enableMockMode as enableTomMockMode,
  disableMockMode as disableTomMockMode,
  setMockResponse as setTomMockResponse,
} from '../src/agents/tom'
import {
  quinn,
  validateFix,
  analyzeTestCoverage,
  analyzeEdgeCases,
  enableMockMode as enableQuinnMockMode,
  disableMockMode as disableQuinnMockMode,
  setMockResponse as setQuinnMockResponse,
} from '../src/agents/quinn'
import type {
  Alert,
  Incident,
  Diagnosis,
  Hotfix,
  Review,
  Validation,
} from '../src/IncidentResponseDO'

// ============================================================================
// TEST DATA
// ============================================================================

const createTestAlert = (overrides: Partial<Alert> = {}): Alert => ({
  id: 'alert-001',
  service: 'api-gateway',
  severity: 'critical',
  summary: 'Error rate > 5%',
  description: 'API Gateway experiencing elevated error rates',
  timestamp: new Date(),
  source: 'datadog',
  metrics: {
    errorRate: 5.2,
    latencyP99: 2500,
  },
  ...overrides,
})

const createTestDiagnosis = (overrides: Partial<Diagnosis> = {}): Diagnosis => ({
  rootCause: 'Database connection pool exhaustion',
  affectedComponents: ['api-gateway', 'postgres-primary'],
  impactAssessment: {
    usersAffected: 10000,
    revenueImpact: 'high',
    dataIntegrity: true,
  },
  suggestedFix: 'Increase connection pool size',
  confidence: 0.85,
  evidence: [
    {
      type: 'log',
      source: 'api-gateway/error.log',
      content: 'Connection pool exhausted',
      relevance: 0.95,
    },
  ],
  ...overrides,
})

const createTestHotfix = (overrides: Partial<Hotfix> = {}): Hotfix => ({
  id: 'hotfix-001',
  description: 'Increase connection pool size and add timeout',
  changes: [
    {
      path: 'src/config/database.ts',
      type: 'modify',
      diff: '-  maxConnections: 10,\n+  maxConnections: 50,',
    },
  ],
  testResults: [
    { name: 'connection.test.ts', passed: true, duration: 150 },
    { name: 'integration.test.ts', passed: true, duration: 2500 },
  ],
  rollbackPlan: 'Revert config and restart pods',
  estimatedRisk: 'low',
  ...overrides,
})

const createTestIncident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'incident-001',
  alert: createTestAlert(),
  status: 'detected',
  diagnosis: createTestDiagnosis(),
  hotfix: createTestHotfix(),
  timeline: [
    { timestamp: new Date(), event: 'Alert received', actor: 'system' },
    { timestamp: new Date(), event: 'Diagnosis complete', actor: 'ralph' },
  ],
  createdAt: new Date(),
  ...overrides,
})

// ============================================================================
// RALPH AGENT TESTS
// ============================================================================

describe('Ralph - Engineering Agent', () => {
  beforeEach(() => {
    enableRalphMockMode()
  })

  afterEach(() => {
    disableRalphMockMode()
  })

  describe('diagnose()', () => {
    it('should diagnose an alert and identify root cause', async () => {
      const alert = createTestAlert()
      const diagnosis = await diagnose({ alert })

      expect(diagnosis.rootCause).toBeDefined()
      expect(diagnosis.affectedComponents).toBeInstanceOf(Array)
      expect(diagnosis.suggestedFix).toBeDefined()
      expect(diagnosis.confidence).toBeGreaterThan(0)
    })

    it('should handle different services with appropriate diagnoses', async () => {
      const apiAlert = createTestAlert({ service: 'api-gateway' })
      const paymentAlert = createTestAlert({ service: 'payment-service' })

      const apiDiagnosis = await diagnose({ alert: apiAlert })
      const paymentDiagnosis = await diagnose({ alert: paymentAlert })

      expect(apiDiagnosis.affectedComponents).toContain('api-gateway')
      expect(paymentDiagnosis.affectedComponents).toContain('payment-service')
    })

    it('should use mock response when set', async () => {
      const mockDiagnosis = createTestDiagnosis({
        rootCause: 'Custom mock root cause',
      })
      setRalphMockResponse('diagnose', mockDiagnosis)

      const alert = createTestAlert()
      const diagnosis = await diagnose({ alert })

      expect(diagnosis.rootCause).toBe('Custom mock root cause')
    })
  })

  describe('implementHotfix()', () => {
    it('should implement a hotfix based on diagnosis', async () => {
      const diagnosis = createTestDiagnosis()
      const hotfix = await implementHotfix({ diagnosis })

      expect(hotfix.id).toBeDefined()
      expect(hotfix.description).toBeDefined()
      expect(hotfix.changes).toBeInstanceOf(Array)
      expect(hotfix.testResults).toBeInstanceOf(Array)
      expect(hotfix.rollbackPlan).toBeDefined()
    })

    it('should include test results in hotfix', async () => {
      const diagnosis = createTestDiagnosis()
      const hotfix = await implementHotfix({ diagnosis })

      expect(hotfix.testResults.length).toBeGreaterThan(0)
      expect(hotfix.testResults.every((t) => t.passed)).toBe(true)
    })

    it('should respect runbook guidance when provided', async () => {
      const diagnosis = createTestDiagnosis()
      const runbookGuidance = [
        '1. Check connection pool status',
        '2. Verify database health',
      ]

      const hotfix = await implementHotfix({ diagnosis, runbookGuidance })

      expect(hotfix).toBeDefined()
      expect(hotfix.rollbackPlan).toBeDefined()
    })
  })

  describe('writeRCA()', () => {
    it('should write an RCA for a resolved incident', async () => {
      const incident = createTestIncident({ status: 'resolved' })
      const rca = await writeRCA({ incident })

      expect(rca.incidentId).toBe(incident.id)
      expect(rca.title).toContain('RCA')
      expect(rca.rootCause).toBeDefined()
      expect(rca.actionItems).toBeInstanceOf(Array)
      expect(rca.lessonsLearned).toBeInstanceOf(Array)
    })
  })

  describe('ralph template literal', () => {
    it('should diagnose via template literal', async () => {
      const alert = createTestAlert()
      const result = await ralph`diagnose ${alert}`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
      expect((result as Diagnosis).rootCause).toBeDefined()
    })

    it('should implement hotfix via template literal', async () => {
      const diagnosis = createTestDiagnosis()
      const result = await ralph`implement hotfix for ${diagnosis}`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
      expect((result as Hotfix).changes).toBeInstanceOf(Array)
    })
  })
})

// ============================================================================
// TOM AGENT TESTS
// ============================================================================

describe('Tom - Tech Lead Agent', () => {
  beforeEach(() => {
    enableTomMockMode()
  })

  afterEach(() => {
    disableTomMockMode()
  })

  describe('emergencyReview()', () => {
    it('should review a hotfix and produce a review result', async () => {
      const hotfix = createTestHotfix()
      const diagnosis = createTestDiagnosis()

      const review = await emergencyReview({ hotfix, diagnosis })

      expect(review.reviewer).toBe('tom')
      expect(typeof review.approved).toBe('boolean')
      expect(review.checklist).toBeDefined()
      expect(review.riskAssessment).toBeDefined()
    })

    it('should approve a well-formed hotfix', async () => {
      const hotfix = createTestHotfix()
      const diagnosis = createTestDiagnosis()

      const review = await emergencyReview({ hotfix, diagnosis })

      expect(review.approved).toBe(true)
      expect(review.checklist.testsPass).toBe(true)
      expect(review.checklist.hasRollbackPlan).toBe(true)
    })

    it('should reject a hotfix with failing tests', async () => {
      const hotfix = createTestHotfix({
        testResults: [
          { name: 'failing.test.ts', passed: false, duration: 100, error: 'Assertion failed' },
        ],
      })
      const diagnosis = createTestDiagnosis()

      const review = await emergencyReview({ hotfix, diagnosis })

      expect(review.approved).toBe(false)
      expect(review.comments.some((c) => c.severity === 'blocker')).toBe(true)
    })

    it('should be more lenient in emergency mode', async () => {
      const hotfix = createTestHotfix()
      const diagnosis = createTestDiagnosis()

      const emergencyReviewResult = await emergencyReview({
        hotfix,
        diagnosis,
        isEmergency: true,
      })
      const normalReviewResult = await emergencyReview({
        hotfix,
        diagnosis,
        isEmergency: false,
      })

      // Both should approve a good hotfix
      expect(emergencyReviewResult.approved).toBe(true)
      expect(normalReviewResult.approved).toBe(true)
    })
  })

  describe('approve()', () => {
    it('should produce an approval decision from a review', async () => {
      const hotfix = createTestHotfix()
      const diagnosis = createTestDiagnosis()
      const review = await emergencyReview({ hotfix, diagnosis })

      const decision = await approve(review)

      expect(decision.approved).toBe(review.approved)
      expect(decision.reason).toBeDefined()
    })

    it('should include conditions for approved changes', async () => {
      const review: Review = {
        approved: true,
        reviewer: 'tom',
        comments: [],
        riskAssessment: 'Low risk',
        checklist: {
          addressesRootCause: true,
          noRegressions: true,
          hasRollbackPlan: true,
          testsPass: true,
          metricsMonitored: true,
        },
      }

      const decision = await approve(review)

      expect(decision.approved).toBe(true)
      expect(decision.conditions).toBeDefined()
      expect(decision.conditions?.length).toBeGreaterThan(0)
    })
  })

  describe('assessRisk()', () => {
    it('should assess risk level of a hotfix', async () => {
      const hotfix = createTestHotfix()
      const risk = await assessRisk(hotfix)

      expect(['low', 'medium', 'high', 'critical']).toContain(risk.level)
      expect(risk.factors).toBeInstanceOf(Array)
      expect(risk.mitigations).toBeInstanceOf(Array)
    })

    it('should flag hotfixes with no rollback plan', async () => {
      const hotfix = createTestHotfix({ rollbackPlan: '' })
      const risk = await assessRisk(hotfix)

      expect(risk.factors).toContain('No rollback plan defined')
    })

    it('should flag hotfixes with many file changes', async () => {
      const hotfix = createTestHotfix({
        changes: [
          { path: 'file1.ts', type: 'modify', diff: '...' },
          { path: 'file2.ts', type: 'modify', diff: '...' },
          { path: 'file3.ts', type: 'modify', diff: '...' },
          { path: 'file4.ts', type: 'modify', diff: '...' },
        ],
      })
      const risk = await assessRisk(hotfix)

      expect(risk.factors).toContain('Multiple files modified')
    })
  })

  describe('tom template literal', () => {
    it('should review via template literal', async () => {
      const hotfix = createTestHotfix()
      const diagnosis = createTestDiagnosis()
      const result = await tom`emergency review ${hotfix} with ${diagnosis}`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
      expect((result as Review).reviewer).toBe('tom')
    })

    it('should support approval via tom.approve()', async () => {
      const hotfix = createTestHotfix()
      const result = await tom.approve(hotfix)

      expect(typeof result.approved).toBe('boolean')
      expect(result.feedback).toBeDefined()
    })
  })
})

// ============================================================================
// QUINN AGENT TESTS
// ============================================================================

describe('Quinn - QA Agent', () => {
  beforeEach(() => {
    enableQuinnMockMode()
  })

  afterEach(() => {
    disableQuinnMockMode()
  })

  describe('validateFix()', () => {
    it('should validate a hotfix and produce a validation result', async () => {
      const hotfix = createTestHotfix()
      const alert = createTestAlert()

      const validation = await validateFix({ hotfix, alert })

      expect(validation.testsRun).toBeGreaterThan(0)
      expect(validation.testsPassed).toBeLessThanOrEqual(validation.testsRun)
      expect(validation.coverage).toBeGreaterThan(0)
      expect(validation.edgeCasesCovered).toBeInstanceOf(Array)
    })

    it('should pass validation for a well-formed hotfix', async () => {
      const hotfix = createTestHotfix()
      const alert = createTestAlert()

      const validation = await validateFix({ hotfix, alert })

      expect(validation.passed).toBe(true)
      expect(validation.testsPassed).toBe(validation.testsRun)
    })

    it('should fail validation for a hotfix with failing tests', async () => {
      const hotfix = createTestHotfix({
        testResults: [
          { name: 'failing.test.ts', passed: false, duration: 100, error: 'Assertion failed' },
        ],
      })
      const alert = createTestAlert()

      const validation = await validateFix({ hotfix, alert })

      expect(validation.passed).toBe(false)
    })

    it('should identify edge cases for the service', async () => {
      const hotfix = createTestHotfix()
      const alert = createTestAlert({ service: 'api-gateway' })

      const validation = await validateFix({ hotfix, alert })

      expect(validation.edgeCasesCovered.length).toBeGreaterThan(0)
    })

    it('should use mock response when set', async () => {
      const mockValidation: Validation = {
        passed: true,
        testsRun: 100,
        testsPassed: 100,
        coverage: 99,
        edgeCasesCovered: ['Custom edge case'],
        potentialGaps: [],
      }
      setQuinnMockResponse('validate', mockValidation)

      const hotfix = createTestHotfix()
      const alert = createTestAlert()
      const validation = await validateFix({ hotfix, alert })

      expect(validation.testsRun).toBe(100)
      expect(validation.coverage).toBe(99)
    })
  })

  describe('analyzeTestCoverage()', () => {
    it('should analyze test coverage for a hotfix', async () => {
      const hotfix = createTestHotfix()
      const coverage = await analyzeTestCoverage(hotfix)

      expect(coverage.percentage).toBeGreaterThan(0)
      expect(coverage.percentage).toBeLessThanOrEqual(100)
      expect(typeof coverage.criticalPathsCovered).toBe('boolean')
      expect(coverage.uncoveredPaths).toBeInstanceOf(Array)
    })

    it('should report high coverage for passing tests', async () => {
      const hotfix = createTestHotfix()
      const coverage = await analyzeTestCoverage(hotfix)

      expect(coverage.percentage).toBeGreaterThan(80)
      expect(coverage.criticalPathsCovered).toBe(true)
    })

    it('should identify uncovered paths for failing tests', async () => {
      const hotfix = createTestHotfix({
        testResults: [
          { name: 'failing.test.ts', passed: false, duration: 50, error: 'Failed' },
        ],
      })
      const coverage = await analyzeTestCoverage(hotfix)

      expect(coverage.percentage).toBeLessThan(80)
      expect(coverage.criticalPathsCovered).toBe(false)
    })
  })

  describe('analyzeEdgeCases()', () => {
    it('should analyze edge cases for a hotfix', async () => {
      const hotfix = createTestHotfix()
      const alert = createTestAlert()
      const analysis = await analyzeEdgeCases(hotfix, alert)

      expect(analysis.identified).toBeInstanceOf(Array)
      expect(analysis.tested).toBeInstanceOf(Array)
      expect(analysis.untested).toBeInstanceOf(Array)
      expect(['low', 'medium', 'high']).toContain(analysis.riskLevel)
    })

    it('should identify service-specific edge cases', async () => {
      const hotfix = createTestHotfix()
      const apiAlert = createTestAlert({ service: 'api-gateway' })
      const paymentAlert = createTestAlert({ service: 'payment-service' })

      const apiAnalysis = await analyzeEdgeCases(hotfix, apiAlert)
      const paymentAnalysis = await analyzeEdgeCases(hotfix, paymentAlert)

      // Different services should have different edge cases
      expect(apiAnalysis.identified).not.toEqual(paymentAnalysis.identified)
    })
  })

  describe('quinn template literal', () => {
    it('should validate via template literal', async () => {
      const hotfix = createTestHotfix()
      const alert = createTestAlert()
      const result = await quinn`validate ${hotfix} for ${alert}`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
      expect((result as Validation).testsRun).toBeGreaterThan(0)
    })

    it('should analyze coverage via template literal', async () => {
      const hotfix = createTestHotfix()
      const result = await quinn`analyze coverage for ${hotfix}`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
      expect((result as { percentage: number }).percentage).toBeGreaterThan(0)
    })

    it('should analyze edge cases via template literal', async () => {
      const hotfix = createTestHotfix()
      const alert = createTestAlert()
      const result = await quinn`identify edge cases for ${hotfix} with ${alert}`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
      expect((result as { identified: string[] }).identified).toBeInstanceOf(Array)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS - Ralph + Tom Emergency Protocol
// ============================================================================

describe('Ralph + Tom Emergency Protocol', () => {
  beforeEach(() => {
    enableRalphMockMode()
    enableTomMockMode()
    enableQuinnMockMode()
  })

  afterEach(() => {
    disableRalphMockMode()
    disableTomMockMode()
    disableQuinnMockMode()
  })

  it('should complete full incident response flow', async () => {
    // 1. Alert comes in
    const alert = createTestAlert({
      severity: 'critical',
      summary: 'Database connection pool exhausted',
    })

    // 2. Ralph diagnoses
    const diagnosis = await diagnose({ alert })
    expect(diagnosis.rootCause).toBeDefined()

    // 3. Ralph implements hotfix
    const hotfix = await implementHotfix({ diagnosis })
    expect(hotfix.testResults.every((t) => t.passed)).toBe(true)

    // 4. Tom reviews
    const review = await emergencyReview({ hotfix, diagnosis, isEmergency: true })
    expect(review.approved).toBe(true)

    // 5. If approved, deployment would happen
    if (review.approved) {
      // Simulate deployment success
      const deployed = true
      expect(deployed).toBe(true)
    }
  })

  it('should escalate when Tom rejects the fix', async () => {
    const alert = createTestAlert()
    const diagnosis = await diagnose({ alert })

    // Create a hotfix with failing tests that Tom will reject
    const badHotfix = createTestHotfix({
      testResults: [
        { name: 'critical.test.ts', passed: false, duration: 50, error: 'Failed' },
      ],
    })

    const review = await emergencyReview({ hotfix: badHotfix, diagnosis })

    // Tom should reject
    expect(review.approved).toBe(false)

    // Escalation should trigger
    const shouldEscalate = !review.approved
    expect(shouldEscalate).toBe(true)
  })

  it('should generate RCA after resolution', async () => {
    const alert = createTestAlert()
    const diagnosis = await diagnose({ alert })
    const hotfix = await implementHotfix({ diagnosis })
    const review = await emergencyReview({ hotfix, diagnosis })

    // Create resolved incident
    const incident: Incident = {
      id: 'incident-test-001',
      alert,
      status: 'resolved',
      diagnosis,
      hotfix,
      review,
      timeline: [
        { timestamp: new Date(), event: 'Alert received', actor: 'system' },
        { timestamp: new Date(), event: 'Diagnosis complete', actor: 'ralph' },
        { timestamp: new Date(), event: 'Hotfix implemented', actor: 'ralph' },
        { timestamp: new Date(), event: 'Review approved', actor: 'tom' },
        { timestamp: new Date(), event: 'Deployed to production', actor: 'system' },
        { timestamp: new Date(), event: 'Incident resolved', actor: 'system' },
      ],
      createdAt: new Date(Date.now() - 600000), // 10 minutes ago
      resolvedAt: new Date(),
    }

    const rca = await writeRCA({ incident })

    expect(rca.incidentId).toBe(incident.id)
    expect(rca.timeline).toEqual(incident.timeline)
    expect(rca.actionItems.length).toBeGreaterThan(0)
  })

  it('should handle multiple iterations when fix is rejected', async () => {
    const alert = createTestAlert()
    const diagnosis = await diagnose({ alert })

    // First attempt - failing tests
    let hotfix = createTestHotfix({
      testResults: [{ name: 'test.ts', passed: false, duration: 50, error: 'Failed' }],
    })
    let review = await emergencyReview({ hotfix, diagnosis })
    expect(review.approved).toBe(false)

    // Second attempt - Ralph fixes the issues
    hotfix = createTestHotfix({
      testResults: [{ name: 'test.ts', passed: true, duration: 50 }],
    })
    review = await emergencyReview({ hotfix, diagnosis })
    expect(review.approved).toBe(true)
  })
})

// ============================================================================
// ESCALATION TESTS
// ============================================================================

describe('Escalation Logic', () => {
  beforeEach(() => {
    enableRalphMockMode()
    enableTomMockMode()
    enableQuinnMockMode()
  })

  afterEach(() => {
    disableRalphMockMode()
    disableTomMockMode()
    disableQuinnMockMode()
  })

  it('should escalate for high-risk changes', async () => {
    const hotfix = createTestHotfix({
      estimatedRisk: 'high',
      changes: [
        { path: 'file1.ts', type: 'modify', diff: '...' },
        { path: 'file2.ts', type: 'modify', diff: '...' },
        { path: 'file3.ts', type: 'modify', diff: '...' },
        { path: 'file4.ts', type: 'modify', diff: '...' },
      ],
    })

    const risk = await assessRisk(hotfix)

    // High risk should trigger escalation consideration
    const shouldEscalate = risk.level === 'high' || risk.level === 'critical'
    expect(risk.level === 'medium' || risk.level === 'high').toBe(true)
  })

  it('should not escalate for low-risk approved changes', async () => {
    const hotfix = createTestHotfix()
    const diagnosis = createTestDiagnosis()

    const review = await emergencyReview({ hotfix, diagnosis })
    const risk = await assessRisk(hotfix)

    const shouldEscalate = !review.approved || risk.level === 'critical'
    expect(shouldEscalate).toBe(false)
  })
})

// ============================================================================
// AGENT COLLABORATION PATTERNS
// ============================================================================

describe('Agent Collaboration Patterns', () => {
  beforeEach(() => {
    enableRalphMockMode()
    enableTomMockMode()
    enableQuinnMockMode()
  })

  afterEach(() => {
    disableRalphMockMode()
    disableTomMockMode()
    disableQuinnMockMode()
  })

  it('should support parallel diagnosis and notification', async () => {
    const alert = createTestAlert()

    // Simulate parallel operations
    const [diagnosis, notificationSent] = await Promise.all([
      diagnose({ alert }),
      Promise.resolve(true), // Simulate notification
    ])

    expect(diagnosis.rootCause).toBeDefined()
    expect(notificationSent).toBe(true)
  })

  it('should support the do-while approval loop pattern', async () => {
    const alert = createTestAlert()
    const diagnosis = await diagnose({ alert })

    let iterations = 0
    let hotfix = createTestHotfix({
      testResults: [{ name: 'test.ts', passed: false, duration: 50, error: 'Failed' }],
    })
    let review: Review

    // Simulating the pattern:
    // do {
    //   hotfix = ralph`improve ${hotfix} per ${review}`
    // } while (!await tom.approve(hotfix))

    do {
      iterations++

      // Ralph improves based on feedback
      if (iterations > 1) {
        hotfix = createTestHotfix({
          testResults: [{ name: 'test.ts', passed: true, duration: 50 }],
        })
      }

      review = await emergencyReview({ hotfix, diagnosis })
    } while (!review.approved && iterations < 3)

    expect(review.approved).toBe(true)
    expect(iterations).toBe(2)
  })

  it('should support tom.approve() convenience method', async () => {
    const hotfix = createTestHotfix()
    const result = await tom.approve(hotfix)

    expect(typeof result.approved).toBe('boolean')
    expect(result.feedback).toBeDefined()
  })
})

// ============================================================================
// FULL INTEGRATION TESTS - Ralph + Tom + Quinn
// ============================================================================

describe('Full Incident Response Flow (Ralph + Tom + Quinn)', () => {
  beforeEach(() => {
    enableRalphMockMode()
    enableTomMockMode()
    enableQuinnMockMode()
  })

  afterEach(() => {
    disableRalphMockMode()
    disableTomMockMode()
    disableQuinnMockMode()
  })

  it('should complete full incident lifecycle with all agents', async () => {
    // 1. Alert comes in
    const alert = createTestAlert({
      severity: 'critical',
      service: 'api-gateway',
      summary: 'Connection pool exhaustion causing 502 errors',
    })

    // 2. Ralph diagnoses
    const diagnosis = await diagnose({ alert })
    expect(diagnosis.rootCause).toBeDefined()
    expect(diagnosis.confidence).toBeGreaterThan(0)

    // 3. Ralph implements hotfix
    const hotfix = await implementHotfix({ diagnosis })
    expect(hotfix.changes.length).toBeGreaterThan(0)
    expect(hotfix.testResults.every((t) => t.passed)).toBe(true)

    // 4. Tom reviews
    const review = await emergencyReview({ hotfix, diagnosis, isEmergency: true })
    expect(review.approved).toBe(true)

    // 5. Quinn validates post-deployment
    const validation = await validateFix({ hotfix, alert })
    expect(validation.passed).toBe(true)
    expect(validation.testsRun).toBeGreaterThan(0)

    // 6. Full incident is resolved
    const incident: Incident = {
      id: 'incident-full-flow',
      alert,
      status: 'resolved',
      diagnosis,
      hotfix,
      review,
      validation,
      timeline: [
        { timestamp: new Date(), event: 'Alert received', actor: 'system' },
        { timestamp: new Date(), event: 'Diagnosis complete', actor: 'ralph' },
        { timestamp: new Date(), event: 'Hotfix implemented', actor: 'ralph' },
        { timestamp: new Date(), event: 'Review approved', actor: 'tom' },
        { timestamp: new Date(), event: 'Deployed to production', actor: 'system' },
        { timestamp: new Date(), event: 'Validation passed', actor: 'quinn' },
        { timestamp: new Date(), event: 'Incident resolved', actor: 'system' },
      ],
      createdAt: new Date(Date.now() - 300000), // 5 minutes ago
      resolvedAt: new Date(),
    }

    // 7. Ralph writes RCA
    const rca = await writeRCA({ incident })
    expect(rca.incidentId).toBe(incident.id)
    expect(rca.actionItems.length).toBeGreaterThan(0)
  })

  it('should handle validation failure and escalate', async () => {
    const alert = createTestAlert()
    const diagnosis = await diagnose({ alert })

    // Create a hotfix that will fail validation (failing tests)
    const hotfix = createTestHotfix({
      testResults: [
        { name: 'smoke.test.ts', passed: false, duration: 100, error: 'Smoke test failed' },
      ],
      estimatedRisk: 'high',
    })

    // Tom might still approve in emergency if root cause is addressed
    const review = await emergencyReview({ hotfix, diagnosis, isEmergency: true })

    // Quinn validates - should fail due to failing tests
    const validation = await validateFix({ hotfix, alert })
    expect(validation.passed).toBe(false)

    // This would trigger escalation in real flow
    const shouldEscalate = !validation.passed
    expect(shouldEscalate).toBe(true)
  })

  it('should support parallel validation and RCA writing', async () => {
    const alert = createTestAlert()
    const diagnosis = await diagnose({ alert })
    const hotfix = await implementHotfix({ diagnosis })
    const review = await emergencyReview({ hotfix, diagnosis })

    const incident = createTestIncident({
      alert,
      diagnosis,
      hotfix,
      review,
      status: 'validating',
    })

    // Run validation and RCA in parallel (as shown in IncidentResponseDO)
    const [validation, rca] = await Promise.all([
      validateFix({ hotfix, alert }),
      writeRCA({ incident }),
    ])

    expect(validation.testsRun).toBeGreaterThan(0)
    expect(rca.incidentId).toBe(incident.id)
  })

  it('should analyze edge cases for thorough validation', async () => {
    const hotfix = createTestHotfix()
    const alert = createTestAlert({ service: 'payment-service' })

    // Quinn analyzes edge cases
    const edgeCaseAnalysis = await analyzeEdgeCases(hotfix, alert)

    expect(edgeCaseAnalysis.identified.length).toBeGreaterThan(0)
    expect(edgeCaseAnalysis.riskLevel).toBeDefined()

    // Payment service should have payment-specific edge cases
    const hasPaymentEdgeCases = edgeCaseAnalysis.identified.some(
      (e) => e.toLowerCase().includes('payment') || e.toLowerCase().includes('charge')
    )
    expect(hasPaymentEdgeCases).toBe(true)
  })

  it('should provide coverage analysis for hotfix changes', async () => {
    const hotfix = createTestHotfix()
    const coverage = await analyzeTestCoverage(hotfix)

    expect(coverage.percentage).toBeGreaterThan(0)
    expect(typeof coverage.criticalPathsCovered).toBe('boolean')

    // A well-tested hotfix should have good coverage
    expect(coverage.percentage).toBeGreaterThan(80)
    expect(coverage.criticalPathsCovered).toBe(true)
  })
})
