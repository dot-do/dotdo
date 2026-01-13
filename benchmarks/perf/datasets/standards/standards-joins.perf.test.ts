/**
 * Standards.org.ai Cross-Dataset Join Performance Benchmarks
 *
 * Tests join performance across the interconnected standards datasets:
 * - ONET Tasks (~20K) <-> Occupations
 * - ONET Tools (~10K) <-> Occupations <-> UNSPSC (~60K)
 * - ONET Technologies (~1K) <-> Occupations
 * - APQC Processes (~20K) hierarchical
 * - Job Titles (~40K) <-> Occupations
 *
 * Performance targets:
 * - Single-hop join: <100ms
 * - Two-hop join: <200ms
 * - Multi-hop graph query: <500ms
 * - Cross-shard joins: <300ms
 *
 * Graph relationships:
 * - Occupations <-> Tasks (many-to-many via importance)
 * - Occupations <-> Tools (many-to-many via usage)
 * - Occupations <-> Technologies (many-to-many via usage)
 * - Tools <-> UNSPSC (many-to-one via commodity_code)
 * - Occupations <-> Job Titles (one-to-many via mapping)
 * - Processes <-> Related entities (hierarchical + cross-refs)
 *
 * @see standards.org.ai for dataset source
 * @see dotdo-hemo4 for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable p95 latency for single-hop joins (ms)
 */
const MAX_SINGLE_HOP_P95_MS = 150

/**
 * Maximum acceptable p95 latency for two-hop joins (ms)
 */
const MAX_TWO_HOP_P95_MS = 300

/**
 * Maximum acceptable p95 latency for multi-hop graph queries (ms)
 */
const MAX_MULTI_HOP_P95_MS = 500

/**
 * Maximum acceptable p95 latency for cross-shard joins (ms)
 */
const MAX_CROSS_SHARD_P95_MS = 400

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 30

/**
 * Warmup iterations
 */
const WARMUP_ITERATIONS = 5

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Sample ONET-SOC occupation codes
 */
const ONET_SOC_CODES = [
  '11-1011.00', // Chief Executives
  '11-2021.00', // Marketing Managers
  '13-1111.00', // Management Analysts
  '15-1252.00', // Software Developers
  '15-1211.00', // Computer Systems Analysts
  '17-2051.00', // Civil Engineers
  '29-1141.00', // Registered Nurses
  '41-3021.00', // Insurance Sales Agents
  '43-4051.00', // Customer Service Representatives
  '47-2111.00', // Electricians
]

/**
 * Sample UNSPSC segments
 */
const UNSPSC_SEGMENTS = [
  '43', // Information Technology
  '27', // Tools and General Machinery
  '41', // Laboratory Equipment
  '39', // Electrical Systems
  '46', // Defense Equipment
]

/**
 * Sample APQC categories
 */
const APQC_CATEGORIES = [
  '1.0', // Develop Vision and Strategy
  '7.0', // Develop and Manage Human Capital
  '8.0', // Manage Information Technology
  '9.0', // Manage Financial Resources
]

/**
 * Sample job titles
 */
const JOB_TITLES = [
  'Software Engineer',
  'Marketing Manager',
  'Registered Nurse',
  'Customer Service Representative',
  'Electrician',
]

// ============================================================================
// SINGLE-HOP JOIN BENCHMARKS
// ============================================================================

