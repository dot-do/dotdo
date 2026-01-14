/**
 * ONET Tasks Performance Benchmarks
 *
 * Tests performance for ~20K ONET tasks linked to occupations.
 * ONET (O*NET OnLine) provides detailed task statements for each occupation.
 *
 * Performance targets:
 * - Task import: <500ms per 1K records
 * - Task-to-occupation lookup: <50ms
 * - Skill extraction: <100ms
 * - Bulk occupation tasks: <200ms
 *
 * Data model:
 * - Tasks have IDs, descriptions, importance scores
 * - Tasks link to occupations via ONET-SOC codes
 * - Skills are extracted from task descriptions
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
 * Maximum acceptable p95 latency for task lookups (ms)
 */
const MAX_TASK_LOOKUP_P95_MS = 100

/**
 * Maximum acceptable p95 latency for occupation task queries (ms)
 */
const MAX_OCCUPATION_TASKS_P95_MS = 200

/**
 * Maximum acceptable p95 latency for skill extraction (ms)
 */
const MAX_SKILL_EXTRACTION_P95_MS = 150

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

/**
 * Warmup iterations
 */
const WARMUP_ITERATIONS = 10

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Sample ONET-SOC occupation codes
 * Format: XX-XXXX.XX (major group-detailed occupation.specialization)
 */
const ONET_SOC_CODES = [
  '11-1011.00', // Chief Executives
  '11-2021.00', // Marketing Managers
  '13-1111.00', // Management Analysts
  '15-1252.00', // Software Developers
  '15-1211.00', // Computer Systems Analysts
  '17-2051.00', // Civil Engineers
  '19-1042.00', // Medical Scientists
  '21-1014.00', // Mental Health Counselors
  '25-1011.00', // Business Teachers, Postsecondary
  '27-1024.00', // Graphic Designers
  '29-1141.00', // Registered Nurses
  '33-3012.00', // Correctional Officers
  '35-2014.00', // Cooks, Restaurant
  '41-3021.00', // Insurance Sales Agents
  '43-4051.00', // Customer Service Representatives
  '47-2111.00', // Electricians
  '49-3023.00', // Automotive Service Technicians
  '51-4121.00', // Welders, Cutters, Solderers
  '53-3032.00', // Heavy and Tractor-Trailer Truck Drivers
]

/**
 * Sample task IDs (ONET uses numeric IDs)
 */
const SAMPLE_TASK_IDS = Array.from({ length: 100 }, (_, i) => `task-${1000 + i}`)

/**
 * Sample skill categories for extraction tests
 */
const SKILL_CATEGORIES = [
  'cognitive',
  'technical',
  'interpersonal',
  'physical',
  'organizational',
  'analytical',
  'communication',
  'leadership',
]

// ============================================================================
// TASK IMPORT BENCHMARKS
// ============================================================================

