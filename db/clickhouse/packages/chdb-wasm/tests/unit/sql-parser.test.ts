/**
 * SQL Parser Module Tests
 *
 * Tests for the extracted SQL parser functionality:
 * - Statement type detection (SELECT, INSERT, SHOW, DESCRIBE, CREATE, etc.)
 * - Column parsing
 * - WHERE clause parsing
 * - GROUP BY parsing
 * - ORDER BY parsing
 * - LIMIT/OFFSET parsing
 * - Table function argument parsing
 *
 * TDD RED phase: These tests are written BEFORE the implementation.
 */

import { describe, it, expect } from 'vitest';
import {
  detectStatementType,
  StatementType,
  parseSelectStatement,
  parseCreateTableStatement,
  parseInsertStatement,
  parseSelectExpressions,
  parseTableFunctionArgs,
  parseWhereClause,
  parseGroupByClause,
  parseOrderByClause,
  parseLimitOffset,
  parseValue,
  parseCommaSeparatedArgs,
  splitByCommaRespectingParentheses,
} from '../../src/sql-parser';

describe('SQL Parser Module', () => {
  describe('detectStatementType', () => {
    it('should detect SELECT statements', () => {
      expect(detectStatementType('SELECT 1')).toBe(StatementType.SELECT);
      expect(detectStatementType('  select * from users')).toBe(StatementType.SELECT);
      expect(detectStatementType('SELECT\n  id\nFROM users')).toBe(StatementType.SELECT);
    });

    it('should detect INSERT statements', () => {
      expect(detectStatementType('INSERT INTO users VALUES (1)')).toBe(StatementType.INSERT);
      expect(detectStatementType('  insert into users (id) values (1)')).toBe(StatementType.INSERT);
    });

    it('should detect CREATE TABLE statements', () => {
      expect(detectStatementType('CREATE TABLE users (id Int64)')).toBe(StatementType.CREATE_TABLE);
      expect(detectStatementType('CREATE TABLE IF NOT EXISTS users (id Int64)')).toBe(StatementType.CREATE_TABLE);
    });

    it('should detect SHOW statements', () => {
      expect(detectStatementType('SHOW TABLES')).toBe(StatementType.SHOW_TABLES);
      expect(detectStatementType('SHOW DATABASES')).toBe(StatementType.SHOW_DATABASES);
      expect(detectStatementType('show tables from default')).toBe(StatementType.SHOW_TABLES);
    });

    it('should detect DESCRIBE statements', () => {
      expect(detectStatementType('DESCRIBE users')).toBe(StatementType.DESCRIBE);
      expect(detectStatementType('DESC users')).toBe(StatementType.DESCRIBE);
      expect(detectStatementType('DESCRIBE parquet(\'file.parquet\')')).toBe(StatementType.DESCRIBE);
    });

    it('should detect WITH (CTE) statements', () => {
      expect(detectStatementType('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(StatementType.WITH);
    });

    it('should return UNKNOWN for unsupported statements', () => {
      expect(detectStatementType('DROP TABLE users')).toBe(StatementType.UNKNOWN);
      expect(detectStatementType('ALTER TABLE users')).toBe(StatementType.UNKNOWN);
      expect(detectStatementType('')).toBe(StatementType.UNKNOWN);
    });
  });

  describe('parseSelectStatement', () => {
    it('should parse simple SELECT statement', () => {
      const result = parseSelectStatement('SELECT id, name FROM users');

      expect(result).not.toBeNull();
      expect(result?.tableName).toBe('users');
      expect(result?.columns).toBe('id, name');
    });

    it('should parse SELECT with database prefix', () => {
      const result = parseSelectStatement('SELECT * FROM mydb.users');

      expect(result).not.toBeNull();
      expect(result?.database).toBe('mydb');
      expect(result?.tableName).toBe('users');
    });

    it('should parse SELECT with WHERE clause', () => {
      const result = parseSelectStatement('SELECT id FROM users WHERE id > 10');

      expect(result).not.toBeNull();
      expect(result?.whereClause).toBe('id > 10');
    });

    it('should parse SELECT with GROUP BY', () => {
      const result = parseSelectStatement('SELECT category, COUNT(*) FROM products GROUP BY category');

      expect(result).not.toBeNull();
      expect(result?.groupBy).toEqual(['category']);
    });

    it('should parse SELECT with multiple GROUP BY columns', () => {
      const result = parseSelectStatement('SELECT a, b, COUNT(*) FROM t GROUP BY a, b');

      expect(result).not.toBeNull();
      expect(result?.groupBy).toEqual(['a', 'b']);
    });

    it('should parse SELECT with HAVING clause', () => {
      const result = parseSelectStatement('SELECT category, COUNT(*) as cnt FROM products GROUP BY category HAVING cnt > 5');

      expect(result).not.toBeNull();
      expect(result?.having).toBe('cnt > 5');
    });

    it('should parse SELECT with ORDER BY', () => {
      const result = parseSelectStatement('SELECT * FROM users ORDER BY created_at DESC');

      expect(result).not.toBeNull();
      expect(result?.orderBy).toBe('created_at DESC');
    });

    it('should parse SELECT with LIMIT', () => {
      const result = parseSelectStatement('SELECT * FROM users LIMIT 10');

      expect(result).not.toBeNull();
      expect(result?.limit).toBe(10);
    });

    it('should parse SELECT with all clauses', () => {
      const sql = `
        SELECT category, COUNT(*) as cnt
        FROM products
        WHERE active = 1
        GROUP BY category
        HAVING cnt > 5
        ORDER BY cnt DESC
        LIMIT 10
      `;
      const result = parseSelectStatement(sql);

      expect(result).not.toBeNull();
      expect(result?.tableName).toBe('products');
      expect(result?.whereClause).toBe('active = 1');
      expect(result?.groupBy).toEqual(['category']);
      expect(result?.having).toBe('cnt > 5');
      expect(result?.orderBy).toBe('cnt DESC');
      expect(result?.limit).toBe(10);
    });

    it('should return null for non-SELECT statements', () => {
      expect(parseSelectStatement('INSERT INTO users VALUES (1)')).toBeNull();
      expect(parseSelectStatement('CREATE TABLE users (id Int64)')).toBeNull();
    });
  });

  describe('parseCreateTableStatement', () => {
    it('should parse simple CREATE TABLE', () => {
      const sql = 'CREATE TABLE users (id Int64, name String) ENGINE = MergeTree() ORDER BY (id)';
      const result = parseCreateTableStatement(sql);

      expect(result).not.toBeNull();
      expect(result?.tableName).toBe('users');
      expect(result?.columns).toHaveLength(2);
      expect(result?.columns[0]).toEqual({ name: 'id', type: 'Int64' });
      expect(result?.columns[1]).toEqual({ name: 'name', type: 'String' });
      expect(result?.engine).toBe('MergeTree');
      expect(result?.orderBy).toEqual(['id']);
    });

    it('should parse CREATE TABLE IF NOT EXISTS', () => {
      const sql = 'CREATE TABLE IF NOT EXISTS mydb.users (id Int64) ENGINE = Memory()';
      const result = parseCreateTableStatement(sql);

      expect(result).not.toBeNull();
      expect(result?.database).toBe('mydb');
      expect(result?.tableName).toBe('users');
      expect(result?.engine).toBe('Memory');
    });

    it('should return null for non-CREATE TABLE statements', () => {
      expect(parseCreateTableStatement('SELECT 1')).toBeNull();
    });
  });

  describe('parseInsertStatement', () => {
    it('should parse simple INSERT', () => {
      const sql = "INSERT INTO users VALUES (1, 'Alice')";
      const result = parseInsertStatement(sql);

      expect(result).not.toBeNull();
      expect(result?.tableName).toBe('users');
      expect(result?.values).toHaveLength(1);
      expect(result?.values[0]).toEqual([1, 'Alice']);
    });

    it('should parse INSERT with column list', () => {
      const sql = "INSERT INTO users (id, name) VALUES (1, 'Alice')";
      const result = parseInsertStatement(sql);

      expect(result).not.toBeNull();
      expect(result?.columns).toEqual(['id', 'name']);
    });

    it('should parse INSERT with multiple rows', () => {
      const sql = "INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob')";
      const result = parseInsertStatement(sql);

      expect(result).not.toBeNull();
      expect(result?.values).toHaveLength(2);
      expect(result?.values[0]).toEqual([1, 'Alice']);
      expect(result?.values[1]).toEqual([2, 'Bob']);
    });

    it('should parse INSERT with database prefix', () => {
      const sql = "INSERT INTO mydb.users VALUES (1)";
      const result = parseInsertStatement(sql);

      expect(result).not.toBeNull();
      expect(result?.database).toBe('mydb');
      expect(result?.tableName).toBe('users');
    });

    it('should return null for non-INSERT statements', () => {
      expect(parseInsertStatement('SELECT 1')).toBeNull();
    });
  });

  describe('parseSelectExpressions', () => {
    it('should parse simple column list', () => {
      const result = parseSelectExpressions('id, name, email');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ expression: 'id', alias: null });
      expect(result[1]).toEqual({ expression: 'name', alias: null });
      expect(result[2]).toEqual({ expression: 'email', alias: null });
    });

    it('should parse expressions with aliases', () => {
      const result = parseSelectExpressions('id, name AS user_name, COUNT(*) AS total');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ expression: 'id', alias: null });
      expect(result[1]).toEqual({ expression: 'name', alias: 'user_name' });
      expect(result[2]).toEqual({ expression: 'COUNT(*)', alias: 'total' });
    });

    it('should handle nested function calls', () => {
      const result = parseSelectExpressions('CONCAT(first_name, last_name) AS full_name, id');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ expression: 'CONCAT(first_name, last_name)', alias: 'full_name' });
    });

    it('should handle case-insensitive AS keyword', () => {
      const result = parseSelectExpressions('id as identifier, name As username');

      expect(result).toHaveLength(2);
      expect(result[0].alias).toBe('identifier');
      expect(result[1].alias).toBe('username');
    });

    it('should handle complex expressions with commas in parentheses', () => {
      const result = parseSelectExpressions('COALESCE(a, b, c), IF(x > 0, 1, 0) AS flag');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ expression: 'COALESCE(a, b, c)', alias: null });
      expect(result[1]).toEqual({ expression: 'IF(x > 0, 1, 0)', alias: 'flag' });
    });
  });

  describe('parseTableFunctionArgs', () => {
    it('should parse s3() function arguments', () => {
      const sql = "SELECT * FROM s3('https://bucket.s3.amazonaws.com/data.parquet', 'key', 'secret')";
      const result = parseTableFunctionArgs(sql, 's3');

      expect(result.args).toHaveLength(3);
      expect(result.args[0]).toBe("'https://bucket.s3.amazonaws.com/data.parquet'");
    });

    it('should parse url() function arguments', () => {
      const sql = "SELECT * FROM url('https://example.com/data.json', JSONEachRow)";
      const result = parseTableFunctionArgs(sql, 'url');

      expect(result.args).toHaveLength(2);
      expect(result.args[0]).toBe("'https://example.com/data.json'");
      expect(result.args[1]).toBe('JSONEachRow');
    });

    it('should parse numbers() function', () => {
      const sql = 'SELECT number FROM numbers(100)';
      const result = parseTableFunctionArgs(sql, 'numbers');

      expect(result.args).toHaveLength(1);
      expect(result.args[0]).toBe('100');
    });

    it('should extract inner SQL query from table function', () => {
      const sql = "SELECT * FROM pglite('SELECT id, name FROM users WHERE active = true')";
      const result = parseTableFunctionArgs(sql, 'pglite');

      expect(result.innerQuery).toBe('SELECT id, name FROM users WHERE active = true');
    });

    it('should handle nested parentheses', () => {
      const sql = "SELECT * FROM turso('connection', 'SELECT COUNT(*) FROM (SELECT * FROM users)')";
      const result = parseTableFunctionArgs(sql, 'turso');

      expect(result.args).toHaveLength(2);
      expect(result.innerQuery).toContain('SELECT COUNT(*)');
    });

    it('should handle escaped quotes in arguments', () => {
      const sql = "SELECT * FROM pglite('SELECT ''escaped'' FROM users')";
      const result = parseTableFunctionArgs(sql, 'pglite');

      expect(result.innerQuery).toBe("SELECT 'escaped' FROM users");
    });

    it('should return empty result for non-matching function', () => {
      const sql = 'SELECT * FROM users';
      const result = parseTableFunctionArgs(sql, 'pglite');

      expect(result.args).toHaveLength(0);
      expect(result.innerQuery).toBeNull();
    });
  });

  describe('parseWhereClause', () => {
    it('should extract simple WHERE clause', () => {
      const result = parseWhereClause('SELECT * FROM users WHERE id = 1');

      expect(result).toBe('id = 1');
    });

    it('should extract WHERE clause with multiple conditions', () => {
      const result = parseWhereClause('SELECT * FROM users WHERE id > 5 AND active = true');

      expect(result).toBe('id > 5 AND active = true');
    });

    it('should stop at GROUP BY', () => {
      const result = parseWhereClause('SELECT * FROM users WHERE id > 5 GROUP BY category');

      expect(result).toBe('id > 5');
    });

    it('should stop at ORDER BY', () => {
      const result = parseWhereClause('SELECT * FROM users WHERE id > 5 ORDER BY name');

      expect(result).toBe('id > 5');
    });

    it('should stop at LIMIT', () => {
      const result = parseWhereClause('SELECT * FROM users WHERE id > 5 LIMIT 10');

      expect(result).toBe('id > 5');
    });

    it('should return null for query without WHERE', () => {
      const result = parseWhereClause('SELECT * FROM users');

      expect(result).toBeNull();
    });
  });

  describe('parseGroupByClause', () => {
    it('should parse single column GROUP BY', () => {
      const result = parseGroupByClause('SELECT * FROM users GROUP BY category');

      expect(result).toEqual(['category']);
    });

    it('should parse multiple column GROUP BY', () => {
      const result = parseGroupByClause('SELECT * FROM users GROUP BY category, status');

      expect(result).toEqual(['category', 'status']);
    });

    it('should stop at HAVING', () => {
      const result = parseGroupByClause('SELECT * FROM users GROUP BY category HAVING COUNT(*) > 5');

      expect(result).toEqual(['category']);
    });

    it('should stop at ORDER BY', () => {
      const result = parseGroupByClause('SELECT * FROM users GROUP BY category ORDER BY category');

      expect(result).toEqual(['category']);
    });

    it('should return null for query without GROUP BY', () => {
      const result = parseGroupByClause('SELECT * FROM users');

      expect(result).toBeNull();
    });
  });

  describe('parseOrderByClause', () => {
    it('should parse simple ORDER BY', () => {
      const result = parseOrderByClause('SELECT * FROM users ORDER BY name');

      expect(result).toBe('name');
    });

    it('should parse ORDER BY with direction', () => {
      const result = parseOrderByClause('SELECT * FROM users ORDER BY name DESC');

      expect(result).toBe('name DESC');
    });

    it('should parse ORDER BY with multiple columns', () => {
      const result = parseOrderByClause('SELECT * FROM users ORDER BY category ASC, name DESC');

      expect(result).toBe('category ASC, name DESC');
    });

    it('should stop at LIMIT', () => {
      const result = parseOrderByClause('SELECT * FROM users ORDER BY name LIMIT 10');

      expect(result).toBe('name');
    });

    it('should return null for query without ORDER BY', () => {
      const result = parseOrderByClause('SELECT * FROM users');

      expect(result).toBeNull();
    });
  });

  describe('parseLimitOffset', () => {
    it('should parse simple LIMIT', () => {
      const result = parseLimitOffset('SELECT * FROM users LIMIT 10');

      expect(result).toEqual({ limit: 10, offset: null });
    });

    it('should parse LIMIT with OFFSET', () => {
      const result = parseLimitOffset('SELECT * FROM users LIMIT 10 OFFSET 20');

      expect(result).toEqual({ limit: 10, offset: 20 });
    });

    it('should parse LIMIT n, m syntax', () => {
      const result = parseLimitOffset('SELECT * FROM users LIMIT 20, 10');

      expect(result).toEqual({ limit: 10, offset: 20 });
    });

    it('should return null values for query without LIMIT', () => {
      const result = parseLimitOffset('SELECT * FROM users');

      expect(result).toEqual({ limit: null, offset: null });
    });
  });

  describe('parseValue', () => {
    it('should parse string values', () => {
      expect(parseValue("'hello'")).toBe('hello');
      expect(parseValue('"world"')).toBe('world');
    });

    it('should parse escaped quotes', () => {
      expect(parseValue("'it''s a test'")).toBe("it's a test");
      expect(parseValue('"say ""hello"""')).toBe('say "hello"');
    });

    it('should parse integer values', () => {
      expect(parseValue('42')).toBe(42);
      expect(parseValue('-10')).toBe(-10);
    });

    it('should parse float values', () => {
      expect(parseValue('3.14')).toBe(3.14);
      expect(parseValue('-0.5')).toBe(-0.5);
    });

    it('should parse NULL', () => {
      expect(parseValue('NULL')).toBeNull();
      expect(parseValue('null')).toBeNull();
    });

    it('should parse boolean values', () => {
      expect(parseValue('true')).toBe(true);
      expect(parseValue('false')).toBe(false);
      expect(parseValue('TRUE')).toBe(true);
      expect(parseValue('FALSE')).toBe(false);
    });
  });

  describe('parseCommaSeparatedArgs', () => {
    it('should split simple arguments', () => {
      const result = parseCommaSeparatedArgs('a, b, c');

      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should respect parentheses', () => {
      const result = parseCommaSeparatedArgs('CONCAT(a, b), c, d');

      expect(result).toEqual(['CONCAT(a, b)', 'c', 'd']);
    });

    it('should handle nested parentheses', () => {
      const result = parseCommaSeparatedArgs('COALESCE(NULLIF(a, b), c), d');

      expect(result).toEqual(['COALESCE(NULLIF(a, b), c)', 'd']);
    });

    it('should handle empty string', () => {
      const result = parseCommaSeparatedArgs('');

      expect(result).toEqual([]);
    });
  });

  describe('splitByCommaRespectingParentheses', () => {
    it('should split simple comma-separated values', () => {
      const result = splitByCommaRespectingParentheses('a, b, c');

      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should keep parenthesized content together', () => {
      const result = splitByCommaRespectingParentheses('func(a, b), c');

      expect(result).toEqual(['func(a, b)', 'c']);
    });

    it('should handle string literals with commas', () => {
      const result = splitByCommaRespectingParentheses("'a, b', c");

      expect(result).toEqual(["'a, b'", 'c']);
    });

    it('should handle nested structures', () => {
      const result = splitByCommaRespectingParentheses('outer(inner(a, b), c), d');

      expect(result).toEqual(['outer(inner(a, b), c)', 'd']);
    });
  });
});
