/**
 * Organization Graph Store
 *
 * CRUD operations for Organization Things in the graph model, plus membership
 * management for linking Users to Organizations with roles.
 *
 * @module db/graph/organization
 * @see dotdo-5bdv2 - [GREEN] Organization as Thing: Implementation
 *
 * @example
 * ```typescript
 * import { createOrganizationStore } from 'db/graph/organization'
 *
 * const store = createOrganizationStore(graph)
 *
 * // Create organization
 * const org = await store.create({
 *   name: 'Acme Corp',
 *   slug: 'acme',
 *   type: 'company',
 *   status: 'active',
 * })
 *
 * // Add member
 * await store.addMember(org.id, userId, { role: 'admin', status: 'active' })
 * ```
 */

import type { GraphEngine, Node, Edge } from './graph-engine'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Label for Organization nodes */
export const ORGANIZATION_LABEL = 'Organization'

/** Edge type for membership */
export const MEMBER_OF_EDGE = 'memberOf'

/** Edge type for parent-child hierarchy */
export const CHILD_OF_EDGE = 'childOf'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Organization type
 */
export type OrganizationType = 'company' | 'team' | 'department' | 'workspace' | 'project' | 'group'

/**
 * Organization status
 */
export type OrganizationStatus = 'active' | 'inactive' | 'suspended' | 'archived' | 'pending'

/**
 * Organization plan
 */
export type OrganizationPlan = 'free' | 'starter' | 'pro' | 'enterprise' | 'custom'

/**
 * Member role within an organization
 */
export type MemberRole = 'owner' | 'admin' | 'member' | 'guest' | 'billing'

/**
 * Member status
 */
export type MemberStatus = 'active' | 'invited' | 'pending' | 'suspended'

/**
 * Organization data for creation
 */
export interface OrganizationInput {
  /** Organization name */
  name: string
  /** URL-friendly slug (unique) */
  slug: string
  /** Organization type */
  type: OrganizationType
  /** Organization status */
  status: OrganizationStatus
  /** Description */
  description?: string
  /** Website URL */
  website?: string
  /** Logo URL */
  logoUrl?: string
  /** Billing plan */
  plan?: OrganizationPlan
  /** Maximum members allowed */
  maxMembers?: number
  /** Parent organization ID */
  parentId?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Full Organization with ID and timestamps
 */
export interface Organization extends OrganizationInput {
  /** Unique ID */
  id: string
  /** Created timestamp */
  createdAt: number
  /** Updated timestamp */
  updatedAt: number
}

/**
 * Membership data for adding a member
 */
export interface MembershipInput {
  /** Member role */
  role: MemberRole
  /** Member status */
  status: MemberStatus
  /** Title within org */
  title?: string
  /** Invited by user ID */
  invitedBy?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Full membership with user ID
 */
export interface Membership extends MembershipInput {
  /** User ID */
  userId: string
  /** Edge ID for the membership */
  edgeId: string
  /** Joined timestamp */
  joinedAt: number
}

/**
 * Organization Store interface
 */
export interface OrganizationStore {
  // CRUD
  create(data: OrganizationInput): Promise<Organization>
  findById(id: string): Promise<Organization | null>
  findBySlug(slug: string): Promise<Organization | null>
  update(id: string, data: Partial<OrganizationInput>): Promise<Organization>
  delete(id: string): Promise<boolean>

  // Members
  addMember(orgId: string, userId: string, data: MembershipInput): Promise<Membership>
  removeMember(orgId: string, userId: string): Promise<boolean>
  getMembers(orgId: string): Promise<Membership[]>
  getMemberRole(orgId: string, userId: string): Promise<MemberRole | null>
  updateMemberRole(orgId: string, userId: string, role: MemberRole): Promise<Membership>
  isMember(orgId: string, userId: string): Promise<boolean>
  isOwner(orgId: string, userId: string): Promise<boolean>
  isAdmin(orgId: string, userId: string): Promise<boolean>
  countMembers(orgId: string): Promise<number>

  // Query
  findByType(type: OrganizationType): Promise<Organization[]>
  findByPlan(plan: OrganizationPlan): Promise<Organization[]>
  findByStatus(status: OrganizationStatus): Promise<Organization[]>
  getUserOrganizations(userId: string): Promise<Organization[]>

