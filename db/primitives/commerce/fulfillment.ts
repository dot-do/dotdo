/**
 * Fulfillment Orchestration - Order fulfillment primitive
 *
 * Provides comprehensive fulfillment orchestration:
 * - Multiple fulfillment providers
 * - Split shipments with intelligent routing
 * - Carrier selection and rate comparison
 * - Tracking number integration
 * - Delivery notifications
 * - Return/exchange handling
 * - Fulfillment workflow state machine
 *
 * @module db/primitives/commerce/fulfillment
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Fulfillment status following verb forms
 */
export type FulfillmentStatus =
  | 'pending'
  | 'processing'
  | 'picking'
  | 'packing'
  | 'shipped'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'cancelled'
  | 'returned'

/**
 * Shipment status for tracking
 */
export type ShipmentStatus =
  | 'label_created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'returned_to_sender'

/**
 * Return status
 */
export type ReturnStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'label_created'
  | 'in_transit'
  | 'received'
  | 'inspecting'
  | 'completed'
  | 'refunded'

/**
 * Exchange status
 */
export type ExchangeStatus =
  | 'requested'
  | 'approved'
  | 'awaiting_return'
  | 'return_received'
  | 'processing_exchange'
  | 'exchange_shipped'
  | 'completed'

/**
 * Carrier type
 */
export type CarrierType = 'national' | 'regional' | 'local' | 'freight' | 'dropship'

/**
 * Service level
 */
export type ServiceLevel =
  | 'economy'
  | 'standard'
  | 'express'
  | 'overnight'
  | 'same_day'
  | 'freight'

/**
 * Fulfillment provider capabilities
 */
export interface FulfillmentProviderCapabilities {
  supportsSplitShipment: boolean
  supportsReturnLabels: boolean
  supportsTracking: boolean
  supportsRealTimeRates: boolean
  supportedCarriers: string[]
  supportedServiceLevels: ServiceLevel[]
  maxWeight?: number
  maxDimensions?: { length: number; width: number; height: number }
  restrictedCountries?: string[]
  supportedCountries?: string[]
}

/**
 * Fulfillment provider
 */
