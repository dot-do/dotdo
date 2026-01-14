/**
 * Credit-Based Pricing Module - Prepaid consumption pricing model
 *
 * Manages credit balances with:
 * - FIFO credit consumption
 * - Configurable expiration
 * - Automatic top-up support
 *
 * @module lib/pricing/credit
 */

import type { CreditPricing } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Details of a credit purchase
 */
export interface CreditPurchase {
  /** Number of credits purchased */
  amount: number
  /** Price paid for the credits */
  price: number
  /** When the purchase was made */
  purchasedAt: Date
  /** When these credits expire (null = never) */
  expiresAt: Date | null
  /** Remaining credits from this purchase */
  remaining: number
}

/**
 * Result of a credit usage attempt
 */
export interface CreditUsageResult {
  /** Whether the usage was successful */
  success: boolean
  /** Number of credits actually used */
  creditsUsed: number
  /** Error code if unsuccessful */
  error?: 'insufficient_balance' | 'invalid_amount'
}

/**
 * Top-up event details
 */
export interface TopUpEvent {
  /** Number of credits added */
  amount: number
  /** Why the top-up occurred */
  reason: 'threshold'
  /** Timestamp of the top-up */
  timestamp: Date
}

/**
 * Options for creating a credit account
 */
export interface CreditAccountOptions {
  /** Callback when automatic top-up is triggered */
  onTopUp?: (event: TopUpEvent) => void
}

// ============================================================================
// CreditAccount Interface
// ============================================================================

/**
 * Credit account for tracking prepaid credit balances
 */
export interface CreditAccount {
  /** Get current available credit balance (excludes expired) */
  getBalance(): number
  /** Get the pricing configuration */
  getPricing(): CreditPricing
  /** Purchase a new bundle of credits */
  purchaseCredits(): CreditPurchase
  /** Use credits from the account */
  useCredits(amount: number): CreditUsageResult
  /** Get purchase history */
  getPurchaseHistory(): CreditPurchase[]
  /** Get total expired credits */
  getExpiredCredits(): number
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a new credit account with the given pricing configuration
 *
 * @param pricing - The credit pricing configuration
 * @param options - Optional configuration (onTopUp callback)
 * @returns A new CreditAccount instance
 *
 * @example
 * ```typescript
 * const pricing: CreditPricing = {
 *   model: 'credit',
 *   price: 99,
 *   amount: 100,
 *   expiration: 365,
 * }
 *
 * const account = createCreditAccount(pricing)
 * account.purchaseCredits()
 * account.useCredits(10)
 * console.log(account.getBalance()) // 90
 * ```
 */
export function createCreditAccount(
  pricing: CreditPricing,
  options: CreditAccountOptions = {}
): CreditAccount {
  const purchases: CreditPurchase[] = []
  let totalExpired = 0

  /**
   * Remove expired credits and track them
   */
  function processExpiration(): void {
    const now = new Date()
    for (const purchase of purchases) {
      if (purchase.expiresAt && purchase.expiresAt <= now && purchase.remaining > 0) {
        totalExpired += purchase.remaining
        purchase.remaining = 0
      }
    }
  }

  /**
   * Check if auto top-up should be triggered and execute it
   */
  function checkAutoTopUp(): void {
    if (!pricing.topUp?.enabled || !options.onTopUp) {
      return
    }

    const balance = getBalance()
    if (balance < pricing.topUp.threshold) {
      // Create a top-up purchase
      const topUpAmount = pricing.topUp.amount
      const now = new Date()
      const expiresAt = pricing.expiration
        ? new Date(now.getTime() + pricing.expiration * 24 * 60 * 60 * 1000)
        : null

      const purchase: CreditPurchase = {
        amount: topUpAmount,
        price: (pricing.price / pricing.amount) * topUpAmount, // Pro-rated price
        purchasedAt: now,
        expiresAt,
        remaining: topUpAmount,
      }

      purchases.push(purchase)

      // Notify via callback
      options.onTopUp({
        amount: topUpAmount,
        reason: 'threshold',
        timestamp: now,
      })
    }
  }

  function getBalance(): number {
    processExpiration()
    return purchases.reduce((sum, p) => sum + p.remaining, 0)
  }

  function getPricing(): CreditPricing {
    return pricing
  }

  function purchaseCredits(): CreditPurchase {
    const now = new Date()
    const expiresAt = pricing.expiration
      ? new Date(now.getTime() + pricing.expiration * 24 * 60 * 60 * 1000)
      : null

    const purchase: CreditPurchase = {
      amount: pricing.amount,
      price: pricing.price,
      purchasedAt: now,
      expiresAt,
      remaining: pricing.amount,
    }

    purchases.push(purchase)
    return purchase
  }

  function useCredits(amount: number): CreditUsageResult {
    // Validate amount
    if (amount <= 0) {
      return {
        success: false,
        creditsUsed: 0,
        error: 'invalid_amount',
      }
    }

    processExpiration()

    const currentBalance = getBalance()
    if (currentBalance < amount) {
      return {
        success: false,
        creditsUsed: 0,
        error: 'insufficient_balance',
      }
    }

    // FIFO consumption - use oldest credits first
    let remaining = amount
    for (const purchase of purchases) {
      if (remaining <= 0) break
      if (purchase.remaining <= 0) continue

      const toUse = Math.min(purchase.remaining, remaining)
      purchase.remaining -= toUse
      remaining -= toUse
    }

    // Check for auto top-up after successful usage
    checkAutoTopUp()

    return {
      success: true,
      creditsUsed: amount,
    }
  }

  function getPurchaseHistory(): CreditPurchase[] {
    return [...purchases]
  }

  function getExpiredCredits(): number {
    processExpiration()
    return totalExpired
  }

  return {
    getBalance,
    getPricing,
    purchaseCredits,
    useCredits,
    getPurchaseHistory,
    getExpiredCredits,
  }
}
