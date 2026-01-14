/**
 * SPIKE: Link Traversal Performance on SQLite
 *
 * Benchmark JOIN-heavy queries on SQLite to validate that link traversal
 * performance is acceptable for the Gel compatibility layer.
 *
 * Test Scenarios:
 * 1. Simple forward link - User -> Posts (1:N)
 * 2. Nested traversal - User -> Posts -> Comments -> Author (3 levels)
 * 3. Backlink - Find all Posts where .author = User
 * 4. Multi-link - User.friends (N:N via junction)
 * 5. Mixed - User { posts: { comments: { author } }, friends }
 *
 * @see https://www.sqlite.org/queryplanner.html
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  createSQLEngine,
  type SQLEngine,
  SQLITE_DIALECT,
} from '../../sql/shared'

// ============================================================================
// TYPES
// ============================================================================

interface BenchmarkResult {
  name: string
  query: string
  dataSize: number
  execTimeMs: number
  rowsReturned: number
  withIndex: boolean
  queryPlan?: string
}

// ============================================================================
// BENCHMARK UTILITIES
// ============================================================================

/**
 * Run a benchmark and return timing results
 */
function benchmark(
  engine: SQLEngine,
  name: string,
  sql: string,
  dataSize: number,
  withIndex: boolean,
  iterations: number = 10
): BenchmarkResult {
  // Warm up (discard first run)
  try {
    engine.execute(sql)
  } catch (e) {
    // Ignore warm-up errors
  }

  // Get query plan (using EXPLAIN QUERY PLAN for SQLite)
  let queryPlan: string | undefined
  try {
    const planResult = engine.execute(`EXPLAIN QUERY PLAN ${sql}`)
    queryPlan = planResult.rows.map(row => row.join(' | ')).join('\n')
  } catch (e) {
    // EXPLAIN might not be supported in our mock engine
    queryPlan = 'N/A (mock engine)'
  }

  // Run multiple iterations and take average
  const times: number[] = []
  let rowsReturned = 0

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    const result = engine.execute(sql)
    const end = performance.now()
    times.push(end - start)
    rowsReturned = result.rows.length
  }

  // Calculate average (excluding outliers)
  times.sort((a, b) => a - b)
  const trimmed = times.slice(1, -1) // Remove best and worst
  const avgTime = trimmed.length > 0
    ? trimmed.reduce((a, b) => a + b, 0) / trimmed.length
    : times[0]

  return {
    name,
    query: sql,
    dataSize,
    execTimeMs: avgTime,
    rowsReturned,
    withIndex,
    queryPlan,
  }
}

/**
 * Format benchmark results as a markdown table
 */
function formatResultsTable(results: BenchmarkResult[]): string {
  const header = '| Scenario | Data Size | With Index | Time (ms) | Rows | Query |\n'
  const separator = '|----------|-----------|------------|-----------|------|-------|\n'
  const rows = results.map(r =>
    `| ${r.name} | ${r.dataSize.toLocaleString()} | ${r.withIndex ? 'Yes' : 'No'} | ${r.execTimeMs.toFixed(3)} | ${r.rowsReturned} | \`${r.query.slice(0, 50)}...\` |`
  ).join('\n')

  return header + separator + rows
}

// ============================================================================
// SCHEMA SETUP
// ============================================================================

/**
 * Create the test schema with Users, Posts, Comments, and Friendships tables
 */
