/**
 * Tests for do/payments/index.ts - Payments Module Entry Point
 *
 * The payments module provides:
 * - PaymentsDO class for Stripe Connect payments
 * - Type exports for Charge, Subscription, UsageRecord
 * - Schema exports for database tables
 */

import { describe, it, expect } from 'vitest'

// Import from the payments entry point
import * as payments from '../../payments'

describe('do/payments/index.ts - Payments Module Entry Point', () => {
  describe('PaymentsDO Export', () => {
    it('exports PaymentsDO class', () => {
      expect(payments.PaymentsDO).toBeDefined()
      expect(typeof payments.PaymentsDO).toBe('function')
    })

    it('PaymentsDO is a class constructor', () => {
      expect(payments.PaymentsDO.prototype).toBeDefined()
      expect(payments.PaymentsDO.prototype.constructor).toBe(payments.PaymentsDO)
    })
  })

  describe('Schema Export', () => {
    it('exports paymentsSchema', () => {
      expect(payments.paymentsSchema).toBeDefined()
      expect(typeof payments.paymentsSchema).toBe('object')
    })

    it('schema contains charges table', () => {
      expect(payments.paymentsSchema.charges).toBeDefined()
    })

    it('schema contains subscriptions table', () => {
      expect(payments.paymentsSchema.subscriptions).toBeDefined()
    })

    it('schema contains usageRecords table', () => {
      expect(payments.paymentsSchema.usageRecords).toBeDefined()
    })

    it('schema contains customers table', () => {
      expect(payments.paymentsSchema.customers).toBeDefined()
    })

    it('schema contains invoices table', () => {
      expect(payments.paymentsSchema.invoices).toBeDefined()
    })

    it('schema contains products table', () => {
      expect(payments.paymentsSchema.products).toBeDefined()
    })

    it('schema contains prices table', () => {
      expect(payments.paymentsSchema.prices).toBeDefined()
    })
  })

  describe('Export Count', () => {
    it('exports expected symbols', () => {
      const exportKeys = Object.keys(payments)
      expect(exportKeys).toContain('PaymentsDO')
      expect(exportKeys).toContain('paymentsSchema')
    })
  })
})
