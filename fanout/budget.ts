/**
 * SubrequestBudget - Track and enforce Cloudflare subrequest limits
 *
 * Workers: 50 subrequests
 * Durable Objects: 1000 subrequests
 */
export class SubrequestBudget {
  public readonly initial: number
  private _used: number = 0

  constructor(limit: number = 50) {
    this.initial = limit
  }

  get remaining(): number {
    return this.initial - this._used
  }

  get used(): number {
    return this._used
  }

  get exhausted(): boolean {
    return this.remaining <= 0
  }

  /**
   * Track subrequest usage (strict mode)
   * @throws Error if tracking would exceed budget
   */
  track(count: number): void {
    if (this._used + count > this.initial) {
      throw new Error(
        `Budget exceeded: attempting to use ${count} but only ${this.remaining} remaining`
      )
    }
    this._used += count
  }

  /**
   * Track subrequest usage without bounds checking
   * Used for multi-batch operations where total usage can exceed initial budget
   * (each batch represents a separate request round)
   */
  trackUnchecked(count: number): void {
    this._used += count
  }

  /**
   * Check if we can make N subrequests
   */
  canMake(count: number): boolean {
    return this.remaining >= count
  }

  /**
   * Calculate optimal batch size for N scanners
   */
  optimalBatchSize(scannerCount: number): number {
    return Math.min(this.remaining, scannerCount)
  }
}
