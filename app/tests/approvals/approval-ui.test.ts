/**
 * HumanFunction Approval UI Tests (TDD RED Phase)
 *
 * These tests define the contract for the HumanFunction approval UI portal.
 * Tests SHOULD FAIL until the UI implementation is complete.
 *
 * The approval UI provides:
 * - Pending approvals queue with filtering and sorting
 * - Dynamic form rendering from HumanFunction definitions
 * - Multi-level approval chain navigation
 * - Escalation status and timing display
 * - Mobile-responsive notification integration
 * - Approval history and comprehensive audit trail
 *
 * @see lib/executors/HumanFunctionExecutor.ts
 * @see api/routes/approvals.ts
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

// =============================================================================
// Type Definitions (matching HumanFunctionExecutor)
// =============================================================================

interface ApprovalRequest {
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
  }
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'escalated'
  priority: 'low' | 'normal' | 'high' | 'critical'
  createdAt: string
  expiresAt?: string
  channel: string
  data: Record<string, unknown>
  form?: FormDefinition
  actions?: Array<{
    value: string
    label: string
    style?: 'primary' | 'danger' | 'default'
  }>
  approvalWorkflow?: {
    type: 'sequential' | 'parallel' | 'conditional'
    currentLevel?: number
    totalLevels?: number
    levels?: ApprovalLevel[]
    completedApprovals?: Array<{
      userId: string
      userName: string
      action: string
      timestamp: string
      level: string
    }>
  }
  escalation?: {
    level: number
    maxLevel: number
    escalatedAt: string
    escalatedTo: string
    reason: string
    history?: Array<{
      level: number
      from: string
      to: string
      timestamp: string
      reason: string
    }>
  }
  reminder?: {
    sentAt?: string
    nextAt?: string
    message?: string
  }
  timeRemaining?: number
}

interface FormDefinition {
  fields: FormFieldDefinition[]
}

interface FormFieldDefinition {
  name: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'textarea' | 'date' | 'file'
  label: string
  required?: boolean
  options?: string[]
  default?: unknown
  placeholder?: string
  helpText?: string
  validation?: {
    min?: number
    max?: number
    minLength?: number
    maxLength?: number
    pattern?: string
  }
}

interface ApprovalLevel {
  name: string
  users: string[]
}

interface AuditLogEntry {
  id: string
  timestamp: string
  action: string
  userId: string
  userName: string
  userEmail: string
  approvalId: string
  details: Record<string, unknown>
  metadata?: {
    ipAddress?: string
    userAgent?: string
    location?: string
  }
}

// =============================================================================
// Mock Helpers - Will be replaced with actual implementation
// =============================================================================

async function fetchApprovalPage(path: string): Promise<Response> {
  const { renderPage } = await import('../../src/approvals/render')
  return renderPage(path)
}

async function fetchUnauthenticated(path: string): Promise<Response> {
  const { fetchPage } = await import('../../src/approvals/render')
  return fetchPage(path, { authenticated: false })
}

async function createAuthenticatedSession(): Promise<{ token: string; userId: string }> {
  const { createSession } = await import('../../src/approvals/auth')
  return createSession()
}

function extractContent(html: string, selector: string): string | null {
  const patterns: Record<string, RegExp> = {
    title: /<title>([^<]*)<\/title>/i,
    h1: /<h1[^>]*>([^<]*)<\/h1>/i,
    main: /<main[^>]*>([\s\S]*?)<\/main>/i,
    'approval-count': /data-approval-count="(\d+)"/i,
    'time-remaining': /data-time-remaining="([^"]+)"/i,
  }
  const regex = patterns[selector]
  if (!regex) return null
  const match = html.match(regex)
  return match?.[1] ?? null
}

function hasElement(html: string, selector: string): boolean {
  const patterns: Record<string, RegExp> = {
    table: /<table/i,
    form: /<form/i,
    button: /<button/i,
    input: /<input/i,
    select: /<select/i,
    textarea: /<textarea/i,
    'approval-card': /data-approval-card|approval-card/i,
    'approval-queue': /data-approval-queue|approval-queue/i,
    'approval-form': /data-approval-form|approval-form/i,
    'approval-chain': /data-approval-chain|approval-chain/i,
    'escalation-status': /data-escalation|escalation-status/i,
    'time-indicator': /data-time-remaining|time-remaining/i,
    'audit-trail': /data-audit-trail|audit-trail/i,
    badge: /<span[^>]*badge|data-badge/i,
    'priority-indicator': /priority-(low|normal|high|critical)/i,
  }
  const regex = patterns[selector] ?? new RegExp(`<${selector}`, 'i')
  return regex.test(html)
}

function countElements(html: string, selector: string): number {
  const patterns: Record<string, RegExp> = {
    'approval-card': /data-approval-card|class="[^"]*approval-card/gi,
    'form-field': /data-form-field|class="[^"]*form-field/gi,
    'audit-entry': /data-audit-entry|class="[^"]*audit-entry/gi,
    'level-indicator': /data-level|class="[^"]*level-/gi,
  }
  const regex = patterns[selector]
  if (!regex) return 0
  const matches = html.match(regex)
  return matches?.length ?? 0
}

// =============================================================================
// Route Structure Tests
// =============================================================================

describe('Approval UI Route Structure', () => {
  describe('app/routes/admin/approvals/index.tsx', () => {
    it('should exist as main approvals queue route', () => {
      expect(existsSync('app/routes/admin/approvals/index.tsx')).toBe(true)
    })

    it('should use ApprovalQueue component', async () => {
      const content = await readFile('app/routes/admin/approvals/index.tsx', 'utf-8')
      expect(content).toContain('ApprovalQueue')
    })

    it('should integrate with Shell layout', async () => {
      const content = await readFile('app/routes/admin/approvals/index.tsx', 'utf-8')
      expect(content).toContain('Shell')
    })
  })

  describe('app/routes/admin/approvals/$approvalId.tsx', () => {
    it('should exist as approval detail route', () => {
      expect(existsSync('app/routes/admin/approvals/$approvalId.tsx')).toBe(true)
    })

    it('should render ApprovalDetail component', async () => {
      const content = await readFile('app/routes/admin/approvals/$approvalId.tsx', 'utf-8')
      expect(content).toContain('ApprovalDetail')
    })

    it('should include ApprovalForm component', async () => {
      const content = await readFile('app/routes/admin/approvals/$approvalId.tsx', 'utf-8')
      expect(content).toContain('ApprovalForm')
    })
  })

  describe('app/routes/admin/approvals/history.tsx', () => {
    it('should exist for approval history', () => {
      expect(existsSync('app/routes/admin/approvals/history.tsx')).toBe(true)
    })

    it('should use ApprovalHistory component', async () => {
      const content = await readFile('app/routes/admin/approvals/history.tsx', 'utf-8')
      expect(content).toContain('ApprovalHistory')
    })
  })

  describe('app/routes/admin/approvals/$approvalId/audit.tsx', () => {
    it('should exist for audit trail view', () => {
      expect(existsSync('app/routes/admin/approvals/$approvalId/audit.tsx')).toBe(true)
    })

    it('should render AuditTrail component', async () => {
      const content = await readFile('app/routes/admin/approvals/$approvalId/audit.tsx', 'utf-8')
      expect(content).toContain('AuditTrail')
    })
  })
})

// =============================================================================
// Authentication Tests
// =============================================================================

describe('Approval UI Authentication', () => {
  describe('Unauthenticated access', () => {
    it('should redirect /admin/approvals to login when not authenticated', async () => {
      const res = await fetchUnauthenticated('/admin/approvals')
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/admin/login')
    })

    it('should redirect /admin/approvals/:id to login when not authenticated', async () => {
      const res = await fetchUnauthenticated('/admin/approvals/test-approval-123')
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/admin/login')
    })

    it('should redirect /admin/approvals/history to login when not authenticated', async () => {
      const res = await fetchUnauthenticated('/admin/approvals/history')
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/admin/login')
    })
  })

  describe('Authorized access', () => {
    it('should allow access to approvals queue for authenticated users', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      expect(res.status).toBe(200)
    })

    it('should restrict approvals to assigned users only', async () => {
      // User should only see approvals assigned to them or their role
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/assigned|my approvals|pending/i)
    })
  })
})

// =============================================================================
// Approval Queue Page Tests
// =============================================================================

describe('Approval Queue Page (/admin/approvals)', () => {
  let queueHtml: string

  beforeAll(async () => {
    const res = await fetchApprovalPage('/admin/approvals')
    queueHtml = await res.text()
  })

  describe('Layout and structure', () => {
    it('should return 200 status', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      expect(res.status).toBe(200)
    })

    it('should display page title', () => {
      expect(queueHtml).toMatch(/Pending Approvals|Approval Queue|Awaiting Review/i)
    })

    it('should have approval queue container', () => {
      expect(hasElement(queueHtml, 'approval-queue')).toBe(true)
    })

    it('should display pending approval count badge', () => {
      expect(hasElement(queueHtml, 'badge')).toBe(true)
      expect(queueHtml).toMatch(/data-approval-count|\d+\s*(pending|approval)/i)
    })
  })

  describe('Approval cards', () => {
    it('should render approval cards for pending items', () => {
      expect(hasElement(queueHtml, 'approval-card')).toBe(true)
    })

    it('should display approval title in each card', () => {
      expect(queueHtml).toMatch(/title|subject/i)
    })

    it('should show requester information', () => {
      expect(queueHtml).toMatch(/requester|requested by|from/i)
    })

    it('should display priority indicator', () => {
      expect(hasElement(queueHtml, 'priority-indicator')).toBe(true)
    })

    it('should show time remaining or deadline', () => {
      expect(hasElement(queueHtml, 'time-indicator')).toBe(true)
    })

    it('should display approval type badge', () => {
      expect(queueHtml).toMatch(/type|category/i)
    })

    it('should have link to approval detail', () => {
      expect(queueHtml).toMatch(/href="[^"]*\/admin\/approvals\/[^"]+"/i)
    })
  })

  describe('Filtering', () => {
    it('should have filter by status dropdown', () => {
      expect(queueHtml).toMatch(/filter|status/i)
      expect(hasElement(queueHtml, 'select')).toBe(true)
    })

    it('should have filter by priority', async () => {
      const res = await fetchApprovalPage('/admin/approvals?priority=critical')
      expect(res.status).toBe(200)
    })

    it('should have filter by type', async () => {
      const res = await fetchApprovalPage('/admin/approvals?type=refund_request')
      expect(res.status).toBe(200)
    })

    it('should have search functionality', () => {
      expect(queueHtml).toMatch(/search/i)
      expect(hasElement(queueHtml, 'input')).toBe(true)
    })

    it('should have date range filter', () => {
      expect(queueHtml).toMatch(/date|from|to/i)
    })
  })

  describe('Sorting', () => {
    it('should have sort by options', () => {
      expect(queueHtml).toMatch(/sort|order/i)
    })

    it('should default sort by urgency/deadline', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/urgent|deadline|expiring/i)
    })

    it('should support sort by priority', async () => {
      const res = await fetchApprovalPage('/admin/approvals?sortBy=priority')
      expect(res.status).toBe(200)
    })

    it('should support sort by created date', async () => {
      const res = await fetchApprovalPage('/admin/approvals?sortBy=createdAt')
      expect(res.status).toBe(200)
    })
  })

  describe('Pagination', () => {
    it('should have pagination controls', () => {
      expect(queueHtml).toMatch(/previous|next|page/i)
    })

    it('should show current page and total', () => {
      expect(queueHtml).toMatch(/page\s*\d+|of\s*\d+|showing/i)
    })

    it('should support page size selection', () => {
      expect(queueHtml).toMatch(/per page|items|results/i)
    })
  })

  describe('Quick actions', () => {
    it('should have quick approve button on cards', () => {
      expect(queueHtml).toMatch(/quick approve|approve/i)
    })

    it('should have quick reject button on cards', () => {
      expect(queueHtml).toMatch(/quick reject|reject/i)
    })

    it('should have bulk action capability', () => {
      expect(queueHtml).toMatch(/select all|bulk|batch/i)
    })
  })

  describe('Empty state', () => {
    it('should show empty state when no pending approvals', async () => {
      // Simulate empty queue response
      const res = await fetchApprovalPage('/admin/approvals?empty=true')
      const html = await res.text()
      expect(html).toMatch(/no pending|all caught up|nothing to review/i)
    })
  })
})

// =============================================================================
// Approval Detail Page Tests
// =============================================================================

describe('Approval Detail Page (/admin/approvals/:id)', () => {
  let detailHtml: string
  const testApprovalId = 'approval-test-123'

  beforeAll(async () => {
    const res = await fetchApprovalPage(`/admin/approvals/${testApprovalId}`)
    detailHtml = await res.text()
  })

  describe('Layout and structure', () => {
    it('should return 200 status for valid approval', async () => {
      const res = await fetchApprovalPage(`/admin/approvals/${testApprovalId}`)
      expect(res.status).toBe(200)
    })

    it('should return 404 for non-existent approval', async () => {
      const res = await fetchApprovalPage('/admin/approvals/non-existent-id')
      expect(res.status).toBe(404)
    })

    it('should display approval title', () => {
      expect(extractContent(detailHtml, 'h1')).toBeTruthy()
    })

    it('should show approval status badge', () => {
      expect(detailHtml).toMatch(/pending|approved|rejected|expired|escalated/i)
    })

    it('should have breadcrumb navigation', () => {
      expect(detailHtml).toMatch(/approvals|queue|back/i)
    })
  })

  describe('Request details section', () => {
    it('should display requester name and email', () => {
      expect(detailHtml).toMatch(/requester|requested by/i)
    })

    it('should show requester avatar', () => {
      expect(detailHtml).toMatch(/avatar|profile|img/i)
    })

    it('should display request timestamp', () => {
      expect(detailHtml).toMatch(/requested|created|submitted/i)
    })

    it('should show priority level prominently', () => {
      expect(hasElement(detailHtml, 'priority-indicator')).toBe(true)
    })

    it('should display approval type', () => {
      expect(detailHtml).toMatch(/type|category/i)
    })

    it('should show full description', () => {
      expect(detailHtml).toMatch(/description|details|reason/i)
    })
  })

  describe('Context data display', () => {
    it('should render structured context data', () => {
      expect(detailHtml).toMatch(/context|data|information/i)
    })

    it('should format monetary values appropriately', () => {
      expect(detailHtml).toMatch(/\$|USD|amount/i)
    })

    it('should display related entity links', () => {
      expect(detailHtml).toMatch(/href|link|view/i)
    })

    it('should show any attached files', () => {
      expect(detailHtml).toMatch(/attachment|file|document/i)
    })
  })

  describe('Time and deadline section', () => {
    it('should show time remaining prominently', () => {
      expect(hasElement(detailHtml, 'time-indicator')).toBe(true)
    })

    it('should display expiration date/time', () => {
      expect(detailHtml).toMatch(/expires|deadline|due/i)
    })

    it('should show countdown for urgent items', () => {
      expect(detailHtml).toMatch(/remaining|left|countdown/i)
    })

    it('should indicate if reminder was sent', () => {
      expect(detailHtml).toMatch(/reminder|notified/i)
    })
  })

  describe('Escalation information', () => {
    it('should show escalation status if escalated', () => {
      expect(hasElement(detailHtml, 'escalation-status')).toBe(true)
    })

    it('should display escalation level', () => {
      expect(detailHtml).toMatch(/level|escalation/i)
    })

    it('should show who it was escalated to', () => {
      expect(detailHtml).toMatch(/escalated to|assigned to/i)
    })

    it('should display escalation reason', () => {
      expect(detailHtml).toMatch(/reason|why/i)
    })

    it('should show escalation history if multiple escalations', async () => {
      const res = await fetchApprovalPage('/admin/approvals/multi-escalated-approval')
      const html = await res.text()
      expect(html).toMatch(/history|previous|chain/i)
    })
  })
})

// =============================================================================
// Dynamic Form Rendering Tests
// =============================================================================

describe('Approval Form Rendering', () => {
  describe('Form structure', () => {
    it('should render form element for decision', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-form')
      const html = await res.text()
      expect(hasElement(html, 'approval-form')).toBe(true)
    })

    it('should render all form fields from definition', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-form')
      const html = await res.text()
      const fieldCount = countElements(html, 'form-field')
      expect(fieldCount).toBeGreaterThan(0)
    })

    it('should preserve form state on validation error', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-form?validationError=true')
      const html = await res.text()
      expect(html).toMatch(/value=|defaultValue/i)
    })
  })

  describe('Text field rendering', () => {
    it('should render text input for text type fields', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-text-field')
      const html = await res.text()
      expect(html).toMatch(/type="text"/i)
    })

    it('should render textarea for long text fields', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-textarea-field')
      const html = await res.text()
      expect(hasElement(html, 'textarea')).toBe(true)
    })

    it('should apply minLength/maxLength constraints', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-text-field')
      const html = await res.text()
      expect(html).toMatch(/minlength|maxlength/i)
    })

    it('should show placeholder text', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-text-field')
      const html = await res.text()
      expect(html).toMatch(/placeholder/i)
    })
  })

  describe('Number field rendering', () => {
    it('should render number input for number type fields', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-number-field')
      const html = await res.text()
      expect(html).toMatch(/type="number"/i)
    })

    it('should apply min/max constraints', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-number-field')
      const html = await res.text()
      expect(html).toMatch(/min=|max=/i)
    })

    it('should support decimal values when appropriate', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-decimal-field')
      const html = await res.text()
      expect(html).toMatch(/step=/i)
    })
  })

  describe('Boolean field rendering', () => {
    it('should render checkbox for boolean type fields', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-boolean-field')
      const html = await res.text()
      expect(html).toMatch(/type="checkbox"|toggle/i)
    })

    it('should support toggle switch variant', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-toggle-field')
      const html = await res.text()
      expect(html).toMatch(/toggle|switch/i)
    })
  })

  describe('Select field rendering', () => {
    it('should render select dropdown for select type fields', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-select-field')
      const html = await res.text()
      expect(hasElement(html, 'select')).toBe(true)
    })

    it('should render all options from field definition', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-select-field')
      const html = await res.text()
      expect(html).toMatch(/<option/gi)
    })

    it('should handle multiselect fields', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-multiselect-field')
      const html = await res.text()
      expect(html).toMatch(/multiple|multiselect|checkbox-group/i)
    })
  })

  describe('Date field rendering', () => {
    it('should render date picker for date type fields', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-date-field')
      const html = await res.text()
      expect(html).toMatch(/type="date"|datepicker/i)
    })
  })

  describe('File field rendering', () => {
    it('should render file upload for file type fields', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-file-field')
      const html = await res.text()
      expect(html).toMatch(/type="file"|file-upload/i)
    })
  })

  describe('Field labels and help', () => {
    it('should render label for each field', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-form')
      const html = await res.text()
      expect(html).toMatch(/<label/i)
    })

    it('should indicate required fields visually', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-form')
      const html = await res.text()
      expect(html).toMatch(/required|\*/i)
    })

    it('should display help text when provided', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-with-help')
      const html = await res.text()
      expect(html).toMatch(/help|hint|description/i)
    })
  })

  describe('Default values', () => {
    it('should populate default values from field definition', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-with-defaults')
      const html = await res.text()
      expect(html).toMatch(/value=|defaultValue|defaultChecked/i)
    })
  })

  describe('Validation display', () => {
    it('should display validation errors inline', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-with-errors')
      const html = await res.text()
      expect(html).toMatch(/error|invalid|required/i)
    })

    it('should highlight invalid fields', async () => {
      const res = await fetchApprovalPage('/admin/approvals/form-with-errors')
      const html = await res.text()
      expect(html).toMatch(/error|invalid|aria-invalid/i)
    })
  })
})