  // Hierarchy
  getParent(orgId: string): Promise<Organization | null>
  getChildren(orgId: string): Promise<Organization[]>
  getAncestors(orgId: string): Promise<Organization[]>
  getDescendants(orgId: string): Promise<Organization[]>
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Convert a Node to Organization
 */
function nodeToOrganization(node: Node): Organization {
  return {
    id: node.id,
    name: node.properties.name as string,
    slug: node.properties.slug as string,
    type: node.properties.type as OrganizationType,
    status: node.properties.status as OrganizationStatus,
    description: node.properties.description as string | undefined,
    website: node.properties.website as string | undefined,
    logoUrl: node.properties.logoUrl as string | undefined,
    plan: node.properties.plan as OrganizationPlan | undefined,
    maxMembers: node.properties.maxMembers as number | undefined,
    parentId: node.properties.parentId as string | undefined,
    metadata: node.properties.metadata as Record<string, unknown> | undefined,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  }
}

/**
 * Convert an Edge to Membership
 */
function edgeToMembership(edge: Edge): Membership {
  return {
    userId: edge.from,
    edgeId: edge.id,
    role: edge.properties.role as MemberRole,
    status: edge.properties.status as MemberStatus,
    title: edge.properties.title as string | undefined,
    invitedBy: edge.properties.invitedBy as string | undefined,
    metadata: edge.properties.metadata as Record<string, unknown> | undefined,
    joinedAt: edge.createdAt,
  }
}

/**
 * Validate required fields for organization creation
 */
function validateOrganizationInput(data: Partial<OrganizationInput>): void {
  if (!data.name) throw new Error('Organization name is required')
  if (!data.slug) throw new Error('Organization slug is required')
  if (!data.type) throw new Error('Organization type is required')
  if (!data.status) throw new Error('Organization status is required')
}

// ============================================================================
// ORGANIZATION STORE IMPLEMENTATION
// ============================================================================

/**
 * OrganizationStore class that wraps GraphEngine
 */
export class OrganizationStoreImpl implements OrganizationStore {
  constructor(private graph: GraphEngine) {}

  // -------------------------------------------------------------------------
  // CRUD Operations
  // -------------------------------------------------------------------------

  async create(data: OrganizationInput): Promise<Organization> {
    validateOrganizationInput(data)

    // Check for duplicate slug
    const existing = await this.findBySlug(data.slug)
    if (existing) {
      throw new Error(`Organization with slug '${data.slug}' already exists`)
    }

    const node = await this.graph.createNode(ORGANIZATION_LABEL, {
      name: data.name,
      slug: data.slug,
      type: data.type,
      status: data.status,
      description: data.description,
      website: data.website,
      logoUrl: data.logoUrl,
      plan: data.plan,
      maxMembers: data.maxMembers,
      parentId: data.parentId,
      metadata: data.metadata,
    })

    // If parentId is set, create childOf relationship
    if (data.parentId) {
      await this.graph.createEdge(node.id, CHILD_OF_EDGE, data.parentId)
    }

    return nodeToOrganization(node)
  }

  async findById(id: string): Promise<Organization | null> {
    const node = await this.graph.getNode(id)
    if (!node || node.label !== ORGANIZATION_LABEL) return null
    return nodeToOrganization(node)
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    const nodes = await this.graph.queryNodes({
      label: ORGANIZATION_LABEL,
      where: { slug },
      limit: 1,
    })
    if (nodes.length === 0) return null
    return nodeToOrganization(nodes[0]!)
  }

  async update(id: string, data: Partial<OrganizationInput>): Promise<Organization> {
    const existing = await this.findById(id)
    if (!existing) {
      throw new Error(`Organization not found: ${id}`)
    }

    // If slug is being changed, check for uniqueness
    if (data.slug && data.slug !== existing.slug) {
      const slugExists = await this.findBySlug(data.slug)
      if (slugExists) {
        throw new Error(`Organization with slug '${data.slug}' already exists`)
      }
    }

    const node = await this.graph.updateNode(id, data)
    return nodeToOrganization(node)
  }

  async delete(id: string): Promise<boolean> {
    return this.graph.deleteNode(id)
  }

  // -------------------------------------------------------------------------
  // Member Operations
  // -------------------------------------------------------------------------

  async addMember(orgId: string, userId: string, data: MembershipInput): Promise<Membership> {
    // Verify org exists
    const org = await this.findById(orgId)
    if (!org) {
      throw new Error(`Organization not found: ${orgId}`)
    }

    // Check maxMembers limit
    if (org.maxMembers) {
      const currentCount = await this.countMembers(orgId)
      if (currentCount >= org.maxMembers) {
        throw new Error(`Member limit exceeded: organization allows maximum ${org.maxMembers} members`)
      }
    }

    // Check if already a member
    const isMember = await this.isMember(orgId, userId)
    if (isMember) {
      throw new Error(`User ${userId} is already a member of organization ${orgId}`)
    }

    // Create memberOf edge from user to organization
    const edge = await this.graph.createEdge(userId, MEMBER_OF_EDGE, orgId, {
      role: data.role,
      status: data.status,
      title: data.title,
      invitedBy: data.invitedBy,
      metadata: data.metadata,
    })

    return edgeToMembership(edge)
  }

  async removeMember(orgId: string, userId: string): Promise<boolean> {
    // Get membership edge
    const edges = await this.graph.queryEdges({
      from: userId,
      to: orgId,
      type: MEMBER_OF_EDGE,
    })

    if (edges.length === 0) {
      return false
    }

    const edge = edges[0]!
    const role = edge.properties.role as MemberRole

    // Prevent removing last owner
    if (role === 'owner') {
      const owners = await this.graph.queryEdges({
        to: orgId,
        type: MEMBER_OF_EDGE,
      })
      const ownerCount = owners.filter((e) => e.properties.role === 'owner').length
      if (ownerCount <= 1) {
        throw new Error('Cannot remove the last owner of an organization')
      }
    }

    return this.graph.deleteEdge(edge.id)
  }

