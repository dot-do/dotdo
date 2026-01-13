/**
 * Human Graph Module
 *
 * Unified graph model for Users, Organizations, Roles, Sessions, and human-in-the-loop
 * approval workflows. Integrates with better-auth for authentication.
 *
 * @module db/graph/humans
 *
 * @example
 * ```typescript
 * import {
 *   // User operations
 *   createUser, getUser, getUserByEmail,
 *   // Organization operations
 *   createOrg, addMember, getOrgMembers, createInvitation,
 *   // Role operations
 *   createRole, assignRole, checkRolePermission,
 *   // Approval workflows
 *   createApprovalRequest, approve, reject, escalateApproval,
 * } from 'db/graph/humans'
 *
 * // Create a user
 * const user = await createUser(graph, { email: 'alice@example.com', name: 'Alice' })
 *
 * // Create an organization and add the user
 * const org = await createOrg(graph, { name: 'Acme Inc', slug: 'acme' })
 * await addMember(graph, user.id, org.id, { role: 'admin' })
 *
 * // Create an approval request (for ceo`approve partnership` pattern)
 * const { thing, relationship } = await createApprovalRequest(graph, {
 *   title: 'Partnership Approval',
 *   message: 'Please approve the partnership with BigCorp',
 *   type: 'approval',
 *   priority: 'high',
 *   targetRole: 'ceo',
 *   requesterId: user.id,
 *   sla: 4 * 60 * 60 * 1000, // 4 hours
 * })
 *
 * // Approve the request
 * await approve(graph, thing.id, ceoUserId, 'Looks good!')
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

export {
  // Constants
  HUMAN_TYPE_IDS,
  HUMAN_TYPE_NAMES,
  HUMAN_VERBS,
  HumanUrls,

  // Status types
  type UserStatus,
  type OrgStatus,
  type InvitationStatus,
  type ApprovalStatus,
  type NotificationPriority,
  type NotificationChannelType,

  // User types
  type UserThingData,
  type NotificationPreferences,

  // Organization types
  type OrgThingData,
  type OrgSettings,
  type OrgMembershipData,

  // Role types
  type PermissionString,
  type HierarchyLevel,
  type RoleThingData,
  type RoleAssignmentData,

  // Session types
  type SessionThingData,

  // Account types
  type AccountThingData,

  // Invitation types
  type InvitationThingData,

  // Approval types
  type ApprovalRequestThingData,
  type ApprovalResponse,

  // Task request types
  type TaskRequestThingData,
  type TaskState,
  type TaskTimestamps,
  type TaskResponse,

  // Decision request types
  type DecisionRequestThingData,
  type DecisionOption,
  type DecisionTimestamps,
  type DecisionResult,

  // Review request types
  type ReviewRequestThingData,
  type ReviewType,
  type ReviewTimestamps,
  type ReviewResult,
  type ReviewIssue,

  // SLA types
  type SLAConfiguration,
  DEFAULT_SLA_CONFIG,

  // Union types
  type HumanRequestThingData,

  // Notification types
  type NotificationDeliveryData,

  // Escalation types
  type EscalationData,

  // Team types
  type TeamThingData,

  // Type guards
  isUserThingData,
  isOrgThingData,
  isRoleThingData,
  isApprovalRequestThingData,
  isTaskRequestThingData,
  isDecisionRequestThingData,
  isReviewRequestThingData,
  isHumanRequestThingData,
} from './types'

// ============================================================================
// USER OPERATIONS
// ============================================================================

// Re-export from parent user.ts (existing implementation)
export {
  USER_TYPE_ID,
  USER_TYPE_NAME,
  createUser,
  getUser,
  getUserByEmail,
  getUserByExternalId,
  listUsers,
  updateUser,
  deleteUser,
  touchUser,
  recordUserSignIn,
  suspendUser,
  reactivateUser,
  assignUserRole,
  removeUserRole,
  getUserRoles,
  userHasRole,
  addUserToOrg,
  removeUserFromOrg,
  getUserOrganizations,
  isUserMemberOf,
  getUserOrgRole,
  followUser,
  unfollowUser,
  getFollowing,
  getFollowers,
  isFollowing,
  getUserProfile,
  updateUserProfile,
  getUserStats,
  getOrgUsers,
  getUsersWithRole,
} from '../user'

// ============================================================================
// ORGANIZATION OPERATIONS
// ============================================================================

export {
  ORG_TYPE_ID,
  ORG_TYPE_NAME,
  INVITATION_TYPE_ID,
  INVITATION_TYPE_NAME,
  // Organization CRUD
  createOrg,
  getOrg,
  getOrgBySlug,
  listOrgs,
  updateOrg,
  deleteOrg,
  suspendOrg,
  reactivateOrg,
  // Membership
  addMember,
  removeMember,
  updateMember,
  getOrgMembers,
  getUserOrgs,
  isMember,
  getMemberRole,
  getMemberCount,
  // Invitations
  createInvitation,
  getInvitation,
  getInvitationByToken,
  getPendingInvitations,
  acceptInvitation,
  declineInvitation,
  cancelInvitation,
  // Ownership
  setOrgOwner,
  getOrgOwner,
  // Statistics
  getOrgStats,
} from './organization'

// ============================================================================
// ROLE OPERATIONS
// ============================================================================

// Re-export from parent role.ts (existing implementation)
export {
  ROLE_TYPE_ID,
  ROLE_TYPE_NAME,
  HAS_ROLE_VERB,
  createRole,
  getRole,
  getRoleByName,
  listRoles,
  updateRole,
  deleteRole,
  assignRole,
  removeRole,
  getEntityRoles,
  getEntitiesWithRole,
  entityHasRole,
  checkRolePermission,
  checkRolePermissions,
  checkRoleHierarchy,
  getEffectiveRoleAccess,
  type RolePermissionResult,
} from '../role'

// ============================================================================
// APPROVAL WORKFLOW OPERATIONS
// ============================================================================

export {
  APPROVAL_TYPE_ID,
  APPROVAL_TYPE_NAME,
  VERB_TO_STATUS,
  STATUS_TO_VERB,
  // Request CRUD
  createApprovalRequest,
  getApprovalRequest,
  getApprovalStatus,
  // State transitions
  startReview,
  completeApproval,
  approve,
  reject,
  cancelApproval,
  // Queries
  getPendingApprovals,
  getPendingApprovalsForRole,
  getApprovalHistory,
  getRequestedApprovals,
  // Escalation
  escalateApproval,
  getEscalationChain,
  // Notifications
  recordNotificationDelivery,
  getNotificationHistory,
  // SLA
  checkSLABreach,
  expireApproval,
  getBreachedSLARequests,
  // Metrics
  getApproverMetrics,
} from './approval'

// ============================================================================
// HUMAN-IN-THE-LOOP OPERATIONS (Task, Decision, Review)
// ============================================================================

export {
  // Type exports
  type HumanRequestType,
  type CreateHumanRequestBase,
  type CreateTaskRequestInput,
  type CreateDecisionRequestInput,
  type CreateReviewRequestInput,
  type SLAStatus,
  type EscalationTarget,
  // Constants
  REQUEST_TYPE_IDS,
  REQUEST_TYPE_NAMES,
  REQUEST_VERB_FORMS,
  // Verb form state machine
  getStateFromVerb,
  transitionVerb,
  // Task operations
  createTaskRequest,
  getTaskRequest,
  assignTask,
  startTask,
  completeTask,
  escalateTaskRequest,
  getTaskEscalationChain,
  getPendingTasks,
  getTaskSLAStatus,
  // Decision operations
  createDecisionRequest,
  getDecisionRequest,
  startDecision,
  makeDecision,
  getPendingDecisions,
  getDecisionSLAStatus,
  // Review operations
  createReviewRequest,
  getReviewRequest,
  startReviewRequest,
  completeReview,
  getPendingReviews,
  getReviewSLAStatus,
  // SLA tracking
  calculateSLAStatus,
  calculateTimeMetrics,
  // Notification tracking
  recordRequestNotification,
  getRequestNotificationHistory,
  // Unified queries
  getAllPendingRequests,
} from './hitl'

// ============================================================================
// GRAPH AUTH ADAPTER (better-auth integration)
// ============================================================================

// Re-export from auth/adapters/graph.ts
export {
  createGraphAuthAdapter,
  graphAuthAdapter,
  type User,
  type Session,
  type Account,
  type GraphAuthAdapter,
} from '../../../auth/adapters/graph'

// ============================================================================
// ESCALATION CHAIN GRAPH
// ============================================================================

// Re-export from parent escalation-chain-graph.ts
export {
  EscalationChainGraph,
  TIER_ORDER,
  ESCALATION_LABELS,
  ESCALATION_EDGES,
  type EscalationChainNode,
  type EscalationStepNode,
  type EscalationTargetNode,
  type FindNextTargetOptions,
  type ChainTraversalOptions,
  type EscalationChainMetrics,
  type EscalationPattern,
} from '../escalation-chain-graph'

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

import type { GraphStore, GraphThing } from '../types'
import { createUser, getUser } from '../user'
import { createOrg, getOrg, addMember, type OrgMembershipData } from './organization'
import { createRole, assignRole, type RoleThingData } from '../role'
import type { UserThingData, OrgThingData } from './types'

/**
 * Create a user with an organization in one operation
 */