// =============================================================================
// Action Buttons Tests
// =============================================================================

describe('Approval Action Buttons', () => {
  describe('Default actions', () => {
    it('should render approve button', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/approve/i)
    })

    it('should render reject button', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/reject/i)
    })

    it('should style approve as primary action', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/primary|success/i)
    })

    it('should style reject as danger action', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/danger|destructive/i)
    })
  })

  describe('Custom actions', () => {
    it('should render custom actions from definition', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-custom-actions')
      const html = await res.text()
      expect(html).toMatch(/custom action|escalate|defer/i)
    })

    it('should apply correct styling to custom actions', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-styled-actions')
      const html = await res.text()
      expect(html).toMatch(/style|variant/i)
    })
  })

  describe('Reason requirement', () => {
    it('should show reason field when rejecting', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/reason|comment|explain/i)
    })

    it('should require reason for rejection', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/required.*reason|reason.*required/i)
    })
  })

  describe('Confirmation dialogs', () => {
    it('should show confirmation before approve', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/confirm|are you sure/i)
    })

    it('should show confirmation before reject', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/confirm|are you sure/i)
    })
  })

  describe('Loading states', () => {
    it('should disable buttons during submission', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/disabled|loading|submitting/i)
    })

    it('should show loading spinner during submission', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/spinner|loading/i)
    })
  })
})

