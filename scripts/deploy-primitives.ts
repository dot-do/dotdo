#!/usr/bin/env npx tsx
/**
 * Deploy all primitive packages (fsx, bashx, gitx, npmx, pyx)
 *
 * Usage:
 *   npx tsx scripts/deploy-primitives.ts          # Deploy all
 *   npx tsx scripts/deploy-primitives.ts fsx      # Deploy one
 *   npx tsx scripts/deploy-primitives.ts --dry    # Dry run
 *   npx tsx scripts/deploy-primitives.ts --npm    # NPM publish only
 *   npx tsx scripts/deploy-primitives.ts --cf     # CF Workers only
 */

import { execSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import { resolve, join } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const PRIMITIVES_DIR = join(ROOT, 'primitives')

interface Primitive {
  name: string
  dir: string
  npmPackage: string
  corePackage?: string
  hasWorker: boolean
  workerConfig?: string
}

const PRIMITIVES: Primitive[] = [
  {
    name: 'fsx',
    dir: join(PRIMITIVES_DIR, 'fsx'),
    npmPackage: 'fsx.do',
    corePackage: '@dotdo/fsx',
    hasWorker: true,
    workerConfig: 'wrangler.jsonc',
  },
  {
    name: 'bashx',
    dir: join(PRIMITIVES_DIR, 'bashx'),
    npmPackage: 'bashx.do',
    corePackage: '@dotdo/bashx',
    hasWorker: true,
    workerConfig: 'wrangler.toml',
  },
  {
    name: 'gitx',
    dir: join(PRIMITIVES_DIR, 'gitx'),
    npmPackage: 'gitx.do',
    corePackage: '@dotdo/gitx',
    hasWorker: true,
    workerConfig: 'wrangler.toml',
  },
  {
    name: 'npmx',
    dir: join(PRIMITIVES_DIR, 'npmx'),
    npmPackage: '@dotdo/npmx',
    hasWorker: false,
  },
  {
    name: 'pyx',
    dir: join(PRIMITIVES_DIR, 'pyx'),
    npmPackage: 'pyx',
    corePackage: '@dotdo/pyx',
    hasWorker: true,
    workerConfig: 'wrangler.toml',
  },
]

function exec(cmd: string, cwd: string, dryRun = false): boolean {
  console.log(`\x1b[36m$ ${cmd}\x1b[0m`)
  if (dryRun) {
    console.log('  (dry run - skipped)')
    return true
  }
  try {
    execSync(cmd, { cwd, stdio: 'inherit' })
    return true
  } catch (e) {
    console.error(`\x1b[31mFailed: ${cmd}\x1b[0m`)
    return false
  }
}

async function runParallel(tasks: Array<() => Promise<boolean>>): Promise<boolean[]> {
  return Promise.all(tasks.map((t) => t()))
}

async function deployWorker(p: Primitive, dryRun: boolean): Promise<boolean> {
  if (!p.hasWorker || !p.workerConfig) return true

  const configPath = join(p.dir, p.workerConfig)
  if (!existsSync(configPath)) {
    console.log(`\x1b[33mSkipping ${p.name} - no ${p.workerConfig} found\x1b[0m`)
    return true
  }

  console.log(`\n\x1b[35m=== Deploying ${p.name} Worker ===\x1b[0m`)

  // Build first
  if (!exec('npm run build', p.dir, dryRun)) return false

  // Deploy
  const configFlag = p.workerConfig.endsWith('.jsonc') ? '-c wrangler.jsonc' : ''
  return exec(`npx wrangler deploy ${configFlag}`, p.dir, dryRun)
}

async function publishNpm(p: Primitive, dryRun: boolean): Promise<boolean> {
  console.log(`\n\x1b[35m=== Publishing ${p.npmPackage} ===\x1b[0m`)

  // Build
  if (!exec('npm run build', p.dir, dryRun)) return false

  // Publish main package
  const publishCmd = dryRun ? 'npm publish --dry-run' : 'npm publish --access public'
  if (!exec(publishCmd, p.dir, dryRun)) return false

  // Publish core package if exists
  if (p.corePackage) {
    const coreDir = join(p.dir, 'core')
    if (existsSync(join(coreDir, 'package.json'))) {
      console.log(`\n\x1b[35m=== Publishing ${p.corePackage} ===\x1b[0m`)
      if (!exec(publishCmd, coreDir, dryRun)) return false
    }
  }

  return true
}

async function checkTypeScript(p: Primitive): Promise<boolean> {
  console.log(`\x1b[34mTypecheck ${p.name}...\x1b[0m`)
  try {
    execSync('npx tsc --noEmit', { cwd: p.dir, stdio: 'pipe' })
    console.log(`  \x1b[32m✓ ${p.name}\x1b[0m`)
    return true
  } catch (e) {
    console.error(`  \x1b[31m✗ ${p.name} - TypeScript errors\x1b[0m`)
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry') || args.includes('-n')
  const npmOnly = args.includes('--npm')
  const cfOnly = args.includes('--cf')
  const targets = args.filter((a) => !a.startsWith('-'))

  // Filter primitives
  let primitives = PRIMITIVES
  if (targets.length > 0) {
    primitives = PRIMITIVES.filter((p) => targets.includes(p.name))
    if (primitives.length === 0) {
      console.error(`Unknown primitives: ${targets.join(', ')}`)
      console.error(`Available: ${PRIMITIVES.map((p) => p.name).join(', ')}`)
      process.exit(1)
    }
  }

  console.log('\x1b[1m=== Deploy Primitives ===\x1b[0m')
  console.log(`Targets: ${primitives.map((p) => p.name).join(', ')}`)
  if (dryRun) console.log('\x1b[33m(Dry run mode)\x1b[0m')
  console.log()

  // Check submodules are initialized
  for (const p of primitives) {
    if (!existsSync(p.dir)) {
      console.error(`\x1b[31mSubmodule not initialized: ${p.name}\x1b[0m`)
      console.error('Run: git submodule update --init --recursive')
      process.exit(1)
    }
  }

  // TypeScript check all in parallel
  console.log('\x1b[1m--- TypeScript Check ---\x1b[0m')
  const tsResults = await runParallel(primitives.map((p) => () => checkTypeScript(p)))
  if (tsResults.some((r) => !r)) {
    console.error('\n\x1b[31mTypeScript errors found. Fix before deploying.\x1b[0m')
    process.exit(1)
  }
  console.log()

  // Deploy Workers (if not npm-only)
  if (!npmOnly) {
    console.log('\x1b[1m--- Deploy CF Workers ---\x1b[0m')
    for (const p of primitives.filter((p) => p.hasWorker)) {
      const success = await deployWorker(p, dryRun)
      if (!success) {
        console.error(`\n\x1b[31mFailed to deploy ${p.name}\x1b[0m`)
        process.exit(1)
      }
    }
  }

  // Publish NPM (if not cf-only)
  if (!cfOnly) {
    console.log('\x1b[1m--- Publish NPM Packages ---\x1b[0m')
    for (const p of primitives) {
      const success = await publishNpm(p, dryRun)
      if (!success) {
        console.error(`\n\x1b[31mFailed to publish ${p.name}\x1b[0m`)
        process.exit(1)
      }
    }
  }

  console.log('\n\x1b[32m=== All deployments successful! ===\x1b[0m')

  // Summary
  console.log('\n\x1b[1mDeployed:\x1b[0m')
  if (!npmOnly) {
    console.log('  Workers:')
    for (const p of primitives.filter((p) => p.hasWorker)) {
      console.log(`    - ${p.name}.do`)
    }
  }
  if (!cfOnly) {
    console.log('  NPM Packages:')
    for (const p of primitives) {
      console.log(`    - ${p.npmPackage}`)
      if (p.corePackage) console.log(`    - ${p.corePackage}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
