import { DOBase } from '../DOBase'
import type { Business, Goal } from '@dotdo/business-as-code'

/**
 * BusinessDO - Durable Object for Business entities
 * @see https://schema.org.ai/Business
 */
export class BusinessDO extends DOBase {
  static $type = 'https://schema.org.ai/Business' as const

  get goals(): Goal[] {
    // TODO: Implement goals retrieval from storage
    return []
  }

  async setGoals(goals: Goal[]): Promise<void> {
    // TODO: Implement goals storage
  }
}
