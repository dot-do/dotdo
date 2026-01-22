/**
 * ClickBench Module Tests
 *
 * Tests for the ClickBench schema, queries, and executor:
 * - Schema validation
 * - Query parsing
 * - Query execution
 * - Aggregation functions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Schema exports
  HITS_COLUMNS,
  HITS_COLUMNS_BY_NAME,
  HITS_TABLE_METADATA,
  getColumn,
  hasColumn,
  getColumnNames,
  generateCreateTableStatement,
  getJSType,
  isNumericType,
  isStringType,
  isDateTimeType,
} from '../../src/clickbench/schema';

import {
  // Query exports
  CLICKBENCH_QUERIES,
  QUERY_COUNT,
  getQueryById,
  getQueriesByCategory,
  getQueriesByComplexity,
  getQueriesUsingColumn,
  getSimpleQueries,
  getNonAggregateQueries,
  getQueryStatistics,
} from '../../src/clickbench/queries';

import {
  // Executor exports
  parseQuery,
  type ParsedQuery,
} from '../../src/clickbench/executor';

// ============================================================================
// Schema Tests
// ============================================================================

describe('ClickBench Schema', () => {
  describe('HITS_COLUMNS', () => {
    it('should have 105 columns', () => {
      expect(HITS_COLUMNS).toHaveLength(105);
    });

    it('should have unique column names', () => {
      const names = HITS_COLUMNS.map(c => c.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should have sequential indices', () => {
      HITS_COLUMNS.forEach((col, idx) => {
        expect(col.index).toBe(idx);
      });
    });

    it('should have WatchID as first column', () => {
      expect(HITS_COLUMNS[0].name).toBe('WatchID');
      expect(HITS_COLUMNS[0].type).toBe('UInt64');
    });

    it('should have CLID as last column', () => {
      expect(HITS_COLUMNS[104].name).toBe('CLID');
      expect(HITS_COLUMNS[104].type).toBe('UInt32');
    });
  });

  describe('HITS_COLUMNS_BY_NAME', () => {
    it('should be a Map', () => {
      expect(HITS_COLUMNS_BY_NAME).toBeInstanceOf(Map);
    });

    it('should have all columns by name', () => {
      expect(HITS_COLUMNS_BY_NAME.size).toBe(105);
      expect(HITS_COLUMNS_BY_NAME.get('WatchID')).toBeDefined();
      expect(HITS_COLUMNS_BY_NAME.get('UserID')).toBeDefined();
      expect(HITS_COLUMNS_BY_NAME.get('URL')).toBeDefined();
    });
  });

  describe('getColumn', () => {
    it('should find column by exact name', () => {
      const col = getColumn('WatchID');
      expect(col).toBeDefined();
      expect(col!.name).toBe('WatchID');
      expect(col!.type).toBe('UInt64');
    });

    it('should find column case-insensitively', () => {
      const col = getColumn('watchid');
      expect(col).toBeDefined();
      expect(col!.name).toBe('WatchID');
    });

    it('should return undefined for unknown columns', () => {
      const col = getColumn('NonexistentColumn');
      expect(col).toBeUndefined();
    });
  });

  describe('hasColumn', () => {
    it('should return true for existing columns', () => {
      expect(hasColumn('WatchID')).toBe(true);
      expect(hasColumn('UserID')).toBe(true);
      expect(hasColumn('URL')).toBe(true);
    });

    it('should return false for non-existing columns', () => {
      expect(hasColumn('NonexistentColumn')).toBe(false);
    });
  });

  describe('getColumnNames', () => {
    it('should return all column names', () => {
      const names = getColumnNames();
      expect(names).toHaveLength(105);
      expect(names[0]).toBe('WatchID');
    });
  });

  describe('HITS_TABLE_METADATA', () => {
    it('should have correct table info', () => {
      expect(HITS_TABLE_METADATA.name).toBe('hits');
      expect(HITS_TABLE_METADATA.database).toBe('default');
      expect(HITS_TABLE_METADATA.engine).toBe('MergeTree');
    });

    it('should have correct column count', () => {
      expect(HITS_TABLE_METADATA.columnCount).toBe(105);
    });

    it('should have order by columns', () => {
      expect(HITS_TABLE_METADATA.orderBy).toContain('CounterID');
      expect(HITS_TABLE_METADATA.orderBy).toContain('EventDate');
      expect(HITS_TABLE_METADATA.orderBy).toContain('UserID');
    });
  });

  describe('generateCreateTableStatement', () => {
    it('should generate valid CREATE TABLE statement', () => {
      const stmt = generateCreateTableStatement();
      expect(stmt).toContain('CREATE TABLE');
      expect(stmt).toContain('hits');
      expect(stmt).toContain('WatchID UInt64');
      expect(stmt).toContain('ENGINE = MergeTree()');
      expect(stmt).toContain('ORDER BY');
    });
  });

  describe('Type Helpers', () => {
    describe('getJSType', () => {
      it('should return correct JS types', () => {
        expect(getJSType('UInt8')).toBe('number');
        expect(getJSType('UInt64')).toBe('bigint');
        expect(getJSType('String')).toBe('string');
        expect(getJSType('Date')).toBe('Date');
        expect(getJSType('DateTime')).toBe('Date');
        expect(getJSType('Array')).toBe('array');
      });
    });

    describe('isNumericType', () => {
      it('should identify numeric types', () => {
        expect(isNumericType('UInt8')).toBe(true);
        expect(isNumericType('Int64')).toBe(true);
        expect(isNumericType('Float64')).toBe(true);
        expect(isNumericType('String')).toBe(false);
      });
    });

    describe('isStringType', () => {
      it('should identify string types', () => {
        expect(isStringType('String')).toBe(true);
        expect(isStringType('FixedString')).toBe(true);
        expect(isStringType('UInt64')).toBe(false);
      });
    });

    describe('isDateTimeType', () => {
      it('should identify date/time types', () => {
        expect(isDateTimeType('Date')).toBe(true);
        expect(isDateTimeType('DateTime')).toBe(true);
        expect(isDateTimeType('String')).toBe(false);
      });
    });
  });
});

// ============================================================================
// Query Tests
// ============================================================================

describe('ClickBench Queries', () => {
  describe('CLICKBENCH_QUERIES', () => {
    it('should have 43 queries', () => {
      expect(CLICKBENCH_QUERIES).toHaveLength(43);
    });

    it('should have sequential IDs from 0 to 42', () => {
      CLICKBENCH_QUERIES.forEach((query, idx) => {
        expect(query.id).toBe(idx);
      });
    });

    it('should have non-empty SQL for all queries', () => {
      CLICKBENCH_QUERIES.forEach(query => {
        expect(query.sql).toBeTruthy();
        expect(query.sql.trim()).not.toBe('');
      });
    });

    it('should have all queries reference the hits table', () => {
      CLICKBENCH_QUERIES.forEach(query => {
        expect(query.sql.toLowerCase()).toContain('hits');
      });
    });
  });

  describe('QUERY_COUNT', () => {
    it('should be 43', () => {
      expect(QUERY_COUNT).toBe(43);
    });
  });

  describe('getQueryById', () => {
    it('should return query by ID', () => {
      const query = getQueryById(0);
      expect(query).toBeDefined();
      expect(query!.id).toBe(0);
      expect(query!.sql).toContain('COUNT(*)');
    });

    it('should return undefined for invalid ID', () => {
      expect(getQueryById(-1)).toBeUndefined();
      expect(getQueryById(43)).toBeUndefined();
      expect(getQueryById(100)).toBeUndefined();
    });
  });

  describe('getQueriesByCategory', () => {
    it('should filter by simple_aggregate category', () => {
      const queries = getQueriesByCategory('simple_aggregate');
      expect(queries.length).toBeGreaterThan(0);
      queries.forEach(q => {
        expect(q.category).toBe('simple_aggregate');
      });
    });

    it('should filter by group_by category', () => {
      const queries = getQueriesByCategory('group_by');
      expect(queries.length).toBeGreaterThan(0);
      queries.forEach(q => {
        expect(q.category).toBe('group_by');
      });
    });
  });

  describe('getQueriesByComplexity', () => {
    it('should filter by simple complexity', () => {
      const queries = getQueriesByComplexity('simple');
      expect(queries.length).toBeGreaterThan(0);
      queries.forEach(q => {
        expect(q.complexity).toBe('simple');
      });
    });

    it('should filter by complex complexity', () => {
      const queries = getQueriesByComplexity('complex');
      expect(queries.length).toBeGreaterThan(0);
      queries.forEach(q => {
        expect(q.complexity).toBe('complex');
      });
    });
  });

  describe('getQueriesUsingColumn', () => {
    it('should find queries using UserID', () => {
      const queries = getQueriesUsingColumn('UserID');
      expect(queries.length).toBeGreaterThan(0);
      queries.forEach(q => {
        expect(q.columns).toContain('UserID');
      });
    });

    it('should return empty for unused column', () => {
      const queries = getQueriesUsingColumn('NonexistentColumn');
      expect(queries).toHaveLength(0);
    });
  });

  describe('getSimpleQueries', () => {
    it('should return only simple queries', () => {
      const queries = getSimpleQueries();
      expect(queries.length).toBeGreaterThan(0);
      queries.forEach(q => {
        expect(q.complexity).toBe('simple');
      });
    });
  });

  describe('getNonAggregateQueries', () => {
    it('should return queries without aggregation', () => {
      const queries = getNonAggregateQueries();
      queries.forEach(q => {
        expect(q.hasAggregation).toBe(false);
      });
    });
  });

  describe('getQueryStatistics', () => {
    it('should return correct statistics', () => {
      const stats = getQueryStatistics();

      expect(stats.total).toBe(43);
      expect(stats.withAggregation).toBeGreaterThan(30);
      expect(stats.withGroupBy).toBeGreaterThan(20);

      // Sum of category counts should equal total
      const categorySum = Object.values(stats.byCategory).reduce((a, b) => a + b, 0);
      expect(categorySum).toBe(43);

      // Sum of complexity counts should equal total
      const complexitySum = Object.values(stats.byComplexity).reduce((a, b) => a + b, 0);
      expect(complexitySum).toBe(43);
    });
  });

  describe('Specific Query Validation', () => {
    it('Query 0: COUNT(*) should be simple aggregate', () => {
      const q = getQueryById(0);
      expect(q!.category).toBe('simple_aggregate');
      expect(q!.hasAggregation).toBe(true);
      expect(q!.hasGroupBy).toBe(false);
      expect(q!.hasWhere).toBe(false);
    });

    it('Query 4: COUNT(DISTINCT) should be count_distinct', () => {
      const q = getQueryById(4);
      expect(q!.category).toBe('count_distinct');
      expect(q!.hasAggregation).toBe(true);
      expect(q!.sql).toContain('COUNT(DISTINCT');
    });

    it('Query 20: LIKE should be string_filter', () => {
      const q = getQueryById(20);
      expect(q!.category).toBe('string_filter');
      expect(q!.hasWhere).toBe(true);
      expect(q!.sql).toContain('LIKE');
    });

    it('Query 42: DATE_TRUNC should be date_function', () => {
      const q = getQueryById(42);
      expect(q!.category).toBe('date_function');
      expect(q!.sql).toContain('DATE_TRUNC');
    });
  });
});

// ============================================================================
// Query Parser Tests
// ============================================================================

describe('Query Parser', () => {
  describe('parseQuery', () => {
    it('should parse simple COUNT(*) query', () => {
      const parsed = parseQuery('SELECT COUNT(*) FROM hits;');

      expect(parsed.table).toBe('hits');
      expect(parsed.aggregates).toHaveLength(1);
      expect(parsed.aggregates[0].function).toBe('COUNT');
      expect(parsed.aggregates[0].column).toBe('*');
      expect(parsed.where).toHaveLength(0);
      expect(parsed.groupBy).toHaveLength(0);
    });

    it('should parse query with WHERE clause', () => {
      const parsed = parseQuery('SELECT COUNT(*) FROM hits WHERE AdvEngineID <> 0;');

      expect(parsed.where).toHaveLength(1);
      expect(parsed.where[0].column).toBe('AdvEngineID');
      expect(parsed.where[0].operator).toBe('<>');
      expect(parsed.where[0].value).toBe(0);
    });

    it('should parse multiple aggregates', () => {
      const parsed = parseQuery('SELECT SUM(AdvEngineID), COUNT(*), AVG(ResolutionWidth) FROM hits;');

      expect(parsed.aggregates).toHaveLength(3);
      expect(parsed.aggregates[0].function).toBe('SUM');
      expect(parsed.aggregates[1].function).toBe('COUNT');
      expect(parsed.aggregates[2].function).toBe('AVG');
    });

    it('should parse GROUP BY clause', () => {
      const parsed = parseQuery('SELECT RegionID, COUNT(*) FROM hits GROUP BY RegionID;');

      expect(parsed.groupBy).toHaveLength(1);
      expect(parsed.groupBy[0]).toBe('RegionID');
    });

    it('should parse ORDER BY clause', () => {
      const parsed = parseQuery('SELECT RegionID, COUNT(*) AS c FROM hits GROUP BY RegionID ORDER BY c DESC;');

      expect(parsed.orderBy).toHaveLength(1);
      expect(parsed.orderBy[0].column).toBe('c');
      expect(parsed.orderBy[0].direction).toBe('DESC');
    });

    it('should parse LIMIT clause', () => {
      const parsed = parseQuery('SELECT * FROM hits LIMIT 10;');

      expect(parsed.limit).toBe(10);
      expect(parsed.offset).toBeNull();
    });

    it('should parse LIMIT with OFFSET', () => {
      const parsed = parseQuery('SELECT * FROM hits LIMIT 10 OFFSET 100;');

      expect(parsed.limit).toBe(10);
      expect(parsed.offset).toBe(100);
    });

    it('should parse COUNT(DISTINCT)', () => {
      const parsed = parseQuery('SELECT COUNT(DISTINCT UserID) FROM hits;');

      expect(parsed.aggregates).toHaveLength(1);
      expect(parsed.aggregates[0].function).toBe('COUNT_DISTINCT');
      expect(parsed.aggregates[0].column).toBe('UserID');
    });

    it('should parse LIKE condition', () => {
      const parsed = parseQuery("SELECT COUNT(*) FROM hits WHERE URL LIKE '%google%';");

      expect(parsed.where).toHaveLength(1);
      expect(parsed.where[0].column).toBe('URL');
      expect(parsed.where[0].operator).toBe('LIKE');
      expect(parsed.where[0].value).toBe('%google%');
    });

    it('should parse date comparison', () => {
      const parsed = parseQuery("SELECT * FROM hits WHERE EventDate >= '2013-07-01';");

      expect(parsed.where).toHaveLength(1);
      expect(parsed.where[0].column).toBe('EventDate');
      expect(parsed.where[0].operator).toBe('>=');
      expect(parsed.where[0].value).toBe('2013-07-01');
    });

    it('should parse multiple WHERE conditions', () => {
      const parsed = parseQuery(
        "SELECT * FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND IsRefresh = 0;"
      );

      expect(parsed.where).toHaveLength(3);
      expect(parsed.where[0].column).toBe('CounterID');
      expect(parsed.where[1].column).toBe('EventDate');
      expect(parsed.where[2].column).toBe('IsRefresh');
    });

    it('should parse SELECT *', () => {
      const parsed = parseQuery('SELECT * FROM hits;');

      expect(parsed.isSelectAll).toBe(true);
    });

    it('should parse aggregate with alias', () => {
      const parsed = parseQuery('SELECT COUNT(*) AS total FROM hits;');

      expect(parsed.aggregates).toHaveLength(1);
      expect(parsed.aggregates[0].alias).toBe('total');
    });

    it('should throw error for missing FROM', () => {
      expect(() => parseQuery('SELECT COUNT(*)')).toThrow();
    });

    it('should parse IN operator', () => {
      const parsed = parseQuery('SELECT * FROM hits WHERE TraficSourceID IN (-1, 6);');

      expect(parsed.where).toHaveLength(1);
      expect(parsed.where[0].column).toBe('TraficSourceID');
      expect(parsed.where[0].operator).toBe('IN');
      expect(parsed.where[0].value).toEqual([-1, 6]);
    });
  });

  describe('parseQuery with ClickBench queries', () => {
    it('should parse all 43 ClickBench queries without error', () => {
      CLICKBENCH_QUERIES.forEach(query => {
        expect(() => parseQuery(query.sql)).not.toThrow();
      });
    });

    it('should correctly identify tables for all queries', () => {
      CLICKBENCH_QUERIES.forEach(query => {
        const parsed = parseQuery(query.sql);
        expect(parsed.table.toLowerCase()).toBe('hits');
      });
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('ClickBench Integration', () => {
  it('should have consistent column references in queries', () => {
    CLICKBENCH_QUERIES.forEach(query => {
      // All columns referenced in queries should exist in schema
      query.columns.forEach(colName => {
        const col = getColumn(colName);
        expect(col).toBeDefined();
      });
    });
  });

  it('query categories should match query characteristics', () => {
    CLICKBENCH_QUERIES.forEach(query => {
      if (query.category === 'simple_aggregate') {
        expect(query.hasAggregation).toBe(true);
        expect(query.hasGroupBy).toBe(false);
      }

      if (query.category === 'group_by') {
        expect(query.hasGroupBy).toBe(true);
      }

      if (query.category === 'count_distinct') {
        expect(query.hasAggregation).toBe(true);
        expect(query.sql.toLowerCase()).toContain('count(distinct');
      }

      if (query.category === 'string_filter') {
        expect(query.hasWhere).toBe(true);
        expect(query.sql.toLowerCase()).toContain('like');
      }
    });
  });
});
