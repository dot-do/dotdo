// SQLite Migration System for @dotdo/db
// Provides versioned schema migrations with rollback support
/**
 * Helper to create a migration with type safety
 */
export function createMigration(migration) {
    return migration;
}
/**
 * MigrationRunner - Manages schema migrations for SQLite
 *
 * Features:
 * - Version tracking in _migrations table
 * - Ordered migration execution
 * - Rollback support
 * - Idempotent (safe to run multiple times)
 */
export class MigrationRunner {
    sql;
    initialized = false;
    constructor(sql) {
        this.sql = sql;
    }
    /**
     * Initialize the migration system by creating the _migrations table
     */
    async initialize() {
        if (this.initialized)
            return;
        this.sql.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
        this.initialized = true;
    }
    /**
     * Get the current schema version (highest applied migration)
     */
    async getCurrentVersion() {
        const row = await this.sql
            .prepare('SELECT version FROM _migrations ORDER BY version DESC LIMIT 1')
            .bind()
            .first();
        return row ? row['version'] : 0;
    }
    /**
     * Get all applied migrations in order
     */
    async getAppliedMigrations() {
        const result = await this.sql
            .prepare('SELECT version, name, applied_at FROM _migrations ORDER BY version ASC')
            .bind()
            .all();
        return result.results;
    }
    /**
     * Check if a specific migration has been applied
     */
    async isMigrationApplied(version) {
        const row = await this.sql
            .prepare('SELECT version FROM _migrations WHERE version = ?')
            .bind(version)
            .first();
        return row !== null;
    }
    /**
     * Get migrations that haven't been applied yet
     */
    async getPendingMigrations(migrations) {
        const applied = await this.getAppliedMigrations();
        const appliedVersions = new Set(applied.map((m) => m.version));
        return migrations
            .filter((m) => !appliedVersions.has(m.version))
            .sort((a, b) => a.version - b.version);
    }
    /**
     * Run all pending migrations
     *
     * Migrations are executed in version order, regardless of the order
     * they are provided. Already-applied migrations are skipped.
     */
    async runMigrations(migrations) {
        const result = {
            applied: 0,
            skipped: 0,
            errors: [],
        };
        // Sort migrations by version
        const sorted = [...migrations].sort((a, b) => a.version - b.version);
        for (const migration of sorted) {
            // Check if already applied
            const isApplied = await this.isMigrationApplied(migration.version);
            if (isApplied) {
                result.skipped++;
                continue;
            }
            // Apply the migration
            try {
                this.sql.exec(migration.up);
                // Record the migration
                await this.sql
                    .prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)')
                    .bind(migration.version, migration.name, Date.now())
                    .run();
                result.applied++;
            }
            catch (error) {
                result.errors.push({
                    version: migration.version,
                    name: migration.name,
                    error: error instanceof Error ? error.message : String(error),
                });
                // Stop on first error
                break;
            }
        }
        return result;
    }
    /**
     * Rollback the most recent migration
     */
    async rollback(migrations) {
        const currentVersion = await this.getCurrentVersion();
        if (currentVersion === 0) {
            return { rolledBack: 0, version: null };
        }
        // Find the migration to rollback
        const migration = migrations.find((m) => m.version === currentVersion);
        if (!migration) {
            throw new Error(`Migration for version ${currentVersion} not found in provided migrations`);
        }
        if (!migration.down) {
            throw new Error(`Migration ${migration.name} (version ${migration.version}) does not support rollback`);
        }
        // Execute rollback
        this.sql.exec(migration.down);
        // Remove from _migrations table
        await this.sql
            .prepare('DELETE FROM _migrations WHERE version = ?')
            .bind(currentVersion)
            .run();
        return { rolledBack: 1, version: currentVersion };
    }
    /**
     * Rollback to a specific version (exclusive)
     *
     * Rolls back all migrations with version > targetVersion
     */
    async rollbackTo(targetVersion, migrations) {
        let rolledBack = 0;
        let currentVersion = await this.getCurrentVersion();
        // Create a map for quick migration lookup
        const migrationMap = new Map(migrations.map((m) => [m.version, m]));
        while (currentVersion > targetVersion) {
            const migration = migrationMap.get(currentVersion);
            if (!migration) {
                throw new Error(`Migration for version ${currentVersion} not found in provided migrations`);
            }
            if (!migration.down) {
                throw new Error(`Migration ${migration.name} (version ${migration.version}) does not support rollback`);
            }
            // Execute rollback
            this.sql.exec(migration.down);
            // Remove from _migrations table
            await this.sql
                .prepare('DELETE FROM _migrations WHERE version = ?')
                .bind(currentVersion)
                .run();
            rolledBack++;
            currentVersion = await this.getCurrentVersion();
        }
        return {
            rolledBack,
            version: rolledBack > 0 ? currentVersion + 1 : null,
        };
    }
}
/**
 * Built-in migrations for the core @dotdo/db schema
 *
 * These define the standard things, events, and relationships tables.
 */
