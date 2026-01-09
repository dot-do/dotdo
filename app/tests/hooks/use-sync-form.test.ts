/**
 * useSyncForm Hook Tests (RED phase)
 *
 * These tests define the contract for the useSyncForm hook.
 * They are expected to FAIL until the implementation is created.
 *
 * The useSyncForm hook integrates TanStack Form with @dotdo/tanstack
 * collections for type-safe forms with real-time sync and optimistic updates.
 *
 * ## Required Dependencies (install before running tests)
 *
 * ```bash
 * pnpm add -D @testing-library/react @tanstack/react-form @tanstack/zod-form-adapter jsdom
 * ```
 *
 * @see app/lib/hooks/use-sync-form.ts (implementation to be created)
 * @see dotdo-1nhq or dotdo-p75j for the GREEN phase implementation task
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { z } from 'zod'

// Import the hook under test (will fail until implemented)
import { useSyncForm } from '../../lib/hooks/use-sync-form'

// =============================================================================
// Test Schema & Types
// =============================================================================

/**
 * Test schema for a Task item
 */
const TaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  completed: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

type Task = z.infer<typeof TaskSchema>

/**
 * Extended schema with $id for stored items
 */
const StoredTaskSchema = TaskSchema.extend({
  $id: z.string(),
})

type StoredTask = z.infer<typeof StoredTaskSchema>

// =============================================================================
// Mock Collection
// =============================================================================

/**
 * Creates a mock collection that matches useDotdoCollection return value
 */
function createMockCollection<T extends { $id: string }>(initialItems: T[] = []) {
  const items = new Map<string, T>(initialItems.map((item) => [item.$id, item]))
  let nextId = initialItems.length + 1

  return {
    // Query methods
    findById: vi.fn((id: string) => items.get(id) ?? null),
    findAll: vi.fn(() => Array.from(items.values())),

    // Mutation methods
    insert: vi.fn(async (data: Omit<T, '$id'>) => {
      const $id = `task-${nextId++}`
      const item = { ...data, $id } as T
      items.set($id, item)
      return item
    }),
    update: vi.fn(async (id: string, data: Partial<Omit<T, '$id'>>) => {
      const existing = items.get(id)
      if (!existing) throw new Error(`Item ${id} not found`)
      const updated = { ...existing, ...data }
      items.set(id, updated)
      return updated
    }),
    delete: vi.fn(async (id: string) => {
      const existed = items.delete(id)
      return { deleted: existed }
    }),

    // State
    isLoading: false,
    error: null,

    // Internal (for test inspection)
    _items: items,
  }
}

type MockCollection<T extends { $id: string }> = ReturnType<typeof createMockCollection<T>>

// =============================================================================
// Test Setup
// =============================================================================

