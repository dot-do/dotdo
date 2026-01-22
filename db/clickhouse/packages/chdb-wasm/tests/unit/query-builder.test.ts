/**
 * Document Query Builder Tests
 *
 * Tests for the DocumentQueryBuilder class that converts
 * MongoDB-style queries to ClickHouse SQL.
 */

import { describe, it, expect } from 'vitest';
import { DocumentQueryBuilder } from '../../src/query-builder';

describe('DocumentQueryBuilder', () => {
  describe('Basic SELECT queries', () => {
    it('should build a simple SELECT * query', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.build();

      expect(sql).toBe('SELECT * FROM `default`.`users` FINAL');
    });

    it('should support custom database', () => {
      const builder = new DocumentQueryBuilder({
        collection: 'orders',
        database: 'mydb',
      });
      const sql = builder.build();

      expect(sql).toBe('SELECT * FROM `mydb`.`orders` FINAL');
    });

    it('should allow disabling FINAL keyword', () => {
      const builder = new DocumentQueryBuilder({
        collection: 'products',
        useFinal: false,
      });
      const sql = builder.build();

      expect(sql).toBe('SELECT * FROM `default`.`products`');
    });
  });

  describe('WHERE conditions with filter()', () => {
    it('should build equality conditions', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ status: 'active' }).build();

      expect(sql).toContain("WHERE JSONExtractRaw(data, 'status') = 'active'");
    });

    it('should handle known columns directly', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.whereId('abc123').build();

      expect(sql).toContain("WHERE id = 'abc123'");
    });

    it('should build $eq operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ age: { $eq: 25 } }).build();

      expect(sql).toContain("WHERE JSONExtractRaw(data, 'age') = 25");
    });

    it('should build $ne operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ status: { $ne: 'deleted' } }).build();

      expect(sql).toContain("WHERE JSONExtractRaw(data, 'status') != 'deleted'");
    });

    it('should build $gt operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'products' });
      const sql = builder.filter({ price: { $gt: 100 } }).build();

      expect(sql).toContain("WHERE JSONExtractRaw(data, 'price') > 100");
    });

    it('should build $gte operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'products' });
      const sql = builder.filter({ quantity: { $gte: 10 } }).build();

      expect(sql).toContain("WHERE JSONExtractRaw(data, 'quantity') >= 10");
    });

    it('should build $lt operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'products' });
      const sql = builder.filter({ price: { $lt: 50 } }).build();

      expect(sql).toContain("WHERE JSONExtractRaw(data, 'price') < 50");
    });

    it('should build $lte operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'products' });
      const sql = builder.filter({ stock: { $lte: 5 } }).build();

      expect(sql).toContain("WHERE JSONExtractRaw(data, 'stock') <= 5");
    });

    it('should build $in operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'orders' });
      const sql = builder.filter({ status: { $in: ['pending', 'processing'] } }).build();

      expect(sql).toContain("IN ('pending', 'processing')");
    });

    it('should build $nin operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'orders' });
      const sql = builder.filter({ status: { $nin: ['cancelled', 'refunded'] } }).build();

      expect(sql).toContain("NOT IN ('cancelled', 'refunded')");
    });

    it('should build $exists operator (true)', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ email: { $exists: true } }).build();

      expect(sql).toContain("JSONExtractRaw(data, 'email') IS NOT NULL");
    });

    it('should build $exists operator (false)', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ deletedAt: { $exists: false } }).build();

      expect(sql).toContain("JSONExtractRaw(data, 'deletedAt') IS NULL");
    });

    it('should build $regex operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ email: { $regex: '@example\\.com$' } }).build();

      // The backslash gets escaped in SQL
      expect(sql).toContain("match(JSONExtractRaw(data, 'email'), '@example");
      expect(sql).toContain(".com$')");
    });

    it('should combine multiple operators on same field', () => {
      const builder = new DocumentQueryBuilder({ collection: 'products' });
      const sql = builder.filter({ price: { $gte: 10, $lte: 100 } }).build();

      expect(sql).toContain('>= 10');
      expect(sql).toContain('<= 100');
      expect(sql).toContain('AND');
    });
  });

  describe('Logical operators', () => {
    it('should build $and operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder
        .filter({
          $and: [
            { status: 'active' },
            { age: { $gte: 18 } },
          ],
        })
        .build();

      expect(sql).toContain('AND');
      expect(sql).toContain("'active'");
      expect(sql).toContain('>= 18');
    });

    it('should build $or operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'products' });
      const sql = builder
        .filter({
          $or: [
            { category: 'electronics' },
            { category: 'computers' },
          ],
        })
        .build();

      expect(sql).toContain('OR');
      expect(sql).toContain("'electronics'");
      expect(sql).toContain("'computers'");
    });

    it('should build $not operator', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder
        .filter({
          $not: { status: 'deleted' },
        })
        .build();

      expect(sql).toContain('NOT');
      expect(sql).toContain("'deleted'");
    });

    it('should handle nested logical operators', () => {
      const builder = new DocumentQueryBuilder({ collection: 'orders' });
      const sql = builder
        .filter({
          $and: [
            { status: 'completed' },
            {
              $or: [
                { total: { $gt: 100 } },
                { isPriority: true },
              ],
            },
          ],
        })
        .build();

      expect(sql).toContain('AND');
      expect(sql).toContain('OR');
      expect(sql).toContain("'completed'");
      expect(sql).toContain('> 100');
    });
  });

  describe('Nested fields', () => {
    it('should handle dot notation for nested fields', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ 'address.city': 'New York' }).build();

      expect(sql).toContain("JSONExtractRaw(data, 'address', 'city')");
      expect(sql).toContain("'New York'");
    });

    it('should handle deeply nested fields', () => {
      const builder = new DocumentQueryBuilder({ collection: 'orders' });
      const sql = builder.filter({ 'shipping.address.zipcode': '10001' }).build();

      expect(sql).toContain("JSONExtractRaw(data, 'shipping', 'address', 'zipcode')");
    });
  });

  describe('ORDER BY', () => {
    it('should build ORDER BY with ASC', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.orderBy('name', 'ASC').build();

      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('ASC');
    });

    it('should build ORDER BY with DESC', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.orderBy('createdAt', 'DESC').build();

      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('DESC');
    });

    it('should support numeric direction (1 for ASC)', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.orderBy('name', 1).build();

      expect(sql).toContain('ASC');
    });

    it('should support numeric direction (-1 for DESC)', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.orderBy('score', -1).build();

      expect(sql).toContain('DESC');
    });

    it('should support multiple ORDER BY clauses', () => {
      const builder = new DocumentQueryBuilder({ collection: 'products' });
      const sql = builder.orderBy('category', 'ASC').orderBy('price', 'DESC').build();

      expect(sql).toMatch(/ORDER BY.*ASC.*DESC/);
    });
  });

  describe('LIMIT and OFFSET', () => {
    it('should build LIMIT clause', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.limit(10).build();

      expect(sql).toContain('LIMIT 10');
    });

    it('should build OFFSET clause', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.offset(20).build();

      expect(sql).toContain('OFFSET 20');
    });

    it('should build both LIMIT and OFFSET', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.limit(10).offset(20).build();

      expect(sql).toContain('LIMIT 10');
      expect(sql).toContain('OFFSET 20');
    });

    it('should support skip() as alias for offset()', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.skip(5).build();

      expect(sql).toContain('OFFSET 5');
    });
  });

  describe('Field selection', () => {
    it('should support selecting specific fields', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.select('name', 'email').build();

      expect(sql).toContain("JSONExtractRaw(data, 'name')");
      expect(sql).toContain("JSONExtractRaw(data, 'email')");
      expect(sql).not.toContain('SELECT *');
    });

    it('should support selecting * explicitly', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.select('*').build();

      expect(sql).toContain('SELECT *');
    });
  });

  describe('notDeleted()', () => {
    it('should add _deleted = 0 condition', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.notDeleted().build();

      expect(sql).toContain('_deleted = 0');
    });
  });

  describe('INSERT operations', () => {
    it('should build INSERT query with auto-generated ID', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.buildInsert({ name: 'Alice', email: 'alice@example.com' });

      expect(sql).toContain('INSERT INTO `default`.`users`');
      expect(sql).toContain('FORMAT JSONEachRow');
      // The data is stored as a JSON string in the data column
      expect(sql).toContain('\\"name\\":\\"Alice\\"');
      expect(sql).toContain('\\"email\\":\\"alice@example.com\\"');
    });

    it('should build INSERT query with custom ID', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.buildInsert({ name: 'Bob' }, { id: 'custom-id-123' });

      expect(sql).toContain('"id":"custom-id-123"');
    });
  });

  describe('UPSERT operations', () => {
    it('should build upsert query with version', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.buildUpsert('user-123', { name: 'Updated Name' });

      expect(sql).toContain('INSERT INTO `default`.`users`');
      expect(sql).toContain('"id":"user-123"');
      expect(sql).toContain('"_version":');
      expect(sql).toContain('"data":"{\\"name\\":\\"Updated Name\\"}"');
    });
  });

  describe('Soft delete operations', () => {
    it('should build soft delete query', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.buildSoftDelete('user-123');

      expect(sql).toContain('INSERT INTO `default`.`users`');
      expect(sql).toContain('"id":"user-123"');
      expect(sql).toContain('"_deleted":1');
      expect(sql).toContain('"_version":');
    });
  });

  describe('Count queries', () => {
    it('should build count query', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.buildCount();

      expect(sql).toContain('SELECT count() as count');
      expect(sql).toContain('FROM `default`.`users` FINAL');
    });

    it('should build count query with filters', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ status: 'active' }).buildCount();

      expect(sql).toContain('SELECT count() as count');
      expect(sql).toContain("WHERE JSONExtractRaw(data, 'status') = 'active'");
    });
  });

  describe('Method chaining', () => {
    it('should support full method chaining', () => {
      const builder = new DocumentQueryBuilder({ collection: 'orders' });
      const sql = builder
        .filter({ status: 'pending' })
        .notDeleted()
        .orderBy('createdAt', 'DESC')
        .limit(10)
        .skip(0)
        .build();

      expect(sql).toContain("WHERE JSONExtractRaw(data, 'status') = 'pending'");
      expect(sql).toContain('_deleted = 0');
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('DESC');
      expect(sql).toContain('LIMIT 10');
      expect(sql).toContain('OFFSET 0');
    });
  });

  describe('SQL escaping', () => {
    it('should escape single quotes in string values', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ name: "O'Connor" }).build();

      expect(sql).toContain("O''Connor");
    });

    it('should escape backticks in identifiers', () => {
      const builder = new DocumentQueryBuilder({
        collection: 'my`table',
        database: 'my`db',
      });
      const sql = builder.build();

      expect(sql).toContain('`my``table`');
      expect(sql).toContain('`my``db`');
    });

    it('should escape backslashes in string values', () => {
      const builder = new DocumentQueryBuilder({ collection: 'paths' });
      const sql = builder.filter({ path: 'C:\\Users\\test' }).build();

      expect(sql).toContain('\\\\');
    });
  });

  describe('Boolean values', () => {
    it('should convert true to 1', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ isActive: true }).build();

      expect(sql).toContain('= 1');
    });

    it('should convert false to 0', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ isDeleted: false }).build();

      expect(sql).toContain('= 0');
    });
  });

  describe('Null values', () => {
    it('should handle null values', () => {
      const builder = new DocumentQueryBuilder({ collection: 'users' });
      const sql = builder.filter({ deletedAt: null }).build();

      expect(sql).toContain('= NULL');
    });
  });

  describe('Date values', () => {
    it('should convert Date objects to DateTime64', () => {
      const builder = new DocumentQueryBuilder({ collection: 'events' });
      const date = new Date('2024-01-15T10:30:00.000Z');
      const sql = builder.filter({ eventDate: date }).build();

      expect(sql).toContain("toDateTime64('2024-01-15T10:30:00.000Z', 3)");
    });
  });
});