export async function createUserWithOrg(
  graph: GraphStore,
  userData: Partial<UserThingData> & { email: string },
  orgData: OrgThingData,
  options?: { role?: string }
): Promise<{ user: GraphThing; org: GraphThing; membership: OrgMembershipData }> {
  // Create user
  const user = await createUser(graph, {
    email: userData.email,
    name: userData.name ?? null,
    displayName: userData.displayName ?? null,
    status: userData.status ?? 'active',
    emailVerified: userData.emailVerified,
    avatarUrl: userData.avatarUrl ?? null,
    metadata: userData.metadata,
  })

  // Create org
  const org = await createOrg(graph, orgData)

  // Add user as member with role
  const membership: OrgMembershipData = {
    role: options?.role ?? 'owner',
    joinedAt: Date.now(),
  }
  await addMember(graph, user.id, org.id, membership)

  return { user, org, membership }
}

/**
 * Create standard roles for an organization
 */
export async function createStandardRoles(
  graph: GraphStore,
  orgId?: string
): Promise<{ owner: GraphThing; admin: GraphThing; member: GraphThing; viewer: GraphThing }> {
  const baseData = { orgId: orgId ?? null }

  const owner = await createRole(graph, {
    name: 'owner',
    permissions: ['*:*'],
    description: 'Full access to all resources',
    hierarchyLevel: 100,
    isSystem: true,
    ...baseData,
  } as RoleThingData)

  const admin = await createRole(graph, {
    name: 'admin',
    permissions: ['read:*', 'write:*', 'delete:*', 'admin:settings'],
    description: 'Administrative access',
    hierarchyLevel: 80,
    isSystem: true,
    ...baseData,
  } as RoleThingData)

  const member = await createRole(graph, {
    name: 'member',
    permissions: ['read:*', 'write:own'],
    description: 'Standard member access',
    hierarchyLevel: 40,
    isSystem: true,
    ...baseData,
  } as RoleThingData)

  const viewer = await createRole(graph, {
    name: 'viewer',
    permissions: ['read:*'],
    description: 'Read-only access',
    hierarchyLevel: 10,
    isSystem: true,
    ...baseData,
  } as RoleThingData)

  return { owner, admin, member, viewer }
}

