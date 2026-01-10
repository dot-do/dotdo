/**
 * Entity Collection Definitions
 *
 * TanStack DB collection definitions for all dotdo entities.
 * Each collection uses dotdoCollectionOptions to connect to the
 * real-time sync infrastructure via WebSocket.
 */

import { dotdoCollectionOptions } from '../../db/tanstack/collection'
import { z } from 'zod'

// =============================================================================
// Environment Configuration
// =============================================================================

const DO_URL = import.meta.env.VITE_DO_URL || ''

// =============================================================================
// User Collection
// =============================================================================

export const UserSchema = z.object({
  $id: z.string(),
  $type: z.literal('User'),
  name: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().optional(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type User = z.infer<typeof UserSchema>

export const usersCollection = dotdoCollectionOptions({
  doUrl: DO_URL,
  collection: 'User',
  schema: UserSchema,
})

// =============================================================================
// Sandbox Collection
// =============================================================================

export const SandboxSchema = z.object({
  $id: z.string(),
  $type: z.literal('Sandbox'),
  name: z.string(),
  description: z.string().optional(),
  ownerId: z.string(),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  runtime: z.enum(['v8', 'deno', 'node']).default('v8'),
  memory: z.number().default(128), // MB
  timeout: z.number().default(30000), // ms
  env: z.record(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Sandbox = z.infer<typeof SandboxSchema>

export const sandboxesCollection = dotdoCollectionOptions({
  doUrl: DO_URL,
  collection: 'Sandbox',
  schema: SandboxSchema,
})

// =============================================================================
// Workflow Collection
// =============================================================================

export const WorkflowSchema = z.object({
  $id: z.string(),
  $type: z.literal('Workflow'),
  name: z.string(),
  description: z.string().optional(),
  ownerId: z.string(),
  sandboxId: z.string().nullable(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'failed']).default('draft'),
  trigger: z.object({
    type: z.enum(['manual', 'schedule', 'event', 'webhook']),
    config: z.record(z.unknown()).optional(),
  }),
  steps: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['action', 'condition', 'loop', 'parallel']),
    config: z.record(z.unknown()),
  })).default([]),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Workflow = z.infer<typeof WorkflowSchema>

export const workflowsCollection = dotdoCollectionOptions({
  doUrl: DO_URL,
  collection: 'Workflow',
  schema: WorkflowSchema,
})

// =============================================================================
// Browser Collection (Virtual Chrome Tabs)
// =============================================================================

export const BrowserSchema = z.object({
  $id: z.string(),
  $type: z.literal('Browser'),
  name: z.string(),
  url: z.string().url().optional(),
  sandboxId: z.string(),
  status: z.enum(['idle', 'loading', 'ready', 'error']).default('idle'),
  viewport: z.object({
    width: z.number().default(1280),
    height: z.number().default(720),
  }).default({ width: 1280, height: 720 }),
  userAgent: z.string().optional(),
  cookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string().default('/'),
    expires: z.number().optional(),
  })).default([]),
  localStorage: z.record(z.string()).default({}),
  sessionStorage: z.record(z.string()).default({}),
  lastActivityAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Browser = z.infer<typeof BrowserSchema>

export const browsersCollection = dotdoCollectionOptions({
  doUrl: DO_URL,
  collection: 'Browser',
  schema: BrowserSchema,
})

// =============================================================================
// Integration Collection
// =============================================================================

export const IntegrationSchema = z.object({
  $id: z.string(),
  $type: z.literal('Integration'),
  name: z.string(),
  provider: z.string(), // e.g., 'github', 'slack', 'stripe'
  ownerId: z.string(),
  status: z.enum(['pending', 'connected', 'disconnected', 'error']).default('pending'),
  config: z.record(z.unknown()).default({}),
  credentials: z.object({
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    expiresAt: z.string().optional(),
    apiKey: z.string().optional(),
  }).optional(),
  scopes: z.array(z.string()).default([]),
  webhookUrl: z.string().optional(),
  lastSyncAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Integration = z.infer<typeof IntegrationSchema>

export const integrationsCollection = dotdoCollectionOptions({
  doUrl: DO_URL,
  collection: 'Integration',
  schema: IntegrationSchema,
})

// =============================================================================
// Approval Collection (Human Escalation)
// =============================================================================

export const ApprovalSchema = z.object({
  $id: z.string(),
  $type: z.literal('Approval'),
  title: z.string(),
  description: z.string().optional(),
  workflowId: z.string().nullable(),
  requesterId: z.string(), // Agent or user who requested
  approverId: z.string().nullable(), // Human who should approve
  status: z.enum(['pending', 'approved', 'rejected', 'expired']).default('pending'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  sla: z.string().optional(), // e.g., '4 hours', '1 day'
  dueAt: z.string().nullable(),
  context: z.record(z.unknown()).default({}), // Additional context for decision
  decision: z.object({
    outcome: z.enum(['approved', 'rejected']),
    reason: z.string().optional(),
    decidedBy: z.string(),
    decidedAt: z.string(),
  }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Approval = z.infer<typeof ApprovalSchema>

export const approvalsCollection = dotdoCollectionOptions({
  doUrl: DO_URL,
  collection: 'Approval',
  schema: ApprovalSchema,
})

// =============================================================================
// Re-export all collections
// =============================================================================

export const collections = {
  users: usersCollection,
  sandboxes: sandboxesCollection,
  workflows: workflowsCollection,
  browsers: browsersCollection,
  integrations: integrationsCollection,
  approvals: approvalsCollection,
} as const
