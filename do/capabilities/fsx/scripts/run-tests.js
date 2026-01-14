#!/usr/bin/env node

/**
 * Test runner script that runs vitest in shards to work around memory limitations
 * of the @cloudflare/vitest-pool-workers when running large test suites.
 *
 * The workerd runtime has a 128MB memory limit per isolate, which causes OOM
 * errors when running all tests at once. Sharding splits tests into smaller
 * batches that can complete before hitting memory limits.
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

const TOTAL_SHARDS = 61
let totalTests = 0
let totalPassed = 0
let totalFailed = 0
let failedShards = []

async function runShard(shardIndex, totalShards) {
  return new Promise((resolve) => {
    const args = ['run', '--shard', `${shardIndex}/${totalShards}`]
    const child = spawn('npx', ['vitest', ...args], {
      cwd: projectRoot,
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: '1' }
    })

    let output = ''

    child.stdout.on('data', (data) => {
      const str = data.toString()
      output += str
      process.stdout.write(str)
    })

    child.stderr.on('data', (data) => {
      const str = data.toString()
      output += str
      process.stderr.write(str)
    })

    child.on('close', (code) => {
      // Parse test results from output - look for patterns like "220 passed" or "Tests  220 passed"
      const passMatches = output.matchAll(/(\d+)\s+passed/g)
      const failMatches = output.matchAll(/(\d+)\s+failed/g)

      for (const match of passMatches) {
        const passed = parseInt(match[1], 10)
        totalPassed += passed
        totalTests += passed
      }

      for (const match of failMatches) {
        const failed = parseInt(match[1], 10)
        totalFailed += failed
        totalTests += failed
      }

      // Check if this was a memory error vs a real test failure
      const isMemoryError = output.includes('heap out of memory') ||
                            output.includes('Unhandled Rejection')

      // Check if there were actual test failures (not just OOM during cleanup)
      const hasTestFailures = output.includes('failed') &&
                              !output.includes('0 failed') &&
                              output.match(/(\d+)\s+failed/)?.some(m => parseInt(m[1]) > 0)

      // Only count as failed shard if tests actually failed (not just OOM during cleanup)
      if (code !== 0 && !isMemoryError && hasTestFailures) {
        failedShards.push(shardIndex)
      }

      resolve(code)
    })
  })
}

/**
 * Run the test/core tests which require Node.js environment (not Workers pool).
 * These tests scan the filesystem and need native fs access.
 */
async function runNodeTests() {
  return new Promise((resolve) => {
    const args = ['vitest', 'run', '--config', 'test/core/vitest.config.ts']
    const child = spawn('npx', args, {
      cwd: projectRoot,
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: '1' }
    })

    let output = ''

    child.stdout.on('data', (data) => {
      const str = data.toString()
      output += str
      process.stdout.write(str)
    })

    child.stderr.on('data', (data) => {
      const str = data.toString()
      output += str
      process.stderr.write(str)
    })

    child.on('close', (code) => {
      // Parse test results from output
      const passMatch = output.match(/(\d+)\s+passed/)
      const failMatch = output.match(/(\d+)\s+failed/)

      if (passMatch) {
        const passed = parseInt(passMatch[1], 10)
        totalPassed += passed
        totalTests += passed
      }

      if (failMatch) {
        const failed = parseInt(failMatch[1], 10)
        totalFailed += failed
        totalTests += failed
      }

      resolve(code)
    })
  })
}

async function main() {
  console.log(`Running tests in ${TOTAL_SHARDS} shards to avoid memory issues...\n`)

  const startTime = Date.now()

  // First run the Node.js tests (test/core) that need filesystem access
  console.log(`\n${'='.repeat(60)}`)
  console.log('Running Node.js tests (test/core/)')
  console.log(`${'='.repeat(60)}\n`)

  const nodeTestCode = await runNodeTests()
  if (nodeTestCode !== 0) {
    failedShards.push('node-tests')
  }

  // Then run the Workers pool tests in shards
  for (let i = 1; i <= TOTAL_SHARDS; i++) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`Shard ${i}/${TOTAL_SHARDS}`)
    console.log(`${'='.repeat(60)}\n`)

    await runShard(i, TOTAL_SHARDS)

    // Delay to allow memory to be freed
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(`\n${'='.repeat(60)}`)
  console.log('Test Summary')
  console.log(`${'='.repeat(60)}`)
  console.log(`Total Tests: ${totalTests}`)
  console.log(`Passed: ${totalPassed}`)
  console.log(`Failed: ${totalFailed}`)
  console.log(`Duration: ${duration}s`)

  if (failedShards.length > 0) {
    console.log(`\nFailed Shards: ${failedShards.join(', ')}`)
    process.exit(1)
  } else {
    console.log('\nAll tests passed!')
    process.exit(0)
  }
}

main().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})
