/**
 * Context Propagation for dotdo
 *
 * Provides request-scoped context propagation using AsyncLocalStorage with:
 * - Automatic trace context propagation across async boundaries
 * - Correlation ID management
 * - Baggage items (key-value pairs propagated with context)
 * - Integration with structured logging and tracing
 *
 * @module observability/context
 */
import { generateSpanId } from './tracing';
/**
 * Storage key for the observability context
 */
const CONTEXT_KEY = Symbol('observabilityContext');
/**
 * Current context stack (for environments without AsyncLocalStorage)
 */
let contextStack = [];
/**
 * AsyncLocalStorage instance (if available)
 */
let asyncLocalStorage;
// AsyncLocalStorage is available in Cloudflare Workers as of 2024
// but we provide a fallback for testing environments
try {
    // AsyncLocalStorage is a global in Workers but not in standard TypeScript lib
    const globalWithALS = globalThis;
    const AsyncLocalStorageClass = globalWithALS.AsyncLocalStorage;
    if (typeof AsyncLocalStorageClass !== 'undefined') {
        asyncLocalStorage = new AsyncLocalStorageClass();
    }
}
catch {
    // AsyncLocalStorage not available, use fallback
}
/**
 * Generate a unique correlation ID
 */
export function generateCorrelationId() {
    return `${Date.now().toString(36)}-${generateSpanId().slice(0, 8)}`;
}
/**
 * Create a new observability context
 */
export function createObservabilityContext(options = {}) {
    const ctx = {
        correlationId: options.correlationId ?? generateCorrelationId(),
        baggage: options.baggage ?? new Map(),
        metadata: options.metadata ?? {},
    };
    if (options.traceContext !== undefined) {
        ctx.traceContext = options.traceContext;
    }
    if (options.activeSpan !== undefined) {
        ctx.activeSpan = options.activeSpan;
    }
    return ctx;
}
/**
 * Get the current observability context
 */
export function getContext() {
    if (asyncLocalStorage) {
        return asyncLocalStorage.getStore();
    }
    return contextStack[contextStack.length - 1];
}
/**
 * Get the current context or create a new one
 */
export function getOrCreateContext() {
    const current = getContext();
    if (current)
        return current;
    return createObservabilityContext();
}
/**
 * Run a function with a specific observability context
 */
export function runWithContext(context, fn) {
    if (asyncLocalStorage) {
        return asyncLocalStorage.run(context, fn);
    }
    // Fallback for environments without AsyncLocalStorage
    contextStack.push(context);
    try {
        return fn();
    }
    finally {
        contextStack.pop();
    }
}
/**
 * Run a function with a new observability context
 */
export function runInNewContext(options = {}, fn) {
    const context = createObservabilityContext(options);
    return runWithContext(context, fn);
}
/**
 * Run a function with context derived from the current context
 */
export function runWithChildContext(updates, fn) {
    const parent = getContext();
    // Build context options conditionally to satisfy exactOptionalPropertyTypes
    const correlationId = parent?.correlationId ?? updates.correlationId;
    const traceContext = updates.traceContext ?? parent?.traceContext;
    const activeSpan = updates.activeSpan ?? parent?.activeSpan;
    const options = {
        baggage: new Map([
            ...(parent?.baggage ?? new Map()),
            ...(updates.baggage ?? new Map()),
        ]),
        metadata: {
            ...(parent?.metadata ?? {}),
            ...(updates.metadata ?? {}),
        },
    };
    if (correlationId !== undefined) {
        options.correlationId = correlationId;
    }
    if (traceContext !== undefined) {
        options.traceContext = traceContext;
    }
    if (activeSpan !== undefined) {
        options.activeSpan = activeSpan;
    }
    const child = createObservabilityContext(options);
    return runWithContext(child, fn);
}
/**
 * Get the current correlation ID
 */
export function getCorrelationId() {
    return getContext()?.correlationId;
}
/**
 * Get the current trace context
 */
export function getTraceContext() {
    return getContext()?.traceContext;
}
/**
 * Get the current active span
 */
export function getActiveSpan() {
    return getContext()?.activeSpan;
}
/**
 * Set the active span in the current context
 */