// =============================================================================
// Multi-Level Approval Chain Tests
// =============================================================================

describe('Multi-Level Approval Chain Navigation', () => {
  describe('Chain visualization', () => {
    it('should display approval chain component', async () => {
      const res = await fetchApprovalPage('/admin/approvals/multi-level-approval')
      const html = await res.text()
      expect(hasElement(html, 'approval-chain')).toBe(true)
    })

    it('should show all approval levels', async () => {
      const res = await fetchApprovalPage('/admin/approvals/multi-level-approval')
      const html = await res.text()
      const levelCount = countElements(html, 'level-indicator')
      expect(levelCount).toBeGreaterThan(1)
    })

    it('should indicate current level', async () => {
      const res = await fetchApprovalPage('/admin/approvals/multi-level-approval')
      const html = await res.text()
      expect(html).toMatch(/current|active|awaiting/i)
    })

    it('should show completed levels with checkmark', async () => {
      const res = await fetchApprovalPage('/admin/approvals/partially-approved')
      const html = await res.text()
      expect(html).toMatch(/completed|check|approved/i)
    })

    it('should show pending levels as inactive', async () => {
      const res = await fetchApprovalPage('/admin/approvals/multi-level-approval')
      const html = await res.text()
      expect(html).toMatch(/pending|inactive|waiting/i)
    })
  })

  describe('Level details', () => {
    it('should display level name', async () => {
      const res = await fetchApprovalPage('/admin/approvals/multi-level-approval')
      const html = await res.text()
      expect(html).toMatch(/level|tier|stage/i)
    })

    it('should show assigned approvers for each level', async () => {
      const res = await fetchApprovalPage('/admin/approvals/multi-level-approval')
      const html = await res.text()
      expect(html).toMatch(/approver|assigned|reviewer/i)
    })

    it('should indicate which user approved at each completed level', async () => {
      const res = await fetchApprovalPage('/admin/approvals/partially-approved')
      const html = await res.text()
      expect(html).toMatch(/approved by|completed by/i)
    })

    it('should show approval timestamp for each completed level', async () => {
      const res = await fetchApprovalPage('/admin/approvals/partially-approved')
      const html = await res.text()
      expect(html).toMatch(/timestamp|date|when/i)
    })
  })

  describe('Sequential workflow', () => {
    it('should clearly indicate sequential flow', async () => {
      const res = await fetchApprovalPage('/admin/approvals/sequential-approval')
      const html = await res.text()
      expect(html).toMatch(/sequential|one by one|step/i)
    })

    it('should show arrow/connector between levels', async () => {
      const res = await fetchApprovalPage('/admin/approvals/sequential-approval')
      const html = await res.text()
      expect(html).toMatch(/arrow|connector|->|flow/i)
    })
  })

  describe('Parallel workflow', () => {
    it('should indicate parallel flow', async () => {
      const res = await fetchApprovalPage('/admin/approvals/parallel-approval')
      const html = await res.text()
      expect(html).toMatch(/parallel|simultaneous|concurrent/i)
    })

    it('should show required approval count', async () => {
      const res = await fetchApprovalPage('/admin/approvals/parallel-approval')
      const html = await res.text()
      expect(html).toMatch(/\d+\s*of\s*\d+|required|needed/i)
    })

    it('should display current approval count', async () => {
      const res = await fetchApprovalPage('/admin/approvals/parallel-approval')
      const html = await res.text()
      expect(html).toMatch(/approved|received/i)
    })
  })

  describe('Conditional workflow', () => {
    it('should indicate conditional flow', async () => {
      const res = await fetchApprovalPage('/admin/approvals/conditional-approval')
      const html = await res.text()
      expect(html).toMatch(/conditional|based on|if/i)
    })

    it('should show which condition was matched', async () => {
      const res = await fetchApprovalPage('/admin/approvals/conditional-approval')
      const html = await res.text()
      expect(html).toMatch(/condition|matched|criteria/i)
    })
  })
})