export interface FulfillmentProvider {
  id: string
  name: string
  type: CarrierType
  capabilities: FulfillmentProviderCapabilities
  priority: number
  active: boolean
  credentials?: Record<string, string>
  webhookUrl?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Shipping rate
 */
export interface ShippingRate {
  providerId: string
  carrier: string
  service: string
  serviceLevel: ServiceLevel
  estimatedDays: number
  deliveryDate?: Date
  price: number
  currency: string
  guaranteed?: boolean
  saturdayDelivery?: boolean
  signatureRequired?: boolean
  metadata?: Record<string, unknown>
}

/**
 * Package dimensions
 */
export interface PackageDimensions {
  length: number
  width: number
  height: number
  unit: 'in' | 'cm'
}

/**
 * Package info
 */
export interface Package {
  id: string
  weight: number
  weightUnit: 'lb' | 'kg'
  dimensions?: PackageDimensions
  declaredValue?: number
  currency?: string
  contents?: string
  fragile?: boolean
  hazmat?: boolean
}

/**
 * Address for shipping
 */
export interface ShippingAddress {
  name: string
  company?: string
  line1: string
  line2?: string
  city: string
  state: string
  postalCode: string
  country: string
  phone?: string
  email?: string
  residential?: boolean
}

/**
 * Fulfillment line item
 */
export interface FulfillmentLineItem {
  id: string
  orderId: string
  orderLineItemId: string
  productId: string
  variantId: string
  sku: string
  name: string
  quantity: number
  fulfilledQuantity: number
  weight?: number
  dimensions?: PackageDimensions
  locationId?: string
  requiresSpecialHandling?: boolean
  metadata?: Record<string, unknown>
}

/**
 * Fulfillment order (a group of items to be fulfilled together)
 */
export interface FulfillmentOrder {
  id: string
  orderId: string
  orderNumber: string
  status: FulfillmentStatus
  lineItems: FulfillmentLineItem[]
  originAddress: ShippingAddress
  destinationAddress: ShippingAddress
  providerId?: string
  carrier?: string
  serviceLevel?: ServiceLevel
  packages?: Package[]
  shippingRate?: ShippingRate
  labelUrl?: string
  trackingNumber?: string
  trackingUrl?: string
  shipments: Shipment[]
  priority: number
  requiresSignature?: boolean
  insurance?: { amount: number; currency: string }
  specialInstructions?: string
  estimatedShipDate?: Date
  estimatedDeliveryDate?: Date
  actualShipDate?: Date
  actualDeliveryDate?: Date
  statusHistory: FulfillmentStatusEntry[]
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Shipment tracking event
 */
export interface TrackingEvent {
  timestamp: Date
  status: ShipmentStatus
  location?: string
  message: string
  carrierCode?: string
  metadata?: Record<string, unknown>
}

/**
 * Shipment (actual package in transit)
 */
export interface Shipment {
  id: string
  fulfillmentOrderId: string
  carrier: string
  service: string
  trackingNumber: string
  trackingUrl?: string
  status: ShipmentStatus
  lineItems: { lineItemId: string; quantity: number }[]
  packages: Package[]
  labelUrl?: string
  labelFormat?: 'pdf' | 'png' | 'zpl'
  shippedAt?: Date
  estimatedDeliveryDate?: Date
  actualDeliveryDate?: Date
  deliveryAttempts: number
  signedBy?: string
  proofOfDeliveryUrl?: string
  trackingEvents: TrackingEvent[]
  cost?: number
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Return request
 */
export interface ReturnRequest {
  id: string
  orderId: string
  fulfillmentOrderId: string
  status: ReturnStatus
  lineItems: { lineItemId: string; quantity: number; reason: string; condition?: string }[]
  returnAddress: ShippingAddress
  customerAddress: ShippingAddress
  returnLabelUrl?: string
  returnTrackingNumber?: string
  returnCarrier?: string
  returnShipment?: Shipment
  inspectionNotes?: string
  approvedAt?: Date
  receivedAt?: Date
  completedAt?: Date
  refundAmount?: number
  refundId?: string
  restockItems: boolean
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Exchange request
 */
export interface ExchangeRequest {
  id: string
  orderId: string
  returnRequestId: string
  status: ExchangeStatus
  originalItems: { lineItemId: string; quantity: number }[]
  exchangeItems: { productId: string; variantId: string; sku: string; quantity: number }[]
  exchangeFulfillmentOrderId?: string
  priceDifference?: number
  paymentRequired?: boolean
  paymentId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Fulfillment status history entry
 */
export interface FulfillmentStatusEntry {
  status: FulfillmentStatus
  timestamp: Date
  actor?: string
  reason?: string
  metadata?: Record<string, unknown>
}

/**
 * Delivery notification
 */
export interface DeliveryNotification {
  id: string
  type: 'shipped' | 'out_for_delivery' | 'delivered' | 'exception' | 'return_received'
  fulfillmentOrderId: string
  shipmentId?: string
  recipientEmail?: string
  recipientPhone?: string
  channel: 'email' | 'sms' | 'push' | 'webhook'
  sentAt?: Date
  deliveredAt?: Date
  metadata?: Record<string, unknown>
}

// =============================================================================
// Input Types
// =============================================================================

export interface CreateProviderInput {
  id?: string
  name: string
  type: CarrierType
  capabilities: FulfillmentProviderCapabilities
  priority?: number
  credentials?: Record<string, string>
  webhookUrl?: string
  metadata?: Record<string, unknown>
}

export interface UpdateProviderInput {
  name?: string
  type?: CarrierType
  capabilities?: Partial<FulfillmentProviderCapabilities>
  priority?: number
  active?: boolean
  credentials?: Record<string, string>
  webhookUrl?: string
  metadata?: Record<string, unknown>
}

export interface CreateFulfillmentOrderInput {
  orderId: string
  orderNumber: string
  lineItems: Omit<FulfillmentLineItem, 'id' | 'orderId' | 'fulfilledQuantity'>[]
  originAddress: ShippingAddress
  destinationAddress: ShippingAddress
  providerId?: string
  carrier?: string
  serviceLevel?: ServiceLevel
  priority?: number
  requiresSignature?: boolean
  insurance?: { amount: number; currency: string }
  specialInstructions?: string
  metadata?: Record<string, unknown>
}

export interface GetRatesInput {
  originAddress: ShippingAddress
  destinationAddress: ShippingAddress
  packages: Package[]
  serviceLevel?: ServiceLevel
  deliveryDate?: Date
}

export interface CreateShipmentInput {
  carrier: string
  service: string
  trackingNumber: string
  trackingUrl?: string
  lineItems: { lineItemId: string; quantity: number }[]
  packages: Package[]
  labelUrl?: string
  labelFormat?: 'pdf' | 'png' | 'zpl'
  estimatedDeliveryDate?: Date
  cost?: number
  metadata?: Record<string, unknown>
}

export interface CreateReturnInput {
  orderId: string
  fulfillmentOrderId: string
  lineItems: { lineItemId: string; quantity: number; reason: string; condition?: string }[]
  returnAddress: ShippingAddress
  customerAddress: ShippingAddress
  restockItems?: boolean
  metadata?: Record<string, unknown>
}

export interface CreateExchangeInput {
  returnRequestId: string
  exchangeItems: { productId: string; variantId: string; sku: string; quantity: number }[]
  priceDifference?: number
  metadata?: Record<string, unknown>
}

export interface SplitShipmentOptions {
  maxItemsPerPackage?: number
  maxWeightPerPackage?: number
  splitByLocation?: boolean
  splitByAvailability?: boolean
  preferSingleShipment?: boolean
}

export interface CarrierSelectionCriteria {
  preferredCarriers?: string[]
  excludeCarriers?: string[]
  maxPrice?: number
  maxDeliveryDays?: number
  requireGuaranteed?: boolean
  requireSignature?: boolean
  requireInsurance?: boolean
}

export interface NotificationInput {
  type: 'shipped' | 'out_for_delivery' | 'delivered' | 'exception' | 'return_received'
  shipmentId?: string
  recipientEmail?: string
  recipientPhone?: string
  channel: 'email' | 'sms' | 'push' | 'webhook'
  metadata?: Record<string, unknown>
}

// =============================================================================
// State Machine
// =============================================================================

const fulfillmentTransitions: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['picking', 'cancelled', 'failed'],
  picking: ['packing', 'processing', 'cancelled', 'failed'],
  packing: ['shipped', 'picking', 'cancelled', 'failed'],
  shipped: ['in_transit', 'failed', 'returned'],
  in_transit: ['out_for_delivery', 'delivered', 'failed', 'returned'],
  out_for_delivery: ['delivered', 'failed', 'returned'],
  delivered: ['returned'],
  failed: ['processing', 'cancelled'],
  cancelled: [],
  returned: [],
}

const returnTransitions: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['label_created'],
  rejected: [],
  label_created: ['in_transit'],
  in_transit: ['received'],
  received: ['inspecting'],
  inspecting: ['completed', 'refunded'],
  completed: ['refunded'],
  refunded: [],
}

const exchangeTransitions: Record<ExchangeStatus, ExchangeStatus[]> = {
  requested: ['approved'],
  approved: ['awaiting_return'],
  awaiting_return: ['return_received'],
  return_received: ['processing_exchange'],
  processing_exchange: ['exchange_shipped'],
  exchange_shipped: ['completed'],
  completed: [],
}

// =============================================================================
// FulfillmentOrchestrator Interface
// =============================================================================

export interface FulfillmentOrchestrator {
  // Provider management
  registerProvider(input: CreateProviderInput): Promise<FulfillmentProvider>
  updateProvider(id: string, input: UpdateProviderInput): Promise<FulfillmentProvider>
  getProvider(id: string): Promise<FulfillmentProvider | null>
  listProviders(options?: { active?: boolean; type?: CarrierType }): Promise<FulfillmentProvider[]>
  deactivateProvider(id: string): Promise<void>

