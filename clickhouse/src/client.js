/**
 * @dotdo/clickhouse - Analytics Client
 *
 * High-level analytics client that wraps chdb WASM with a clean API.
 * Handles lazy loading, caching, and storage provider abstraction.
 */
// =============================================================================
// ClickHouse Client Implementation
// =============================================================================
/**
 * Create a ClickHouse analytics client
 *
 * This lazily loads the chdb WASM module when first query is executed.
 */
export async function createClickHouseClient(storage, config = {}) {
    const client = new ClickHouseClientImpl(storage, config);
    await client.initialize();
    return client;
}
/**
 * Internal implementation
 */
class ClickHouseClientImpl {
    storage;
    config;
    wasmModule = null;
    eventBuffer = [];
    cache = new Map();
    // Buffer configuration
    BUFFER_FLUSH_SIZE = 100;
    /** Flush buffer every 5 seconds to ensure timely data persistence */
    BUFFER_FLUSH_INTERVAL = 5000;
    /** Cache query results for 1 minute to reduce redundant computations */
    CACHE_TTL = 60000;
    constructor(storage, config) {
        this.storage = storage;
        this.config = {
            profile: config.profile ?? 'standard',
            r2: config.r2,
            storage: config.storage ?? storage,
            namespace: config.namespace ?? 'default',
            maxMemory: config.maxMemory ?? 64 * 1024 * 1024,
            cacheSize: config.cacheSize ?? 16 * 1024 * 1024,
            writeBufferSize: config.writeBufferSize ?? 256 * 1024
        };
    }
    async initialize() {
        // Create events table schema in DO storage (hot data)
        await this.ensureSchema();
    }
    // ===========================================================================
    // Event Tracking
    // ===========================================================================
    async track(input) {
        const event = {
            type: input.type,
            timestamp: Date.now(),
            properties: input.properties ?? {},
            visitorId: input.visitorId,
            sessionId: input.sessionId
        };
        this.eventBuffer.push(event);
        if (this.eventBuffer.length >= this.BUFFER_FLUSH_SIZE) {
            await this.flushEventBuffer();
        }
    }
    async pageview(input) {
        const url = new URL(input.url);
        const properties = {
            url: input.url,
            path: url.pathname,
            ...input.properties
        };
        if (input.referrer !== undefined)
            properties.referrer = input.referrer;
        if (input.title !== undefined)
            properties.title = input.title;
        const event = {
            type: 'page_view',
            timestamp: Date.now(),
            properties,
            visitorId: input.visitorId ?? this.generateVisitorId(),
            sessionId: input.sessionId
        };
        this.eventBuffer.push(event);
        if (this.eventBuffer.length >= this.BUFFER_FLUSH_SIZE) {
            await this.flushEventBuffer();
        }
    }
    async trackBatch(events) {
        const now = Date.now();
        const fullEvents = events.map(e => ({
            type: e.type,
            timestamp: now,
            properties: e.properties ?? {},
            visitorId: e.visitorId,
            sessionId: e.sessionId
        }));
        this.eventBuffer.push(...fullEvents);
        if (this.eventBuffer.length >= this.BUFFER_FLUSH_SIZE) {
            await this.flushEventBuffer();
        }
    }
    // ===========================================================================
    // Query Execution
    // ===========================================================================
    async query(sql, options) {
        const module = await this.ensureWasmModule();
        const startTime = performance.now();
        const executeOptions = {
            format: options?.format ?? 'JSONEachRow'
        };
        if (options?.limit !== undefined) {
            executeOptions.maxRows = options.limit;
        }
        const result = await module.execute(sql, executeOptions);
        const elapsed = performance.now() - startTime;
        const statistics = {
            elapsed,
            rowsRead: result.statistics?.rowsRead ?? 0,
            bytesRead: result.statistics?.bytesRead ?? 0
        };
        if (result.statistics?.memoryUsage !== undefined) {
            statistics.memoryUsage = result.statistics.memoryUsage;
        }
        const queryResult = {
            data: result.data,
            meta: result.meta,
            rows: result.rows,
            statistics
        };
        if (result.extensions !== undefined) {
            queryResult.extensions = result.extensions;
        }
        return queryResult;
    }
    async queryWithParams(sql, params, options) {
        // Replace {paramName:Type} placeholders with actual values
        let processedSql = sql;
        for (const [key, value] of Object.entries(params)) {
            const regex = new RegExp(`\\{${key}:\\w+\\}`, 'g');
            processedSql = processedSql.replace(regex, this.formatValue(value));
        }
        return this.query(processedSql, options);
    }
    async *queryStream(sql, options) {
        const module = await this.ensureWasmModule();
        const streamOptions = {
            format: 'JSONEachRow'
        };
        if (options?.limit !== undefined) {
            streamOptions.maxRows = options.limit;
        }
        const stream = await module.executeStream(sql, streamOptions);
        for await (const row of stream) {
            yield row;
        }
    }
    // ===========================================================================
    // Pre-built Analytics
    // ===========================================================================
    async funnel(steps, period) {
        const conditions = steps.map((step, i) => {
            const filterConditions = step.filter
                ? Object.entries(step.filter)
                    .map(([k, v]) => `JSONExtractString(properties, '${k}') = ${this.formatValue(v)}`)
                    .join(' AND ')
                : '1=1';
            return `
        countIf(type = '${step.event}' AND ${filterConditions}) as step_${i}
      `;
        });
        const sql = `
      SELECT
        visitorId,
        ${conditions.join(',\n        ')}
      FROM events
      WHERE timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY visitorId
    `;
        const result = await this.query(sql);
        // Calculate funnel metrics
        const stepCounts = steps.map((_, i) => result.data.filter(row => (row[`step_${i}`] ?? 0) > 0).length);
        const firstStepCount = stepCounts[0] ?? 0;
        const lastStepCount = stepCounts[stepCounts.length - 1] ?? 0;
        return {
            steps: steps.map((step, i) => {
                const currentCount = stepCounts[i] ?? 0;
                const prevCount = i > 0 ? (stepCounts[i - 1] ?? 1) : 1;
                return {
                    name: step.name,
                    count: currentCount,
                    conversionRate: i === 0 ? 1 : currentCount / (prevCount || 1),
                    dropoffRate: i === 0 ? 0 : 1 - (currentCount / (prevCount || 1))
                };
            }),
            overallConversionRate: lastStepCount / (firstStepCount || 1)
        };
    }
    async retention(cohortEvent, returnEvent, period, granularity = 'week') {
        const truncFunc = granularity === 'day' ? 'toDate' :
            granularity === 'week' ? 'toStartOfWeek' : 'toStartOfMonth';
        const sql = `
      WITH cohorts AS (
        SELECT
          visitorId,
          ${truncFunc}(fromUnixTimestamp64Milli(timestamp)) as cohort_period
        FROM events
        WHERE type = '${cohortEvent}'
          AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        GROUP BY visitorId, cohort_period
      ),
      returns AS (
        SELECT
          c.visitorId,
          c.cohort_period,
          ${truncFunc}(fromUnixTimestamp64Milli(e.timestamp)) as return_period
        FROM cohorts c
        JOIN events e ON c.visitorId = e.visitorId
        WHERE e.type = '${returnEvent}'
          AND e.timestamp >= c.cohort_period
      )
      SELECT
        cohort_period,
        return_period,
        count(DISTINCT visitorId) as users
      FROM returns
      GROUP BY cohort_period, return_period
      ORDER BY cohort_period, return_period
    `;
        const result = await this.query(sql);
        // Transform into cohort retention format
        const cohortsMap = new Map();
        for (const row of result.data) {
            if (!cohortsMap.has(row.cohort_period)) {
                cohortsMap.set(row.cohort_period, new Map());
            }
            cohortsMap.get(row.cohort_period).set(row.return_period, row.users);
        }
        const periods = Array.from(new Set(result.data.map(r => r.return_period))).sort();
        const cohorts = Array.from(cohortsMap.entries()).map(([cohort, returns]) => {
            const size = returns.get(cohort) ?? 0;
            return {
                cohort,
                size,
                retention: periods.map(p => {
                    const users = returns.get(p) ?? 0;
                    return size > 0 ? users / size : 0;
                })
            };
        });
        return { cohorts, periods };
    }
    async segment(property, metric, period) {
        const sql = `
      SELECT
        JSONExtractString(properties, '${property}') as segment,
        ${metric === 'count' ? 'count()' : `sum(JSONExtractFloat(properties, '${metric}'))`} as value,
        count() as count
      FROM events
      WHERE timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        AND JSONHas(properties, '${property}')
      GROUP BY segment
      ORDER BY value DESC
    `;
        const result = await this.query(sql);
        return result.data;
    }
    // ===========================================================================
    // SaaS Metrics
    // ===========================================================================
    async calculateSaaSMetrics(period) {
        // Get subscription events
        const mrrResult = await this.query(`
      SELECT
        type,
        sum(JSONExtractFloat(properties, 'mrr')) as mrr
      FROM events
      WHERE timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        AND type IN ('subscription.created', 'subscription.upgraded', 'subscription.downgraded', 'subscription.cancelled')
      GROUP BY type
    `);
        const mrrByType = new Map(mrrResult.data.map(r => [r.type, r.mrr]));
        const newMRR = mrrByType.get('subscription.created') ?? 0;
        const expansionMRR = mrrByType.get('subscription.upgraded') ?? 0;
        const contractionMRR = mrrByType.get('subscription.downgraded') ?? 0;
        const churnedMRR = mrrByType.get('subscription.cancelled') ?? 0;
        // Get beginning MRR (from previous period or stored value)
        const beginningMRR = await this.getStoredMRR(period.start);
        const currentMRR = beginningMRR + newMRR + expansionMRR - contractionMRR - churnedMRR;
        const netNewMRR = newMRR + expansionMRR - contractionMRR - churnedMRR;
        const mrr = {
            current: currentMRR,
            new: newMRR,
            expansion: expansionMRR,
            contraction: contractionMRR,
            churned: churnedMRR,
            netNew: netNewMRR,
            beginning: beginningMRR,
            growthRate: beginningMRR > 0 ? netNewMRR / beginningMRR : 0
        };
        // Churn metrics
        const churnResult = await this.query(`
      SELECT
        countIf(type = 'subscription.cancelled') as churnedCustomers,
        count(DISTINCT JSONExtractString(properties, 'customerId')) as totalCustomers
      FROM events
      WHERE timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        AND type LIKE 'subscription.%'
    `);
        const churnData = churnResult.data[0] ?? { churnedCustomers: 0, totalCustomers: 0 };
        const churn = {
            customerChurnRate: churnData.totalCustomers > 0
                ? churnData.churnedCustomers / churnData.totalCustomers
                : 0,
            revenueChurnRate: beginningMRR > 0 ? churnedMRR / beginningMRR : 0,
            netRevenueChurn: beginningMRR > 0
                ? (churnedMRR + contractionMRR - expansionMRR) / beginningMRR
                : 0,
            churnedCustomers: churnData.churnedCustomers,
            churnedRevenue: churnedMRR
        };
        // LTV metrics (simplified)
        const avgMRR = currentMRR / Math.max(churnData.totalCustomers, 1);
        const monthlyChurnRate = churn.customerChurnRate;
        const avgLifetimeMonths = monthlyChurnRate > 0 ? 1 / monthlyChurnRate : 24; // Default to 24 months
        const ltv = {
            average: avgMRR * avgLifetimeMonths
        };
        const result = {
            mrr,
            arr: currentMRR * 12,
            churn,
            ltv,
            nrr: beginningMRR > 0
                ? (beginningMRR + expansionMRR - contractionMRR - churnedMRR) / beginningMRR
                : 1,
            grr: beginningMRR > 0
                ? (beginningMRR - contractionMRR - churnedMRR) / beginningMRR
                : 1
        };
        if ((churnedMRR + contractionMRR) > 0) {
            result.quickRatio = (newMRR + expansionMRR) / (churnedMRR + contractionMRR);
        }
        return result;
    }
    async getCurrentMRR() {
        const result = await this.query(`
      SELECT sum(JSONExtractFloat(properties, 'mrr')) as mrr
      FROM events
      WHERE type = 'subscription.active'
      ORDER BY timestamp DESC
      LIMIT 1
    `);
        return result.data[0]?.mrr ?? 0;
    }
    async getMRRHistory(period) {
        const result = await this.query(`
      SELECT
        toDate(fromUnixTimestamp64Milli(timestamp)) as date,
        sum(JSONExtractFloat(properties, 'mrr')) as mrr
      FROM events
      WHERE type = 'subscription.snapshot'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY date
      ORDER BY date
    `);
        return result.data;
    }
    // ===========================================================================
    // Web Analytics
    // ===========================================================================
    async getWebAnalytics(period) {
        const result = await this.query(`
      WITH session_data AS (
        SELECT
          sessionId,
          count() as pages,
          max(timestamp) - min(timestamp) as duration
        FROM events
        WHERE type = 'page_view'
          AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        GROUP BY sessionId
      )
      SELECT
        count() as pageViews,
        count(DISTINCT visitorId) as uniqueVisitors,
        count(DISTINCT sessionId) as sessions,
        avg(duration) / 1000 as avgSessionDuration,
        countIf(pages = 1) / count() as bounceRate,
        avg(pages) as pagesPerSession
      FROM events e
      LEFT JOIN session_data s ON e.sessionId = s.sessionId
      WHERE e.type = 'page_view'
        AND e.timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
    `);
        const topPages = await this.query(`
      SELECT
        JSONExtractString(properties, 'path') as path,
        count() as views,
        count(DISTINCT visitorId) as uniqueVisitors
      FROM events
      WHERE type = 'page_view'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY path
      ORDER BY views DESC
      LIMIT 10
    `);
        const topReferrers = await this.query(`
      SELECT
        JSONExtractString(properties, 'referrer') as referrer,
        count() as visits
      FROM events
      WHERE type = 'page_view'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        AND referrer != ''
      GROUP BY referrer
      ORDER BY visits DESC
      LIMIT 10
    `);
        const devices = await this.query(`
      SELECT
        if(JSONExtractBool(device, 'mobile'), 'mobile',
           if(JSONExtractString(device, 'platform') LIKE '%tablet%', 'tablet', 'desktop')) as deviceType,
        count() as count
      FROM events
      WHERE type = 'page_view'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY deviceType
    `);
        const countries = await this.query(`
      SELECT
        JSONExtractString(geo, 'country') as country,
        count(DISTINCT visitorId) as visitors
      FROM events
      WHERE type = 'page_view'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY country
      ORDER BY visitors DESC
      LIMIT 10
    `);
        const deviceMap = new Map(devices.data.map(d => [d.deviceType, d.count]));
        const baseData = result.data[0];
        return {
            pageViews: baseData?.pageViews ?? 0,
            uniqueVisitors: baseData?.uniqueVisitors ?? 0,
            sessions: baseData?.sessions ?? 0,
            avgSessionDuration: baseData?.avgSessionDuration ?? 0,
            bounceRate: baseData?.bounceRate ?? 0,
            pagesPerSession: baseData?.pagesPerSession ?? 0,
            topPages: topPages.data,
            topReferrers: topReferrers.data,
            devices: {
                desktop: deviceMap.get('desktop') ?? 0,
                mobile: deviceMap.get('mobile') ?? 0,
                tablet: deviceMap.get('tablet') ?? 0
            },
            countries: countries.data
        };
    }
    async getRealTimeVisitors(minutes = 5) {
        const since = Date.now() - minutes * 60 * 1000;
        const result = await this.query(`
      SELECT count(DISTINCT visitorId) as count
      FROM events
      WHERE type = 'page_view'
        AND timestamp >= ${since}
    `);
        return result.data[0]?.count ?? 0;
    }
    // ===========================================================================
    // Product Analytics
    // ===========================================================================
    async getProductAnalytics(productId, period) {
        const overview = await this.query(`
      SELECT
        count() as totalEvents,
        count(DISTINCT visitorId) as uniqueUsers,
        countIf(type = 'product.purchased') as conversions,
        sumIf(JSONExtractFloat(properties, 'value'), type = 'product.purchased') as revenue
      FROM events
      WHERE JSONExtractString(properties, 'productId') = '${productId}'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
    `);
        const daily = await this.query(`
      SELECT
        toDate(fromUnixTimestamp64Milli(timestamp)) as date,
        count() as events,
        count(DISTINCT visitorId) as uniqueUsers,
        countIf(type = 'product.purchased') as conversions,
        sumIf(JSONExtractFloat(properties, 'value'), type = 'product.purchased') as revenue
      FROM events
      WHERE JSONExtractString(properties, 'productId') = '${productId}'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY date
      ORDER BY date
    `);
        const data = overview.data[0] ?? { totalEvents: 0, uniqueUsers: 0, conversions: 0, revenue: 0 };
        return {
            productId,
            period,
            ...data,
            conversionRate: data.uniqueUsers > 0 ? data.conversions / data.uniqueUsers : 0,
            daily: daily.data
        };
    }
    // ===========================================================================
    // Experiments
    // ===========================================================================
    async getExperimentResults(experimentKey) {
        // Get experiment config from storage
        const experiment = await this.storage.get(`experiment:${experimentKey}`);
        if (!experiment) {
            throw new Error(`Experiment '${experimentKey}' not found`);
        }
        const result = await this.query(`
      WITH assignments AS (
        SELECT
          visitorId,
          JSONExtractString(properties, 'variantKey') as variantKey
        FROM events
        WHERE type = 'experiment.assigned'
          AND JSONExtractString(properties, 'experimentKey') = '${experimentKey}'
      ),
      conversions AS (
        SELECT visitorId
        FROM events
        WHERE type = '${experiment.targetMetric}'
      )
      SELECT
        a.variantKey,
        count(DISTINCT a.visitorId) as participants,
        count(DISTINCT c.visitorId) as conversions
      FROM assignments a
      LEFT JOIN conversions c ON a.visitorId = c.visitorId
      GROUP BY a.variantKey
    `);
        const controlVariant = experiment.variants.find(v => v.isControl);
        const controlData = result.data.find(r => r.variantKey === controlVariant?.key);
        const controlRate = controlData && controlData.participants > 0
            ? controlData.conversions / controlData.participants
            : 0;
        const variants = experiment.variants.map(variant => {
            const data = result.data.find(r => r.variantKey === variant.key);
            const participants = data?.participants ?? 0;
            const conversions = data?.conversions ?? 0;
            const conversionRate = participants > 0 ? conversions / participants : 0;
            const variantResult = {
                variant,
                participants,
                conversions,
                conversionRate
            };
            const improvement = controlRate > 0 ? (conversionRate - controlRate) / controlRate : undefined;
            if (improvement !== undefined) {
                variantResult.improvement = improvement;
            }
            const pValue = this.calculatePValue(controlData, data);
            if (pValue !== undefined) {
                variantResult.pValue = pValue;
            }
            const confidenceInterval = this.calculateCI(conversionRate, participants);
            if (confidenceInterval !== undefined) {
                variantResult.confidenceInterval = confidenceInterval;
            }
            return variantResult;
        });
        // Determine significance and winner
        const significantVariants = variants.filter(v => !v.variant.isControl && v.pValue !== undefined && v.pValue < 0.05);
        const winnerKey = significantVariants.length > 0
            ? significantVariants.reduce((best, v) => (v.improvement ?? 0) > (best.improvement ?? 0) ? v : best).variant.key
            : undefined;
        const experimentResults = {
            experiment,
            variants,
            isSignificant: significantVariants.length > 0
        };
        if (winnerKey !== undefined) {
            experimentResults.winner = winnerKey;
        }
        return experimentResults;
    }
    // ===========================================================================
    // Lifecycle
    // ===========================================================================
    async flush() {
        await this.flushEventBuffer();
    }
    clearCache() {
        this.cache.clear();
    }
    getMemoryStats() {
        const eventBufferSize = this.eventBuffer.length * 200; // Estimate 200 bytes per event
        const cacheSize = Array.from(this.cache.values())
            .reduce((sum, entry) => sum + JSON.stringify(entry.data).length, 0);
        return {
            wasmHeap: this.wasmModule?.getMemoryUsage() ?? 0,
            cache: cacheSize,
            writeBuffer: eventBufferSize,
            total: (this.wasmModule?.getMemoryUsage() ?? 0) + cacheSize + eventBufferSize
        };
    }
    async dispose() {
        await this.flushEventBuffer();
        if (this.wasmModule) {
            this.wasmModule.dispose();
            this.wasmModule = null;
        }
        this.cache.clear();
    }
    // ===========================================================================
    // Private Helpers
    // ===========================================================================
    async ensureSchema() {
        // Initialize events table schema
        // This uses DO SQLite for hot data storage
        await this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        visitorId TEXT,
        sessionId TEXT,
        properties TEXT NOT NULL,
        device TEXT,
        geo TEXT
      )
    `);
        await this.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)
    `);
        await this.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)
    `);
        await this.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitorId)
    `);
    }
    async ensureWasmModule() {
        if (!this.wasmModule) {
            // Lazy load the WASM module
            this.wasmModule = await loadChdbModule(this.config.profile);
        }
        return this.wasmModule;
    }
    async flushEventBuffer() {
        if (this.eventBuffer.length === 0)
            return;
        const events = this.eventBuffer.splice(0);
        // Insert into DO SQLite (hot storage)
        for (const event of events) {
            this.storage.sql.exec(`
        INSERT INTO events (id, type, timestamp, visitorId, sessionId, properties, device, geo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, crypto.randomUUID(), event.type, event.timestamp, event.visitorId ?? null, event.sessionId ?? null, JSON.stringify(event.properties), event.device ? JSON.stringify(event.device) : null, event.geo ? JSON.stringify(event.geo) : null);
        }
        // R2 cold storage integration (not yet implemented)
        // When enabled, batch write events to R2 as Parquet or MergeTree parts
        if (this.config.r2) {
            // Reserved for future R2 cold storage implementation
        }
    }
    async getStoredMRR(asOf) {
        // Get the most recent MRR snapshot before the given date
        const result = await this.storage.sql.exec(`
      SELECT properties FROM events
      WHERE type = 'mrr.snapshot'
        AND timestamp < ?
      ORDER BY timestamp DESC
      LIMIT 1
    `, asOf.getTime());
        const row = result.one();
        if (row) {
            const props = JSON.parse(row.properties);
            return props.mrr ?? 0;
        }
        return 0;
    }
    generateVisitorId() {
        // Generate a privacy-safe visitor ID
        // In production, this would use a fingerprinting technique
        return crypto.randomUUID();
    }
    formatValue(value) {
        if (typeof value === 'string') {
            return `'${value.replace(/'/g, "''")}'`;
        }
        if (typeof value === 'number') {
            return String(value);
        }
        if (typeof value === 'boolean') {
            return value ? '1' : '0';
        }
        if (value instanceof Date) {
            return `toDateTime64(${value.getTime()}, 3)`;
        }
        if (value === null || value === undefined) {
            return 'NULL';
        }
        return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
    calculatePValue(control, variant) {
        if (!control || !variant || control.participants === 0 || variant.participants === 0) {
            return undefined;
        }
        // Two-proportion z-test (simplified)
        const p1 = control.conversions / control.participants;
        const p2 = variant.conversions / variant.participants;
        const p = (control.conversions + variant.conversions) /
            (control.participants + variant.participants);
        const se = Math.sqrt(p * (1 - p) * (1 / control.participants + 1 / variant.participants));
        if (se === 0)
            return undefined;
        const z = Math.abs(p2 - p1) / se;
        // Approximate p-value from z-score (two-tailed)
        return 2 * (1 - this.normalCDF(z));
    }
    normalCDF(x) {
        // Approximation of the standard normal CDF
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.sqrt(2);
        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return 0.5 * (1.0 + sign * y);
    }
    calculateCI(rate, n) {
        if (n === 0)
            return undefined;
        // Wilson score interval
        const z = 1.96; // 95% confidence
        const denominator = 1 + z * z / n;
        const centre = (rate + z * z / (2 * n)) / denominator;
        const interval = (z / denominator) * Math.sqrt(rate * (1 - rate) / n + z * z / (4 * n * n));
        return [
            Math.max(0, centre - interval),
            Math.min(1, centre + interval)
        ];
    }
}
/**
 * Load the chdb WASM module
 *
 * This is a placeholder - the actual implementation would load from
 * the @dotdo/clickhouse-wasm package or from a WASM asset.
 */
async function loadChdbModule(_profile) {
    // In production, this would:
    // 1. Check if module is already loaded
    // 2. Fetch the appropriate WASM file based on profile
    // 3. Instantiate with VFS bridge
    // 4. Return the module instance
    // For now, return a stub that throws
    throw new Error('chdb WASM module not yet bundled. ' +
        'Install @dotdo/clickhouse-wasm or configure WASM asset path.');
}
//# sourceMappingURL=client.js.map