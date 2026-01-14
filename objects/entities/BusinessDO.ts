/**
 * @module BusinessDO
 * @description Durable Object for Business entities with goals, workflows, and employees
 *
 * BusinessDO provides the DO implementation for business entities as defined in
 * the schema.org.ai/Business type. It manages business state, goals, financial metrics,
 * and relationships to employees, products, and services.
 *
 * **Core Features:**
 * - Goal management (OKRs, KPIs, targets)
 * - Financial metrics tracking (revenue, costs, margins)
 * - Employee/team relationships
 * - Workflow orchestration
 * - Business-specific event handling
 *
 * **Business Properties (from schema.org.ai):**
 * | Property | Type | Description |
 * |----------|------|-------------|
 * | name | string | Business name |
 * | slug | string | URL-friendly identifier |
 * | description | string | Business description |
 * | plan | enum | Pricing plan tier |
 * | industry | string | Industry classification |
 * | mission | string | Mission statement |
 * | values | string[] | Core values |
 * | targetMarket | string | Target market description |
 * | teamSize | number | Number of employees |
 * | financials | object | Financial metrics |
 *
 * @example Creating a BusinessDO
 * ```typescript
 * const stub = env.BusinessDO.get(env.BusinessDO.idFromName('acme-corp'))
 * await stub.initialize({
 *   name: 'Acme Corporation',
 *   industry: 'Technology',
 *   mission: 'Making work better'
 * })
 * ```
 *
 * @example Setting Business Goals
 * ```typescript
 * await stub.setGoals([
 *   {
 *     id: 'goal-1',
 *     title: 'Increase Revenue',
 *     target: 1000000,
 *     current: 500000,
 *     deadline: '2024-Q4'
 *   }
 * ])
 * ```
 *
 * @see Business - Noun definition from nouns/business/Business.ts
 * @see DigitalBusiness - Extended business DO with digital product capabilities
 */

import { DO, type Env } from '../core/DO'
import { Business as BusinessNoun } from '../../nouns/business/Business'
import type { AnyNoun } from '../../nouns/types'

/**
 * Goal definition for business objectives
 */
export interface Goal {
  /** Unique identifier for the goal */
  id: string
  /** Goal title/name */
  title: string
  /** Detailed description */
  description?: string
  /** Target value (numeric) */
  target?: number
  /** Current progress value */
  current?: number
  /** Deadline for the goal */
  deadline?: string
  /** Goal status */
  status?: 'draft' | 'active' | 'completed' | 'cancelled'
  /** Parent goal ID for hierarchical goals */
  parentId?: string
  /** Key results or sub-objectives */
  keyResults?: KeyResult[]
}

/**
 * Key result within a goal (OKR pattern)
 */
export interface KeyResult {
  id: string
  title: string
  target: number
  current: number
  unit?: string
}

/**
 * Financial metrics for the business
 */
export interface FinancialMetrics {
  revenue?: number
  costs?: number
  profit?: number
  grossMargin?: number
  netMargin?: number
  currency?: string
  period?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
}

/**
 * BusinessDO - Durable Object for Business entities
 *
 * Provides persistent storage and management for business entities including
 * goals, employees, products, and financial metrics.
 */
export class BusinessDO extends DO {
  /** Type identifier from schema.org.ai */
  static readonly $type: string = BusinessNoun.$type
  /** Noun definition for Business */
  static readonly noun: AnyNoun = BusinessNoun

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get all goals for this business
   */
  async getGoals(): Promise<Goal[]> {
    const goals = await this.ctx.storage.get<Goal[]>('goals')
    return goals ?? []
  }

  /**
   * Set/replace all goals for this business
   */
  async setGoals(goals: Goal[]): Promise<void> {
    await this.ctx.storage.put('goals', goals)
    await this.emit('business.goals.updated', { goals })
  }

  /**
   * Add a single goal
   */
  async addGoal(goal: Goal): Promise<Goal> {
    const goals = await this.getGoals()
    const newGoal = {
      ...goal,
      id: goal.id || crypto.randomUUID(),
      status: goal.status || 'draft',
    }
    goals.push(newGoal)
    await this.setGoals(goals)
    await this.emit('business.goal.created', { goal: newGoal })
    return newGoal
  }

  /**
   * Update an existing goal
   */
  async updateGoal(goalId: string, updates: Partial<Goal>): Promise<Goal | null> {
    const goals = await this.getGoals()
    const index = goals.findIndex(g => g.id === goalId)
    if (index === -1) return null

    const existingGoal = goals[index]!
    const updatedGoal: Goal = { ...existingGoal, ...updates }
    goals[index] = updatedGoal
    await this.setGoals(goals)
    await this.emit('business.goal.updated', { goal: updatedGoal })
    return updatedGoal
  }

  /**
   * Remove a goal
   */
  async removeGoal(goalId: string): Promise<boolean> {
    const goals = await this.getGoals()
    const filteredGoals = goals.filter(g => g.id !== goalId)
    if (filteredGoals.length === goals.length) return false

    await this.setGoals(filteredGoals)
    await this.emit('business.goal.removed', { goalId })
    return true
  }

  /**
   * Get financial metrics
   */
  async getFinancials(): Promise<FinancialMetrics | null> {
    const financials = await this.ctx.storage.get<FinancialMetrics>('financials')
    return financials ?? null
  }

  /**
   * Update financial metrics
   */
  async setFinancials(metrics: FinancialMetrics): Promise<void> {
    await this.ctx.storage.put('financials', metrics)
    await this.emit('business.financials.updated', { metrics })
  }

  /**
   * Get team members (employee IDs)
   */
  async getTeamMembers(): Promise<string[]> {
    const members = await this.ctx.storage.get<string[]>('team_members')
    return members ?? []
  }

  /**
   * Add a team member
   */
  async addTeamMember(memberId: string): Promise<void> {
    const members = await this.getTeamMembers()
    if (!members.includes(memberId)) {
      members.push(memberId)
      await this.ctx.storage.put('team_members', members)
      await this.emit('business.team.member_added', { memberId })
    }
  }

  /**
   * Remove a team member
   */
  async removeTeamMember(memberId: string): Promise<boolean> {
    const members = await this.getTeamMembers()
    const index = members.indexOf(memberId)
    if (index === -1) return false

    members.splice(index, 1)
    await this.ctx.storage.put('team_members', members)
    await this.emit('business.team.member_removed', { memberId })
    return true
  }
}

export default BusinessDO
