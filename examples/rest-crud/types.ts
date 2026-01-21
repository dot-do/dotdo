// REST CRUD Example - Type definitions

/**
 * A task entity - the main resource in this example
 */
export interface Task {
  $type: 'Task'
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  assigneeId?: string
  tags: string[]
  createdAt: string
  updatedAt?: string
  completedAt?: string
}

/**
 * A project that contains tasks
 */
export interface Project {
  $type: 'Project'
  name: string
  description?: string
  status: 'active' | 'archived'
  color?: string
  createdAt: string
  updatedAt?: string
}

/**
 * A user in the system
 */
export interface User {
  $type: 'User'
  email: string
  name: string
  avatar?: string
  role: 'admin' | 'member' | 'viewer'
  createdAt: string
  lastActiveAt?: string
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Pagination parameters
 */
export interface PaginationParams {
  limit?: number
  offset?: number
  cursor?: string
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

/**
 * Task creation request
 */
export interface CreateTaskRequest {
  title: string
  description?: string
  priority?: Task['priority']
  dueDate?: string
  assigneeId?: string
  projectId?: string
  tags?: string[]
}

/**
 * Task update request
 */
export interface UpdateTaskRequest {
  title?: string
  description?: string
  status?: Task['status']
  priority?: Task['priority']
  dueDate?: string
  assigneeId?: string
  tags?: string[]
}

/**
 * Task filter parameters
 */
export interface TaskFilters {
  status?: Task['status']
  priority?: Task['priority']
  assigneeId?: string
  projectId?: string
  tag?: string
  search?: string
}

/**
 * Bulk operation request
 */
export interface BulkUpdateRequest {
  ids: string[]
  update: UpdateTaskRequest
}

/**
 * Bulk operation response
 */
export interface BulkUpdateResponse {
  updated: number
  failed: string[]
}
