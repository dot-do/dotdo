import { describe, it, expect } from 'vitest'
import { createWorkflowProxy, isPipelinePromise } from '../../workflows/pipeline-promise'

describe('ExpenseApprovalWorkflow Example', () => {
  it('uses $.waitFor for human approval', () => {
    const $ = createWorkflowProxy()

    const decision = $.waitFor('manager-approval', {
      timeout: '7 days',
      type: 'expense-decision',
    })

    expect(isPipelinePromise(decision)).toBe(true)
    expect(decision.__expr.type).toBe('waitFor')
    expect(decision.__expr.eventName).toBe('manager-approval')
    expect(decision.__expr.options.timeout).toBe('7 days')
  })

  it('uses $.when for conditional processing', () => {
    const $ = createWorkflowProxy()

    const validation = $.Expenses({ id: 'exp-1' }).validate()
    const result = $.when(validation.requiresApproval, {
      then: () => $.Slack({}).send({ message: 'Approval needed' }),
      else: () => $.Finance({}).autoReimburse(),
    })

    expect(isPipelinePromise(result)).toBe(true)
    expect(result.__expr.type).toBe('conditional')
  })

  it('uses $.branch for multi-way routing', () => {
    const $ = createWorkflowProxy()

    const expense = { id: 'exp-1', submitterId: 'user-1' }
    const level = $.Expenses(expense).getApprovalLevel()

    const result = $.branch(level, {
      manager: () => $.Manager({}).approve(),
      director: () => $.Director({}).approve(),
      default: () => $.System({}).autoApprove(),
    })

    expect(isPipelinePromise(result)).toBe(true)
    expect(result.__expr.type).toBe('branch')
    expect(Object.keys(result.__expr.cases)).toContain('manager')
    expect(Object.keys(result.__expr.cases)).toContain('director')
    expect(Object.keys(result.__expr.cases)).toContain('default')
  })

  it('supports nested conditionals', () => {
    const $ = createWorkflowProxy()

    const decision = $.waitFor('approval', { timeout: '1 day' })
    // Use decision.requiresReview as a boolean property (not comparison)
    // Comparisons like `decision.amount > 1000` require resolved values
    // Use $.branch or domain methods for threshold checks
    const result = $.when(decision.approved, {
      then: () =>
        $.when(decision.requiresReview, {
          then: () => $.Finance({}).manualReview(),
          else: () => $.Finance({}).autoProcess(),
        }),
      else: () => $.Email({}).sendRejection(),
    })

    expect(isPipelinePromise(result)).toBe(true)
    expect(result.__expr.type).toBe('conditional')
  })

  it('captures waitFor with property access for downstream processing', () => {
    const $ = createWorkflowProxy()

    const decision = $.waitFor('manager-approval', {
      timeout: '7 days',
      type: 'expense-decision',
    })

    // Access properties on the decision (e.g., decision.approved, decision.reason)
    const approved = decision.approved
    const reason = decision.reason

    expect(isPipelinePromise(approved)).toBe(true)
    expect(approved.__expr.type).toBe('property')
    expect(approved.__expr.property).toBe('approved')

    expect(isPipelinePromise(reason)).toBe(true)
    expect(reason.__expr.type).toBe('property')
    expect(reason.__expr.property).toBe('reason')
  })

  it('supports chained approval workflow pattern', () => {
    const $ = createWorkflowProxy()

    const expense = { id: 'exp-1', amount: 5000 }

    // Simulate multi-level approval chain
    const validation = $.Expenses(expense).validate()

    // Slack notification
    $.Slack({ channel: '#approvals' }).send({
      template: 'approval-request',
      data: { expense, validation },
    })

    // Wait for human approval
    const decision = $.waitFor('approval', { timeout: '7 days' })

    // Process based on decision
    const result = $.when(decision.approved, {
      then: () => {
        const reimbursement = $.Finance(expense).reimburse()
        $.Email({ to: 'submitter@example.com' }).send({
          template: 'approved',
          data: { reimbursement },
        })
        return reimbursement
      },
      else: () => {
        $.Email({ to: 'submitter@example.com' }).send({
          template: 'rejected',
          data: { reason: decision.reason },
        })
        return { status: 'rejected' }
      },
    })

    expect(isPipelinePromise(result)).toBe(true)
    expect(result.__expr.type).toBe('conditional')
  })

  it('waitFor without options uses defaults', () => {
    const $ = createWorkflowProxy()

    const event = $.waitFor('simple-event')

    expect(isPipelinePromise(event)).toBe(true)
    expect(event.__expr.type).toBe('waitFor')
    expect(event.__expr.eventName).toBe('simple-event')
    expect(event.__expr.options).toEqual({})
  })

  it('branch handles multiple approval levels', () => {
    const $ = createWorkflowProxy()

    const expense = { id: 'exp-1', amount: 50000 }
    const level = $.Expenses(expense).getApprovalLevel()

    const result = $.branch(level, {
      manager: () => $.Manager({}).requestApproval(expense),
      director: () => {
        const mgr = $.Manager({}).requestApproval(expense)
        return $.when(mgr.approved, {
          then: () => $.Director({}).requestApproval(expense),
        })
      },
      cfo: () => {
        const dir = $.Director({}).requestApproval(expense)
        return $.when(dir.approved, {
          then: () => $.CFO({}).requestApproval(expense),
        })
      },
      board: () => {
        const cfo = $.CFO({}).requestApproval(expense)
        return $.when(cfo.approved, {
          then: () => $.Board({}).requestApproval(expense),
        })
      },
      default: () => $.Expenses(expense).autoApprove(),
    })

    expect(isPipelinePromise(result)).toBe(true)
    expect(result.__expr.type).toBe('branch')

    // Verify all cases are captured
    const cases = result.__expr.cases
    expect(Object.keys(cases)).toEqual(['manager', 'director', 'cfo', 'board', 'default'])

    // Verify nested conditionals are properly captured
    expect(cases['director'].type).toBe('conditional')
    expect(cases['cfo'].type).toBe('conditional')
    expect(cases['board'].type).toBe('conditional')
  })
})
