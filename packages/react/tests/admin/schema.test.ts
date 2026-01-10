/**
 * Schema Utilities Tests
 *
 * Tests for Zod schema inference and resource definition generation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  inferFieldsFromSchema,
  createResourceFromSchema,
} from '../../src/admin/schema'

// =============================================================================
// Test Schemas
// =============================================================================

const UserSchema = z.object({
  $id: z.string(),
  $type: z.literal('User'),
  name: z.string().min(1),
  email: z.string().email(),
  avatarUrl: z.string().url().optional(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
  age: z.number().min(0).optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const TaskSchema = z.object({
  $id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'done']),
  assigneeId: z.string().nullable(),
  projectId: z.string(),
  priority: z.number().default(1),
  dueDate: z.string().nullable(),
})

// =============================================================================
// inferFieldsFromSchema Tests
// =============================================================================

describe('inferFieldsFromSchema', () => {
  it('should infer fields from a Zod schema', () => {
    const fields = inferFieldsFromSchema(UserSchema)

    expect(fields).toHaveLength(10)
    expect(fields.map((f) => f.name)).toContain('$id')
    expect(fields.map((f) => f.name)).toContain('name')
    expect(fields.map((f) => f.name)).toContain('email')
  })

  it('should detect ID fields', () => {
    const fields = inferFieldsFromSchema(UserSchema)
    const idField = fields.find((f) => f.name === '$id')

    expect(idField?.isId).toBe(true)
    expect(idField?.hidden).toBe(true)
  })

  it('should detect string fields', () => {
    const fields = inferFieldsFromSchema(UserSchema)
    const nameField = fields.find((f) => f.name === 'name')

    expect(nameField?.type).toBe('string')
    expect(nameField?.required).toBe(true)
    expect(nameField?.min).toBe(1)
  })

  it('should detect email fields', () => {
    const fields = inferFieldsFromSchema(UserSchema)
    const emailField = fields.find((f) => f.name === 'email')

    expect(emailField?.type).toBe('email')
  })

  it('should detect URL fields', () => {
    const fields = inferFieldsFromSchema(UserSchema)
    const avatarField = fields.find((f) => f.name === 'avatarUrl')

    expect(avatarField?.type).toBe('url')
    expect(avatarField?.required).toBe(false)
  })

  it('should detect enum fields', () => {
    const fields = inferFieldsFromSchema(UserSchema)
    const roleField = fields.find((f) => f.name === 'role')

    expect(roleField?.type).toBe('enum')
    expect(roleField?.enumValues).toEqual(['admin', 'member', 'viewer'])
    expect(roleField?.defaultValue).toBe('member')
  })

  it('should detect number fields', () => {
    const fields = inferFieldsFromSchema(UserSchema)
    const ageField = fields.find((f) => f.name === 'age')

    expect(ageField?.type).toBe('number')
    expect(ageField?.required).toBe(false)
  })

  it('should detect boolean fields', () => {
    const fields = inferFieldsFromSchema(UserSchema)
    const activeField = fields.find((f) => f.name === 'isActive')

    expect(activeField?.type).toBe('boolean')
    expect(activeField?.defaultValue).toBe(true)
  })

  it('should detect datetime fields from naming', () => {
    const fields = inferFieldsFromSchema(UserSchema)
    const createdField = fields.find((f) => f.name === 'createdAt')

    expect(createdField?.type).toBe('datetime')
    expect(createdField?.hidden).toBe(true)
  })

  it('should detect reference fields', () => {
    const fields = inferFieldsFromSchema(TaskSchema)

    const assigneeField = fields.find((f) => f.name === 'assigneeId')
    expect(assigneeField?.type).toBe('reference')
    expect(assigneeField?.reference).toBe('Assignee')

    const projectField = fields.find((f) => f.name === 'projectId')
    expect(projectField?.type).toBe('reference')
    expect(projectField?.reference).toBe('Project')
  })

  it('should generate human-readable labels', () => {
    const fields = inferFieldsFromSchema(TaskSchema)

    const titleField = fields.find((f) => f.name === 'title')
    expect(titleField?.label).toBe('Title')

    const assigneeField = fields.find((f) => f.name === 'assigneeId')
    expect(assigneeField?.label).toBe('Assignee ID')

    const dueDateField = fields.find((f) => f.name === 'dueDate')
    expect(dueDateField?.label).toBe('Due Date')
  })

  it('should detect max length constraints', () => {
    const fields = inferFieldsFromSchema(TaskSchema)
    const titleField = fields.find((f) => f.name === 'title')

    expect(titleField?.min).toBe(1)
    expect(titleField?.max).toBe(200)
  })
})

// =============================================================================
// createResourceFromSchema Tests
// =============================================================================

describe('createResourceFromSchema', () => {
  it('should create a resource definition', () => {
    const resource = createResourceFromSchema('User', UserSchema)

    expect(resource.name).toBe('User')
    expect(resource.idField).toBe('$id')
    expect(resource.fields).toHaveLength(10)
  })

  it('should categorize list fields', () => {
    const resource = createResourceFromSchema('User', UserSchema)

    // List fields should exclude hidden fields, objects, arrays, and description
    expect(resource.listFields.map((f) => f.name)).toContain('name')
    expect(resource.listFields.map((f) => f.name)).toContain('email')
    expect(resource.listFields.map((f) => f.name)).toContain('role')
    expect(resource.listFields.map((f) => f.name)).not.toContain('$id')
    expect(resource.listFields.map((f) => f.name)).not.toContain('createdAt')
  })

  it('should categorize form fields', () => {
    const resource = createResourceFromSchema('User', UserSchema)

    // Form fields should exclude IDs and timestamps
    expect(resource.formFields.map((f) => f.name)).toContain('name')
    expect(resource.formFields.map((f) => f.name)).toContain('email')
    expect(resource.formFields.map((f) => f.name)).not.toContain('$id')
    expect(resource.formFields.map((f) => f.name)).not.toContain('createdAt')
    expect(resource.formFields.map((f) => f.name)).not.toContain('updatedAt')
  })

  it('should identify searchable fields', () => {
    const resource = createResourceFromSchema('User', UserSchema)

    expect(resource.searchFields).toContain('name')
    expect(resource.searchFields).toContain('email')
    expect(resource.searchFields).not.toContain('$id')
  })

  it('should identify sortable fields', () => {
    const resource = createResourceFromSchema('User', UserSchema)

    expect(resource.sortableFields).toContain('name')
    expect(resource.sortableFields).toContain('email')
    expect(resource.sortableFields).toContain('createdAt')
  })

  it('should identify filterable fields', () => {
    const resource = createResourceFromSchema('User', UserSchema)

    expect(resource.filterableFields).toContain('role')
    expect(resource.filterableFields).toContain('isActive')
  })

  it('should work with Task schema', () => {
    const resource = createResourceFromSchema('Task', TaskSchema)

    expect(resource.name).toBe('Task')
    expect(resource.idField).toBe('$id')

    // Check reference fields are filterable
    expect(resource.filterableFields).toContain('status')
  })
})
