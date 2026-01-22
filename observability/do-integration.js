/**
 * Durable Object Integration for Observability
 *
 * Provides observability utilities specifically designed for Durable Objects:
 * - Request tracing across DO boundaries
 * - Storage operation metrics
 * - Alarm execution tracking
 * - WebSocket connection monitoring
 *
 * @module observability/do-integration
 */
import { createMeter, MetricNames } from './metrics';
import { createStructuredLogger } from './logger';
import { createTracer, SpanKind, SpanStatusCode, } from './tracing';
import { createObservabilityContext, } from './context';
/**
 * Create DO-specific metrics
 */
export function createDOMetrics(meter) {
    return {
        requestCount: meter.createCounter(MetricNames.RPC_REQUEST_COUNT, {
            description: 'Number of DO requests',
            unit: 'requests',
        }),
        requestDuration: meter.createHistogram(MetricNames.DO_REQUEST_DURATION, {
            description: 'DO request duration',
            unit: 'ms',
            boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
        }),
        errorCount: meter.createCounter(MetricNames.RPC_ERROR_COUNT, {
            description: 'Number of DO errors',
            unit: 'errors',
        }),
        storageOperations: meter.createCounter(MetricNames.DO_STORAGE_OPERATIONS, {
            description: 'Number of storage operations',
            unit: 'operations',
        }),
        alarmExecutions: meter.createCounter(MetricNames.DO_ALARM_EXECUTIONS, {
            description: 'Number of alarm executions',
            unit: 'executions',
        }),
        websocketConnections: meter.createGauge(MetricNames.DO_WEBSOCKET_CONNECTIONS, {
            description: 'Number of active WebSocket connections',
            unit: 'connections',
        }),
    };
}
/**
 * Create a complete DO observability setup
 */
export function createDOObservability(config = {}) {
    const { serviceName = 'dotdo-do', doId, doClassName, enableTracing = true, enableMetrics = true, enableLogging = true, } = config;
    const doIdStr = doId?.toString() ?? 'unknown';
    // Create base context for all logs
    const baseLogContext = {
        doId: doIdStr,
    };
    if (doClassName) {
        baseLogContext['doClass'] = doClassName;
    }
    // Create observability components
    const logger = createStructuredLogger({ service: serviceName });
    logger.withContext(baseLogContext);
    const tracer = createTracer({ name: serviceName });
    const meter = createMeter({ name: serviceName });
    const metrics = createDOMetrics(meter);
    return {
        logger,
        tracer,
        meter,
        metrics,
        createRequestContext(correlationId, parentTraceContext) {
            const obsCtx = createObservabilityContext({
                ...(correlationId !== undefined && { correlationId }),
                ...(parentTraceContext !== undefined && { traceContext: parentTraceContext }),
            });
            const requestLogger = logger.child({
                correlationId: obsCtx.correlationId,
                ...(parentTraceContext?.traceId && { traceId: parentTraceContext.traceId }),
            });
            const result = {
                logger: requestLogger,
                tracer,
                meter,
                correlationId: obsCtx.correlationId,
            };
            if (parentTraceContext !== undefined) {
                result.traceContext = parentTraceContext;
            }
            return result;
        },
        async wrapMethod(name, fn, context) {
            const startTime = Date.now();
            const attributes = {
                'do.id': doIdStr,
                'do.method': name,
                ...(doClassName && { 'do.class': doClassName }),
            };
            // Track request count
            if (enableMetrics) {
                metrics.requestCount.inc(attributes);
            }
            // Create span if tracing is enabled
            let span;
            if (enableTracing) {
                span = tracer.startSpan(`DO.${name}`, {
                    kind: SpanKind.SERVER,
                    attributes,
                    ...(context?.traceContext && { parent: context.traceContext }),
                });
            }
            // Log method invocation
            if (enableLogging && context) {
                context.logger.debug(`DO method: ${name}`);
            }
            try {
                const result = await fn();
                // Record success
                if (span) {
                    span.setStatus({ code: SpanStatusCode.OK });
                    span.end();
                }
                // Record duration
                if (enableMetrics) {
                    const duration = Date.now() - startTime;
                    metrics.requestDuration.record(duration, attributes);
                }
                return result;
            }
            catch (error) {
                // Record error
                if (enableMetrics) {
                    metrics.errorCount.inc({
                        ...attributes,
                        'error.type': error instanceof Error ? error.name : 'UnknownError',
                    });
                }
                if (span) {
                    span.recordException(error instanceof Error ? error : new Error(String(error)));
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error instanceof Error ? error.message : String(error),
                    });
                    span.end();
                }
                if (enableLogging && context) {
                    context.logger.error(`DO method failed: ${name}`, error instanceof Error ? error : { error: String(error) });
                }
                throw error;
            }
        },
        trackStorageOperation(operation, attributes) {
            if (enableMetrics) {
                metrics.storageOperations.inc({
                    'do.id': doIdStr,
                    'storage.operation': operation,
                    ...(doClassName && { 'do.class': doClassName }),
                    ...attributes,
                });
            }
        },
        trackAlarmExecution(success, duration) {
            if (enableMetrics) {
                metrics.alarmExecutions.inc({
                    'do.id': doIdStr,
                    ...(doClassName && { 'do.class': doClassName }),
                    'alarm.success': success,
                });
            }
            if (enableLogging) {
                if (success) {
                    logger.info(`Alarm executed`, { duration, success });
                }
                else {
                    logger.warn(`Alarm failed`, { duration, success });
                }
            }
        },
        updateWebSocketCount(delta) {
            if (enableMetrics) {
                metrics.websocketConnections.add(delta, {
                    'do.id': doIdStr,
                    ...(doClassName && { 'do.class': doClassName }),
                });
            }
        },
    };
}
/**
 * Extract DO observability context from request headers
 */
export function extractDOContextFromHeaders(headers) {
    const result = {};
    // Extract correlation ID
    const correlationId = headers.get('x-correlation-id');
    if (correlationId) {
        result.correlationId = correlationId;
    }
    // Extract trace context from traceparent header
    const traceparent = headers.get('traceparent');
    if (traceparent) {
        const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(traceparent);
        if (match) {
            result.traceContext = {
                traceId: match[1],
                spanId: match[2],
                traceFlags: parseInt(match[3], 16),
            };
        }
    }
    return result;
}
/**
 * Inject DO observability context into request headers
 */
export function injectDOContextToHeaders(headers, context) {
    // Inject correlation ID
    headers.set('x-correlation-id', context.correlationId);
    // Inject trace context
    if (context.traceContext) {
        const flags = context.traceContext.traceFlags.toString(16).padStart(2, '0');
        headers.set('traceparent', `00-${context.traceContext.traceId}-${context.traceContext.spanId}-${flags}`);
    }
}
/**
 * Create a storage operation tracker for common DO storage patterns
 */
export function createStorageTracker(observability) {
    return {
        trackGet(key) {
            observability.trackStorageOperation('get', { 'storage.key_prefix': key.split('/')[0] ?? 'root' });
        },
        trackPut(key) {
            observability.trackStorageOperation('put', { 'storage.key_prefix': key.split('/')[0] ?? 'root' });
        },
        trackDelete(key) {
            observability.trackStorageOperation('delete', { 'storage.key_prefix': key.split('/')[0] ?? 'root' });
        },
        trackList(prefix) {
            observability.trackStorageOperation('list', { 'storage.key_prefix': prefix ?? 'all' });
        },
        trackTransaction(operationCount) {
            observability.trackStorageOperation('transaction', { 'storage.operation_count': operationCount });
        },
    };
}
//# sourceMappingURL=do-integration.js.map