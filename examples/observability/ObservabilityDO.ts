// Observability Example Durable Object
// Demonstrates: Structured logging, distributed tracing, metrics collection, context propagation
// Key patterns: Request tracing, span hierarchies, metric types (counters/gauges/histograms), log levels

import { Hono } from 'hono'
import { DO, type DOEnv, createContext, type WorkflowContext } from '@dotdo/do'
import {
  // Structured logging
  createStructuredLogger,
  LogLevel,
  type StructuredLogger,
  // Distributed tracing
  createTracer,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  type Span,
  // Metrics collection
  createMeter,
  MetricNames,
  type Meter,
  type Counter,
  type Gauge,
  type Histogram,
  // Context propagation
  runWithContext,
  createObservabilityContext,
  // Hono middleware
  observability,
  getRequestLogger,
  timing,
  requestId,
  // DO integration
  createDOObservability,
  extractDOContextFromHeaders,
  createStorageTracker,
} from '@dotdo/observability'
import type {
  Product,
  Order,
  OrderItem,
  CreateProductRequest,
  CreateOrderRequest,
  MetricsResponse,
} from './types'

export class ObservabilityDO extends DO {
  // ========================================================================
  // Observability Components
  // ========================================================================

  /** Structured logger with service context */
  private logger: StructuredLogger

  /** Distributed tracer for span management */
  private tracer: Tracer

  /** Metrics meter for counters, gauges, histograms */
  private meter: Meter

  /** DO-specific observability utilities */
  private obs: ReturnType<typeof createDOObservability>

  /** Storage operation tracker */
  private storageTracker: ReturnType<typeof createStorageTracker>

  // ========================================================================
  // Custom Application Metrics
  // ========================================================================

