// Events/Actions storage - immutable event log
// Generic types added per do-jqrj
// Storage abstraction added per do-68rr
// Branded types added per do-e3my
// Code duplication refactored per do-1knp.4
import { generateEventId } from './id';
import { createLogger } from './logger';
import { MemoryStorageAdapter } from './adapters/memory';
import { applyCursorPagination } from './pagination';
const logger = createLogger('[Events]');
// ID generation moved to ./id.ts (do-e3my)
/**
 * Estimate the size of an event in bytes (for storage monitoring)
 */
function estimateEventSize(event) {
    // JSON serialization + some overhead for storage
    return JSON.stringify(event).length * 2; // UTF-16 encoding estimate
}
/**
 * Key prefix for events in storage adapter
 */
const EVENTS_PREFIX = 'event:';
/** Default bounds for in-memory collections */
const DEFAULT_COLLECTION_BOUNDS = {
    maxDLQEntries: 10000,
    maxValidationFailures: 10000,
    maxRetryStatuses: 50000,
    retryStatusMaxAge: 24 * 60 * 60 * 1000 // 24 hours
};
/**
 * Creates shared state for an events store
 * @param bounds - Optional custom bounds configuration (defaults to DEFAULT_COLLECTION_BOUNDS)
 */
function createSharedEventState(bounds) {
    return {
        deadLetterQueue: [],
        validationFailures: [],
        eventRetryStatus: new Map(),
        retryMetricsData: new Map(),
        durabilityConfig: {},
        defaultDurabilityConfig: { retries: 3, backoff: 'exponential' },
        subscribers: new Set(),
        retentionPolicy: undefined,
        bounds: { ...DEFAULT_COLLECTION_BOUNDS, ...bounds }
    };
}
/**
 * Notify subscribers of an event, tracking failures in DLQ
 */
function notifySubscribers(event, state, addToDeadLetterQueue) {
    // Convert Set to array to get numeric indices
    const handlers = Array.from(state.subscribers);
    handlers.forEach((handler, index) => {
        try {
            const result = handler(event);
            // Handle async handlers
            if (result && typeof result === 'object' && 'then' in result) {
                result.catch((error) => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logger.error('Event subscriber async error:', error);
                    addToDeadLetterQueue({
                        event,
                        attempts: 1,
                        lastError: errorMessage,
                        handlerIndex: index
                    });
                });
            }
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            logger.error('Event subscriber error:', e);
            addToDeadLetterQueue({
                event,
                attempts: 1,
                lastError: errorMessage,
                handlerIndex: index
            });
        }
    });
}
/**
 * Validate and set retention policy
 */
function validateAndSetRetentionPolicy(policy, state) {
    if (policy.maxEvents !== undefined && policy.maxEvents <= 0) {
        throw new Error('maxEvents must be positive');
    }
    if (policy.maxAgeDays !== undefined && policy.maxAgeDays <= 0) {
        throw new Error('maxAgeDays must be positive');
    }
    state.retentionPolicy = policy;
}
/**
 * Filter events based on query options
 */
function filterEvents(events, options) {
    const { type, source, correlationId, since, until } = options;
    return events.filter(e => {
        if (type && e.type !== type)
            return false;
        if (source && e.source !== source)
            return false;
        if (correlationId && e.correlationId !== correlationId)
            return false;
        if (since && e.$timestamp < since)
            return false;
        if (until && e.$timestamp > until)
            return false;
        return true;
    });
}
/**
 * Sort and paginate events
 */
function sortAndPaginateEvents(events, options) {
    const { limit = 100, offset = 0 } = options;
    // Sort by timestamp descending (newest first)
    events.sort((a, b) => b.$timestamp - a.$timestamp);
    return events.slice(offset, offset + limit);
}
/**
 * Create an event object from input data
 */
function createEventFromInput(data) {
    const providedTimestamp = data.$timestamp;
    return {
        ...data,
        $id: generateEventId(),
        $timestamp: typeof providedTimestamp === 'number' ? providedTimestamp : Date.now()
    };
}
/**
 * Add entry to dead letter queue with automatic cleanup when bounds exceeded
 * Removes oldest entries (FIFO) when maxDLQEntries is reached
 */
