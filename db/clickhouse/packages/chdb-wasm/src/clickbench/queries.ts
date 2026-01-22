/**
 * ClickBench Query Definitions
 *
 * This module contains all 43 official ClickBench benchmark queries.
 * These queries test various aspects of analytical database performance:
 * - Full table scans
 * - Filtered scans
 * - Aggregations (COUNT, SUM, AVG, MIN, MAX)
 * - GROUP BY operations
 * - ORDER BY and LIMIT
 * - COUNT DISTINCT
 * - String operations (LIKE)
 * - Date functions
 *
 * @see https://github.com/ClickHouse/ClickBench
 */

// ============================================================================
// Query Types
// ============================================================================

/**
 * Query category for classification
 */
export type QueryCategory =
  | 'simple_aggregate' // Basic COUNT/SUM/AVG
  | 'filtered_scan' // WHERE clause filtering
  | 'group_by' // GROUP BY operations
  | 'count_distinct' // COUNT(DISTINCT)
  | 'string_filter' // LIKE pattern matching
  | 'point_lookup' // Single value lookup
  | 'order_by' // Sorting operations
  | 'complex' // Multiple operations combined
  | 'date_function'; // Date/time functions

/**
 * Query complexity level
 */
export type QueryComplexity = 'simple' | 'medium' | 'complex';

/**
 * ClickBench query definition
 */
export interface ClickBenchQuery {
  /** Query ID (0-42) */
  id: number;
  /** Human-readable name */
  name: string;
  /** The SQL query */
  sql: string;
  /** Query category */
  category: QueryCategory;
  /** Complexity level */
  complexity: QueryComplexity;
  /** Description of what the query tests */
  description: string;
  /** Columns accessed by the query */
  columns: string[];
  /** Whether query uses aggregation */
  hasAggregation: boolean;
  /** Whether query uses GROUP BY */
  hasGroupBy: boolean;
  /** Whether query uses ORDER BY */
  hasOrderBy: boolean;
  /** Whether query has WHERE clause */
  hasWhere: boolean;
  /** Whether query has LIMIT */
  hasLimit: boolean;
}

// ============================================================================
// Query Definitions
// ============================================================================

/**
 * All 43 official ClickBench queries
 */