/**
 * Human role templates for approval workflows
 *
 * These map to the template literal patterns: ceo`approve`, legal`review`, etc.
 */
export const HUMAN_ROLE_TEMPLATES = {
  ceo: {
    name: 'ceo',
    permissions: ['approve:*', 'review:*', 'admin:*'],
    description: 'Chief Executive Officer - final authority',
    hierarchyLevel: 100,
    defaultSla: 4 * 60 * 60 * 1000, // 4 hours
    escalatesTo: null, // No escalation from CEO
  },
  cfo: {
    name: 'cfo',
    permissions: ['approve:financial', 'review:financial', 'admin:financial'],
    description: 'Chief Financial Officer - financial authority',
    hierarchyLevel: 90,
    defaultSla: 8 * 60 * 60 * 1000, // 8 hours
    escalatesTo: 'ceo',
  },
  cto: {
    name: 'cto',
    permissions: ['approve:technical', 'review:technical', 'admin:technical'],
    description: 'Chief Technology Officer - technical authority',
    hierarchyLevel: 90,
    defaultSla: 8 * 60 * 60 * 1000, // 8 hours
    escalatesTo: 'ceo',
  },
  legal: {
    name: 'legal',
    permissions: ['approve:legal', 'review:legal', 'admin:legal'],
    description: 'Legal department - legal review authority',
    hierarchyLevel: 80,
    defaultSla: 24 * 60 * 60 * 1000, // 24 hours
    escalatesTo: 'ceo',
  },
  hr: {
    name: 'hr',
    permissions: ['approve:hr', 'review:hr', 'admin:hr'],
    description: 'Human Resources - HR authority',
    hierarchyLevel: 70,
    defaultSla: 24 * 60 * 60 * 1000, // 24 hours
    escalatesTo: 'ceo',
  },
  manager: {
    name: 'manager',
    permissions: ['approve:team', 'review:team'],
    description: 'Team Manager - team-level authority',
    hierarchyLevel: 50,
    defaultSla: 4 * 60 * 60 * 1000, // 4 hours
    escalatesTo: 'cfo',
  },
  support: {
    name: 'support',
    permissions: ['review:support', 'escalate:*'],
    description: 'Support - customer support authority',
    hierarchyLevel: 30,
    defaultSla: 2 * 60 * 60 * 1000, // 2 hours
    escalatesTo: 'manager',
  },
} as const

/**
 * Create human role templates for an organization
 */
export async function createHumanRoleTemplates(
  graph: GraphStore,
  orgId?: string
): Promise<Record<string, GraphThing>> {
  const roles: Record<string, GraphThing> = {}

  for (const [key, template] of Object.entries(HUMAN_ROLE_TEMPLATES)) {
    const role = await createRole(graph, {
      name: template.name,
      permissions: template.permissions as unknown as string[],
      description: template.description,
      hierarchyLevel: template.hierarchyLevel,
      orgId: orgId ?? null,
      metadata: {
        defaultSla: template.defaultSla,
        escalatesTo: template.escalatesTo,
      },
    })
    roles[key] = role
  }

  return roles
}
