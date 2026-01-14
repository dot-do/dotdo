/**
 * Fulfillment Orchestration Tests
 *
 * Tests for the fulfillment orchestration primitive providing:
 * - Provider management
 * - Order splitting and rate shopping
 * - Carrier selection
 * - Shipment management and tracking
 * - Returns and exchanges
 * - Delivery notifications
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createFulfillmentOrchestrator,
  type FulfillmentOrchestrator,
  type FulfillmentProvider,
  type FulfillmentOrder,
  type ShippingAddress,
  type CreateFulfillmentOrderInput,
  type CreateProviderInput,
  type Package,
} from '../fulfillment'

// =============================================================================
// Test Helpers
// =============================================================================

const sampleOriginAddress: ShippingAddress = {
  name: 'Warehouse',
  company: 'ACME Corp',
  line1: '100 Warehouse Way',
  city: 'Los Angeles',
  state: 'CA',
  postalCode: '90001',
  country: 'US',
  phone: '555-0100',
}

const sampleDestinationAddress: ShippingAddress = {
  name: 'John Doe',
  line1: '123 Main St',
  city: 'New York',
  state: 'NY',
  postalCode: '10001',
  country: 'US',
  phone: '555-0123',
  email: 'john@example.com',
  residential: true,
}

const sampleLineItems = [
  {
    orderLineItemId: 'oli-1',
    productId: 'prod-1',
    variantId: 'var-1',
    sku: 'TSHIRT-BLUE-M',
    name: 'Blue T-Shirt (M)',
    quantity: 2,
    weight: 0.5,
  },
  {
    orderLineItemId: 'oli-2',
    productId: 'prod-2',
    variantId: 'var-2',
    sku: 'JEANS-BLACK-32',
    name: 'Black Jeans (32)',
    quantity: 1,
    weight: 1.5,
  },
]

const sampleProviderInput: CreateProviderInput = {
  name: 'UPS',
  type: 'national',
  capabilities: {
    supportsSplitShipment: true,
    supportsReturnLabels: true,
    supportsTracking: true,
    supportsRealTimeRates: true,
    supportedCarriers: ['UPS'],
    supportedServiceLevels: ['economy', 'standard', 'express', 'overnight'],
    maxWeight: 150,
  },
  priority: 1,
}

function createTestFulfillmentOrderInput(
  overrides?: Partial<CreateFulfillmentOrderInput>
): CreateFulfillmentOrderInput {
  return {
    orderId: 'order-123',
    orderNumber: 'ORD-001',
    lineItems: sampleLineItems,
    originAddress: sampleOriginAddress,
    destinationAddress: sampleDestinationAddress,
    ...overrides,
  }
}

// =============================================================================
// Provider Management Tests
// =============================================================================

describe('FulfillmentOrchestrator', () => {
  describe('provider management', () => {
    let orchestrator: FulfillmentOrchestrator

    beforeEach(() => {
      orchestrator = createFulfillmentOrchestrator()
    })

    it('should register a fulfillment provider', async () => {
      const provider = await orchestrator.registerProvider(sampleProviderInput)

      expect(provider.id).toBeDefined()
      expect(provider.name).toBe('UPS')
      expect(provider.type).toBe('national')
      expect(provider.active).toBe(true)
      expect(provider.capabilities.supportsTracking).toBe(true)
    })

    it('should get provider by id', async () => {
      const created = await orchestrator.registerProvider(sampleProviderInput)
      const retrieved = await orchestrator.getProvider(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should update provider', async () => {
      const provider = await orchestrator.registerProvider(sampleProviderInput)
      const updated = await orchestrator.updateProvider(provider.id, {
        priority: 10,
        webhookUrl: 'https://example.com/webhook',
      })

      expect(updated.priority).toBe(10)
      expect(updated.webhookUrl).toBe('https://example.com/webhook')
    })

    it('should list active providers', async () => {
      await orchestrator.registerProvider(sampleProviderInput)
      await orchestrator.registerProvider({
        ...sampleProviderInput,
        name: 'FedEx',
        priority: 2,
      })

      const providers = await orchestrator.listProviders({ active: true })

      expect(providers).toHaveLength(2)
      // Should be sorted by priority
      expect(providers[0].name).toBe('UPS')
      expect(providers[1].name).toBe('FedEx')
    })

    it('should filter providers by type', async () => {
      await orchestrator.registerProvider(sampleProviderInput)
      await orchestrator.registerProvider({
        ...sampleProviderInput,
        name: 'Local Courier',
        type: 'local',
      })

      const national = await orchestrator.listProviders({ type: 'national' })
      expect(national).toHaveLength(1)
      expect(national[0].name).toBe('UPS')
    })

    it('should deactivate provider', async () => {
      const provider = await orchestrator.registerProvider(sampleProviderInput)
      await orchestrator.deactivateProvider(provider.id)

      const updated = await orchestrator.getProvider(provider.id)
      expect(updated?.active).toBe(false)
    })
  })

  // =============================================================================
  // Rate Shopping Tests
  // =============================================================================

  describe('rate shopping', () => {
    let orchestrator: FulfillmentOrchestrator

    beforeEach(async () => {
      orchestrator = createFulfillmentOrchestrator()
      await orchestrator.registerProvider(sampleProviderInput)
      await orchestrator.registerProvider({
        name: 'FedEx',
        type: 'national',
        capabilities: {
          supportsSplitShipment: true,
          supportsReturnLabels: true,
          supportsTracking: true,
          supportsRealTimeRates: true,
          supportedCarriers: ['FedEx'],
          supportedServiceLevels: ['standard', 'express', 'overnight'],
        },
        priority: 2,
      })
    })

    it('should get shipping rates', async () => {
      const packages: Package[] = [
        { id: 'pkg-1', weight: 2.5, weightUnit: 'lb' },
      ]

      const rates = await orchestrator.getRates({
        originAddress: sampleOriginAddress,
        destinationAddress: sampleDestinationAddress,
        packages,
      })

      expect(rates.length).toBeGreaterThan(0)
      expect(rates[0].price).toBeDefined()
      expect(rates[0].carrier).toBeDefined()
      expect(rates[0].estimatedDays).toBeDefined()
    })

    it('should filter rates by service level', async () => {
      const packages: Package[] = [
        { id: 'pkg-1', weight: 2.5, weightUnit: 'lb' },
      ]

      const rates = await orchestrator.getRates({
        originAddress: sampleOriginAddress,
        destinationAddress: sampleDestinationAddress,
        packages,
        serviceLevel: 'overnight',
      })

      expect(rates.every((r) => r.serviceLevel === 'overnight')).toBe(true)
    })

    it('should select best rate based on criteria', async () => {
      const packages: Package[] = [
        { id: 'pkg-1', weight: 2.5, weightUnit: 'lb' },
      ]

      const rates = await orchestrator.getRates({
        originAddress: sampleOriginAddress,
        destinationAddress: sampleDestinationAddress,
        packages,
      })

      const best = await orchestrator.selectBestRate(rates, {
        maxDeliveryDays: 3,
        maxPrice: 5000,
      })

      expect(best).not.toBeNull()
      expect(best!.estimatedDays).toBeLessThanOrEqual(3)
      expect(best!.price).toBeLessThanOrEqual(5000)
    })

    it('should prefer specified carriers', async () => {
      const packages: Package[] = [
        { id: 'pkg-1', weight: 2.5, weightUnit: 'lb' },
      ]

      const rates = await orchestrator.getRates({
        originAddress: sampleOriginAddress,
        destinationAddress: sampleDestinationAddress,
        packages,
      })

      const best = await orchestrator.selectBestRate(rates, {
        preferredCarriers: ['FedEx'],
      })

      expect(best?.carrier).toBe('FedEx')
    })

    it('should exclude specified carriers', async () => {
      const packages: Package[] = [
        { id: 'pkg-1', weight: 2.5, weightUnit: 'lb' },
      ]

      const rates = await orchestrator.getRates({
        originAddress: sampleOriginAddress,
        destinationAddress: sampleDestinationAddress,
        packages,
      })

      const best = await orchestrator.selectBestRate(rates, {
        excludeCarriers: ['UPS'],
      })

      expect(best?.carrier).not.toBe('UPS')
    })
  })

  // =============================================================================
  // Fulfillment Order Tests
  // =============================================================================

  describe('fulfillment order management', () => {
    let orchestrator: FulfillmentOrchestrator

    beforeEach(async () => {
      orchestrator = createFulfillmentOrchestrator()
      await orchestrator.registerProvider(sampleProviderInput)
    })

    it('should create a fulfillment order', async () => {
      const order = await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput()
      )

      expect(order.id).toBeDefined()
      expect(order.orderId).toBe('order-123')
      expect(order.status).toBe('pending')
      expect(order.lineItems).toHaveLength(2)
      expect(order.statusHistory).toHaveLength(1)
    })

    it('should get fulfillment order by id', async () => {
      const created = await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput()
      )
      const retrieved = await orchestrator.getFulfillmentOrder(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should get fulfillment orders by order id', async () => {
      await orchestrator.createFulfillmentOrder(createTestFulfillmentOrderInput())
      await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput({ orderId: 'order-123' })
      )
      await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput({ orderId: 'order-456' })
      )

      const orders = await orchestrator.getFulfillmentOrdersByOrder('order-123')
      expect(orders).toHaveLength(2)
    })

    it('should update fulfillment order status', async () => {
      const order = await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput()
      )

      const updated = await orchestrator.updateFulfillmentOrderStatus(
        order.id,
        'processing',
        'Started processing'
      )

      expect(updated.status).toBe('processing')
      expect(updated.statusHistory).toHaveLength(2)
      expect(updated.statusHistory[1].status).toBe('processing')
      expect(updated.statusHistory[1].reason).toBe('Started processing')
    })

    it('should reject invalid status transitions', async () => {
      const order = await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput()
      )

      // Cannot go directly from pending to delivered
      await expect(
        orchestrator.updateFulfillmentOrderStatus(order.id, 'delivered')
      ).rejects.toThrow('Invalid transition')
    })

    it('should cancel fulfillment order', async () => {
      const order = await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput()
      )

      const cancelled = await orchestrator.cancelFulfillmentOrder(
        order.id,
        'Customer cancelled'
      )

      expect(cancelled.status).toBe('cancelled')
    })
  })

  // =============================================================================
  // Order Splitting Tests
  // =============================================================================

  describe('order splitting', () => {
    let orchestrator: FulfillmentOrchestrator

    beforeEach(async () => {
      orchestrator = createFulfillmentOrchestrator()
      await orchestrator.registerProvider(sampleProviderInput)
    })

    it('should create single order when no splitting needed', async () => {
      const orders = await orchestrator.splitOrder(
        createTestFulfillmentOrderInput(),
        { preferSingleShipment: true }
      )

      expect(orders).toHaveLength(1)
    })

    it('should split by max items per package', async () => {
      const input = createTestFulfillmentOrderInput({
        lineItems: [
          { orderLineItemId: '1', productId: 'p1', variantId: 'v1', sku: 'A', name: 'A', quantity: 3 },
          { orderLineItemId: '2', productId: 'p2', variantId: 'v2', sku: 'B', name: 'B', quantity: 3 },
          { orderLineItemId: '3', productId: 'p3', variantId: 'v3', sku: 'C', name: 'C', quantity: 3 },
        ],
      })

      const orders = await orchestrator.splitOrder(input, {
        maxItemsPerPackage: 5,
      })

      expect(orders.length).toBeGreaterThan(1)
    })

    it('should split by max weight per package', async () => {
      const input = createTestFulfillmentOrderInput({
        lineItems: [
          { orderLineItemId: '1', productId: 'p1', variantId: 'v1', sku: 'A', name: 'A', quantity: 1, weight: 30 },
          { orderLineItemId: '2', productId: 'p2', variantId: 'v2', sku: 'B', name: 'B', quantity: 1, weight: 30 },
          { orderLineItemId: '3', productId: 'p3', variantId: 'v3', sku: 'C', name: 'C', quantity: 1, weight: 30 },
        ],
      })

      const orders = await orchestrator.splitOrder(input, {
        maxWeightPerPackage: 50,
      })

      expect(orders.length).toBeGreaterThan(1)
    })

    it('should split by location when enabled', async () => {
      const input = createTestFulfillmentOrderInput({
        lineItems: [
          { orderLineItemId: '1', productId: 'p1', variantId: 'v1', sku: 'A', name: 'A', quantity: 1, locationId: 'loc-1' },
          { orderLineItemId: '2', productId: 'p2', variantId: 'v2', sku: 'B', name: 'B', quantity: 1, locationId: 'loc-1' },
          { orderLineItemId: '3', productId: 'p3', variantId: 'v3', sku: 'C', name: 'C', quantity: 1, locationId: 'loc-2' },
        ],
      })

      const orders = await orchestrator.splitOrder(input, {
        splitByLocation: true,
      })

      expect(orders).toHaveLength(2)
    })
  })

  // =============================================================================
  // Carrier Selection Tests
  // =============================================================================

  describe('carrier selection', () => {
    let orchestrator: FulfillmentOrchestrator
    let fulfillmentOrderId: string

    beforeEach(async () => {
      orchestrator = createFulfillmentOrchestrator()
      await orchestrator.registerProvider(sampleProviderInput)
      await orchestrator.registerProvider({
        name: 'FedEx',
        type: 'national',
        capabilities: {
          supportsSplitShipment: true,
          supportsReturnLabels: true,
          supportsTracking: true,
          supportsRealTimeRates: true,
          supportedCarriers: ['FedEx'],
          supportedServiceLevels: ['standard', 'express'],
        },
        priority: 2,
      })

      const order = await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput()
      )
      fulfillmentOrderId = order.id
    })

    it('should select carrier for fulfillment order', async () => {
      const result = await orchestrator.selectCarrier(fulfillmentOrderId)

      expect(result).not.toBeNull()
      expect(result?.providerId).toBeDefined()
      expect(result?.rate).toBeDefined()
    })

    it('should apply carrier selection criteria', async () => {
      const result = await orchestrator.selectCarrier(fulfillmentOrderId, {
        preferredCarriers: ['FedEx'],
      })

      expect(result?.rate.carrier).toBe('FedEx')
    })

    it('should assign carrier to fulfillment order', async () => {
      const selection = await orchestrator.selectCarrier(fulfillmentOrderId)
      expect(selection).not.toBeNull()

      const updated = await orchestrator.assignCarrier(
        fulfillmentOrderId,
        selection!.providerId,
        selection!.rate
      )

      expect(updated.providerId).toBe(selection!.providerId)
      expect(updated.carrier).toBe(selection!.rate.carrier)
      expect(updated.serviceLevel).toBe(selection!.rate.serviceLevel)
    })
  })

  // =============================================================================
  // Shipment Management Tests
  // =============================================================================

  describe('shipment management', () => {
    let orchestrator: FulfillmentOrchestrator
    let fulfillmentOrderId: string

    beforeEach(async () => {
      orchestrator = createFulfillmentOrchestrator()
      await orchestrator.registerProvider(sampleProviderInput)

      const order = await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput()
      )
      fulfillmentOrderId = order.id

      // Transition through required states before creating shipment
      await orchestrator.updateFulfillmentOrderStatus(fulfillmentOrderId, 'processing')
      await orchestrator.updateFulfillmentOrderStatus(fulfillmentOrderId, 'picking')
      await orchestrator.updateFulfillmentOrderStatus(fulfillmentOrderId, 'packing')
    })

    it('should create shipment', async () => {
      const order = await orchestrator.getFulfillmentOrder(fulfillmentOrderId)
      const shipment = await orchestrator.createShipment(fulfillmentOrderId, {
        carrier: 'UPS',
        service: 'UPS Ground',
        trackingNumber: '1Z999AA10123456784',
        trackingUrl: 'https://ups.com/track/1Z999AA10123456784',
        lineItems: order!.lineItems.map((li) => ({
          lineItemId: li.id,
          quantity: li.quantity,
        })),
        packages: [{ id: 'pkg-1', weight: 2.5, weightUnit: 'lb' }],
        labelUrl: 'https://labels.example.com/1Z999AA10123456784.pdf',
      })

      expect(shipment.id).toBeDefined()
      expect(shipment.trackingNumber).toBe('1Z999AA10123456784')
      expect(shipment.status).toBe('label_created')
      expect(shipment.trackingEvents).toHaveLength(1)
    })

    it('should update shipment status', async () => {
      const order = await orchestrator.getFulfillmentOrder(fulfillmentOrderId)
      const shipment = await orchestrator.createShipment(fulfillmentOrderId, {
        carrier: 'UPS',
        service: 'UPS Ground',
        trackingNumber: '1Z999AA10123456784',
        lineItems: order!.lineItems.map((li) => ({
          lineItemId: li.id,
          quantity: li.quantity,
        })),
        packages: [{ id: 'pkg-1', weight: 2.5, weightUnit: 'lb' }],
      })

      const updated = await orchestrator.updateShipmentStatus(shipment.id, 'picked_up', {
        timestamp: new Date(),
        status: 'picked_up',
        message: 'Package picked up by carrier',
        location: 'Los Angeles, CA',
      })

      expect(updated.status).toBe('picked_up')
      expect(updated.trackingEvents).toHaveLength(2)
    })

    it('should record tracking events', async () => {
      const order = await orchestrator.getFulfillmentOrder(fulfillmentOrderId)
      const shipment = await orchestrator.createShipment(fulfillmentOrderId, {
        carrier: 'UPS',
        service: 'UPS Ground',
        trackingNumber: '1Z999AA10123456784',
        lineItems: order!.lineItems.map((li) => ({
          lineItemId: li.id,
          quantity: li.quantity,
        })),
        packages: [{ id: 'pkg-1', weight: 2.5, weightUnit: 'lb' }],
      })

      await orchestrator.recordTrackingEvent(shipment.id, {
        timestamp: new Date(),
        status: 'in_transit',
        message: 'In transit to destination',
        location: 'Phoenix, AZ',
      })

      const history = await orchestrator.getTrackingHistory(shipment.id)
      expect(history).toHaveLength(2)
    })

    it('should auto-update fulfillment order status when shipped', async () => {
      // beforeEach already transitions to packing state, so we can ship directly
      const order = await orchestrator.getFulfillmentOrder(fulfillmentOrderId)

      // Create shipment for all items
      await orchestrator.createShipment(fulfillmentOrderId, {
        carrier: 'UPS',
        service: 'UPS Ground',
        trackingNumber: '1Z999AA10123456784',
        lineItems: order!.lineItems.map((li) => ({
          lineItemId: li.id,
          quantity: li.quantity,
        })),
        packages: [{ id: 'pkg-1', weight: 2.5, weightUnit: 'lb' }],
      })

      const updated = await orchestrator.getFulfillmentOrder(fulfillmentOrderId)
      expect(updated?.status).toBe('shipped')
    })
  })

  // =============================================================================
  // Notification Tests
  // =============================================================================

  describe('notifications', () => {
    let orchestrator: FulfillmentOrchestrator
    let fulfillmentOrderId: string

    beforeEach(async () => {
      orchestrator = createFulfillmentOrchestrator()
      const order = await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput()
      )
      fulfillmentOrderId = order.id
    })

    it('should send delivery notification', async () => {
      const notification = await orchestrator.sendNotification(fulfillmentOrderId, {
        type: 'shipped',
        recipientEmail: 'john@example.com',
        channel: 'email',
      })

      expect(notification.id).toBeDefined()
      expect(notification.type).toBe('shipped')
      expect(notification.sentAt).toBeDefined()
    })

    it('should list notifications for fulfillment order', async () => {
      await orchestrator.sendNotification(fulfillmentOrderId, {
        type: 'shipped',
        recipientEmail: 'john@example.com',
        channel: 'email',
      })
      await orchestrator.sendNotification(fulfillmentOrderId, {
        type: 'out_for_delivery',
        recipientPhone: '555-0123',
        channel: 'sms',
      })

      const notifications = await orchestrator.getNotifications(fulfillmentOrderId)
      expect(notifications).toHaveLength(2)
    })
  })

  // =============================================================================
  // Return Tests
  // =============================================================================

  describe('returns', () => {
    let orchestrator: FulfillmentOrchestrator
    let fulfillmentOrderId: string
    let lineItemId: string

    beforeEach(async () => {
      orchestrator = createFulfillmentOrchestrator()
      const order = await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput()
      )
      fulfillmentOrderId = order.id
      lineItemId = order.lineItems[0].id
    })

    it('should create return request', async () => {
      const returnRequest = await orchestrator.createReturnRequest({
        orderId: 'order-123',
        fulfillmentOrderId,
        lineItems: [{ lineItemId, quantity: 1, reason: 'Wrong size' }],
        returnAddress: sampleOriginAddress,
        customerAddress: sampleDestinationAddress,
      })

      expect(returnRequest.id).toBeDefined()
      expect(returnRequest.status).toBe('requested')
      expect(returnRequest.lineItems).toHaveLength(1)
    })

    it('should approve return', async () => {
      const returnRequest = await orchestrator.createReturnRequest({
        orderId: 'order-123',
        fulfillmentOrderId,
        lineItems: [{ lineItemId, quantity: 1, reason: 'Wrong size' }],
        returnAddress: sampleOriginAddress,
        customerAddress: sampleDestinationAddress,
      })

      const approved = await orchestrator.approveReturn(returnRequest.id)

      expect(approved.status).toBe('approved')
      expect(approved.approvedAt).toBeDefined()
    })

    it('should reject return with reason', async () => {
      const returnRequest = await orchestrator.createReturnRequest({
        orderId: 'order-123',
        fulfillmentOrderId,
        lineItems: [{ lineItemId, quantity: 1, reason: 'Changed mind' }],
        returnAddress: sampleOriginAddress,
        customerAddress: sampleDestinationAddress,
      })

      const rejected = await orchestrator.rejectReturn(
        returnRequest.id,
        'Outside return window'
      )

      expect(rejected.status).toBe('rejected')
      expect(rejected.inspectionNotes).toBe('Outside return window')
    })

    it('should generate return label', async () => {
      const returnRequest = await orchestrator.createReturnRequest({
        orderId: 'order-123',
        fulfillmentOrderId,
        lineItems: [{ lineItemId, quantity: 1, reason: 'Defective' }],
        returnAddress: sampleOriginAddress,
        customerAddress: sampleDestinationAddress,
      })

      await orchestrator.approveReturn(returnRequest.id)
      const withLabel = await orchestrator.generateReturnLabel(returnRequest.id)

      expect(withLabel.status).toBe('label_created')
      expect(withLabel.returnLabelUrl).toBeDefined()
      expect(withLabel.returnTrackingNumber).toBeDefined()
    })

    it('should complete return flow', async () => {
      const returnRequest = await orchestrator.createReturnRequest({
        orderId: 'order-123',
        fulfillmentOrderId,
        lineItems: [{ lineItemId, quantity: 1, reason: 'Defective' }],
        returnAddress: sampleOriginAddress,
        customerAddress: sampleDestinationAddress,
      })

      await orchestrator.approveReturn(returnRequest.id)
      await orchestrator.generateReturnLabel(returnRequest.id)
      await orchestrator.updateReturnStatus(returnRequest.id, 'in_transit')
      await orchestrator.markReturnReceived(returnRequest.id, 'Item received in good condition')
      await orchestrator.updateReturnStatus(returnRequest.id, 'inspecting')
      const completed = await orchestrator.completeReturn(returnRequest.id, 2999)

      expect(completed.status).toBe('completed')
      expect(completed.refundAmount).toBe(2999)
      expect(completed.receivedAt).toBeDefined()
      expect(completed.completedAt).toBeDefined()
    })

    it('should get returns by order', async () => {
      await orchestrator.createReturnRequest({
        orderId: 'order-123',
        fulfillmentOrderId,
        lineItems: [{ lineItemId, quantity: 1, reason: 'Wrong size' }],
        returnAddress: sampleOriginAddress,
        customerAddress: sampleDestinationAddress,
      })
      await orchestrator.createReturnRequest({
        orderId: 'order-123',
        fulfillmentOrderId,
        lineItems: [{ lineItemId, quantity: 1, reason: 'Wrong color' }],
        returnAddress: sampleOriginAddress,
        customerAddress: sampleDestinationAddress,
      })

      const returns = await orchestrator.getReturnsByOrder('order-123')
      expect(returns).toHaveLength(2)
    })
  })

  // =============================================================================
  // Exchange Tests
  // =============================================================================

  describe('exchanges', () => {
    let orchestrator: FulfillmentOrchestrator
    let fulfillmentOrderId: string
    let returnRequestId: string
    let lineItemId: string

    beforeEach(async () => {
      orchestrator = createFulfillmentOrchestrator()
      await orchestrator.registerProvider(sampleProviderInput)

      const order = await orchestrator.createFulfillmentOrder(
        createTestFulfillmentOrderInput()
      )
      fulfillmentOrderId = order.id
      lineItemId = order.lineItems[0].id

      const returnRequest = await orchestrator.createReturnRequest({
        orderId: 'order-123',
        fulfillmentOrderId,
        lineItems: [{ lineItemId, quantity: 1, reason: 'Wrong size' }],
        returnAddress: sampleOriginAddress,
        customerAddress: sampleDestinationAddress,
      })
      returnRequestId = returnRequest.id
    })

    it('should create exchange request', async () => {
      const exchange = await orchestrator.createExchangeRequest({
        returnRequestId,
        exchangeItems: [
          { productId: 'prod-1', variantId: 'var-1a', sku: 'TSHIRT-BLUE-L', quantity: 1 },
        ],
      })

      expect(exchange.id).toBeDefined()
      expect(exchange.status).toBe('requested')
      expect(exchange.exchangeItems).toHaveLength(1)
    })

    it('should process exchange after return received', async () => {
      const exchange = await orchestrator.createExchangeRequest({
        returnRequestId,
        exchangeItems: [
          { productId: 'prod-1', variantId: 'var-1a', sku: 'TSHIRT-BLUE-L', quantity: 1 },
        ],
      })

      // Simulate return flow
      await orchestrator.approveReturn(returnRequestId)
      await orchestrator.generateReturnLabel(returnRequestId)
      await orchestrator.updateReturnStatus(returnRequestId, 'in_transit')
      await orchestrator.markReturnReceived(returnRequestId)

      // Update exchange status through the flow
      await orchestrator.updateExchangeStatus(exchange.id, 'approved')
      await orchestrator.updateExchangeStatus(exchange.id, 'awaiting_return')
      await orchestrator.updateExchangeStatus(exchange.id, 'return_received')

      // Process exchange
      const result = await orchestrator.processExchange(exchange.id)

      expect(result.exchange.status).toBe('processing_exchange')
      expect(result.fulfillmentOrder).toBeDefined()
      expect(result.fulfillmentOrder.lineItems).toHaveLength(1)
      expect(result.fulfillmentOrder.lineItems[0].sku).toBe('TSHIRT-BLUE-L')
    })
  })

  // =============================================================================
  // Metrics Tests
  // =============================================================================

  describe('analytics', () => {
    let orchestrator: FulfillmentOrchestrator

    beforeEach(async () => {
      orchestrator = createFulfillmentOrchestrator()
      await orchestrator.registerProvider(sampleProviderInput)

      // Create some test orders
      for (let i = 0; i < 5; i++) {
        const order = await orchestrator.createFulfillmentOrder(
          createTestFulfillmentOrderInput({ orderId: `order-${i}` })
        )

        if (i < 3) {
          await orchestrator.updateFulfillmentOrderStatus(order.id, 'processing')
          await orchestrator.updateFulfillmentOrderStatus(order.id, 'picking')
          await orchestrator.updateFulfillmentOrderStatus(order.id, 'packing')
          await orchestrator.updateFulfillmentOrderStatus(order.id, 'shipped')
        }
        if (i < 2) {
          await orchestrator.updateFulfillmentOrderStatus(order.id, 'in_transit')
          await orchestrator.updateFulfillmentOrderStatus(order.id, 'delivered')
        }
      }
    })

    it('should calculate fulfillment metrics', async () => {
      const metrics = await orchestrator.getFulfillmentMetrics()

      expect(metrics.totalFulfillmentOrders).toBe(5)
      expect(metrics.pendingOrders).toBe(2)
      expect(metrics.shippedOrders).toBe(1) // 1 in shipped status (not delivered)
      expect(metrics.deliveredOrders).toBe(2)
    })

    it('should filter metrics by date range', async () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)

      const metrics = await orchestrator.getFulfillmentMetrics({
        from: yesterday,
        to: tomorrow,
      })

      expect(metrics.totalFulfillmentOrders).toBeGreaterThan(0)
    })
  })
})
