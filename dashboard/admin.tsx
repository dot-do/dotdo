/**
 * DO Dashboard Admin Factory (Web UI)
 *
 * Creates a React component for web-based administration of Durable Objects.
 * The Admin() factory returns a React component that provides the same
 * introspection capabilities as the REST API and CLI Dashboard, rendered
 * as a rich browser UI.
 *
 * Three outputs from one codebase:
 * - REST API (JSON + HATEOAS links)
 * - CLI Dashboard (terminal UI)
 * - Web Admin (browser UI) <-- This module
 *
 * @example
 * ```tsx
 * import { Admin } from 'dotdo/dashboard'
 *
 * // Basic usage
 * const Dashboard = Admin()
 * export default Dashboard
 *
 * // With configuration
 * const Dashboard = Admin({
 *   config: './do.config.ts',
 *   ns: 'my-namespace',
 *   debug: true,
 * })
 * ```
 *
 * @module dashboard/admin
 */

import type { FC, ReactNode } from 'react'

// ============================================================================
// OPTIONS AND CONFIGURATION
// ============================================================================

/**
 * Configuration options for the Admin dashboard
 */
export interface AdminOptions {
  /**
   * Path to do.config.ts file
   * Defaults to looking in CWD for do.config.ts
   */
  config?: string

  /**
   * Namespace for the dashboard
   * Used for generating links and context
   */
  ns?: string

  /**
   * Enable debug mode
   * Adds additional logging and debug UI elements
   */
  debug?: boolean

  /**
   * Custom theme configuration
   */
  theme?: 'light' | 'dark' | 'system'

  /**
   * Base path for routing
   * @default '/admin'
   */
  basePath?: string

  /**
   * API endpoint URL
   * @default '/api'
   */
  apiUrl?: string
}

// ============================================================================
// NAVIGATOR TYPES
// ============================================================================

/**
 * Navigator sections in the dashboard
 */
export type NavigatorSection = 'Schema' | 'Data' | 'Compute' | 'Platform' | 'Storage'

/**
 * Navigator section configuration
 */
export interface SectionConfig {
  name: NavigatorSection
  icon: string
  label: string
  description?: string
}

// ============================================================================
// SCHEMA TYPES
// ============================================================================

/**
 * Property schema from $introspect
 */
export interface PropertySchema {
  type: string
  required?: boolean
  description?: string
  format?: string
  enum?: string[]
  default?: unknown
}

/**
 * Type definition from $introspect
 */
export interface TypeDefinition {
  name: string
  type: 'thing' | 'collection' | 'entity'
  properties: Record<string, PropertySchema>
  actions?: string[]
  description?: string
}

// ============================================================================
// DATA TYPES
// ============================================================================

/**
 * Paginated list response
 */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  hasNext: boolean
  hasPrev: boolean
}

/**
 * Data item with metadata
 */
