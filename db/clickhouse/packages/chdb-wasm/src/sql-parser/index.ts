/**
 * SQL Parser Module
 *
 * Extracts and provides SQL parsing utilities:
 * - Statement type detection
 * - SELECT/INSERT/CREATE TABLE parsing
 * - Clause parsing (WHERE, GROUP BY, ORDER BY, LIMIT)
 * - Table function argument parsing
 * - Value parsing
 *
 * This module is extracted from http-query-handler.ts to improve
 * code organization and testability.
 */

import type { ParsedValue } from '../types';

// ============================================================================
// Types and Enums
// ============================================================================

/**
 * SQL statement types
 */
export enum StatementType {
  SELECT = 'SELECT',
  INSERT = 'INSERT',
  CREATE_TABLE = 'CREATE_TABLE',
  SHOW_TABLES = 'SHOW_TABLES',
  SHOW_DATABASES = 'SHOW_DATABASES',
  DESCRIBE = 'DESCRIBE',
  WITH = 'WITH',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Parsed SELECT statement result
 */
export interface ParsedSelectStatement {
  tableName: string;
  database: string;
  columns: string;
  whereClause: string | null;
  groupBy: string[] | null;
  having: string | null;
  orderBy: string | null;
  limit: number | null;
}

/**
 * Parsed CREATE TABLE statement result
 */
export interface ParsedCreateTableStatement {
  tableName: string;
  database: string;
  columns: Array<{ name: string; type: string }>;
  engine: string;
  orderBy: string[];
}

/**
 * Parsed INSERT statement result
 */
export interface ParsedInsertStatement {
  tableName: string;
  database: string;
  columns: string[];
  values: ParsedValue[][];
}

/**
 * Parsed SELECT expression with optional alias
 */
export interface ParsedSelectExpression {
  expression: string;
  alias: string | null;
}

/**
 * Table function argument parsing result
 */
export interface TableFunctionArgsResult {
  args: string[];
  innerQuery: string | null;
}

/**
 * LIMIT/OFFSET parsing result
 */
export interface LimitOffsetResult {
  limit: number | null;
  offset: number | null;
}

// ============================================================================
// Statement Type Detection
// ============================================================================

/**
 * Detect the type of SQL statement
 */
export function detectStatementType(sql: string): StatementType {
  const normalizedSql = sql.replace(/\s+/g, ' ').trim();
  const upperSql = normalizedSql.toUpperCase();

  if (!upperSql) {
    return StatementType.UNKNOWN;
  }

  if (upperSql.startsWith('SELECT')) {
    return StatementType.SELECT;
  }

  if (upperSql.startsWith('INSERT INTO')) {
    return StatementType.INSERT;
  }

  if (upperSql.startsWith('CREATE TABLE')) {
    return StatementType.CREATE_TABLE;
  }

  if (upperSql.startsWith('SHOW TABLES')) {
    return StatementType.SHOW_TABLES;
  }

  if (upperSql.startsWith('SHOW DATABASES')) {
    return StatementType.SHOW_DATABASES;
  }

  if (upperSql.startsWith('DESCRIBE') || upperSql.startsWith('DESC ')) {
    return StatementType.DESCRIBE;
  }

  if (upperSql.startsWith('WITH')) {
    return StatementType.WITH;
  }

  return StatementType.UNKNOWN;
}

// ============================================================================
// SELECT Statement Parsing
// ============================================================================

/**
 * Parse SELECT statement to extract table name, columns, and clauses
 */
export function parseSelectStatement(sql: string, defaultDatabase: string = 'default'): ParsedSelectStatement | null {
  const upperSql = sql.toUpperCase().trim();
  if (!upperSql.startsWith('SELECT')) return null;

  // Extract columns
  const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
  if (!selectMatch) return null;
  const columns = selectMatch[1].trim();

  // Extract table name
  const tableMatch = sql.match(/FROM\s+(?:(\w+)\.)?(\w+)/i);
  if (!tableMatch) return null;

  const database = tableMatch[1] || defaultDatabase;
  const tableName = tableMatch[2];

  // Extract WHERE clause (stops at GROUP BY, HAVING, ORDER BY, or LIMIT)
  const whereClause = parseWhereClause(sql);

  // Extract GROUP BY clause
  const groupBy = parseGroupByClause(sql);

  // Extract HAVING clause
  const havingMatch = sql.match(/HAVING\s+([\s\S]+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/i);
  const having = havingMatch ? havingMatch[1].trim() : null;

  // Extract ORDER BY
  const orderBy = parseOrderByClause(sql);

  // Extract LIMIT
  const { limit } = parseLimitOffset(sql);

  return { tableName, database, columns, whereClause, groupBy, having, orderBy, limit };
}

// ============================================================================
// CREATE TABLE Statement Parsing
// ============================================================================

/**
 * Parse CREATE TABLE statement to extract table structure
 */
export function parseCreateTableStatement(sql: string, defaultDatabase: string = 'default'): ParsedCreateTableStatement | null {
  const upperSql = sql.toUpperCase().trim();
  if (!upperSql.startsWith('CREATE TABLE')) return null;

  // Extract table name (with optional database prefix)
  const tableMatch = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(\w+)\.)?(\w+)/i);
  if (!tableMatch) return null;

