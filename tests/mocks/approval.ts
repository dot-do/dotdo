/**
 * Mock Approval Data
 *
 * Development mock data for the approval detail page.
 * Used during development until real API integration is complete.
 *
 * @see app/components/approvals/approval-detail.tsx
 */

import type { ApprovalRequest } from '../../app/types/approval'

/**
 * Get mock approval data for development/demo purposes.
 * Returns null if no matching approval found.
 */
export function getMockApproval(id: string): ApprovalRequest | null {
  const mockApprovals: Record<string, ApprovalRequest> = {
    'approval-1': {
      id: 'approval-1',
      taskId: 'task-1',
      type: 'refund_request',
      title: 'Large Refund Request - Order #ORD-2026-12345',
      description: 'Customer John Doe is requesting a full refund of $2,500 for order #ORD-2026-12345. The order was for premium subscription services. Customer claims service was not as described.',
      requester: {
        id: 'agent-1',
        name: 'Customer Service Agent',
        email: 'cs-agent@dotdo.ai',
        type: 'agent',
        avatar: undefined,
      },
      status: 'pending',
      priority: 'high',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000),
      channel: 'in-app',
      data: {
        orderId: 'ORD-2026-12345',
        customerId: 'cust-789',
        customerName: 'John Doe',
        orderAmount: 2500,
        orderDate: '2026-01-01',
        refundReason: 'Service not as described',
      },
      form: {
        fields: [
          { name: 'refundAmount', type: 'number', label: 'Refund Amount', required: true },
          {
            name: 'refundReason',
            type: 'select',
            label: 'Refund Category',
            options: ['Defective', 'Not as described', 'Customer satisfaction', 'Other'],
            required: true,
          },
          { name: 'notes', type: 'textarea', label: 'Internal Notes', required: false },
        ],
      },
      actions: [
        { value: 'approve', label: 'Approve Refund', style: 'primary' },
        { value: 'reject', label: 'Reject Request', style: 'danger', requiresReason: true },
        { value: 'partial', label: 'Partial Refund', style: 'default' },
      ],
      context: {
        workflow: 'customer-refund-workflow',
        workflowRunId: 'run-abc-123',
        previousDecisions: [
          {
            action: 'approve',
            userId: 'user-100',
            userName: 'Alice',
            timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000),
            reason: 'Verified claim',
          },
        ],
        relatedApprovals: [
          { id: 'related-1', title: 'Previous Refund for Same Customer', status: 'approved' },
        ],
      },
      approvalWorkflow: {
        type: 'sequential',
        currentLevel: 1,
        totalLevels: 2,
        levels: [
          {
            name: 'Team Lead',
            users: ['lead@company.com'],
            status: 'completed',
            completedBy: 'lead@company.com',
            completedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
            action: 'approve',
          },
          { name: 'Manager', users: ['manager@company.com'], status: 'pending' },
        ],
        approvals: [
          {
            userId: 'user-lead',
            userName: 'Team Lead',
            action: 'approve',
            timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000),
            level: 'Team Lead',
          },
        ],
      },
    },
    'approval-2': {
      id: 'approval-2',
      taskId: 'task-2',
      type: 'account_deletion',
      title: 'Account Deletion Request',
      description: 'User requesting complete account and data deletion',
      requester: {
        id: 'agent-2',
        name: 'AI Agent Beta',
        email: 'agent-beta@dotdo.ai',
        type: 'agent',
      },
      status: 'pending',
      priority: 'normal',
      createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      channel: 'in-app',
      data: {
        userId: 'user-789',
        userName: 'Jane Smith',
      },
    },
    'approval-3': {
      id: 'approval-3',
      taskId: 'task-3',
      type: 'access_request',
      title: 'Critical System Access Request',
      description: 'Request for elevated permissions to production database',
      requester: {
        id: 'workflow-1',
        name: 'Security Workflow',
        email: 'security@dotdo.ai',
        type: 'workflow',
      },
      status: 'escalated',
      priority: 'critical',
      escalationLevel: 2,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      channel: 'in-app',
      data: {
        requestingUser: 'dev-team-lead',
        accessLevel: 'admin',
        duration: '24 hours',
      },
      escalation: {
        level: 2,
        maxLevel: 3,
        escalatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        escalatedTo: 'cto@company.com',
        reason: 'Requires CTO approval for admin access',
        history: [
          {
            level: 1,
            from: 'system',
            to: 'manager@company.com',
            timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
            reason: 'Initial escalation',
          },
          {
            level: 2,
            from: 'manager@company.com',
            to: 'cto@company.com',
            timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000),
            reason: 'Requires CTO approval for admin access',
          },
        ],
      },
    },
  }

  return mockApprovals[id] || mockApprovals['approval-1']
}