function addToDLQ(entry, state) {
    // Enforce bounds - remove oldest entries if at limit
    // Remove 10% of entries when hitting limit to amortize cleanup cost
    if (state.deadLetterQueue.length >= state.bounds.maxDLQEntries) {
        const removeCount = Math.max(1, Math.floor(state.bounds.maxDLQEntries * 0.1));
        state.deadLetterQueue.splice(0, removeCount);
        logger.warn(`DLQ exceeded max entries (${state.bounds.maxDLQEntries}), removed ${removeCount} oldest entries`);
    }
    state.deadLetterQueue.push({ ...entry, timestamp: Date.now() });
}
/**
 * Query dead letter queue with filtering and sorting
 */
function queryDLQ(options, state) {
    let results = [...state.deadLetterQueue];
    if (options?.type)
        results = results.filter(e => e.event.type === options.type);
    if (options?.since)
        results = results.filter(e => e.timestamp >= options.since);
    if (options?.until)
        results = results.filter(e => e.timestamp <= options.until);
    const order = options?.order ?? 'desc';
    results.sort((a, b) => order === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
    if (options?.limit)
        results = results.slice(0, options.limit);
    return results;
}
/**
 * Remove entry from dead letter queue by event ID
 */
function removeFromDLQ(eventId, state) {
    const index = state.deadLetterQueue.findIndex(e => e.event.$id === eventId);
    if (index >= 0) {
        state.deadLetterQueue.splice(index, 1);
        return true;
    }
    return false;
}
/**
 * Get DLQ entry by event ID
 */
function getDLQEntryById(eventId, state) {
    const entry = state.deadLetterQueue.find(e => e.event.$id === eventId);
    return entry ?? null;
}
/**
 * Calculate DLQ statistics
 */
function calculateDLQStats(state) {
    const dlq = state.deadLetterQueue;
    if (dlq.length === 0) {
        return { total: 0, byEventType: {}, byErrorType: {}, averageAttempts: 0, uniqueEvents: 0 };
    }
    const byEventType = {};
    const byErrorType = {};
    const uniqueEventIds = new Set();
    let totalAttempts = 0;
    let oldestEntry;
    let newestEntry;
    for (const entry of dlq) {
        byEventType[entry.event.type] = (byEventType[entry.event.type] || 0) + 1;
        const errorMatch = entry.lastError.match(/^(\w+Error|Error):?/);
        const errorType = errorMatch?.[1] ?? 'UnknownError';
        byErrorType[errorType] = (byErrorType[errorType] || 0) + 1;
        uniqueEventIds.add(entry.event.$id);
        totalAttempts += entry.attempts;
        if (oldestEntry === undefined || entry.timestamp < oldestEntry)
            oldestEntry = entry.timestamp;
        if (newestEntry === undefined || entry.timestamp > newestEntry)
            newestEntry = entry.timestamp;
    }
    const stats = {
        total: dlq.length, byEventType, byErrorType,
        averageAttempts: totalAttempts / dlq.length, uniqueEvents: uniqueEventIds.size
    };
    if (oldestEntry !== undefined)
        stats.oldestEntry = oldestEntry;
    if (newestEntry !== undefined)
        stats.newestEntry = newestEntry;
    return stats;
}
/**
 * Cleanup dead letter queue based on options
 */
function cleanupDLQ(options, state) {
    const dlq = state.deadLetterQueue;
    const result = { removed: 0, removedByType: {} };
    let cutoffTimestamp;
    if (options.olderThan !== undefined)
        cutoffTimestamp = options.olderThan;
    else if (options.olderThanDays !== undefined)
        cutoffTimestamp = Date.now() - (options.olderThanDays * 24 * 60 * 60 * 1000);
    const entriesToRemove = [];
    for (let i = 0; i < dlq.length; i++) {
        const entry = dlq[i];
        if (!entry)
            continue;
        if (cutoffTimestamp !== undefined && entry.timestamp >= cutoffTimestamp)
            continue;
        if (options.types?.length && !options.types.includes(entry.event.type))
            continue;
        if (options.errorTypes?.length) {
            const errorMatch = entry.lastError.match(/^(\w+Error|Error):?/);
            const errorType = errorMatch?.[1] ?? 'UnknownError';
            if (!options.errorTypes.includes(errorType))
                continue;
        }
        if (options.limit !== undefined && entriesToRemove.length >= options.limit)
            break;
        entriesToRemove.push(i);
        result.removed++;
        result.removedByType[entry.event.type] = (result.removedByType[entry.event.type] || 0) + 1;
    }
    for (let i = entriesToRemove.length - 1; i >= 0; i--) {
        const idx = entriesToRemove[i];
        if (idx !== undefined)
            dlq.splice(idx, 1);
    }
    return result;
}
/**
 * Add validation failure with automatic cleanup when bounds exceeded
 * Removes oldest entries (FIFO) when maxValidationFailures is reached
 */
function addValidationFailureEntry(failure, state) {
    // Enforce bounds - remove oldest entries if at limit
    // Remove 10% of entries when hitting limit to amortize cleanup cost
    if (state.validationFailures.length >= state.bounds.maxValidationFailures) {
        const removeCount = Math.max(1, Math.floor(state.bounds.maxValidationFailures * 0.1));
        state.validationFailures.splice(0, removeCount);
        logger.warn(`Validation failures exceeded max entries (${state.bounds.maxValidationFailures}), removed ${removeCount} oldest entries`);
    }
    state.validationFailures.push({ ...failure, timestamp: Date.now() });
}
/**
 * Query validation failures
 */
function queryValidationFailureEntries(options, state) {
    if (!options?.type)
        return [...state.validationFailures];
    return state.validationFailures.filter(f => f.type === options.type);
}
/**
 * Record a retry attempt for metrics
 */
function recordRetryAttemptMetric(eventType, succeeded, retryCount, state) {
    const existing = state.retryMetricsData.get(eventType) || { totalEvents: 0, totalRetries: 0, successes: 0 };
    existing.totalEvents++;
    existing.totalRetries += retryCount;
    if (succeeded)
        existing.successes++;
    state.retryMetricsData.set(eventType, existing);
}
/**
 * Get retry metrics
 */
function getRetryMetricsData(state) {
    const result = {};
    for (const [eventType, data] of state.retryMetricsData) {
        result[eventType] = {
            totalEvents: data.totalEvents,
            totalRetries: data.totalRetries,
            successRate: data.totalEvents > 0 ? data.successes / data.totalEvents : 0
        };
    }
    return result;
}
/**
 * Get durability config for an event type
 */
function getDurabilityConfigForType(eventType, state) {
    if (state.durabilityConfig[eventType])
        return state.durabilityConfig[eventType];
    if (state.durabilityConfig['*'])
        return state.durabilityConfig['*'];
    return state.defaultDurabilityConfig;
}
/**
 * Set event retry status with automatic cleanup when bounds exceeded
 * Removes oldest entries (by lastAttempt timestamp) and expired entries when maxRetryStatuses is reached
 */
function setEventRetryStatusBounded(eventId, status, state) {
    // If we're at or above the limit, perform cleanup
    if (state.eventRetryStatus.size >= state.bounds.maxRetryStatuses) {
        const now = Date.now();
        const maxAge = state.bounds.retryStatusMaxAge;
        // First pass: remove expired entries (older than maxAge)
        const expiredKeys = [];
        for (const [key, value] of state.eventRetryStatus) {
            if (now - value.lastAttempt > maxAge) {
                expiredKeys.push(key);
            }
        }
        for (const key of expiredKeys) {
            state.eventRetryStatus.delete(key);
        }
        // If still over limit, remove oldest 10% by lastAttempt
        if (state.eventRetryStatus.size >= state.bounds.maxRetryStatuses) {
            const entries = Array.from(state.eventRetryStatus.entries());
            entries.sort((a, b) => a[1].lastAttempt - b[1].lastAttempt);
            const removeCount = Math.max(1, Math.floor(state.bounds.maxRetryStatuses * 0.1));
            for (let i = 0; i < removeCount && i < entries.length; i++) {
                const entry = entries[i];
                if (entry) {
                    state.eventRetryStatus.delete(entry[0]);
                }
            }
            logger.warn(`Event retry status exceeded max entries (${state.bounds.maxRetryStatuses}), removed ${expiredKeys.length} expired + ${removeCount} oldest entries`);
        }
        else if (expiredKeys.length > 0) {
            logger.debug(`Event retry status cleanup: removed ${expiredKeys.length} expired entries`);
        }
    }
    state.eventRetryStatus.set(eventId, status);
}
// ============================================================================
// End of Shared Helper Functions
// ============================================================================
/**
 * Creates an EventsStore backed by a StorageAdapter.
 *
 * This factory function creates an event store that persists events using the
 * provided storage adapter, allowing any storage backend (SQLite, memory, etc.).
 *
 * @typeParam P - The payload type for events, defaults to JsonValue
 * @param adapter - The storage adapter to use for persistence
 * @returns An EventsStore instance with full event management capabilities
 *
 * @example
 * ```typescript
 * import { createEventsStoreWithAdapter, SQLiteAdapter } from '@dotdo/db'
 *
 * // Create store with SQLite backend
 * const adapter = new SQLiteAdapter(storage)
 * const events = createEventsStoreWithAdapter(adapter)
 *
 * // Emit an event
 * const event = await events.emit({
 *   type: 'user.signup',
 *   payload: { userId: 'user-123', email: 'alice@example.com' }
 * })
 *
 * // Query events
 * const signups = await events.query({ type: 'user.signup', limit: 10 })
 *
 * // Subscribe to new events
 * const unsubscribe = events.subscribe((event) => {
 *   console.log('New event:', event.type)
 * })
 * ```
 *
 * @stable
 * @since 1.0.0
 */
export function createEventsStoreWithAdapter(adapter) {
    const state = createSharedEventState();
    const store = {
        async emit(data) {
            const event = createEventFromInput(data);
            await adapter.put(`${EVENTS_PREFIX}${event.$id}`, event);
            notifySubscribers(event, state, (entry) => addToDLQ(entry, state));
            return event;
        },
        async get(id) {
            const event = await adapter.get(`${EVENTS_PREFIX}${id}`);
            return event ?? null;
        },
        async query(options = {}) {
            const result = await adapter.list({ prefix: EVENTS_PREFIX, includeValues: true });
            let events = Array.from(result.entries.values()).filter((e) => e !== undefined);
            events = filterEvents(events, options);
            return sortAndPaginateEvents(events, options);
        },
        async queryWithCursor(options = {}) {
            const result = await adapter.list({ prefix: EVENTS_PREFIX, includeValues: true });
            let events = Array.from(result.entries.values()).filter((e) => e !== undefined);
            events = filterEvents(events, options);
            // Sort by timestamp descending, then by ID descending for stable ordering
            events.sort((a, b) => {
                const timeDiff = b.$timestamp - a.$timestamp;
                if (timeDiff !== 0)
                    return timeDiff;
                // Secondary sort by ID descending for stable cursor pagination
                return b.$id.localeCompare(a.$id);
            });
            return applyCursorPagination(events, options, '$timestamp', 'desc', (item) => item.$id, (item) => item.$timestamp);
        },
        subscribe(handler) {
            state.subscribers.add(handler);
            return () => state.subscribers.delete(handler);
        },
        async setRetentionPolicy(policy) {
            validateAndSetRetentionPolicy(policy, state);
        },
        async getRetentionPolicy() {
            return state.retentionPolicy;
        },
        async count(filter) {
            const result = await adapter.list({ prefix: EVENTS_PREFIX, includeValues: true });
            let events = Array.from(result.entries.values()).filter((e) => e !== undefined);
            if (filter?.type) {
                events = events.filter(e => e.type === filter.type);
            }
            return events.length;
        },
        async cleanup(_options) {
            if (!state.retentionPolicy) {
                return { deleted: 0 };
            }
            let deleted = 0;
            const result = await adapter.list({ prefix: EVENTS_PREFIX, includeValues: true });
            let events = Array.from(result.entries.entries())
                .filter((entry) => entry[1] !== undefined);
            // Delete by age
            if (state.retentionPolicy.maxAgeDays) {
                const cutoff = Date.now() - (state.retentionPolicy.maxAgeDays * 24 * 60 * 60 * 1000);
                const toDelete = events.filter(([_, e]) => e.$timestamp < cutoff).map(([k]) => k);
                if (toDelete.length > 0) {
                    await adapter.deleteMany(toDelete);
                    deleted += toDelete.length;
                    events = events.filter(([k]) => !toDelete.includes(k));
                }
            }
            // Delete by count (keep newest)
            if (state.retentionPolicy.maxEvents && events.length > state.retentionPolicy.maxEvents) {
                events.sort(([_, a], [__, b]) => a.$timestamp - b.$timestamp); // oldest first
                const toDelete = events.slice(0, events.length - state.retentionPolicy.maxEvents).map(([k]) => k);
                if (toDelete.length > 0) {
                    await adapter.deleteMany(toDelete);
                    deleted += toDelete.length;
                }
            }
            return { deleted };
        },
        async getStorageUsage() {
            const result = await adapter.list({ prefix: EVENTS_PREFIX, includeValues: true });
            const events = Array.from(result.entries.values()).filter((e) => e !== undefined);
            const bytesUsed = events.reduce((total, event) => total + estimateEventSize(event), 0);
            return { eventCount: events.length, bytesUsed };
        },
        // DLQ methods - delegate to shared helpers
        addToDeadLetterQueue(entry) {
            addToDLQ(entry, state);
        },
        getDeadLetterQueue() {
            return [...state.deadLetterQueue];
        },
        queryDeadLetterQueue(options) {
            return queryDLQ(options, state);
        },
        removeFromDeadLetterQueue(eventId) {
            return removeFromDLQ(eventId, state);
        },
        async replayDeadLetterQueue(options) {
            const toReplay = queryDLQ(options, state);
            const replayedEvents = [];
            for (const entry of toReplay) {
                const newEvent = await store.emit({
                    type: entry.event.type,
                    payload: entry.event.payload,
                    source: 'dlq-replay',
                    correlationId: entry.event.$id
                });
                replayedEvents.push(newEvent);
                removeFromDLQ(entry.event.$id, state);
            }
            return replayedEvents;
        },
        getDLQEntry(eventId) {
            return getDLQEntryById(eventId, state);
        },
        getDLQStats() {
            return calculateDLQStats(state);
        },
        cleanupDeadLetterQueue(options) {
            return cleanupDLQ(options, state);
        },
        // Validation failure tracking - delegate to shared helpers
        addValidationFailure(failure) {
            addValidationFailureEntry(failure, state);
        },
        queryValidationFailures(options) {
            return queryValidationFailureEntries(options, state);
        },
        // Retry status tracking - delegate to shared helper with bounds enforcement
        setEventRetryStatus(eventId, status) {
            setEventRetryStatusBounded(eventId, status, state);
        },
        getEventRetryStatus(eventId) {
            return state.eventRetryStatus.get(eventId);
        },
        // Retry metrics - delegate to shared helpers
        recordRetryAttempt(eventType, succeeded, retryCount) {
            recordRetryAttemptMetric(eventType, succeeded, retryCount, state);
        },
        getRetryMetrics() {
            return getRetryMetricsData(state);
        },
        // Durability configuration
        setDurabilityConfig(config) {
            state.durabilityConfig = config;
        },
        getDurabilityConfig(eventType) {
            return getDurabilityConfigForType(eventType, state);
        }
    };
    return store;
}
/**
 * Creates an in-memory EventsStore for testing and development.
 *
 * This factory function creates an event store backed by a MemoryStorageAdapter.
 * Events are stored in-memory and will be lost when the process ends.
 * Use `createEventsStoreWithAdapter()` with a persistent adapter for production.
 *
 * @typeParam P - The payload type for events, defaults to JsonValue
 * @returns An EventsStore instance with full event management capabilities
 *
 * @example
 * ```typescript
 * import { createEventsStore } from '@dotdo/db'
 *
 * const events = createEventsStore()
 *
 * // Emit typed events
 * interface UserSignupPayload { userId: string; email: string }
 * const typedEvents = createEventsStore<UserSignupPayload>()
 *
 * await typedEvents.emit({
 *   type: 'user.signup',
 *   payload: { userId: 'user-123', email: 'alice@example.com' }
 * })
 * ```
 *
 * @stable
 * @since 1.0.0
 */
export function createEventsStore() {
    return createEventsStoreWithAdapter(new MemoryStorageAdapter());
}
//# sourceMappingURL=events.js.map