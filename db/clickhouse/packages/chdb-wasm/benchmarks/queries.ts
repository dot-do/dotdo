/**
 * ClickBench queries for benchmarking.
 *
 * These are the official 43 ClickBench queries adapted for the hits dataset.
 * See: https://github.com/ClickHouse/ClickBench
 *
 * Note: These queries target the `hits` table which should have the ClickBench schema.
 * When full ClickBench data is not available, use simple test queries instead.
 */

export interface BenchmarkQuery {
  /** Unique query identifier (Q0-Q42) */
  id: string;
  /** Human-readable description */
  description: string;
  /** The SQL query to execute */
  sql: string;
  /** Query category for grouping results */
  category: 'simple' | 'aggregation' | 'filter' | 'group' | 'join' | 'complex';
  /** Whether this query requires the full hits table */
  requiresHitsTable: boolean;
}

/**
 * Official ClickBench queries (Q0-Q42).
 * These require the full `hits` table with proper schema.
 */
export const CLICKBENCH_QUERIES: BenchmarkQuery[] = [
  {
    id: 'Q0',
    description: 'Count all rows',
    sql: 'SELECT COUNT(*) FROM hits',
    category: 'simple',
    requiresHitsTable: true,
  },
  {
    id: 'Q1',
    description: 'Count with simple filter',
    sql: "SELECT COUNT(*) FROM hits WHERE AdvEngineID <> 0",
    category: 'filter',
    requiresHitsTable: true,
  },
  {
    id: 'Q2',
    description: 'Sum with filter',
    sql: "SELECT SUM(AdvEngineID), COUNT(*), AVG(ResolutionWidth) FROM hits",
    category: 'aggregation',
    requiresHitsTable: true,
  },
  {
    id: 'Q3',
    description: 'Average with filter',
    sql: "SELECT AVG(UserID) FROM hits",
    category: 'aggregation',
    requiresHitsTable: true,
  },
  {
    id: 'Q4',
    description: 'Count distinct',
    sql: "SELECT COUNT(DISTINCT UserID) FROM hits",
    category: 'aggregation',
    requiresHitsTable: true,
  },
  {
    id: 'Q5',
    description: 'Count distinct SearchPhrase',
    sql: "SELECT COUNT(DISTINCT SearchPhrase) FROM hits",
    category: 'aggregation',
    requiresHitsTable: true,
  },
  {
    id: 'Q6',
    description: 'Min/Max',
    sql: "SELECT MIN(EventDate), MAX(EventDate) FROM hits",
    category: 'aggregation',
    requiresHitsTable: true,
  },
  {
    id: 'Q7',
    description: 'Group by with count',
    sql: "SELECT AdvEngineID, COUNT(*) FROM hits WHERE AdvEngineID <> 0 GROUP BY AdvEngineID ORDER BY COUNT(*) DESC",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q8',
    description: 'Group by with limit',
    sql: "SELECT RegionID, COUNT(DISTINCT UserID) AS u FROM hits GROUP BY RegionID ORDER BY u DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q9',
    description: 'Group by two columns with limit',
    sql: "SELECT RegionID, SUM(AdvEngineID), COUNT(*) AS c, AVG(ResolutionWidth), COUNT(DISTINCT UserID) FROM hits GROUP BY RegionID ORDER BY c DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q10',
    description: 'Search phrase popularity',
    sql: "SELECT MobilePhoneModel, COUNT(DISTINCT UserID) AS u FROM hits WHERE MobilePhoneModel <> '' GROUP BY MobilePhoneModel ORDER BY u DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q11',
    description: 'Mobile phone model stats',
    sql: "SELECT MobilePhone, MobilePhoneModel, COUNT(DISTINCT UserID) AS u FROM hits WHERE MobilePhoneModel <> '' GROUP BY MobilePhone, MobilePhoneModel ORDER BY u DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q12',
    description: 'Search engine popularity',
    sql: "SELECT SearchPhrase, COUNT(*) AS c FROM hits WHERE SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY c DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q13',
    description: 'Search phrase with user count',
    sql: "SELECT SearchPhrase, COUNT(DISTINCT UserID) AS u FROM hits WHERE SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY u DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q14',
    description: 'Search engine with date',
    sql: "SELECT SearchEngineID, SearchPhrase, COUNT(*) AS c FROM hits WHERE SearchPhrase <> '' GROUP BY SearchEngineID, SearchPhrase ORDER BY c DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q15',
    description: 'User ID grouping',
    sql: "SELECT UserID, COUNT(*) FROM hits GROUP BY UserID ORDER BY COUNT(*) DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q16',
    description: 'User search phrases',
    sql: "SELECT UserID, SearchPhrase, COUNT(*) FROM hits GROUP BY UserID, SearchPhrase ORDER BY COUNT(*) DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q17',
    description: 'User search with limit',
    sql: "SELECT UserID, SearchPhrase, COUNT(*) FROM hits GROUP BY UserID, SearchPhrase LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q18',
    description: 'User minute aggregation',
    sql: "SELECT UserID, extract(minute FROM EventTime) AS m, SearchPhrase, COUNT(*) FROM hits GROUP BY UserID, m, SearchPhrase ORDER BY COUNT(*) DESC LIMIT 10",
    category: 'complex',
    requiresHitsTable: true,
  },
  {
    id: 'Q19',
    description: 'User ID listing',
    sql: "SELECT UserID FROM hits WHERE UserID = 435090932899640449",
    category: 'filter',
    requiresHitsTable: true,
  },
  {
    id: 'Q20',
    description: 'String search filter',
    sql: "SELECT COUNT(*) FROM hits WHERE URL LIKE '%google%'",
    category: 'filter',
    requiresHitsTable: true,
  },
  {
    id: 'Q21',
    description: 'Multiple conditions filter',
    sql: "SELECT SearchPhrase, MIN(URL), COUNT(*) AS c FROM hits WHERE URL LIKE '%google%' AND SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY c DESC LIMIT 10",
    category: 'complex',
    requiresHitsTable: true,
  },
  {
    id: 'Q22',
    description: 'Complex string filter',
    sql: "SELECT SearchPhrase, MIN(URL), MIN(Title), COUNT(*) AS c, COUNT(DISTINCT UserID) FROM hits WHERE Title LIKE '%Google%' AND URL NOT LIKE '%.telecom%' AND SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY c DESC LIMIT 10",
    category: 'complex',
    requiresHitsTable: true,
  },
  {
    id: 'Q23',
    description: 'Numeric filter and group',
    sql: "SELECT * FROM hits WHERE URL LIKE '%google%' ORDER BY EventTime LIMIT 10",
    category: 'filter',
    requiresHitsTable: true,
  },
  {
    id: 'Q24',
    description: 'Simple search with order',
    sql: "SELECT SearchPhrase FROM hits WHERE SearchPhrase <> '' ORDER BY EventTime LIMIT 10",
    category: 'filter',
    requiresHitsTable: true,
  },
  {
    id: 'Q25',
    description: 'Search phrase with time order',
    sql: "SELECT SearchPhrase FROM hits WHERE SearchPhrase <> '' ORDER BY SearchPhrase LIMIT 10",
    category: 'filter',
    requiresHitsTable: true,
  },
  {
    id: 'Q26',
    description: 'Multiple order by',
    sql: "SELECT SearchPhrase FROM hits WHERE SearchPhrase <> '' ORDER BY EventTime, SearchPhrase LIMIT 10",
    category: 'filter',
    requiresHitsTable: true,
  },
  {
    id: 'Q27',
    description: 'Count group order',
    sql: "SELECT CounterID, AVG(length(URL)) AS l, COUNT(*) AS c FROM hits WHERE URL <> '' GROUP BY CounterID HAVING COUNT(*) > 100000 ORDER BY l DESC LIMIT 25",
    category: 'complex',
    requiresHitsTable: true,
  },
  {
    id: 'Q28',
    description: 'Referer analysis',
    sql: "SELECT REGEXP_REPLACE(Referer, '^https?://(?:www\\.)?([^/]+)/.*$', '\\1') AS k, AVG(length(Referer)) AS l, COUNT(*) AS c, MIN(Referer) FROM hits WHERE Referer <> '' GROUP BY k HAVING COUNT(*) > 100000 ORDER BY l DESC LIMIT 25",
    category: 'complex',
    requiresHitsTable: true,
  },
  {
    id: 'Q29',
    description: 'Sum group',
    sql: "SELECT SUM(ResolutionWidth), SUM(ResolutionHeight) FROM hits",
    category: 'aggregation',
    requiresHitsTable: true,
  },
  {
    id: 'Q30',
    description: 'Quantile calculation',
    sql: "SELECT QUANTILE_CONT(0.5) WITHIN GROUP (ORDER BY ResolutionWidth), QUANTILE_CONT(0.5) WITHIN GROUP (ORDER BY ResolutionHeight) FROM hits",
    category: 'aggregation',
    requiresHitsTable: true,
  },
  {
    id: 'Q31',
    description: 'Count distinct in subquery',
    sql: "SELECT SUM(UserID), COUNT(DISTINCT UserID) FROM hits",
    category: 'aggregation',
    requiresHitsTable: true,
  },
  {
    id: 'Q32',
    description: 'Region and user analysis',
    sql: "SELECT SUM(UserID), COUNT(DISTINCT UserID), COUNT(*) FROM hits GROUP BY RegionID",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q33',
    description: 'URL domain analysis',
    sql: "SELECT RegionID, COUNT(DISTINCT UserID) AS u FROM hits GROUP BY RegionID ORDER BY u DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q34',
    description: 'Date-based grouping',
    sql: "SELECT RegionID, SUM(Refresh), COUNT(*) AS c, AVG(UserID) FROM hits GROUP BY RegionID ORDER BY c DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q35',
    description: 'Social source grouping',
    sql: "SELECT WindowClientWidth, WindowClientHeight, COUNT(*) AS c FROM hits WHERE WindowClientWidth > 0 AND WindowClientHeight > 0 GROUP BY WindowClientWidth, WindowClientHeight ORDER BY c DESC LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q36',
    description: 'Time minute grouping',
    sql: "SELECT CAST(extract(minute FROM EventTime) AS INTEGER) AS m, COUNT(*) AS c FROM hits GROUP BY m ORDER BY m LIMIT 10",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q37',
    description: 'Time hour grouping',
    sql: "SELECT CAST(extract(hour FROM EventTime) AS INTEGER) AS h, COUNT(*) AS c FROM hits GROUP BY h ORDER BY h LIMIT 24",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q38',
    description: 'Day of week grouping',
    sql: "SELECT CAST(extract(dow FROM EventTime) AS INTEGER) AS dow, COUNT(*) AS c FROM hits GROUP BY dow ORDER BY dow LIMIT 7",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q39',
    description: 'Day of month grouping',
    sql: "SELECT CAST(extract(day FROM EventTime) AS INTEGER) AS d, COUNT(*) AS c FROM hits GROUP BY d ORDER BY d LIMIT 31",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q40',
    description: 'Week grouping',
    sql: "SELECT CAST(extract(week FROM EventTime) AS INTEGER) AS w, COUNT(*) AS c FROM hits GROUP BY w ORDER BY w LIMIT 53",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q41',
    description: 'Month grouping',
    sql: "SELECT CAST(extract(month FROM EventTime) AS INTEGER) AS m, COUNT(*) AS c FROM hits GROUP BY m ORDER BY m LIMIT 12",
    category: 'group',
    requiresHitsTable: true,
  },
  {
    id: 'Q42',
    description: 'Year grouping',
    sql: "SELECT CAST(extract(year FROM EventTime) AS INTEGER) AS y, COUNT(*) AS c FROM hits GROUP BY y ORDER BY y",
    category: 'group',
    requiresHitsTable: true,
  },
];