describe('ONET Tasks benchmarks', () => {
  describe('task import operations', () => {
    it('imports single task record', async () => {
      const result = await benchmark({
        name: 'onet-task-import-single',
        target: 'onet-tasks.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/tasks', {
            method: 'POST',
            body: JSON.stringify({
              id: `task-import-${i}`,
              occupation_code: occupation,
              description: `Perform specialized task ${i} involving analysis and coordination`,
              importance: Math.random() * 5,
              relevance: Math.random() * 100,
              frequency: Math.floor(Math.random() * 7) + 1,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== ONET Task Import (Single) ===')
      console.log(`  Dataset size: ~20,000 tasks`)
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TASK_LOOKUP_P95_MS)
    })

    it('imports batch of tasks for occupation', async () => {
      const result = await benchmark({
        name: 'onet-task-import-batch',
        target: 'onet-tasks.perf.do',
        iterations: 30,
        warmup: 5,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          const tasks = Array.from({ length: 25 }, (_, j) => ({
            id: `task-batch-${i}-${j}`,
            occupation_code: occupation,
            description: `Task ${j + 1}: Specialized duty for ${occupation}`,
            importance: 2 + Math.random() * 3,
            relevance: 50 + Math.random() * 50,
          }))

          return ctx.do.request('/tasks/batch', {
            method: 'POST',
            body: JSON.stringify({ tasks }),
          })
        },
      })

      record(result)

      console.log('\n=== ONET Task Import (Batch 25) ===')
      console.log(`  Tasks per batch: 25`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Batch of 25 should complete within 500ms
      expect(result.stats.p95).toBeLessThan(500)
    })

    it('imports tasks with occupation linking', async () => {
      const result = await benchmark({
        name: 'onet-task-import-with-links',
        target: 'onet-tasks.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const primaryOccupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          const relatedOccupations = [
            ONET_SOC_CODES[(i + 1) % ONET_SOC_CODES.length],
            ONET_SOC_CODES[(i + 2) % ONET_SOC_CODES.length],
          ]

          return ctx.do.request('/tasks', {
            method: 'POST',
            body: JSON.stringify({
              id: `task-linked-${i}`,
              occupation_code: primaryOccupation,
              related_occupations: relatedOccupations,
              description: `Cross-functional task applicable to multiple occupations`,
              importance: 3.5,
              task_type: 'core',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== ONET Task Import (With Linking) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TASK_LOOKUP_P95_MS * 1.5)
    })
  })

  describe('task-to-occupation queries', () => {
    it('queries tasks by occupation code', async () => {
      const result = await benchmark({
        name: 'onet-tasks-by-occupation',
        target: 'onet-tasks.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.list(`/tasks?occupation=${encodeURIComponent(occupation)}`)
        },
      })

      record(result)

      console.log('\n=== Tasks by Occupation Code ===')
      console.log(`  Occupations queried: ${ONET_SOC_CODES.length}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_OCCUPATION_TASKS_P95_MS)
    })

    it('queries single task by ID', async () => {
      const result = await benchmark({
        name: 'onet-task-by-id',
        target: 'onet-tasks.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const taskId = SAMPLE_TASK_IDS[i % SAMPLE_TASK_IDS.length]
          return ctx.do.get(`/tasks/${taskId}`)
        },
      })

      record(result)

      console.log('\n=== Single Task by ID ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_TASK_LOOKUP_P95_MS)
    })

    it('queries tasks by importance threshold', async () => {
      const result = await benchmark({
        name: 'onet-tasks-by-importance',
        target: 'onet-tasks.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          const minImportance = 3.0 + (i % 20) / 10
          return ctx.do.list(
            `/tasks?occupation=${encodeURIComponent(occupation)}&minImportance=${minImportance}`
          )
        },
      })

      record(result)

      console.log('\n=== Tasks by Importance Threshold ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_OCCUPATION_TASKS_P95_MS)
    })

    it('queries core vs supplemental tasks', async () => {
      const result = await benchmark({
        name: 'onet-tasks-by-type',
        target: 'onet-tasks.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          const taskType = i % 2 === 0 ? 'core' : 'supplemental'
          return ctx.do.list(
            `/tasks?occupation=${encodeURIComponent(occupation)}&type=${taskType}`
          )
        },
      })

      record(result)

      console.log('\n=== Tasks by Type (Core/Supplemental) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_OCCUPATION_TASKS_P95_MS)
    })

    it('queries tasks across occupation family', async () => {
      const result = await benchmark({
        name: 'onet-tasks-by-family',
        target: 'onet-tasks.perf.do',
        iterations: 30,
        warmup: 5,
        datasetSize: 20000,
        run: async (ctx, i) => {
          // Extract major group (first 2 digits) for family query
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          const majorGroup = occupation.substring(0, 2)
          return ctx.do.list(`/tasks?majorGroup=${majorGroup}&limit=50`)
        },
      })

      record(result)

      console.log('\n=== Tasks by Occupation Family ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Family queries may return more results
      expect(result.stats.p95).toBeLessThan(MAX_OCCUPATION_TASKS_P95_MS * 1.5)
    })
  })

  describe('skill requirements extraction', () => {
    it('extracts skills from task descriptions', async () => {
      const result = await benchmark({
        name: 'onet-skill-extraction',
        target: 'onet-tasks.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.request('/tasks/extract-skills', {
            method: 'POST',
            body: JSON.stringify({
              occupation_code: occupation,
              include_levels: true,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Skill Extraction from Tasks ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SKILL_EXTRACTION_P95_MS)
    })

    it('queries tasks requiring specific skill category', async () => {
      const result = await benchmark({
        name: 'onet-tasks-by-skill',
        target: 'onet-tasks.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const skill = SKILL_CATEGORIES[i % SKILL_CATEGORIES.length]
          return ctx.do.list(`/tasks?skill=${skill}&limit=50`)
        },
      })

      record(result)

      console.log('\n=== Tasks by Skill Category ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_OCCUPATION_TASKS_P95_MS)
    })

    it('computes skill overlap between occupations', async () => {
      const result = await benchmark({
        name: 'onet-skill-overlap',
        target: 'onet-tasks.perf.do',
        iterations: 30,
        warmup: 5,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const occ1 = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          const occ2 = ONET_SOC_CODES[(i + 5) % ONET_SOC_CODES.length]
          return ctx.do.request('/tasks/skill-overlap', {
            method: 'POST',
            body: JSON.stringify({
              occupation_a: occ1,
              occupation_b: occ2,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Skill Overlap Between Occupations ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Overlap computation may require reading both occupation's tasks
      expect(result.stats.p95).toBeLessThan(MAX_SKILL_EXTRACTION_P95_MS * 2)
    })

    it('ranks occupations by skill requirements', async () => {
      const result = await benchmark({
        name: 'onet-occupations-by-skill',
        target: 'onet-tasks.perf.do',
        iterations: 30,
        warmup: 5,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const skill = SKILL_CATEGORIES[i % SKILL_CATEGORIES.length]
          return ctx.do.list(`/occupations/rank-by-skill?skill=${skill}&limit=20`)
        },
      })

      record(result)

      console.log('\n=== Occupations Ranked by Skill ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_OCCUPATION_TASKS_P95_MS * 1.5)
    })
  })

  describe('task search and filtering', () => {
    it('full-text search in task descriptions', async () => {
      const searchTerms = [
        'analyze data',
        'manage team',
        'customer service',
        'technical support',
        'quality control',
        'financial reports',
        'safety procedures',
        'equipment maintenance',
      ]

      const result = await benchmark({
        name: 'onet-task-fulltext-search',
        target: 'onet-tasks.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const query = searchTerms[i % searchTerms.length]
          return ctx.do.list(`/tasks/search?q=${encodeURIComponent(query)}&limit=20`)
        },
      })

      record(result)

      console.log('\n=== Task Full-Text Search ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_OCCUPATION_TASKS_P95_MS)
    })

    it('filters tasks by multiple criteria', async () => {
      const result = await benchmark({
        name: 'onet-task-multi-filter',
        target: 'onet-tasks.perf.do',
        iterations: 30,
        warmup: 5,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          const skill = SKILL_CATEGORIES[i % SKILL_CATEGORIES.length]
          return ctx.do.list(
            `/tasks?occupation=${encodeURIComponent(occupation)}` +
              `&skill=${skill}&minImportance=3.0&type=core&limit=20`
          )
        },
      })

      record(result)

      console.log('\n=== Task Multi-Filter Query ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_OCCUPATION_TASKS_P95_MS)
    })
  })

  describe('bulk operations', () => {
    it('bulk task count by occupation', async () => {
      const result = await benchmark({
        name: 'onet-task-count-all',
        target: 'onet-tasks.perf.do',
        iterations: 30,
        warmup: 5,
        datasetSize: 20000,
        run: async (ctx) =>
          ctx.do.request('/tasks/count-by-occupation', {
            method: 'GET',
          }),
      })

      record(result)

      console.log('\n=== Bulk Task Count by Occupation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Aggregation across all occupations
      expect(result.stats.p95).toBeLessThan(500)
    })

    it('bulk export occupation tasks', async () => {
      const result = await benchmark({
        name: 'onet-task-bulk-export',
        target: 'onet-tasks.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const majorGroup = ['11', '13', '15', '17', '19', '21'][i % 6]
          return ctx.do.list(`/tasks/export?majorGroup=${majorGroup}`)
        },
      })

      record(result)

      console.log('\n=== Bulk Export Tasks by Major Group ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Bulk export may be slower
      expect(result.stats.p95).toBeLessThan(1000)
    })
  })

  describe('relationship traversals', () => {
    it('navigates occupation to tasks to skills', async () => {
      const result = await benchmark({
        name: 'onet-occupation-tasks-skills-traversal',
        target: 'onet-tasks.perf.do',
        iterations: 30,
        warmup: 5,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          // Get tasks for occupation
          const tasks = await ctx.do.list<{ id: string }>(
            `/tasks?occupation=${encodeURIComponent(occupation)}&limit=10`
          )
          // Get skills for each task
          const skillPromises = tasks.map((task) =>
            ctx.do.list(`/tasks/${task.id}/skills`)
          )
          return Promise.all(skillPromises)
        },
      })

      record(result)

      console.log('\n=== Occupation -> Tasks -> Skills Traversal ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Multi-hop traversal
      expect(result.stats.p95).toBeLessThan(500)
    })

    it('finds related occupations via shared tasks', async () => {
      const result = await benchmark({
        name: 'onet-related-via-tasks',
        target: 'onet-tasks.perf.do',
        iterations: 30,
        warmup: 5,
        datasetSize: 20000,
        run: async (ctx, i) => {
          const occupation = ONET_SOC_CODES[i % ONET_SOC_CODES.length]
          return ctx.do.list(
            `/occupations/${encodeURIComponent(occupation)}/related?via=tasks&limit=10`
          )
        },
      })

      record(result)

      console.log('\n=== Related Occupations via Shared Tasks ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_OCCUPATION_TASKS_P95_MS * 2)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('ONET Tasks Summary', () => {
  it('should document ONET tasks performance characteristics', () => {
    console.log('\n========================================')
    console.log('ONET TASKS BENCHMARK SUMMARY')
    console.log('========================================\n')

    console.log('Dataset characteristics:')
    console.log('  - Total tasks: ~20,000')
    console.log('  - Occupations covered: ~1,000')
    console.log('  - Avg tasks per occupation: ~20')
    console.log('  - Fields: ID, occupation_code, description, importance, frequency')
    console.log('')

    console.log('Performance targets:')
    console.log(`  - Task lookup by ID: <${MAX_TASK_LOOKUP_P95_MS}ms (p95)`)
    console.log(`  - Tasks by occupation: <${MAX_OCCUPATION_TASKS_P95_MS}ms (p95)`)
    console.log(`  - Skill extraction: <${MAX_SKILL_EXTRACTION_P95_MS}ms (p95)`)
    console.log('')

    console.log('Query patterns:')
    console.log('  - Point lookup by task ID')
    console.log('  - Filter by occupation code')
    console.log('  - Filter by importance threshold')
    console.log('  - Filter by task type (core/supplemental)')
    console.log('  - Full-text search in descriptions')
    console.log('  - Multi-criteria filtering')
    console.log('')

    console.log('Skill extraction:')
    console.log('  - Extract skills from task descriptions')
    console.log('  - Compute skill overlap between occupations')
    console.log('  - Rank occupations by skill requirements')
    console.log('')

    console.log('Graph traversals:')
    console.log('  - Occupation -> Tasks -> Skills')
    console.log('  - Find related occupations via shared tasks')
    console.log('')

    expect(true).toBe(true)
  })
})
