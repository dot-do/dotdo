/**
 * ExpenseApprovalWorkflow Example
 *
 * Demonstrates:
 * - $.waitFor for human-in-the-loop (workflow hibernates)
 * - $.when for conditional processing
 * - $.branch for multi-way branching
 * - Slack/Email notifications
 */

import { Workflow } from '../workflows/workflow'

interface Expense {
  id: string
  submitterId: string
  amount: number
  category: string
  description: string
  receipts: string[]
  approver: string
}

interface ValidationResult {
  valid: boolean
  requiresApproval: boolean
  autoApproveReason?: string
  issues?: string[]
}

interface ApprovalDecision {
  approved: boolean
  approver: string
  reason?: string
  approvedAt: Date
}

interface Reimbursement {
  id: string
  amount: number
  method: 'direct_deposit' | 'check'
  processedAt: Date
}

/**
 * Expense Approval Workflow
 *
 * This workflow:
 * 1. Validates the expense
 * 2. Auto-approves if under threshold, otherwise requests human approval
 * 3. Hibernates (zero cost) while waiting for human decision
 * 4. Processes reimbursement on approval
 */
export const ExpenseApprovalWorkflow = Workflow('expense-approval', ($, expense: Expense) => {
  // Step 1: Validate expense
  const validation = $.Expenses(expense).validate()

  // Step 2: Check if human approval needed
  return $.when(validation.requiresApproval, {
    then: () => {
      // Notify approver via Slack
      $.Slack({ channel: expense.approver }).send({
        template: 'expense-approval-request',
        data: { expense, validation },
      })

      // WORKFLOW HIBERNATES HERE - zero compute cost
      // Can wait days or weeks for human response
      const decision = $.waitFor('manager-approval', {
        timeout: '7 days',
        type: 'expense-decision',
      })

      // Process based on decision
      return $.when(decision.approved, {
        then: () => processApproval($, expense, decision),
        else: () => processRejection($, expense, decision),
      })
    },
    else: () => {
      // Auto-approved - skip human approval
      $.Audit(expense).logAutoApproval({ reason: validation.autoApproveReason })
      return processApproval($, expense, {
        approved: true,
        approver: 'system',
        reason: validation.autoApproveReason,
        approvedAt: new Date(),
      })
    },
  })
})

// Helper for approval processing
function processApproval($: any, expense: Expense, decision: any) {
  const reimbursement = $.Finance(expense).reimburse()

  $.Email({ to: expense.submitterId }).send({
    template: 'expense-approved',
    data: { expense, reimbursement },
  })

  $.Audit(expense).logApproval({ decision, reimbursement })

  return {
    status: 'approved',
    expenseId: expense.id,
    reimbursementId: reimbursement.id,
    amount: expense.amount,
  }
}

// Helper for rejection processing
function processRejection($: any, expense: Expense, decision: any) {
  $.Email({ to: expense.submitterId }).send({
    template: 'expense-rejected',
    data: { expense, reason: decision.reason },
  })

  $.Audit(expense).logRejection({ decision })

  return {
    status: 'rejected',
    expenseId: expense.id,
    reason: decision.reason,
  }
}

/**
 * Multi-Level Approval Workflow
 *
 * Demonstrates $.branch for multi-way routing
 */
export const MultiLevelApprovalWorkflow = Workflow('multi-level-approval', ($, expense: Expense) => {
  // Determine approval level based on amount
  return $.branch(
    $.Expenses(expense).getApprovalLevel(), // Returns 'manager' | 'director' | 'cfo' | 'board'
    {
      manager: () => $.Manager(expense.submitterId).requestApproval(expense),
      director: () => {
        const managerApproval = $.Manager(expense.submitterId).requestApproval(expense)
        return $.when(managerApproval.approved, {
          then: () => $.Director(expense.submitterId).requestApproval(expense),
        })
      },
      cfo: () => {
        const managerApproval = $.Manager(expense.submitterId).requestApproval(expense)
        const directorApproval = $.when(managerApproval.approved, {
          then: () => $.Director(expense.submitterId).requestApproval(expense),
        })
        return $.when(directorApproval.approved, {
          then: () => $.CFO({}).requestApproval(expense),
        })
      },
      board: () => {
        // Board approval requires CFO pre-approval
        const cfoApproval = $.CFO({}).requestApproval(expense)
        return $.when(cfoApproval.approved, {
          then: () => $.Board({}).requestApproval(expense),
        })
      },
      default: () => $.Expenses(expense).autoApprove(),
    },
  )
})