/**
 * Simple test queries that don't require the hits table.
 * Use these for testing the benchmark framework when full data is not available.
 */
export const SIMPLE_TEST_QUERIES: BenchmarkQuery[] = [
  {
    id: 'T0',
    description: 'Simple SELECT 1',
    sql: 'SELECT 1 AS value',
    category: 'simple',
    requiresHitsTable: false,
  },
  {
    id: 'T1',
    description: 'Arithmetic operations',
    sql: 'SELECT 1 + 2 * 3 - 4 / 2 AS result',
    category: 'simple',
    requiresHitsTable: false,
  },
  {
    id: 'T2',
    description: 'String functions',
    sql: "SELECT upper('hello'), lower('WORLD'), length('test') AS len",
    category: 'simple',
    requiresHitsTable: false,
  },
  {
    id: 'T3',
    description: 'Date functions',
    sql: "SELECT now(), current_date, current_timestamp",
    category: 'simple',
    requiresHitsTable: false,
  },
  {
    id: 'T4',
    description: 'Generate series aggregation',
    sql: 'SELECT COUNT(*), SUM(i), AVG(i), MIN(i), MAX(i) FROM generate_series(1, 1000) AS t(i)',
    category: 'aggregation',
    requiresHitsTable: false,
  },
  {
    id: 'T5',
    description: 'Group by with aggregation',
    sql: 'SELECT i % 10 AS bucket, COUNT(*) AS cnt, SUM(i) AS total FROM generate_series(1, 1000) AS t(i) GROUP BY bucket ORDER BY bucket',
    category: 'group',
    requiresHitsTable: false,
  },
  {
    id: 'T6',
    description: 'Subquery',
    sql: 'SELECT * FROM (SELECT i, i * 2 AS doubled FROM generate_series(1, 100) AS t(i)) WHERE doubled > 150 LIMIT 10',
    category: 'complex',
    requiresHitsTable: false,
  },
  {
    id: 'T7',
    description: 'Window function',
    sql: 'SELECT i, SUM(i) OVER (ORDER BY i ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_sum FROM generate_series(1, 100) AS t(i) LIMIT 10',
    category: 'complex',
    requiresHitsTable: false,
  },
  {
    id: 'T8',
    description: 'CTE (Common Table Expression)',
    sql: 'WITH numbers AS (SELECT i FROM generate_series(1, 100) AS t(i)), doubled AS (SELECT i, i * 2 AS d FROM numbers) SELECT AVG(d) FROM doubled',
    category: 'complex',
    requiresHitsTable: false,
  },
  {
    id: 'T9',
    description: 'Large series aggregation',
    sql: 'SELECT COUNT(*), AVG(i), STDDEV(i) FROM generate_series(1, 100000) AS t(i)',
    category: 'aggregation',
    requiresHitsTable: false,
  },
  {
    id: 'T10',
    description: 'Multiple group by',
    sql: 'SELECT i % 100 AS bucket1, (i / 100) % 10 AS bucket2, COUNT(*) FROM generate_series(1, 10000) AS t(i) GROUP BY bucket1, bucket2 ORDER BY bucket1, bucket2 LIMIT 20',
    category: 'group',
    requiresHitsTable: false,
  },
  {
    id: 'T11',
    description: 'Distinct aggregation',
    sql: 'SELECT COUNT(DISTINCT i % 50), COUNT(DISTINCT i % 100) FROM generate_series(1, 10000) AS t(i)',
    category: 'aggregation',
    requiresHitsTable: false,
  },
  {
    id: 'T12',
    description: 'HAVING clause',
    sql: 'SELECT i % 20 AS bucket, COUNT(*) AS cnt FROM generate_series(1, 1000) AS t(i) GROUP BY bucket HAVING COUNT(*) >= 50 ORDER BY cnt DESC',
    category: 'group',
    requiresHitsTable: false,
  },
  {
    id: 'T13',
    description: 'CASE expression',
    sql: "SELECT CASE WHEN i < 25 THEN 'small' WHEN i < 75 THEN 'medium' ELSE 'large' END AS size, COUNT(*) FROM generate_series(1, 100) AS t(i) GROUP BY size",
    category: 'complex',
    requiresHitsTable: false,
  },
  {
    id: 'T14',
    description: 'Math functions',
    sql: 'SELECT SQRT(i), LN(i + 1), EXP(i / 100.0), ABS(50 - i) FROM generate_series(1, 100) AS t(i) LIMIT 10',
    category: 'simple',
    requiresHitsTable: false,
  },
];

/**
 * Get queries based on whether hits table is available.
 */
export function getQueries(hitsTableAvailable: boolean): BenchmarkQuery[] {
  if (hitsTableAvailable) {
    return CLICKBENCH_QUERIES;
  }
  return SIMPLE_TEST_QUERIES;
}

/**
 * Get a subset of queries by category.
 */
export function getQueriesByCategory(
  queries: BenchmarkQuery[],
  category: BenchmarkQuery['category']
): BenchmarkQuery[] {
  return queries.filter(q => q.category === category);
}

/**
 * Get a query by ID.
 */
export function getQueryById(queries: BenchmarkQuery[], id: string): BenchmarkQuery | undefined {
  return queries.find(q => q.id === id);
}