  // Rate shopping
  getRates(input: GetRatesInput): Promise<ShippingRate[]>
  selectBestRate(
    rates: ShippingRate[],
    criteria: CarrierSelectionCriteria
  ): Promise<ShippingRate | null>

  // Fulfillment order management
  createFulfillmentOrder(input: CreateFulfillmentOrderInput): Promise<FulfillmentOrder>
  getFulfillmentOrder(id: string): Promise<FulfillmentOrder | null>
  getFulfillmentOrdersByOrder(orderId: string): Promise<FulfillmentOrder[]>
  updateFulfillmentOrderStatus(
    id: string,
    status: FulfillmentStatus,
    reason?: string
  ): Promise<FulfillmentOrder>
  cancelFulfillmentOrder(id: string, reason: string): Promise<FulfillmentOrder>

  // Order splitting
  splitOrder(
    input: CreateFulfillmentOrderInput,
    options?: SplitShipmentOptions
  ): Promise<FulfillmentOrder[]>

  // Carrier selection
  selectCarrier(
    fulfillmentOrderId: string,
    criteria?: CarrierSelectionCriteria
  ): Promise<{ providerId: string; rate: ShippingRate } | null>
  assignCarrier(
    fulfillmentOrderId: string,
    providerId: string,
    rate: ShippingRate
  ): Promise<FulfillmentOrder>

  // Shipment management
  createShipment(fulfillmentOrderId: string, input: CreateShipmentInput): Promise<Shipment>
  getShipment(id: string): Promise<Shipment | null>
  updateShipmentStatus(id: string, status: ShipmentStatus, event?: TrackingEvent): Promise<Shipment>
  recordTrackingEvent(shipmentId: string, event: TrackingEvent): Promise<Shipment>

  // Tracking
  refreshTracking(shipmentId: string): Promise<Shipment>
  getTrackingHistory(shipmentId: string): Promise<TrackingEvent[]>

  // Notifications
  sendNotification(fulfillmentOrderId: string, input: NotificationInput): Promise<DeliveryNotification>
  getNotifications(fulfillmentOrderId: string): Promise<DeliveryNotification[]>

  // Returns
  createReturnRequest(input: CreateReturnInput): Promise<ReturnRequest>
  getReturnRequest(id: string): Promise<ReturnRequest | null>
  getReturnsByOrder(orderId: string): Promise<ReturnRequest[]>
  approveReturn(id: string): Promise<ReturnRequest>
  rejectReturn(id: string, reason: string): Promise<ReturnRequest>
  generateReturnLabel(id: string): Promise<ReturnRequest>
  markReturnReceived(id: string, inspectionNotes?: string): Promise<ReturnRequest>
  completeReturn(id: string, refundAmount?: number): Promise<ReturnRequest>
  updateReturnStatus(id: string, status: ReturnStatus, reason?: string): Promise<ReturnRequest>

  // Exchanges
  createExchangeRequest(input: CreateExchangeInput): Promise<ExchangeRequest>
  getExchangeRequest(id: string): Promise<ExchangeRequest | null>
  updateExchangeStatus(id: string, status: ExchangeStatus): Promise<ExchangeRequest>
  processExchange(id: string): Promise<{ exchange: ExchangeRequest; fulfillmentOrder: FulfillmentOrder }>