describe('Standards cross-dataset joins', () => {
  describe('single-hop joins', () => {
    it('joins occupation to tasks', async () => {
      const result = await benchmark({
        name: 'join-occupation-tasks',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT o.code, o.title, t.description, t.importance
                FROM occupations o
                JOIN tasks t ON o.code = t.occupation_code
                WHERE o.code = ?
                ORDER BY t.importance DESC
                LIMIT 20
              `,
              params: [occupation],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Occupation -> Tasks Join ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_HOP_P95_MS)
    })

    it('joins occupation to tools', async () => {
      const result = await benchmark({
        name: 'join-occupation-tools',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT o.code, o.title, t.name, t.category, t.commodity_code
                FROM occupations o
                JOIN tools t ON o.code = ANY(t.occupation_codes)
                WHERE o.code = ?
                LIMIT 20
              `,
              params: [occupation],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Occupation -> Tools Join ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_HOP_P95_MS)
    })

    it('joins occupation to technologies', async () => {
      const result = await benchmark({
        name: 'join-occupation-technologies',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT o.code, o.title, tech.name, tech.category, tech.hot_technology
                FROM occupations o
                JOIN technologies tech ON o.code = ANY(tech.occupation_codes)
                WHERE o.code = ?
                AND tech.hot_technology = true
                LIMIT 20
              `,
              params: [occupation],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Occupation -> Technologies Join ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_HOP_P95_MS)
    })

    it('joins occupation to job titles', async () => {
      const result = await benchmark({
        name: 'join-occupation-titles',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT o.code, o.title as occupation_title, jt.title, jt.confidence
                FROM occupations o
                JOIN job_titles jt ON o.code = jt.occupation_code
                WHERE o.code = ?
                ORDER BY jt.confidence DESC
                LIMIT 20
              `,
              params: [occupation],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Occupation -> Job Titles Join ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_HOP_P95_MS)
    })

    it('joins tools to UNSPSC products', async () => {
      const result = await benchmark({
        name: 'join-tools-unspsc',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const segment = UNSPSC_SEGMENTS[i % UNSPSC_SEGMENTS.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT t.name as tool_name, t.category, u.code, u.title as product_title
                FROM tools t
                JOIN unspsc u ON t.commodity_code = u.code
                WHERE u.code LIKE ?
                LIMIT 20
              `,
              params: [`${segment}%`],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Tools -> UNSPSC Join ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_HOP_P95_MS)
    })
  })

  describe('two-hop joins (many-to-many traversals)', () => {
    it('joins occupation -> tools -> UNSPSC', async () => {
      const result = await benchmark({
        name: 'join-occupation-tools-unspsc',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT o.title as occupation, t.name as tool, u.title as product, u.code as unspsc_code
                FROM occupations o
                JOIN tools t ON o.code = ANY(t.occupation_codes)
                JOIN unspsc u ON t.commodity_code = u.code
                WHERE o.code = ?
                LIMIT 30
              `,
              params: [occupation],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Occupation -> Tools -> UNSPSC Join ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TWO_HOP_P95_MS)
    })

    it('joins job title -> occupation -> tasks', async () => {
      const result = await benchmark({
        name: 'join-title-occupation-tasks',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const title = JOB_TITLES[i % JOB_TITLES.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT jt.title, o.title as occupation, t.description, t.importance
                FROM job_titles jt
                JOIN occupations o ON jt.occupation_code = o.code
                JOIN tasks t ON o.code = t.occupation_code
                WHERE jt.title LIKE ?
                ORDER BY t.importance DESC
                LIMIT 20
              `,
              params: [`%${title}%`],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Job Title -> Occupation -> Tasks Join ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TWO_HOP_P95_MS)
    })

    it('joins UNSPSC -> tools -> occupations', async () => {
      const result = await benchmark({
        name: 'join-unspsc-tools-occupations',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const segment = UNSPSC_SEGMENTS[i % UNSPSC_SEGMENTS.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT u.title as product, t.name as tool, o.title as occupation
                FROM unspsc u
                JOIN tools t ON u.code = t.commodity_code
                JOIN occupations o ON o.code = ANY(t.occupation_codes)
                WHERE u.code LIKE ?
                LIMIT 30
              `,
              params: [`${segment}%`],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== UNSPSC -> Tools -> Occupations Join ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TWO_HOP_P95_MS)
    })

    it('finds occupations with shared tools', async () => {
      const result = await benchmark({
        name: 'join-occupations-shared-tools',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT o1.title as occupation_a, o2.title as occupation_b,
                       COUNT(DISTINCT t.id) as shared_tools
                FROM occupations o1
                JOIN tools t ON o1.code = ANY(t.occupation_codes)
                JOIN occupations o2 ON o2.code = ANY(t.occupation_codes)
                WHERE o1.code = ? AND o2.code != o1.code
                GROUP BY o1.title, o2.title
                ORDER BY shared_tools DESC
                LIMIT 10
              `,
              params: [occupation],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Occupations with Shared Tools ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TWO_HOP_P95_MS)
    })
  })

  describe('multi-hop graph queries', () => {
    it('traverses occupation -> tasks -> skills -> related occupations', async () => {
      const result = await benchmark({
        name: 'graph-occupation-skills-related',
        target: 'standards.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/graph/query', {
            method: 'POST',
            body: JSON.stringify({
              start: { type: 'occupation', id: occupation },
              traverse: [
                { edge: 'has_task', direction: 'outbound' },
                { edge: 'requires_skill', direction: 'outbound' },
                { edge: 'has_task', direction: 'inbound' },
              ],
              return: 'distinct_occupations',
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Occupation -> Tasks -> Skills -> Related Graph ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_MULTI_HOP_P95_MS)
    })

    it('traverses job title -> occupation -> tools -> UNSPSC hierarchy', async () => {
      const result = await benchmark({
        name: 'graph-title-to-unspsc-hierarchy',
        target: 'standards.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx, i) => {
          const title = JOB_TITLES[i % JOB_TITLES.length]
          return ctx.do.request('/graph/query', {
            method: 'POST',
            body: JSON.stringify({
              start: { type: 'job_title', match: title },
              traverse: [
                { edge: 'maps_to', direction: 'outbound', target: 'occupation' },
                { edge: 'uses', direction: 'outbound', target: 'tool' },
                { edge: 'classified_as', direction: 'outbound', target: 'unspsc' },
                { edge: 'parent', direction: 'outbound', depth: 3 },
              ],
              return: 'full_path',
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Job Title -> UNSPSC Hierarchy Graph ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_MULTI_HOP_P95_MS)
    })

    it('finds shortest path between occupations via shared entities', async () => {
      const result = await benchmark({
        name: 'graph-shortest-path-occupations',
        target: 'standards.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx, i) => {
          const occ1 = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          const occ2 = ONET_SOC_CODES[(i + 5) % ONET_SOC_CODES.length]
          return ctx.do.request('/graph/shortest-path', {
            method: 'POST',
            body: JSON.stringify({
              from: { type: 'occupation', id: occ1 },
              to: { type: 'occupation', id: occ2 },
              edgeTypes: ['has_task', 'uses_tool', 'uses_tech', 'has_title'],
              maxHops: 4,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Shortest Path Between Occupations ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_MULTI_HOP_P95_MS)
    })

    it('computes occupation similarity via all relationships', async () => {
      const result = await benchmark({
        name: 'graph-occupation-similarity',
        target: 'standards.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/graph/similarity', {
            method: 'POST',
            body: JSON.stringify({
              occupation,
              factors: ['tasks', 'tools', 'technologies', 'titles'],
              weights: { tasks: 0.4, tools: 0.3, technologies: 0.2, titles: 0.1 },
              topN: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Occupation Similarity (All Relationships) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_MULTI_HOP_P95_MS)
    })
  })

  describe('cross-shard join queries', () => {
    it('joins across occupation and task shards', async () => {
      const result = await benchmark({
        name: 'cross-shard-occupation-tasks',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          // Occupations and tasks may be on different shards
          const majorGroup = ['11', '13', '15', '17', '29'][i % 5]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT o.code, o.title, COUNT(t.id) as task_count, AVG(t.importance) as avg_importance
                FROM occupations o
                JOIN tasks t ON o.code = t.occupation_code
                WHERE o.code LIKE ?
                GROUP BY o.code, o.title
                ORDER BY avg_importance DESC
                LIMIT 20
              `,
              params: [`${majorGroup}-%`],
              crossShard: true,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Cross-Shard: Occupations + Tasks ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CROSS_SHARD_P95_MS)
    })

    it('joins across tools and UNSPSC shards', async () => {
      const result = await benchmark({
        name: 'cross-shard-tools-unspsc',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const category = ['hand_tools', 'power_tools', 'diagnostic_equipment'][i % 3]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT t.category, u.segment, COUNT(*) as tool_count
                FROM tools t
                JOIN unspsc u ON t.commodity_code = u.code
                WHERE t.category = ?
                GROUP BY t.category, u.segment
                ORDER BY tool_count DESC
              `,
              params: [category],
              crossShard: true,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Cross-Shard: Tools + UNSPSC ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CROSS_SHARD_P95_MS)
    })

    it('scatter-gather join across all datasets', async () => {
      const result = await benchmark({
        name: 'cross-shard-full-scatter',
        target: 'standards.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT
                  o.title as occupation,
                  COUNT(DISTINCT t.id) as task_count,
                  COUNT(DISTINCT tl.id) as tool_count,
                  COUNT(DISTINCT tech.id) as tech_count,
                  COUNT(DISTINCT jt.id) as title_count
                FROM occupations o
                LEFT JOIN tasks t ON o.code = t.occupation_code
                LEFT JOIN tools tl ON o.code = ANY(tl.occupation_codes)
                LEFT JOIN technologies tech ON o.code = ANY(tech.occupation_codes)
                LEFT JOIN job_titles jt ON o.code = jt.occupation_code
                WHERE o.code = ?
                GROUP BY o.title
              `,
              params: [occupation],
              crossShard: true,
              scatter: 'all',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Cross-Shard: Full Scatter Join ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_MULTI_HOP_P95_MS)
    })
  })

  describe('aggregation joins', () => {
    it('aggregates tasks and tools per occupation family', async () => {
      const result = await benchmark({
        name: 'aggregate-occupation-family',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const majorGroups = ['11', '13', '15', '17', '29', '41', '43', '47']
          const majorGroup = majorGroups[i % majorGroups.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT
                  SUBSTR(o.code, 1, 2) as major_group,
                  COUNT(DISTINCT o.code) as occupation_count,
                  COUNT(DISTINCT t.id) as total_tasks,
                  COUNT(DISTINCT tl.id) as total_tools,
                  AVG(t.importance) as avg_task_importance
                FROM occupations o
                LEFT JOIN tasks t ON o.code = t.occupation_code
                LEFT JOIN tools tl ON o.code = ANY(tl.occupation_codes)
                WHERE o.code LIKE ?
                GROUP BY SUBSTR(o.code, 1, 2)
              `,
              params: [`${majorGroup}-%`],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Aggregate: Tasks + Tools per Family ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TWO_HOP_P95_MS)
    })

    it('counts job titles per UNSPSC segment', async () => {
      const result = await benchmark({
        name: 'aggregate-titles-unspsc',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const segment = UNSPSC_SEGMENTS[i % UNSPSC_SEGMENTS.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT
                  SUBSTR(u.code, 1, 2) as segment,
                  COUNT(DISTINCT jt.title) as unique_titles,
                  COUNT(DISTINCT o.code) as occupation_count
                FROM unspsc u
                JOIN tools t ON u.code = t.commodity_code
                JOIN occupations o ON o.code = ANY(t.occupation_codes)
                JOIN job_titles jt ON o.code = jt.occupation_code
                WHERE u.code LIKE ?
                GROUP BY SUBSTR(u.code, 1, 2)
              `,
              params: [`${segment}%`],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Aggregate: Job Titles per UNSPSC Segment ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TWO_HOP_P95_MS)
    })
  })

  describe('process cross-references', () => {
    it('joins APQC processes to related occupations', async () => {
      const result = await benchmark({
        name: 'join-apqc-occupations',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const category = APQC_CATEGORIES[i % APQC_CATEGORIES.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT p.pcf_id, p.name as process, o.title as occupation,
                       COUNT(DISTINCT t.id) as related_tasks
                FROM processes p
                JOIN process_occupations po ON p.id = po.process_id
                JOIN occupations o ON po.occupation_code = o.code
                JOIN tasks t ON o.code = t.occupation_code
                WHERE p.pcf_id LIKE ?
                GROUP BY p.pcf_id, p.name, o.title
                LIMIT 20
              `,
              params: [`${category.replace('.0', '')}%`],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== APQC Processes -> Occupations Join ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TWO_HOP_P95_MS)
    })

    it('finds processes supported by technology category', async () => {
      const result = await benchmark({
        name: 'join-processes-technologies',
        target: 'standards.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const techCategories = [
            'database_software',
            'development_environments',
            'analytics_software',
          ]
          const techCategory = techCategories[i % techCategories.length]
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `
                SELECT p.pcf_id, p.name as process, tech.name as technology
                FROM processes p
                JOIN process_technologies pt ON p.id = pt.process_id
                JOIN technologies tech ON pt.technology_id = tech.id
                WHERE tech.category = ?
                LIMIT 20
              `,
              params: [techCategory],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Processes Supported by Technology ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TWO_HOP_P95_MS)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Standards Cross-Dataset Joins Summary', () => {
  it('should document join performance characteristics', () => {
    console.log('\n========================================')
    console.log('STANDARDS CROSS-DATASET JOINS SUMMARY')
    console.log('========================================\n')

    console.log('Dataset interconnections:')
    console.log('  - Occupations (center of graph)')
    console.log('    -> Tasks (~20K, many-per-occupation)')
    console.log('    -> Tools (~10K, many-to-many)')
    console.log('    -> Technologies (~1K, many-to-many)')
    console.log('    -> Job Titles (~40K, many-per-occupation)')
    console.log('  - Tools -> UNSPSC (~60K, many-to-one)')
    console.log('  - Processes (~20K) -> cross-refs to occupations, technologies')
    console.log('')

    console.log('Performance targets:')
    console.log(`  - Single-hop joins: <${MAX_SINGLE_HOP_P95_MS}ms (p95)`)
    console.log(`  - Two-hop joins: <${MAX_TWO_HOP_P95_MS}ms (p95)`)
    console.log(`  - Multi-hop graph: <${MAX_MULTI_HOP_P95_MS}ms (p95)`)
    console.log(`  - Cross-shard joins: <${MAX_CROSS_SHARD_P95_MS}ms (p95)`)
    console.log('')

    console.log('Join patterns tested:')
    console.log('  Single-hop:')
    console.log('    - Occupation -> Tasks')
    console.log('    - Occupation -> Tools')
    console.log('    - Occupation -> Technologies')
    console.log('    - Occupation -> Job Titles')
    console.log('    - Tools -> UNSPSC')
    console.log('')

    console.log('  Two-hop:')
    console.log('    - Occupation -> Tools -> UNSPSC')
    console.log('    - Job Title -> Occupation -> Tasks')
    console.log('    - UNSPSC -> Tools -> Occupations')
    console.log('    - Occupations sharing tools')
    console.log('')

    console.log('  Multi-hop graph:')
    console.log('    - Occupation -> Tasks -> Skills -> Related')
    console.log('    - Title -> Occupation -> Tools -> UNSPSC hierarchy')
    console.log('    - Shortest path between occupations')
    console.log('    - Occupation similarity via all relationships')
    console.log('')

    console.log('  Cross-shard:')
    console.log('    - Scatter-gather across occupation/task shards')
    console.log('    - Tools + UNSPSC cross-shard')
    console.log('    - Full scatter across all datasets')
    console.log('')

    console.log('  Aggregations:')
    console.log('    - Tasks + Tools per occupation family')
    console.log('    - Job Titles per UNSPSC segment')
    console.log('')

    console.log('  Process cross-refs:')
    console.log('    - APQC -> Occupations')
    console.log('    - Processes -> Technologies')
    console.log('')

    expect(true).toBe(true)
  })
})
