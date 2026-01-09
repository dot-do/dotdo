/**
 * Approval Types for HumanFunction UI
 *
 * Types used across the approval portal for displaying and managing
 * human approval workflows.
 */

// =============================================================================
// Form Field Types
// =============================================================================

export interface FormFieldDefinition {
  name: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'textarea' | 'date' | 'file'
  label: string
  required?: boolean
  options?: string[]
  default?: unknown
  placeholder?: string
  description?: string
  validation?: {
    min?: number
    max?: number
    minLength?: number
    maxLength?: number
    pattern?: string
  }
}

export interface FormDefinition {
  fields: FormFieldDefinition[]
}

// =============================================================================
// Approval Request Types
// =============================================================================

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'escalated'
export type ApprovalPriority = 'low' | 'normal' | 'high' | 'critical'
export type ApprovalChannel = 'slack' | 'email' | 'in-app' | 'custom'
export type RequesterType = 'agent' | 'human' | 'workflow'

export interface Requester {
  id: string
  name: string
  email: string
  avatar?: string
  type?: RequesterType
}

export interface Assignee {
  id: string
  name: string
  email: string
}

export interface ApprovalAction {
  value: string
  label: string
  style?: 'primary' | 'danger' | 'default'
  requiresReason?: boolean
}

export interface ApprovalLevel {
  name: string
  users: string[]
  status: 'pending' | 'completed' | 'skipped'
  completedBy?: string
  completedAt?: Date
  action?: string
}

export interface ApprovalWorkflow {
  type: 'sequential' | 'parallel' | 'conditional'
  currentLevel?: number
  totalLevels?: number
  levels?: ApprovalLevel[]
  approvals?: Array<{
    userId: string
    userName: string
    action: string
    timestamp: Date
    level?: string
  }>
  requiredApprovals?: number
}

export interface EscalationInfo {
  level: number
  maxLevel: number
  escalatedAt: Date
  escalatedTo: string
  reason: string
  history?: Array<{
    level: number
    from: string
    to: string
    timestamp: Date
    reason: string
  }>
}

export interface ReminderInfo {
  sentAt?: Date
  nextAt?: Date
  message?: string
}

export interface ApprovalContext {
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

export interface ApprovalRequest {
  id: string
  taskId: string
  type: string
  title: string
  description: string
  requester: Requester
  assignee?: Assignee
  status: ApprovalStatus
  priority: ApprovalPriority
  createdAt: Date
  expiresAt?: Date
  escalationLevel?: number
  channel: ApprovalChannel
  data: Record<string, unknown>
  form?: FormDefinition
  actions?: ApprovalAction[]
  context?: ApprovalContext
  approvalWorkflow?: ApprovalWorkflow
  escalation?: EscalationInfo
  reminder?: ReminderInfo
  timeRemaining?: number
}

// =============================================================================
// Approval History Types
// =============================================================================

export interface AuditLogEntry {
  id: string
  timestamp: Date
  action: 'view' | 'approve' | 'reject' | 'escalate' | 'expire' | 'comment' | 'reassign' | 'create'
  userId: string
  userName: string
  userEmail: string
  approvalId?: string
  details?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
  location?: string
}

export interface ApprovalHistoryItem {
  id: string
  taskId: string
  type: string
  title: string
  description: string
  requester: {
    id: string
    name: string
    type: RequesterType
  }
  status: 'approved' | 'rejected' | 'expired' | 'cancelled'
  priority: ApprovalPriority
  createdAt: Date
  completedAt: Date
  completedBy: {
    id: string
    name: string
    email: string
  }
  duration: number // milliseconds
  escalationCount: number
  auditLog: AuditLogEntry[]
  outcome?: {
    action: string
    reason?: string
    formData?: Record<string, unknown>
  }
  workflow?: {
    type: 'sequential' | 'parallel' | 'conditional'
    levels?: Array<{
      name: string
      completedBy?: string
      completedAt?: Date
      action?: string
    }>
  }
}

// =============================================================================
// Notification Types
// =============================================================================

export type NotificationType = 'new' | 'reminder' | 'escalation' | 'expiring' | 'completed'
export type NotificationChannel = 'push' | 'email' | 'sms' | 'in-app'

export interface ApprovalNotification {
  id: string
  approvalId: string
  type: NotificationType
  title: string
  message: string
  priority: ApprovalPriority
  createdAt: Date
  read: boolean
  channel: NotificationChannel
  actionUrl?: string
  expiresIn?: number // milliseconds
}

export interface NotificationPreferences {
  channels: {
    push: boolean
    email: boolean
    sms: boolean
    inApp: boolean
  }
  priorities: {
    low: boolean
    normal: boolean
    high: boolean
    critical: boolean
  }
  quiet_hours?: {
    enabled: boolean
    start: string // HH:MM
    end: string // HH:MM
    timezone: string
  }
}

// =============================================================================
// Filter and Sort Types
// =============================================================================

export interface ApprovalFilters {
  status?: ApprovalStatus
  priority?: ApprovalPriority
  type?: string
  search?: string
  fromDate?: string
  toDate?: string
  assignee?: string
  completedBy?: string
}

export interface ApprovalSort {
  sortBy: 'createdAt' | 'priority' | 'expiresAt' | 'title' | 'completedAt'
  sortOrder: 'asc' | 'desc'
}

export interface PaginationInfo {
  page: number
  pageSize: number
  total: number
  totalPages: number
}