export const coreMigrations = [
    createMigration({
        version: 1,
        name: 'create_things_table',
        up: `
      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);
      CREATE INDEX IF NOT EXISTS idx_things_created_at ON things(created_at DESC);
    `,
        down: `
      DROP INDEX IF EXISTS idx_things_created_at;
      DROP INDEX IF EXISTS idx_things_type;
      DROP TABLE IF EXISTS things;
    `,
    }),
    createMigration({
        version: 2,
        name: 'create_events_table',
        up: `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        source TEXT,
        correlation_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
      CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
    `,
        down: `
      DROP INDEX IF EXISTS idx_events_timestamp;
      DROP INDEX IF EXISTS idx_events_correlation_id;
      DROP INDEX IF EXISTS idx_events_source;
      DROP INDEX IF EXISTS idx_events_type;
      DROP TABLE IF EXISTS events;
    `,
    }),
    createMigration({
        version: 3,
        name: 'create_relationships_table',
        up: `
      CREATE TABLE IF NOT EXISTS relationships (
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (subject, predicate, object)
      );
      CREATE INDEX IF NOT EXISTS idx_relationships_subject ON relationships(subject);
      CREATE INDEX IF NOT EXISTS idx_relationships_predicate ON relationships(predicate);
      CREATE INDEX IF NOT EXISTS idx_relationships_object ON relationships(object);
    `,
        down: `
      DROP INDEX IF EXISTS idx_relationships_object;
      DROP INDEX IF EXISTS idx_relationships_predicate;
      DROP INDEX IF EXISTS idx_relationships_subject;
      DROP TABLE IF EXISTS relationships;
    `,
    }),
    // Audit logging (do-xebw)
    createMigration({
        version: 4,
        name: 'create_audit_logs_table',
        up: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id TEXT,
        level TEXT NOT NULL,
        details TEXT,
        correlation_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_level ON audit_logs(level);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation_id ON audit_logs(correlation_id);
    `,
        down: `
      DROP INDEX IF EXISTS idx_audit_logs_correlation_id;
      DROP INDEX IF EXISTS idx_audit_logs_level;
      DROP INDEX IF EXISTS idx_audit_logs_resource;
      DROP INDEX IF EXISTS idx_audit_logs_action;
      DROP INDEX IF EXISTS idx_audit_logs_actor;
      DROP INDEX IF EXISTS idx_audit_logs_timestamp;
      DROP TABLE IF EXISTS audit_logs;
    `,
    }),
    // Fire-and-forget error tracking (do-9bmr)
    createMigration({
        version: 5,
        name: 'create_fire_and_forget_errors_table',
        up: `
      CREATE TABLE IF NOT EXISTS fire_and_forget_errors (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        event_type TEXT,
        handler_index INTEGER,
        message TEXT NOT NULL,
        stack TEXT,
        error_type TEXT NOT NULL,
        retriable INTEGER NOT NULL DEFAULT 0,
        context TEXT,
        timestamp INTEGER NOT NULL,
        attempts INTEGER,
        recovered INTEGER NOT NULL DEFAULT 0,
        recovered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ffe_timestamp ON fire_and_forget_errors(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_ffe_operation ON fire_and_forget_errors(operation);
      CREATE INDEX IF NOT EXISTS idx_ffe_event_type ON fire_and_forget_errors(event_type);
      CREATE INDEX IF NOT EXISTS idx_ffe_error_type ON fire_and_forget_errors(error_type);
      CREATE INDEX IF NOT EXISTS idx_ffe_recovered ON fire_and_forget_errors(recovered);
    `,
        down: `
      DROP INDEX IF EXISTS idx_ffe_recovered;
      DROP INDEX IF EXISTS idx_ffe_error_type;
      DROP INDEX IF EXISTS idx_ffe_event_type;
      DROP INDEX IF EXISTS idx_ffe_operation;
      DROP INDEX IF EXISTS idx_ffe_timestamp;
      DROP TABLE IF EXISTS fire_and_forget_errors;
    `,
    }),
    // Retry queue for fire-and-forget handlers (do-9bmr)
    createMigration({
        version: 6,
        name: 'create_retry_queue_table',
        up: `
      CREATE TABLE IF NOT EXISTS retry_queue (
        id TEXT PRIMARY KEY,
        error_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        next_retry_at INTEGER NOT NULL,
        backoff_delay INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_retry_queue_status ON retry_queue(status);
      CREATE INDEX IF NOT EXISTS idx_retry_queue_next_retry ON retry_queue(next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_retry_queue_event_type ON retry_queue(event_type);
      CREATE INDEX IF NOT EXISTS idx_retry_queue_error_id ON retry_queue(error_id);
    `,
        down: `
      DROP INDEX IF EXISTS idx_retry_queue_error_id;
      DROP INDEX IF EXISTS idx_retry_queue_event_type;
      DROP INDEX IF EXISTS idx_retry_queue_next_retry;
      DROP INDEX IF EXISTS idx_retry_queue_status;
      DROP TABLE IF EXISTS retry_queue;
    `,
    }),
];
//# sourceMappingURL=migrations.js.map