  const database = tableMatch[1] || defaultDatabase;
  const tableName = tableMatch[2];

  // Extract columns from between parentheses before ENGINE
  const columnsMatch = sql.match(/\(\s*([\s\S]+?)\s*\)\s*ENGINE/i);
  if (!columnsMatch) return null;

  const columnsStr = columnsMatch[1];
  const columns: Array<{ name: string; type: string }> = [];

  // Parse column definitions
  const columnParts = columnsStr.split(',').map(c => c.trim());
  for (const part of columnParts) {
    const colMatch = part.match(/^(\w+)\s+(.+)$/);
    if (colMatch) {
      columns.push({ name: colMatch[1], type: colMatch[2].trim() });
    }
  }

  // Extract engine
  const engineMatch = sql.match(/ENGINE\s*=\s*(\w+)\s*\(\s*\)/i);
  const engine = engineMatch ? engineMatch[1] : 'MergeTree';

  // Extract ORDER BY
  const orderByMatch = sql.match(/ORDER\s+BY\s+\(?\s*([^)]+?)\s*\)?(?:\s+|$)/i);
  const orderBy = orderByMatch
    ? orderByMatch[1].split(',').map(c => c.trim())
    : [];

  return { tableName, database, columns, engine, orderBy };
}

// ============================================================================
// INSERT Statement Parsing
// ============================================================================

/**
 * Parse INSERT statement to extract table name and values
 */
export function parseInsertStatement(sql: string, defaultDatabase: string = 'default'): ParsedInsertStatement | null {
  const upperSql = sql.toUpperCase().trim();
  if (!upperSql.startsWith('INSERT INTO')) return null;

  // Extract table name
  const tableMatch = sql.match(/INSERT\s+INTO\s+(?:(\w+)\.)?(\w+)/i);
  if (!tableMatch) return null;

  const database = tableMatch[1] || defaultDatabase;
  const tableName = tableMatch[2];

  // Extract columns if specified
  const columnsMatch = sql.match(/INSERT\s+INTO\s+(?:\w+\.)?(\w+)\s*\(([^)]+)\)/i);
  const columns = columnsMatch
    ? columnsMatch[2].split(',').map(c => c.trim())
    : [];

  // Extract VALUES
  const valuesMatch = sql.match(/VALUES\s+([\s\S]+)$/i);
  if (!valuesMatch) return null;

  const valuesStr = valuesMatch[1];
  const values: ParsedValue[][] = [];

  // Parse value tuples: (val1, val2), (val3, val4)
  const tupleRegex = /\(([^)]+)\)/g;
  let match;
  while ((match = tupleRegex.exec(valuesStr)) !== null) {
    const tuple = match[1];
    const row: ParsedValue[] = [];

    // Simple value parsing (handles strings, numbers)
    let current = '';
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < tuple.length; i++) {
      const char = tuple[i];

      if (!inString && (char === "'" || char === '"')) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar) {
        if (i + 1 < tuple.length && tuple[i + 1] === stringChar) {
          current += char;
          i++;
        } else {
          inString = false;
        }
      } else if (!inString && char === ',') {
        row.push(parseValue(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      row.push(parseValue(current.trim()));
    }

    values.push(row);
  }

  return { tableName, database, columns, values };
}

