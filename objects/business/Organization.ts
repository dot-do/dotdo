/**
 * Organization - Top-level organizational container
 *
 * Represents the complete organizational hierarchy for a business entity:
 *
 * Organization
 *   └── Department
 *       └── Team
 *           └── Position (Role + Worker)
 *               └── Permissions (FGA/RBAC)
 *
 * This structure enables:
 * - Hierarchical permission inheritance
 * - Role-based task assignment
 * - Approval chains based on org structure
 * - Resource access control based on department/team
 */

import { DO, Env, type OKR } from '../core/DO'

// Types from business-as-code primitives
export interface OrganizationSettings {
  defaultCurrency?: string
  timezone?: string
  workWeek?: string[]
  businessHours?: {
    start: string
    end: string
    timezone?: string
  }
  fiscalYearStart?: number
  language?: string
  dateFormat?: string
}

export interface Address {
  street?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

export interface Budget {
  annual?: number
  currency?: string
  period?: string
  categories?: Record<string, number>
  spent?: number
  remaining?: number
}

export interface PositionRef {
  positionId?: string
  roleId?: string
  workerId?: string
}

export interface Position {
  id: string
  title: string
  roleId: string
  workerId?: string | null
  workerType?: 'human' | 'agent' | 'any'
  teamId?: string
  reportsTo?: string
  directReports?: string[]
  additionalPermissions?: Record<string, string[]>
  startDate?: Date
  endDate?: Date
  status?: 'active' | 'open' | 'on-leave' | 'terminated'
  fte?: number
  location?: string
  workModel?: 'remote' | 'hybrid' | 'onsite'
  metadata?: Record<string, unknown>
}

export interface TeamResources {
  repositories?: string[]
  projects?: string[]
  products?: string[]
  [resourceType: string]: string[] | undefined
}

export interface TeamChannels {
  slack?: string
  teams?: string
  email?: string
  discord?: string
}

export interface Team {
  id: string
  name: string
  departmentId?: string
  description?: string
  lead?: PositionRef
  positions?: Position[]
  objectives?: string[]
  resources?: TeamResources
  budget?: Budget
  defaultPermissions?: Record<string, string[]>
  channels?: TeamChannels
  metadata?: Record<string, unknown>
}

export interface Department {
  id: string
  name: string
  code?: string
  description?: string
  head?: PositionRef
  parentId?: string
  teams?: Team[]
  budget?: Budget
  costCenter?: string
  goals?: string[]
  defaultPermissions?: Record<string, string[]>
  metadata?: Record<string, unknown>
}

export interface ApproverSpec {
  type: 'direct-manager' | 'skip-level-manager' | 'role' | 'position' | 'worker' | 'team'
  roleId?: string
  positionId?: string
  workerId?: string
  teamId?: string
}

export interface ApprovalLevel {
  threshold?: number
  approvers: ApproverSpec[]
  requiredApprovals?: number
  approvalMode?: 'sequential' | 'parallel' | 'any'
  slaHours?: number
}

export interface EscalationRule {
  afterHours: number
  escalateTo: 'skip-level-manager' | 'department-head' | 'role' | 'position'
  roleId?: string
  positionId?: string
  maxEscalations?: number
}

export interface ApprovalChain {
  id: string
  name: string
  type: string
  levels: ApprovalLevel[]
  escalation?: EscalationRule
  active?: boolean
  metadata?: Record<string, unknown>
}

export interface ResourceHierarchyNode {
  parent?: string
  alternateParents?: string[]
  children?: string[]
  inheritPermissions?: boolean
  maxDepth?: number
}

export interface ResourceHierarchy {
  [resourceType: string]: ResourceHierarchyNode
}

export interface OrganizationConfig {
  id: string
  name: string
  domain?: string
  legalName?: string
  industry?: string
  mission?: string
  values?: string[]
  foundedAt?: Date
  headquarters?: Address
  settings?: OrganizationSettings
  resourceHierarchy?: ResourceHierarchy
  approvalChains?: ApprovalChain[]
  metadata?: Record<string, unknown>
}

export class Organization extends DO {
  static override readonly $type: string = 'Organization'