export function setActiveSpan(span) {
    const ctx = getContext();
    if (ctx) {
        ctx.activeSpan = span;
        if (span) {
            ctx.traceContext = span.context();
        }
    }
}
/**
 * Get a baggage item
 */
export function getBaggageItem(key) {
    return getContext()?.baggage.get(key);
}
/**
 * Set a baggage item in the current context
 */
export function setBaggageItem(key, value) {
    const ctx = getContext();
    if (ctx) {
        ctx.baggage.set(key, value);
    }
}
/**
 * Get all baggage items
 */
export function getAllBaggage() {
    return getContext()?.baggage ?? new Map();
}
/**
 * Get metadata from the current context
 */
export function getMetadata(key) {
    return getContext()?.metadata[key];
}
/**
 * Set metadata in the current context
 */
export function setMetadata(key, value) {
    const ctx = getContext();
    if (ctx) {
        ctx.metadata[key] = value;
    }
}
/**
 * W3C Baggage header name
 */
export const BAGGAGE_HEADER = 'baggage';
/**
 * Custom correlation ID header
 * Note: Uses X-Correlation-ID (mixed case) for consistency with RPC layer
 * HTTP headers are case-insensitive per RFC 7230, but we use consistent casing
 */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID';
/**
 * Parse W3C baggage header
 * Format: key1=value1,key2=value2;property1;property2
 */
export function parseBaggage(header) {
    const baggage = new Map();
    if (!header)
        return baggage;
    const items = header.split(',');
    for (const item of items) {
        const [keyValue] = item.split(';');
        if (!keyValue)
            continue;
        const [key, value] = keyValue.split('=').map(s => s.trim());
        if (key && value !== undefined) {
            try {
                baggage.set(decodeURIComponent(key), decodeURIComponent(value));
            }
            catch {
                // Skip invalid encoded values
            }
        }
    }
    return baggage;
}
/**
 * Format baggage as W3C baggage header
 */
export function formatBaggage(baggage) {
    const items = [];
    for (const [key, value] of baggage) {
        items.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    return items.join(',');
}
/**
 * Extract observability context from HTTP headers
 */
export function extractContextFromHeaders(headers) {
    const get = (name) => {
        if (headers instanceof Headers) {
            return headers.get(name);
        }
        return headers[name] ?? null;
    };
    const result = {};
    // Extract correlation ID
    const correlationId = get(CORRELATION_ID_HEADER);
    if (correlationId) {
        result.correlationId = correlationId;
    }
    // Extract baggage
    const baggageHeader = get(BAGGAGE_HEADER);
    if (baggageHeader) {
        result.baggage = parseBaggage(baggageHeader);
    }
    return result;
}
/**
 * Inject observability context into HTTP headers
 */
export function injectContextToHeaders(headers, context) {
    const ctx = context ?? getContext();
    if (!ctx)
        return;
    // Inject correlation ID
    headers.set(CORRELATION_ID_HEADER, ctx.correlationId);
    // Inject baggage
    if (ctx.baggage.size > 0) {
        headers.set(BAGGAGE_HEADER, formatBaggage(ctx.baggage));
    }
}
/**
 * Create a context holder for convenient context access
 */
export function createContextHolder(initial) {
    const context = createObservabilityContext(initial);
    return {
        get() {
            return context;
        },
        run(fn) {
            return runWithContext(context, fn);
        },
        get correlationId() {
            return context.correlationId;
        },
        get span() {
            return context.activeSpan;
        },
        set span(value) {
            context.activeSpan = value;
            if (value) {
                context.traceContext = value.context();
            }
        },
        baggage: {
            get(key) {
                return context.baggage.get(key);
            },
            set(key, value) {
                context.baggage.set(key, value);
            },
            getAll() {
                return context.baggage;
            },
        },
        metadata: {
            get(key) {
                return context.metadata[key];
            },
            set(key, value) {
                context.metadata[key] = value;
            },
        },
    };
}
/**
 * Reset context stack (for testing)
 */
export function resetContextStack() {
    contextStack = [];
}
//# sourceMappingURL=context.js.map