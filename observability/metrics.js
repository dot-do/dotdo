/**
 * Metrics Collection for dotdo
 *
 * Provides a lightweight metrics collection system compatible with
 * OpenTelemetry Metrics semantic conventions:
 * - Counters for monotonically increasing values (requests, errors)
 * - Gauges for point-in-time measurements (connections, queue size)
 * - Histograms for distributions (latency, request sizes)
 * - Labels/attributes for dimensional data
 *
 * @module observability/metrics
 */
/**
 * Metric types following OpenTelemetry conventions
 */
export var MetricType;
(function (MetricType) {
    MetricType["COUNTER"] = "counter";
    MetricType["GAUGE"] = "gauge";
    MetricType["HISTOGRAM"] = "histogram";
})(MetricType || (MetricType = {}));
/**
 * Serialize attributes to a consistent string key
 */
function attributesToKey(attributes) {
    if (!attributes || Object.keys(attributes).length === 0) {
        return '';
    }
    const sorted = Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(sorted);
}
/**
 * Default histogram boundaries (exponential)
 */
const DEFAULT_HISTOGRAM_BOUNDARIES = [
    0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000,
];
/**
 * Internal counter implementation
 */
function createCounterImpl(name, _options) {
    const values = new Map();
    return {
        add(value, attributes) {
            if (value < 0) {
                throw new Error('Counter can only be incremented with positive values');
            }
            const key = attributesToKey(attributes);
            values.set(key, (values.get(key) ?? 0) + value);
        },
        inc(attributes) {
            this.add(1, attributes);
        },
        getValue(attributes) {
            const key = attributesToKey(attributes);
            return values.get(key) ?? 0;
        },
    };
}
/**
 * Internal gauge implementation
 */
function createGaugeImpl(name, _options) {
    const values = new Map();
    return {
        set(value, attributes) {
            const key = attributesToKey(attributes);
            values.set(key, value);
        },
        add(value, attributes) {
            const key = attributesToKey(attributes);
            values.set(key, (values.get(key) ?? 0) + value);
        },
        getValue(attributes) {
            const key = attributesToKey(attributes);
            return values.get(key) ?? 0;
        },
    };
}
/**
 * Internal histogram implementation
 */
function createHistogramImpl(name, options) {
    const boundaries = options?.boundaries ?? DEFAULT_HISTOGRAM_BOUNDARIES;
    const data = new Map();
    function initBuckets() {
        return {
            boundaries: [...boundaries],
            counts: new Array(boundaries.length + 1).fill(0),
            sum: 0,
            count: 0,
            min: Infinity,
            max: -Infinity,
        };
    }
    return {
        record(value, attributes) {
            const key = attributesToKey(attributes);
            let buckets = data.get(key);
            if (!buckets) {
                buckets = initBuckets();
                data.set(key, buckets);
            }
            // Update statistics
            buckets.sum += value;
            buckets.count += 1;
            buckets.min = Math.min(buckets.min, value);
            buckets.max = Math.max(buckets.max, value);
            // Find bucket and increment
            let bucketIndex = boundaries.length; // overflow bucket
            for (let i = 0; i < boundaries.length; i++) {
                if (value <= boundaries[i]) {
                    bucketIndex = i;
                    break;
                }
            }
            buckets.counts[bucketIndex]++;
        },
        getData(attributes) {
            const key = attributesToKey(attributes);
            const buckets = data.get(key);
            if (!buckets)
                return undefined;
            return { ...buckets, counts: [...buckets.counts] };
        },
    };
}
/**
 * Create a meter for collecting metrics
 */
