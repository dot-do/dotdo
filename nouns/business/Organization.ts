import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * Department schema
 */
export const DepartmentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  head: z.string().optional(),
  members: z.array(z.string()).optional(),
  budget: z.number().optional(),
})
export type Department = z.infer<typeof DepartmentSchema>

/**
 * Team schema
 */
export const TeamSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  lead: z.string().optional(),
  members: z.array(z.string()).optional(),
  objectives: z.array(z.string()).optional(),
})
export type Team = z.infer<typeof TeamSchema>

/**
 * Organizational structure schema
 */
export const OrganizationalStructureSchema = z.object({
  departments: z.array(DepartmentSchema).optional(),
  hierarchy: z.record(z.string(), z.array(z.string())).optional(),
  teams: z.array(TeamSchema).optional(),
})
export type OrganizationalStructure = z.infer<typeof OrganizationalStructureSchema>

/**
 * Organization entity schema
 */
export const OrganizationSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Organization'),
  name: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
  legalName: z.string().optional(),
  taxId: z.string().optional(),
  registrationNumber: z.string().optional(),
  foundedAt: z.coerce.date().optional(),
  dissolvedAt: z.coerce.date().optional(),
  status: z.enum(['active', 'inactive', 'dissolved']).optional(),
  type: z.enum(['corporation', 'llc', 'partnership', 'nonprofit', 'government', 'other']).optional(),
  parentOrganization: z.string().optional(),
  subsidiaries: z.array(z.string()).optional(),
  structure: OrganizationalStructureSchema.optional(),
  headquarters: z.string().optional(),
  locations: z.array(z.string()).optional(),
  employeeCount: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type OrganizationType = z.infer<typeof OrganizationSchema>

/**
 * Organization Noun - legal/structural entity
 *
 * Represents an organization with its legal structure,
 * departments, teams, and reporting hierarchy.
 */
export const Organization = defineNoun({
  noun: 'Organization',
  plural: 'Organizations',
  $type: 'https://schema.org.ai/Organization',
  schema: OrganizationSchema,
  okrs: ['Headcount', 'Retention', 'EmployeeSatisfaction', 'DepartmentBudget'],
})
