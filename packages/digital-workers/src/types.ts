import { z } from 'zod'

// Base Worker type
export interface Worker {
  $id: string
  $type: 'https://schema.org.ai/Worker'
  name: string
  skills: string[]
  status: 'available' | 'busy' | 'away' | 'offline'
}

// Agent - AI autonomous worker
export interface Agent extends Omit<Worker, '$type'> {
  $type: 'https://schema.org.ai/Agent'
  model: string
  tools: string[]
  autonomous: boolean
}

// Human - Human worker with approvals
export interface Human extends Omit<Worker, '$type'> {
  $type: 'https://schema.org.ai/Human'
  requiresApproval: boolean
  notificationChannels: string[]
}

// Zod schemas for validation
export const WorkerSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Worker'),
  name: z.string(),
  skills: z.array(z.string()),
  status: z.enum(['available', 'busy', 'away', 'offline'])
})

export const AgentSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Agent'),
  name: z.string(),
  skills: z.array(z.string()),
  status: z.enum(['available', 'busy', 'away', 'offline']),
  model: z.string(),
  tools: z.array(z.string()),
  autonomous: z.boolean()
})

export const HumanSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Human'),
  name: z.string(),
  skills: z.array(z.string()),
  status: z.enum(['available', 'busy', 'away', 'offline']),
  requiresApproval: z.boolean(),
  notificationChannels: z.array(z.string())
})

// Type guards
export function isWorker(obj: unknown): obj is Worker {
  return WorkerSchema.safeParse(obj).success
}

export function isAgent(obj: unknown): obj is Agent {
  return AgentSchema.safeParse(obj).success
}

export function isHuman(obj: unknown): obj is Human {
  return HumanSchema.safeParse(obj).success
}
