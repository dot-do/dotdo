/**
 * @dotdo/salesforce - Workflow and Process Builder Tests
 *
 * Tests for Salesforce Workflow Rules and Process Builder compatibility including:
 * - Workflow Rules (field updates, email alerts, tasks, outbound messages)
 * - Process Builder (multi-step processes with branching)
 * - Criteria evaluation
 * - Action execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  WorkflowRule,
  ProcessBuilder,
  WorkflowEngine,
  CriteriaEvaluator,
  type RecordContext,
  type WorkflowRuleConfig,
  type ProcessBuilderConfig,
  type WorkflowAction,
  type FieldUpdateAction,
  type EmailAlertAction,
  type CreateTaskAction,
  type RuleCriterion,
  type RuleCriteria,
} from '../index'
import type { SObject } from '../types'

// =============================================================================
// Test Helpers
// =============================================================================

function mockAccount(overrides: Partial<SObject> = {}): SObject {
  return {
    Id: '001xx000003DGxYAAW',
    Name: 'Acme Inc',
    Industry: 'Technology',
    AnnualRevenue: 5000000,
    Rating: 'Warm',
    Type: 'Customer',
    Website: 'https://acme.com',
    NumberOfEmployees: 500,
    attributes: { type: 'Account', url: '/services/data/v59.0/sobjects/Account/001xx000003DGxYAAW' },
    ...overrides,
  }
}

function mockLead(overrides: Partial<SObject> = {}): SObject {
  return {
    Id: '00Qxx000001abcdEAA',
    FirstName: 'John',
    LastName: 'Doe',
    Company: 'Acme Inc',
    Status: 'New',
    Email: 'john@acme.com',
    LeadSource: 'Web',
    IsQualified__c: false,
    attributes: { type: 'Lead', url: '/services/data/v59.0/sobjects/Lead/00Qxx000001abcdEAA' },
    ...overrides,
  }
}

function mockOpportunity(overrides: Partial<SObject> = {}): SObject {
  return {
    Id: '006xx000001Sv6tAAC',
    Name: 'Acme - Enterprise Deal',
    StageName: 'Prospecting',
    Amount: 100000,
    CloseDate: '2024-12-31',
    Probability: 20,
    AccountId: '001xx000003DGxYAAW',
    attributes: { type: 'Opportunity', url: '/services/data/v59.0/sobjects/Opportunity/006xx000001Sv6tAAC' },
    ...overrides,
  }
}

function createContext(
  newRecord: SObject,
  operation: 'create' | 'update' | 'delete',
  oldRecord?: SObject
): RecordContext {
  return {
    newRecord,
    oldRecord,
    operation,
    timestamp: new Date().toISOString(),
  }
}

// =============================================================================
// CriteriaEvaluator Tests
// =============================================================================

describe('@dotdo/salesforce - CriteriaEvaluator', () => {
  let evaluator: CriteriaEvaluator

  beforeEach(() => {
    evaluator = new CriteriaEvaluator()
  })

  describe('evaluateCriterion', () => {
    it('should evaluate equals operator', () => {
      const context = createContext(mockAccount(), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'Industry', operator: 'equals', value: 'Technology' },
          context
        )
      ).toBe(true)

      expect(
        evaluator.evaluateCriterion(
          { field: 'Industry', operator: 'equals', value: 'Finance' },
          context
        )
      ).toBe(false)
    })

    it('should evaluate notEquals operator', () => {
      const context = createContext(mockAccount(), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'Industry', operator: 'notEquals', value: 'Finance' },
          context
        )
      ).toBe(true)

      expect(
        evaluator.evaluateCriterion(
          { field: 'Industry', operator: 'notEquals', value: 'Technology' },
          context
        )
      ).toBe(false)
    })

    it('should evaluate greaterThan operator', () => {
      const context = createContext(mockAccount({ AnnualRevenue: 1000000 }), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'AnnualRevenue', operator: 'greaterThan', value: 500000 },
          context
        )
      ).toBe(true)

      expect(
        evaluator.evaluateCriterion(
          { field: 'AnnualRevenue', operator: 'greaterThan', value: 2000000 },
          context
        )
      ).toBe(false)
    })

    it('should evaluate greaterOrEqual operator', () => {
      const context = createContext(mockAccount({ AnnualRevenue: 1000000 }), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'AnnualRevenue', operator: 'greaterOrEqual', value: 1000000 },
          context
        )
      ).toBe(true)

      expect(
        evaluator.evaluateCriterion(
          { field: 'AnnualRevenue', operator: 'greaterOrEqual', value: 1000001 },
          context
        )
      ).toBe(false)
    })

    it('should evaluate lessThan operator', () => {
      const context = createContext(mockAccount({ NumberOfEmployees: 100 }), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'NumberOfEmployees', operator: 'lessThan', value: 500 },
          context
        )
      ).toBe(true)
    })

    it('should evaluate lessOrEqual operator', () => {
      const context = createContext(mockAccount({ NumberOfEmployees: 500 }), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'NumberOfEmployees', operator: 'lessOrEqual', value: 500 },
          context
        )
      ).toBe(true)
    })

    it('should evaluate contains operator for strings', () => {
      const context = createContext(mockAccount({ Name: 'Acme Corporation' }), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'Name', operator: 'contains', value: 'Corp' },
          context
        )
      ).toBe(true)

      expect(
        evaluator.evaluateCriterion(
          { field: 'Name', operator: 'contains', value: 'LLC' },
          context
        )
      ).toBe(false)
    })

    it('should evaluate notContains operator', () => {
      const context = createContext(mockAccount({ Name: 'Acme Corporation' }), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'Name', operator: 'notContains', value: 'LLC' },
          context
        )
      ).toBe(true)
    })

    it('should evaluate startsWith operator', () => {
      const context = createContext(mockAccount({ Name: 'Acme Corporation' }), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'Name', operator: 'startsWith', value: 'Acme' },
          context
        )
      ).toBe(true)

      expect(
        evaluator.evaluateCriterion(
          { field: 'Name', operator: 'startsWith', value: 'Corp' },
          context
        )
      ).toBe(false)
    })

    it('should evaluate isNull operator', () => {
      const context = createContext(mockAccount({ Description: null }), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'Description', operator: 'isNull' },
          context
        )
      ).toBe(true)

      expect(
        evaluator.evaluateCriterion(
          { field: 'Name', operator: 'isNull' },
          context
        )
      ).toBe(false)
    })

    it('should evaluate isNotNull operator', () => {
      const context = createContext(mockAccount(), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'Name', operator: 'isNotNull' },
          context
        )
      ).toBe(true)
    })

    it('should evaluate isBlank operator', () => {
      const context = createContext(mockAccount({ Website: '' }), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'Website', operator: 'isBlank' },
          context
        )
      ).toBe(true)
    })

    it('should evaluate isNotBlank operator', () => {
      const context = createContext(mockAccount({ Website: 'https://acme.com' }), 'create')

      expect(
        evaluator.evaluateCriterion(
          { field: 'Website', operator: 'isNotBlank' },
          context
        )
      ).toBe(true)
    })

    it('should evaluate isChanged operator', () => {
      const oldRecord = mockAccount({ Rating: 'Cold' })
      const newRecord = mockAccount({ Rating: 'Hot' })
      const context = createContext(newRecord, 'update', oldRecord)

      expect(
        evaluator.evaluateCriterion(
          { field: 'Rating', operator: 'isChanged' },
          context
        )
      ).toBe(true)

      expect(
        evaluator.evaluateCriterion(
          { field: 'Name', operator: 'isChanged' },
          context
        )
      ).toBe(false)
    })
  })

  describe('evaluateCriteria', () => {
    it('should evaluate single criterion', () => {
      const context = createContext(mockAccount(), 'create')

      const result = evaluator.evaluateCriteria(
        { field: 'Industry', operator: 'equals', value: 'Technology' },
        context
      )

      expect(result).toBe(true)
    })

    it('should evaluate AND logic', () => {
      const context = createContext(
        mockAccount({ Industry: 'Technology', AnnualRevenue: 5000000 }),
        'create'
      )

      const criteria: RuleCriteria = {
        logic: 'AND',
        conditions: [
          { field: 'Industry', operator: 'equals', value: 'Technology' },
          { field: 'AnnualRevenue', operator: 'greaterThan', value: 1000000 },
        ],
      }

      expect(evaluator.evaluateCriteria(criteria, context)).toBe(true)

      const failingCriteria: RuleCriteria = {
        logic: 'AND',
        conditions: [
          { field: 'Industry', operator: 'equals', value: 'Technology' },
          { field: 'AnnualRevenue', operator: 'greaterThan', value: 10000000 },
        ],
      }

      expect(evaluator.evaluateCriteria(failingCriteria, context)).toBe(false)
    })

    it('should evaluate OR logic', () => {
      const context = createContext(
        mockAccount({ Industry: 'Technology', AnnualRevenue: 500000 }),
        'create'
      )

      const criteria: RuleCriteria = {
        logic: 'OR',
        conditions: [
          { field: 'Industry', operator: 'equals', value: 'Technology' },
          { field: 'AnnualRevenue', operator: 'greaterThan', value: 1000000 },
        ],
      }

      expect(evaluator.evaluateCriteria(criteria, context)).toBe(true)
    })

    it('should evaluate custom logic', () => {
      const context = createContext(
        mockAccount({ Industry: 'Technology', AnnualRevenue: 5000000, Rating: 'Hot' }),
        'create'
      )

      const criteria: RuleCriteria = {
        logic: '(1 AND 2) OR 3',
        conditions: [
          { field: 'Industry', operator: 'equals', value: 'Technology' },
          { field: 'AnnualRevenue', operator: 'greaterThan', value: 1000000 },
          { field: 'Rating', operator: 'equals', value: 'Cold' }, // False
        ],
      }

      expect(evaluator.evaluateCriteria(criteria, context)).toBe(true)
    })
  })

  describe('matchesEvaluationCriteria', () => {
    it('should match created evaluation criteria', () => {
      const context = createContext(mockAccount(), 'create')
      expect(evaluator.matchesEvaluationCriteria('created', context)).toBe(true)

      const updateContext = createContext(mockAccount(), 'update')
      expect(evaluator.matchesEvaluationCriteria('created', updateContext)).toBe(false)
    })

    it('should match createdAndEveryEdit evaluation criteria', () => {
      const createContext_ = createContext(mockAccount(), 'create')
      expect(evaluator.matchesEvaluationCriteria('createdAndEveryEdit', createContext_)).toBe(true)

      const updateContext = createContext(mockAccount(), 'update')
      expect(evaluator.matchesEvaluationCriteria('createdAndEveryEdit', updateContext)).toBe(true)

      const deleteContext = createContext(mockAccount(), 'delete')
      expect(evaluator.matchesEvaluationCriteria('createdAndEveryEdit', deleteContext)).toBe(false)
    })

    it('should match createdAndAnyChange evaluation criteria', () => {
      const createContext_ = createContext(mockAccount(), 'create')
      expect(evaluator.matchesEvaluationCriteria('createdAndAnyChange', createContext_)).toBe(true)

      const updateContext = createContext(mockAccount(), 'update')
      expect(evaluator.matchesEvaluationCriteria('createdAndAnyChange', updateContext, false)).toBe(true)
      expect(evaluator.matchesEvaluationCriteria('createdAndAnyChange', updateContext, true)).toBe(false)
    })
  })
})

// =============================================================================
// WorkflowRule Tests
// =============================================================================

describe('@dotdo/salesforce - WorkflowRule', () => {
  describe('constructor', () => {
    it('should create a workflow rule with config', () => {
      const config: WorkflowRuleConfig = {
        name: 'High Value Account',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: {
          field: 'AnnualRevenue',
          operator: 'greaterThan',
          value: 1000000,
        },
        actions: [
          { type: 'fieldUpdate', field: 'Rating', value: 'Hot' },
        ],
      }

      const rule = new WorkflowRule(config)

      expect(rule.name).toBe('High Value Account')
      expect(rule.object).toBe('Account')
      expect(rule.evaluationCriteria).toBe('created')
      expect(rule.active).toBe(true)
      expect(rule.id).toBeDefined()
    })

    it('should allow custom ID', () => {
      const rule = new WorkflowRule({
        id: 'custom-rule-id',
        name: 'Test Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [],
      })

      expect(rule.id).toBe('custom-rule-id')
    })
  })

  describe('appliesTo', () => {
    it('should check object type case-insensitively', () => {
      const rule = new WorkflowRule({
        name: 'Test Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [],
      })

      expect(rule.appliesTo('Account')).toBe(true)
      expect(rule.appliesTo('account')).toBe(true)
      expect(rule.appliesTo('ACCOUNT')).toBe(true)
      expect(rule.appliesTo('Contact')).toBe(false)
    })
  })

  describe('evaluate', () => {
    it('should evaluate rule criteria on create', () => {
      const rule = new WorkflowRule({
        name: 'High Value Account',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: {
          field: 'AnnualRevenue',
          operator: 'greaterThan',
          value: 1000000,
        },
        actions: [],
      })

      const highValueContext = createContext(
        mockAccount({ AnnualRevenue: 5000000 }),
        'create'
      )
      expect(rule.evaluate(highValueContext)).toBe(true)

      const lowValueContext = createContext(
        mockAccount({ AnnualRevenue: 500000 }),
        'create'
      )
      expect(rule.evaluate(lowValueContext)).toBe(false)
    })

    it('should not match on update when criteria is created', () => {
      const rule = new WorkflowRule({
        name: 'High Value Account',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: {
          field: 'AnnualRevenue',
          operator: 'greaterThan',
          value: 1000000,
        },
        actions: [],
      })

      const updateContext = createContext(
        mockAccount({ AnnualRevenue: 5000000 }),
        'update'
      )
      expect(rule.evaluate(updateContext)).toBe(false)
    })

    it('should match on update when criteria is createdAndEveryEdit', () => {
      const rule = new WorkflowRule({
        name: 'High Value Account',
        object: 'Account',
        evaluationCriteria: 'createdAndEveryEdit',
        ruleCriteria: {
          field: 'AnnualRevenue',
          operator: 'greaterThan',
          value: 1000000,
        },
        actions: [],
      })

      const updateContext = createContext(
        mockAccount({ AnnualRevenue: 5000000 }),
        'update'
      )
      expect(rule.evaluate(updateContext)).toBe(true)
    })

    it('should not evaluate when inactive', () => {
      const rule = new WorkflowRule({
        name: 'High Value Account',
        object: 'Account',
        active: false,
        evaluationCriteria: 'created',
        ruleCriteria: {
          field: 'AnnualRevenue',
          operator: 'greaterThan',
          value: 1000000,
        },
        actions: [],
      })

      const context = createContext(mockAccount({ AnnualRevenue: 5000000 }), 'create')
      expect(rule.evaluate(context)).toBe(false)
    })

    it('should evaluate combined criteria', () => {
      const rule = new WorkflowRule({
        name: 'Enterprise Tech Account',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: {
          logic: 'AND',
          conditions: [
            { field: 'Industry', operator: 'equals', value: 'Technology' },
            { field: 'AnnualRevenue', operator: 'greaterThan', value: 1000000 },
            { field: 'NumberOfEmployees', operator: 'greaterThan', value: 100 },
          ],
        },
        actions: [],
      })

      const matchingContext = createContext(
        mockAccount({ Industry: 'Technology', AnnualRevenue: 5000000, NumberOfEmployees: 500 }),
        'create'
      )
      expect(rule.evaluate(matchingContext)).toBe(true)

      const nonMatchingContext = createContext(
        mockAccount({ Industry: 'Technology', AnnualRevenue: 5000000, NumberOfEmployees: 50 }),
        'create'
      )
      expect(rule.evaluate(nonMatchingContext)).toBe(false)
    })
  })

  describe('getImmediateActions / getTimeBasedActions', () => {
    it('should return immediate actions', () => {
      const rule = new WorkflowRule({
        name: 'Test Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [
          { type: 'fieldUpdate', field: 'Rating', value: 'Hot' },
          { type: 'emailAlert', templateId: 'template-123' },
        ],
      })

      const actions = rule.getImmediateActions()
      expect(actions).toHaveLength(2)
      expect(actions[0].type).toBe('fieldUpdate')
      expect(actions[1].type).toBe('emailAlert')
    })

    it('should return time-based actions', () => {
      const rule = new WorkflowRule({
        name: 'Test Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [],
        timeBasedActions: [
          {
            action: { type: 'emailAlert', templateId: 'followup-template' },
            trigger: { type: 'after', value: 7, unit: 'days', field: 'CreatedDate' },
          },
        ],
      })

      const timeBasedActions = rule.getTimeBasedActions()
      expect(timeBasedActions).toHaveLength(1)
      expect(timeBasedActions[0].trigger.value).toBe(7)
    })
  })

  describe('clone', () => {
    it('should clone rule with new ID', () => {
      const original = new WorkflowRule({
        id: 'original-id',
        name: 'Original Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [{ type: 'fieldUpdate', field: 'Rating', value: 'Hot' }],
      })

      const cloned = original.clone()

      expect(cloned.id).not.toBe(original.id)
      expect(cloned.name).toBe(original.name)
      expect(cloned.actions).toEqual(original.actions)
    })

    it('should allow overrides when cloning', () => {
      const original = new WorkflowRule({
        name: 'Original Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [],
      })

      const cloned = original.clone({ name: 'Cloned Rule', active: false })

      expect(cloned.name).toBe('Cloned Rule')
      expect(cloned.active).toBe(false)
    })
  })

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const rule = new WorkflowRule({
        id: 'rule-123',
        name: 'Test Rule',
        description: 'A test rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [{ type: 'fieldUpdate', field: 'Rating', value: 'Hot' }],
      })

      const json = rule.toJSON()

      expect(json.id).toBe('rule-123')
      expect(json.name).toBe('Test Rule')
      expect(json.description).toBe('A test rule')
      expect(json.actions).toHaveLength(1)
    })
  })
})

// =============================================================================
// ProcessBuilder Tests
// =============================================================================

describe('@dotdo/salesforce - ProcessBuilder', () => {
  describe('constructor', () => {
    it('should create a process builder with config', () => {
      const config: ProcessBuilderConfig = {
        name: 'Lead Qualification',
        object: 'Lead',
        trigger: 'onCreateOrUpdate',
        nodes: [
          {
            id: 'check_status',
            type: 'criteria',
            criteria: { field: 'Status', operator: 'equals', value: 'Working' },
            trueOutcome: 'update_lead',
            falseOutcome: 'end',
          },
          {
            id: 'update_lead',
            type: 'action',
            actions: [{ type: 'fieldUpdate', field: 'IsQualified__c', value: true }],
          },
        ],
        startNode: 'check_status',
      }

      const process = new ProcessBuilder(config)

      expect(process.name).toBe('Lead Qualification')
      expect(process.object).toBe('Lead')
      expect(process.trigger).toBe('onCreateOrUpdate')
      expect(process.active).toBe(true)
      expect(process.getNode('check_status')).toBeDefined()
      expect(process.getNode('update_lead')).toBeDefined()
    })
  })

  describe('appliesTo', () => {
    it('should check object type case-insensitively', () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [],
        startNode: '',
      })

      expect(process.appliesTo('Lead')).toBe(true)
      expect(process.appliesTo('lead')).toBe(true)
      expect(process.appliesTo('LEAD')).toBe(true)
      expect(process.appliesTo('Account')).toBe(false)
    })
  })

  describe('matchesTrigger', () => {
    it('should match onCreate trigger', () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [],
        startNode: '',
      })

      const createContext_ = createContext(mockLead(), 'create')
      expect(process.matchesTrigger(createContext_)).toBe(true)

      const updateContext = createContext(mockLead(), 'update')
      expect(process.matchesTrigger(updateContext)).toBe(false)
    })

    it('should match onCreateOrUpdate trigger', () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        trigger: 'onCreateOrUpdate',
        nodes: [],
        startNode: '',
      })

      const createContext_ = createContext(mockLead(), 'create')
      expect(process.matchesTrigger(createContext_)).toBe(true)

      const updateContext = createContext(mockLead(), 'update')
      expect(process.matchesTrigger(updateContext)).toBe(true)

      const deleteContext = createContext(mockLead(), 'delete')
      expect(process.matchesTrigger(deleteContext)).toBe(false)
    })

    it('should not match when inactive', () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        active: false,
        trigger: 'onCreate',
        nodes: [],
        startNode: '',
      })

      const createContext_ = createContext(mockLead(), 'create')
      expect(process.matchesTrigger(createContext_)).toBe(false)
    })
  })

  describe('getNode / getStartNode', () => {
    it('should return nodes by ID', () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [
          { id: 'node1', type: 'criteria' },
          { id: 'node2', type: 'action' },
        ],
        startNode: 'node1',
      })

      expect(process.getNode('node1')?.id).toBe('node1')
      expect(process.getNode('node2')?.id).toBe('node2')
      expect(process.getNode('nonexistent')).toBeUndefined()
    })

    it('should return start node', () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [
          { id: 'start', type: 'criteria' },
          { id: 'action', type: 'action' },
        ],
        startNode: 'start',
      })

      expect(process.getStartNode()?.id).toBe('start')
    })
  })

  describe('evaluateCriteriaNode', () => {
    it('should evaluate criteria node', () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [
          {
            id: 'check',
            type: 'criteria',
            criteria: { field: 'Status', operator: 'equals', value: 'Working' },
          },
        ],
        startNode: 'check',
      })

      const node = process.getNode('check')!

      const matchingContext = createContext(mockLead({ Status: 'Working' }), 'create')
      expect(process.evaluateCriteriaNode(node, matchingContext)).toBe(true)

      const nonMatchingContext = createContext(mockLead({ Status: 'New' }), 'create')
      expect(process.evaluateCriteriaNode(node, nonMatchingContext)).toBe(false)
    })
  })

  describe('getNextNodeId', () => {
    it('should return correct next node for criteria', () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [
          {
            id: 'check',
            type: 'criteria',
            trueOutcome: 'action',
            falseOutcome: 'end',
          },
          { id: 'action', type: 'action' },
        ],
        startNode: 'check',
      })

      const node = process.getNode('check')!

      expect(process.getNextNodeId(node, true)).toBe('action')
      expect(process.getNextNodeId(node, false)).toBe(null)
    })

    it('should return correct next node for action', () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [
          { id: 'action1', type: 'action', nextNode: 'action2' },
          { id: 'action2', type: 'action', nextNode: 'end' },
        ],
        startNode: 'action1',
      })

      const node1 = process.getNode('action1')!
      expect(process.getNextNodeId(node1, true)).toBe('action2')

      const node2 = process.getNode('action2')!
      expect(process.getNextNodeId(node2, true)).toBe(null)
    })
  })
})

// =============================================================================
// WorkflowEngine Tests
// =============================================================================

describe('@dotdo/salesforce - WorkflowEngine', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    engine = new WorkflowEngine()
  })

  describe('registerRule / unregisterRule', () => {
    it('should register and unregister rules', () => {
      const rule = new WorkflowRule({
        name: 'Test Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [],
      })

      engine.registerRule(rule)
      expect(engine.getRule(rule.id)).toBe(rule)
      expect(engine.listRules('Account')).toHaveLength(1)

      engine.unregisterRule(rule.id)
      expect(engine.getRule(rule.id)).toBeUndefined()
      expect(engine.listRules('Account')).toHaveLength(0)
    })
  })

  describe('registerProcess / unregisterProcess', () => {
    it('should register and unregister processes', () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [],
        startNode: '',
      })

      engine.registerProcess(process)
      expect(engine.getProcess(process.id)).toBe(process)
      expect(engine.listProcesses('Lead')).toHaveLength(1)

      engine.unregisterProcess(process.id)
      expect(engine.getProcess(process.id)).toBeUndefined()
      expect(engine.listProcesses('Lead')).toHaveLength(0)
    })
  })

  describe('listRules / listProcesses', () => {
    it('should list all rules when no object specified', () => {
      engine.registerRule(new WorkflowRule({
        name: 'Account Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [],
      }))

      engine.registerRule(new WorkflowRule({
        name: 'Lead Rule',
        object: 'Lead',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [],
      }))

      expect(engine.listRules()).toHaveLength(2)
      expect(engine.listRules('Account')).toHaveLength(1)
      expect(engine.listRules('Lead')).toHaveLength(1)
      expect(engine.listRules('Contact')).toHaveLength(0)
    })
  })

  describe('executeAction', () => {
    it('should execute field update action', async () => {
      const account = mockAccount({ Rating: 'Warm' })
      const context = createContext(account, 'create')

      const action: FieldUpdateAction = {
        type: 'fieldUpdate',
        field: 'Rating',
        value: 'Hot',
      }

      const result = await engine.executeAction(action, context)

      expect(result.success).toBe(true)
      expect(result.actionType).toBe('fieldUpdate')
      expect(result.output).toEqual({ field: 'Rating', value: 'Hot' })
      expect(account.Rating).toBe('Hot')
    })

    it('should execute email alert action', async () => {
      const account = mockAccount()
      const context = createContext(account, 'create')

      const action: EmailAlertAction = {
        type: 'emailAlert',
        templateId: 'template-123',
        recipients: [{ type: 'owner' }],
      }

      const result = await engine.executeAction(action, context)

      expect(result.success).toBe(true)
      expect(result.actionType).toBe('emailAlert')
      expect(result.output).toMatchObject({
        templateId: 'template-123',
        recordId: account.Id,
      })
    })

    it('should execute create task action', async () => {
      const account = mockAccount()
      const context = createContext(account, 'create')

      const action: CreateTaskAction = {
        type: 'createTask',
        subject: 'Follow up on new account',
        priority: 'High',
        dueDate: { type: 'relative', days: 7 },
      }

      const result = await engine.executeAction(action, context)

      expect(result.success).toBe(true)
      expect(result.actionType).toBe('createTask')
      expect(result.output).toMatchObject({
        task: expect.objectContaining({
          Subject: 'Follow up on new account',
          Priority: 'High',
        }),
      })
    })

    it('should execute outbound message action', async () => {
      const account = mockAccount()
      const context = createContext(account, 'create')

      const action: WorkflowAction = {
        type: 'outboundMessage',
        endpointUrl: 'https://example.com/webhook',
        fields: ['Id', 'Name', 'Industry'],
      }

      const result = await engine.executeAction(action, context)

      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        endpointUrl: 'https://example.com/webhook',
        payload: expect.objectContaining({
          Id: account.Id,
          Name: 'Acme Inc',
          Industry: 'Technology',
        }),
      })
    })

    it('should execute create record action', async () => {
      const account = mockAccount()
      const context = createContext(account, 'create')

      const action: WorkflowAction = {
        type: 'createRecord',
        objectType: 'Task',
        recordValues: {
          Subject: 'Welcome call',
          Status: 'Not Started',
        },
        useFieldReference: {
          WhatId: 'Id',
        },
      }

      const result = await engine.executeAction(action, context)

      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        objectType: 'Task',
        record: expect.objectContaining({
          Subject: 'Welcome call',
          WhatId: account.Id,
        }),
      })
    })

    it('should execute post to chatter action', async () => {
      const account = mockAccount()
      const context = createContext(account, 'create')

      const action: WorkflowAction = {
        type: 'post',
        postType: 'record',
        message: 'New high-value account created!',
      }

      const result = await engine.executeAction(action, context)

      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        postType: 'record',
        targetId: account.Id,
        message: 'New high-value account created!',
      })
    })
  })

  describe('evaluateRules', () => {
    it('should evaluate and execute matching rules', async () => {
      const rule = new WorkflowRule({
        name: 'High Value Account',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: {
          field: 'AnnualRevenue',
          operator: 'greaterThan',
          value: 1000000,
        },
        actions: [
          { type: 'fieldUpdate', field: 'Rating', value: 'Hot' },
        ],
      })

      engine.registerRule(rule)

      const account = mockAccount({ AnnualRevenue: 5000000, Rating: 'Warm' })
      const context = createContext(account, 'create')

      const results = await engine.evaluateRules('Account', context)

      expect(results).toHaveLength(1)
      expect(results[0].matched).toBe(true)
      expect(results[0].actionsExecuted).toHaveLength(1)
      expect(results[0].actionsExecuted[0].success).toBe(true)
      expect(account.Rating).toBe('Hot')
    })

    it('should not execute actions for non-matching rules', async () => {
      const rule = new WorkflowRule({
        name: 'High Value Account',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: {
          field: 'AnnualRevenue',
          operator: 'greaterThan',
          value: 10000000,
        },
        actions: [
          { type: 'fieldUpdate', field: 'Rating', value: 'Hot' },
        ],
      })

      engine.registerRule(rule)

      const account = mockAccount({ AnnualRevenue: 5000000, Rating: 'Warm' })
      const context = createContext(account, 'create')

      const results = await engine.evaluateRules('Account', context)

      expect(results).toHaveLength(1)
      expect(results[0].matched).toBe(false)
      expect(results[0].actionsExecuted).toHaveLength(0)
      expect(account.Rating).toBe('Warm')
    })

    it('should execute multiple rules in order', async () => {
      engine.registerRule(new WorkflowRule({
        name: 'Rule 1',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [{ type: 'fieldUpdate', field: 'Type', value: 'Customer' }],
      }))

      engine.registerRule(new WorkflowRule({
        name: 'Rule 2',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: {
          field: 'AnnualRevenue',
          operator: 'greaterThan',
          value: 1000000,
        },
        actions: [{ type: 'fieldUpdate', field: 'Rating', value: 'Hot' }],
      }))

      const account = mockAccount({ AnnualRevenue: 5000000 })
      const context = createContext(account, 'create')

      const results = await engine.evaluateRules('Account', context)

      expect(results).toHaveLength(2)
      expect(results[0].matched).toBe(true)
      expect(results[1].matched).toBe(true)
      expect(account.Type).toBe('Customer')
      expect(account.Rating).toBe('Hot')
    })
  })

  describe('executeProcess', () => {
    it('should execute process with single action', async () => {
      const process = new ProcessBuilder({
        name: 'Simple Process',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [
          {
            id: 'action',
            type: 'action',
            actions: [{ type: 'fieldUpdate', field: 'Status', value: 'Qualified' }],
          },
        ],
        startNode: 'action',
      })

      const lead = mockLead()
      const context = createContext(lead, 'create')

      const result = await engine.executeProcess(process, context)

      expect(result.executed).toBe(true)
      expect(result.nodesVisited).toContain('action')
      expect(result.actionsExecuted).toHaveLength(1)
      expect(lead.Status).toBe('Qualified')
    })

    it('should execute process with criteria branching', async () => {
      const process = new ProcessBuilder({
        name: 'Lead Qualification',
        object: 'Lead',
        trigger: 'onCreateOrUpdate',
        nodes: [
          {
            id: 'check_source',
            type: 'criteria',
            criteria: { field: 'LeadSource', operator: 'equals', value: 'Web' },
            trueOutcome: 'qualify',
            falseOutcome: 'skip',
          },
          {
            id: 'qualify',
            type: 'action',
            actions: [{ type: 'fieldUpdate', field: 'IsQualified__c', value: true }],
            nextNode: 'end',
          },
          {
            id: 'skip',
            type: 'action',
            actions: [{ type: 'fieldUpdate', field: 'IsQualified__c', value: false }],
          },
        ],
        startNode: 'check_source',
      })

      // Test Web source
      const webLead = mockLead({ LeadSource: 'Web' })
      const webContext = createContext(webLead, 'create')

      const webResult = await engine.executeProcess(process, webContext)

      expect(webResult.executed).toBe(true)
      expect(webResult.nodesVisited).toContain('check_source')
      expect(webResult.nodesVisited).toContain('qualify')
      expect(webLead.IsQualified__c).toBe(true)

      // Test other source
      const otherLead = mockLead({ LeadSource: 'Trade Show' })
      const otherContext = createContext(otherLead, 'create')

      const otherResult = await engine.executeProcess(process, otherContext)

      expect(otherResult.nodesVisited).toContain('skip')
      expect(otherLead.IsQualified__c).toBe(false)
    })

    it('should not execute when trigger does not match', async () => {
      const process = new ProcessBuilder({
        name: 'Test Process',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [
          {
            id: 'action',
            type: 'action',
            actions: [{ type: 'fieldUpdate', field: 'Status', value: 'Qualified' }],
          },
        ],
        startNode: 'action',
      })

      const lead = mockLead()
      const context = createContext(lead, 'update')

      const result = await engine.executeProcess(process, context)

      expect(result.executed).toBe(false)
      expect(result.nodesVisited).toHaveLength(0)
    })
  })

  describe('evaluate', () => {
    it('should evaluate both rules and processes', async () => {
      // Register a rule
      engine.registerRule(new WorkflowRule({
        name: 'Account Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [{ type: 'fieldUpdate', field: 'Type', value: 'Customer' }],
      }))

      // Register a process
      engine.registerProcess(new ProcessBuilder({
        name: 'Account Process',
        object: 'Account',
        trigger: 'onCreate',
        nodes: [
          {
            id: 'action',
            type: 'action',
            actions: [{ type: 'fieldUpdate', field: 'Rating', value: 'Warm' }],
          },
        ],
        startNode: 'action',
      }))

      const account = mockAccount()
      const results = await engine.evaluate('Account', account, 'create')

      expect(results.ruleResults).toHaveLength(1)
      expect(results.ruleResults[0].matched).toBe(true)
      expect(results.processResults).toHaveLength(1)
      expect(results.processResults[0].executed).toBe(true)
      expect(account.Type).toBe('Customer')
      expect(account.Rating).toBe('Warm')
    })
  })

  describe('registerActionHandler', () => {
    it('should allow custom action handlers', async () => {
      const customHandler = vi.fn().mockResolvedValue({
        actionType: 'custom' as any,
        success: true,
        output: { customResult: true },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 10,
      })

      engine.registerActionHandler('apex' as any, customHandler)

      const context = createContext(mockAccount(), 'create')
      const action: WorkflowAction = {
        type: 'apex',
        className: 'MyApexClass',
        methodName: 'execute',
      }

      const result = await engine.executeAction(action, context)

      expect(customHandler).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })
  })

  describe('invokeProcess', () => {
    it('should invoke process directly', async () => {
      const process = new ProcessBuilder({
        id: 'invocable-process',
        name: 'Invocable Process',
        object: 'Lead',
        trigger: 'onInvoke',
        nodes: [
          {
            id: 'action',
            type: 'action',
            actions: [{ type: 'fieldUpdate', field: 'Status', value: 'Processed' }],
          },
        ],
        startNode: 'action',
      })

      engine.registerProcess(process)

      const result = await engine.invokeProcess('invocable-process', {
        Id: 'test-id',
        Status: 'New',
      })

      expect(result.executed).toBe(true)
      expect(result.actionsExecuted).toHaveLength(1)
    })

    it('should throw error for non-existent process', async () => {
      await expect(
        engine.invokeProcess('non-existent', {})
      ).rejects.toThrow('Process not found')
    })
  })

  describe('time-based actions', () => {
    it('should handle time-based actions with callback', async () => {
      const scheduledActionCallback = vi.fn()

      const engineWithCallback = new WorkflowEngine({
        onScheduledAction: scheduledActionCallback,
      })

      const rule = new WorkflowRule({
        name: 'Follow-up Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [],
        timeBasedActions: [
          {
            action: { type: 'emailAlert', templateId: 'follow-up' },
            trigger: { type: 'after', value: 7, unit: 'days', field: 'CreatedDate' },
          },
        ],
      })

      engineWithCallback.registerRule(rule)

      const account = mockAccount({ CreatedDate: new Date().toISOString() })
      const context = createContext(account, 'create')

      await engineWithCallback.evaluateRules('Account', context)

      expect(scheduledActionCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({ type: 'emailAlert' }),
          trigger: expect.objectContaining({ value: 7 }),
        }),
        expect.any(Date),
        expect.any(Object)
      )
    })

    it('should execute time-based actions immediately when configured', async () => {
      const engineImmediate = new WorkflowEngine({
        executeTimeBasedImmediately: true,
      })

      const rule = new WorkflowRule({
        name: 'Follow-up Rule',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [],
        timeBasedActions: [
          {
            action: { type: 'fieldUpdate', field: 'FollowUpSent__c', value: true },
            trigger: { type: 'after', value: 7, unit: 'days', field: 'CreatedDate' },
          },
        ],
      })

      engineImmediate.registerRule(rule)

      const account = mockAccount()
      const context = createContext(account, 'create')

      const results = await engineImmediate.evaluateRules('Account', context)

      expect(results[0].actionsExecuted).toHaveLength(1)
      expect(results[0].actionsExecuted[0].actionType).toBe('fieldUpdate')
    })
  })

  describe('clear', () => {
    it('should clear all rules and processes', () => {
      engine.registerRule(new WorkflowRule({
        name: 'Rule 1',
        object: 'Account',
        evaluationCriteria: 'created',
        ruleCriteria: { field: 'Name', operator: 'isNotNull' },
        actions: [],
      }))

      engine.registerProcess(new ProcessBuilder({
        name: 'Process 1',
        object: 'Lead',
        trigger: 'onCreate',
        nodes: [],
        startNode: '',
      }))

      expect(engine.listRules()).toHaveLength(1)
      expect(engine.listProcesses()).toHaveLength(1)

      engine.clear()

      expect(engine.listRules()).toHaveLength(0)
      expect(engine.listProcesses()).toHaveLength(0)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('@dotdo/salesforce - Workflow Integration', () => {
  it('should handle complex lead qualification workflow', async () => {
    const engine = new WorkflowEngine()

    // Register workflow rule for lead scoring
    engine.registerRule(new WorkflowRule({
      name: 'Lead Score Update',
      object: 'Lead',
      evaluationCriteria: 'createdAndEveryEdit',
      ruleCriteria: {
        logic: 'OR',
        conditions: [
          { field: 'Company', operator: 'isNotBlank' },
          { field: 'Email', operator: 'contains', value: '@enterprise.com' },
        ],
      },
      actions: [
        { type: 'fieldUpdate', field: 'Lead_Score__c', value: 50 },
      ],
    }))

    // Register process builder for qualification
    engine.registerProcess(new ProcessBuilder({
      name: 'Lead Qualification Process',
      object: 'Lead',
      trigger: 'onCreateOrUpdate',
      nodes: [
        {
          id: 'check_score',
          type: 'criteria',
          criteria: { field: 'Lead_Score__c', operator: 'greaterOrEqual', value: 50 },
          trueOutcome: 'qualify',
          falseOutcome: 'nurture',
        },
        {
          id: 'qualify',
          type: 'action',
          actions: [
            { type: 'fieldUpdate', field: 'Status', value: 'Qualified' },
            { type: 'createTask', subject: 'Contact qualified lead', priority: 'High' },
          ],
        },
        {
          id: 'nurture',
          type: 'action',
          actions: [
            { type: 'fieldUpdate', field: 'Status', value: 'Nurturing' },
          ],
        },
      ],
      startNode: 'check_score',
    }))

    // Test with enterprise lead
    const enterpriseLead = mockLead({
      Email: 'ceo@enterprise.com',
      Company: 'Enterprise Corp',
      Lead_Score__c: 0,
    })

    const results = await engine.evaluate('Lead', enterpriseLead, 'create')

    // Rule should have updated Lead_Score__c
    expect(results.ruleResults[0].matched).toBe(true)
    expect(enterpriseLead.Lead_Score__c).toBe(50)

    // Process should have qualified the lead
    expect(results.processResults[0].executed).toBe(true)
    expect(results.processResults[0].nodesVisited).toContain('qualify')
    expect(enterpriseLead.Status).toBe('Qualified')
  })

  it('should handle opportunity stage progression', async () => {
    const engine = new WorkflowEngine()

    engine.registerRule(new WorkflowRule({
      name: 'Close Won Update',
      object: 'Opportunity',
      evaluationCriteria: 'createdAndEveryEdit',
      ruleCriteria: { field: 'StageName', operator: 'equals', value: 'Closed Won' },
      actions: [
        { type: 'fieldUpdate', field: 'Probability', value: 100 },
        { type: 'post', postType: 'record', message: 'Deal closed! :tada:' },
      ],
    }))

    const opportunity = mockOpportunity({ StageName: 'Closed Won', Probability: 80 })
    const oldOpportunity = mockOpportunity({ StageName: 'Negotiation', Probability: 80 })

    const results = await engine.evaluate('Opportunity', opportunity, 'update', oldOpportunity)

    expect(results.ruleResults[0].matched).toBe(true)
    expect(opportunity.Probability).toBe(100)
    expect(results.ruleResults[0].actionsExecuted).toHaveLength(2)
  })
})
