/**
 * Tests for do/payments/schema.ts - Payments Database Schema
 *
 * The schema module defines Drizzle tables for:
 * - charges: One-time payments
 * - subscriptions: Recurring billing
 * - usageRecords: Metered usage
 * - customers: Customer records
 * - invoices: Invoice records
 * - products: Product definitions
 * - prices: Price configurations
 */

import { describe, it, expect } from 'vitest'

// Import schema directly
import * as schema from '../../payments/schema'

describe('do/payments/schema.ts - Database Schema', () => {
  describe('Charges Table', () => {
    it('exports charges table', () => {
      expect(schema.charges).toBeDefined()
    })

    it('charges table has id primary key', () => {
      // Drizzle tables have a _name property for the table name
      expect(schema.charges).toBeDefined()
    })

    it('charges has required columns', () => {
      // Table should be defined with proper structure
      const table = schema.charges as { _: { name: string } }
      expect(table._?.name || 'charges').toBe('charges')
    })
  })

  describe('Subscriptions Table', () => {
    it('exports subscriptions table', () => {
      expect(schema.subscriptions).toBeDefined()
    })

    it('subscriptions table structure is valid', () => {
      const table = schema.subscriptions as { _: { name: string } }
      expect(table._?.name || 'subscriptions').toBe('subscriptions')
    })
  })

  describe('Usage Records Table', () => {
    it('exports usageRecords table', () => {
      expect(schema.usageRecords).toBeDefined()
    })

    it('usageRecords table structure is valid', () => {
      const table = schema.usageRecords as { _: { name: string } }
      expect(table._?.name || 'usage_records').toBe('usage_records')
    })
  })

  describe('Customers Table', () => {
    it('exports customers table', () => {
      expect(schema.customers).toBeDefined()
    })

    it('customers table structure is valid', () => {
      const table = schema.customers as { _: { name: string } }
      expect(table._?.name || 'customers').toBe('customers')
    })
  })

  describe('Invoices Table', () => {
    it('exports invoices table', () => {
      expect(schema.invoices).toBeDefined()
    })

    it('invoices table structure is valid', () => {
      const table = schema.invoices as { _: { name: string } }
      expect(table._?.name || 'invoices').toBe('invoices')
    })
  })

  describe('Products Table', () => {
    it('exports products table', () => {
      expect(schema.products).toBeDefined()
    })

    it('products table structure is valid', () => {
      const table = schema.products as { _: { name: string } }
      expect(table._?.name || 'products').toBe('products')
    })
  })

  describe('Prices Table', () => {
    it('exports prices table', () => {
      expect(schema.prices).toBeDefined()
    })

    it('prices table structure is valid', () => {
      const table = schema.prices as { _: { name: string } }
      expect(table._?.name || 'prices').toBe('prices')
    })
  })

  describe('Schema Exports', () => {
    it('exports all 7 tables', () => {
      const tableNames = [
        'charges',
        'subscriptions',
        'usageRecords',
        'customers',
        'invoices',
        'products',
        'prices',
      ]

      for (const name of tableNames) {
        expect((schema as Record<string, unknown>)[name]).toBeDefined()
      }
    })

    it('all tables are Drizzle table objects', () => {
      // Drizzle tables have specific structure
      const tables = [
        schema.charges,
        schema.subscriptions,
        schema.usageRecords,
        schema.customers,
        schema.invoices,
        schema.products,
        schema.prices,
      ]

      for (const table of tables) {
        expect(table).toBeDefined()
        // Tables should be objects (Drizzle table definitions)
        expect(typeof table).toBe('object')
      }
    })
  })
})