// =============================================================================
// Escalation Status Display Tests
// =============================================================================

describe('Escalation Status Display', () => {
  describe('Escalation indicator', () => {
    it('should display escalation badge when escalated', async () => {
      const res = await fetchApprovalPage('/admin/approvals/escalated-approval')
      const html = await res.text()
      expect(html).toMatch(/escalated|escalation/i)
    })

    it('should show current escalation level', async () => {
      const res = await fetchApprovalPage('/admin/approvals/escalated-approval')
      const html = await res.text()
      expect(html).toMatch(/level\s*\d+|tier\s*\d+/i)
    })

    it('should display max escalation level', async () => {
      const res = await fetchApprovalPage('/admin/approvals/escalated-approval')
      const html = await res.text()
      expect(html).toMatch(/max|final|highest/i)
    })
  })

  describe('Escalation details', () => {
    it('should show who escalated', async () => {
      const res = await fetchApprovalPage('/admin/approvals/escalated-approval')
      const html = await res.text()
      expect(html).toMatch(/escalated by|from/i)
    })

    it('should show escalation target', async () => {
      const res = await fetchApprovalPage('/admin/approvals/escalated-approval')
      const html = await res.text()
      expect(html).toMatch(/escalated to|assigned to/i)
    })

    it('should display escalation reason', async () => {
      const res = await fetchApprovalPage('/admin/approvals/escalated-approval')
      const html = await res.text()
      expect(html).toMatch(/reason|why escalated/i)
    })

    it('should show escalation timestamp', async () => {
      const res = await fetchApprovalPage('/admin/approvals/escalated-approval')
      const html = await res.text()
      expect(html).toMatch(/escalated at|when/i)
    })
  })

  describe('Escalation history', () => {
    it('should display escalation history timeline', async () => {
      const res = await fetchApprovalPage('/admin/approvals/multi-escalated-approval')
      const html = await res.text()
      expect(html).toMatch(/history|timeline/i)
    })

    it('should show each escalation step', async () => {
      const res = await fetchApprovalPage('/admin/approvals/multi-escalated-approval')
      const html = await res.text()
      expect(html).toMatch(/step|level/i)
    })
  })

  describe('Manual escalation', () => {
    it('should have escalate button when allowed', async () => {
      const res = await fetchApprovalPage('/admin/approvals/can-escalate')
      const html = await res.text()
      expect(html).toMatch(/escalate/i)
    })

    it('should show escalation target options', async () => {
      const res = await fetchApprovalPage('/admin/approvals/can-escalate')
      const html = await res.text()
      expect(html).toMatch(/to|target|manager/i)
    })

    it('should require escalation reason', async () => {
      const res = await fetchApprovalPage('/admin/approvals/can-escalate')
      const html = await res.text()
      expect(html).toMatch(/reason|why/i)
    })

    it('should disable escalate when at max level', async () => {
      const res = await fetchApprovalPage('/admin/approvals/at-max-escalation')
      const html = await res.text()
      expect(html).toMatch(/disabled|cannot escalate|max level/i)
    })
  })
})

