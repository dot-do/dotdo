/**
 * Approval Detail Page Tests (TDD RED Phase)
 *
 * These tests define the contract for the individual approval detail page.
 * Tests SHOULD FAIL until implementation matches all requirements.
 *
 * The approval detail page shows full context of a HumanFunction request,
 * the decision form, and allows the human to approve/reject with reasoning.
 *
 * @see app/routes/admin/approvals/$approvalId.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'

// Types based on HumanFunctionExecutor
interface FormFieldDefinition {
  name: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'textarea'
  label: string
  required?: boolean
  options?: string[]
  default?: unknown
  description?: string
}

interface ApprovalDetail {
  id: string
  taskId: string
  type: string
  title: string
  description: string
  requester: {
    id: string
    name: string
    email: string
    avatar?: string
    type: 'agent' | 'human' | 'workflow'
  }
  assignee?: {
    id: string
    name: string
    email: string
  }
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'escalated'
  priority: 'low' | 'normal' | 'high' | 'critical'
  createdAt: Date
  expiresAt?: Date
  escalationLevel?: number
  channel: 'slack' | 'email' | 'in-app' | 'custom'
  data: Record<string, unknown>
  form?: {
    fields: FormFieldDefinition[]
  }
  actions?: Array<{
    value: string
    label: string
    style?: 'primary' | 'danger' | 'default'
    requiresReason?: boolean
  }>
  context?: {
    workflow?: string
    workflowRunId?: string
    previousDecisions?: Array<{
      action: string
      userId: string
      userName: string
      timestamp: Date
      reason?: string
    }>
    relatedApprovals?: Array<{
      id: string
      title: string
      status: string
    }>
    metadata?: Record<string, unknown>
  }
  approvalWorkflow?: {
    type: 'sequential' | 'parallel' | 'conditional'
    currentLevel?: number
    totalLevels?: number
    levels?: Array<{
      name: string
      users: string[]
      status: 'pending' | 'completed' | 'skipped'
      completedBy?: string
      completedAt?: Date
    }>
    approvals?: Array<{
      userId: string
      userName: string
      action: string
      timestamp: Date
      level?: string
    }>
    requiredApprovals?: number
  }
}

// =============================================================================
// Mock Components and Helpers
// =============================================================================

// Placeholder component that will be replaced by actual implementation
const ApprovalDetailPage: React.FC<{
  approval: ApprovalDetail
  onApprove: (data: { reason?: string; formData?: Record<string, unknown> }) => Promise<void>
  onReject: (data: { reason: string }) => Promise<void>
  onEscalate?: (data: { to: string; reason: string }) => Promise<void>
  isSubmitting?: boolean
}> = () => null

// Mock data factory
function createMockApprovalDetail(overrides: Partial<ApprovalDetail> = {}): ApprovalDetail {
  return {
    id: 'approval-test-123',
    taskId: 'task-test-456',
    type: 'refund_request',
    title: 'Large Refund Request - Order #ORD-2026-12345',
    description: 'Customer John Doe is requesting a full refund of $2,500 for order #ORD-2026-12345. The order was for premium subscription services. Customer claims service was not as described.',
    requester: {
      id: 'agent-1',
      name: 'Customer Service Agent',
      email: 'cs-agent@dotdo.ai',
      type: 'agent',
    },
    status: 'pending',
    priority: 'high',
    createdAt: new Date('2026-01-09T10:00:00Z'),
    expiresAt: new Date('2026-01-09T22:00:00Z'),
    channel: 'in-app',
    data: {
      orderId: 'ORD-2026-12345',
      customerId: 'cust-789',
      customerName: 'John Doe',
      orderAmount: 2500,
      orderDate: '2026-01-01',
      refundReason: 'Service not as described',
    },
    actions: [
      { value: 'approve', label: 'Approve Refund', style: 'primary' },
      { value: 'reject', label: 'Reject Request', style: 'danger', requiresReason: true },
      { value: 'partial', label: 'Partial Refund', style: 'default' },
    ],
    form: {
      fields: [
        { name: 'refundAmount', type: 'number', label: 'Refund Amount', required: true },
        { name: 'refundReason', type: 'select', label: 'Refund Category', options: ['Defective', 'Not as described', 'Customer satisfaction', 'Other'], required: true },
        { name: 'notes', type: 'textarea', label: 'Internal Notes', required: false },
      ],
    },
    context: {
      workflow: 'customer-refund-workflow',
      workflowRunId: 'run-abc-123',
    },
    ...overrides,
  }
}

// =============================================================================
// Test Suite: Approval Detail Page
// =============================================================================

describe('ApprovalDetailPage', () => {
  let mockApproval: ApprovalDetail
  let onApprove: ReturnType<typeof vi.fn>
  let onReject: ReturnType<typeof vi.fn>
  let onEscalate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockApproval = createMockApprovalDetail()
    onApprove = vi.fn().mockResolvedValue(undefined)
    onReject = vi.fn().mockResolvedValue(undefined)
    onEscalate = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Page Header Tests
  // ===========================================================================

  describe('page header', () => {
    it('renders approval title', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByRole('heading', { name: mockApproval.title })).toBeInTheDocument()
    })

    it('renders status badge', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/pending/i)).toBeInTheDocument()
    })

    it('renders priority indicator', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/high priority/i)).toBeInTheDocument()
    })

    it('renders type badge', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/refund request/i)).toBeInTheDocument()
    })

    it('renders back to queue link', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByRole('link', { name: /back|queue/i })).toHaveAttribute('href', '/admin/approvals')
    })
  })

  // ===========================================================================
  // Timing Display Tests
  // ===========================================================================

  describe('timing display', () => {
    it('shows creation time', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/created/i)).toBeInTheDocument()
      expect(screen.getByText(/ago/i)).toBeInTheDocument()
    })

    it('shows expiration countdown', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/expires/i)).toBeInTheDocument()
    })

    it('shows urgent warning when near expiration', () => {
      const urgentApproval = createMockApprovalDetail({
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes from now
      })

      render(
        <ApprovalDetailPage
          approval={urgentApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByRole('alert')).toHaveTextContent(/urgent|expires soon/i)
    })

    it('shows expired state', () => {
      const expiredApproval = createMockApprovalDetail({
        status: 'expired',
        expiresAt: new Date('2026-01-08T10:00:00Z'),
      })

      render(
        <ApprovalDetailPage
          approval={expiredApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/expired/i)).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Requester Information Tests
  // ===========================================================================

  describe('requester information', () => {
    it('displays requester name', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText('Customer Service Agent')).toBeInTheDocument()
    })

    it('displays requester type badge', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/ai agent/i)).toBeInTheDocument()
    })

    it('displays requester avatar', () => {
      const approvalWithAvatar = createMockApprovalDetail({
        requester: {
          ...mockApproval.requester,
          avatar: 'https://example.com/avatar.png',
        },
      })

      render(
        <ApprovalDetailPage
          approval={approvalWithAvatar}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByRole('img', { name: /avatar/i })).toHaveAttribute('src', 'https://example.com/avatar.png')
    })

    it('shows workflow link when in workflow context', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByRole('link', { name: /view workflow/i })).toHaveAttribute(
        'href',
        expect.stringContaining('customer-refund-workflow')
      )
    })
  })

  // ===========================================================================
  // Request Data Display Tests
  // ===========================================================================

  describe('request data display', () => {
    it('displays description', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/Customer John Doe is requesting a full refund/)).toBeInTheDocument()
    })

    it('displays contextual data in organized sections', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText('Order ID')).toBeInTheDocument()
      expect(screen.getByText('ORD-2026-12345')).toBeInTheDocument()
      expect(screen.getByText('Order Amount')).toBeInTheDocument()
      expect(screen.getByText('$2,500')).toBeInTheDocument()
    })

    it('displays customer information', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText('Customer Name')).toBeInTheDocument()
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('has expandable/collapsible data sections', async () => {
      // Uses fireEvent for test compatibility
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const detailsToggle = screen.getByRole('button', { name: /view details|expand/i })
      fireEvent.click(detailsToggle)

      expect(screen.getByTestId('expanded-data')).toBeVisible()
    })

    it('shows raw JSON data option for debugging', async () => {
      // Uses fireEvent for test compatibility
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const jsonToggle = screen.getByRole('button', { name: /view json|raw data/i })
      fireEvent.click(jsonToggle)

      expect(screen.getByTestId('json-viewer')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Decision Form Rendering Tests
  // ===========================================================================

  describe('decision form rendering', () => {
    it('renders form when form definition exists', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByRole('form')).toBeInTheDocument()
    })

    it('renders text input fields', () => {
      const approvalWithTextFields = createMockApprovalDetail({
        form: {
          fields: [
            { name: 'notes', type: 'text', label: 'Notes', required: false },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={approvalWithTextFields}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByRole('textbox', { name: /notes/i })).toBeInTheDocument()
    })

    it('renders number input fields', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByRole('spinbutton', { name: /refund amount/i })).toBeInTheDocument()
    })

    it('renders select fields with options', async () => {
      // Uses fireEvent for test compatibility
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const selectField = screen.getByRole('combobox', { name: /refund category/i })
      expect(selectField).toBeInTheDocument()

      fireEvent.click(selectField)

      expect(screen.getByRole('option', { name: 'Defective' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Not as described' })).toBeInTheDocument()
    })

    it('renders textarea fields', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const textarea = screen.getByRole('textbox', { name: /internal notes/i })
      expect(textarea.tagName.toLowerCase()).toBe('textarea')
    })

    it('renders boolean fields as checkboxes', () => {
      const approvalWithBoolean = createMockApprovalDetail({
        form: {
          fields: [
            { name: 'notifyCustomer', type: 'boolean', label: 'Notify Customer', default: true },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={approvalWithBoolean}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const checkbox = screen.getByRole('checkbox', { name: /notify customer/i })
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).toBeChecked()
    })

    it('renders multiselect fields', async () => {
      // Uses fireEvent for test compatibility
      const approvalWithMultiselect = createMockApprovalDetail({
        form: {
          fields: [
            {
              name: 'categories',
              type: 'multiselect',
              label: 'Categories',
              options: ['Billing', 'Technical', 'Product', 'Other'],
            },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={approvalWithMultiselect}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const multiselect = screen.getByRole('listbox', { name: /categories/i })
      expect(multiselect).toBeInTheDocument()
    })

    it('shows required field indicators', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const refundAmountLabel = screen.getByText('Refund Amount')
      expect(refundAmountLabel.closest('label')?.textContent).toContain('*')
    })

    it('shows field descriptions when provided', () => {
      const approvalWithDescriptions = createMockApprovalDetail({
        form: {
          fields: [
            { name: 'amount', type: 'number', label: 'Amount', description: 'Enter the refund amount in dollars' },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={approvalWithDescriptions}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText('Enter the refund amount in dollars')).toBeInTheDocument()
    })

    it('applies default values from form definition', () => {
      const approvalWithDefaults = createMockApprovalDetail({
        form: {
          fields: [
            { name: 'amount', type: 'number', label: 'Amount', default: 100 },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={approvalWithDefaults}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByRole('spinbutton', { name: /amount/i })).toHaveValue(100)
    })
  })

  // ===========================================================================
  // Action Buttons Tests
  // ===========================================================================

  describe('action buttons', () => {
    it('renders action buttons from approval definition', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByRole('button', { name: 'Approve Refund' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reject Request' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Partial Refund' })).toBeInTheDocument()
    })

    it('applies correct styling to action buttons', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const approveButton = screen.getByRole('button', { name: 'Approve Refund' })
      const rejectButton = screen.getByRole('button', { name: 'Reject Request' })

      expect(approveButton).toHaveClass('bg-primary')
      expect(rejectButton).toHaveClass('bg-destructive')
    })

    it('disables buttons while submitting', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
          isSubmitting={true}
        />
      )

      expect(screen.getByRole('button', { name: 'Approve Refund' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Reject Request' })).toBeDisabled()
    })

    it('shows loading indicator on active button', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
          isSubmitting={true}
        />
      )

      const buttons = screen.getAllByRole('button')
      const hasSpinner = buttons.some((button) => button.querySelector('.animate-spin'))
      expect(hasSpinner).toBe(true)
    })

    it('has escalate button when escalation is possible', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
          onEscalate={onEscalate}
        />
      )

      expect(screen.getByRole('button', { name: /escalate/i })).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Form Submission Tests
  // ===========================================================================

  describe('form submission', () => {
    it('calls onApprove with form data when approve clicked', async () => {
      // Uses fireEvent for test compatibility
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      // Fill in form fields
      fireEvent.change(screen.getByRole('spinbutton', { name: /refund amount/i }), '2500')
      fireEvent.click(screen.getByRole('combobox', { name: /refund category/i }))
      fireEvent.click(screen.getByRole('option', { name: 'Not as described' }))

      // Click approve
      fireEvent.click(screen.getByRole('button', { name: 'Approve Refund' }))

      expect(onApprove).toHaveBeenCalledWith({
        formData: expect.objectContaining({
          refundAmount: 2500,
          refundReason: 'Not as described',
        }),
      })
    })

    it('validates required fields before submission', async () => {
      // Uses fireEvent for test compatibility
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      // Try to submit without required fields
      fireEvent.click(screen.getByRole('button', { name: 'Approve Refund' }))

      expect(screen.getByText(/refund amount.*required/i)).toBeInTheDocument()
      expect(onApprove).not.toHaveBeenCalled()
    })

    it('requires reason when rejection needs reason', async () => {
      // Uses fireEvent for test compatibility
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      // Click reject without reason
      fireEvent.click(screen.getByRole('button', { name: 'Reject Request' }))

      // Should show reason dialog or error
      expect(screen.getByText(/reason.*required|please provide.*reason/i)).toBeInTheDocument()
      expect(onReject).not.toHaveBeenCalled()
    })

    it('calls onReject with reason when provided', async () => {
      // Uses fireEvent for test compatibility
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Reject Request' }))

      // Fill in reason modal/dialog
      const reasonInput = await screen.findByRole('textbox', { name: /reason/i })
      fireEvent.change(reasonInput, 'Customer already received partial refund')

      // Confirm rejection
      fireEvent.click(screen.getByRole('button', { name: /confirm|submit/i }))

      expect(onReject).toHaveBeenCalledWith({
        reason: 'Customer already received partial refund',
      })
    })

    it('shows confirmation dialog for high-value actions', async () => {
      // Uses fireEvent for test compatibility
      const highValueApproval = createMockApprovalDetail({
        data: {
          ...mockApproval.data,
          orderAmount: 10000,
        },
      })

      render(
        <ApprovalDetailPage
          approval={highValueApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      fireEvent.change(screen.getByRole('spinbutton', { name: /refund amount/i }), '10000')
      fireEvent.click(screen.getByRole('combobox', { name: /refund category/i }))
      fireEvent.click(screen.getByRole('option', { name: 'Customer satisfaction' }))

      fireEvent.click(screen.getByRole('button', { name: 'Approve Refund' }))

      // Should show confirmation
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(/confirm.*\$10,000/i)).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Escalation Tests
  // ===========================================================================

  describe('escalation', () => {
    it('opens escalation dialog when escalate clicked', async () => {
      // Uses fireEvent for test compatibility
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
          onEscalate={onEscalate}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /escalate/i }))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(/escalate to/i)).toBeInTheDocument()
    })

    it('allows selecting escalation target', async () => {
      // Uses fireEvent for test compatibility
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
          onEscalate={onEscalate}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /escalate/i }))

      const targetSelect = await screen.findByRole('combobox', { name: /escalate to/i })
      fireEvent.click(targetSelect)

      expect(screen.getByRole('option', { name: /manager/i })).toBeInTheDocument()
    })

    it('calls onEscalate with target and reason', async () => {
      // Uses fireEvent for test compatibility
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
          onEscalate={onEscalate}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /escalate/i }))

      const targetSelect = await screen.findByRole('combobox', { name: /escalate to/i })
      fireEvent.click(targetSelect)
      fireEvent.click(screen.getByRole('option', { name: /manager/i }))

      const reasonInput = screen.getByRole('textbox', { name: /reason/i })
      fireEvent.change(reasonInput, 'Requires manager approval for this amount')

      fireEvent.click(screen.getByRole('button', { name: /confirm escalation/i }))

      expect(onEscalate).toHaveBeenCalledWith({
        to: expect.stringContaining('manager'),
        reason: 'Requires manager approval for this amount',
      })
    })
  })

  // ===========================================================================
  // Approval Chain Tests
  // ===========================================================================

  describe('approval chain display', () => {
    it('shows approval workflow when multi-level', () => {
      const multiLevelApproval = createMockApprovalDetail({
        approvalWorkflow: {
          type: 'sequential',
          currentLevel: 2,
          totalLevels: 3,
          levels: [
            { name: 'Team Lead', users: ['lead@company.com'], status: 'completed', completedBy: 'lead@company.com', completedAt: new Date() },
            { name: 'Manager', users: ['manager@company.com'], status: 'pending' },
            { name: 'Finance', users: ['finance@company.com'], status: 'pending' },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={multiLevelApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/approval chain/i)).toBeInTheDocument()
      expect(screen.getByText('Team Lead')).toBeInTheDocument()
      expect(screen.getByText('Manager')).toBeInTheDocument()
      expect(screen.getByText('Finance')).toBeInTheDocument()
    })

    it('shows completed steps in chain', () => {
      const multiLevelApproval = createMockApprovalDetail({
        approvalWorkflow: {
          type: 'sequential',
          currentLevel: 2,
          totalLevels: 3,
          levels: [
            { name: 'Team Lead', users: ['lead@company.com'], status: 'completed', completedBy: 'lead@company.com', completedAt: new Date() },
            { name: 'Manager', users: ['manager@company.com'], status: 'pending' },
            { name: 'Finance', users: ['finance@company.com'], status: 'pending' },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={multiLevelApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const teamLeadStep = screen.getByText('Team Lead').closest('[data-step]')
      expect(teamLeadStep).toHaveAttribute('data-status', 'completed')
    })

    it('highlights current approval level', () => {
      const multiLevelApproval = createMockApprovalDetail({
        approvalWorkflow: {
          type: 'sequential',
          currentLevel: 2,
          totalLevels: 3,
          levels: [
            { name: 'Team Lead', users: ['lead@company.com'], status: 'completed' },
            { name: 'Manager', users: ['manager@company.com'], status: 'pending' },
            { name: 'Finance', users: ['finance@company.com'], status: 'pending' },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={multiLevelApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const managerStep = screen.getByText('Manager').closest('[data-step]')
      expect(managerStep).toHaveAttribute('data-current', 'true')
    })

    it('shows parallel approval progress', () => {
      const parallelApproval = createMockApprovalDetail({
        approvalWorkflow: {
          type: 'parallel',
          requiredApprovals: 2,
          approvals: [
            { userId: 'user1', userName: 'Alice', action: 'approve', timestamp: new Date() },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={parallelApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/1 of 2 approvals/i)).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Previous Decisions Tests
  // ===========================================================================

  describe('previous decisions', () => {
    it('shows previous decisions in context', () => {
      const approvalWithHistory = createMockApprovalDetail({
        context: {
          ...mockApproval.context,
          previousDecisions: [
            { action: 'approve', userId: 'user1', userName: 'Alice', timestamp: new Date(), reason: 'Verified claim' },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={approvalWithHistory}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/previous decisions/i)).toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Verified claim')).toBeInTheDocument()
    })

    it('shows related approvals', () => {
      const approvalWithRelated = createMockApprovalDetail({
        context: {
          ...mockApproval.context,
          relatedApprovals: [
            { id: 'related-1', title: 'Previous Refund for Same Customer', status: 'approved' },
            { id: 'related-2', title: 'Related Order Issue', status: 'rejected' },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={approvalWithRelated}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/related approvals/i)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /previous refund/i })).toHaveAttribute('href', '/admin/approvals/related-1')
    })
  })

  // ===========================================================================
  // Accessibility Tests
  // ===========================================================================

  describe('accessibility', () => {
    it('form has proper labels', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const inputs = screen.getAllByRole('textbox')
      inputs.forEach((input) => {
        expect(input).toHaveAccessibleName()
      })
    })

    it('action buttons have accessible names', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveAccessibleName()
      })
    })

    it('status indicators have accessible labels', () => {
      render(
        <ApprovalDetailPage
          approval={mockApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByLabelText(/status.*pending/i)).toBeInTheDocument()
    })

    it('keyboard navigation works for approval chain', async () => {
      // Uses fireEvent for test compatibility
      const multiLevelApproval = createMockApprovalDetail({
        approvalWorkflow: {
          type: 'sequential',
          currentLevel: 2,
          totalLevels: 3,
          levels: [
            { name: 'Team Lead', users: ['lead@company.com'], status: 'completed' },
            { name: 'Manager', users: ['manager@company.com'], status: 'pending' },
            { name: 'Finance', users: ['finance@company.com'], status: 'pending' },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={multiLevelApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      const firstStep = screen.getByText('Team Lead').closest('[data-step]')
      firstStep?.focus()

      fireEvent.keyDown('{Tab}')

      const managerStep = screen.getByText('Manager').closest('[data-step]')
      expect(managerStep).toHaveFocus()
    })
  })

  // ===========================================================================
  // Expired/Completed State Tests
  // ===========================================================================

  describe('completed states', () => {
    it('shows approved state with result', () => {
      const approvedApproval = createMockApprovalDetail({
        status: 'approved',
        context: {
          ...mockApproval.context,
          previousDecisions: [
            { action: 'approve', userId: 'user1', userName: 'Manager', timestamp: new Date(), reason: 'Approved after review' },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={approvedApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/approved/i)).toBeInTheDocument()
      expect(screen.getByText(/approved by.*manager/i)).toBeInTheDocument()
    })

    it('shows rejected state with reason', () => {
      const rejectedApproval = createMockApprovalDetail({
        status: 'rejected',
        context: {
          ...mockApproval.context,
          previousDecisions: [
            { action: 'reject', userId: 'user1', userName: 'Manager', timestamp: new Date(), reason: 'Insufficient documentation' },
          ],
        },
      })

      render(
        <ApprovalDetailPage
          approval={rejectedApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.getByText(/rejected/i)).toBeInTheDocument()
      expect(screen.getByText(/insufficient documentation/i)).toBeInTheDocument()
    })

    it('disables actions for completed approvals', () => {
      const completedApproval = createMockApprovalDetail({
        status: 'approved',
      })

      render(
        <ApprovalDetailPage
          approval={completedApproval}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

      expect(screen.queryByRole('button', { name: 'Approve Refund' })).not.toBeInTheDocument()
    })
  })
})