  async getMembers(orgId: string): Promise<Membership[]> {
    const edges = await this.graph.queryEdges({
      to: orgId,
      type: MEMBER_OF_EDGE,
    })

    return edges.map(edgeToMembership)
  }

  async getMemberRole(orgId: string, userId: string): Promise<MemberRole | null> {
    const edges = await this.graph.queryEdges({
      from: userId,
      to: orgId,
      type: MEMBER_OF_EDGE,
    })

    if (edges.length === 0) return null
    return edges[0]!.properties.role as MemberRole
  }

  async updateMemberRole(orgId: string, userId: string, role: MemberRole): Promise<Membership> {
    const edges = await this.graph.queryEdges({
      from: userId,
      to: orgId,
      type: MEMBER_OF_EDGE,
    })

    if (edges.length === 0) {
      throw new Error(`User ${userId} is not a member of organization ${orgId}`)
    }

    const edge = await this.graph.updateEdge(edges[0]!.id, { role })
    return edgeToMembership(edge)
  }

  async isMember(orgId: string, userId: string): Promise<boolean> {
    const edges = await this.graph.queryEdges({
      from: userId,
      to: orgId,
      type: MEMBER_OF_EDGE,
    })
    return edges.length > 0
  }

  async isOwner(orgId: string, userId: string): Promise<boolean> {
    const role = await this.getMemberRole(orgId, userId)
    return role === 'owner'
  }

  async isAdmin(orgId: string, userId: string): Promise<boolean> {
    const role = await this.getMemberRole(orgId, userId)
    return role === 'owner' || role === 'admin'
  }

  async countMembers(orgId: string): Promise<number> {
    const edges = await this.graph.queryEdges({
      to: orgId,
      type: MEMBER_OF_EDGE,
    })
    return edges.length
  }

  // -------------------------------------------------------------------------
  // Query Operations
  // -------------------------------------------------------------------------

  async findByType(type: OrganizationType): Promise<Organization[]> {
    const nodes = await this.graph.queryNodes({
      label: ORGANIZATION_LABEL,
      where: { type },
    })
    return nodes.map(nodeToOrganization)
  }

  async findByPlan(plan: OrganizationPlan): Promise<Organization[]> {
    const nodes = await this.graph.queryNodes({
      label: ORGANIZATION_LABEL,
      where: { plan },
    })
    return nodes.map(nodeToOrganization)
  }

  async findByStatus(status: OrganizationStatus): Promise<Organization[]> {
    const nodes = await this.graph.queryNodes({
      label: ORGANIZATION_LABEL,
      where: { status },
    })
    return nodes.map(nodeToOrganization)
  }

  async getUserOrganizations(userId: string): Promise<Organization[]> {
    const edges = await this.graph.queryEdges({
      from: userId,
      type: MEMBER_OF_EDGE,
    })

    const orgs: Organization[] = []
    for (const edge of edges) {
      const node = await this.graph.getNode(edge.to)
      if (node && node.label === ORGANIZATION_LABEL) {
        orgs.push(nodeToOrganization(node))
      }
    }

    return orgs
  }

  // -------------------------------------------------------------------------
  // Hierarchy Operations
  // -------------------------------------------------------------------------

  async getParent(orgId: string): Promise<Organization | null> {
    const edges = await this.graph.queryEdges({
      from: orgId,
      type: CHILD_OF_EDGE,
    })

    if (edges.length === 0) return null

    const parentNode = await this.graph.getNode(edges[0]!.to)
    if (!parentNode || parentNode.label !== ORGANIZATION_LABEL) return null

    return nodeToOrganization(parentNode)
  }

  async getChildren(orgId: string): Promise<Organization[]> {
    const edges = await this.graph.queryEdges({
      to: orgId,
      type: CHILD_OF_EDGE,
    })

    const children: Organization[] = []
    for (const edge of edges) {
      const node = await this.graph.getNode(edge.from)
      if (node && node.label === ORGANIZATION_LABEL) {
        children.push(nodeToOrganization(node))
      }
    }

    return children
  }

  async getAncestors(orgId: string): Promise<Organization[]> {
    const ancestors: Organization[] = []
    let currentId = orgId

    // Walk up the hierarchy
    while (true) {
      const parent = await this.getParent(currentId)
      if (!parent) break
      ancestors.push(parent)
      currentId = parent.id
    }

    return ancestors
  }

  async getDescendants(orgId: string): Promise<Organization[]> {
    const descendants: Organization[] = []

    // BFS through children
    const queue = [orgId]
    while (queue.length > 0) {
      const currentId = queue.shift()!
      const children = await this.getChildren(currentId)

      for (const child of children) {
        descendants.push(child)
        queue.push(child.id)
      }
    }

    return descendants
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an OrganizationStore instance
 *
 * @param graph - GraphEngine instance
 * @returns OrganizationStore
 */
export function createOrganizationStore(graph: GraphEngine): OrganizationStore {
  return new OrganizationStoreImpl(graph)
}

// Also export the class for type checking
export { OrganizationStoreImpl as OrganizationStore }