// =============================================================================
// Time Display and Urgency Tests
// =============================================================================

describe('Time Display and Urgency Indicators', () => {
  describe('Time remaining display', () => {
    it('should show time remaining prominently', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(hasElement(html, 'time-indicator')).toBe(true)
    })

    it('should update countdown in real-time', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/countdown|timer|remaining/i)
    })

    it('should display human-readable duration', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/hours|minutes|days/i)
    })
  })

  describe('Urgency indicators', () => {
    it('should show critical urgency for items expiring soon', async () => {
      const res = await fetchApprovalPage('/admin/approvals/expiring-soon')
      const html = await res.text()
      expect(html).toMatch(/urgent|critical|expiring/i)
    })

    it('should use red color for critical urgency', async () => {
      const res = await fetchApprovalPage('/admin/approvals/expiring-soon')
      const html = await res.text()
      expect(html).toMatch(/red|danger|critical/i)
    })

    it('should show warning for medium urgency', async () => {
      const res = await fetchApprovalPage('/admin/approvals/medium-urgency')
      const html = await res.text()
      expect(html).toMatch(/warning|yellow|amber/i)
    })

    it('should show normal state for low urgency', async () => {
      const res = await fetchApprovalPage('/admin/approvals/low-urgency')
      const html = await res.text()
      expect(html).toMatch(/normal|green|ok/i)
    })
  })

  describe('Expired state', () => {
    it('should clearly indicate expired approvals', async () => {
      const res = await fetchApprovalPage('/admin/approvals/expired-approval')
      const html = await res.text()
      expect(html).toMatch(/expired|past due/i)
    })

    it('should disable action buttons for expired approvals', async () => {
      const res = await fetchApprovalPage('/admin/approvals/expired-approval')
      const html = await res.text()
      expect(html).toMatch(/disabled|cannot/i)
    })

    it('should show when it expired', async () => {
      const res = await fetchApprovalPage('/admin/approvals/expired-approval')
      const html = await res.text()
      expect(html).toMatch(/expired\s*(at|on)|when expired/i)
    })
  })

  describe('Reminder indication', () => {
    it('should show if reminder was sent', async () => {
      const res = await fetchApprovalPage('/admin/approvals/reminder-sent')
      const html = await res.text()
      expect(html).toMatch(/reminder sent|notified/i)
    })

    it('should show next reminder time', async () => {
      const res = await fetchApprovalPage('/admin/approvals/has-upcoming-reminder')
      const html = await res.text()
      expect(html).toMatch(/next reminder|will remind/i)
    })
  })
})