  // Analytics
  getFulfillmentMetrics(options?: {
    from?: Date
    to?: Date
    providerId?: string
  }): Promise<FulfillmentMetrics>
}

export interface FulfillmentMetrics {
  totalFulfillmentOrders: number
  pendingOrders: number
  processingOrders: number
  shippedOrders: number
  deliveredOrders: number
  failedOrders: number
  cancelledOrders: number
  returnedOrders: number
  averageProcessingTime: number
  averageDeliveryTime: number
  onTimeDeliveryRate: number
  returnRate: number
  carrierBreakdown: Record<string, number>
  serviceBreakdown: Record<ServiceLevel, number>
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}${random}`
}

function calculatePackageWeight(lineItems: FulfillmentLineItem[]): number {
  return lineItems.reduce((total, item) => total + (item.weight ?? 0) * item.quantity, 0)
}

// =============================================================================
// Implementation
// =============================================================================

class InMemoryFulfillmentOrchestrator implements FulfillmentOrchestrator {
  private providers: Map<string, FulfillmentProvider> = new Map()
  private fulfillmentOrders: Map<string, FulfillmentOrder> = new Map()
  private shipments: Map<string, Shipment> = new Map()
  private returns: Map<string, ReturnRequest> = new Map()
  private exchanges: Map<string, ExchangeRequest> = new Map()
  private notifications: Map<string, DeliveryNotification[]> = new Map()

  // ===========================================================================
  // Provider Management
  // ===========================================================================

  async registerProvider(input: CreateProviderInput): Promise<FulfillmentProvider> {
    const now = new Date()
    const provider: FulfillmentProvider = {
      id: input.id ?? generateId('prov'),
      name: input.name,
      type: input.type,
      capabilities: input.capabilities,
      priority: input.priority ?? 0,
      active: true,
      credentials: input.credentials,
      webhookUrl: input.webhookUrl,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }

    this.providers.set(provider.id, provider)
    return provider
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<FulfillmentProvider> {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new Error('Provider not found')
    }

    const updated: FulfillmentProvider = {
      ...provider,
      ...input,
      capabilities: input.capabilities
        ? { ...provider.capabilities, ...input.capabilities }
        : provider.capabilities,
      updatedAt: new Date(),
    }

    this.providers.set(id, updated)
    return updated
  }

  async getProvider(id: string): Promise<FulfillmentProvider | null> {
    return this.providers.get(id) ?? null
  }

  async listProviders(options?: {
    active?: boolean
    type?: CarrierType
  }): Promise<FulfillmentProvider[]> {
    let providers = Array.from(this.providers.values())

    if (options?.active !== undefined) {
      providers = providers.filter((p) => p.active === options.active)
    }
    if (options?.type) {
      providers = providers.filter((p) => p.type === options.type)
    }

    return providers.sort((a, b) => a.priority - b.priority)
  }

  async deactivateProvider(id: string): Promise<void> {
    const provider = this.providers.get(id)
    if (provider) {
      provider.active = false
      provider.updatedAt = new Date()
      this.providers.set(id, provider)
    }
  }

  // ===========================================================================
  // Rate Shopping
  // ===========================================================================

  async getRates(input: GetRatesInput): Promise<ShippingRate[]> {
    const rates: ShippingRate[] = []
    const activeProviders = await this.listProviders({ active: true })

    for (const provider of activeProviders) {
      if (!provider.capabilities.supportsRealTimeRates) {
        continue
      }

      // Check country support
      if (
        provider.capabilities.restrictedCountries?.includes(input.destinationAddress.country)
      ) {
        continue
      }
      if (
        provider.capabilities.supportedCountries &&
        !provider.capabilities.supportedCountries.includes(input.destinationAddress.country)
      ) {
        continue
      }

      // Check weight limits
      const totalWeight = input.packages.reduce((sum, pkg) => sum + pkg.weight, 0)
      if (provider.capabilities.maxWeight && totalWeight > provider.capabilities.maxWeight) {
        continue
      }

      // Generate rates for each supported service level
      for (const serviceLevel of provider.capabilities.supportedServiceLevels) {
        if (input.serviceLevel && serviceLevel !== input.serviceLevel) {
          continue
        }

        // Simulate rate calculation
        const baseRate = this.calculateBaseRate(totalWeight, serviceLevel)
        const estimatedDays = this.getEstimatedDays(serviceLevel)

        rates.push({
          providerId: provider.id,
          carrier: provider.name,
          service: `${provider.name} ${serviceLevel}`,
          serviceLevel,
          estimatedDays,
          deliveryDate: this.calculateDeliveryDate(estimatedDays),
          price: baseRate,
          currency: 'USD',
          guaranteed: serviceLevel === 'overnight' || serviceLevel === 'same_day',
        })
      }
    }

    return rates.sort((a, b) => a.price - b.price)
  }

  async selectBestRate(
    rates: ShippingRate[],
    criteria: CarrierSelectionCriteria
  ): Promise<ShippingRate | null> {
    let filteredRates = [...rates]

    // Apply filters
    if (criteria.preferredCarriers?.length) {
      const preferred = filteredRates.filter((r) =>
        criteria.preferredCarriers!.includes(r.carrier)
      )
      if (preferred.length > 0) {
        filteredRates = preferred
      }
    }

    if (criteria.excludeCarriers?.length) {
      filteredRates = filteredRates.filter(
        (r) => !criteria.excludeCarriers!.includes(r.carrier)
      )
    }

    if (criteria.maxPrice !== undefined) {
      filteredRates = filteredRates.filter((r) => r.price <= criteria.maxPrice!)
    }

    if (criteria.maxDeliveryDays !== undefined) {
      filteredRates = filteredRates.filter((r) => r.estimatedDays <= criteria.maxDeliveryDays!)
    }

    if (criteria.requireGuaranteed) {
      filteredRates = filteredRates.filter((r) => r.guaranteed)
    }

    if (filteredRates.length === 0) {
      return null
    }

    // Return cheapest remaining option
    return filteredRates.sort((a, b) => a.price - b.price)[0]
  }

  private calculateBaseRate(weight: number, serviceLevel: ServiceLevel): number {
    const basePrices: Record<ServiceLevel, number> = {
      economy: 599,
      standard: 899,
      express: 1499,
      overnight: 2999,
      same_day: 4999,
      freight: 9999,
    }
    const weightMultiplier = Math.ceil(weight) * 50
    return basePrices[serviceLevel] + weightMultiplier
  }

  private getEstimatedDays(serviceLevel: ServiceLevel): number {
    const days: Record<ServiceLevel, number> = {
      economy: 7,
      standard: 5,
      express: 2,
      overnight: 1,
      same_day: 0,
      freight: 10,
    }
    return days[serviceLevel]
  }

  private calculateDeliveryDate(days: number): Date {
    const date = new Date()
    date.setDate(date.getDate() + days)
    return date
  }

  // ===========================================================================
  // Fulfillment Order Management
  // ===========================================================================

  async createFulfillmentOrder(input: CreateFulfillmentOrderInput): Promise<FulfillmentOrder> {
    const now = new Date()
    const lineItems: FulfillmentLineItem[] = input.lineItems.map((item) => ({
      ...item,
      id: generateId('fli'),
      orderId: input.orderId,
      fulfilledQuantity: 0,
    }))

    const order: FulfillmentOrder = {
      id: generateId('fo'),
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      status: 'pending',
      lineItems,
      originAddress: input.originAddress,
      destinationAddress: input.destinationAddress,
      providerId: input.providerId,
      carrier: input.carrier,
      serviceLevel: input.serviceLevel,
      shipments: [],
      priority: input.priority ?? 0,
      requiresSignature: input.requiresSignature,
      insurance: input.insurance,
      specialInstructions: input.specialInstructions,
      statusHistory: [{ status: 'pending', timestamp: now }],
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }

    this.fulfillmentOrders.set(order.id, order)
    this.notifications.set(order.id, [])
    return order
  }

  async getFulfillmentOrder(id: string): Promise<FulfillmentOrder | null> {
    return this.fulfillmentOrders.get(id) ?? null
  }

  async getFulfillmentOrdersByOrder(orderId: string): Promise<FulfillmentOrder[]> {
    return Array.from(this.fulfillmentOrders.values()).filter((fo) => fo.orderId === orderId)
  }

  async updateFulfillmentOrderStatus(
    id: string,
    status: FulfillmentStatus,
    reason?: string
  ): Promise<FulfillmentOrder> {
    const order = this.fulfillmentOrders.get(id)
    if (!order) {
      throw new Error('Fulfillment order not found')
    }

    const validTransitions = fulfillmentTransitions[order.status]
    if (!validTransitions.includes(status)) {
      throw new Error(`Invalid transition from ${order.status} to ${status}`)
    }

    const now = new Date()
    const updated: FulfillmentOrder = {
      ...order,
      status,
      statusHistory: [
        ...order.statusHistory,
        { status, timestamp: now, reason },
      ],
      updatedAt: now,
    }

    // Update timestamps based on status
    if (status === 'shipped' && !updated.actualShipDate) {
      updated.actualShipDate = now
    }
    if (status === 'delivered' && !updated.actualDeliveryDate) {
      updated.actualDeliveryDate = now
    }

    this.fulfillmentOrders.set(id, updated)
    return updated
  }

  async cancelFulfillmentOrder(id: string, reason: string): Promise<FulfillmentOrder> {
    return this.updateFulfillmentOrderStatus(id, 'cancelled', reason)
  }

  // ===========================================================================
  // Order Splitting
  // ===========================================================================

  async splitOrder(
    input: CreateFulfillmentOrderInput,
    options?: SplitShipmentOptions
  ): Promise<FulfillmentOrder[]> {
    const { maxItemsPerPackage, maxWeightPerPackage, splitByLocation, preferSingleShipment } =
      options ?? {}

    // If prefer single shipment and no constraints violated, create one order
    if (preferSingleShipment) {
      const totalWeight = calculatePackageWeight(input.lineItems as FulfillmentLineItem[])
      const totalItems = input.lineItems.reduce((sum, item) => sum + item.quantity, 0)

      if (
        (!maxWeightPerPackage || totalWeight <= maxWeightPerPackage) &&
        (!maxItemsPerPackage || totalItems <= maxItemsPerPackage)
      ) {
        const order = await this.createFulfillmentOrder(input)
        return [order]
      }
    }

    // Group items by location if requested
    let itemGroups: typeof input.lineItems[] = [input.lineItems]
    if (splitByLocation) {
      const byLocation = new Map<string, typeof input.lineItems>()
      for (const item of input.lineItems) {
        const locationId = item.locationId ?? 'default'
        const group = byLocation.get(locationId) ?? []
        group.push(item)
        byLocation.set(locationId, group)
      }
      itemGroups = Array.from(byLocation.values())
    }

    // Further split by weight/item count
    const finalGroups: typeof input.lineItems[] = []
    for (const group of itemGroups) {
      if (!maxItemsPerPackage && !maxWeightPerPackage) {
        finalGroups.push(group)
        continue
      }

      let currentGroup: typeof input.lineItems = []
      let currentWeight = 0
      let currentItems = 0

      for (const item of group) {
        const itemWeight = (item.weight ?? 0) * item.quantity

        if (
          (maxItemsPerPackage && currentItems + item.quantity > maxItemsPerPackage) ||
          (maxWeightPerPackage && currentWeight + itemWeight > maxWeightPerPackage)
        ) {
          if (currentGroup.length > 0) {
            finalGroups.push(currentGroup)
          }
          currentGroup = []
          currentWeight = 0
          currentItems = 0
        }

        currentGroup.push(item)
        currentWeight += itemWeight
        currentItems += item.quantity
      }

      if (currentGroup.length > 0) {
        finalGroups.push(currentGroup)
      }
    }

    // Create fulfillment orders
    const orders: FulfillmentOrder[] = []
    for (const group of finalGroups) {
      const order = await this.createFulfillmentOrder({
        ...input,
        lineItems: group,
      })
      orders.push(order)
    }

    return orders
  }

  // ===========================================================================
  // Carrier Selection
  // ===========================================================================

  async selectCarrier(
    fulfillmentOrderId: string,
    criteria?: CarrierSelectionCriteria
  ): Promise<{ providerId: string; rate: ShippingRate } | null> {
    const order = await this.getFulfillmentOrder(fulfillmentOrderId)
    if (!order) {
      throw new Error('Fulfillment order not found')
    }

    // Calculate packages from line items
    const totalWeight = calculatePackageWeight(order.lineItems)
    const packages: Package[] = [
      {
        id: generateId('pkg'),
        weight: totalWeight,
        weightUnit: 'lb',
      },
    ]

    const rates = await this.getRates({
      originAddress: order.originAddress,
      destinationAddress: order.destinationAddress,
      packages,
      serviceLevel: order.serviceLevel,
    })

    const bestRate = await this.selectBestRate(rates, criteria ?? {})
    if (!bestRate) {
      return null
    }

    return {
      providerId: bestRate.providerId,
      rate: bestRate,
    }
  }

  async assignCarrier(
    fulfillmentOrderId: string,
    providerId: string,
    rate: ShippingRate
  ): Promise<FulfillmentOrder> {
    const order = this.fulfillmentOrders.get(fulfillmentOrderId)
    if (!order) {
      throw new Error('Fulfillment order not found')
    }

    const updated: FulfillmentOrder = {
      ...order,
      providerId,
      carrier: rate.carrier,
      serviceLevel: rate.serviceLevel,
      shippingRate: rate,
      estimatedDeliveryDate: rate.deliveryDate,
      updatedAt: new Date(),
    }

    this.fulfillmentOrders.set(fulfillmentOrderId, updated)
    return updated
  }

  // ===========================================================================
  // Shipment Management
  // ===========================================================================

  async createShipment(fulfillmentOrderId: string, input: CreateShipmentInput): Promise<Shipment> {
    const order = this.fulfillmentOrders.get(fulfillmentOrderId)
    if (!order) {
      throw new Error('Fulfillment order not found')
    }

    const now = new Date()
    const shipment: Shipment = {
      id: generateId('ship'),
      fulfillmentOrderId,
      carrier: input.carrier,
      service: input.service,
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl,
      status: 'label_created',
      lineItems: input.lineItems,
      packages: input.packages,
      labelUrl: input.labelUrl,
      labelFormat: input.labelFormat,
      shippedAt: now,
      estimatedDeliveryDate: input.estimatedDeliveryDate,
      deliveryAttempts: 0,
      trackingEvents: [
        {
          timestamp: now,
          status: 'label_created',
          message: 'Shipping label created',
        },
      ],
      cost: input.cost,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }

    this.shipments.set(shipment.id, shipment)

    // Update fulfillment order
    const updatedOrder: FulfillmentOrder = {
      ...order,
      shipments: [...order.shipments, shipment],
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl,
      labelUrl: input.labelUrl,
      updatedAt: now,
    }

    // Update fulfilled quantities
    for (const shipmentItem of input.lineItems) {
      const lineItem = updatedOrder.lineItems.find((li) => li.id === shipmentItem.lineItemId)
      if (lineItem) {
        lineItem.fulfilledQuantity += shipmentItem.quantity
      }
    }

    this.fulfillmentOrders.set(fulfillmentOrderId, updatedOrder)

    // Auto-transition to shipped if all items are fulfilled
    const allFulfilled = updatedOrder.lineItems.every(
      (li) => li.fulfilledQuantity >= li.quantity
    )
    if (allFulfilled && order.status !== 'shipped') {
      await this.updateFulfillmentOrderStatus(fulfillmentOrderId, 'shipped')
    }

    return shipment
  }

  async getShipment(id: string): Promise<Shipment | null> {
    return this.shipments.get(id) ?? null
  }

  async updateShipmentStatus(
    id: string,
    status: ShipmentStatus,
    event?: TrackingEvent
  ): Promise<Shipment> {
    const shipment = this.shipments.get(id)
    if (!shipment) {
      throw new Error('Shipment not found')
    }

    const now = new Date()
    const trackingEvent: TrackingEvent = event ?? {
      timestamp: now,
      status,
      message: `Shipment status updated to ${status}`,
    }

    const updated: Shipment = {
      ...shipment,
      status,
      trackingEvents: [...shipment.trackingEvents, trackingEvent],
      updatedAt: now,
    }

    // Update delivery info
    if (status === 'delivered') {
      updated.actualDeliveryDate = now
    }
    if (status === 'out_for_delivery') {
      updated.deliveryAttempts += 1
    }

    this.shipments.set(id, updated)

    // Update parent fulfillment order status
    const order = this.fulfillmentOrders.get(shipment.fulfillmentOrderId)
    if (order) {
      const statusMap: Partial<Record<ShipmentStatus, FulfillmentStatus>> = {
        picked_up: 'shipped',
        in_transit: 'in_transit',
        out_for_delivery: 'out_for_delivery',
        delivered: 'delivered',
        exception: 'failed',
        returned_to_sender: 'returned',
      }
      const newOrderStatus = statusMap[status]
      if (newOrderStatus && order.status !== newOrderStatus) {
        try {
          await this.updateFulfillmentOrderStatus(order.id, newOrderStatus)
        } catch {
          // Ignore invalid transition errors
        }
      }
    }

    return updated
  }

  async recordTrackingEvent(shipmentId: string, event: TrackingEvent): Promise<Shipment> {
    const shipment = this.shipments.get(shipmentId)
    if (!shipment) {
      throw new Error('Shipment not found')
    }

    const updated: Shipment = {
      ...shipment,
      trackingEvents: [...shipment.trackingEvents, event],
      status: event.status,
      updatedAt: new Date(),
    }

    this.shipments.set(shipmentId, updated)
    return updated
  }

  // ===========================================================================
  // Tracking
  // ===========================================================================

  async refreshTracking(shipmentId: string): Promise<Shipment> {
    const shipment = this.shipments.get(shipmentId)
    if (!shipment) {
      throw new Error('Shipment not found')
    }

    // In a real implementation, this would call the carrier API
    // For now, just return the current shipment
    return shipment
  }

  async getTrackingHistory(shipmentId: string): Promise<TrackingEvent[]> {
    const shipment = this.shipments.get(shipmentId)
    if (!shipment) {
      throw new Error('Shipment not found')
    }

    return [...shipment.trackingEvents].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    )
  }

  // ===========================================================================
  // Notifications
  // ===========================================================================

  async sendNotification(
    fulfillmentOrderId: string,
    input: NotificationInput
  ): Promise<DeliveryNotification> {
    const order = this.fulfillmentOrders.get(fulfillmentOrderId)
    if (!order) {
      throw new Error('Fulfillment order not found')
    }

    const now = new Date()
    const notification: DeliveryNotification = {
      id: generateId('notif'),
      type: input.type,
      fulfillmentOrderId,
      shipmentId: input.shipmentId,
      recipientEmail: input.recipientEmail,
      recipientPhone: input.recipientPhone,
      channel: input.channel,
      sentAt: now,
      deliveredAt: now, // Simulate immediate delivery
      metadata: input.metadata,
    }

    const notifications = this.notifications.get(fulfillmentOrderId) ?? []
    notifications.push(notification)
    this.notifications.set(fulfillmentOrderId, notifications)

    return notification
  }

  async getNotifications(fulfillmentOrderId: string): Promise<DeliveryNotification[]> {
    return this.notifications.get(fulfillmentOrderId) ?? []
  }

  // ===========================================================================
  // Returns
  // ===========================================================================

  async createReturnRequest(input: CreateReturnInput): Promise<ReturnRequest> {
    const now = new Date()
    const returnRequest: ReturnRequest = {
      id: generateId('ret'),
      orderId: input.orderId,
      fulfillmentOrderId: input.fulfillmentOrderId,
      status: 'requested',
      lineItems: input.lineItems,
      returnAddress: input.returnAddress,
      customerAddress: input.customerAddress,
      restockItems: input.restockItems ?? true,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }

    this.returns.set(returnRequest.id, returnRequest)
    return returnRequest
  }

  async getReturnRequest(id: string): Promise<ReturnRequest | null> {
    return this.returns.get(id) ?? null
  }

  async getReturnsByOrder(orderId: string): Promise<ReturnRequest[]> {
    return Array.from(this.returns.values()).filter((r) => r.orderId === orderId)
  }

  async updateReturnStatus(
    id: string,
    status: ReturnStatus,
    reason?: string
  ): Promise<ReturnRequest> {
    const returnRequest = this.returns.get(id)
    if (!returnRequest) {
      throw new Error('Return request not found')
    }

    const validTransitions = returnTransitions[returnRequest.status]
    if (!validTransitions.includes(status)) {
      throw new Error(`Invalid transition from ${returnRequest.status} to ${status}`)
    }

    const now = new Date()
    const updated: ReturnRequest = {
      ...returnRequest,
      status,
      updatedAt: now,
    }

    // Update timestamps based on status
    if (status === 'approved') {
      updated.approvedAt = now
    }
    if (status === 'received') {
      updated.receivedAt = now
    }
    if (status === 'completed' || status === 'refunded') {
      updated.completedAt = now
    }

    this.returns.set(id, updated)
    return updated
  }

  async approveReturn(id: string): Promise<ReturnRequest> {
    return this.updateReturnStatus(id, 'approved')
  }

  async rejectReturn(id: string, reason: string): Promise<ReturnRequest> {
    const returnRequest = this.returns.get(id)
    if (!returnRequest) {
      throw new Error('Return request not found')
    }

    const updated: ReturnRequest = {
      ...returnRequest,
      status: 'rejected',
      inspectionNotes: reason,
      updatedAt: new Date(),
    }

    this.returns.set(id, updated)
    return updated
  }

  async generateReturnLabel(id: string): Promise<ReturnRequest> {
    const returnRequest = this.returns.get(id)
    if (!returnRequest) {
      throw new Error('Return request not found')
    }

    if (returnRequest.status !== 'approved') {
      throw new Error('Return must be approved before generating label')
    }

    const updated: ReturnRequest = {
      ...returnRequest,
      status: 'label_created',
      returnLabelUrl: `https://labels.example.com/return/${id}`,
      returnTrackingNumber: `RET${Date.now().toString(36).toUpperCase()}`,
      returnCarrier: 'USPS',
      updatedAt: new Date(),
    }

