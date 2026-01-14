/**
 * Goal Tracking for Autonomous Agents
 *
 * Provides types and functions for goal-directed agent behavior:
 * - AgentGoal: Goal representation with objectives, key results, and tasks
 * - GoalTracker: Track and measure progress toward goals
 * - GoalState: Current state of goal pursuit
 *
 * @see dotdo-se42n - Autonomous Agents with OKRs
 * @module lib/okrs/goal
 */

import type { OKR, OKRConfig, OKRKeyResultConfig, AnalyticsContext } from './define'
import { defineOKR } from './define'

// ============================================================================
// Types
// ============================================================================

/**
 * Goal status enum for tracking lifecycle
 */
export type GoalStatus = 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'

/**
 * Task status for individual work items
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked'

/**
 * A task that contributes to a goal
 */
export interface GoalTask {
  /** Task identifier */
  id: string
  /** Task description */
  description: string
  /** Current status */
  status: TaskStatus
  /** Optional: assigned agent */
  assignee?: string
  /** Optional: blocked reason */
  blockedReason?: string
  /** Created timestamp */
  createdAt: number
  /** Completed timestamp */
  completedAt?: number
}

/**
 * AgentGoal - represents a goal that an agent is pursuing
 *
 * Goals are hierarchical:
 * - Objective: High-level strategic goal (what we want to achieve)
 * - Key Results: Measurable outcomes (how we know we've achieved it)
 * - Tasks: Actionable items (what we need to do)
 *
 * @example
 * ```typescript
 * const goal: AgentGoal = {
 *   id: 'goal-mvp-launch',
 *   objective: 'Launch MVP successfully',
 *   keyResults: [
 *     { metric: 'ActiveUsers', target: 1000, current: 500 },
 *     { metric: 'NPS', target: 50, current: 30 },
 *   ],
 *   tasks: [
 *     { id: 't1', description: 'Build auth system', status: 'completed' },
 *     { id: 't2', description: 'Deploy to production', status: 'in_progress' },
 *   ],
 *   status: 'active',
 *   currentFocus: 'Deploy to production',
 *   priority: 1,
 * }
 * ```
 */
export interface AgentGoal {
  /** Unique identifier for the goal */
  id: string
  /** The strategic objective */
  objective: string
  /** Measurable key results */
  keyResults: OKRKeyResultConfig[]
  /** Tasks to achieve the goal */
  tasks?: GoalTask[]
  /** Current status */
  status: GoalStatus
  /** Current focus area (what the agent is working on now) */
  currentFocus?: string
  /** Priority (1 = highest) */
  priority: number
  /** Optional: parent goal ID for hierarchical goals */
  parentGoalId?: string
  /** Optional: deadline timestamp */
  deadline?: number
  /** Created timestamp */
  createdAt: number
  /** Updated timestamp */
  updatedAt: number
  /** Completed timestamp */
  completedAt?: number
}

/**
 * Goal configuration for creating new goals
 */
export interface GoalConfig {
  /** The strategic objective */
  objective: string
  /** Key results to measure success */
  keyResults: OKRKeyResultConfig[]
  /** Optional: initial tasks */
  tasks?: Omit<GoalTask, 'id' | 'createdAt'>[]
  /** Priority (1 = highest, default: 2) */
  priority?: number
  /** Optional: parent goal ID */
  parentGoalId?: string
  /** Optional: deadline */
  deadline?: number
}

/**
 * Goal progress snapshot
 */
export interface GoalProgress {
  /** Goal ID */
  goalId: string
  /** Overall progress (0-1) */
  progress: number
  /** Progress for each key result */
  keyResultProgress: Array<{
    metric: string
    progress: number
    current: number
    target: number
  }>
  /** Task completion rate (0-1) */
  taskCompletionRate: number
  /** Number of completed tasks */
  completedTasks: number
  /** Total tasks */
  totalTasks: number
  /** Whether goal is complete */
  isComplete: boolean
  /** Timestamp of this snapshot */
  timestamp: number
}

/**
 * Goal state for an agent's goal pursuit
 */
