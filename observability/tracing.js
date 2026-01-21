/**
 * Distributed Tracing for dotdo
 *
 * Provides W3C Trace Context compatible distributed tracing with:
 * - Trace and span creation/management
 * - Automatic timing and duration tracking
 * - Span hierarchies (parent-child relationships)
 * - Attributes and events on spans
 * - Span status (ok, error, unset)
 * - Baggage propagation
 *
 * @module observability/tracing
 */
import { createStructuredLogger } from './logger';
/**
 * Generate a random hex ID of specified length
 */
function generateId(length) {
    const bytes = new Uint8Array(length / 2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
/**
 * Generate a 32-character trace ID (128-bit)
 */
export function generateTraceId() {
    return generateId(32);
}
/**
 * Generate a 16-character span ID (64-bit)
 */
export function generateSpanId() {
    return generateId(16);
}
/**
 * Span status codes
 */
export var SpanStatusCode;
(function (SpanStatusCode) {
    /** The operation completed successfully */
    SpanStatusCode["OK"] = "OK";
    /** The operation contained an error */
    SpanStatusCode["ERROR"] = "ERROR";
    /** The span status is not set */
    SpanStatusCode["UNSET"] = "UNSET";
})(SpanStatusCode || (SpanStatusCode = {}));
/**
 * Span kind - describes the relationship between the span and its parent
 */
export var SpanKind;
(function (SpanKind) {
    /** Internal operation within an application */
    SpanKind["INTERNAL"] = "INTERNAL";
    /** Server-side handling of a synchronous request */
    SpanKind["SERVER"] = "SERVER";
    /** Client-side of a synchronous request */
    SpanKind["CLIENT"] = "CLIENT";
    /** Initiator of an asynchronous request */
    SpanKind["PRODUCER"] = "PRODUCER";
    /** Handler of an asynchronous request */
    SpanKind["CONSUMER"] = "CONSUMER";
})(SpanKind || (SpanKind = {}));
/**
 * Create a new span
 */
function createSpan(name, traceId, options = {}) {
    const spanId = generateSpanId();
    const startTime = options.startTime ?? Date.now();
    const kind = options.kind ?? SpanKind.INTERNAL;
    const attributes = { ...(options.attributes || {}) };
    const events = [];
    const links = [...(options.links || [])];
    let status = { code: SpanStatusCode.UNSET };
    let endTime;
    let spanName = name;
    const parentSpanId = options.parent?.spanId;
    const span = {
        context() {
            return {
                traceId,
                spanId,
                traceFlags: 1, // Sampled
            };
        },
        getName() {
            return spanName;
        },
        setName(newName) {
            spanName = newName;
            return span;
        },
        setAttribute(key, value) {
            attributes[key] = value;
            return span;
        },
        setAttributes(attrs) {
            Object.assign(attributes, attrs);
            return span;
        },
        addEvent(eventName, eventAttributes) {
            events.push({
                name: eventName,
                timestamp: Date.now(),
                ...(eventAttributes && { attributes: eventAttributes }),
            });
            return span;
        },
        setStatus(newStatus) {
            status = newStatus;
            return span;
        },
        recordException(exception, exceptionAttributes) {
            events.push({
                name: 'exception',
                timestamp: Date.now(),
                attributes: {
                    'exception.type': exception.name,
                    'exception.message': exception.message,
                    'exception.stacktrace': exception.stack,
                    ...exceptionAttributes,
                },
            });
            status = { code: SpanStatusCode.ERROR, message: exception.message };
            return span;
        },
        end() {
            if (endTime === undefined) {
                endTime = Date.now();
            }
        },
        isEnded() {
            return endTime !== undefined;
        },
        isRecording() {
            return !span.isEnded();
        },
        addLink(link) {
            links.push(link);
            return span;
        },
        toJSON() {
            return {
                traceId,
                spanId,
                ...(parentSpanId !== undefined && { parentSpanId }),
                name: spanName,
                kind,
                startTime,
                ...(endTime !== undefined && { endTime }),
                ...(endTime !== undefined && { duration: endTime - startTime }),
                status,
                attributes,
                events,
                links,
            };
        },
    };
    return span;
}
/**
 * Create a tracer instance
 */
export function createTracer(config) {
    let activeSpan;
    let currentTraceId;
    const tracer = {
        startSpan(name, options = {}) {
            const traceId = options.parent?.traceId ?? currentTraceId ?? generateTraceId();
            const parentContext = options.parent ?? (activeSpan ? activeSpan.context() : undefined);
            return createSpan(name, traceId, {
                ...options,
                parent: parentContext ?? null,
            });
        },
        startActiveSpan(name, fn) {
            return tracer.startActiveSpanWithOptions(name, {}, fn);
        },
        startActiveSpanWithOptions(name, options, fn) {
            const parentSpan = activeSpan;
            const parent = options.parent ?? (parentSpan ? parentSpan.context() : null);
            const span = tracer.startSpan(name, {
                ...options,
                ...(parent && { parent }),
            });
            activeSpan = span;
            try {
                const result = fn(span);
                // Handle promises
                if (result instanceof Promise) {
                    return result
                        .then((res) => {
                        if (span.isRecording()) {
                            span.setStatus({ code: SpanStatusCode.OK });
                            span.end();
                        }
                        return res;
                    })
                        .catch((error) => {
                        if (span.isRecording()) {
                            span.recordException(error instanceof Error ? error : new Error(String(error)));
                            span.end();
                        }
                        throw error;
                    })
                        .finally(() => {
                        activeSpan = parentSpan;
                    });
                }
                // Synchronous case
                if (span.isRecording()) {
                    span.setStatus({ code: SpanStatusCode.OK });
                    span.end();
                }
                activeSpan = parentSpan;
                return result;
            }
            catch (error) {
                if (span.isRecording()) {
                    span.recordException(error instanceof Error ? error : new Error(String(error)));
                    span.end();
                }
                activeSpan = parentSpan;
                throw error;
            }
        },
        getActiveSpan() {
            return activeSpan;
        },
        setActiveSpan(span) {
            activeSpan = span;
        },
        getName() {
            return config.name;
        },
        getTraceContext() {
            return activeSpan?.context();
        },
        withTrace(traceId) {
            currentTraceId = traceId ?? generateTraceId();
            return tracer;
        },
    };
    return tracer;
}
/**
 * Global tracer instance
 */
let globalTracer;
/**
 * Get or create the global tracer
 */
export function getTracer(name = 'dotdo') {
    if (!globalTracer) {
        globalTracer = createTracer({ name });
    }
    return globalTracer;
}
/**
 * Set the global tracer
 */
export function setGlobalTracer(tracer) {
    globalTracer = tracer;
}
/**
 * W3C Trace Context header names
 */
export const TRACEPARENT_HEADER = 'traceparent';
export const TRACESTATE_HEADER = 'tracestate';
/**
 * Parse W3C traceparent header
 * Format: version-traceId-spanId-traceFlags
 * Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 */
export function parseTraceparent(header) {
    const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(header);
    if (!match)
        return null;
    const [, traceId, spanId, flags] = match;
    return {
        traceId: traceId,
        spanId: spanId,
        traceFlags: parseInt(flags, 16),
    };
}
/**
 * Format span context as W3C traceparent header
 */
export function formatTraceparent(context) {
    const flags = context.traceFlags.toString(16).padStart(2, '0');
    return `00-${context.traceId}-${context.spanId}-${flags}`;
}
/**
 * Extract trace context from HTTP headers
 */
export function extractTraceContext(headers) {
    const traceparent = headers instanceof Headers
        ? headers.get(TRACEPARENT_HEADER)
        : headers[TRACEPARENT_HEADER];
    if (!traceparent)
        return null;
    const context = parseTraceparent(traceparent);
    if (!context)
        return null;
    const tracestate = headers instanceof Headers
        ? headers.get(TRACESTATE_HEADER)
        : headers[TRACESTATE_HEADER];
    if (tracestate) {
        context.traceState = tracestate;
    }
    return context;
}
/**
 * Inject trace context into HTTP headers
 */
export function injectTraceContext(headers, context) {
    headers.set(TRACEPARENT_HEADER, formatTraceparent(context));
    if (context.traceState) {
        headers.set(TRACESTATE_HEADER, context.traceState);
    }
}
/**
 * Console span exporter for development
 */
export function createConsoleExporter() {
    const logger = createStructuredLogger({ service: 'trace-exporter' });
    return {
        async export(spans) {
            for (const span of spans) {
                const logContext = {
                    traceId: span.traceId,
                    spanId: span.spanId,
                };
                const childLogger = logger.child(logContext);
                childLogger.info(`Span: ${span.name}`, {
                    kind: span.kind,
                    duration: span.duration,
                    status: span.status,
                    attributes: span.attributes,
                    events: span.events.length > 0 ? span.events : undefined,
                });
            }
        },
        async shutdown() {
            // No cleanup needed for console exporter
        },
    };
}
/**
 * Create a simple batch span processor
 */
export function createBatchSpanProcessor(exporter, options = {}) {
    const { maxQueueSize = 2048, scheduledDelayMs = 5000, maxExportBatchSize = 512, } = options;
    const queue = [];
    let flushTimer;
    async function flush() {
        if (queue.length === 0)
            return;
        const batch = queue.splice(0, maxExportBatchSize);
        try {
            await exporter.export(batch);
        }
        catch (error) {
            console.error('Failed to export spans:', error);
        }
    }
    function scheduleFlush() {
        if (!flushTimer) {
            flushTimer = setTimeout(async () => {
                flushTimer = undefined;
                await flush();
                if (queue.length > 0) {
                    scheduleFlush();
                }
            }, scheduledDelayMs);
        }
    }
    return {
        onStart(_span) {
            // No-op for simple processor
        },
        onEnd(span) {
            if (queue.length >= maxQueueSize) {
                // Drop oldest span if queue is full
                queue.shift();
            }
            queue.push(span.toJSON());
            scheduleFlush();
        },
        async forceFlush() {
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = undefined;
            }
            while (queue.length > 0) {
                await flush();
            }
        },
        async shutdown() {
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = undefined;
            }
            await flush();
            await exporter.shutdown();
        },
    };
}
/**
 * Instrumented function wrapper for automatic span creation
 */
export function instrument(name, fn, options = {}) {
    const tracer = options.tracer ?? getTracer();
    return ((...args) => {
        return tracer.startActiveSpanWithOptions(name, {
            ...(options.kind !== undefined && { kind: options.kind }),
            ...(options.attributes !== undefined && { attributes: options.attributes }),
        }, (span) => {
            return fn(...args);
        });
    });
}
//# sourceMappingURL=tracing.js.map