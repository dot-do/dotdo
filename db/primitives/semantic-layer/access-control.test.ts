/**
 * Metrics Access Control Tests - TDD RED Phase
 *
 * Tests for fine-grained access control on the SemanticLayer:
 * - Cube-level access (who can query which cubes)
 * - Measure-level access (hide sensitive metrics)
 * - Dimension-level access (restrict grouping options)
 * - Row-level security (tenant isolation, data masking)
 * - Column-level security (PII redaction)
 * - Role-based access control integration
 * - Query-time security context injection
 *
 * @see dotdo-jaiwu
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SemanticLayer,
  type CubeDefinition,
  type SemanticQuery,
  InvalidQueryError,
} from './index'
import {
  MetricsAccessControl,
  MetricsAccessDeniedError,
  type MetricsAccessRule,
  type SecurityContext,
  type RowFilter,
  type ColumnMask,
} from './access-control'

// =============================================================================
// TEST FIXTURES
// =============================================================================

const salesCubeDefinition: CubeDefinition = {
  name: 'sales',
  sql: 'SELECT * FROM sales',
  measures: {
    count: { type: 'count' },
    revenue: { type: 'sum', sql: 'amount' },
    profit_margin: { type: 'avg', sql: 'profit_margin' },
    cost: { type: 'sum', sql: 'cost' },
    unique_customers: { type: 'countDistinct', sql: 'customer_id' },
  },
  dimensions: {
    region: { type: 'string', sql: 'region' },
    product: { type: 'string', sql: 'product' },
    customer_id: { type: 'string', sql: 'customer_id' },
    customer_email: { type: 'string', sql: 'customer_email' },
    customer_ssn: { type: 'string', sql: 'customer_ssn' },
    tenant_id: { type: 'string', sql: 'tenant_id' },
    created_at: { type: 'time', sql: 'created_at' },
  },
}

const hrCubeDefinition: CubeDefinition = {
  name: 'hr',
  sql: 'SELECT * FROM employees',
  measures: {
    count: { type: 'count' },
    avg_salary: { type: 'avg', sql: 'salary' },
    total_salary: { type: 'sum', sql: 'salary' },
  },
  dimensions: {
    department: { type: 'string', sql: 'department' },
    employee_name: { type: 'string', sql: 'name' },
    salary: { type: 'number', sql: 'salary' },
    tenant_id: { type: 'string', sql: 'tenant_id' },
  },
}

const financeCubeDefinition: CubeDefinition = {
  name: 'finance',
  sql: 'SELECT * FROM transactions',
  measures: {
    count: { type: 'count' },
    total_amount: { type: 'sum', sql: 'amount' },
    avg_transaction: { type: 'avg', sql: 'amount' },
  },
  dimensions: {
    account_number: { type: 'string', sql: 'account_number' },
    category: { type: 'string', sql: 'category' },
    tenant_id: { type: 'string', sql: 'tenant_id' },
  },
}

// =============================================================================
// CUBE-LEVEL ACCESS TESTS
// =============================================================================

describe('Cube-Level Access Control', () => {
  let semantic: SemanticLayer
  let accessControl: MetricsAccessControl

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(salesCubeDefinition)
    semantic.defineCube(hrCubeDefinition)
    semantic.defineCube(financeCubeDefinition)
    accessControl = new MetricsAccessControl(semantic)
  })

  describe('Cube Access Rules', () => {
    it('should allow access to cubes explicitly permitted for a role', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      const result = await accessControl.query(
        { measures: ['sales.count'] },
        ctx
      )

      expect(result.sql).toBeDefined()
      expect(result.sql).toContain('COUNT(*)')
    })

    it('should deny access to cubes not permitted for a role', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      await expect(
        accessControl.query({ measures: ['hr.count'] }, ctx)
      ).rejects.toThrow(MetricsAccessDeniedError)
    })

    it('should deny access to explicitly denied cubes', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['*'], deny: ['hr', 'finance'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // Allowed cube
      const result = await accessControl.query(
        { measures: ['sales.count'] },
        ctx
      )
      expect(result.sql).toBeDefined()

      // Denied cubes
      await expect(
        accessControl.query({ measures: ['hr.count'] }, ctx)
      ).rejects.toThrow(MetricsAccessDeniedError)

      await expect(
        accessControl.query({ measures: ['finance.count'] }, ctx)
      ).rejects.toThrow(MetricsAccessDeniedError)
    })

    it('should support wildcard (*) to allow all cubes', async () => {
      accessControl.addRule({
        role: 'admin',
        cubes: { allow: ['*'] },
      })

      const ctx: SecurityContext = { user: { id: 'admin-1', roles: ['admin'] } }

      const result1 = await accessControl.query({ measures: ['sales.count'] }, ctx)
      const result2 = await accessControl.query({ measures: ['hr.count'] }, ctx)
      const result3 = await accessControl.query({ measures: ['finance.count'] }, ctx)

      expect(result1.sql).toBeDefined()
      expect(result2.sql).toBeDefined()
      expect(result3.sql).toBeDefined()
    })

    it('should deny access when no rules match the user role', async () => {
      accessControl.addRule({
        role: 'admin',
        cubes: { allow: ['*'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['guest'] } }

      await expect(
        accessControl.query({ measures: ['sales.count'] }, ctx)
      ).rejects.toThrow(MetricsAccessDeniedError)
    })

    it('should combine rules from multiple roles', async () => {
      accessControl.addRule({
        role: 'sales-viewer',
        cubes: { allow: ['sales'] },
      })
      accessControl.addRule({
        role: 'hr-viewer',
        cubes: { allow: ['hr'] },
      })

      const ctx: SecurityContext = {
        user: { id: 'user-1', roles: ['sales-viewer', 'hr-viewer'] },
      }

      // Can access both cubes through combined roles
      const result1 = await accessControl.query({ measures: ['sales.count'] }, ctx)
      const result2 = await accessControl.query({ measures: ['hr.count'] }, ctx)

      expect(result1.sql).toBeDefined()
      expect(result2.sql).toBeDefined()

      // Still cannot access finance
      await expect(
        accessControl.query({ measures: ['finance.count'] }, ctx)
      ).rejects.toThrow(MetricsAccessDeniedError)
    })
  })
})

// =============================================================================
// MEASURE-LEVEL ACCESS TESTS
// =============================================================================

describe('Measure-Level Access Control', () => {
  let semantic: SemanticLayer
  let accessControl: MetricsAccessControl

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(salesCubeDefinition)
    accessControl = new MetricsAccessControl(semantic)
  })

  describe('Measure Allow/Deny Rules', () => {
    it('should allow access to explicitly permitted measures', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['count', 'revenue'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      const result = await accessControl.query(
        { measures: ['sales.count', 'sales.revenue'] },
        ctx
      )

      expect(result.sql).toContain('COUNT(*)')
      expect(result.sql).toContain('SUM')
    })

    it('should deny access to measures not in allow list', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['count', 'revenue'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      await expect(
        accessControl.query({ measures: ['sales.profit_margin'] }, ctx)
      ).rejects.toThrow(MetricsAccessDeniedError)
    })

    it('should deny access to explicitly denied measures', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'], deny: ['profit_margin', 'cost'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // Allowed measures
      const result = await accessControl.query(
        { measures: ['sales.count', 'sales.revenue'] },
        ctx
      )
      expect(result.sql).toBeDefined()

      // Denied measures
      await expect(
        accessControl.query({ measures: ['sales.profit_margin'] }, ctx)
      ).rejects.toThrow(MetricsAccessDeniedError)

      await expect(
        accessControl.query({ measures: ['sales.cost'] }, ctx)
      ).rejects.toThrow(MetricsAccessDeniedError)
    })

    it('should support cube-specific measure rules', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales', 'hr'] },
        measuresByCube: {
          sales: { allow: ['*'] },
          hr: { allow: ['count'], deny: ['avg_salary', 'total_salary'] },
        },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // Can access all sales measures
      const result1 = await accessControl.query(
        { measures: ['sales.profit_margin'] },
        ctx
      )
      expect(result1.sql).toBeDefined()

      // Can access hr.count
      const result2 = await accessControl.query(
        { measures: ['hr.count'] },
        ctx
      )
      expect(result2.sql).toBeDefined()

      // Cannot access hr salary measures
      await expect(
        accessControl.query({ measures: ['hr.avg_salary'] }, ctx)
      ).rejects.toThrow(MetricsAccessDeniedError)
    })

    it('should provide helpful error message with denied measure name', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['count'], deny: ['profit_margin'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      try {
        await accessControl.query({ measures: ['sales.profit_margin'] }, ctx)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(MetricsAccessDeniedError)
        expect((error as MetricsAccessDeniedError).message).toContain('profit_margin')
        expect((error as MetricsAccessDeniedError).deniedMeasure).toBe('sales.profit_margin')
      }
    })
  })
})

// =============================================================================
// DIMENSION-LEVEL ACCESS TESTS
// =============================================================================

describe('Dimension-Level Access Control', () => {
  let semantic: SemanticLayer
  let accessControl: MetricsAccessControl

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(salesCubeDefinition)
    accessControl = new MetricsAccessControl(semantic)
  })

  describe('Dimension Allow/Deny Rules', () => {
    it('should allow grouping by permitted dimensions', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['region', 'product', 'created_at'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      const result = await accessControl.query(
        {
          measures: ['sales.count'],
          dimensions: ['sales.region', 'sales.product'],
        },
        ctx
      )

      expect(result.sql).toContain('region')
      expect(result.sql).toContain('product')
      expect(result.sql).toContain('GROUP BY')
    })

    it('should deny grouping by dimensions not in allow list', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['region', 'product'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // customer_id not in allow list
      await expect(
        accessControl.query(
          {
            measures: ['sales.count'],
            dimensions: ['sales.customer_id'],
          },
          ctx
        )
      ).rejects.toThrow(MetricsAccessDeniedError)
    })

    it('should deny grouping by explicitly denied dimensions', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'], deny: ['customer_id', 'customer_email', 'customer_ssn'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // PII dimensions denied
      await expect(
        accessControl.query(
          {
            measures: ['sales.count'],
            dimensions: ['sales.customer_email'],
          },
          ctx
        )
      ).rejects.toThrow(MetricsAccessDeniedError)
    })

    it('should deny filtering by restricted dimensions', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['region', 'product'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // Cannot filter by customer_id either
      await expect(
        accessControl.query(
          {
            measures: ['sales.count'],
            filters: [
              { dimension: 'sales.customer_id', operator: 'equals', values: ['cust-1'] },
            ],
          },
          ctx
        )
      ).rejects.toThrow(MetricsAccessDeniedError)
    })

    it('should allow filtering by permitted dimensions', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['region', 'product', 'created_at'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      const result = await accessControl.query(
        {
          measures: ['sales.count'],
          filters: [
            { dimension: 'sales.region', operator: 'equals', values: ['US'] },
          ],
        },
        ctx
      )

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('region')
    })
  })
})

// =============================================================================
// ROW-LEVEL SECURITY TESTS
// =============================================================================

describe('Row-Level Security', () => {
  let semantic: SemanticLayer
  let accessControl: MetricsAccessControl

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(salesCubeDefinition)
    accessControl = new MetricsAccessControl(semantic)
  })

  describe('Tenant Isolation', () => {
    it('should automatically inject tenant filter from security context', async () => {
      accessControl.addRule({
        role: 'tenant-user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        rowFilter: (ctx) => `tenant_id = '${ctx.user.tenantId}'`,
      })

      const ctx: SecurityContext = {
        user: { id: 'user-1', roles: ['tenant-user'], tenantId: 'acme-corp' },
      }

      const result = await accessControl.query(
        { measures: ['sales.count'] },
        ctx
      )

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain("tenant_id = 'acme-corp'")
    })

    it('should combine tenant filter with user-provided filters', async () => {
      accessControl.addRule({
        role: 'tenant-user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        rowFilter: (ctx) => `tenant_id = '${ctx.user.tenantId}'`,
      })

      const ctx: SecurityContext = {
        user: { id: 'user-1', roles: ['tenant-user'], tenantId: 'acme-corp' },
      }

      const result = await accessControl.query(
        {
          measures: ['sales.count'],
          filters: [
            { dimension: 'sales.region', operator: 'equals', values: ['US'] },
          ],
        },
        ctx
      )

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain("tenant_id = 'acme-corp'")
      expect(result.sql).toContain('AND')
      expect(result.sql).toContain('region')
    })

    it('should prevent row filter bypass via SQL injection', async () => {
      accessControl.addRule({
        role: 'tenant-user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        rowFilter: (ctx) => `tenant_id = '${ctx.user.tenantId}'`,
      })

      // Attempt SQL injection via tenant ID
      const maliciousCtx: SecurityContext = {
        user: {
          id: 'user-1',
          roles: ['tenant-user'],
          tenantId: "'; DROP TABLE sales; --",
        },
      }

      // Should sanitize or reject malicious input
      await expect(
        accessControl.query({ measures: ['sales.count'] }, maliciousCtx)
      ).rejects.toThrow()
    })
  })

  describe('Region-Based Row Filtering', () => {
    it('should filter rows based on user region', async () => {
      accessControl.addRule({
        role: 'sales',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        rowFilter: (ctx) => `region = '${ctx.user.region}'`,
      })

      const ctx: SecurityContext = {
        user: { id: 'sales-1', roles: ['sales'], region: 'APAC' },
      }

      const result = await accessControl.query(
        { measures: ['sales.revenue'] },
        ctx
      )

      expect(result.sql).toContain("region = 'APAC'")
    })

    it('should support multiple values in row filter', async () => {
      accessControl.addRule({
        role: 'regional-manager',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        rowFilter: (ctx) => {
          const regions = ctx.user.managedRegions as string[]
          return `region IN (${regions.map((r) => `'${r}'`).join(', ')})`
        },
      })

      const ctx: SecurityContext = {
        user: {
          id: 'manager-1',
          roles: ['regional-manager'],
          managedRegions: ['US', 'EMEA'],
        },
      }

      const result = await accessControl.query(
        { measures: ['sales.revenue'] },
        ctx
      )

      expect(result.sql).toContain('region IN')
      expect(result.sql).toContain("'US'")
      expect(result.sql).toContain("'EMEA'")
    })
  })

  describe('Dynamic Row Filters', () => {
    it('should support date-based row filters', async () => {
      accessControl.addRule({
        role: 'limited-analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        rowFilter: () => {
          const thirtyDaysAgo = new Date()
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
          return `created_at >= '${thirtyDaysAgo.toISOString().split('T')[0]}'`
        },
      })

      const ctx: SecurityContext = {
        user: { id: 'user-1', roles: ['limited-analyst'] },
      }

      const result = await accessControl.query(
        { measures: ['sales.count'] },
        ctx
      )

      expect(result.sql).toContain('created_at >=')
    })

    it('should combine multiple row filters from different rules', async () => {
      accessControl.addRule({
        role: 'tenant-user',
        cubes: { allow: ['sales'] },
        rowFilter: (ctx) => `tenant_id = '${ctx.user.tenantId}'`,
      })

      accessControl.addRule({
        role: 'sales-team',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        rowFilter: (ctx) => `region = '${ctx.user.region}'`,
      })

      const ctx: SecurityContext = {
        user: {
          id: 'user-1',
          roles: ['tenant-user', 'sales-team'],
          tenantId: 'acme',
          region: 'US',
        },
      }

      const result = await accessControl.query(
        { measures: ['sales.count'] },
        ctx
      )

      // Both filters should be applied (AND)
      expect(result.sql).toContain("tenant_id = 'acme'")
      expect(result.sql).toContain("region = 'US'")
    })
  })
})

// =============================================================================
// COLUMN-LEVEL SECURITY / PII REDACTION TESTS
// =============================================================================

describe('Column-Level Security (PII Redaction)', () => {
  let semantic: SemanticLayer
  let accessControl: MetricsAccessControl

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(salesCubeDefinition)
    accessControl = new MetricsAccessControl(semantic)
  })

  describe('Data Masking', () => {
    it('should mask PII columns in query results', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        columnMasks: {
          customer_email: (value) => '***@***.***',
          customer_ssn: (value) => '***-**-****',
        },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      const result = await accessControl.query(
        {
          measures: ['sales.count'],
          dimensions: ['sales.customer_email'],
        },
        ctx
      )

      // SQL should use masking function
      expect(result.sql).toContain('customer_email')
      expect(result.maskedColumns).toContain('customer_email')
    })

    it('should apply partial masking for emails', async () => {
      accessControl.addRule({
        role: 'support',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        columnMasks: {
          customer_email: (value) => {
            if (typeof value !== 'string') return '***'
            const [local, domain] = value.split('@')
            return `${local?.slice(0, 2)}***@${domain}`
          },
        },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['support'] } }

      const result = await accessControl.query(
        {
          measures: ['sales.count'],
          dimensions: ['sales.customer_email'],
        },
        ctx
      )

      expect(result.maskedColumns).toContain('customer_email')
    })

    it('should allow full column access for privileged roles', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        columnMasks: {
          customer_email: () => '***@***.***',
        },
      })

      accessControl.addRule({
        role: 'data-admin',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        // No column masks - full access
      })

      const adminCtx: SecurityContext = {
        user: { id: 'admin-1', roles: ['data-admin'] },
      }

      const result = await accessControl.query(
        {
          measures: ['sales.count'],
          dimensions: ['sales.customer_email'],
        },
        adminCtx
      )

      // No masking for admin
      expect(result.maskedColumns).toBeUndefined()
    })

    it('should apply SQL-level masking functions', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        columnMasksSql: {
          customer_email: "CONCAT(LEFT(customer_email, 2), '***@***')",
          customer_ssn: "'***-**-' || RIGHT(customer_ssn, 4)",
        },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      const result = await accessControl.query(
        {
          measures: ['sales.count'],
          dimensions: ['sales.customer_email', 'sales.customer_ssn'],
        },
        ctx
      )

      expect(result.sql).toContain('CONCAT')
      expect(result.sql).toContain('LEFT')
    })
  })

  describe('Column Exclusion', () => {
    it('should completely exclude sensitive columns from results', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['region', 'product', 'created_at'] },
        excludeColumns: ['customer_ssn', 'customer_email', 'customer_id'],
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // Cannot even request excluded columns
      await expect(
        accessControl.query(
          {
            measures: ['sales.count'],
            dimensions: ['sales.customer_ssn'],
          },
          ctx
        )
      ).rejects.toThrow(MetricsAccessDeniedError)
    })
  })
})

// =============================================================================
// ROLE-BASED ACCESS CONTROL INTEGRATION TESTS
// =============================================================================

describe('RBAC Integration', () => {
  let semantic: SemanticLayer
  let accessControl: MetricsAccessControl

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(salesCubeDefinition)
    semantic.defineCube(hrCubeDefinition)
    semantic.defineCube(financeCubeDefinition)
    accessControl = new MetricsAccessControl(semantic)
  })

  describe('Role Hierarchy', () => {
    it('should support role inheritance', async () => {
      // Base viewer role
      accessControl.addRule({
        role: 'viewer',
        cubes: { allow: ['sales'] },
        measures: { allow: ['count'] },
        dimensions: { allow: ['region'] },
      })

      // Analyst inherits from viewer and adds more
      accessControl.addRule({
        role: 'analyst',
        inherits: ['viewer'],
        measures: { allow: ['revenue'] },
        dimensions: { allow: ['product'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // Can use inherited permissions
      const result = await accessControl.query(
        {
          measures: ['sales.count', 'sales.revenue'],
          dimensions: ['sales.region', 'sales.product'],
        },
        ctx
      )

      expect(result.sql).toBeDefined()
    })

    it('should resolve deep role inheritance chains', async () => {
      accessControl.addRule({
        role: 'base',
        cubes: { allow: ['sales'] },
        measures: { allow: ['count'] },
      })

      accessControl.addRule({
        role: 'intermediate',
        inherits: ['base'],
        measures: { allow: ['revenue'] },
      })

      accessControl.addRule({
        role: 'advanced',
        inherits: ['intermediate'],
        measures: { allow: ['profit_margin'] },
        dimensions: { allow: ['*'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['advanced'] } }

      // Should have access to all inherited measures
      const result = await accessControl.query(
        {
          measures: ['sales.count', 'sales.revenue', 'sales.profit_margin'],
        },
        ctx
      )

      expect(result.sql).toBeDefined()
    })
  })

  describe('Permission Groups', () => {
    it('should support permission groups/presets', async () => {
      // Define a preset
      accessControl.definePreset('pii-protected', {
        dimensions: { deny: ['customer_id', 'customer_email', 'customer_ssn'] },
        columnMasks: {
          customer_email: () => '***@***.***',
        },
      })

      // Use preset in rules
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        presets: ['pii-protected'],
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // PII dimensions should be denied
      await expect(
        accessControl.query(
          {
            measures: ['sales.count'],
            dimensions: ['sales.customer_email'],
          },
          ctx
        )
      ).rejects.toThrow(MetricsAccessDeniedError)
    })
  })

  describe('Dynamic Role Assignment', () => {
    it('should support context-based role elevation', async () => {
      accessControl.addRule({
        role: 'user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['count'] },
      })

      accessControl.addRule({
        role: 'elevated-user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        condition: (ctx) => ctx.user.attributes?.elevatedUntil &&
          new Date(ctx.user.attributes.elevatedUntil as string) > new Date(),
      })

      const elevatedCtx: SecurityContext = {
        user: {
          id: 'user-1',
          roles: ['user', 'elevated-user'],
          attributes: {
            elevatedUntil: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
          },
        },
      }

      // Can access elevated permissions
      const result = await accessControl.query(
        { measures: ['sales.profit_margin'] },
        elevatedCtx
      )
      expect(result.sql).toBeDefined()

      // Expired elevation
      const expiredCtx: SecurityContext = {
        user: {
          id: 'user-1',
          roles: ['user', 'elevated-user'],
          attributes: {
            elevatedUntil: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          },
        },
      }

      await expect(
        accessControl.query({ measures: ['sales.profit_margin'] }, expiredCtx)
      ).rejects.toThrow(MetricsAccessDeniedError)
    })
  })
})

// =============================================================================
// QUERY-TIME SECURITY CONTEXT INJECTION TESTS
// =============================================================================

describe('Query-Time Security Context Injection', () => {
  let semantic: SemanticLayer
  let accessControl: MetricsAccessControl

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(salesCubeDefinition)
    accessControl = new MetricsAccessControl(semantic)
  })

  describe('Context Injection', () => {
    it('should inject security context into query generation', async () => {
      accessControl.addRule({
        role: 'user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        contextInjection: {
          variables: {
            current_user_id: (ctx) => ctx.user.id,
            current_tenant: (ctx) => ctx.user.tenantId,
          },
        },
      })

      const ctx: SecurityContext = {
        user: { id: 'user-123', roles: ['user'], tenantId: 'acme' },
      }

      const result = await accessControl.query(
        { measures: ['sales.count'] },
        ctx
      )

      // Context should be available in generated SQL comments or audit log
      expect(result.securityContext).toBeDefined()
      expect(result.securityContext?.currentUserId).toBe('user-123')
    })

    it('should support audit logging with security context', async () => {
      const auditLogs: Array<{ query: SemanticQuery; ctx: SecurityContext }> = []

      accessControl.onQuery((query, ctx) => {
        auditLogs.push({ query, ctx })
      })

      accessControl.addRule({
        role: 'user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
      })

      const ctx: SecurityContext = {
        user: { id: 'user-1', roles: ['user'] },
      }

      await accessControl.query({ measures: ['sales.count'] }, ctx)

      expect(auditLogs).toHaveLength(1)
      expect(auditLogs[0].ctx.user.id).toBe('user-1')
    })

    it('should validate security context before query execution', async () => {
      accessControl.addRule({
        role: 'user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
      })

      // Missing required context
      const invalidCtx = {} as SecurityContext

      await expect(
        accessControl.query({ measures: ['sales.count'] }, invalidCtx)
      ).rejects.toThrow()
    })
  })

  describe('Request Tracing', () => {
    it('should include request ID in query metadata', async () => {
      accessControl.addRule({
        role: 'user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
      })

      const ctx: SecurityContext = {
        user: { id: 'user-1', roles: ['user'] },
        requestId: 'req-abc-123',
      }

      const result = await accessControl.query(
        { measures: ['sales.count'] },
        ctx
      )

      expect(result.requestId).toBe('req-abc-123')
    })
  })
})

// =============================================================================
// BYPASS PREVENTION TESTS
// =============================================================================

describe('Security Bypass Prevention', () => {
  let semantic: SemanticLayer
  let accessControl: MetricsAccessControl

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(salesCubeDefinition)
    accessControl = new MetricsAccessControl(semantic)
  })

  describe('SQL Injection Prevention', () => {
    it('should sanitize user input in row filters', async () => {
      accessControl.addRule({
        role: 'user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        rowFilter: (ctx) => `region = '${ctx.user.region}'`,
      })

      const maliciousCtx: SecurityContext = {
        user: {
          id: 'user-1',
          roles: ['user'],
          region: "US' OR '1'='1",
        },
      }

      await expect(
        accessControl.query({ measures: ['sales.count'] }, maliciousCtx)
      ).rejects.toThrow()
    })

    it('should prevent filter manipulation to bypass row-level security', async () => {
      accessControl.addRule({
        role: 'tenant-user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
        rowFilter: (ctx) => `tenant_id = '${ctx.user.tenantId}'`,
      })

      const ctx: SecurityContext = {
        user: { id: 'user-1', roles: ['tenant-user'], tenantId: 'acme' },
      }

      // User tries to add conflicting filter to see other tenant's data
      const result = await accessControl.query(
        {
          measures: ['sales.count'],
          filters: [
            { dimension: 'sales.tenant_id', operator: 'equals', values: ['other-tenant'] },
          ],
        },
        ctx
      )

      // Security filter should be enforced regardless of user filter
      // Either user filter is ignored/overwritten, or query returns no data
      expect(result.sql).toContain("tenant_id = 'acme'")
    })
  })

  describe('Authorization Bypass Prevention', () => {
    it('should not allow accessing cubes via dimensions from allowed cubes', async () => {
      semantic.defineCube({
        name: 'orders',
        sql: 'SELECT * FROM orders',
        measures: { count: { type: 'count' } },
        dimensions: { id: { type: 'string', sql: 'id' } },
        joins: [
          {
            name: 'sales',
            relationship: 'hasMany',
            sql: '${orders}.id = ${sales}.order_id',
          },
        ],
      })

      accessControl.addRule({
        role: 'user',
        cubes: { allow: ['orders'] }, // Only orders, not sales
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['user'] } }

      // Should not allow accessing sales via join
      await expect(
        accessControl.query(
          {
            measures: ['orders.count'],
            dimensions: ['sales.region'], // Try to access sales via join
          },
          ctx
        )
      ).rejects.toThrow(MetricsAccessDeniedError)
    })

    it('should enforce rules on pre-aggregation queries', async () => {
      semantic.definePreAggregation('sales', {
        name: 'daily_revenue',
        measures: ['revenue', 'profit_margin'],
        dimensions: ['region'],
        timeDimension: 'created_at',
        granularity: 'day',
      })

      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['revenue'], deny: ['profit_margin'] },
        dimensions: { allow: ['*'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // Even if pre-agg includes profit_margin, user cannot access it
      await expect(
        accessControl.query(
          {
            measures: ['sales.profit_margin'],
            timeDimensions: [{ dimension: 'sales.created_at', granularity: 'day' }],
          },
          ctx
        )
      ).rejects.toThrow(MetricsAccessDeniedError)
    })
  })

  describe('Context Manipulation Prevention', () => {
    it('should validate security context integrity', async () => {
      accessControl.addRule({
        role: 'user',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
      })

      // Attempt to inject additional roles
      const tamperedCtx: SecurityContext = {
        user: {
          id: 'user-1',
          roles: ['user', 'admin'], // Trying to add admin role
        },
      }

      // If using signed tokens or server-side validation, this should be rejected
      // For this implementation, we'll test that only registered roles are effective
      accessControl.addRule({
        role: 'admin',
        cubes: { allow: ['*'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
      })

      // Without proper authentication, admin role should not grant access
      // This depends on implementation - could use role validation callback
      accessControl.setRoleValidator((role, ctx) => {
        // Only 'user' role is valid for this test
        return role === 'user'
      })

      const result = await accessControl.query(
        { measures: ['sales.count'] },
        tamperedCtx
      )

      // Should succeed with user role but not admin
      expect(result.sql).toBeDefined()

      // Admin-only cube should still be denied
      await expect(
        accessControl.query({ measures: ['hr.count'] }, tamperedCtx)
      ).rejects.toThrow(MetricsAccessDeniedError)
    })
  })
})

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  let semantic: SemanticLayer
  let accessControl: MetricsAccessControl

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(salesCubeDefinition)
    accessControl = new MetricsAccessControl(semantic)
  })

  describe('MetricsAccessDeniedError', () => {
    it('should provide detailed error information', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['count'] },
        dimensions: { allow: ['region'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      try {
        await accessControl.query({ measures: ['sales.profit_margin'] }, ctx)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(MetricsAccessDeniedError)
        const e = error as MetricsAccessDeniedError
        expect(e.deniedMeasure).toBe('sales.profit_margin')
        expect(e.userId).toBe('user-1')
        expect(e.roles).toContain('analyst')
      }
    })

    it('should distinguish between cube, measure, and dimension denials', async () => {
      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['count'] },
        dimensions: { allow: ['region'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      // Cube denial
      try {
        await accessControl.query({ measures: ['hr.count'] }, ctx)
      } catch (error) {
        expect((error as MetricsAccessDeniedError).denialType).toBe('cube')
      }

      // Measure denial
      try {
        await accessControl.query({ measures: ['sales.profit_margin'] }, ctx)
      } catch (error) {
        expect((error as MetricsAccessDeniedError).denialType).toBe('measure')
      }

      // Dimension denial
      try {
        await accessControl.query(
          {
            measures: ['sales.count'],
            dimensions: ['sales.customer_id'],
          },
          ctx
        )
      } catch (error) {
        expect((error as MetricsAccessDeniedError).denialType).toBe('dimension')
      }
    })
  })
})

// =============================================================================
// CONFIGURATION API TESTS
// =============================================================================

describe('Configuration API', () => {
  let semantic: SemanticLayer
  let accessControl: MetricsAccessControl

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(salesCubeDefinition)
    accessControl = new MetricsAccessControl(semantic)
  })

  describe('Rule Management', () => {
    it('should add and remove rules', () => {
      const rule: MetricsAccessRule = {
        id: 'rule-1',
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['*'] },
        dimensions: { allow: ['*'] },
      }

      accessControl.addRule(rule)
      expect(accessControl.getRule('rule-1')).toBeDefined()

      accessControl.removeRule('rule-1')
      expect(accessControl.getRule('rule-1')).toBeUndefined()
    })

    it('should update existing rules', () => {
      accessControl.addRule({
        id: 'rule-1',
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['count'] },
      })

      accessControl.updateRule('rule-1', {
        measures: { allow: ['count', 'revenue'] },
      })

      const rule = accessControl.getRule('rule-1')
      expect(rule?.measures?.allow).toContain('revenue')
    })

    it('should list all rules', () => {
      accessControl.addRule({
        id: 'rule-1',
        role: 'analyst',
        cubes: { allow: ['sales'] },
      })
      accessControl.addRule({
        id: 'rule-2',
        role: 'admin',
        cubes: { allow: ['*'] },
      })

      const rules = accessControl.listRules()
      expect(rules).toHaveLength(2)
    })

    it('should list rules by role', () => {
      accessControl.addRule({
        id: 'rule-1',
        role: 'analyst',
        cubes: { allow: ['sales'] },
      })
      accessControl.addRule({
        id: 'rule-2',
        role: 'admin',
        cubes: { allow: ['*'] },
      })
      accessControl.addRule({
        id: 'rule-3',
        role: 'analyst',
        measures: { allow: ['count'] },
      })

      const analystRules = accessControl.listRules({ role: 'analyst' })
      expect(analystRules).toHaveLength(2)
    })
  })

  describe('Schema Introspection with Access Control', () => {
    it('should return filtered schema based on user access', async () => {
      semantic.defineCube(hrCubeDefinition)

      accessControl.addRule({
        role: 'analyst',
        cubes: { allow: ['sales'] },
        measures: { allow: ['count', 'revenue'] },
        dimensions: { allow: ['region', 'product'] },
      })

      const ctx: SecurityContext = { user: { id: 'user-1', roles: ['analyst'] } }

      const meta = await accessControl.getMeta(ctx)

      // Should only see sales cube
      expect(meta.cubes).toHaveLength(1)
      expect(meta.cubes[0].name).toBe('sales')

      // Should only see allowed measures
      const measures = meta.cubes[0].measures.map((m) => m.name)
      expect(measures).toContain('count')
      expect(measures).toContain('revenue')
      expect(measures).not.toContain('profit_margin')

      // Should only see allowed dimensions
      const dimensions = meta.cubes[0].dimensions.map((d) => d.name)
      expect(dimensions).toContain('region')
      expect(dimensions).toContain('product')
      expect(dimensions).not.toContain('customer_email')
    })
  })
})