export interface GoalState {
  /** Active goals (sorted by priority) */
  activeGoals: AgentGoal[]
  /** Completed goals */
  completedGoals: AgentGoal[]
  /** Current focus goal */
  currentGoal?: AgentGoal
  /** Overall progress across all active goals */
  overallProgress: number
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new goal from configuration
 *
 * @param config - Goal configuration
 * @returns A new AgentGoal instance
 *
 * @example
 * ```typescript
 * const goal = createGoal({
 *   objective: 'Increase user engagement',
 *   keyResults: [
 *     { metric: 'DAU', target: 5000, current: 3000 },
 *     { metric: 'SessionDuration', target: 15, current: 10 },
 *   ],
 *   priority: 1,
 * })
 * ```
 */
export function createGoal(config: GoalConfig): AgentGoal {
  const now = Date.now()
  const id = `goal-${now}-${Math.random().toString(36).slice(2, 8)}`

  const tasks: GoalTask[] = config.tasks?.map((task, index) => ({
    id: `${id}-task-${index}`,
    description: task.description,
    status: task.status || 'pending',
    assignee: task.assignee,
    blockedReason: task.blockedReason,
    createdAt: now,
  })) || []

  return {
    id,
    objective: config.objective,
    keyResults: config.keyResults.map(kr => ({
      metric: kr.metric,
      target: kr.target,
      current: kr.current ?? 0,
      measurement: kr.measurement,
    })),
    tasks,
    status: 'pending',
    priority: config.priority ?? 2,
    parentGoalId: config.parentGoalId,
    deadline: config.deadline,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Create a goal from an OKR definition
 *
 * @param okr - OKR object
 * @param options - Additional goal options
 * @returns A new AgentGoal instance
 */
export function createGoalFromOKR(
  okr: OKR | OKRConfig,
  options?: { priority?: number; parentGoalId?: string; deadline?: number }
): AgentGoal {
  const objective = 'objective' in okr ? okr.objective : (okr as OKRConfig).objective
  const keyResults = 'keyResults' in okr ? okr.keyResults : (okr as OKRConfig).keyResults

  return createGoal({
    objective,
    keyResults,
    priority: options?.priority,
    parentGoalId: options?.parentGoalId,
    deadline: options?.deadline,
  })
}

// ============================================================================
// Progress Tracking
// ============================================================================

/**
 * Calculate progress for a goal
 *
 * @param goal - The goal to measure
 * @returns GoalProgress snapshot
 */
export function calculateGoalProgress(goal: AgentGoal): GoalProgress {
  // Calculate key result progress
  const keyResultProgress = goal.keyResults.map(kr => {
    const target = kr.target
    const current = kr.current ?? 0

    // Handle zero target case
    let progress: number
    if (target === 0) {
      progress = current === 0 ? 1 : 0
    } else {
      progress = Math.min(current / target, 1)
    }

    return {
      metric: kr.metric,
      progress,
      current,
      target,
    }
  })

  // Overall KR progress (average)
  const overallKRProgress = keyResultProgress.length > 0
    ? keyResultProgress.reduce((sum, kr) => sum + kr.progress, 0) / keyResultProgress.length
    : 0

  // Task completion
  const tasks = goal.tasks || []
  const completedTasks = tasks.filter(t => t.status === 'completed').length
  const totalTasks = tasks.length
  const taskCompletionRate = totalTasks > 0 ? completedTasks / totalTasks : 1

  // Combined progress (weighted: 70% KRs, 30% tasks if tasks exist)
  const progress = totalTasks > 0
    ? overallKRProgress * 0.7 + taskCompletionRate * 0.3
    : overallKRProgress

  // Check completion
  const krComplete = keyResultProgress.every(kr => kr.progress >= 1)
  const tasksComplete = tasks.every(t => t.status === 'completed')
  const isComplete = krComplete && tasksComplete

  return {
    goalId: goal.id,
    progress,
    keyResultProgress,
    taskCompletionRate,
    completedTasks,
    totalTasks,
    isComplete,
    timestamp: Date.now(),
  }
}

/**
 * Update key result values from analytics context
 *
 * @param goal - Goal to update
 * @param analytics - Analytics context with current values
 * @returns Updated goal with refreshed key result values
 */
export async function refreshGoalMetrics(
  goal: AgentGoal,
  analytics: AnalyticsContext
): Promise<AgentGoal> {
  const updatedKeyResults = await Promise.all(
    goal.keyResults.map(async kr => {
      // If measurement function exists, call it
      if (kr.measurement) {
        try {
          const current = await kr.measurement()
          return { ...kr, current }
        } catch {
          // Keep existing value on error
          return kr
        }
      }
      return kr
    })
  )

  return {
    ...goal,
    keyResults: updatedKeyResults,
    updatedAt: Date.now(),
  }
}

// ============================================================================
// Goal State Management
// ============================================================================

/**
 * GoalTracker - manages goals for an agent
 *
 * @example
 * ```typescript
 * const tracker = new GoalTracker()
 *
 * // Add a goal
 * tracker.addGoal({
 *   objective: 'Launch MVP',
 *   keyResults: [{ metric: 'Users', target: 1000, current: 0 }],
 * })
 *
 * // Start working on it
 * tracker.activateGoal(tracker.goals[0].id)
 *
 * // Update progress
 * tracker.updateKeyResult(tracker.goals[0].id, 'Users', 500)
 *
 * // Check state
 * console.log(tracker.getState())
 * ```
 */
export class GoalTracker {
  private goals: Map<string, AgentGoal> = new Map()

  /**
   * Add a new goal
   */
  addGoal(config: GoalConfig): AgentGoal {
    const goal = createGoal(config)
    this.goals.set(goal.id, goal)
    return goal
  }

  /**
   * Add an existing goal
   */
  setGoal(goal: AgentGoal): void {
    this.goals.set(goal.id, goal)
  }

  /**
   * Get a goal by ID
   */
  getGoal(id: string): AgentGoal | undefined {
    return this.goals.get(id)
  }

  /**
   * Get all goals
   */
  getAllGoals(): AgentGoal[] {
    return Array.from(this.goals.values())
  }

  /**
   * Activate a goal (set status to 'active')
   */
  activateGoal(id: string): AgentGoal | undefined {
    const goal = this.goals.get(id)
    if (!goal) return undefined

    const updated = { ...goal, status: 'active' as GoalStatus, updatedAt: Date.now() }
    this.goals.set(id, updated)
    return updated
  }

  /**
   * Complete a goal
   */
  completeGoal(id: string): AgentGoal | undefined {
    const goal = this.goals.get(id)
    if (!goal) return undefined

    const updated = {
      ...goal,
      status: 'completed' as GoalStatus,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.goals.set(id, updated)
    return updated
  }

  /**
   * Update a key result value
   */
  updateKeyResult(goalId: string, metric: string, value: number): AgentGoal | undefined {
    const goal = this.goals.get(goalId)
    if (!goal) return undefined

    const updatedKeyResults = goal.keyResults.map(kr =>
      kr.metric === metric ? { ...kr, current: value } : kr
    )

    const updated = { ...goal, keyResults: updatedKeyResults, updatedAt: Date.now() }
    this.goals.set(goalId, updated)

    // Auto-complete if all KRs met
    const progress = calculateGoalProgress(updated)
    if (progress.isComplete && updated.status === 'active') {
      return this.completeGoal(goalId)
    }

    return updated
  }

  /**
   * Add a task to a goal
   */
  addTask(goalId: string, task: Omit<GoalTask, 'id' | 'createdAt'>): GoalTask | undefined {
    const goal = this.goals.get(goalId)
    if (!goal) return undefined

    const newTask: GoalTask = {
      id: `${goalId}-task-${Date.now()}`,
      description: task.description,
      status: task.status || 'pending',
      assignee: task.assignee,
      blockedReason: task.blockedReason,
      createdAt: Date.now(),
    }

    const updated = {
      ...goal,
      tasks: [...(goal.tasks || []), newTask],
      updatedAt: Date.now(),
    }
    this.goals.set(goalId, updated)
    return newTask
  }

  /**
   * Update task status
   */
  updateTaskStatus(goalId: string, taskId: string, status: TaskStatus): GoalTask | undefined {
    const goal = this.goals.get(goalId)
    if (!goal || !goal.tasks) return undefined

    const updatedTasks = goal.tasks.map(t =>
      t.id === taskId
        ? { ...t, status, completedAt: status === 'completed' ? Date.now() : undefined }
        : t
    )

    const updated = { ...goal, tasks: updatedTasks, updatedAt: Date.now() }
    this.goals.set(goalId, updated)
    return updatedTasks.find(t => t.id === taskId)
  }

  /**
   * Set current focus
   */
  setFocus(goalId: string, focus: string): AgentGoal | undefined {
    const goal = this.goals.get(goalId)
    if (!goal) return undefined

    const updated = { ...goal, currentFocus: focus, updatedAt: Date.now() }
    this.goals.set(goalId, updated)
    return updated
  }

  /**
   * Get current goal state
   */
  getState(): GoalState {
    const allGoals = Array.from(this.goals.values())
    const activeGoals = allGoals
      .filter(g => g.status === 'active' || g.status === 'pending')
      .sort((a, b) => a.priority - b.priority)
    const completedGoals = allGoals.filter(g => g.status === 'completed')

    // Find current goal (highest priority active)
    const currentGoal = activeGoals.find(g => g.status === 'active')

    // Calculate overall progress
    const progressValues = activeGoals.map(g => calculateGoalProgress(g).progress)
    const overallProgress = progressValues.length > 0
      ? progressValues.reduce((sum, p) => sum + p, 0) / progressValues.length
      : 0

    return {
      activeGoals,
      completedGoals,
      currentGoal,
      overallProgress,
    }
  }

  /**
   * Get progress for a specific goal
   */
  getProgress(goalId: string): GoalProgress | undefined {
    const goal = this.goals.get(goalId)
    if (!goal) return undefined
    return calculateGoalProgress(goal)
  }

  /**
   * Get the next pending task for a goal
   */
  getNextTask(goalId: string): GoalTask | undefined {
    const goal = this.goals.get(goalId)
    if (!goal || !goal.tasks) return undefined
    return goal.tasks.find(t => t.status === 'pending')
  }

  /**
   * Clear all goals
   */
  clear(): void {
    this.goals.clear()
  }

  /**
   * Serialize goals for persistence
   */
  serialize(): AgentGoal[] {
    return Array.from(this.goals.values())
  }

  /**
   * Restore goals from serialized data
   */
  restore(goals: AgentGoal[]): void {
    this.goals.clear()
    for (const goal of goals) {
      this.goals.set(goal.id, goal)
    }
  }
}