  private config: OrganizationConfig | null = null

  /**
   * Pre-configured OKRs for organizational health.
   *
   * - TeamHealth: Employee engagement, retention, satisfaction
   * - Structure: Headcount targets, department coverage
   * - Efficiency: Process efficiency, approval times
   */
  override okrs: Record<string, OKR> = {
    TeamHealth: this.defineOKR({
      objective: 'Build a healthy and engaged organization',
      keyResults: [
        { name: 'EmployeeRetention', target: 90, current: 0, unit: '%' },
        { name: 'EngagementScore', target: 80, current: 0, unit: '%' },
        { name: 'eNPS', target: 40, current: 0, unit: 'score' },
      ],
    }),
    Structure: this.defineOKR({
      objective: 'Achieve optimal organizational structure',
      keyResults: [
        { name: 'HeadcountTarget', target: 100, current: 0, unit: 'people' },
        { name: 'OpenPositions', target: 5, current: 0, unit: 'positions' },
        { name: 'SpanOfControl', target: 7, current: 0, unit: 'ratio' },
      ],
    }),
    Efficiency: this.defineOKR({
      objective: 'Optimize organizational efficiency',
      keyResults: [
        { name: 'ApprovalCycleTime', target: 24, current: 0, unit: 'hours' },
        { name: 'ProcessAutomation', target: 70, current: 0, unit: '%' },
        { name: 'DecisionLatency', target: 4, current: 0, unit: 'hours' },
      ],
    }),
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get organization configuration
   */
  async getOrg(): Promise<OrganizationConfig | null> {
    if (!this.config) {
      this.config = (await this.ctx.storage.get('config')) as OrganizationConfig | null
    }
    return this.config
  }

  /**
   * Update organization configuration
   */
  async updateOrg(data: Partial<OrganizationConfig>): Promise<void> {
    const current = await this.getOrg()
    this.config = { ...current, ...data } as OrganizationConfig
    await this.ctx.storage.put('config', this.config)
    await this.emit('organization.updated', { config: this.config })
  }

  /**
   * Add a department to the organization
   */
  async addDepartment(dept: Department): Promise<void> {
    await this.link({
      doId: dept.id,
      doClass: 'Department',
      role: 'child',
      data: dept as unknown as Record<string, unknown>,
    })
    await this.emit('department.added', { department: dept })
  }

  /**
   * Get a department by ID
   */
  async getDepartment(deptId: string): Promise<Department | null> {
    const objects = await this.getLinkedObjects('child')
    const dept = objects.find((o) => o.doClass === 'Department' && o.doId === deptId)
    return dept?.data ? (dept.data as unknown as Department) : null
  }

  /**
   * Update a department
   */
  async updateDepartment(deptId: string, data: Partial<Department>): Promise<void> {
    const dept = await this.getDepartment(deptId)
    if (!dept) {
      throw new Error(`Department not found: ${deptId}`)
    }
    const updated = { ...dept, ...data }
    await this.link({
      doId: deptId,
      doClass: 'Department',
      role: 'child',
      data: updated as unknown as Record<string, unknown>,
    })
    await this.emit('department.updated', { department: updated })
  }

  /**
   * List all departments
   */
  async listDepartments(): Promise<Department[]> {
    const objects = await this.getLinkedObjects('child')
    return objects
      .filter((o) => o.doClass === 'Department')
      .map((o) => o.data as unknown as Department)
  }

  /**
   * Remove a department
   */
  async removeDepartment(deptId: string): Promise<void> {
    // Delete the relationship from the database
    this.ctx.storage.sql.exec(
      `DELETE FROM relationships WHERE "from" = ? AND "to" = ?`,
      this.ns,
      deptId
    )
    await this.emit('department.removed', { departmentId: deptId })
  }

  /**
   * Add a team to the organization (standalone, not under a department)
   */
  async addTeam(team: Team): Promise<void> {
    await this.link({
      doId: team.id,
      doClass: 'Team',
      role: 'child',
      data: team as unknown as Record<string, unknown>,
    })
    await this.emit('team.added', { team })
  }

  /**
   * Get a team by ID
   */
  async getTeam(teamId: string): Promise<Team | null> {
    const objects = await this.getLinkedObjects('child')
    const team = objects.find((o) => o.doClass === 'Team' && o.doId === teamId)
    return team?.data ? (team.data as unknown as Team) : null
  }

  /**
   * Update a team
   */
  async updateTeam(teamId: string, data: Partial<Team>): Promise<void> {
    const team = await this.getTeam(teamId)
    if (!team) {
      throw new Error(`Team not found: ${teamId}`)
    }
    const updated = { ...team, ...data }
    await this.link({
      doId: teamId,
      doClass: 'Team',
      role: 'child',
      data: updated as unknown as Record<string, unknown>,
    })
    await this.emit('team.updated', { team: updated })
  }

  /**
   * List all standalone teams (not under departments)
   */
  async listTeams(): Promise<Team[]> {
    const objects = await this.getLinkedObjects('child')
    return objects
      .filter((o) => o.doClass === 'Team')
      .map((o) => o.data as unknown as Team)
  }

  /**
   * Remove a team
   */
  async removeTeam(teamId: string): Promise<void> {
    // Delete the relationship from the database
    this.ctx.storage.sql.exec(
      `DELETE FROM relationships WHERE "from" = ? AND "to" = ?`,
      this.ns,
      teamId
    )
    await this.emit('team.removed', { teamId })
  }

  /**
   * Get org chart - hierarchical view of the organization
   */
  async getOrgChart(): Promise<{
    org: OrganizationConfig | null
    departments: Department[]
    standaloneTeams: Team[]
  }> {
    const [org, departments, teams] = await Promise.all([
      this.getOrg(),
      this.listDepartments(),
      this.listTeams(),
    ])
    return { org, departments, standaloneTeams: teams }
  }

  /**
   * Get total headcount across all departments and teams
   */
  async getHeadcount(): Promise<{
    total: number
    byDepartment: Record<string, number>
    byTeam: Record<string, number>
    openPositions: number
  }> {
    const departments = await this.listDepartments()
    const teams = await this.listTeams()

    let total = 0
    let openPositions = 0
    const byDepartment: Record<string, number> = {}
    const byTeam: Record<string, number> = {}

    for (const dept of departments) {
      let deptCount = 0
      for (const team of dept.teams || []) {
        const teamCount = team.positions?.filter((p) => p.workerId)?.length || 0
        const teamOpen = team.positions?.filter((p) => !p.workerId)?.length || 0
        byTeam[team.id] = teamCount
        deptCount += teamCount
        openPositions += teamOpen
      }
      byDepartment[dept.id] = deptCount
      total += deptCount
    }

    // Add standalone teams
    for (const team of teams) {
      const teamCount = team.positions?.filter((p) => p.workerId)?.length || 0
      const teamOpen = team.positions?.filter((p) => !p.workerId)?.length || 0
      byTeam[team.id] = teamCount
      total += teamCount
      openPositions += teamOpen
    }

    return { total, byDepartment, byTeam, openPositions }
  }

  /**
   * Find position by ID across the organization
   */
  async findPosition(positionId: string): Promise<{
    position: Position
    team: Team
    department?: Department
  } | null> {
    const departments = await this.listDepartments()
    const standaloneTeams = await this.listTeams()

    // Search in departments
    for (const dept of departments) {
      for (const team of dept.teams || []) {
        const position = team.positions?.find((p) => p.id === positionId)
        if (position) {
          return { position, team, department: dept }
        }
      }
    }

    // Search in standalone teams
    for (const team of standaloneTeams) {
      const position = team.positions?.find((p) => p.id === positionId)
      if (position) {
        return { position, team }
      }
    }

    return null
  }

  /**
   * Find manager for a position
   */
  async findManager(positionId: string): Promise<Position | null> {
    const result = await this.findPosition(positionId)
    if (!result?.position.reportsTo) return null

    const managerResult = await this.findPosition(result.position.reportsTo)
    return managerResult?.position || null
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const pathParts = url.pathname.split('/').filter(Boolean)

    // GET /org - get organization config
    if (url.pathname === '/org' && request.method === 'GET') {
      const org = await this.getOrg()
      return new Response(JSON.stringify(org), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // PUT /org - update organization config
    if (url.pathname === '/org' && request.method === 'PUT') {
      const data = (await request.json()) as Partial<OrganizationConfig>
      await this.updateOrg(data)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /org/chart - get full org chart
    if (url.pathname === '/org/chart' && request.method === 'GET') {
      const chart = await this.getOrgChart()
      return new Response(JSON.stringify(chart), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /org/headcount - get headcount stats
    if (url.pathname === '/org/headcount' && request.method === 'GET') {
      const headcount = await this.getHeadcount()
      return new Response(JSON.stringify(headcount), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // POST /departments - add department
    if (url.pathname === '/departments' && request.method === 'POST') {
      const dept = (await request.json()) as Department
      await this.addDepartment(dept)
      return new Response(JSON.stringify({ success: true, id: dept.id }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /departments - list departments
    if (url.pathname === '/departments' && request.method === 'GET') {
      const departments = await this.listDepartments()
      return new Response(JSON.stringify(departments), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /departments/:id - get department
    if (pathParts[0] === 'departments' && pathParts[1] && request.method === 'GET') {
      const dept = await this.getDepartment(pathParts[1])
      if (!dept) {
        return new Response(JSON.stringify({ error: 'Department not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(dept), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // PUT /departments/:id - update department
    if (pathParts[0] === 'departments' && pathParts[1] && request.method === 'PUT') {
      const data = (await request.json()) as Partial<Department>
      await this.updateDepartment(pathParts[1], data)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // DELETE /departments/:id - remove department
    if (pathParts[0] === 'departments' && pathParts[1] && request.method === 'DELETE') {
      await this.removeDepartment(pathParts[1])
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // POST /teams - add team
    if (url.pathname === '/teams' && request.method === 'POST') {
      const team = (await request.json()) as Team
      await this.addTeam(team)
      return new Response(JSON.stringify({ success: true, id: team.id }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /teams - list teams
    if (url.pathname === '/teams' && request.method === 'GET') {
      const teams = await this.listTeams()
      return new Response(JSON.stringify(teams), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /teams/:id - get team
    if (pathParts[0] === 'teams' && pathParts[1] && request.method === 'GET') {
      const team = await this.getTeam(pathParts[1])
      if (!team) {
        return new Response(JSON.stringify({ error: 'Team not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(team), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // PUT /teams/:id - update team
    if (pathParts[0] === 'teams' && pathParts[1] && request.method === 'PUT') {
      const data = (await request.json()) as Partial<Team>
      await this.updateTeam(pathParts[1], data)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // DELETE /teams/:id - remove team
    if (pathParts[0] === 'teams' && pathParts[1] && request.method === 'DELETE') {
      await this.removeTeam(pathParts[1])
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /positions/:id - find position
    if (pathParts[0] === 'positions' && pathParts[1] && request.method === 'GET') {
      const result = await this.findPosition(pathParts[1])
      if (!result) {
        return new Response(JSON.stringify({ error: 'Position not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /positions/:id/manager - find manager
    if (pathParts[0] === 'positions' && pathParts[1] && pathParts[2] === 'manager' && request.method === 'GET') {
      const manager = await this.findManager(pathParts[1])
      return new Response(JSON.stringify(manager), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default Organization