    this.returns.set(id, updated)
    return updated
  }

  async markReturnReceived(id: string, inspectionNotes?: string): Promise<ReturnRequest> {
    const updated = await this.updateReturnStatus(id, 'received')

    if (inspectionNotes) {
      updated.inspectionNotes = inspectionNotes
      this.returns.set(id, updated)
    }

    return updated
  }

  async completeReturn(id: string, refundAmount?: number): Promise<ReturnRequest> {
    const returnRequest = this.returns.get(id)
    if (!returnRequest) {
      throw new Error('Return request not found')
    }

    const updated = await this.updateReturnStatus(id, 'completed')
    if (refundAmount !== undefined) {
      updated.refundAmount = refundAmount
      this.returns.set(id, updated)
    }

    return updated
  }

  // ===========================================================================
  // Exchanges
  // ===========================================================================

  async createExchangeRequest(input: CreateExchangeInput): Promise<ExchangeRequest> {
    const returnRequest = this.returns.get(input.returnRequestId)
    if (!returnRequest) {
      throw new Error('Return request not found')
    }

    const now = new Date()
    const exchange: ExchangeRequest = {
      id: generateId('exch'),
      orderId: returnRequest.orderId,
      returnRequestId: input.returnRequestId,
      status: 'requested',
      originalItems: returnRequest.lineItems.map((li) => ({
        lineItemId: li.lineItemId,
        quantity: li.quantity,
      })),
      exchangeItems: input.exchangeItems,
      priceDifference: input.priceDifference,
      paymentRequired: (input.priceDifference ?? 0) > 0,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }

    this.exchanges.set(exchange.id, exchange)
    return exchange
  }

