/**
 * SQL Injection Prevention Tests (do-2a0j, do-xdq7)
 *
 * Tests to verify that field names and table names are properly validated/whitelisted
 * to prevent SQL injection attacks via malicious field names or table names.
 *
 * Security measures tested:
 * 1. Field name validation in QueryBuilder methods (where, whereOp, orderBy, select)
 * 2. Field name validation in buildWhereClause and buildOrderByClause
 * 3. Table name validation in SQLiteStorageAdapter
 * 4. Parameterized queries for values
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createThingsStore, type ThingsStore } from '../things'
import {
  query,
  buildWhereClause,
  buildOrderByClause,
  configureQueryLimits,
  type QueryOptions,
} from '../query'
import { DbValidationError } from '../errors'
import { SQLiteStorageAdapter } from '../adapters/sqlite'
import type { SqlStorage } from '../sqlite'

describe('SQL Injection Prevention (do-2a0j)', () => {
  let store: ThingsStore

  beforeEach(async () => {
    store = createThingsStore()
    // Use warn mode for tests to avoid limit-related failures
    configureQueryLimits({ mode: 'warn' })

    // Seed test data
    await store.create({ $type: 'User', name: 'Alice', role: 'admin' })
    await store.create({ $type: 'User', name: 'Bob', role: 'user' })
  })

  afterEach(() => {
    configureQueryLimits({ mode: 'strict' })
  })

  describe('QueryBuilder field validation', () => {
    describe('where()', () => {
      it('should reject field names with SQL injection attempts', () => {
        expect(() => {
          query(store).type('User').where("name'; DROP TABLE things; --", 'test')
        }).toThrow(DbValidationError)
      })

      it('should reject field names with semicolons', () => {
        expect(() => {
          query(store).type('User').where('name;', 'test')
        }).toThrow(DbValidationError)
      })

      it('should reject field names with quotes', () => {
        expect(() => {
          query(store).type('User').where("name'", 'test')
        }).toThrow(DbValidationError)
      })

      it('should reject field names with double quotes', () => {
        expect(() => {
          query(store).type('User').where('name"', 'test')
        }).toThrow(DbValidationError)
      })

      it('should reject field names with parentheses', () => {
        expect(() => {
          query(store).type('User').where('name()', 'test')
        }).toThrow(DbValidationError)
      })

      it('should reject field names with dashes', () => {
        expect(() => {
          query(store).type('User').where('name--', 'test')
        }).toThrow(DbValidationError)
      })

      it('should reject field names with spaces', () => {
        expect(() => {
          query(store).type('User').where('name OR 1=1', 'test')
        }).toThrow(DbValidationError)
      })

      it('should reject field names starting with numbers', () => {
        expect(() => {
          query(store).type('User').where('1name', 'test')
        }).toThrow(DbValidationError)
      })

      it('should accept valid field names with underscores', () => {
        expect(() => {
          query(store).type('User').where('first_name', 'Alice')
        }).not.toThrow()
      })

      it('should accept valid field names starting with $', () => {
        expect(() => {
          query(store).type('User').where('$type', 'User')
        }).not.toThrow()
      })

      it('should accept valid camelCase field names', () => {
        expect(() => {
          query(store).type('User').where('firstName', 'Alice')
        }).not.toThrow()
      })

      it('should validate all fields in object conditions', () => {
        expect(() => {
          query(store).type('User').where({
            name: 'Alice',
            "role'; DROP TABLE things; --": 'admin'
          })
        }).toThrow(DbValidationError)
      })
    })

    describe('whereOp()', () => {
      it('should reject SQL injection in field names', () => {
        expect(() => {
          query(store).type('User').whereOp("1=1; --", '=', 'test')
        }).toThrow(DbValidationError)
      })

      it('should reject UNION injection in field names', () => {
        expect(() => {
          query(store).type('User').whereOp("name UNION SELECT * FROM sqlite_master", '=', 'test')
        }).toThrow(DbValidationError)
      })
    })

    describe('orderBy()', () => {
      it('should reject SQL injection in order field', () => {
        expect(() => {
          query(store).type('User').orderBy("name; DROP TABLE things; --")
        }).toThrow(DbValidationError)
      })

      it('should reject injection with ORDER BY manipulation', () => {
        expect(() => {
          query(store).type('User').orderBy("name DESC, (SELECT password FROM users)")
        }).toThrow(DbValidationError)
      })
    })

    describe('select()', () => {
      it('should reject SQL injection in select fields', () => {
        expect(() => {
          query(store).type('User').select("name, (SELECT password FROM users) as pwd")
        }).toThrow(DbValidationError)
      })

      it('should validate all select fields', () => {
        expect(() => {
          query(store).type('User').select('name', 'role; --', 'email')
        }).toThrow(DbValidationError)
      })
    })
  })

  describe('buildWhereClause field validation', () => {
    it('should reject field names with SQL injection in whereConditions', () => {
      const options: QueryOptions = {
        whereConditions: [
          { field: "name'; DROP TABLE things; --", operator: '=', value: 'test' }
        ]
      }

      expect(() => buildWhereClause(options)).toThrow(DbValidationError)
    })

    it('should reject field names with semicolons', () => {
      const options: QueryOptions = {
        whereConditions: [
          { field: 'name;', operator: '=', value: 'test' }
        ]
      }

      expect(() => buildWhereClause(options)).toThrow(DbValidationError)
    })

    it('should reject field names with parentheses', () => {
      const options: QueryOptions = {
        whereConditions: [
          { field: 'name()', operator: '=', value: 'test' }
        ]
      }

      expect(() => buildWhereClause(options)).toThrow(DbValidationError)
    })

    it('should reject field names with spaces (OR 1=1 attack)', () => {
      const options: QueryOptions = {
        whereConditions: [
          { field: 'name OR 1=1', operator: '=', value: 'test' }
        ]
      }

      expect(() => buildWhereClause(options)).toThrow(DbValidationError)
    })

    it('should reject field names with UNION keyword', () => {
      const options: QueryOptions = {
        whereConditions: [
          { field: 'name UNION SELECT', operator: '=', value: 'test' }
        ]
      }

      expect(() => buildWhereClause(options)).toThrow(DbValidationError)
    })

    it('should accept valid field names in whereConditions', () => {
      const options: QueryOptions = {
        whereConditions: [
          { field: 'name', operator: '=', value: 'Alice' },
          { field: 'user_role', operator: '=', value: 'admin' },
          { field: '$type', operator: '=', value: 'User' }
        ]
      }

      expect(() => buildWhereClause(options)).not.toThrow()
    })

    it('should validate all conditions in whereConditions array', () => {
      const options: QueryOptions = {
        whereConditions: [
          { field: 'name', operator: '=', value: 'Alice' },
          { field: "role'; --", operator: '=', value: 'admin' }
        ]
      }

      expect(() => buildWhereClause(options)).toThrow(DbValidationError)
    })
  })

  describe('buildOrderByClause field validation', () => {
    it('should reject SQL injection in orderBy field', () => {
      const options: QueryOptions = {
        orderBy: "name; DROP TABLE things; --"
      }

      expect(() => buildOrderByClause(options)).toThrow(DbValidationError)
    })

    it('should reject subquery injection in orderBy', () => {
      const options: QueryOptions = {
        orderBy: "name, (SELECT password FROM users)"
      }

      expect(() => buildOrderByClause(options)).toThrow(DbValidationError)
    })

    it('should reject comment injection in orderBy', () => {
      const options: QueryOptions = {
        orderBy: "name --"
      }

      expect(() => buildOrderByClause(options)).toThrow(DbValidationError)
    })

    it('should accept valid orderBy field names', () => {
      const options1: QueryOptions = { orderBy: 'name' }
      const options2: QueryOptions = { orderBy: 'created_at' }
      const options3: QueryOptions = { orderBy: '$updatedAt' }

      expect(() => buildOrderByClause(options1)).not.toThrow()
      expect(() => buildOrderByClause(options2)).not.toThrow()
      expect(() => buildOrderByClause(options3)).not.toThrow()
    })

    it('should return default clause when no orderBy specified', () => {
      const options: QueryOptions = {}
      const clause = buildOrderByClause(options)

      expect(clause).toBe('ORDER BY created_at DESC')
    })
  })

  describe('Value parameterization (existing protection)', () => {
    it('should safely handle SQL injection in VALUES (parameterized)', async () => {
      // Values are parameterized, so injection attempts should be treated as literal strings
      const users = await query(store)
        .type('User')
        .where('name', "'; DROP TABLE things; --")
        .execute()

      // Should return empty results (no user with that literal name)
      expect(users).toHaveLength(0)
    })

    it('should preserve data integrity after injection attempts', async () => {
      // Attempt injection via value
      await query(store)
        .type('User')
        .where('name', "'; DROP TABLE things; --")
        .execute()

      // Verify data is still intact
      const allUsers = await query(store).type('User').execute()
      expect(allUsers).toHaveLength(2)
      expect(allUsers.map(u => u.name).sort()).toEqual(['Alice', 'Bob'])
    })
  })

  describe('Edge cases', () => {
    it('should allow underscore-only field names', () => {
      expect(() => {
        query(store).type('User').where('_private', 'value')
      }).not.toThrow()
    })

    it('should allow fields starting with underscore', () => {
      expect(() => {
        query(store).type('User').where('_id', 'value')
      }).not.toThrow()
    })

    it('should allow fields with numbers (not at start)', () => {
      expect(() => {
        query(store).type('User').where('field123', 'value')
      }).not.toThrow()
    })

    it('should allow PascalCase field names', () => {
      expect(() => {
        query(store).type('User').where('UserName', 'value')
      }).not.toThrow()
    })

    it('should allow snake_case field names', () => {
      expect(() => {
        query(store).type('User').where('user_name', 'value')
      }).not.toThrow()
    })

    it('should reject empty field names', () => {
      expect(() => {
        query(store).type('User').where('', 'value')
      }).toThrow(DbValidationError)
    })

    it('should reject field names with only special characters', () => {
      expect(() => {
        query(store).type('User').where('---', 'value')
      }).toThrow(DbValidationError)
    })

    it('should reject field names with backticks', () => {
      expect(() => {
        query(store).type('User').where('`name`', 'value')
      }).toThrow(DbValidationError)
    })

    it('should reject field names with brackets', () => {
      expect(() => {
        query(store).type('User').where('[name]', 'value')
      }).toThrow(DbValidationError)
    })
  })
})

describe('SQLiteStorageAdapter table name validation (do-xdq7)', () => {
  /**
   * Create a mock SqlStorage for testing
   */
  function createMockSqlStorage(): SqlStorage {
    return {
      exec: () => ({ results: [] }),
      prepare: () => ({
        bind: () => ({
          first: () => null,
          all: () => ({ results: [] }),
          run: () => ({ meta: { changes: 0 } })
        })
      })
    }
  }

  describe('table name injection prevention', () => {
    it('should accept valid table names', () => {
      const sql = createMockSqlStorage()

      // Valid table names should not throw
      expect(() => new SQLiteStorageAdapter(sql, { tableName: 'kv_store' })).not.toThrow()
      expect(() => new SQLiteStorageAdapter(sql, { tableName: 'my_table' })).not.toThrow()
      expect(() => new SQLiteStorageAdapter(sql, { tableName: 'Table123' })).not.toThrow()
      expect(() => new SQLiteStorageAdapter(sql, { tableName: '_private' })).not.toThrow()
      expect(() => new SQLiteStorageAdapter(sql, { tableName: 'A' })).not.toThrow()
    })

    it('should reject table names with SQL injection attempts', () => {
      const sql = createMockSqlStorage()

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: "users; DROP TABLE things; --" })
      }).toThrow(/Invalid table name/)
    })

    it('should reject table names with semicolons', () => {
      const sql = createMockSqlStorage()

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: "table;" })
      }).toThrow(/Invalid table name/)
    })

    it('should reject table names with quotes', () => {
      const sql = createMockSqlStorage()

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: "table'" })
      }).toThrow(/Invalid table name/)

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: 'table"' })
      }).toThrow(/Invalid table name/)
    })

    it('should reject table names with parentheses', () => {
      const sql = createMockSqlStorage()

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: "table()" })
      }).toThrow(/Invalid table name/)
    })

    it('should reject table names with spaces', () => {
      const sql = createMockSqlStorage()

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: "table name" })
      }).toThrow(/Invalid table name/)
    })

    it('should reject table names starting with numbers', () => {
      const sql = createMockSqlStorage()

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: "123table" })
      }).toThrow(/Invalid table name/)
    })

    it('should reject table names with dashes', () => {
      const sql = createMockSqlStorage()

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: "my-table" })
      }).toThrow(/Invalid table name/)
    })

    it('should reject table names with UNION injection', () => {
      const sql = createMockSqlStorage()

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: "users UNION SELECT * FROM secrets" })
      }).toThrow(/Invalid table name/)
    })

    it('should reject excessively long table names', () => {
      const sql = createMockSqlStorage()
      const longName = 'a'.repeat(129)

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: longName })
      }).toThrow(/Table name too long/)
    })

    it('should accept table names at maximum length (128 chars)', () => {
      const sql = createMockSqlStorage()
      const maxLengthName = 'a'.repeat(128)

      expect(() => {
        new SQLiteStorageAdapter(sql, { tableName: maxLengthName })
      }).not.toThrow()
    })
  })
})
