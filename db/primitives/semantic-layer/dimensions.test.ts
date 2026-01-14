/**
 * Dimension Types Tests - TDD RED Phase
 *
 * Tests for comprehensive Dimension types in the SemanticLayer:
 * - Time dimensions with granularity (second, minute, hour, day, week, month, quarter, year)
 * - Categorical dimensions (string, enum)
 * - Derived dimensions (computed from other dimensions/columns)
 * - Geo dimensions (country, region, city, lat/lng)
 * - Boolean dimensions
 * - Dimension hierarchies (e.g., year > quarter > month > day)
 *
 * @see dotdo-bvn3l
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Time dimensions
  TimeDimension,
  TimeGranularity,
  TIME_GRANULARITIES,
  granularityToSeconds,
  compareGranularity,
  getCoarserGranularities,
  getFinerGranularities,
  // Categorical dimensions
  CategoricalDimension,
  EnumDimension,
  // Derived dimensions
  DerivedDimension,
  DerivedDimensionExpression,
  // Geo dimensions
  GeoDimension,
  GeoLevel,
  GEO_LEVELS,
  // Boolean dimensions
  BooleanDimension,
  // Dimension hierarchies
  DimensionHierarchy,
  HierarchyLevel,
  // Factory
  createDimension,
  DimensionFactory,
  // Types
  type DimensionConfig,
  type TimeDimensionConfig,
  type CategoricalDimensionConfig,
  type EnumDimensionConfig,
  type DerivedDimensionConfig,
  type GeoDimensionConfig,
  type BooleanDimensionConfig,
  type HierarchyConfig,
} from './dimensions'

// =============================================================================
// TIME DIMENSION TESTS
// =============================================================================

describe('TimeDimension', () => {
  describe('Construction', () => {
    it('should create a time dimension with default granularity', () => {
      const dim = new TimeDimension({
        name: 'createdAt',
        sql: 'created_at',
      })

      expect(dim.name).toBe('createdAt')
      expect(dim.type).toBe('time')
      expect(dim.sql).toBe('created_at')
      expect(dim.defaultGranularity).toBe('day') // default
    })

    it('should create a time dimension with specified granularity', () => {
      const dim = new TimeDimension({
        name: 'eventTime',
        sql: 'event_timestamp',
        defaultGranularity: 'minute',
      })

      expect(dim.defaultGranularity).toBe('minute')
    })

    it('should store timezone configuration', () => {
      const dim = new TimeDimension({
        name: 'createdAt',
        sql: 'created_at',
        timezone: 'America/New_York',
      })

      expect(dim.timezone).toBe('America/New_York')
    })

    it('should support fiscal year offset', () => {
      const dim = new TimeDimension({
        name: 'fiscalDate',
        sql: 'fiscal_date',
        fiscalYearStartMonth: 4, // April
      })

      expect(dim.fiscalYearStartMonth).toBe(4)
    })
  })

  describe('SQL Generation', () => {
    let dim: TimeDimension

    beforeEach(() => {
      dim = new TimeDimension({
        name: 'createdAt',
        sql: 'created_at',
      })
    })

    it('should generate SQL for second granularity', () => {
      const sql = dim.toSQL('orders', { granularity: 'second', dialect: 'postgres' })
      expect(sql).toContain('second')
    })

    it('should generate SQL for minute granularity', () => {
      const sql = dim.toSQL('orders', { granularity: 'minute', dialect: 'postgres' })
      expect(sql).toContain('minute')
    })

    it('should generate SQL for hour granularity', () => {
      const sql = dim.toSQL('orders', { granularity: 'hour', dialect: 'postgres' })
      expect(sql).toContain('hour')
    })

    it('should generate SQL for day granularity', () => {
      const sql = dim.toSQL('orders', { granularity: 'day', dialect: 'postgres' })
      expect(sql).toContain('day')
    })

    it('should generate SQL for week granularity', () => {
      const sql = dim.toSQL('orders', { granularity: 'week', dialect: 'postgres' })
      expect(sql).toContain('week')
    })

    it('should generate SQL for month granularity', () => {
      const sql = dim.toSQL('orders', { granularity: 'month', dialect: 'postgres' })
      expect(sql).toContain('month')
    })

    it('should generate SQL for quarter granularity', () => {
      const sql = dim.toSQL('orders', { granularity: 'quarter', dialect: 'postgres' })
      expect(sql).toContain('quarter')
    })

    it('should generate SQL for year granularity', () => {
      const sql = dim.toSQL('orders', { granularity: 'year', dialect: 'postgres' })
      expect(sql).toContain('year')
    })

    it('should handle timezone in SQL generation', () => {
      const tzDim = new TimeDimension({
        name: 'createdAt',
        sql: 'created_at',
        timezone: 'America/New_York',
      })

      const sql = tzDim.toSQL('orders', { granularity: 'day', dialect: 'postgres' })
      expect(sql).toContain('America/New_York')
    })
  })

  describe('Granularity Helpers', () => {
    it('should list all supported granularities', () => {
      expect(TIME_GRANULARITIES).toEqual([
        'second',
        'minute',
        'hour',
        'day',
        'week',
        'month',
        'quarter',
        'year',
      ])
    })

    it('should convert granularity to seconds', () => {
      expect(granularityToSeconds('second')).toBe(1)
      expect(granularityToSeconds('minute')).toBe(60)
      expect(granularityToSeconds('hour')).toBe(3600)
      expect(granularityToSeconds('day')).toBe(86400)
      expect(granularityToSeconds('week')).toBe(604800)
      expect(granularityToSeconds('month')).toBe(2592000) // 30 days approx
      expect(granularityToSeconds('quarter')).toBe(7776000) // 90 days approx
      expect(granularityToSeconds('year')).toBe(31536000) // 365 days
    })

    it('should compare granularities', () => {
      expect(compareGranularity('second', 'minute')).toBeLessThan(0)
      expect(compareGranularity('year', 'day')).toBeGreaterThan(0)
      expect(compareGranularity('hour', 'hour')).toBe(0)
    })

    it('should get coarser granularities', () => {
      const coarser = getCoarserGranularities('day')
      expect(coarser).toEqual(['week', 'month', 'quarter', 'year'])
    })

    it('should get finer granularities', () => {
      const finer = getFinerGranularities('day')
      expect(finer).toEqual(['hour', 'minute', 'second'])
    })
  })

  describe('Dialect-Specific SQL', () => {
    let dim: TimeDimension

    beforeEach(() => {
      dim = new TimeDimension({
        name: 'createdAt',
        sql: 'created_at',
      })
    })

    it('should generate PostgreSQL-specific SQL', () => {
      const sql = dim.toSQL('orders', { granularity: 'day', dialect: 'postgres' })
      expect(sql).toMatch(/date_trunc\s*\(\s*'day'/i)
    })

    it('should generate ClickHouse-specific SQL', () => {
      const sql = dim.toSQL('orders', { granularity: 'day', dialect: 'clickhouse' })
      expect(sql).toMatch(/toDate|toStartOfDay/i)
    })

    it('should generate SQLite-specific SQL', () => {
      const sql = dim.toSQL('orders', { granularity: 'day', dialect: 'sqlite' })
      expect(sql).toMatch(/date\s*\(|strftime/i)
    })

    it('should generate MySQL-specific SQL', () => {
      const sql = dim.toSQL('orders', { granularity: 'day', dialect: 'mysql' })
      expect(sql).toMatch(/DATE\s*\(|DATE_FORMAT/i)
    })

    it('should generate DuckDB-specific SQL', () => {
      const sql = dim.toSQL('orders', { granularity: 'day', dialect: 'duckdb' })
      expect(sql).toMatch(/date_trunc/i)
    })
  })
})

// =============================================================================
// CATEGORICAL DIMENSION TESTS
// =============================================================================

describe('CategoricalDimension', () => {
  describe('Construction', () => {
    it('should create a categorical dimension', () => {
      const dim = new CategoricalDimension({
        name: 'status',
        sql: 'status',
      })

      expect(dim.name).toBe('status')
      expect(dim.type).toBe('categorical')
      expect(dim.sql).toBe('status')
    })

    it('should support cardinality hint', () => {
      const dim = new CategoricalDimension({
        name: 'category',
        sql: 'category',
        cardinalityHint: 'low', // < 100 values
      })

      expect(dim.cardinalityHint).toBe('low')
    })

    it('should support case sensitivity option', () => {
      const dim = new CategoricalDimension({
        name: 'email',
        sql: 'email',
        caseSensitive: false,
      })

      expect(dim.caseSensitive).toBe(false)
    })
  })

  describe('SQL Generation', () => {
    it('should generate basic SQL', () => {
      const dim = new CategoricalDimension({
        name: 'status',
        sql: 'status',
      })

      const sql = dim.toSQL('orders')
      expect(sql).toContain('status')
    })

    it('should generate case-insensitive SQL when configured', () => {
      const dim = new CategoricalDimension({
        name: 'status',
        sql: 'status',
        caseSensitive: false,
      })

      const sql = dim.toSQL('orders', { dialect: 'postgres' })
      expect(sql).toMatch(/LOWER|lower|UPPER|upper/i)
    })
  })
})

describe('EnumDimension', () => {
  describe('Construction', () => {
    it('should create an enum dimension with allowed values', () => {
      const dim = new EnumDimension({
        name: 'status',
        sql: 'status',
        values: ['pending', 'processing', 'completed', 'cancelled'],
      })

      expect(dim.name).toBe('status')
      expect(dim.type).toBe('enum')
      expect(dim.values).toEqual(['pending', 'processing', 'completed', 'cancelled'])
    })

    it('should support display labels for enum values', () => {
      const dim = new EnumDimension({
        name: 'priority',
        sql: 'priority',
        values: ['P0', 'P1', 'P2', 'P3'],
        labels: {
          P0: 'Critical',
          P1: 'High',
          P2: 'Medium',
          P3: 'Low',
        },
      })

      expect(dim.labels?.P0).toBe('Critical')
    })

    it('should support default value', () => {
      const dim = new EnumDimension({
        name: 'status',
        sql: 'status',
        values: ['active', 'inactive'],
        defaultValue: 'active',
      })

      expect(dim.defaultValue).toBe('active')
    })

    it('should validate that default value is in allowed values', () => {
      expect(() => new EnumDimension({
        name: 'status',
        sql: 'status',
        values: ['active', 'inactive'],
        defaultValue: 'unknown', // Not in values
      })).toThrow()
    })
  })

  describe('Value Validation', () => {
    let dim: EnumDimension

    beforeEach(() => {
      dim = new EnumDimension({
        name: 'status',
        sql: 'status',
        values: ['pending', 'completed', 'cancelled'],
      })
    })

    it('should validate value is in allowed set', () => {
      expect(dim.isValidValue('pending')).toBe(true)
      expect(dim.isValidValue('completed')).toBe(true)
    })

    it('should reject invalid values', () => {
      expect(dim.isValidValue('unknown')).toBe(false)
    })

    it('should get display label for value', () => {
      const labeledDim = new EnumDimension({
        name: 'status',
        sql: 'status',
        values: ['pending', 'completed'],
        labels: {
          pending: 'Pending Approval',
          completed: 'Completed Successfully',
        },
      })

      expect(labeledDim.getLabel('pending')).toBe('Pending Approval')
    })

    it('should return value as label if no label configured', () => {
      expect(dim.getLabel('pending')).toBe('pending')
    })
  })
})

// =============================================================================
// DERIVED DIMENSION TESTS
// =============================================================================

describe('DerivedDimension', () => {
  describe('Construction', () => {
    it('should create a derived dimension from SQL expression', () => {
      const dim = new DerivedDimension({
        name: 'fullName',
        expression: "first_name || ' ' || last_name",
        resultType: 'string',
      })

      expect(dim.name).toBe('fullName')
      expect(dim.type).toBe('derived')
      expect(dim.resultType).toBe('string')
    })

    it('should create a derived dimension from column references', () => {
      const dim = new DerivedDimension({
        name: 'orderYear',
        expression: {
          type: 'extract',
          field: 'year',
          from: 'created_at',
        },
        resultType: 'number',
      })

      expect(dim.expression).toEqual({
        type: 'extract',
        field: 'year',
        from: 'created_at',
      })
    })

    it('should support computed expressions with other dimensions', () => {
      const dim = new DerivedDimension({
        name: 'ageGroup',
        expression: {
          type: 'case',
          cases: [
            { when: 'age < 18', then: "'Minor'" },
            { when: 'age < 65', then: "'Adult'" },
          ],
          else: "'Senior'",
        },
        resultType: 'string',
      })

      expect(dim.expression.type).toBe('case')
    })

    it('should track dependencies on other columns', () => {
      const dim = new DerivedDimension({
        name: 'fullName',
        expression: "first_name || ' ' || last_name",
        resultType: 'string',
        dependencies: ['first_name', 'last_name'],
      })

      expect(dim.dependencies).toEqual(['first_name', 'last_name'])
    })
  })

  describe('SQL Generation', () => {
    it('should generate SQL from string expression', () => {
      const dim = new DerivedDimension({
        name: 'fullName',
        expression: "first_name || ' ' || last_name",
        resultType: 'string',
      })

      const sql = dim.toSQL('users')
      expect(sql).toContain('first_name')
      expect(sql).toContain('last_name')
    })

    it('should generate SQL for CASE expression', () => {
      const dim = new DerivedDimension({
        name: 'ageGroup',
        expression: {
          type: 'case',
          cases: [
            { when: 'age < 18', then: "'Minor'" },
            { when: 'age < 65', then: "'Adult'" },
          ],
          else: "'Senior'",
        },
        resultType: 'string',
      })

      const sql = dim.toSQL('users', { dialect: 'postgres' })
      expect(sql).toContain('CASE')
      expect(sql).toContain('WHEN')
      expect(sql).toContain('THEN')
      expect(sql).toContain('ELSE')
      expect(sql).toContain('END')
    })

    it('should generate SQL for EXTRACT expression', () => {
      const dim = new DerivedDimension({
        name: 'orderYear',
        expression: {
          type: 'extract',
          field: 'year',
          from: 'created_at',
        },
        resultType: 'number',
      })

      const sql = dim.toSQL('orders', { dialect: 'postgres' })
      expect(sql).toMatch(/EXTRACT|extract/i)
      expect(sql).toMatch(/year/i)
    })

    it('should generate SQL for arithmetic expression', () => {
      const dim = new DerivedDimension({
        name: 'profitMargin',
        expression: {
          type: 'arithmetic',
          operator: '/',
          left: 'profit',
          right: 'revenue',
        },
        resultType: 'number',
      })

      const sql = dim.toSQL('sales', { dialect: 'postgres' })
      expect(sql).toContain('/')
    })

    it('should generate SQL for concatenation expression', () => {
      const dim = new DerivedDimension({
        name: 'fullAddress',
        expression: {
          type: 'concat',
          parts: ['street', "', '", 'city', "', '", 'state'],
        },
        resultType: 'string',
      })

      const sql = dim.toSQL('addresses', { dialect: 'postgres' })
      expect(sql).toMatch(/\|\||CONCAT/i)
    })
  })
})

// =============================================================================
// GEO DIMENSION TESTS
// =============================================================================

describe('GeoDimension', () => {
  describe('Construction', () => {
    it('should create a geo dimension for country', () => {
      const dim = new GeoDimension({
        name: 'country',
        sql: 'country_code',
        level: 'country',
      })

      expect(dim.name).toBe('country')
      expect(dim.type).toBe('geo')
      expect(dim.level).toBe('country')
    })

    it('should create a geo dimension for region/state', () => {
      const dim = new GeoDimension({
        name: 'state',
        sql: 'state_code',
        level: 'region',
      })

      expect(dim.level).toBe('region')
    })

    it('should create a geo dimension for city', () => {
      const dim = new GeoDimension({
        name: 'city',
        sql: 'city_name',
        level: 'city',
      })

      expect(dim.level).toBe('city')
    })

    it('should create a geo dimension for lat/lng coordinates', () => {
      const dim = new GeoDimension({
        name: 'location',
        level: 'coordinates',
        latitudeColumn: 'lat',
        longitudeColumn: 'lng',
      })

      expect(dim.level).toBe('coordinates')
      expect(dim.latitudeColumn).toBe('lat')
      expect(dim.longitudeColumn).toBe('lng')
    })

    it('should create a geo dimension for postal code', () => {
      const dim = new GeoDimension({
        name: 'postalCode',
        sql: 'postal_code',
        level: 'postalCode',
      })

      expect(dim.level).toBe('postalCode')
    })

    it('should support ISO code format configuration', () => {
      const dim = new GeoDimension({
        name: 'country',
        sql: 'country_code',
        level: 'country',
        isoFormat: 'alpha2', // ISO 3166-1 alpha-2
      })

      expect(dim.isoFormat).toBe('alpha2')
    })
  })

  describe('Geo Levels', () => {
    it('should list all supported geo levels', () => {
      expect(GEO_LEVELS).toEqual([
        'country',
        'region',
        'city',
        'postalCode',
        'coordinates',
      ])
    })
  })

  describe('SQL Generation', () => {
    it('should generate SQL for country dimension', () => {
      const dim = new GeoDimension({
        name: 'country',
        sql: 'country_code',
        level: 'country',
      })

      const sql = dim.toSQL('users')
      expect(sql).toContain('country_code')
    })

    it('should generate SQL for coordinates', () => {
      const dim = new GeoDimension({
        name: 'location',
        level: 'coordinates',
        latitudeColumn: 'lat',
        longitudeColumn: 'lng',
      })

      const sql = dim.toSQL('locations', { dialect: 'postgres' })
      expect(sql).toContain('lat')
      expect(sql).toContain('lng')
    })

    it('should generate geohash SQL when configured', () => {
      const dim = new GeoDimension({
        name: 'location',
        level: 'coordinates',
        latitudeColumn: 'lat',
        longitudeColumn: 'lng',
        geohashPrecision: 6,
      })

      const sql = dim.toSQL('locations', { dialect: 'postgres', asGeohash: true })
      expect(sql).toMatch(/geohash|ST_GeoHash/i)
    })
  })

  describe('Distance Calculations', () => {
    it('should generate distance SQL for coordinates', () => {
      const dim = new GeoDimension({
        name: 'location',
        level: 'coordinates',
        latitudeColumn: 'lat',
        longitudeColumn: 'lng',
      })

      const sql = dim.distanceSQL('locations', {
        targetLat: 37.7749,
        targetLng: -122.4194,
        dialect: 'postgres',
      })

      expect(sql).toMatch(/ST_Distance|haversine|earth_distance/i)
    })
  })
})

// =============================================================================
// BOOLEAN DIMENSION TESTS
// =============================================================================

describe('BooleanDimension', () => {
  describe('Construction', () => {
    it('should create a boolean dimension', () => {
      const dim = new BooleanDimension({
        name: 'isActive',
        sql: 'is_active',
      })

      expect(dim.name).toBe('isActive')
      expect(dim.type).toBe('boolean')
    })

    it('should support custom true/false labels', () => {
      const dim = new BooleanDimension({
        name: 'isPremium',
        sql: 'is_premium',
        trueLabel: 'Premium',
        falseLabel: 'Free',
      })

      expect(dim.trueLabel).toBe('Premium')
      expect(dim.falseLabel).toBe('Free')
    })

    it('should support null handling configuration', () => {
      const dim = new BooleanDimension({
        name: 'hasVerified',
        sql: 'has_verified',
        nullLabel: 'Unknown',
        treatNullAs: false,
      })

      expect(dim.nullLabel).toBe('Unknown')
      expect(dim.treatNullAs).toBe(false)
    })
  })

  describe('SQL Generation', () => {
    it('should generate SQL for boolean dimension', () => {
      const dim = new BooleanDimension({
        name: 'isActive',
        sql: 'is_active',
      })

      const sql = dim.toSQL('users')
      expect(sql).toContain('is_active')
    })

    it('should handle null coalescing when configured', () => {
      const dim = new BooleanDimension({
        name: 'isActive',
        sql: 'is_active',
        treatNullAs: false,
      })

      const sql = dim.toSQL('users', { dialect: 'postgres' })
      expect(sql).toMatch(/COALESCE|coalesce/i)
    })
  })

  describe('Value Mapping', () => {
    it('should get label for true value', () => {
      const dim = new BooleanDimension({
        name: 'isPremium',
        sql: 'is_premium',
        trueLabel: 'Premium',
        falseLabel: 'Free',
      })

      expect(dim.getLabel(true)).toBe('Premium')
    })

    it('should get label for false value', () => {
      const dim = new BooleanDimension({
        name: 'isPremium',
        sql: 'is_premium',
        trueLabel: 'Premium',
        falseLabel: 'Free',
      })

      expect(dim.getLabel(false)).toBe('Free')
    })

    it('should get label for null value', () => {
      const dim = new BooleanDimension({
        name: 'hasVerified',
        sql: 'has_verified',
        nullLabel: 'Unknown',
      })

      expect(dim.getLabel(null)).toBe('Unknown')
    })
  })
})

// =============================================================================
// DIMENSION HIERARCHY TESTS
// =============================================================================

describe('DimensionHierarchy', () => {
  describe('Construction', () => {
    it('should create a time hierarchy', () => {
      const hierarchy = new DimensionHierarchy({
        name: 'dateHierarchy',
        levels: [
          { name: 'year', dimension: 'createdAt', granularity: 'year' },
          { name: 'quarter', dimension: 'createdAt', granularity: 'quarter' },
          { name: 'month', dimension: 'createdAt', granularity: 'month' },
          { name: 'day', dimension: 'createdAt', granularity: 'day' },
        ],
      })

      expect(hierarchy.name).toBe('dateHierarchy')
      expect(hierarchy.levels).toHaveLength(4)
    })

    it('should create a geo hierarchy', () => {
      const hierarchy = new DimensionHierarchy({
        name: 'locationHierarchy',
        levels: [
          { name: 'country', dimension: 'country' },
          { name: 'region', dimension: 'region' },
          { name: 'city', dimension: 'city' },
        ],
      })

      expect(hierarchy.levels).toHaveLength(3)
    })

    it('should create a product hierarchy', () => {
      const hierarchy = new DimensionHierarchy({
        name: 'productHierarchy',
        levels: [
          { name: 'category', dimension: 'productCategory' },
          { name: 'subcategory', dimension: 'productSubcategory' },
          { name: 'product', dimension: 'productName' },
        ],
      })

      expect(hierarchy.levels[0].name).toBe('category')
      expect(hierarchy.levels[2].name).toBe('product')
    })
  })

  describe('Level Navigation', () => {
    let hierarchy: DimensionHierarchy

    beforeEach(() => {
      hierarchy = new DimensionHierarchy({
        name: 'dateHierarchy',
        levels: [
          { name: 'year', dimension: 'createdAt', granularity: 'year' },
          { name: 'quarter', dimension: 'createdAt', granularity: 'quarter' },
          { name: 'month', dimension: 'createdAt', granularity: 'month' },
          { name: 'day', dimension: 'createdAt', granularity: 'day' },
        ],
      })
    })

    it('should get level by name', () => {
      const level = hierarchy.getLevel('month')
      expect(level?.name).toBe('month')
      expect(level?.granularity).toBe('month')
    })

    it('should get parent level', () => {
      const parent = hierarchy.getParentLevel('month')
      expect(parent?.name).toBe('quarter')
    })

    it('should return undefined for parent of root level', () => {
      const parent = hierarchy.getParentLevel('year')
      expect(parent).toBeUndefined()
    })

    it('should get child level', () => {
      const child = hierarchy.getChildLevel('month')
      expect(child?.name).toBe('day')
    })

    it('should return undefined for child of leaf level', () => {
      const child = hierarchy.getChildLevel('day')
      expect(child).toBeUndefined()
    })

    it('should get all ancestors of a level', () => {
      const ancestors = hierarchy.getAncestors('day')
      expect(ancestors.map((l) => l.name)).toEqual(['month', 'quarter', 'year'])
    })

    it('should get all descendants of a level', () => {
      const descendants = hierarchy.getDescendants('quarter')
      expect(descendants.map((l) => l.name)).toEqual(['month', 'day'])
    })

    it('should get depth of level', () => {
      expect(hierarchy.getLevelDepth('year')).toBe(0)
      expect(hierarchy.getLevelDepth('quarter')).toBe(1)
      expect(hierarchy.getLevelDepth('month')).toBe(2)
      expect(hierarchy.getLevelDepth('day')).toBe(3)
    })
  })

  describe('Drill Operations', () => {
    let hierarchy: DimensionHierarchy

    beforeEach(() => {
      hierarchy = new DimensionHierarchy({
        name: 'dateHierarchy',
        levels: [
          { name: 'year', dimension: 'createdAt', granularity: 'year' },
          { name: 'quarter', dimension: 'createdAt', granularity: 'quarter' },
          { name: 'month', dimension: 'createdAt', granularity: 'month' },
          { name: 'day', dimension: 'createdAt', granularity: 'day' },
        ],
      })
    })

    it('should check if drill down is possible', () => {
      expect(hierarchy.canDrillDown('year')).toBe(true)
      expect(hierarchy.canDrillDown('day')).toBe(false)
    })

    it('should check if drill up is possible', () => {
      expect(hierarchy.canDrillUp('day')).toBe(true)
      expect(hierarchy.canDrillUp('year')).toBe(false)
    })

    it('should get drill down level', () => {
      const drillDown = hierarchy.drillDown('year')
      expect(drillDown?.name).toBe('quarter')
    })

    it('should get drill up level', () => {
      const drillUp = hierarchy.drillUp('month')
      expect(drillUp?.name).toBe('quarter')
    })
  })
})

// =============================================================================
// DIMENSION FACTORY TESTS
// =============================================================================

describe('DimensionFactory', () => {
  describe('createDimension', () => {
    it('should create TimeDimension from config', () => {
      const dim = createDimension({
        type: 'time',
        name: 'createdAt',
        sql: 'created_at',
      })

      expect(dim).toBeInstanceOf(TimeDimension)
    })

    it('should create CategoricalDimension from config', () => {
      const dim = createDimension({
        type: 'categorical',
        name: 'status',
        sql: 'status',
      })

      expect(dim).toBeInstanceOf(CategoricalDimension)
    })

    it('should create EnumDimension from config', () => {
      const dim = createDimension({
        type: 'enum',
        name: 'priority',
        sql: 'priority',
        values: ['low', 'medium', 'high'],
      })

      expect(dim).toBeInstanceOf(EnumDimension)
    })

    it('should create DerivedDimension from config', () => {
      const dim = createDimension({
        type: 'derived',
        name: 'fullName',
        expression: "first_name || ' ' || last_name",
        resultType: 'string',
      })

      expect(dim).toBeInstanceOf(DerivedDimension)
    })

    it('should create GeoDimension from config', () => {
      const dim = createDimension({
        type: 'geo',
        name: 'country',
        sql: 'country_code',
        level: 'country',
      })

      expect(dim).toBeInstanceOf(GeoDimension)
    })

    it('should create BooleanDimension from config', () => {
      const dim = createDimension({
        type: 'boolean',
        name: 'isActive',
        sql: 'is_active',
      })

      expect(dim).toBeInstanceOf(BooleanDimension)
    })

    it('should throw for unknown dimension type', () => {
      expect(() =>
        createDimension({
          type: 'unknown' as any,
          name: 'test',
          sql: 'test',
        })
      ).toThrow()
    })
  })

  describe('DimensionFactory class', () => {
    let factory: DimensionFactory

    beforeEach(() => {
      factory = new DimensionFactory()
    })

    it('should create dimensions with registered types', () => {
      const dim = factory.create({
        type: 'time',
        name: 'createdAt',
        sql: 'created_at',
      })

      expect(dim).toBeInstanceOf(TimeDimension)
    })

    it('should allow registering custom dimension types', () => {
      class CustomDimension extends CategoricalDimension {
        type = 'custom' as const
      }

      factory.register('custom', (config) => new CustomDimension(config as any))

      const dim = factory.create({
        type: 'custom',
        name: 'test',
        sql: 'test',
      })

      expect(dim).toBeInstanceOf(CustomDimension)
    })
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Dimension Integration', () => {
  describe('Combining Dimensions and Hierarchies', () => {
    it('should use dimension in hierarchy', () => {
      const timeDim = new TimeDimension({
        name: 'orderDate',
        sql: 'order_date',
      })

      const hierarchy = new DimensionHierarchy({
        name: 'orderDateHierarchy',
        levels: [
          { name: 'year', dimension: timeDim.name, granularity: 'year' },
          { name: 'month', dimension: timeDim.name, granularity: 'month' },
          { name: 'day', dimension: timeDim.name, granularity: 'day' },
        ],
      })

      expect(hierarchy.levels[0].dimension).toBe('orderDate')
    })

    it('should generate SQL for hierarchy level', () => {
      const hierarchy = new DimensionHierarchy({
        name: 'dateHierarchy',
        levels: [
          { name: 'year', dimension: 'createdAt', granularity: 'year' },
          { name: 'month', dimension: 'createdAt', granularity: 'month' },
        ],
      })

      const level = hierarchy.getLevel('month')
      expect(level?.granularity).toBe('month')
    })
  })

  describe('Derived Dimensions from Time', () => {
    it('should create derived dimension from time parts', () => {
      const yearDim = new DerivedDimension({
        name: 'orderYear',
        expression: {
          type: 'extract',
          field: 'year',
          from: 'order_date',
        },
        resultType: 'number',
        dependencies: ['order_date'],
      })

      const monthDim = new DerivedDimension({
        name: 'orderMonth',
        expression: {
          type: 'extract',
          field: 'month',
          from: 'order_date',
        },
        resultType: 'number',
        dependencies: ['order_date'],
      })

      expect(yearDim.dependencies).toContain('order_date')
      expect(monthDim.dependencies).toContain('order_date')
    })
  })

  describe('Geo with Derived', () => {
    it('should create derived geo dimension', () => {
      const regionDim = new DerivedDimension({
        name: 'salesRegion',
        expression: {
          type: 'case',
          cases: [
            { when: "country_code IN ('US', 'CA', 'MX')", then: "'North America'" },
            { when: "country_code IN ('GB', 'DE', 'FR')", then: "'Europe'" },
          ],
          else: "'Other'",
        },
        resultType: 'string',
        dependencies: ['country_code'],
      })

      expect(regionDim.expression.type).toBe('case')
    })
  })
})