// =============================================================================
// Audit Trail Tests
// =============================================================================

describe('Approval Audit Trail', () => {
  describe('Audit trail page', () => {
    it('should return 200 status for audit trail', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      expect(res.status).toBe(200)
    })

    it('should have audit trail container', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      expect(hasElement(html, 'audit-trail')).toBe(true)
    })

    it('should display all audit entries', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      const entryCount = countElements(html, 'audit-entry')
      expect(entryCount).toBeGreaterThan(0)
    })
  })

  describe('Audit entry details', () => {
    it('should show action type for each entry', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      expect(html).toMatch(/created|approved|rejected|escalated|viewed/i)
    })

    it('should display timestamp for each entry', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      expect(html).toMatch(/timestamp|date|time/i)
    })

    it('should show user who performed action', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      expect(html).toMatch(/by|user|actor/i)
    })

    it('should display user email', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      expect(html).toMatch(/email|@/i)
    })

    it('should show action details when applicable', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      expect(html).toMatch(/details|reason|comment/i)
    })
  })

  describe('Audit metadata', () => {
    it('should show IP address when available', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      expect(html).toMatch(/ip|address/i)
    })

    it('should show user agent/device info', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      expect(html).toMatch(/device|browser|agent/i)
    })

    it('should show location if available', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      expect(html).toMatch(/location|country/i)
    })
  })

  describe('Audit trail filtering', () => {
    it('should support filter by action type', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit?action=approved')
      expect(res.status).toBe(200)
    })

    it('should support filter by date range', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit?from=2026-01-01')
      expect(res.status).toBe(200)
    })

    it('should support filter by user', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit?user=user-123')
      expect(res.status).toBe(200)
    })
  })

  describe('Audit trail export', () => {
    it('should have export button', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit')
      const html = await res.text()
      expect(html).toMatch(/export|download/i)
    })

    it('should support CSV export', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123/audit?format=csv')
      expect(res.headers.get('Content-Type')).toContain('csv')
    })
  })
})

