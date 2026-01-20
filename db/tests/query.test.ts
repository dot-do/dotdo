import { describe, it, expect, beforeEach } from 'vitest'
import { createThingsStore, type ThingsStore } from '../things'
import { query, createQuery, WhereOperator, buildWhereClause, type QueryOptions } from '../query'

describe('Query Interface', () => {
  let store: ThingsStore

  beforeEach(async () => {
    store = createThingsStore()

    // Seed test data
    await store.create({ $type: 'User', name: 'Alice', age: 30, role: 'admin', email: 'alice@example.com' })
    await store.create({ $type: 'User', name: 'Bob', age: 25, role: 'user', email: 'bob@test.org' })
    await store.create({ $type: 'User', name: 'Charlie', age: 35, role: 'user', email: null })
    await store.create({ $type: 'Order', total: 100, status: 'pending' })
    await store.create({ $type: 'Order', total: 200, status: 'completed' })
  })

  describe('type()', () => {
    it('should filter by $type', async () => {
      const users = await query(store).type('User').execute()
      expect(users).toHaveLength(3)
      expect(users.every(u => u.$type === 'User')).toBe(true)
    })
  })

  describe('where()', () => {
    it('should filter by field value', async () => {
      const admins = await query(store)
        .type('User')
        .where('role', 'admin')
        .execute()

      expect(admins).toHaveLength(1)
      expect(admins[0].name).toBe('Alice')
    })

    it('should accept object of conditions', async () => {
      const results = await query(store)
        .type('User')
        .where({ role: 'user', age: 25 })
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Bob')
    })

    it('should chain multiple where calls', async () => {
      const results = await query(store)
        .type('Order')
        .where('status', 'pending')
        .where('total', 100)
        .execute()

      expect(results).toHaveLength(1)
    })
  })

  describe('orderBy()', () => {
    it('should order results descending by default', async () => {
      const users = await query(store)
        .type('User')
        .orderBy('age')
        .execute()

      expect(users[0].name).toBe('Charlie') // age 35
      expect(users[2].name).toBe('Bob')     // age 25
    })

    it('should order ascending when specified', async () => {
      const users = await query(store)
        .type('User')
        .orderBy('age', 'asc')
        .execute()

      expect(users[0].name).toBe('Bob')     // age 25
      expect(users[2].name).toBe('Charlie') // age 35
    })
  })

  describe('limit() and offset()', () => {
    it('should limit results', async () => {
      const users = await query(store)
        .type('User')
        .limit(2)
        .execute()

      expect(users).toHaveLength(2)
    })

    it('should offset results', async () => {
      const page1 = await query(store).type('User').limit(2).offset(0).execute()
      const page2 = await query(store).type('User').limit(2).offset(2).execute()

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(1)
    })
  })

  describe('select()', () => {
    it('should project specific fields', async () => {
      const users = await query(store)
        .type('User')
        .select('name', 'role')
        .execute()

      expect(users[0]).toHaveProperty('$id')
      expect(users[0]).toHaveProperty('$type')
      expect(users[0]).toHaveProperty('name')
      expect(users[0]).toHaveProperty('role')
      expect(users[0]).not.toHaveProperty('age')
    })
  })

  describe('first()', () => {
    it('should return first matching result', async () => {
      const user = await query(store)
        .type('User')
        .where('name', 'Alice')
        .first()

      expect(user?.name).toBe('Alice')
    })

    it('should return null when no match', async () => {
      const user = await query(store)
        .type('User')
        .where('name', 'Nobody')
        .first()

      expect(user).toBeNull()
    })
  })

  describe('count()', () => {
    it('should count matching results', async () => {
      const count = await query(store).type('User').count()
      expect(count).toBe(3)
    })

    it('should respect where filters', async () => {
      const count = await query(store)
        .type('User')
        .where('role', 'user')
        .count()

      expect(count).toBe(2)
    })
  })

  // ============================================================
  // NEW: SQL WHERE clause operators (issue do-5k2l)
  // These tests exercise the new whereOp() method for SQL-native filtering
  // ============================================================

  describe('whereOp() - SQL WHERE clause operators', () => {
    describe('equality operators', () => {
      it('should filter with = (equals)', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('role', '=', 'admin')
          .execute()

        expect(users).toHaveLength(1)
        expect(users[0].name).toBe('Alice')
      })

      it('should filter with != (not equals)', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('role', '!=', 'admin')
          .execute()

        expect(users).toHaveLength(2)
        expect(users.every(u => u.role !== 'admin')).toBe(true)
      })
    })

    describe('comparison operators', () => {
      it('should filter with > (greater than)', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('age', '>', 30)
          .execute()

        expect(users).toHaveLength(1)
        expect(users[0].name).toBe('Charlie')
      })

      it('should filter with >= (greater than or equal)', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('age', '>=', 30)
          .execute()

        expect(users).toHaveLength(2)
        expect(users.map(u => u.name).sort()).toEqual(['Alice', 'Charlie'])
      })

      it('should filter with < (less than)', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('age', '<', 30)
          .execute()

        expect(users).toHaveLength(1)
        expect(users[0].name).toBe('Bob')
      })

      it('should filter with <= (less than or equal)', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('age', '<=', 30)
          .execute()

        expect(users).toHaveLength(2)
        expect(users.map(u => u.name).sort()).toEqual(['Alice', 'Bob'])
      })
    })

    describe('LIKE operator', () => {
      it('should filter with LIKE prefix match', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('email', 'LIKE', '%@example.com')
          .execute()

        expect(users).toHaveLength(1)
        expect(users[0].name).toBe('Alice')
      })

      it('should filter with LIKE suffix match', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('email', 'LIKE', 'bob@%')
          .execute()

        expect(users).toHaveLength(1)
        expect(users[0].name).toBe('Bob')
      })

      it('should filter with LIKE contains match', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('name', 'LIKE', '%li%')
          .execute()

        expect(users).toHaveLength(2)
        expect(users.map(u => u.name).sort()).toEqual(['Alice', 'Charlie'])
      })
    })

    describe('IN operator', () => {
      it('should filter with IN array of values', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('name', 'IN', ['Alice', 'Bob'])
          .execute()

        expect(users).toHaveLength(2)
        expect(users.map(u => u.name).sort()).toEqual(['Alice', 'Bob'])
      })

      it('should handle empty IN array', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('name', 'IN', [])
          .execute()

        expect(users).toHaveLength(0)
      })

      it('should filter with NOT IN', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('name', 'NOT IN', ['Alice', 'Bob'])
          .execute()

        expect(users).toHaveLength(1)
        expect(users[0].name).toBe('Charlie')
      })
    })

    describe('NULL operators', () => {
      it('should filter with IS NULL', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('email', 'IS NULL', null)
          .execute()

        expect(users).toHaveLength(1)
        expect(users[0].name).toBe('Charlie')
      })

      it('should filter with IS NOT NULL', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('email', 'IS NOT NULL', null)
          .execute()

        expect(users).toHaveLength(2)
        expect(users.map(u => u.name).sort()).toEqual(['Alice', 'Bob'])
      })
    })

    describe('combined operators', () => {
      it('should chain multiple whereOp conditions', async () => {
        const users = await query(store)
          .type('User')
          .whereOp('age', '>=', 25)
          .whereOp('age', '<=', 30)
          .whereOp('role', '=', 'user')
          .execute()

        expect(users).toHaveLength(1)
        expect(users[0].name).toBe('Bob')
      })

      it('should combine whereOp with where', async () => {
        const users = await query(store)
          .type('User')
          .where('role', 'user')
          .whereOp('age', '>', 30)
          .execute()

        expect(users).toHaveLength(1)
        expect(users[0].name).toBe('Charlie')
      })
    })
  })

  describe('SQL injection prevention', () => {
    it('should safely handle values with SQL injection attempts', async () => {
      // This should NOT cause SQL injection - the value should be treated as a literal string
      const users = await query(store)
        .type('User')
        .whereOp('name', '=', "'; DROP TABLE things; --")
        .execute()

      // Should return empty results, not crash or corrupt data
      expect(users).toHaveLength(0)
    })

    it('should safely handle field names with special characters', () => {
      // Field names are validated eagerly when building the query
      // This prevents SQL injection by rejecting invalid field names immediately
      expect(() => {
        query(store)
          .type('User')
          .whereOp('name; DROP TABLE things', '=', 'test')
      }).toThrow(/Invalid field name/)
    })
  })
})