  async getExchangeRequest(id: string): Promise<ExchangeRequest | null> {
    return this.exchanges.get(id) ?? null
  }

  async updateExchangeStatus(id: string, status: ExchangeStatus): Promise<ExchangeRequest> {
    const exchange = this.exchanges.get(id)
    if (!exchange) {
      throw new Error('Exchange request not found')
    }

    const validTransitions = exchangeTransitions[exchange.status]
    if (!validTransitions.includes(status)) {
      throw new Error(`Invalid transition from ${exchange.status} to ${status}`)
    }

    const updated: ExchangeRequest = {
      ...exchange,
      status,
      updatedAt: new Date(),
    }

    this.exchanges.set(id, updated)
    return updated
  }

  async processExchange(
    id: string
  ): Promise<{ exchange: ExchangeRequest; fulfillmentOrder: FulfillmentOrder }> {
    const exchange = this.exchanges.get(id)
    if (!exchange) {
      throw new Error('Exchange request not found')
    }

    if (exchange.status !== 'return_received') {
      throw new Error('Return must be received before processing exchange')
    }

    // Update exchange status
    await this.updateExchangeStatus(id, 'processing_exchange')

    // Get original fulfillment order for addresses
    const returnRequest = this.returns.get(exchange.returnRequestId)
    if (!returnRequest) {
      throw new Error('Return request not found')
    }

    const originalOrder = this.fulfillmentOrders.get(returnRequest.fulfillmentOrderId)
    if (!originalOrder) {
      throw new Error('Original fulfillment order not found')
    }

    // Create new fulfillment order for exchange items
    const fulfillmentOrder = await this.createFulfillmentOrder({
      orderId: exchange.orderId,
      orderNumber: `${originalOrder.orderNumber}-EX`,
      lineItems: exchange.exchangeItems.map((item) => ({
        orderLineItemId: `exch_${item.variantId}`,
        productId: item.productId,
        variantId: item.variantId,
        sku: item.sku,
        name: item.sku,
        quantity: item.quantity,
      })),
      originAddress: originalOrder.originAddress,
      destinationAddress: returnRequest.customerAddress,
      metadata: { exchangeId: id },
    })

    // Update exchange with fulfillment order ID
    const updatedExchange: ExchangeRequest = {
      ...exchange,
      status: 'processing_exchange',
      exchangeFulfillmentOrderId: fulfillmentOrder.id,
      updatedAt: new Date(),
    }
    this.exchanges.set(id, updatedExchange)

    return { exchange: updatedExchange, fulfillmentOrder }
  }