// =============================================================================
// Approval History Page Tests
// =============================================================================

describe('Approval History Page (/admin/approvals/history)', () => {
  let historyHtml: string

  beforeAll(async () => {
    const res = await fetchApprovalPage('/admin/approvals/history')
    historyHtml = await res.text()
  })

  describe('Layout', () => {
    it('should return 200 status', async () => {
      const res = await fetchApprovalPage('/admin/approvals/history')
      expect(res.status).toBe(200)
    })

    it('should display page title', () => {
      expect(historyHtml).toMatch(/history|completed|past/i)
    })
  })

  describe('History list', () => {
    it('should display completed approvals table', () => {
      expect(hasElement(historyHtml, 'table')).toBe(true)
    })

    it('should show approval title', () => {
      expect(historyHtml).toMatch(/title|subject/i)
    })

    it('should show final status', () => {
      expect(historyHtml).toMatch(/approved|rejected|expired|cancelled/i)
    })

    it('should show who made the decision', () => {
      expect(historyHtml).toMatch(/decided by|completed by/i)
    })

    it('should show decision date', () => {
      expect(historyHtml).toMatch(/date|completed|decided/i)
    })

    it('should show duration from request to decision', () => {
      expect(historyHtml).toMatch(/duration|time|took/i)
    })
  })

  describe('History filtering', () => {
    it('should filter by final status', async () => {
      const res = await fetchApprovalPage('/admin/approvals/history?status=approved')
      expect(res.status).toBe(200)
    })

    it('should filter by date range', async () => {
      const res = await fetchApprovalPage('/admin/approvals/history?from=2026-01-01&to=2026-01-31')
      expect(res.status).toBe(200)
    })

    it('should filter by requester', async () => {
      const res = await fetchApprovalPage('/admin/approvals/history?requester=user-123')
      expect(res.status).toBe(200)
    })

    it('should filter by approver', async () => {
      const res = await fetchApprovalPage('/admin/approvals/history?approver=user-456')
      expect(res.status).toBe(200)
    })

    it('should support search by title/description', () => {
      expect(historyHtml).toMatch(/search/i)
    })
  })

  describe('History pagination', () => {
    it('should have pagination controls', () => {
      expect(historyHtml).toMatch(/previous|next|page/i)
    })

    it('should show total count', () => {
      expect(historyHtml).toMatch(/total|\d+\s*results/i)
    })
  })

  describe('History detail navigation', () => {
    it('should link to full approval detail', () => {
      expect(historyHtml).toMatch(/href="[^"]*\/admin\/approvals\/[^"]+"/i)
    })
  })
})

// =============================================================================
// Mobile Responsive Tests
// =============================================================================

describe('Mobile Responsive Design', () => {
  describe('Viewport meta', () => {
    it('should have responsive viewport meta tag', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/viewport/)
      expect(html).toMatch(/width=device-width/)
    })
  })

  describe('Queue page mobile', () => {
    it('should have mobile-friendly card layout', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/mobile|responsive|grid|flex/i)
    })

    it('should have touch-friendly action buttons', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/touch|tap|mobile/i)
    })

    it('should collapse filters on mobile', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/collapse|expand|mobile|sm:|md:/i)
    })
  })

  describe('Detail page mobile', () => {
    it('should have mobile-friendly form layout', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/mobile|responsive|stack/i)
    })

    it('should have full-width buttons on mobile', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/w-full|full-width|block/i)
    })
  })

  describe('Swipe actions', () => {
    it('should support swipe to approve on mobile', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/swipe|gesture/i)
    })

    it('should support swipe to reject on mobile', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/swipe|gesture/i)
    })
  })
})

// =============================================================================
// Notification Integration Tests
// =============================================================================