export interface DataItem {
  id: string
  type: string
  data: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

// ============================================================================
// FORM TYPES
// ============================================================================

/**
 * Form field configuration
 */
export interface FormField {
  name: string
  type: string
  label: string
  required: boolean
  description?: string
  placeholder?: string
  options?: Array<{ value: string; label: string }>
  validation?: {
    min?: number
    max?: number
    pattern?: string
    message?: string
  }
}

/**
 * Form state
 */
export interface FormState {
  values: Record<string, unknown>
  errors: Record<string, string>
  touched: Record<string, boolean>
  isSubmitting: boolean
  isValid: boolean
}

// ============================================================================
// NAVIGATION TYPES
// ============================================================================

/**
 * Breadcrumb item
 */
export interface BreadcrumbItem {
  label: string
  href?: string
  current?: boolean
}

/**
 * Route state
 */
export interface RouteState {
  section: NavigatorSection
  type?: string
  id?: string
  action?: 'list' | 'view' | 'create' | 'edit'
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

/**
 * Dashboard layout props
 */
export interface DashboardLayoutProps {
  children?: ReactNode
  sidebar?: ReactNode
  header?: ReactNode
}

/**
 * Navigator props
 */
export interface NavigatorProps {
  sections: SectionConfig[]
  activeSection: NavigatorSection
  onSectionChange: (section: NavigatorSection) => void
}

/**
 * Content area props
 */
export interface ContentAreaProps {
  section: NavigatorSection
  type?: string
  id?: string
  action?: 'list' | 'view' | 'create' | 'edit'
}

/**
 * Data list props
 */
export interface DataListProps {
  type: string
  items: DataItem[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onItemClick: (item: DataItem) => void
}

/**
 * Data detail props
 */
export interface DataDetailProps {
  type: string
  item: DataItem
  schema: TypeDefinition
  onEdit: () => void
  onDelete: () => void
}

/**
 * Form props
 */
export interface DataFormProps {
  type: string
  schema: TypeDefinition
  initialValues?: Record<string, unknown>
  onSubmit: (values: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook for accessing dashboard context
 */
export interface AdminContext {
  options: AdminOptions
  schema: TypeDefinition[]
  currentSection: NavigatorSection
  routeState: RouteState
  isLoading: boolean
  error: Error | null
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a DO Dashboard Admin component
 *
 * @param options - Configuration options
 * @returns React component for the admin dashboard
 *
 * @example
 * ```tsx
 * import { Admin } from 'dotdo/dashboard'
 *
 * const Dashboard = Admin({ ns: 'production' })
 *
 * function App() {
 *   return <Dashboard />
 * }
 * ```
 */
export function Admin(options?: AdminOptions): FC {
  throw new Error('Not implemented: Admin')
}

// ============================================================================
// COMPONENT EXPORTS (stubs)
// ============================================================================

/**
 * Dashboard layout component
 */
export function DashboardLayout(_props: DashboardLayoutProps): JSX.Element {
  throw new Error('Not implemented: DashboardLayout')
}

/**
 * Navigator sidebar component
 */
export function Navigator(_props: NavigatorProps): JSX.Element {
  throw new Error('Not implemented: Navigator')
}

/**
 * Content area component
 */
export function ContentArea(_props: ContentAreaProps): JSX.Element {
  throw new Error('Not implemented: ContentArea')
}

/**
 * Breadcrumb navigation component
 */
export function Breadcrumbs(_props: { items: BreadcrumbItem[] }): JSX.Element {
  throw new Error('Not implemented: Breadcrumbs')
}

/**
 * Data list view component
 */
export function DataList(_props: DataListProps): JSX.Element {
  throw new Error('Not implemented: DataList')
}

/**
 * Data detail view component
 */
export function DataDetail(_props: DataDetailProps): JSX.Element {
  throw new Error('Not implemented: DataDetail')
}

/**
 * Schema type view component
 */
export function SchemaTypeView(_props: { type: TypeDefinition }): JSX.Element {
  throw new Error('Not implemented: SchemaTypeView')
}

/**
 * Data form component (create/edit)
 */
export function DataForm(_props: DataFormProps): JSX.Element {
  throw new Error('Not implemented: DataForm')
}

/**
 * Loading spinner component
 */
export function LoadingSpinner(): JSX.Element {
  throw new Error('Not implemented: LoadingSpinner')
}

/**
 * Error boundary component
 */
export function ErrorBoundary(_props: { children: ReactNode; fallback?: ReactNode }): JSX.Element {
  throw new Error('Not implemented: ErrorBoundary')
}

// ============================================================================
// HOOK EXPORTS (stubs)
// ============================================================================

/**
 * Hook to access admin context
 */
export function useAdmin(): AdminContext {
  throw new Error('Not implemented: useAdmin')
}

/**
 * Hook to access schema from $introspect
 */
export function useSchema(): { schema: TypeDefinition[]; isLoading: boolean; error: Error | null } {
  throw new Error('Not implemented: useSchema')
}

/**
 * Hook to fetch data items
 */
export function useDataList(
  type: string,
  options?: { page?: number; pageSize?: number; filter?: Record<string, unknown> }
): { data: PaginatedResponse<DataItem> | null; isLoading: boolean; error: Error | null; refetch: () => void } {
  throw new Error('Not implemented: useDataList')
}

/**
 * Hook to fetch a single data item
 */
export function useDataItem(
  type: string,
  id: string
): { data: DataItem | null; isLoading: boolean; error: Error | null; refetch: () => void } {
  throw new Error('Not implemented: useDataItem')
}

/**
 * Hook to mutate data
 */
export function useDataMutation(
  type: string
): {
  create: (data: Record<string, unknown>) => Promise<DataItem>
  update: (id: string, data: Record<string, unknown>) => Promise<DataItem>
  remove: (id: string) => Promise<void>
  isLoading: boolean
  error: Error | null
} {
  throw new Error('Not implemented: useDataMutation')
}

/**
 * Hook for navigation state
 */
export function useNavigation(): {
  routeState: RouteState
  navigate: (route: Partial<RouteState>) => void
  goBack: () => void
  breadcrumbs: BreadcrumbItem[]
} {
  throw new Error('Not implemented: useNavigation')
}

// Default export for convenience
export default Admin