describe('useSyncForm', () => {
  let mockCollection: MockCollection<StoredTask>

  beforeEach(() => {
    vi.clearAllMocks()
    mockCollection = createMockCollection<StoredTask>()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Create Mode Tests
  // ===========================================================================

  describe('create mode', () => {
    it('returns TanStack Form instance', () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      // The hook should return a form object with TanStack Form methods
      expect(result.current.form).toBeDefined()
      expect(result.current.form.handleSubmit).toBeDefined()
      expect(result.current.form.reset).toBeDefined()
      expect(typeof result.current.form.handleSubmit).toBe('function')
    })

    it('isEditing is false', () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      expect(result.current.isEditing).toBe(false)
    })

    it('form starts with empty/default values', () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      // Form state should have default/empty values based on schema
      const state = result.current.form.state
      expect(state.values.title).toBe('')
      expect(state.values.completed).toBe(false)
      expect(state.values.priority).toBe('medium')
    })

    it('validates against Zod schema on change', async () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      // Trigger validation by setting an empty title (which should fail)
      await act(async () => {
        result.current.form.setFieldValue('title', '')
        await result.current.form.validateField('title', 'change')
      })

      // Should have validation error for empty title
      const fieldMeta = result.current.form.getFieldMeta('title')
      expect(fieldMeta?.errors).toBeDefined()
      expect(fieldMeta?.errors?.length).toBeGreaterThan(0)
    })

    it('calls collection.insert on submit', async () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      // Set valid form values
      await act(async () => {
        result.current.form.setFieldValue('title', 'New Task')
        result.current.form.setFieldValue('description', 'Task description')
        result.current.form.setFieldValue('completed', false)
        result.current.form.setFieldValue('priority', 'high')
      })

      // Submit the form
      await act(async () => {
        await result.current.submit()
      })

      // Verify insert was called with form values
      expect(mockCollection.insert).toHaveBeenCalledTimes(1)
      expect(mockCollection.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Task',
          description: 'Task description',
          completed: false,
          priority: 'high',
        })
      )
    })

    it('sets isSubmitting during submit', async () => {
      // Create a collection with a delayed insert
      const delayedCollection = createMockCollection<StoredTask>()
      delayedCollection.insert = vi.fn(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  $id: 'task-1',
                  title: 'New Task',
                  completed: false,
                  priority: 'medium',
                }),
              100
            )
          )
      )

      const { result } = renderHook(() =>
        useSyncForm({
          collection: delayedCollection,
          schema: TaskSchema,
        })
      )

      // Set valid form values
      await act(async () => {
        result.current.form.setFieldValue('title', 'New Task')
      })

      // Start submit but don't await
      let submitPromise: Promise<void>
      act(() => {
        submitPromise = result.current.submit()
      })

      // Should be submitting
      expect(result.current.isSubmitting).toBe(true)

      // Wait for submit to complete
      await act(async () => {
        await submitPromise
      })

      // Should no longer be submitting
      expect(result.current.isSubmitting).toBe(false)
    })

    it('calls onSuccess after successful submit', async () => {
      const onSuccess = vi.fn()

      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
          onSuccess,
        })
      )

      // Set valid form values
      await act(async () => {
        result.current.form.setFieldValue('title', 'New Task')
      })

      // Submit the form
      await act(async () => {
        await result.current.submit()
      })

      expect(onSuccess).toHaveBeenCalledTimes(1)
    })

    it('calls onError on submit failure', async () => {
      const onError = vi.fn()
      const testError = new Error('Insert failed')

      // Create a collection that rejects on insert
      const failingCollection = createMockCollection<StoredTask>()
      failingCollection.insert = vi.fn().mockRejectedValue(testError)

      const { result } = renderHook(() =>
        useSyncForm({
          collection: failingCollection,
          schema: TaskSchema,
          onError,
        })
      )

      // Set valid form values
      await act(async () => {
        result.current.form.setFieldValue('title', 'New Task')
      })

      // Submit the form (should fail)
      await act(async () => {
        try {
          await result.current.submit()
        } catch {
          // Expected to throw
        }
      })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(testError)
    })
  })

  // ===========================================================================
  // Edit Mode Tests
  // ===========================================================================

  describe('edit mode', () => {
    const existingTask: StoredTask = {
      $id: 'task-existing',
      title: 'Existing Task',
      description: 'Original description',
      completed: false,
      priority: 'medium',
    }

    beforeEach(() => {
      mockCollection = createMockCollection<StoredTask>([existingTask])
    })

    it('isEditing is true when initialId provided', () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
          initialId: 'task-existing',
        })
      )

      expect(result.current.isEditing).toBe(true)
    })

    it('loads initial values from collection.findById', () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
          initialId: 'task-existing',
        })
      )

      // Verify findById was called
      expect(mockCollection.findById).toHaveBeenCalledWith('task-existing')

      // Form should be populated with existing values
      const state = result.current.form.state
      expect(state.values.title).toBe('Existing Task')
      expect(state.values.description).toBe('Original description')
      expect(state.values.completed).toBe(false)
      expect(state.values.priority).toBe('medium')
    })

    it('calls collection.update on submit', async () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
          initialId: 'task-existing',
        })
      )

      // Update form values
      await act(async () => {
        result.current.form.setFieldValue('title', 'Updated Task')
        result.current.form.setFieldValue('completed', true)
      })

      // Submit the form
      await act(async () => {
        await result.current.submit()
      })

      // Verify update was called instead of insert
      expect(mockCollection.insert).not.toHaveBeenCalled()
      expect(mockCollection.update).toHaveBeenCalledTimes(1)
      expect(mockCollection.update).toHaveBeenCalledWith(
        'task-existing',
        expect.objectContaining({
          title: 'Updated Task',
          completed: true,
        })
      )
    })

    it('preserves $id on update', async () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
          initialId: 'task-existing',
        })
      )

      // Update form values
      await act(async () => {
        result.current.form.setFieldValue('title', 'Updated Task')
      })

      // Submit the form
      await act(async () => {
        await result.current.submit()
      })

      // The $id should be preserved in the update call
      expect(mockCollection.update).toHaveBeenCalledWith(
        'task-existing', // First arg is the ID
        expect.any(Object) // Second arg is the data (without $id in the data itself)
      )

      // Verify the data passed to update doesn't contain $id (it's in the first arg)
      const updateCallData = mockCollection.update.mock.calls[0][1]
      expect(updateCallData).not.toHaveProperty('$id')
    })
  })

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe('validation', () => {
    it('shows field errors from Zod validation', async () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      // Trigger validation with invalid value
      await act(async () => {
        result.current.form.setFieldValue('title', '') // Empty title should fail
        await result.current.form.validateField('title', 'change')
      })

      // Get field error state
      const fieldMeta = result.current.form.getFieldMeta('title')

      expect(fieldMeta?.errors).toBeDefined()
      expect(fieldMeta?.errors).toContain('Title is required')
    })

    it('prevents submit when form is invalid', async () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      // Leave title empty (invalid)
      await act(async () => {
        result.current.form.setFieldValue('title', '')
      })

      // Attempt to submit
      await act(async () => {
        try {
          await result.current.submit()
        } catch {
          // Expected to throw or fail validation
        }
      })

      // Insert should NOT have been called because form is invalid
      expect(mockCollection.insert).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Return Value Interface Tests
  // ===========================================================================

  describe('return value interface', () => {
    it('returns form instance with expected methods', () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      // Form methods from TanStack Form
      expect(result.current.form).toHaveProperty('handleSubmit')
      expect(result.current.form).toHaveProperty('reset')
      expect(result.current.form).toHaveProperty('setFieldValue')
      expect(result.current.form).toHaveProperty('getFieldMeta')
      expect(result.current.form).toHaveProperty('state')
    })

    it('returns isEditing boolean', () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      expect(typeof result.current.isEditing).toBe('boolean')
    })

    it('returns isSubmitting boolean', () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      expect(typeof result.current.isSubmitting).toBe('boolean')
    })

    it('returns submit function', () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      expect(typeof result.current.submit).toBe('function')
    })

    it('returns reset function', () => {
      const { result } = renderHook(() =>
        useSyncForm({
          collection: mockCollection,
          schema: TaskSchema,
        })
      )

      expect(typeof result.current.reset).toBe('function')
    })
  })
})