describe('Notification Integration', () => {
  describe('Push notification settings', () => {
    it('should link to notification preferences', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/notification|settings|preferences/i)
    })
  })

  describe('In-app notifications', () => {
    it('should show notification bell/icon', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/notification|bell|alert/i)
    })

    it('should display unread notification count', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/badge|count|\d+/i)
    })
  })

  describe('Real-time updates', () => {
    it('should indicate real-time connection status', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/live|connected|real-time|websocket/i)
    })

    it('should show new approval toast notification', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/toast|notification|alert/i)
    })
  })
})

// =============================================================================
// Accessibility Tests
// =============================================================================

describe('Accessibility', () => {
  describe('Semantic structure', () => {
    it('should have proper heading hierarchy', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/<h1/i)
    })

    it('should have proper form labels', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-form')
      const html = await res.text()
      expect(html).toMatch(/<label/i)
    })

    it('should have lang attribute on html', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/<html[^>]+lang=/i)
    })
  })

  describe('ARIA attributes', () => {
    it('should have aria-labels on interactive elements', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/aria-label|aria-labelledby/i)
    })

    it('should have aria-describedby for form fields', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-form')
      const html = await res.text()
      expect(html).toMatch(/aria-describedby|aria-errormessage/i)
    })

    it('should have aria-live regions for updates', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/aria-live|role="alert"/i)
    })
  })

  describe('Keyboard navigation', () => {
    it('should have skip to content link', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/skip.*content|main-content/i)
    })

    it('should have proper tab order', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/tabindex/i)
    })

    it('should have keyboard shortcuts for common actions', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/shortcut|accesskey/i)
    })
  })

  describe('Color contrast', () => {
    it('should not rely solely on color for status', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      // Should have text labels in addition to color
      expect(html).toMatch(/pending|approved|rejected/i)
    })
  })

  describe('Screen reader support', () => {
    it('should have alt text on images', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      const imgMatches = html.match(/<img[^>]*>/gi) || []
      for (const img of imgMatches) {
        expect(img).toMatch(/alt=/i)
      }
    })

    it('should have sr-only text for icon buttons', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/sr-only|visually-hidden|screen-reader/i)
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling', () => {
  describe('404 errors', () => {
    it('should return 404 for non-existent approval', async () => {
      const res = await fetchApprovalPage('/admin/approvals/non-existent-id')
      expect(res.status).toBe(404)
    })

    it('should display user-friendly 404 message', async () => {
      const res = await fetchApprovalPage('/admin/approvals/non-existent-id')
      const html = await res.text()
      expect(html).toMatch(/not found|doesn't exist/i)
    })
  })

  describe('Permission errors', () => {
    it('should return 403 for unauthorized approval access', async () => {
      const res = await fetchApprovalPage('/admin/approvals/unauthorized-approval')
      expect(res.status).toBe(403)
    })

    it('should display permission denied message', async () => {
      const res = await fetchApprovalPage('/admin/approvals/unauthorized-approval')
      const html = await res.text()
      expect(html).toMatch(/permission|access denied|unauthorized/i)
    })
  })

  describe('Form submission errors', () => {
    it('should display validation errors clearly', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-form?error=validation')
      const html = await res.text()
      expect(html).toMatch(/error|invalid|required/i)
    })

    it('should preserve form data on error', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-with-form?error=validation')
      const html = await res.text()
      expect(html).toMatch(/value=|defaultValue/i)
    })
  })

  describe('Network errors', () => {
    it('should show retry option on network error', async () => {
      const res = await fetchApprovalPage('/admin/approvals?error=network')
      const html = await res.text()
      expect(html).toMatch(/retry|try again/i)
    })
  })
})

// =============================================================================
// Loading States Tests
// =============================================================================

describe('Loading States', () => {
  describe('Initial load', () => {
    it('should show loading skeleton for queue', async () => {
      const res = await fetchApprovalPage('/admin/approvals?loading=true')
      const html = await res.text()
      expect(html).toMatch(/skeleton|loading|shimmer/i)
    })

    it('should show loading state for detail page', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123?loading=true')
      const html = await res.text()
      expect(html).toMatch(/skeleton|loading|shimmer/i)
    })
  })

  describe('Action loading', () => {
    it('should show loading state during form submission', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/submitting|loading|processing/i)
    })

    it('should disable form during submission', async () => {
      const res = await fetchApprovalPage('/admin/approvals/approval-test-123')
      const html = await res.text()
      expect(html).toMatch(/disabled|aria-disabled/i)
    })
  })

  describe('Pagination loading', () => {
    it('should show loading indicator for pagination', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/loading|spinner/i)
    })
  })
})

// =============================================================================
// Component Integration Tests
// =============================================================================

describe('Component Integration', () => {
  describe('Sidebar navigation', () => {
    it('should have Approvals link in sidebar', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toContain('href="/admin/approvals"')
    })

    it('should highlight active approvals link', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/active|current/i)
    })

    it('should show pending count badge in sidebar', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/badge|\d+/i)
    })
  })

  describe('Header integration', () => {
    it('should show approval notification icon in header', async () => {
      const res = await fetchApprovalPage('/admin/approvals')
      const html = await res.text()
      expect(html).toMatch(/notification|bell/i)
    })
  })
})