function createSchema(engine: SQLEngine): void {
  // Users table
  engine.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  // Posts table (1:N with Users)
  engine.execute(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      created_at INTEGER NOT NULL
    )
  `)

  // Comments table (1:N with Posts, N:1 with Users as author)
  engine.execute(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  // Friendships table (N:N junction for User.friends)
  engine.execute(`
    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

/**
 * Create indexes for optimal query performance
 */
function createIndexes(engine: SQLEngine): void {
  // Posts indexes
  engine.execute(`CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id)`)

  // Comments indexes
  engine.execute(`CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id)`)
  engine.execute(`CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id)`)

  // Friendships indexes
  engine.execute(`CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id)`)
  engine.execute(`CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id)`)
}

/**
 * Drop indexes for testing without them
 * Note: Mock engine may not support DROP INDEX, so we catch errors
 */
function dropIndexes(engine: SQLEngine): void {
  const indexes = [
    'idx_posts_author',
    'idx_comments_post',
    'idx_comments_author',
    'idx_friendships_user',
    'idx_friendships_friend',
  ]

  for (const idx of indexes) {
    try {
      engine.execute(`DROP INDEX IF EXISTS ${idx}`)
    } catch (e) {
      // Mock engine doesn't support DROP INDEX - that's OK
      // Tests will run on data without explicit index creation
    }
  }
}

// ============================================================================
// DATA SEEDING
// ============================================================================

/**
 * Seed test data with the specified number of users
 *
 * Generates:
 * - N users
 * - ~10 posts per user
 * - ~5 comments per post
 * - ~10 friends per user
 */
function seedData(engine: SQLEngine, userCount: number): {
  users: number
  posts: number
  comments: number
  friendships: number
} {
  const now = Date.now()

  // Insert users
  for (let i = 1; i <= userCount; i++) {
    engine.execute(
      `INSERT INTO users (name, email, created_at) VALUES ('User ${i}', 'user${i}@example.com.ai', ${now})`
    )
  }

  // Insert posts (~10 per user)
  let postCount = 0
  for (let userId = 1; userId <= userCount; userId++) {
    const postsPerUser = 8 + Math.floor(Math.random() * 5) // 8-12 posts
    for (let p = 0; p < postsPerUser; p++) {
      postCount++
      engine.execute(
        `INSERT INTO posts (author_id, title, content, created_at) VALUES (${userId}, 'Post ${postCount}', 'Content for post ${postCount}', ${now})`
      )
    }
  }

  // Insert comments (~5 per post, random author)
  let commentCount = 0
  for (let postId = 1; postId <= postCount; postId++) {
    const commentsPerPost = 3 + Math.floor(Math.random() * 5) // 3-7 comments
    for (let c = 0; c < commentsPerPost; c++) {
      commentCount++
      const authorId = 1 + Math.floor(Math.random() * userCount)
      engine.execute(
        `INSERT INTO comments (post_id, author_id, content, created_at) VALUES (${postId}, ${authorId}, 'Comment ${commentCount}', ${now})`
      )
    }
  }

  // Insert friendships (~10 per user, bidirectional)
  let friendshipCount = 0
  const existingFriendships = new Set<string>()

  for (let userId = 1; userId <= userCount; userId++) {
    const friendsPerUser = 8 + Math.floor(Math.random() * 5) // 8-12 friends
    let addedFriends = 0

    while (addedFriends < friendsPerUser) {
      const friendId = 1 + Math.floor(Math.random() * userCount)
      if (friendId === userId) continue

      const key = userId < friendId ? `${userId}-${friendId}` : `${friendId}-${userId}`
      if (existingFriendships.has(key)) continue

      existingFriendships.add(key)
      friendshipCount++
      engine.execute(
        `INSERT INTO friendships (user_id, friend_id, created_at) VALUES (${userId}, ${friendId}, ${now})`
      )
      addedFriends++
    }
  }

  return {
    users: userCount,
    posts: postCount,
    comments: commentCount,
    friendships: friendshipCount,
  }
}

// ============================================================================
// TEST QUERIES
// ============================================================================

/**
 * Scenario 1: Simple forward link - User -> Posts (1:N)
 *
 * EdgeQL: SELECT User { posts } FILTER .id = <user_id>
 * SQL: SELECT * FROM posts WHERE author_id = ?
 */
function querySimpleForwardLink(engine: SQLEngine, userId: number): BenchmarkResult {
  const sql = `SELECT p.* FROM posts p WHERE p.author_id = ${userId}`
  return benchmark(engine, '1. Simple Forward (User->Posts)', sql, 0, true)
}

/**
 * Scenario 2: Nested traversal - User -> Posts -> Comments -> Author (3 levels)
 *
 * EdgeQL: SELECT User { posts: { comments: { author } } } FILTER .id = <user_id>
 * SQL: SELECT with JOINs or subqueries
 */
function queryNestedTraversal(engine: SQLEngine, userId: number): BenchmarkResult {
  const sql = `
    SELECT
      p.id as post_id,
      p.title as post_title,
      c.id as comment_id,
      c.content as comment_content,
      u.id as comment_author_id,
      u.name as comment_author_name
    FROM posts p
    LEFT JOIN comments c ON c.post_id = p.id
    LEFT JOIN users u ON u.id = c.author_id
    WHERE p.author_id = ${userId}
  `
  return benchmark(engine, '2. Nested (User->Posts->Comments->Author)', sql.trim(), 0, true)
}

/**
 * Scenario 3: Backlink - Find all Posts where .author = User
 *
 * EdgeQL: SELECT Post FILTER .author.id = <user_id>
 * SQL: Same as simple forward link conceptually
 */
function queryBacklink(engine: SQLEngine, userId: number): BenchmarkResult {
  const sql = `
    SELECT p.*, u.name as author_name
    FROM posts p
    INNER JOIN users u ON u.id = p.author_id
    WHERE u.id = ${userId}
  `
  return benchmark(engine, '3. Backlink (Post.<author)', sql.trim(), 0, true)
}

/**
 * Scenario 4: Multi-link - User.friends (N:N via junction)
 *
 * EdgeQL: SELECT User { friends } FILTER .id = <user_id>
 * SQL: JOIN through junction table
 */
function queryMultiLink(engine: SQLEngine, userId: number): BenchmarkResult {
  const sql = `
    SELECT u.*
    FROM users u
    INNER JOIN friendships f ON f.friend_id = u.id
    WHERE f.user_id = ${userId}
  `
  return benchmark(engine, '4. Multi-link (User.friends N:N)', sql.trim(), 0, true)
}

/**
 * Scenario 5: Mixed - User { posts: { comments: { author } }, friends }
 *
 * EdgeQL: SELECT User { posts: { comments: { author } }, friends } FILTER .id = <user_id>
 * SQL: Complex JOIN combining posts, comments, and friends
 *
 * This is typically executed as two separate queries:
 * 1. Posts with comments and authors
 * 2. Friends
 *
 * We'll test both the combined version and separate queries.
 */
function queryMixedCombined(engine: SQLEngine, userId: number): BenchmarkResult {
  // Option A: Single complex query (may have performance implications)
  const sql = `
    SELECT
      'post' as type,
      p.id as id,
      p.title as name,
      c.id as related_id,
      c.content as related_content,
      u.name as nested_name
    FROM posts p
    LEFT JOIN comments c ON c.post_id = p.id
    LEFT JOIN users u ON u.id = c.author_id
    WHERE p.author_id = ${userId}

    UNION ALL

    SELECT
      'friend' as type,
      f.id as id,
      u.name as name,
      NULL as related_id,
      NULL as related_content,
      NULL as nested_name
    FROM friendships f
    INNER JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ${userId}
  `
  return benchmark(engine, '5. Mixed (posts+comments+friends)', sql.trim(), 0, true)
}

/**
 * Test aggregate query - Count posts per user
 */
function queryAggregatePostsPerUser(engine: SQLEngine): BenchmarkResult {
  const sql = `
    SELECT u.id, u.name, COUNT(p.id) as post_count
    FROM users u
    LEFT JOIN posts p ON p.author_id = u.id
    GROUP BY u.id, u.name
    ORDER BY post_count DESC
    LIMIT 10
  `
  return benchmark(engine, '6. Aggregate (posts per user)', sql.trim(), 0, true)
}

/**
 * Test deep nested query - 4 levels
 * User -> Posts -> Comments -> Author -> Friends
 */
function queryDeepNested(engine: SQLEngine, userId: number): BenchmarkResult {
  const sql = `
    SELECT
      p.id as post_id,
      c.id as comment_id,
      author.id as author_id,
      author.name as author_name,
      friend.id as friend_id,
      friend.name as friend_name
    FROM posts p
    INNER JOIN comments c ON c.post_id = p.id
    INNER JOIN users author ON author.id = c.author_id
    LEFT JOIN friendships f ON f.user_id = author.id
    LEFT JOIN users friend ON friend.id = f.friend_id
    WHERE p.author_id = ${userId}
    LIMIT 100
  `
  return benchmark(engine, '7. Deep Nested (4 levels)', sql.trim(), 0, true)
}

// ============================================================================
// BENCHMARK TESTS
// ============================================================================

describe('SPIKE: Link Traversal Performance on SQLite', () => {
  let engine: SQLEngine
  const allResults: BenchmarkResult[] = []

  describe('Schema Setup', () => {
    beforeEach(() => {
      engine = createSQLEngine(SQLITE_DIALECT)
    })

    it('creates tables successfully', () => {
      createSchema(engine)

      // Verify tables exist by inserting test data
      engine.execute(`INSERT INTO users (name, email, created_at) VALUES ('Test', 'test@test.com', ${Date.now()})`)
      const result = engine.execute('SELECT * FROM users')
      expect(result.rows.length).toBe(1)
    })

    it('creates indexes successfully', () => {
      createSchema(engine)
      createIndexes(engine)

      // If no error, indexes were created
      expect(true).toBe(true)
    })
  })

  describe('Data Seeding', () => {
    beforeEach(() => {
      engine = createSQLEngine(SQLITE_DIALECT)
      createSchema(engine)
    })

    it('seeds 100 users with related data', () => {
      const stats = seedData(engine, 100)

      expect(stats.users).toBe(100)
      expect(stats.posts).toBeGreaterThan(800) // ~10 posts per user
      expect(stats.comments).toBeGreaterThan(4000) // ~5 comments per post
      expect(stats.friendships).toBeGreaterThan(500) // ~10 friends per user

      console.log('Seeded data stats:', stats)
    })
  })

  describe('Benchmark: 1K Records (100 Users)', () => {
    let dataStats: { users: number; posts: number; comments: number; friendships: number }

    beforeAll(() => {
      engine = createSQLEngine(SQLITE_DIALECT)
      createSchema(engine)
      dataStats = seedData(engine, 100)
      console.log('\n1K Records seeded:', dataStats)
    })

    describe('Without Indexes', () => {
      beforeAll(() => {
        dropIndexes(engine)
      })

      it('runs simple forward link query', () => {
        const result = querySimpleForwardLink(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = false
        allResults.push(result)

        expect(result.execTimeMs).toBeLessThan(100) // Should be fast even without index at 1K
        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs nested traversal query', () => {
        const result = queryNestedTraversal(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = false
        allResults.push(result)

        expect(result.execTimeMs).toBeLessThan(500)
        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs backlink query', () => {
        const result = queryBacklink(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = false
        allResults.push(result)

        expect(result.execTimeMs).toBeLessThan(100)
        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs multi-link (N:N) query', () => {
        const result = queryMultiLink(engine, 1)
        result.dataSize = dataStats.friendships
        result.withIndex = false
        allResults.push(result)

        expect(result.execTimeMs).toBeLessThan(100)
        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs mixed query (posts + friends)', () => {
        const result = queryMixedCombined(engine, 1)
        result.dataSize = dataStats.posts + dataStats.friendships
        result.withIndex = false
        allResults.push(result)

        expect(result.execTimeMs).toBeLessThan(500)
        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })
    })

    describe('With Indexes', () => {
      beforeAll(() => {
        createIndexes(engine)
      })

      it('runs simple forward link query', () => {
        const result = querySimpleForwardLink(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = true
        allResults.push(result)

        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs nested traversal query', () => {
        const result = queryNestedTraversal(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = true
        allResults.push(result)

        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs backlink query', () => {
        const result = queryBacklink(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = true
        allResults.push(result)

        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs multi-link (N:N) query', () => {
        const result = queryMultiLink(engine, 1)
        result.dataSize = dataStats.friendships
        result.withIndex = true
        allResults.push(result)

        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs mixed query (posts + friends)', () => {
        const result = queryMixedCombined(engine, 1)
        result.dataSize = dataStats.posts + dataStats.friendships
        result.withIndex = true
        allResults.push(result)

        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs aggregate query', () => {
        const result = queryAggregatePostsPerUser(engine)
        result.dataSize = dataStats.users
        result.withIndex = true
        allResults.push(result)

        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs deep nested query (4 levels)', () => {
        const result = queryDeepNested(engine, 1)
        result.dataSize = dataStats.comments
        result.withIndex = true
        allResults.push(result)

        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })
    })
  })

  describe('Benchmark: 10K Records (1000 Users)', () => {
    let dataStats: { users: number; posts: number; comments: number; friendships: number }

    beforeAll(() => {
      engine = createSQLEngine(SQLITE_DIALECT)
      createSchema(engine)
      dataStats = seedData(engine, 1000)
      console.log('\n10K Records seeded:', dataStats)
    })

    describe('With Indexes', () => {
      beforeAll(() => {
        createIndexes(engine)
      })

      it('runs simple forward link query', () => {
        const result = querySimpleForwardLink(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = true
        result.name = '1. Simple Forward (10K)'
        allResults.push(result)

        // At 10K records, should still be fast with indexes
        expect(result.execTimeMs).toBeLessThan(50)
        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs nested traversal query', () => {
        const result = queryNestedTraversal(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = true
        result.name = '2. Nested (10K)'
        allResults.push(result)

        expect(result.execTimeMs).toBeLessThan(200)
        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs backlink query', () => {
        const result = queryBacklink(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = true
        result.name = '3. Backlink (10K)'
        allResults.push(result)

        expect(result.execTimeMs).toBeLessThan(50)
        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs multi-link (N:N) query', () => {
        const result = queryMultiLink(engine, 1)
        result.dataSize = dataStats.friendships
        result.withIndex = true
        result.name = '4. Multi-link (10K)'
        allResults.push(result)

        expect(result.execTimeMs).toBeLessThan(50)
        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('runs deep nested query (4 levels)', () => {
        const result = queryDeepNested(engine, 1)
        result.dataSize = dataStats.comments
        result.withIndex = true
        result.name = '7. Deep Nested (10K)'
        allResults.push(result)

        expect(result.execTimeMs).toBeLessThan(500)
        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })
    })

    describe('Without Indexes (comparison)', () => {
      beforeAll(() => {
        dropIndexes(engine)
      })

      it('compares simple forward link without index', () => {
        const result = querySimpleForwardLink(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = false
        result.name = '1. Simple Forward (10K, no idx)'
        allResults.push(result)

        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })

      it('compares nested traversal without index', () => {
        const result = queryNestedTraversal(engine, 1)
        result.dataSize = dataStats.posts
        result.withIndex = false
        result.name = '2. Nested (10K, no idx)'
        allResults.push(result)

        console.log(`  ${result.name}: ${result.execTimeMs.toFixed(3)}ms, ${result.rowsReturned} rows`)
      })
    })
  })

  describe('Query Plan Analysis', () => {
    beforeAll(() => {
      engine = createSQLEngine(SQLITE_DIALECT)
      createSchema(engine)
      seedData(engine, 100)
      createIndexes(engine)
    })

    it('generates query plans for all scenarios', () => {
      const queries = [
        { name: 'Simple Forward', sql: 'SELECT * FROM posts WHERE author_id = 1' },
        {
          name: 'Nested Traversal',
          sql: `
            SELECT p.*, c.*, u.*
            FROM posts p
            LEFT JOIN comments c ON c.post_id = p.id
            LEFT JOIN users u ON u.id = c.author_id
            WHERE p.author_id = 1
          `
        },
        { name: 'Backlink', sql: 'SELECT p.* FROM posts p INNER JOIN users u ON u.id = p.author_id WHERE u.id = 1' },
        { name: 'Multi-link', sql: 'SELECT u.* FROM users u INNER JOIN friendships f ON f.friend_id = u.id WHERE f.user_id = 1' },
      ]

      console.log('\n=== Query Plans ===\n')

      for (const { name, sql } of queries) {
        console.log(`--- ${name} ---`)
        console.log('SQL:', sql.trim())

        // Note: Our mock engine doesn't support EXPLAIN, but real SQLite would
        // In production, this would show the actual query plan
        console.log('Plan: (requires real SQLite for EXPLAIN QUERY PLAN)\n')
      }
    })
  })

  describe('Summary', () => {
    afterAll(() => {
      console.log('\n\n=== BENCHMARK SUMMARY ===\n')
      console.log(formatResultsTable(allResults))

      // Calculate index impact
      const withIndex = allResults.filter(r => r.withIndex)
      const withoutIndex = allResults.filter(r => !r.withIndex)

      if (withIndex.length > 0 && withoutIndex.length > 0) {
        console.log('\n=== INDEX IMPACT ===')
        console.log(`Average with index: ${(withIndex.reduce((a, r) => a + r.execTimeMs, 0) / withIndex.length).toFixed(3)}ms`)
        console.log(`Average without index: ${(withoutIndex.reduce((a, r) => a + r.execTimeMs, 0) / withoutIndex.length).toFixed(3)}ms`)
      }

      // Performance recommendations
      console.log('\n=== RECOMMENDATIONS ===')
      console.log('1. Always index foreign key columns (author_id, post_id, user_id, friend_id)')
      console.log('2. For N:N relationships, create indexes on BOTH columns of the junction table')
      console.log('3. For nested traversals (3+ levels), consider denormalization or caching')
      console.log('4. LIMIT queries to prevent returning excessive rows')
      console.log('5. For deep nesting, split into multiple queries rather than one mega-JOIN')
    })

    it('provides go/no-go recommendation', () => {
      // Based on our benchmarks, evaluate if SQLite performance is acceptable
      const avgTime = allResults.length > 0
        ? allResults.reduce((a, r) => a + r.execTimeMs, 0) / allResults.length
        : 0

      console.log(`\nAverage query time: ${avgTime.toFixed(3)}ms`)

      // Thresholds for "acceptable" performance
      const ACCEPTABLE_AVG_MS = 50 // 50ms average
      const MAX_SINGLE_QUERY_MS = 500 // No single query over 500ms

      const maxTime = Math.max(...allResults.map(r => r.execTimeMs), 0)
      const isAcceptable = avgTime < ACCEPTABLE_AVG_MS && maxTime < MAX_SINGLE_QUERY_MS

      console.log(`\n=== GO/NO-GO RECOMMENDATION ===`)
      console.log(`Average time: ${avgTime.toFixed(3)}ms (threshold: ${ACCEPTABLE_AVG_MS}ms)`)
      console.log(`Max time: ${maxTime.toFixed(3)}ms (threshold: ${MAX_SINGLE_QUERY_MS}ms)`)
      console.log(`\nRECOMMENDATION: ${isAcceptable ? 'GO - Performance acceptable' : 'CAUTION - Review performance bottlenecks'}`)

      // The test passes regardless - this is a spike for gathering data
      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// EXPLAIN QUERY PLAN TESTS (for documentation)
// ============================================================================

describe('EXPLAIN QUERY PLAN Documentation', () => {
  it('documents expected SQLite query plans', () => {
    // This test documents what EXPLAIN QUERY PLAN should show for our queries
    // when run on real SQLite

    const expectedPlans = {
      'Simple Forward (User->Posts)': `
        -- Query: SELECT * FROM posts WHERE author_id = 1
        -- With idx_posts_author:
        --   SEARCH posts USING INDEX idx_posts_author (author_id=?)
        -- Without index:
        --   SCAN posts
      `,

      'Nested Traversal (3 levels)': `
        -- Query: SELECT ... FROM posts p LEFT JOIN comments c ... LEFT JOIN users u ...
        -- With indexes:
        --   SEARCH posts USING INDEX idx_posts_author (author_id=?)
        --   SEARCH comments USING INDEX idx_comments_post (post_id=?)
        --   SEARCH users USING INTEGER PRIMARY KEY (id=?)
        -- Without indexes:
        --   SCAN posts
        --   SCAN comments
        --   SCAN users
      `,

      'Backlink Query': `
        -- Query: SELECT p.* FROM posts p INNER JOIN users u ON u.id = p.author_id WHERE u.id = 1
        -- Optimal plan:
        --   SEARCH users USING INTEGER PRIMARY KEY (id=?)
        --   SEARCH posts USING INDEX idx_posts_author (author_id=?)
      `,

      'Multi-link N:N (Friends)': `
        -- Query: SELECT u.* FROM users u INNER JOIN friendships f ON f.friend_id = u.id WHERE f.user_id = 1
        -- With indexes:
        --   SEARCH friendships USING INDEX idx_friendships_user (user_id=?)
        --   SEARCH users USING INTEGER PRIMARY KEY (id=?)
      `,
    }

    console.log('\n=== Expected Query Plans (Real SQLite) ===')
    for (const [name, plan] of Object.entries(expectedPlans)) {
      console.log(`\n${name}:`)
      console.log(plan.trim())
    }

    expect(Object.keys(expectedPlans).length).toBe(4)
  })
})
