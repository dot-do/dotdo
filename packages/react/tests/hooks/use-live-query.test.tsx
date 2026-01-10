/**
 * Tests for useLiveQuery hook
 *
 * RED phase: These tests verify useLiveQuery behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import * as React from 'react'
import { useLiveQuery } from '../../src/hooks/use-live-query'

// Types for testing
interface Task {
  $id: string
  title: string
  status: 'todo' | 'in_progress' | 'done'
  priority: number
  assigneeId: string
  projectId: string
  createdAt: number
}

interface User {
  $id: string
  name: string
  email: string
  role: 'admin' | 'member'
}

interface Project {
  $id: string
  name: string
  ownerId: string
}

// Sample test data
const mockTasks: Task[] = [
  { $id: '1', title: 'Task 1', status: 'todo', priority: 1, assigneeId: 'u1', projectId: 'p1', createdAt: 1000 },
  { $id: '2', title: 'Task 2', status: 'done', priority: 2, assigneeId: 'u2', projectId: 'p1', createdAt: 2000 },
  { $id: '3', title: 'Task 3', status: 'todo', priority: 3, assigneeId: 'u1', projectId: 'p2', createdAt: 3000 },
  { $id: '4', title: 'Task 4', status: 'in_progress', priority: 1, assigneeId: 'u3', projectId: 'p1', createdAt: 4000 },
  { $id: '5', title: 'Task 5', status: 'todo', priority: 2, assigneeId: 'u2', projectId: 'p2', createdAt: 5000 },
]

const mockUsers: User[] = [
  { $id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'admin' },
  { $id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'member' },
  { $id: 'u3', name: 'Charlie', email: 'charlie@example.com', role: 'member' },
]

const mockProjects: Project[] = [
  { $id: 'p1', name: 'Project Alpha', ownerId: 'u1' },
  { $id: 'p2', name: 'Project Beta', ownerId: 'u2' },
]

describe('useLiveQuery', () => {
  describe('filters with where object', () => {
    it('should filter by single property', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: { status: 'todo' },
        })
      )

      expect(result.current).toHaveLength(3)
      expect(result.current.every(t => (t as Task).status === 'todo')).toBe(true)
    })

    it('should filter by multiple properties', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: { status: 'todo', assigneeId: 'u1' },
        })
      )

      expect(result.current).toHaveLength(2)
      expect(result.current.every(t => (t as Task).status === 'todo' && (t as Task).assigneeId === 'u1')).toBe(true)
    })

    it('should return empty array when no matches', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: { status: 'cancelled' as Task['status'] },
        })
      )

      expect(result.current).toHaveLength(0)
    })

    it('should filter by numeric property', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: { priority: 1 },
        })
      )

      expect(result.current).toHaveLength(2)
      expect(result.current.every(t => (t as Task).priority === 1)).toBe(true)
    })

    it('should return all items when where is empty object', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: {},
        })
      )

      expect(result.current).toHaveLength(mockTasks.length)
    })
  })

  describe('filters with where function', () => {
    it('should filter using predicate function', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: (task: Task) => task.priority > 1,
        })
      )

      expect(result.current).toHaveLength(3)
      expect(result.current.every(t => (t as Task).priority > 1)).toBe(true)
    })

    it('should support complex filter logic', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: (task: Task) => task.status === 'todo' || task.priority === 1,
        })
      )

      expect(result.current).toHaveLength(4) // 3 todo + 1 in_progress with priority 1
    })

    it('should support string matching', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: (task: Task) => task.title.includes('Task 1'),
        })
      )

      expect(result.current).toHaveLength(1)
      expect((result.current[0] as Task).title).toBe('Task 1')
    })

    it('should support date/timestamp comparisons', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: (task: Task) => task.createdAt >= 3000,
        })
      )

      expect(result.current).toHaveLength(3)
    })
  })

  describe('joins data', () => {
    it('should perform left join', () => {
      const { result } = renderHook(() =>
        useLiveQuery<Task, { task: Task; assignee: User | null }>(mockTasks, {
          from: 'Task',
          join: {
            assignee: {
              from: mockUsers,
              on: (task: Task, user: User) => task.assigneeId === user.$id,
              type: 'left',
            },
          },
        })
      )

      expect(result.current).toHaveLength(mockTasks.length)
      // Each result should have task and assignee properties
      expect(result.current[0]).toHaveProperty('task')
      expect(result.current[0]).toHaveProperty('assignee')
    })

    it('should include null for unmatched left joins', () => {
      const tasksWithInvalidAssignee: Task[] = [
        { $id: '99', title: 'Orphan Task', status: 'todo', priority: 1, assigneeId: 'invalid', projectId: 'p1', createdAt: 1000 },
      ]

      const { result } = renderHook(() =>
        useLiveQuery<Task, { task: Task; assignee: User | null }>(tasksWithInvalidAssignee, {
          from: 'Task',
          join: {
            assignee: {
              from: mockUsers,
              on: (task: Task, user: User) => task.assigneeId === user.$id,
              type: 'left',
            },
          },
        })
      )

      expect(result.current).toHaveLength(1)
      expect(result.current[0].assignee).toBeNull()
    })

    it('should perform inner join', () => {
      const tasksWithMixedAssignees: Task[] = [
        ...mockTasks,
        { $id: '99', title: 'Orphan', status: 'todo', priority: 1, assigneeId: 'invalid', projectId: 'p1', createdAt: 1000 },
      ]

      const { result } = renderHook(() =>
        useLiveQuery<Task, { task: Task; assignee: User }>(tasksWithMixedAssignees, {
          from: 'Task',
          join: {
            assignee: {
              from: mockUsers,
              on: (task: Task, user: User) => task.assigneeId === user.$id,
              type: 'inner',
            },
          },
        })
      )

      // Should exclude the orphan task
      expect(result.current).toHaveLength(mockTasks.length)
    })

    it('should support multiple joins', () => {
      const { result } = renderHook(() =>
        useLiveQuery<Task, { task: Task; assignee: User | null; project: Project | null }>(mockTasks, {
          from: 'Task',
          join: {
            assignee: {
              from: mockUsers,
              on: (task: Task, user: User) => task.assigneeId === user.$id,
              type: 'left',
            },
            project: {
              from: mockProjects,
              on: (task: Task, project: Project) => task.projectId === project.$id,
              type: 'left',
            },
          },
        })
      )

      expect(result.current).toHaveLength(mockTasks.length)
      expect(result.current[0]).toHaveProperty('task')
      expect(result.current[0]).toHaveProperty('assignee')
      expect(result.current[0]).toHaveProperty('project')
    })

    it('should provide correct joined data', () => {
      const { result } = renderHook(() =>
        useLiveQuery<Task, { task: Task; assignee: User | null }>(mockTasks.slice(0, 1), {
          from: 'Task',
          join: {
            assignee: {
              from: mockUsers,
              on: (task: Task, user: User) => task.assigneeId === user.$id,
              type: 'left',
            },
          },
        })
      )

      expect(result.current[0].task.title).toBe('Task 1')
      expect(result.current[0].assignee?.name).toBe('Alice')
    })
  })

  describe('orders results', () => {
    it('should order by field ascending', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          orderBy: 'priority',
          order: 'asc',
        })
      )

      const priorities = result.current.map(t => (t as Task).priority)
      expect(priorities).toEqual([1, 1, 2, 2, 3])
    })

    it('should order by field descending', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          orderBy: 'priority',
          order: 'desc',
        })
      )

      const priorities = result.current.map(t => (t as Task).priority)
      expect(priorities).toEqual([3, 2, 2, 1, 1])
    })

    it('should order by createdAt', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          orderBy: 'createdAt',
          order: 'desc',
        })
      )

      const timestamps = result.current.map(t => (t as Task).createdAt)
      expect(timestamps).toEqual([5000, 4000, 3000, 2000, 1000])
    })

    it('should order by string field', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          orderBy: 'title',
          order: 'asc',
        })
      )

      const titles = result.current.map(t => (t as Task).title)
      expect(titles).toEqual(['Task 1', 'Task 2', 'Task 3', 'Task 4', 'Task 5'])
    })

    it('should use custom sort function', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          orderBy: (a: Task, b: Task) => {
            // Sort by status first, then by priority
            if (a.status !== b.status) {
              const statusOrder = { todo: 0, in_progress: 1, done: 2 }
              return statusOrder[a.status] - statusOrder[b.status]
            }
            return a.priority - b.priority
          },
        })
      )

      const statuses = result.current.map(t => (t as Task).status)
      expect(statuses[0]).toBe('todo')
      expect(statuses[statuses.length - 1]).toBe('done')
    })

    it('should default to ascending when order not specified', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          orderBy: 'priority',
        })
      )

      const priorities = result.current.map(t => (t as Task).priority)
      expect(priorities).toEqual([1, 1, 2, 2, 3])
    })
  })

  describe('limits results', () => {
    it('should limit to specified number', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          limit: 3,
        })
      )

      expect(result.current).toHaveLength(3)
    })

    it('should return all when limit exceeds data length', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          limit: 100,
        })
      )

      expect(result.current).toHaveLength(mockTasks.length)
    })

    it('should return empty array when limit is 0', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          limit: 0,
        })
      )

      expect(result.current).toHaveLength(0)
    })

    it('should apply limit after filtering', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: { status: 'todo' },
          limit: 2,
        })
      )

      expect(result.current).toHaveLength(2)
      expect(result.current.every(t => (t as Task).status === 'todo')).toBe(true)
    })

    it('should apply limit after ordering', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          orderBy: 'createdAt',
          order: 'desc',
          limit: 2,
        })
      )

      expect(result.current).toHaveLength(2)
      expect((result.current[0] as Task).createdAt).toBe(5000)
      expect((result.current[1] as Task).createdAt).toBe(4000)
    })
  })

  describe('offset results', () => {
    it('should skip specified number of results', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          orderBy: 'createdAt',
          order: 'asc',
          offset: 2,
        })
      )

      expect(result.current).toHaveLength(3)
      expect((result.current[0] as Task).createdAt).toBe(3000)
    })

    it('should work with offset and limit together', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          orderBy: 'createdAt',
          order: 'asc',
          offset: 1,
          limit: 2,
        })
      )

      expect(result.current).toHaveLength(2)
      expect((result.current[0] as Task).createdAt).toBe(2000)
      expect((result.current[1] as Task).createdAt).toBe(3000)
    })

    it('should return empty when offset exceeds data length', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          offset: 100,
        })
      )

      expect(result.current).toHaveLength(0)
    })
  })

  describe('combined operations', () => {
    it('should filter, order, and limit together', () => {
      const { result } = renderHook(() =>
        useLiveQuery(mockTasks, {
          from: 'Task',
          where: { status: 'todo' },
          orderBy: 'priority',
          order: 'desc',
          limit: 2,
        })
      )

      expect(result.current).toHaveLength(2)
      expect((result.current[0] as Task).priority).toBe(3)
      expect((result.current[1] as Task).priority).toBe(2)
    })

    it('should filter, join, and order', () => {
      const { result } = renderHook(() =>
        useLiveQuery<Task, { task: Task; assignee: User | null }>(mockTasks, {
          from: 'Task',
          where: { status: 'todo' },
          join: {
            assignee: {
              from: mockUsers,
              on: (task: Task, user: User) => task.assigneeId === user.$id,
              type: 'left',
            },
          },
        })
      )

      expect(result.current).toHaveLength(3)
      expect(result.current.every(r => r.task.status === 'todo')).toBe(true)
    })
  })

  describe('reactivity', () => {
    it('should update when data changes', () => {
      const initialData = [...mockTasks]
      const { result, rerender } = renderHook(
        ({ data }) => useLiveQuery(data, { from: 'Task' }),
        { initialProps: { data: initialData } }
      )

      expect(result.current).toHaveLength(5)

      const newData = [...mockTasks, { $id: '6', title: 'Task 6', status: 'todo', priority: 1, assigneeId: 'u1', projectId: 'p1', createdAt: 6000 } as Task]
      rerender({ data: newData })

      expect(result.current).toHaveLength(6)
    })

    it('should update when config changes', () => {
      const { result, rerender } = renderHook(
        ({ where }) => useLiveQuery(mockTasks, { from: 'Task', where }),
        { initialProps: { where: { status: 'todo' as const } } }
      )

      expect(result.current).toHaveLength(3)

      rerender({ where: { status: 'done' as const } })

      expect(result.current).toHaveLength(1)
    })
  })

  describe('empty data handling', () => {
    it('should return empty array for empty input', () => {
      const { result } = renderHook(() =>
        useLiveQuery([], {
          from: 'Task',
        })
      )

      expect(result.current).toEqual([])
    })

    it('should handle empty array with filters', () => {
      const { result } = renderHook(() =>
        useLiveQuery([], {
          from: 'Task',
          where: { status: 'todo' },
          orderBy: 'priority',
          limit: 10,
        })
      )

      expect(result.current).toEqual([])
    })
  })
})