// ============================================================
// SQL WHERE clause generation tests (do-5k2l)
// These tests verify the buildWhereClause function generates correct SQL
// ============================================================

describe('buildWhereClause', () => {
  it('should generate empty clause for no conditions', () => {
    const options: QueryOptions = {}
    const { clause, params } = buildWhereClause(options)

    expect(clause).toBe('')
    expect(params).toEqual([])
  })

  it('should generate WHERE clause for type filter', () => {
    const options: QueryOptions = { type: 'User' }
    const { clause, params } = buildWhereClause(options)

    expect(clause).toBe('WHERE type = ?')
    expect(params).toEqual(['User'])
  })

  describe('equality operators', () => {
    it('should generate = condition with json_extract for custom fields', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'name', operator: '=', value: 'Alice' }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe("WHERE json_extract(data, '$.name') = ?")
      expect(params).toEqual(['Alice'])
    })

    it('should generate != condition', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'status', operator: '!=', value: 'deleted' }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe("WHERE json_extract(data, '$.status') != ?")
      expect(params).toEqual(['deleted'])
    })
  })

  describe('comparison operators', () => {
    it('should generate > condition', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'age', operator: '>', value: 30 }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe("WHERE json_extract(data, '$.age') > ?")
      expect(params).toEqual([30])
    })

    it('should generate < condition', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'price', operator: '<', value: 100 }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe("WHERE json_extract(data, '$.price') < ?")
      expect(params).toEqual([100])
    })

    it('should generate >= condition', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'score', operator: '>=', value: 80 }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe("WHERE json_extract(data, '$.score') >= ?")
      expect(params).toEqual([80])
    })

    it('should generate <= condition', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'rating', operator: '<=', value: 5 }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe("WHERE json_extract(data, '$.rating') <= ?")
      expect(params).toEqual([5])
    })
  })

  describe('LIKE operator', () => {
    it('should generate LIKE condition', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'email', operator: 'LIKE', value: '%@example.com' }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe("WHERE json_extract(data, '$.email') LIKE ?")
      expect(params).toEqual(['%@example.com'])
    })
  })

  describe('IN operator', () => {
    it('should generate IN condition with placeholders', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'status', operator: 'IN', value: ['active', 'pending', 'review'] }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe("WHERE json_extract(data, '$.status') IN (?, ?, ?)")
      expect(params).toEqual(['active', 'pending', 'review'])
    })

    it('should generate false condition for empty IN array', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'status', operator: 'IN', value: [] }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe('WHERE 1 = 0')
      expect(params).toEqual([])
    })

    it('should generate NOT IN condition', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'role', operator: 'NOT IN', value: ['admin', 'superuser'] }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe("WHERE json_extract(data, '$.role') NOT IN (?, ?)")
      expect(params).toEqual(['admin', 'superuser'])
    })
  })

  describe('NULL operators', () => {
    it('should generate IS NULL condition for JSON fields', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'deletedAt', operator: 'IS NULL', value: null }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toContain('IS NULL')
      expect(clause).toContain("json_extract(data, '$.deletedAt')")
      expect(params).toEqual([])
    })

    it('should generate IS NOT NULL condition for JSON fields', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: 'email', operator: 'IS NOT NULL', value: null }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toContain('IS NOT NULL')
      expect(clause).toContain("json_extract(data, '$.email')")
      expect(params).toEqual([])
    })
  })

  describe('system fields', () => {
    it('should use column name directly for $id', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: '$id', operator: '=', value: 'test-123' }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe('WHERE id = ?')
      expect(params).toEqual(['test-123'])
    })

    it('should use column name for $createdAt', () => {
      const options: QueryOptions = {
        whereConditions: [{ field: '$createdAt', operator: '>=', value: 1000 }]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe('WHERE created_at >= ?')
      expect(params).toEqual([1000])
    })
  })

  describe('multiple conditions', () => {
    it('should combine type and field conditions with AND', () => {
      const options: QueryOptions = {
        type: 'User',
        whereConditions: [
          { field: 'role', operator: '=', value: 'admin' },
          { field: 'age', operator: '>=', value: 21 }
        ]
      }
      const { clause, params } = buildWhereClause(options)

      expect(clause).toBe("WHERE type = ? AND json_extract(data, '$.role') = ? AND json_extract(data, '$.age') >= ?")
      expect(params).toEqual(['User', 'admin', 21])
    })
  })
})