// ============================================================================
// SELECT Expression Parsing
// ============================================================================

/**
 * Parse SELECT expressions into individual items with aliases
 */
export function parseSelectExpressions(selectClause: string): ParsedSelectExpression[] {
  const results: ParsedSelectExpression[] = [];

  // Split by comma but respect parentheses
  const parts = splitByCommaRespectingParentheses(selectClause);

  for (const part of parts) {
    // Check for alias (AS keyword, case insensitive)
    const aliasMatch = part.match(/(.+?)\s+[Aa][Ss]\s+(\w+)\s*$/);
    if (aliasMatch) {
      results.push({ expression: aliasMatch[1].trim(), alias: aliasMatch[2] });
    } else {
      results.push({ expression: part.trim(), alias: null });
    }
  }

  return results;
}

// ============================================================================
// Table Function Argument Parsing
// ============================================================================

/**
 * Parse table function arguments from SQL
 */
export function parseTableFunctionArgs(sql: string, funcName: string): TableFunctionArgsResult {
  // Find the function call start
  const funcStart = new RegExp(`${funcName}\\s*\\(`, 'i');
  const startMatch = sql.match(funcStart);

  if (!startMatch) {
    return { args: [], innerQuery: null };
  }

  // Find the matching closing parenthesis
  const startIdx = startMatch.index! + startMatch[0].length;
  let depth = 1;
  let inString = false;
  let stringChar = '';
  let endIdx = startIdx;

  for (let i = startIdx; i < sql.length && depth > 0; i++) {
    const char = sql[i];

    if (!inString && (char === "'" || char === '"')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === '\\') {
      // Handle backslash escape - skip next character
      if (i + 1 < sql.length) {
        i++; // Skip the escaped character
      }
    } else if (inString && char === stringChar) {
      // Check for escaped quote (doubled)
      if (i + 1 < sql.length && sql[i + 1] === stringChar) {
        i++; // Skip escaped quote
      } else {
        inString = false;
      }
    } else if (!inString && char === '(') {
      depth++;
    } else if (!inString && char === ')') {
      depth--;
      if (depth === 0) {
        endIdx = i;
      }
    }
  }

  // Extract the arguments string
  const argsStr = sql.substring(startIdx, endIdx);
  const args: string[] = [];
  let argDepth = 0;
  let bracketDepth = 0; // Track square brackets for arrays
  let braceDepth = 0;   // Track curly braces for objects
  let current = '';
  let argInString = false;
  let argStringChar = '';

  for (let j = 0; j < argsStr.length; j++) {
    const c = argsStr[j];

    if (!argInString && (c === "'" || c === '"')) {
      argInString = true;
      argStringChar = c;
      current += c;
    } else if (argInString && c === '\\') {
      // Handle backslash escape - include backslash and next character
      if (j + 1 < argsStr.length) {
        current += c + argsStr[j + 1];
        j++;
      } else {
        current += c;
      }
    } else if (argInString && c === argStringChar) {
      // Check for escaped quote (doubled)
      if (j + 1 < argsStr.length && argsStr[j + 1] === argStringChar) {
        current += c + argsStr[j + 1];
        j++;
      } else {
        argInString = false;
        current += c;
      }
    } else if (!argInString && c === '(') {
      argDepth++;
      current += c;
    } else if (!argInString && c === ')') {
      argDepth--;
      current += c;
    } else if (!argInString && c === '[') {
      bracketDepth++;
      current += c;
    } else if (!argInString && c === ']') {
      bracketDepth--;
      current += c;
    } else if (!argInString && c === '{') {
      braceDepth++;
      current += c;
    } else if (!argInString && c === '}') {
      braceDepth--;
      current += c;
    } else if (!argInString && c === ',' && argDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  // Extract inner SQL query (usually the last string argument for DB functions)
  // Look for any quoted string that appears to be a SQL query (SELECT, INSERT, UPDATE, DELETE, etc.)
  let innerQuery: string | null = null;
  for (const arg of args) {
    const strMatch = arg.match(/^'(.+)'$/s);
    if (strMatch) {
      const unescapedContent = strMatch[1].replace(/''/g, "'");
      const trimmedContent = unescapedContent.trim().toUpperCase();
      // Check for valid SQL keywords, including misspelled ones for error detection
      const sqlKeywords = ['SELECT', 'SELEC', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'PRAGMA', 'CREATE', 'DROP', 'ALTER', 'TRUNCATE'];
      const startsWithSqlKeyword = sqlKeywords.some(kw => trimmedContent.startsWith(kw));
      if (startsWithSqlKeyword) {
        innerQuery = unescapedContent;
      }
    }
  }

  // Normalize inner query - convert + to spaces (URL encoding artifact)
  if (innerQuery) {
    innerQuery = innerQuery.replace(/\+/g, ' ');
  }

  return { args, innerQuery };
}

// ============================================================================
// Clause Parsing
// ============================================================================

/**
 * Parse WHERE clause from SQL
 */
export function parseWhereClause(sql: string): string | null {
  const whereMatch = sql.match(/WHERE\s+([\s\S]+?)(?:\s+GROUP\s+BY|\s+HAVING|\s+ORDER\s+BY|\s+LIMIT|$)/i);
  return whereMatch ? whereMatch[1].trim() : null;
}

/**
 * Parse GROUP BY clause from SQL
 */
export function parseGroupByClause(sql: string): string[] | null {
  const groupByMatch = sql.match(/GROUP\s+BY\s+([\s\S]+?)(?:\s+HAVING|\s+ORDER\s+BY|\s+LIMIT|$)/i);
  return groupByMatch
    ? groupByMatch[1].split(',').map(c => c.trim())
    : null;
}

/**
 * Parse ORDER BY clause from SQL
 */
export function parseOrderByClause(sql: string): string | null {
  const orderByMatch = sql.match(/ORDER\s+BY\s+([\s\S]+?)(?:\s+LIMIT|$)/i);
  return orderByMatch ? orderByMatch[1].trim() : null;
}

/**
 * Parse LIMIT and OFFSET from SQL
 */
export function parseLimitOffset(sql: string): LimitOffsetResult {
  // Try LIMIT n OFFSET m
  const limitOffsetMatch = sql.match(/LIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i);
  if (limitOffsetMatch) {
    return {
      limit: parseInt(limitOffsetMatch[1], 10),
      offset: parseInt(limitOffsetMatch[2], 10),
    };
  }

  // Try LIMIT m, n (where m is offset, n is limit)
  const limitCommaMatch = sql.match(/LIMIT\s+(\d+)\s*,\s*(\d+)/i);
  if (limitCommaMatch) {
    return {
      limit: parseInt(limitCommaMatch[2], 10),
      offset: parseInt(limitCommaMatch[1], 10),
    };
  }

  // Try simple LIMIT n
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  if (limitMatch) {
    return {
      limit: parseInt(limitMatch[1], 10),
      offset: null,
    };
  }

  return { limit: null, offset: null };
}

// ============================================================================
// Value Parsing
// ============================================================================

/**
 * Parse a value string into the appropriate type
 */
export function parseValue(val: string): ParsedValue {
  // Remove surrounding quotes
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    return val.slice(1, -1).replace(/''/g, "'").replace(/""/g, '"');
  }

  // Check for NULL
  if (val.toUpperCase() === 'NULL') return null;

  // Check for boolean
  if (val.toLowerCase() === 'true') return true;
  if (val.toLowerCase() === 'false') return false;

  // Check for number
  const num = Number(val);
  if (!isNaN(num)) return num;

  return val;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse comma-separated arguments, respecting nested parentheses
 */
export function parseCommaSeparatedArgs(args: string): string[] {
  if (!args.trim()) {
    return [];
  }
  return splitByCommaRespectingParentheses(args);
}

/**
 * Split a string by commas, respecting parentheses and string literals
 */
export function splitByCommaRespectingParentheses(str: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (!inString && (char === "'" || char === '"')) {
      inString = true;
      stringChar = char;
      current += char;
    } else if (inString && char === stringChar) {
      // Check for escaped quote
      if (i + 1 < str.length && str[i + 1] === stringChar) {
        current += char + str[i + 1];
        i++;
      } else {
        inString = false;
        current += char;
      }
    } else if (!inString && char === '(') {
      depth++;
      current += char;
    } else if (!inString && char === ')') {
      depth--;
      current += char;
    } else if (!inString && char === ',' && depth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

/**
 * Extract content inside parentheses, handling nested parentheses
 * Returns the content between the first ( and its matching )
 */
export function extractParenthesizedContent(str: string, startIdx: number = 0): string {
  let depth = 0;
  let start = -1;
  let end = -1;

  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === '(') {
      if (depth === 0) {
        start = i + 1;
      }
      depth++;
    } else if (str[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (start === -1 || end === -1) {
    return '';
  }

  return str.substring(start, end).trim();
}

/**
 * Parse an array argument like ['Alice'] or [1, 'active'] into actual values
 */
export function parseArrayArgument(arrayStr: string): ParsedValue[] {
  // Remove the brackets
  const content = arrayStr.slice(1, -1).trim();
  if (!content) return [];

  const values: ParsedValue[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let bracketDepth = 0;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (!inString && (char === "'" || char === '"')) {
      inString = true;
      stringChar = char;
      current += char;
    } else if (inString && char === '\\') {
      // Handle backslash escape - include backslash and next character
      if (i + 1 < content.length) {
        current += char + content[i + 1];
        i++;
      } else {
        current += char;
      }
    } else if (inString && char === stringChar) {
      // Check for escaped quote (doubled)
      if (i + 1 < content.length && content[i + 1] === stringChar) {
        current += char + stringChar;
        i++;
      } else {
        inString = false;
        current += char;
      }
    } else if (!inString && char === '[') {
      bracketDepth++;
      current += char;
    } else if (!inString && char === ']') {
      bracketDepth--;
      current += char;
    } else if (!inString && char === ',' && bracketDepth === 0) {
      values.push(parseArrayValue(current.trim()));
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    values.push(parseArrayValue(current.trim()));
  }

  return values;
}

/**
 * Parse a single array value into its actual type
 */
export function parseArrayValue(value: string): ParsedValue {
  // String literal 'xxx' or "xxx" - also handle backslash escapes
  if ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))) {
    // Remove outer quotes and handle backslash escapes
    let inner = value.slice(1, -1);
    // Handle doubled quotes (escaped in SQL)
    inner = inner.replace(/''/g, "'").replace(/""/g, '"');
    // Handle backslash escapes
    inner = inner.replace(/\\(.)/g, '$1');
    return inner;
  }

  // Boolean
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // NULL
  if (value.toUpperCase() === 'NULL') return null;

  // Nested array
  if (value.startsWith('[') && value.endsWith(']')) {
    return parseArrayArgument(value);
  }

  // Number
  const num = Number(value);
  if (!isNaN(num)) return num;

  return value;
}

/**
 * Parse an array element with a specific cast type
 */
export function parseArrayElement(value: string, castType: string): ParsedValue {
  // First, parse as a generic value
  const parsed = parseArrayValue(value);

  // Apply type casting if needed
  if (castType === 'auto') {
    return parsed;
  }

  if (castType.toLowerCase().includes('int')) {
    return typeof parsed === 'number' ? Math.floor(parsed) : parseInt(String(parsed), 10);
  }

  if (castType.toLowerCase().includes('float') || castType.toLowerCase().includes('double')) {
    return typeof parsed === 'number' ? parsed : parseFloat(String(parsed));
  }

  return parsed;
}
