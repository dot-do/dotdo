/**
 * DO Command
 *
 * Operations for managing Durable Objects:
 * - list: List all DO instances
 * - show: Show DO state
 * - save: Create snapshot
 * - restore: Restore from snapshot
 * - clone: Clone DO instance
 * - delete: Delete DO instance
 */

import { Command } from 'commander'
import { createDB } from '../runtime/embedded-db'
import { createLogger } from '../utils/logger'

const logger = createLogger('do')

/**
 * Format timestamp for display
 */
function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

/**
 * Format state for display
 */
function formatState(state: Record<string, unknown>, indent = 2): string {
  return JSON.stringify(state, null, indent)
}

export const doCommand = new Command('do')
  .description('Durable Object operations')

/**
 * do:list - List all DO instances
 */
doCommand
  .command('list')
  .alias('ls')
  .description('List all Durable Object instances')
  .option('-c, --class <name>', 'Filter by class name')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const db = createDB()
    await db.init()

    try {
      const instances = await db.list(options.class)

      if (options.json) {
        console.log(JSON.stringify(instances, null, 2))
        return
      }

      if (instances.length === 0) {
        logger.info('No Durable Objects found')
        return
      }

      console.log()
      console.log(`Found ${instances.length} Durable Object(s):`)
      console.log()

      for (const instance of instances) {
        console.log(`  ${instance.id}`)
        console.log(`    Class:   ${instance.className}`)
        console.log(`    Created: ${formatTime(instance.createdAt)}`)
        console.log(`    Updated: ${formatTime(instance.updatedAt)}`)
        console.log()
      }
    } finally {
      db.close()
    }
  })

/**
 * do:show - Show DO state
 */
doCommand
  .command('show <id>')
  .description('Show Durable Object state')
  .option('--json', 'Output as JSON')
  .option('--storage', 'Include storage data')
  .action(async (id, options) => {
    const db = createDB()
    await db.init()

    try {
      const instance = await db.get(id)

      if (!instance) {
        logger.error(`Durable Object not found: ${id}`)
        process.exit(1)
      }

      if (options.json) {
        console.log(JSON.stringify(instance, null, 2))
        return
      }

      console.log()
      console.log(`Durable Object: ${instance.id}`)
      console.log('─'.repeat(40))
      console.log(`  Class:   ${instance.className}`)
      console.log(`  Created: ${formatTime(instance.createdAt)}`)
      console.log(`  Updated: ${formatTime(instance.updatedAt)}`)
      console.log()
      console.log('State:')
      console.log(formatState(instance.state))

      if (options.storage) {
        console.log()
        console.log('Storage:')
        console.log(formatState(instance.storage))
      }
      console.log()
    } finally {
      db.close()
    }
  })

/**
 * do:save - Create snapshot
 */
doCommand
  .command('save <id>')
  .description('Create a snapshot of a Durable Object')
  .option('-l, --label <label>', 'Label for the snapshot')
  .action(async (id, options) => {
    const db = createDB()
    await db.init()

    try {
      const instance = await db.get(id)

      if (!instance) {
        logger.error(`Durable Object not found: ${id}`)
        process.exit(1)
      }

      const snapshotId = await db.snapshot(id, options.label)
      logger.success(`Snapshot created: ${snapshotId}`)

      if (options.label) {
        console.log(`  Label: ${options.label}`)
      }
    } finally {
      db.close()
    }
  })

/**
 * do:restore - Restore from snapshot
 */
doCommand
  .command('restore <id> <snapshot>')
  .description('Restore a Durable Object from a snapshot')
  .option('-f, --force', 'Force restore without confirmation')
  .action(async (id, snapshotId, options) => {
    const db = createDB()
    await db.init()

    try {
      const instance = await db.get(id)

      if (!instance) {
        logger.error(`Durable Object not found: ${id}`)
        process.exit(1)
      }

      // List snapshots if snapshot ID is 'list'
      if (snapshotId === 'list') {
        const snapshots = await db.listSnapshots(id)

        if (snapshots.length === 0) {
          logger.info('No snapshots found')
          return
        }

        console.log()
        console.log(`Snapshots for ${id}:`)
        console.log()

        for (const snap of snapshots) {
          console.log(`  ${snap.id}`)
          console.log(`    Created: ${formatTime(snap.createdAt)}`)
          if (snap.label) {
            console.log(`    Label:   ${snap.label}`)
          }
          console.log()
        }
        return
      }

      if (!options.force) {
        logger.warn('This will overwrite current state.')
        logger.info('Use --force to confirm')
        process.exit(1)
      }

      await db.restore(id, snapshotId)
      logger.success(`Restored ${id} from snapshot ${snapshotId}`)
    } finally {
      db.close()
    }
  })

/**
 * do:clone - Clone DO instance
 */
doCommand
  .command('clone <source> <target>')
  .description('Clone a Durable Object instance')
  .action(async (sourceId, targetId) => {
    const db = createDB()
    await db.init()

    try {
      const source = await db.get(sourceId)

      if (!source) {
        logger.error(`Source Durable Object not found: ${sourceId}`)
        process.exit(1)
      }

      const existing = await db.get(targetId)
      if (existing) {
        logger.error(`Target already exists: ${targetId}`)
        logger.info('Delete it first or choose a different ID')
        process.exit(1)
      }

      await db.clone(sourceId, targetId)
      logger.success(`Cloned ${sourceId} to ${targetId}`)
    } finally {
      db.close()
    }
  })

/**
 * do:delete - Delete DO instance
 */
doCommand
  .command('delete <id>')
  .alias('rm')
  .description('Delete a Durable Object instance')
  .option('-f, --force', 'Force delete without confirmation')
  .action(async (id, options) => {
    const db = createDB()
    await db.init()

    try {
      const instance = await db.get(id)

      if (!instance) {
        logger.error(`Durable Object not found: ${id}`)
        process.exit(1)
      }

      if (!options.force) {
        logger.warn(`This will permanently delete ${id} and all its snapshots.`)
        logger.info('Use --force to confirm')
        process.exit(1)
      }

      await db.delete(id)
      logger.success(`Deleted ${id}`)
    } finally {
      db.close()
    }
  })

/**
 * do:snapshots - List snapshots
 */
doCommand
  .command('snapshots <id>')
  .description('List snapshots for a Durable Object')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const db = createDB()
    await db.init()

    try {
      const snapshots = await db.listSnapshots(id)

      if (options.json) {
        console.log(JSON.stringify(snapshots, null, 2))
        return
      }

      if (snapshots.length === 0) {
        logger.info(`No snapshots found for ${id}`)
        return
      }

      console.log()
      console.log(`Snapshots for ${id} (${snapshots.length}):`)
      console.log()

      for (const snap of snapshots) {
        const label = snap.label ? ` (${snap.label})` : ''
        console.log(`  ${snap.id}${label}`)
        console.log(`    Created: ${formatTime(snap.createdAt)}`)
        console.log()
      }
    } finally {
      db.close()
    }
  })

export default doCommand