  // ===========================================================================
  // Analytics
  // ===========================================================================

  async getFulfillmentMetrics(options?: {
    from?: Date
    to?: Date
    providerId?: string
  }): Promise<FulfillmentMetrics> {
    let orders = Array.from(this.fulfillmentOrders.values())

    // Apply filters
    if (options?.from) {
      orders = orders.filter((o) => o.createdAt >= options.from!)
    }
    if (options?.to) {
      orders = orders.filter((o) => o.createdAt <= options.to!)
    }
    if (options?.providerId) {
      orders = orders.filter((o) => o.providerId === options.providerId)
    }

    const returns = Array.from(this.returns.values())

    // Calculate metrics
    const totalFulfillmentOrders = orders.length
    const pendingOrders = orders.filter((o) => o.status === 'pending').length
    const processingOrders = orders.filter((o) =>
      ['processing', 'picking', 'packing'].includes(o.status)
    ).length
    const shippedOrders = orders.filter((o) =>
      ['shipped', 'in_transit', 'out_for_delivery'].includes(o.status)
    ).length
    const deliveredOrders = orders.filter((o) => o.status === 'delivered').length
    const failedOrders = orders.filter((o) => o.status === 'failed').length
    const cancelledOrders = orders.filter((o) => o.status === 'cancelled').length
    const returnedOrders = orders.filter((o) => o.status === 'returned').length

    // Calculate processing time (from pending to shipped)
    const processingTimes: number[] = []
    for (const order of orders) {
      const shippedEntry = order.statusHistory.find((h) => h.status === 'shipped')
      const pendingEntry = order.statusHistory.find((h) => h.status === 'pending')
      if (shippedEntry && pendingEntry) {
        processingTimes.push(shippedEntry.timestamp.getTime() - pendingEntry.timestamp.getTime())
      }
    }
    const averageProcessingTime =
      processingTimes.length > 0
        ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
        : 0

    // Calculate delivery time (from shipped to delivered)
    const deliveryTimes: number[] = []
    for (const order of orders.filter((o) => o.status === 'delivered')) {
      if (order.actualShipDate && order.actualDeliveryDate) {
        deliveryTimes.push(
          order.actualDeliveryDate.getTime() - order.actualShipDate.getTime()
        )
      }
    }
    const averageDeliveryTime =
      deliveryTimes.length > 0
        ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length
        : 0

    // On-time delivery rate
    const deliveredWithEstimate = orders.filter(
      (o) => o.status === 'delivered' && o.estimatedDeliveryDate && o.actualDeliveryDate
    )
    const onTimeDeliveries = deliveredWithEstimate.filter(
      (o) => o.actualDeliveryDate! <= o.estimatedDeliveryDate!
    )
    const onTimeDeliveryRate =
      deliveredWithEstimate.length > 0
        ? onTimeDeliveries.length / deliveredWithEstimate.length
        : 0

    // Return rate
    const returnRate = deliveredOrders > 0 ? returns.length / deliveredOrders : 0

    // Carrier breakdown
    const carrierBreakdown: Record<string, number> = {}
    for (const order of orders) {
      if (order.carrier) {
        carrierBreakdown[order.carrier] = (carrierBreakdown[order.carrier] ?? 0) + 1
      }
    }

    // Service level breakdown
    const serviceBreakdown: Record<ServiceLevel, number> = {
      economy: 0,
      standard: 0,
      express: 0,
      overnight: 0,
      same_day: 0,
      freight: 0,
    }
    for (const order of orders) {
      if (order.serviceLevel) {
        serviceBreakdown[order.serviceLevel]++
      }
    }

    return {
      totalFulfillmentOrders,
      pendingOrders,
      processingOrders,
      shippedOrders,
      deliveredOrders,
      failedOrders,
      cancelledOrders,
      returnedOrders,
      averageProcessingTime,
      averageDeliveryTime,
      onTimeDeliveryRate,
      returnRate,
      carrierBreakdown,
      serviceBreakdown,
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createFulfillmentOrchestrator(): FulfillmentOrchestrator {
  return new InMemoryFulfillmentOrchestrator()
}
