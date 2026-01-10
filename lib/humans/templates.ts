/**
 * Template Literal Syntax for Human Escalation
 *
 * Usage: ceo`approve the partnership deal`
 *
 * Creates a HumanRequest that can be awaited and chained with .timeout() and .via()
 */

/**
 * Parse duration strings into milliseconds
 * @param duration - Duration string like "4 hours", "30 minutes", "1 day"
 * @returns Duration in milliseconds
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)\s*(second|minute|hour|day|week)s?$/i)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()

  const multipliers: Record<string, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }

  return value * multipliers[unit]
}

/**
 * HumanRequest represents a pending request for human input/approval
 *
 * Extends Promise so it can be awaited, but also exposes properties
 * for the role, message, SLA, and channel configuration.
 */
export class HumanRequest extends Promise<boolean> {
  private _role: string
  private _message: string
  private _sla?: number
  private _channel?: string

  constructor(role: string, message: string) {
    // Create a promise that resolves after a microtask (simulating async)
    super((resolve) => {
      queueMicrotask(() => resolve(true))
    })
    this._role = role
    this._message = message
  }

  /**
   * The role being escalated to (e.g., "ceo", "legal")
   */
  get role(): string {
    return this._role
  }

  /**
   * The message/request being sent to the human
   */
  get message(): string {
    return this._message
  }

  /**
   * SLA timeout in milliseconds (if set)
   */
  get sla(): number | undefined {
    return this._sla
  }

  /**
   * Communication channel (if set)
   */
  get channel(): string | undefined {
    return this._channel
  }

  /**
   * Set a timeout/SLA for the human request
   * @param duration - Duration string like "4 hours"
   * @returns A new HumanRequest with the SLA set
   */
  timeout(duration: string): HumanRequest {
    const request = new HumanRequest(this._role, this._message)
    request._sla = parseDuration(duration)
    request._channel = this._channel
    return request
  }

  /**
   * Set the communication channel for the request
   * @param channelName - Channel name like "slack", "email"
   * @returns A new HumanRequest with the channel set
   */
  via(channelName: string): HumanRequest {
    const request = new HumanRequest(this._role, this._message)
    request._sla = this._sla
    request._channel = channelName
    return request
  }
}

/**
 * Type for tagged template functions that create HumanRequest
 */
export type HumanTemplate = (strings: TemplateStringsArray, ...values: unknown[]) => HumanRequest

/**
 * Create a human template function for a specific role
 * @param role - The role name (e.g., "ceo", "senior-accountant")
 * @returns A tagged template function that creates HumanRequest instances
 */
export function createHumanTemplate(role: string): HumanTemplate {
  return (strings: TemplateStringsArray, ...values: unknown[]): HumanRequest => {
    // Interpolate the template string
    const message = strings.reduce((result, str, i) => {
      return result + str + (values[i] !== undefined ? String(values[i]) : '')
    }, '')

    return new HumanRequest(role, message)
  }
}

// Pre-built role templates
export const ceo = createHumanTemplate('ceo')
export const legal = createHumanTemplate('legal')
export const cfo = createHumanTemplate('cfo')
export const cto = createHumanTemplate('cto')
export const hr = createHumanTemplate('hr')
export const support = createHumanTemplate('support')
export const manager = createHumanTemplate('manager')