  private productCreatedCounter: Counter
  private orderCreatedCounter: Counter
  private orderProcessedCounter: Counter
  private orderFailedCounter: Counter
  private inventoryGauge: Gauge
  private orderValueHistogram: Histogram
  private processingTimeHistogram: Histogram

  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)

    // Initialize WorkflowContext for event handling
    this.$ = createContext(state, env)

    // ========================================================================
    // Initialize Structured Logger
    // ========================================================================

    this.logger = createStructuredLogger({
      service: 'observability-example',
      level: LogLevel.DEBUG, // Show all log levels in demo
      format: 'json', // Use 'pretty' for human-readable output
    })

    // Add DO context to all logs
    this.logger.withContext({
      doId: state.id.toString(),
      doClass: 'ObservabilityDO',
    })

    // ========================================================================
    // Initialize Distributed Tracer
    // ========================================================================

    this.tracer = createTracer({
      name: 'observability-example',
      version: '1.0.0',
    })

    // ========================================================================
    // Initialize Metrics Meter
    // ========================================================================

    this.meter = createMeter({
      name: 'observability-example',
      version: '1.0.0',
    })

    // Create application-specific metrics

    // Counters - monotonically increasing values
    this.productCreatedCounter = this.meter.createCounter('products.created', {
      description: 'Number of products created',
      unit: 'products',
    })

    this.orderCreatedCounter = this.meter.createCounter('orders.created', {
      description: 'Number of orders created',
      unit: 'orders',
    })

    this.orderProcessedCounter = this.meter.createCounter('orders.processed', {
      description: 'Number of orders successfully processed',
      unit: 'orders',
    })

    this.orderFailedCounter = this.meter.createCounter('orders.failed', {
      description: 'Number of orders that failed processing',
      unit: 'orders',
    })

    // Gauges - point-in-time measurements
    this.inventoryGauge = this.meter.createGauge('inventory.total', {
      description: 'Total inventory count across all products',
      unit: 'items',
    })

    // Histograms - distributions of values
    this.orderValueHistogram = this.meter.createHistogram('order.value', {
      description: 'Distribution of order values',
      unit: 'dollars',
      boundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000],
    })

    this.processingTimeHistogram = this.meter.createHistogram('order.processing_time', {
      description: 'Order processing duration',
      unit: 'ms',
      boundaries: [5, 10, 25, 50, 100, 250, 500, 1000],
    })

    // ========================================================================
    // Initialize DO Observability Integration
    // ========================================================================

    this.obs = createDOObservability({
      serviceName: 'observability-example-do',
      doId: state.id,
      doClassName: 'ObservabilityDO',
      enableTracing: true,
      enableMetrics: true,
      enableLogging: true,
    })

    this.storageTracker = createStorageTracker(this.obs)

    // ========================================================================
    // Event Handlers with Logging
    // ========================================================================

    this.$.on.Product.created(async (event) => {
      const { productId, name, price } = (event as { type: string; payload: { productId: string; name: string; price: number } }).payload
      this.logger.info('Product created event', { productId, name, price })
    })

    this.$.on.Order.created(async (event) => {
      const { orderId, customerId, total } = (event as { type: string; payload: { orderId: string; customerId: string; total: number } }).payload
      this.logger.info('Order created event', { orderId, customerId, total })
    })

    this.$.on.Order.processed(async (event) => {
      const { orderId, duration } = (event as { type: string; payload: { orderId: string; duration: number } }).payload
      this.logger.info('Order processed event', { orderId, durationMs: duration })
    })

    this.$.on.Order.failed(async (event) => {
      const { orderId, reason } = (event as { type: string; payload: { orderId: string; reason: string } }).payload
      this.logger.error('Order failed event', { orderId, reason })
    })

    this.logger.info('ObservabilityDO initialized')
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Apply Observability Middleware
    // ========================================================================

    // Timing middleware - adds X-Response-Time header
    app.use('/*', timing())

    // Request ID middleware - ensures correlation ID on every request
    app.use('/*', requestId())

    // Full observability middleware - logging, tracing, context propagation
    app.use(
      '/*',
      observability({
        service: 'observability-example-api',
        logLevel: LogLevel.DEBUG,
        logRequestBody: false, // Set to true for debugging
        logResponseBody: false,
        enableTracing: true,
        enableLogging: true,
        excludePaths: ['/health', '/metrics'], // Don't trace these endpoints
      })
    )

    // ========================================================================
    // Health Check (excluded from tracing)
    // ========================================================================

    app.get('/health', (c) => {
      return c.json({ status: 'ok', timestamp: new Date().toISOString() })
    })

    // ========================================================================
    // Products API - Demonstrates logging and metrics
    // ========================================================================

    app.get('/products', async (c) => {
      const log = getRequestLogger(c, 'products-handler')

      log.debug('Listing products')

      const products = await this.things.list({ type: 'Product' })
      this.storageTracker.trackList('Product')

      log.info('Products retrieved', { count: products.length })

      return c.json({
        data: products,
        _links: {
          self: { href: '/products' },
          create: { href: '/products', method: 'POST' },
        },
      })
    })

    app.post('/products', async (c) => {
      const log = getRequestLogger(c, 'products-handler')
      const body = await c.req.json<CreateProductRequest>()

      // Log at different levels
      log.debug('Creating product', { name: body.name })

      // Validate
      if (!body.name || body.price === undefined) {
        log.warn('Invalid product request', { body })
        return c.json({ error: 'Name and price are required' }, 400)
      }

      // Create with tracing
      const product = await this.tracer.startActiveSpan('createProduct', async (span) => {
        span.setAttribute('product.name', body.name)
        span.setAttribute('product.price', body.price)
        span.setAttribute('product.category', body.category)

        const created = await this.things.create({
          $type: 'Product',
          name: body.name,
          price: body.price,
          category: body.category,
          inventory: body.inventory ?? 0,
          createdAt: new Date().toISOString(),
        })

        this.storageTracker.trackPut(`Product/${created.$id}`)

        span.setAttribute('product.id', created.$id)
        return created as unknown as Product & { $id: string }
      })

      // Update metrics
      this.productCreatedCounter.inc({ category: body.category })
      await this.updateInventoryGauge()

      // Fire event
      this.$.send({
        type: 'Product.created',
        payload: { productId: product.$id, name: product.name, price: product.price },
      })

      log.info('Product created', {
        productId: product.$id,
        name: product.name,
        price: product.price,
      })

      c.header('Location', `/products/${product.$id}`)
      return c.json(product, 201)
    })

    app.get('/products/:id', async (c) => {
      const log = getRequestLogger(c, 'products-handler')
      const productId = c.req.param('id')

      log.debug('Getting product', { productId })

      const product = await this.things.get(productId)
      this.storageTracker.trackGet(`Product/${productId}`)

      if (!product || product.$type !== 'Product') {
        log.warn('Product not found', { productId })
        return c.json({ error: 'Product not found' }, 404)
      }

      return c.json(product)
    })

    // ========================================================================
    // Orders API - Demonstrates distributed tracing and span hierarchies
    // ========================================================================

    app.post('/orders', async (c) => {
      const log = getRequestLogger(c, 'orders-handler')
      const body = await c.req.json<CreateOrderRequest>()

      log.info('Creating order', { customerId: body.customerId, itemCount: body.items.length })

      if (!body.customerId || !body.items || body.items.length === 0) {
        log.warn('Invalid order request', { body })
        return c.json({ error: 'Customer ID and items are required' }, 400)
      }

      // Create order with full distributed tracing
      const result = await this.tracer.startActiveSpan('createOrder', async (orderSpan) => {
        orderSpan.setAttribute('order.customer_id', body.customerId)
        orderSpan.setAttribute('order.item_count', body.items.length)

        try {
          // Child span: Validate products
          const items = await this.tracer.startActiveSpan('validateProducts', async (validateSpan) => {
            const validatedItems: OrderItem[] = []
            let hasErrors = false

            for (const item of body.items) {
              const product = await this.things.get(item.productId)
              this.storageTracker.trackGet(`Product/${item.productId}`)

              if (!product || product.$type !== 'Product') {
                validateSpan.addEvent('product_not_found', { productId: item.productId })
                hasErrors = true
                continue
              }

              const productData = product as unknown as Product

              if (productData.inventory < item.quantity) {
                validateSpan.addEvent('insufficient_inventory', {
                  productId: item.productId,
                  requested: item.quantity,
                  available: productData.inventory,
                })
                hasErrors = true
                continue
              }

              validatedItems.push({
                productId: item.productId,
                quantity: item.quantity,
                price: productData.price,
              })
            }

            validateSpan.setAttribute('validated_items', validatedItems.length)
            validateSpan.setAttribute('has_errors', hasErrors)

            if (hasErrors && validatedItems.length === 0) {
              throw new Error('No valid items in order')
            }

            return validatedItems
          })

          // Child span: Calculate total
          const total = await this.tracer.startActiveSpan('calculateTotal', async (calcSpan) => {
            const orderTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
            calcSpan.setAttribute('order.total', orderTotal)
            return orderTotal
          })

          // Child span: Create order record
          const order = await this.tracer.startActiveSpan('saveOrder', async (saveSpan) => {
            const created = await this.things.create({
              $type: 'Order',
              customerId: body.customerId,
              items,
              status: 'pending',
              total,
              createdAt: new Date().toISOString(),
            })

            this.storageTracker.trackPut(`Order/${created.$id}`)
            saveSpan.setAttribute('order.id', created.$id)

            return created as unknown as Order & { $id: string }
          })

          // Update metrics
          this.orderCreatedCounter.inc({ customerId: body.customerId })
          this.orderValueHistogram.record(total)

          orderSpan.setAttribute('order.id', order.$id)
          orderSpan.setAttribute('order.total', total)

          // Fire event
          this.$.send({
            type: 'Order.created',
            payload: { orderId: order.$id, customerId: body.customerId, total },
          })

          log.info('Order created', { orderId: order.$id, total, itemCount: items.length })

          return { success: true, order }
        } catch (error) {
          orderSpan.recordException(error as Error)
          orderSpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message })

          log.error('Order creation failed', error as Error)

          return { success: false, error: (error as Error).message }
        }
      })

      if (!result.success) {
        return c.json({ error: result.error }, 400)
      }

      c.header('Location', `/orders/${result.order!.$id}`)
      return c.json(result.order, 201)
    })

    app.get('/orders/:id', async (c) => {
      const orderId = c.req.param('id')
      const order = await this.things.get(orderId)
      this.storageTracker.trackGet(`Order/${orderId}`)

      if (!order || order.$type !== 'Order') {
        return c.json({ error: 'Order not found' }, 404)
      }

      return c.json(order)
    })

    // ========================================================================
    // Order Processing - Demonstrates async operations with tracing
    // ========================================================================

    app.post('/orders/:id/process', async (c) => {
      const log = getRequestLogger(c, 'order-processor')
      const orderId = c.req.param('id')
      const startTime = Date.now()

      log.info('Processing order', { orderId })

      const result = await this.tracer.startActiveSpan('processOrder', async (processSpan) => {
        processSpan.setAttribute('order.id', orderId)

        try {
          // Get order
          const orderThing = await this.things.get(orderId)
          if (!orderThing || orderThing.$type !== 'Order') {
            throw new Error('Order not found')
          }

          const order = orderThing as unknown as Order & { $id: string }

          if (order.status !== 'pending') {
            throw new Error(`Cannot process order with status: ${order.status}`)
          }

          // Update status to processing
          await this.things.update(orderId, {
            status: 'processing',
            processedAt: new Date().toISOString(),
          })

          // Child span: Reserve inventory
          await this.tracer.startActiveSpan('reserveInventory', async (inventorySpan) => {
            for (const item of order.items) {
              const product = await this.things.get(item.productId)
              if (product) {
                const productData = product as unknown as Product
                await this.things.update(item.productId, {
                  inventory: productData.inventory - item.quantity,
                  updatedAt: new Date().toISOString(),
                })
                this.storageTracker.trackPut(`Product/${item.productId}`)

                inventorySpan.addEvent('inventory_reserved', {
                  productId: item.productId,
                  quantity: item.quantity,
                })
              }
            }
          })

          // Simulate processing time
          await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100))

          // Complete order
          await this.things.update(orderId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
          })
          this.storageTracker.trackPut(`Order/${orderId}`)

          const duration = Date.now() - startTime

          // Update metrics
          this.orderProcessedCounter.inc()
          this.processingTimeHistogram.record(duration)
          await this.updateInventoryGauge()

          processSpan.setAttribute('processing.duration_ms', duration)

          // Fire event
          this.$.send({
            type: 'Order.processed',
            payload: { orderId, duration },
          })

          log.info('Order processed successfully', { orderId, durationMs: duration })

          return { success: true, duration }
        } catch (error) {
          processSpan.recordException(error as Error)
          processSpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message })

          // Update order status to failed
          try {
            await this.things.update(orderId, { status: 'failed' })
          } catch {
            // Ignore update errors
          }

          // Update metrics
          this.orderFailedCounter.inc({ reason: (error as Error).message })

          // Fire event
          this.$.send({
            type: 'Order.failed',
            payload: { orderId, reason: (error as Error).message },
          })

          log.error('Order processing failed', { orderId, error: (error as Error).message })

          return { success: false, error: (error as Error).message }
        }
      })

      if (!result.success) {
        return c.json({ error: result.error }, 400)
      }

      return c.json({ status: 'completed', processingTime: result.duration })
    })

    // ========================================================================
    // Metrics Endpoint - Exposes collected metrics
    // ========================================================================

    app.get('/metrics', async (c) => {
      const dataPoints = this.meter.collect()

      // Group by type
      const counters: MetricsResponse['counters'] = []
      const gauges: MetricsResponse['gauges'] = []
      const histograms: MetricsResponse['histograms'] = []

      for (const point of dataPoints) {
        const entry = {
          name: point.name,
          value: point.value,
          attributes: point.attributes,
        }

        switch (point.type) {
          case 'counter':
            counters.push(entry)
            break
          case 'gauge':
            gauges.push(entry)
            break
          case 'histogram':
            // For histograms, also get the detailed data
            // This is simplified; in production you'd expose full histogram data
            histograms.push({
              name: point.name,
              count: point.value,
              sum: 0,
              min: 0,
              max: 0,
              attributes: point.attributes,
            })
            break
        }
      }

      const response: MetricsResponse = {
        counters,
        gauges,
        histograms,
        timestamp: new Date().toISOString(),
      }

      return c.json(response)
    })

    // ========================================================================
    // Logging Demo Endpoint - Shows all log levels
    // ========================================================================

    app.get('/demo/logging', (c) => {
      const log = getRequestLogger(c, 'logging-demo')

      log.debug('This is a DEBUG message', { detail: 'verbose information' })
      log.info('This is an INFO message', { action: 'user_action', userId: 'demo-user' })
      log.warn('This is a WARN message', { issue: 'potential_problem' })
      log.error('This is an ERROR message', new Error('Something went wrong'))

      // Create child logger with additional context
      const childLog = log.child({ component: 'sub-system', traceId: 'abc123' })
      childLog.info('Message from child logger')

      return c.json({
        message: 'Check server logs for demonstration of all log levels',
        levels: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
      })
    })

    // ========================================================================
    // Tracing Demo Endpoint - Shows span hierarchies
    // ========================================================================

    app.get('/demo/tracing', async (c) => {
      const spans: Array<{ name: string; duration: number }> = []

      await this.tracer.startActiveSpan('parent-operation', async (parentSpan) => {
        parentSpan.setAttribute('demo', true)
        parentSpan.addEvent('started')

        const start = Date.now()

        // First child operation
        await this.tracer.startActiveSpan('child-operation-1', async (childSpan) => {
          childSpan.setAttribute('step', 1)
          await new Promise((r) => setTimeout(r, 20))
          childSpan.addEvent('completed')
          spans.push({ name: 'child-operation-1', duration: Date.now() - start })
        })

        // Second child operation
        await this.tracer.startActiveSpan('child-operation-2', async (childSpan) => {
          childSpan.setAttribute('step', 2)
          await new Promise((r) => setTimeout(r, 30))

          // Nested grandchild
          await this.tracer.startActiveSpan('grandchild-operation', async (grandchildSpan) => {
            grandchildSpan.setAttribute('nested', true)
            await new Promise((r) => setTimeout(r, 10))
            grandchildSpan.addEvent('nested_complete')
          })

          childSpan.addEvent('completed')
          spans.push({ name: 'child-operation-2', duration: Date.now() - start })
        })

        parentSpan.addEvent('all_children_complete')
        spans.push({ name: 'parent-operation', duration: Date.now() - start })
      })

      return c.json({
        message: 'Tracing demo completed - check trace headers',
        spans,
        headers: {
          correlationId: c.res.headers.get('X-Correlation-ID'),
        },
      })
    })

    // ========================================================================
    // Context Propagation Demo
    // ========================================================================

    app.get('/demo/context', async (c) => {
      const log = getRequestLogger(c, 'context-demo')

      // Extract context from incoming headers
      const incomingContext = extractDOContextFromHeaders(c.req.raw.headers)

      log.info('Context propagation demo', {
        incomingCorrelationId: incomingContext.correlationId,
        hasTraceContext: !!incomingContext.traceContext,
      })

      // Create observability context
      const ctx = createObservabilityContext({
        correlationId: incomingContext.correlationId,
        traceContext: incomingContext.traceContext,
      })

      // Run with context
      const result = await runWithContext(ctx, async () => {
        // All operations here share the same context
        log.info('Inside context - all logs share correlation ID')

        return {
          correlationId: ctx.correlationId,
          hasTraceContext: !!ctx.traceContext,
        }
      })

      return c.json({
        message: 'Context propagation works across async boundaries',
        context: result,
        responseHeaders: {
          correlationId: c.res.headers.get('X-Correlation-ID'),
          traceparent: c.res.headers.get('traceparent'),
        },
      })
    })
  }

  /**
   * Update the inventory gauge by summing all product inventories
   */
  private async updateInventoryGauge(): Promise<void> {
    const products = await this.things.list({ type: 'Product' })
    const totalInventory = products.reduce(
      (sum, p) => sum + ((p as unknown as Product).inventory || 0),
      0
    )
    this.inventoryGauge.set(totalInventory)
  }
}

// Export for worker binding
export { ObservabilityDO as DO }