export function createMeter(config) {
    const counters = new Map();
    const gauges = new Map();
    const histograms = new Map();
    return {
        createCounter(name, options) {
            const existing = counters.get(name);
            if (existing)
                return existing.counter;
            const values = new Map();
            const counter = {
                add(value, attributes) {
                    if (value < 0) {
                        throw new Error('Counter can only be incremented with positive values');
                    }
                    const key = attributesToKey(attributes);
                    values.set(key, (values.get(key) ?? 0) + value);
                },
                inc(attributes) {
                    this.add(1, attributes);
                },
                getValue(attributes) {
                    const key = attributesToKey(attributes);
                    return values.get(key) ?? 0;
                },
            };
            counters.set(name, { counter, ...(options !== undefined && { options }), values });
            return counter;
        },
        createGauge(name, options) {
            const existing = gauges.get(name);
            if (existing)
                return existing.gauge;
            const values = new Map();
            const gauge = {
                set(value, attributes) {
                    const key = attributesToKey(attributes);
                    values.set(key, value);
                },
                add(value, attributes) {
                    const key = attributesToKey(attributes);
                    values.set(key, (values.get(key) ?? 0) + value);
                },
                getValue(attributes) {
                    const key = attributesToKey(attributes);
                    return values.get(key) ?? 0;
                },
            };
            gauges.set(name, { gauge, ...(options !== undefined && { options }), values });
            return gauge;
        },
        createHistogram(name, options) {
            const existing = histograms.get(name);
            if (existing)
                return existing.histogram;
            const boundaries = options?.boundaries ?? DEFAULT_HISTOGRAM_BOUNDARIES;
            const data = new Map();
            function initBuckets() {
                return {
                    boundaries: [...boundaries],
                    counts: new Array(boundaries.length + 1).fill(0),
                    sum: 0,
                    count: 0,
                    min: Infinity,
                    max: -Infinity,
                };
            }
            const histogram = {
                record(value, attributes) {
                    const key = attributesToKey(attributes);
                    let buckets = data.get(key);
                    if (!buckets) {
                        buckets = initBuckets();
                        data.set(key, buckets);
                    }
                    buckets.sum += value;
                    buckets.count += 1;
                    buckets.min = Math.min(buckets.min, value);
                    buckets.max = Math.max(buckets.max, value);
                    let bucketIndex = boundaries.length;
                    for (let i = 0; i < boundaries.length; i++) {
                        if (value <= boundaries[i]) {
                            bucketIndex = i;
                            break;
                        }
                    }
                    buckets.counts[bucketIndex]++;
                },
                getData(attributes) {
                    const key = attributesToKey(attributes);
                    const buckets = data.get(key);
                    if (!buckets)
                        return undefined;
                    return { ...buckets, counts: [...buckets.counts] };
                },
            };
            histograms.set(name, { histogram, ...(options !== undefined && { options }), data });
            return histogram;
        },
        collect() {
            const timestamp = Date.now();
            const points = [];
            // Collect counter values
            for (const [name, { values }] of counters) {
                for (const [key, value] of values) {
                    points.push({
                        name,
                        type: MetricType.COUNTER,
                        value,
                        timestamp,
                        attributes: key ? JSON.parse(key).reduce((acc, [k, v]) => {
                            acc[k] = v;
                            return acc;
                        }, {}) : {},
                    });
                }
            }
            // Collect gauge values
            for (const [name, { values }] of gauges) {
                for (const [key, value] of values) {
                    points.push({
                        name,
                        type: MetricType.GAUGE,
                        value,
                        timestamp,
                        attributes: key ? JSON.parse(key).reduce((acc, [k, v]) => {
                            acc[k] = v;
                            return acc;
                        }, {}) : {},
                    });
                }
            }
            // Collect histogram values (as count for simplicity)
            for (const [name, { data }] of histograms) {
                for (const [key, buckets] of data) {
                    points.push({
                        name,
                        type: MetricType.HISTOGRAM,
                        value: buckets.count,
                        timestamp,
                        attributes: key ? JSON.parse(key).reduce((acc, [k, v]) => {
                            acc[k] = v;
                            return acc;
                        }, {}) : {},
                    });
                }
            }
            return points;
        },
        reset() {
            counters.clear();
            gauges.clear();
            histograms.clear();
        },
    };
}
/**
 * Global meter instance
 */
let globalMeter;
/**
 * Get or create the global meter
 */
export function getMeter(name = 'dotdo') {
    if (!globalMeter) {
        globalMeter = createMeter({ name });
    }
    return globalMeter;
}
/**
 * Set the global meter
 */
export function setGlobalMeter(meter) {
    globalMeter = meter;
}
/**
 * Console metrics exporter for development
 */
export function createConsoleMetricsExporter() {
    return {
        async export(metrics) {
            for (const metric of metrics) {
                console.log(`[METRIC] ${metric.name} (${metric.type}): ${metric.value}`, Object.keys(metric.attributes).length > 0 ? metric.attributes : '');
            }
        },
        async shutdown() {
            // No cleanup needed
        },
    };
}
/**
 * Create a periodic metrics reporter
 */
export function createPeriodicReporter(meter, exporter, intervalMs = 60000) {
    let timer;
    return {
        start() {
            if (timer)
                return;
            timer = setInterval(async () => {
                const metrics = meter.collect();
                if (metrics.length > 0) {
                    await exporter.export(metrics);
                }
            }, intervalMs);
        },
        stop() {
            if (timer) {
                clearInterval(timer);
                timer = undefined;
            }
        },
        async flush() {
            const metrics = meter.collect();
            if (metrics.length > 0) {
                await exporter.export(metrics);
            }
        },
    };
}
/**
 * Common metric names following OpenTelemetry semantic conventions
 */
export const MetricNames = {
    // HTTP metrics
    HTTP_REQUEST_DURATION: 'http.server.request.duration',
    HTTP_REQUEST_SIZE: 'http.server.request.body.size',
    HTTP_RESPONSE_SIZE: 'http.server.response.body.size',
    HTTP_ACTIVE_REQUESTS: 'http.server.active_requests',
    // DO metrics
    DO_REQUEST_DURATION: 'do.request.duration',
    DO_STORAGE_OPERATIONS: 'do.storage.operations',
    DO_ALARM_EXECUTIONS: 'do.alarm.executions',
    DO_WEBSOCKET_CONNECTIONS: 'do.websocket.connections',
    // RPC metrics
    RPC_REQUEST_DURATION: 'rpc.request.duration',
    RPC_REQUEST_COUNT: 'rpc.request.count',
    RPC_ERROR_COUNT: 'rpc.error.count',
    // Event metrics
    EVENT_EMIT_COUNT: 'event.emit.count',
    EVENT_HANDLER_DURATION: 'event.handler.duration',
    EVENT_DLQ_SIZE: 'event.dlq.size',
};
//# sourceMappingURL=metrics.js.map