export const CLICKBENCH_QUERIES: ClickBenchQuery[] = [
  {
    id: 0,
    name: 'Count All Rows',
    sql: 'SELECT COUNT(*) FROM hits;',
    category: 'simple_aggregate',
    complexity: 'simple',
    description: 'Full table row count - tests scan performance',
    columns: [],
    hasAggregation: true,
    hasGroupBy: false,
    hasOrderBy: false,
    hasWhere: false,
    hasLimit: false,
  },
  {
    id: 1,
    name: 'Filtered Count',
    sql: 'SELECT COUNT(*) FROM hits WHERE AdvEngineID <> 0;',
    category: 'filtered_scan',
    complexity: 'simple',
    description: 'Filtered row count - tests filter performance',
    columns: ['AdvEngineID'],
    hasAggregation: true,
    hasGroupBy: false,
    hasOrderBy: false,
    hasWhere: true,
    hasLimit: false,
  },
  {
    id: 2,
    name: 'Multiple Aggregates',
    sql: 'SELECT SUM(AdvEngineID), COUNT(*), AVG(ResolutionWidth) FROM hits;',
    category: 'simple_aggregate',
    complexity: 'simple',
    description: 'Multiple aggregates in single query',
    columns: ['AdvEngineID', 'ResolutionWidth'],
    hasAggregation: true,
    hasGroupBy: false,
    hasOrderBy: false,
    hasWhere: false,
    hasLimit: false,
  },
  {
    id: 3,
    name: 'Average UserID',
    sql: 'SELECT AVG(UserID) FROM hits;',
    category: 'simple_aggregate',
    complexity: 'simple',
    description: 'Average of large integer column',
    columns: ['UserID'],
    hasAggregation: true,
    hasGroupBy: false,
    hasOrderBy: false,
    hasWhere: false,
    hasLimit: false,
  },
  {
    id: 4,
    name: 'Count Distinct UserID',
    sql: 'SELECT COUNT(DISTINCT UserID) FROM hits;',
    category: 'count_distinct',
    complexity: 'medium',
    description: 'Count distinct users - tests hash table performance',
    columns: ['UserID'],
    hasAggregation: true,
    hasGroupBy: false,
    hasOrderBy: false,
    hasWhere: false,
    hasLimit: false,
  },
  {
    id: 5,
    name: 'Count Distinct SearchPhrase',
    sql: 'SELECT COUNT(DISTINCT SearchPhrase) FROM hits;',
    category: 'count_distinct',
    complexity: 'medium',
    description: 'Count distinct strings - tests string hashing',
    columns: ['SearchPhrase'],
    hasAggregation: true,
    hasGroupBy: false,
    hasOrderBy: false,
    hasWhere: false,
    hasLimit: false,
  },
  {
    id: 6,
    name: 'Min/Max Date',
    sql: 'SELECT MIN(EventDate), MAX(EventDate) FROM hits;',
    category: 'simple_aggregate',
    complexity: 'simple',
    description: 'Date range - tests MIN/MAX on dates',
    columns: ['EventDate'],
    hasAggregation: true,
    hasGroupBy: false,
    hasOrderBy: false,
    hasWhere: false,
    hasLimit: false,
  },
  {
    id: 7,
    name: 'Group By AdvEngineID',
    sql: 'SELECT AdvEngineID, COUNT(*) FROM hits WHERE AdvEngineID <> 0 GROUP BY AdvEngineID ORDER BY COUNT(*) DESC;',
    category: 'group_by',
    complexity: 'medium',
    description: 'Small cardinality group by with filter',
    columns: ['AdvEngineID'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: false,
  },
  {
    id: 8,
    name: 'Group By RegionID with Distinct',
    sql: 'SELECT RegionID, COUNT(DISTINCT UserID) AS u FROM hits GROUP BY RegionID ORDER BY u DESC LIMIT 10;',
    category: 'group_by',
    complexity: 'complex',
    description: 'Count distinct within groups',
    columns: ['RegionID', 'UserID'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: false,
    hasLimit: true,
  },
  {
    id: 9,
    name: 'Multiple Aggregates Group By',
    sql: 'SELECT RegionID, SUM(AdvEngineID), COUNT(*) AS c, AVG(ResolutionWidth), COUNT(DISTINCT UserID) FROM hits GROUP BY RegionID ORDER BY c DESC LIMIT 10;',
    category: 'group_by',
    complexity: 'complex',
    description: 'Multiple aggregates with distinct in group by',
    columns: ['RegionID', 'AdvEngineID', 'ResolutionWidth', 'UserID'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: false,
    hasLimit: true,
  },
  {
    id: 10,
    name: 'Mobile Phone Model Distinct Users',
    sql: "SELECT MobilePhoneModel, COUNT(DISTINCT UserID) AS u FROM hits WHERE MobilePhoneModel <> '' GROUP BY MobilePhoneModel ORDER BY u DESC LIMIT 10;",
    category: 'group_by',
    complexity: 'complex',
    description: 'String column group by with distinct count',
    columns: ['MobilePhoneModel', 'UserID'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 11,
    name: 'Two Column Mobile Group By',
    sql: "SELECT MobilePhone, MobilePhoneModel, COUNT(DISTINCT UserID) AS u FROM hits WHERE MobilePhoneModel <> '' GROUP BY MobilePhone, MobilePhoneModel ORDER BY u DESC LIMIT 10;",
    category: 'group_by',
    complexity: 'complex',
    description: 'Multiple column group by',
    columns: ['MobilePhone', 'MobilePhoneModel', 'UserID'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 12,
    name: 'SearchPhrase Count',
    sql: "SELECT SearchPhrase, COUNT(*) AS c FROM hits WHERE SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY c DESC LIMIT 10;",
    category: 'group_by',
    complexity: 'medium',
    description: 'High cardinality string group by',
    columns: ['SearchPhrase'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 13,
    name: 'SearchPhrase Distinct Users',
    sql: "SELECT SearchPhrase, COUNT(DISTINCT UserID) AS u FROM hits WHERE SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY u DESC LIMIT 10;",
    category: 'group_by',
    complexity: 'complex',
    description: 'String group by with distinct count',
    columns: ['SearchPhrase', 'UserID'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 14,
    name: 'SearchEngine and Phrase',
    sql: "SELECT SearchEngineID, SearchPhrase, COUNT(*) AS c FROM hits WHERE SearchPhrase <> '' GROUP BY SearchEngineID, SearchPhrase ORDER BY c DESC LIMIT 10;",
    category: 'group_by',
    complexity: 'complex',
    description: 'Mixed type two column group by',
    columns: ['SearchEngineID', 'SearchPhrase'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 15,
    name: 'UserID Count',
    sql: 'SELECT UserID, COUNT(*) FROM hits GROUP BY UserID ORDER BY COUNT(*) DESC LIMIT 10;',
    category: 'group_by',
    complexity: 'complex',
    description: 'Very high cardinality group by (UserID)',
    columns: ['UserID'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: false,
    hasLimit: true,
  },
  {
    id: 16,
    name: 'UserID and SearchPhrase Count',
    sql: 'SELECT UserID, SearchPhrase, COUNT(*) FROM hits GROUP BY UserID, SearchPhrase ORDER BY COUNT(*) DESC LIMIT 10;',
    category: 'group_by',
    complexity: 'complex',
    description: 'Two high cardinality columns group by',
    columns: ['UserID', 'SearchPhrase'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: false,
    hasLimit: true,
  },
  {
    id: 17,
    name: 'UserID and SearchPhrase Simple',
    sql: 'SELECT UserID, SearchPhrase, COUNT(*) FROM hits GROUP BY UserID, SearchPhrase LIMIT 10;',
    category: 'group_by',
    complexity: 'medium',
    description: 'Group by without order - tests partial aggregation',
    columns: ['UserID', 'SearchPhrase'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: false,
    hasWhere: false,
    hasLimit: true,
  },
  {
    id: 18,
    name: 'UserID Minute SearchPhrase',
    sql: "SELECT UserID, extract(minute FROM EventTime) AS m, SearchPhrase, COUNT(*) FROM hits GROUP BY UserID, m, SearchPhrase ORDER BY COUNT(*) DESC LIMIT 10;",
    category: 'date_function',
    complexity: 'complex',
    description: 'Date extraction in group by',
    columns: ['UserID', 'EventTime', 'SearchPhrase'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: false,
    hasLimit: true,
  },
  {
    id: 19,
    name: 'Point Lookup UserID',
    sql: 'SELECT UserID FROM hits WHERE UserID = 435090932899640449;',
    category: 'point_lookup',
    complexity: 'simple',
    description: 'Single value lookup - tests point query performance',
    columns: ['UserID'],
    hasAggregation: false,
    hasGroupBy: false,
    hasOrderBy: false,
    hasWhere: true,
    hasLimit: false,
  },
  {
    id: 20,
    name: 'URL LIKE google',
    sql: "SELECT COUNT(*) FROM hits WHERE URL LIKE '%google%';",
    category: 'string_filter',
    complexity: 'medium',
    description: 'String pattern matching - tests LIKE performance',
    columns: ['URL'],
    hasAggregation: true,
    hasGroupBy: false,
    hasOrderBy: false,
    hasWhere: true,
    hasLimit: false,
  },
  {
    id: 21,
    name: 'SearchPhrase URL google',
    sql: "SELECT SearchPhrase, MIN(URL), COUNT(*) AS c FROM hits WHERE URL LIKE '%google%' AND SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY c DESC LIMIT 10;",
    category: 'string_filter',
    complexity: 'complex',
    description: 'String filter with group by',
    columns: ['SearchPhrase', 'URL'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 22,
    name: 'Title Google Filter',
    sql: "SELECT SearchPhrase, MIN(URL), MIN(Title), COUNT(*) AS c, COUNT(DISTINCT UserID) FROM hits WHERE Title LIKE '%Google%' AND URL NOT LIKE '%.google.%' AND SearchPhrase <> '' GROUP BY SearchPhrase ORDER BY c DESC LIMIT 10;",
    category: 'string_filter',
    complexity: 'complex',
    description: 'Complex string filtering with multiple conditions',
    columns: ['SearchPhrase', 'URL', 'Title', 'UserID'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 23,
    name: 'SELECT * google',
    sql: "SELECT * FROM hits WHERE URL LIKE '%google%' ORDER BY EventTime LIMIT 10;",
    category: 'string_filter',
    complexity: 'complex',
    description: 'Full row fetch with string filter and sort',
    columns: ['URL', 'EventTime'],
    hasAggregation: false,
    hasGroupBy: false,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 24,
    name: 'SearchPhrase Order by Time',
    sql: "SELECT SearchPhrase FROM hits WHERE SearchPhrase <> '' ORDER BY EventTime LIMIT 10;",
    category: 'order_by',
    complexity: 'medium',
    description: 'String column sort by different column',
    columns: ['SearchPhrase', 'EventTime'],
    hasAggregation: false,
    hasGroupBy: false,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 25,
    name: 'SearchPhrase Order by Self',
    sql: "SELECT SearchPhrase FROM hits WHERE SearchPhrase <> '' ORDER BY SearchPhrase LIMIT 10;",
    category: 'order_by',
    complexity: 'medium',
    description: 'String column sort by self',
    columns: ['SearchPhrase'],
    hasAggregation: false,
    hasGroupBy: false,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 26,
    name: 'SearchPhrase Multi-column Sort',
    sql: "SELECT SearchPhrase FROM hits WHERE SearchPhrase <> '' ORDER BY EventTime, SearchPhrase LIMIT 10;",
    category: 'order_by',
    complexity: 'complex',
    description: 'Multi-column sort',
    columns: ['SearchPhrase', 'EventTime'],
    hasAggregation: false,
    hasGroupBy: false,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 27,
    name: 'CounterID URL Length',
    sql: "SELECT CounterID, AVG(length(URL)) AS l, COUNT(*) AS c FROM hits WHERE URL <> '' GROUP BY CounterID HAVING COUNT(*) > 100000 ORDER BY l DESC LIMIT 25;",
    category: 'complex',
    complexity: 'complex',
    description: 'String function in aggregation with HAVING',
    columns: ['CounterID', 'URL'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 28,
    name: 'Referer Domain Extract',
    sql: "SELECT REGEXP_REPLACE(Referer, '^https?://(?:www\\.)?([^/]+)/.*$', '\\1') AS k, AVG(length(Referer)) AS l, COUNT(*) AS c, MIN(Referer) FROM hits WHERE Referer <> '' GROUP BY k HAVING COUNT(*) > 100000 ORDER BY l DESC LIMIT 25;",
    category: 'complex',
    complexity: 'complex',
    description: 'Regex extraction with aggregation',
    columns: ['Referer'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 29,
    name: 'Many SUM Expressions',
    sql: 'SELECT SUM(ResolutionWidth), SUM(ResolutionWidth + 1), SUM(ResolutionWidth + 2), SUM(ResolutionWidth + 3), SUM(ResolutionWidth + 4), SUM(ResolutionWidth + 5), SUM(ResolutionWidth + 6), SUM(ResolutionWidth + 7), SUM(ResolutionWidth + 8), SUM(ResolutionWidth + 9), SUM(ResolutionWidth + 10), SUM(ResolutionWidth + 11), SUM(ResolutionWidth + 12), SUM(ResolutionWidth + 13), SUM(ResolutionWidth + 14), SUM(ResolutionWidth + 15), SUM(ResolutionWidth + 16), SUM(ResolutionWidth + 17), SUM(ResolutionWidth + 18), SUM(ResolutionWidth + 19), SUM(ResolutionWidth + 20), SUM(ResolutionWidth + 21), SUM(ResolutionWidth + 22), SUM(ResolutionWidth + 23), SUM(ResolutionWidth + 24), SUM(ResolutionWidth + 25), SUM(ResolutionWidth + 26), SUM(ResolutionWidth + 27), SUM(ResolutionWidth + 28), SUM(ResolutionWidth + 29), SUM(ResolutionWidth + 30), SUM(ResolutionWidth + 31), SUM(ResolutionWidth + 32), SUM(ResolutionWidth + 33), SUM(ResolutionWidth + 34), SUM(ResolutionWidth + 35), SUM(ResolutionWidth + 36), SUM(ResolutionWidth + 37), SUM(ResolutionWidth + 38), SUM(ResolutionWidth + 39), SUM(ResolutionWidth + 40), SUM(ResolutionWidth + 41), SUM(ResolutionWidth + 42), SUM(ResolutionWidth + 43), SUM(ResolutionWidth + 44), SUM(ResolutionWidth + 45), SUM(ResolutionWidth + 46), SUM(ResolutionWidth + 47), SUM(ResolutionWidth + 48), SUM(ResolutionWidth + 49), SUM(ResolutionWidth + 50), SUM(ResolutionWidth + 51), SUM(ResolutionWidth + 52), SUM(ResolutionWidth + 53), SUM(ResolutionWidth + 54), SUM(ResolutionWidth + 55), SUM(ResolutionWidth + 56), SUM(ResolutionWidth + 57), SUM(ResolutionWidth + 58), SUM(ResolutionWidth + 59), SUM(ResolutionWidth + 60), SUM(ResolutionWidth + 61), SUM(ResolutionWidth + 62), SUM(ResolutionWidth + 63), SUM(ResolutionWidth + 64), SUM(ResolutionWidth + 65), SUM(ResolutionWidth + 66), SUM(ResolutionWidth + 67), SUM(ResolutionWidth + 68), SUM(ResolutionWidth + 69), SUM(ResolutionWidth + 70), SUM(ResolutionWidth + 71), SUM(ResolutionWidth + 72), SUM(ResolutionWidth + 73), SUM(ResolutionWidth + 74), SUM(ResolutionWidth + 75), SUM(ResolutionWidth + 76), SUM(ResolutionWidth + 77), SUM(ResolutionWidth + 78), SUM(ResolutionWidth + 79), SUM(ResolutionWidth + 80), SUM(ResolutionWidth + 81), SUM(ResolutionWidth + 82), SUM(ResolutionWidth + 83), SUM(ResolutionWidth + 84), SUM(ResolutionWidth + 85), SUM(ResolutionWidth + 86), SUM(ResolutionWidth + 87), SUM(ResolutionWidth + 88), SUM(ResolutionWidth + 89) FROM hits;',
    category: 'simple_aggregate',
    complexity: 'complex',
    description: 'Many expression aggregations - tests expression evaluation',
    columns: ['ResolutionWidth'],
    hasAggregation: true,
    hasGroupBy: false,
    hasOrderBy: false,
    hasWhere: false,
    hasLimit: false,
  },
  {
    id: 30,
    name: 'SearchEngine ClientIP',
    sql: "SELECT SearchEngineID, ClientIP, COUNT(*) AS c, SUM(IsRefresh), AVG(ResolutionWidth) FROM hits WHERE SearchPhrase <> '' GROUP BY SearchEngineID, ClientIP ORDER BY c DESC LIMIT 10;",
    category: 'group_by',
    complexity: 'complex',
    description: 'Multiple integer columns group by',
    columns: ['SearchEngineID', 'ClientIP', 'SearchPhrase', 'IsRefresh', 'ResolutionWidth'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 31,
    name: 'WatchID ClientIP Filtered',
    sql: "SELECT WatchID, ClientIP, COUNT(*) AS c, SUM(IsRefresh), AVG(ResolutionWidth) FROM hits WHERE SearchPhrase <> '' GROUP BY WatchID, ClientIP ORDER BY c DESC LIMIT 10;",
    category: 'group_by',
    complexity: 'complex',
    description: 'High cardinality group by with filter',
    columns: ['WatchID', 'ClientIP', 'SearchPhrase', 'IsRefresh', 'ResolutionWidth'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 32,
    name: 'WatchID ClientIP All',
    sql: 'SELECT WatchID, ClientIP, COUNT(*) AS c, SUM(IsRefresh), AVG(ResolutionWidth) FROM hits GROUP BY WatchID, ClientIP ORDER BY c DESC LIMIT 10;',
    category: 'group_by',
    complexity: 'complex',
    description: 'Very high cardinality group by without filter',
    columns: ['WatchID', 'ClientIP', 'IsRefresh', 'ResolutionWidth'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: false,
    hasLimit: true,
  },
  {
    id: 33,
    name: 'URL Count',
    sql: 'SELECT URL, COUNT(*) AS c FROM hits GROUP BY URL ORDER BY c DESC LIMIT 10;',
    category: 'group_by',
    complexity: 'complex',
    description: 'String column group by (high cardinality)',
    columns: ['URL'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: false,
    hasLimit: true,
  },
  {
    id: 34,
    name: 'Constant URL Group',
    sql: 'SELECT 1, URL, COUNT(*) AS c FROM hits GROUP BY 1, URL ORDER BY c DESC LIMIT 10;',
    category: 'group_by',
    complexity: 'complex',
    description: 'Constant in group by with string',
    columns: ['URL'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: false,
    hasLimit: true,
  },
  {
    id: 35,
    name: 'ClientIP Expressions',
    sql: 'SELECT ClientIP, ClientIP - 1, ClientIP - 2, ClientIP - 3, COUNT(*) AS c FROM hits GROUP BY ClientIP, ClientIP - 1, ClientIP - 2, ClientIP - 3 ORDER BY c DESC LIMIT 10;',
    category: 'group_by',
    complexity: 'complex',
    description: 'Expressions in group by',
    columns: ['ClientIP'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: false,
    hasLimit: true,
  },
  {
    id: 36,
    name: 'URL PageViews Counter 62',
    sql: "SELECT URL, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND DontCountHits = 0 AND IsRefresh = 0 AND URL <> '' GROUP BY URL ORDER BY PageViews DESC LIMIT 10;",
    category: 'complex',
    complexity: 'complex',
    description: 'Multi-filter group by with date range',
    columns: ['URL', 'CounterID', 'EventDate', 'DontCountHits', 'IsRefresh'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 37,
    name: 'Title PageViews Counter 62',
    sql: "SELECT Title, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND DontCountHits = 0 AND IsRefresh = 0 AND Title <> '' GROUP BY Title ORDER BY PageViews DESC LIMIT 10;",
    category: 'complex',
    complexity: 'complex',
    description: 'String group by with date range filter',
    columns: ['Title', 'CounterID', 'EventDate', 'DontCountHits', 'IsRefresh'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 38,
    name: 'URL PageViews with OFFSET',
    sql: "SELECT URL, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND IsRefresh = 0 AND IsLink <> 0 AND IsDownload = 0 GROUP BY URL ORDER BY PageViews DESC LIMIT 10 OFFSET 1000;",
    category: 'complex',
    complexity: 'complex',
    description: 'Pagination with OFFSET',
    columns: ['URL', 'CounterID', 'EventDate', 'IsRefresh', 'IsLink', 'IsDownload'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 39,
    name: 'Traffic Source Analysis',
    sql: "SELECT TraficSourceID, SearchEngineID, AdvEngineID, CASE WHEN (SearchEngineID = 0 AND AdvEngineID = 0) THEN Referer ELSE '' END AS Src, URL AS Dst, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND IsRefresh = 0 GROUP BY TraficSourceID, SearchEngineID, AdvEngineID, Src, Dst ORDER BY PageViews DESC LIMIT 10 OFFSET 1000;",
    category: 'complex',
    complexity: 'complex',
    description: 'CASE expression in group by with offset',
    columns: ['TraficSourceID', 'SearchEngineID', 'AdvEngineID', 'Referer', 'URL', 'CounterID', 'EventDate', 'IsRefresh'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 40,
    name: 'URLHash EventDate',
    sql: "SELECT URLHash, EventDate, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND IsRefresh = 0 AND TraficSourceID IN (-1, 6) AND RefererHash = 3594120000172545465 GROUP BY URLHash, EventDate ORDER BY PageViews DESC LIMIT 10 OFFSET 100;",
    category: 'complex',
    complexity: 'complex',
    description: 'IN clause with hash column',
    columns: ['URLHash', 'EventDate', 'CounterID', 'IsRefresh', 'TraficSourceID', 'RefererHash'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 41,
    name: 'Window Dimensions',
    sql: "SELECT WindowClientWidth, WindowClientHeight, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-01' AND EventDate <= '2013-07-31' AND IsRefresh = 0 AND DontCountHits = 0 AND URLHash = 2868770270353813622 GROUP BY WindowClientWidth, WindowClientHeight ORDER BY PageViews DESC LIMIT 10 OFFSET 10000;",
    category: 'complex',
    complexity: 'complex',
    description: 'Large OFFSET pagination',
    columns: ['WindowClientWidth', 'WindowClientHeight', 'CounterID', 'EventDate', 'IsRefresh', 'DontCountHits', 'URLHash'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
  {
    id: 42,
    name: 'Time Bucketing',
    sql: "SELECT DATE_TRUNC('minute', EventTime) AS M, COUNT(*) AS PageViews FROM hits WHERE CounterID = 62 AND EventDate >= '2013-07-14' AND EventDate <= '2013-07-15' AND IsRefresh = 0 AND DontCountHits = 0 GROUP BY DATE_TRUNC('minute', EventTime) ORDER BY DATE_TRUNC('minute', EventTime) LIMIT 10 OFFSET 1000;",
    category: 'date_function',
    complexity: 'complex',
    description: 'DATE_TRUNC with group by and offset',
    columns: ['EventTime', 'CounterID', 'EventDate', 'IsRefresh', 'DontCountHits'],
    hasAggregation: true,
    hasGroupBy: true,
    hasOrderBy: true,
    hasWhere: true,
    hasLimit: true,
  },
];

// ============================================================================
// Query Lookup Functions
// ============================================================================

/**
 * Get a query by ID
 */
export function getQueryById(id: number): ClickBenchQuery | undefined {
  return CLICKBENCH_QUERIES.find(q => q.id === id);
}

/**
 * Get all queries in a category
 */
export function getQueriesByCategory(category: QueryCategory): ClickBenchQuery[] {
  return CLICKBENCH_QUERIES.filter(q => q.category === category);
}

/**
 * Get all queries by complexity
 */
export function getQueriesByComplexity(complexity: QueryComplexity): ClickBenchQuery[] {
  return CLICKBENCH_QUERIES.filter(q => q.complexity === complexity);
}

/**
 * Get queries that use a specific column
 */
export function getQueriesUsingColumn(columnName: string): ClickBenchQuery[] {
  return CLICKBENCH_QUERIES.filter(q => q.columns.includes(columnName));
}

/**
 * Get simple queries (good for initial testing)
 */
export function getSimpleQueries(): ClickBenchQuery[] {
  return getQueriesByComplexity('simple');
}

/**
 * Get queries without aggregation
 */
export function getNonAggregateQueries(): ClickBenchQuery[] {
  return CLICKBENCH_QUERIES.filter(q => !q.hasAggregation);
}

/**
 * Total number of ClickBench queries
 */
export const QUERY_COUNT = CLICKBENCH_QUERIES.length;

// ============================================================================
// Query Statistics
// ============================================================================

/**
 * Get statistics about the query set
 */
export function getQueryStatistics(): {
  total: number;
  byCategory: Record<QueryCategory, number>;
  byComplexity: Record<QueryComplexity, number>;
  withAggregation: number;
  withGroupBy: number;
  withOrderBy: number;
  withWhere: number;
  withLimit: number;
} {
  const byCategory: Record<QueryCategory, number> = {
    simple_aggregate: 0,
    filtered_scan: 0,
    group_by: 0,
    count_distinct: 0,
    string_filter: 0,
    point_lookup: 0,
    order_by: 0,
    complex: 0,
    date_function: 0,
  };

  const byComplexity: Record<QueryComplexity, number> = {
    simple: 0,
    medium: 0,
    complex: 0,
  };

  let withAggregation = 0;
  let withGroupBy = 0;
  let withOrderBy = 0;
  let withWhere = 0;
  let withLimit = 0;

  for (const query of CLICKBENCH_QUERIES) {
    byCategory[query.category]++;
    byComplexity[query.complexity]++;
    if (query.hasAggregation) withAggregation++;
    if (query.hasGroupBy) withGroupBy++;
    if (query.hasOrderBy) withOrderBy++;
    if (query.hasWhere) withWhere++;
    if (query.hasLimit) withLimit++;
  }

  return {
    total: CLICKBENCH_QUERIES.length,
    byCategory,
    byComplexity,
    withAggregation,
    withGroupBy,
    withOrderBy,
    withWhere,
    withLimit,
  };
}
