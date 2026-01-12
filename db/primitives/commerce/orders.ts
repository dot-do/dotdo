/**
 * Order Management - Order lifecycle primitive
 *
 * Provides order management functionality:
 * - Order creation and lifecycle
 * - State machine (pending -> paid -> shipped -> delivered)
 * - Payment and refund tracking
 * - Shipping and fulfillment
 * - Order search and query
 *
 * @module db/primitives/commerce/orders
 */

// =============================================================================
// Types
// =============================================================================

export type OrderStatus =
  | 'pending'
  | 'partially_paid'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'

export type FulfillmentStatus = 'unfulfilled' | 'partial' | 'fulfilled'

export interface Address {
  line1: string
  line2?: string
  city: string
  state: string
  postalCode: string
  country: string
}

export interface OrderLineItem {
  id: string
  productId: string
  variantId: string
  name: string
  sku?: string
  quantity: number
  unitPrice: number
  totalPrice: number
  fulfilledQuantity?: number
  metadata?: Record<string, unknown>
}

export interface PaymentInfo {
  paymentId: string
  amount: number
  method: string
  provider?: string
  status: string
  metadata?: Record<string, unknown>
}

export interface PaymentFailure {
  paymentId: string
  reason: string
  code?: string
  timestamp: Date
}

export interface Refund {
  id: string
  refundId: string
  amount: number
  reason: string
  timestamp: Date
  metadata?: Record<string, unknown>
}

export interface TrackingInfo {
  carrier: string
  trackingNumber: string
  trackingUrl?: string
  estimatedDelivery?: Date
}

export interface Shipment {
  id: string
  lineItems: { lineItemId: string; quantity: number }[]
  carrier?: string
  trackingNumber?: string
  trackingUrl?: string
  shippedAt: Date
}

export interface OrderNote {
  id: string
  content: string
  type: 'internal' | 'customer'
  author?: string
  timestamp: Date
}

export interface StatusHistoryEntry {
  status: OrderStatus
  timestamp: Date
  metadata?: Record<string, unknown>
}

export interface Order {
  id: string
  orderNumber: string
  customerId: string
  lineItems: OrderLineItem[]
  subtotal: number
  shippingCost?: number
  taxAmount?: number
  discountAmount?: number
  discountCode?: string
  total: number
  amountDue?: number
  status: OrderStatus
  fulfillmentStatus?: FulfillmentStatus
  shippingAddress?: Address
  billingAddress?: Address
  payment?: PaymentInfo
  paymentFailures?: PaymentFailure[]
  refunds?: Refund[]
  totalRefunded?: number
  tracking?: TrackingInfo
  shipments?: Shipment[]
  notes?: OrderNote[]
  metadata?: Record<string, unknown>
  statusHistory?: StatusHistoryEntry[]
  createdAt: Date
  updatedAt: Date
  paidAt?: Date
  shippedAt?: Date
  deliveredAt?: Date
  cancelledAt?: Date
  refundedAt?: Date
  cancellationReason?: string
}

export interface CreateOrderInput {
  customerId: string
  lineItems: Omit<OrderLineItem, 'id'>[]
  shippingAddress?: Address
  billingAddress?: Address
  shippingCost?: number
  taxAmount?: number
  discountAmount?: number
  discountCode?: string
  metadata?: Record<string, unknown>
}

export interface OrderTransition {
  paymentId?: string
  paymentMethod?: string
  trackingNumber?: string
  carrier?: string
  reason?: string
  refundId?: string
  refundAmount?: number
}

export interface RecordPaymentInput {
  paymentId: string
  amount: number
  method: string
  provider?: string
  status: string
  metadata?: Record<string, unknown>
}

export interface RecordPaymentFailureInput {
  paymentId: string
  reason: string
  code?: string
}

export interface ProcessRefundInput {
  amount: number
  reason: string
  refundId: string
  metadata?: Record<string, unknown>
}

export interface AddTrackingInput {
  carrier: string
  trackingNumber: string
  trackingUrl?: string
  estimatedDelivery?: Date
}

export interface AddShipmentInput {
  lineItems: { lineItemId: string; quantity: number }[]
  carrier?: string
  trackingNumber?: string
  trackingUrl?: string
}

export interface FulfillLineItemInput {
  quantity: number
  shipmentId?: string
}

export interface AddNoteInput {
  content: string
  type: 'internal' | 'customer'
  author?: string
}

export interface OrderQuery {
  status?: OrderStatus
  orderNumber?: string
  customerId?: string
  createdAfter?: Date
  createdBefore?: Date
  totalMin?: number
  totalMax?: number
}

export interface QueryOptions {
  limit?: number
  offset?: number
  sortBy?: 'createdAt' | 'total' | 'orderNumber'
  sortOrder?: 'asc' | 'desc'
}

// =============================================================================
// State Machine
// =============================================================================

const validTransitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'partially_paid', 'cancelled'],
  partially_paid: ['paid', 'cancelled', 'refunded'],
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
}

// =============================================================================
// OrderManager Interface
// =============================================================================

export interface OrderManager {
  // Order CRUD
  createOrder(input: CreateOrderInput): Promise<Order>
  getOrder(id: string): Promise<Order | null>
  getOrderByNumber(orderNumber: string): Promise<Order | null>
  getOrdersByCustomer(customerId: string): Promise<Order[]>

  // State machine
  transitionTo(id: string, status: OrderStatus, metadata?: OrderTransition): Promise<Order>
  getValidTransitions(id: string): Promise<OrderStatus[]>

  // Payment
  recordPayment(id: string, input: RecordPaymentInput): Promise<Order>
  recordPaymentFailure(id: string, input: RecordPaymentFailureInput): Promise<Order>
  processRefund(id: string, input: ProcessRefundInput): Promise<Refund>

  // Shipping
  addTracking(id: string, input: AddTrackingInput): Promise<Order>
  addShipment(id: string, input: AddShipmentInput): Promise<Shipment>
  fulfillLineItem(id: string, lineItemId: string, input: FulfillLineItemInput): Promise<Order>

  // Notes and metadata
  addNote(id: string, input: AddNoteInput): Promise<Order>
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<Order>
  updateShippingAddress(id: string, address: Address): Promise<Order>

  // Query
  queryOrders(query: OrderQuery, options?: QueryOptions): Promise<Order[]>
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}${random}`
}

function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `ORD-${timestamp}${random}`
}

// =============================================================================
// Implementation
// =============================================================================

class InMemoryOrderManager implements OrderManager {
  private orders: Map<string, Order> = new Map()
  private orderNumberIndex: Map<string, string> = new Map()

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const lineItems: OrderLineItem[] = input.lineItems.map((item) => ({
      ...item,
      id: generateId('line'),
      fulfilledQuantity: 0,
    }))

    const subtotal = lineItems.reduce((sum, item) => sum + item.totalPrice, 0)
    const shippingCost = input.shippingCost ?? 0
    const taxAmount = input.taxAmount ?? 0
    const discountAmount = input.discountAmount ?? 0
    const total = subtotal + shippingCost + taxAmount - discountAmount

    const orderNumber = generateOrderNumber()
    const now = new Date()

    const order: Order = {
      id: generateId('order'),
      orderNumber,
      customerId: input.customerId,
      lineItems,
      subtotal,
      shippingCost: input.shippingCost,
      taxAmount: input.taxAmount,
      discountAmount: input.discountAmount,
      discountCode: input.discountCode,
      total,
      amountDue: total,
      status: 'pending',
      fulfillmentStatus: 'unfulfilled',
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingAddress,
      metadata: input.metadata,
      statusHistory: [{ status: 'pending', timestamp: now }],
      notes: [],
      paymentFailures: [],
      refunds: [],
      shipments: [],
      createdAt: now,
      updatedAt: now,
    }

    this.orders.set(order.id, order)
    this.orderNumberIndex.set(orderNumber, order.id)

    return order
  }

  async getOrder(id: string): Promise<Order | null> {
    return this.orders.get(id) ?? null
  }

  async getOrderByNumber(orderNumber: string): Promise<Order | null> {
    const id = this.orderNumberIndex.get(orderNumber)
    if (!id) return null
    return this.orders.get(id) ?? null
  }

  async getOrdersByCustomer(customerId: string): Promise<Order[]> {
    const orders: Order[] = []
    for (const order of this.orders.values()) {
      if (order.customerId === customerId) {
        orders.push(order)
      }
    }
    return orders
  }

  async transitionTo(
    id: string,
    status: OrderStatus,
    metadata?: OrderTransition
  ): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const currentStatus = order.status
    const allowed = validTransitions[currentStatus]

    if (!allowed || allowed.length === 0) {
      throw new Error(`Cannot transition from ${currentStatus}`)
    }

    if (!allowed.includes(status)) {
      throw new Error(`Invalid transition from ${currentStatus} to ${status}`)
    }

    const now = new Date()
    const updated: Order = {
      ...order,
      status,
      updatedAt: now,
      statusHistory: [
        ...(order.statusHistory ?? []),
        { status, timestamp: now, metadata },
      ],
    }

    // Set timestamp fields based on status
    switch (status) {
      case 'paid':
        updated.paidAt = now
        break
      case 'shipped':
        updated.shippedAt = now
        if (metadata?.trackingNumber) {
          updated.tracking = {
            carrier: metadata.carrier ?? 'Unknown',
            trackingNumber: metadata.trackingNumber,
          }
        }
        break
      case 'delivered':
        updated.deliveredAt = now
        break
      case 'cancelled':
        updated.cancelledAt = now
        updated.cancellationReason = metadata?.reason
        break
      case 'refunded':
        updated.refundedAt = now
        break
    }

    this.orders.set(id, updated)
    return updated
  }

  async getValidTransitions(id: string): Promise<OrderStatus[]> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    return validTransitions[order.status] ?? []
  }

  async recordPayment(id: string, input: RecordPaymentInput): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const payment: PaymentInfo = {
      paymentId: input.paymentId,
      amount: input.amount,
      method: input.method,
      provider: input.provider,
      status: input.status,
      metadata: input.metadata,
    }

    const amountDue = order.total - input.amount
    const newStatus: OrderStatus = amountDue <= 0 ? 'paid' : 'partially_paid'

    const now = new Date()
    const updated: Order = {
      ...order,
      payment,
      amountDue: Math.max(0, amountDue),
      status: newStatus,
      paidAt: newStatus === 'paid' ? now : order.paidAt,
      updatedAt: now,
      statusHistory: [
        ...(order.statusHistory ?? []),
        { status: newStatus, timestamp: now, metadata: { paymentId: input.paymentId } },
      ],
    }

    this.orders.set(id, updated)
    return updated
  }

  async recordPaymentFailure(
    id: string,
    input: RecordPaymentFailureInput
  ): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const failure: PaymentFailure = {
      paymentId: input.paymentId,
      reason: input.reason,
      code: input.code,
      timestamp: new Date(),
    }

    const updated: Order = {
      ...order,
      paymentFailures: [...(order.paymentFailures ?? []), failure],
      updatedAt: new Date(),
    }

    this.orders.set(id, updated)
    return updated
  }

  async processRefund(id: string, input: ProcessRefundInput): Promise<Refund> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const totalPaid = order.payment?.amount ?? 0
    const totalRefunded = order.totalRefunded ?? 0

    if (input.amount > totalPaid - totalRefunded) {
      throw new Error('Refund amount exceeds paid amount')
    }

    const refund: Refund = {
      id: generateId('refund'),
      refundId: input.refundId,
      amount: input.amount,
      reason: input.reason,
      timestamp: new Date(),
      metadata: input.metadata,
    }

    const newTotalRefunded = totalRefunded + input.amount
    const isFullRefund = newTotalRefunded >= totalPaid
    const now = new Date()

    const updated: Order = {
      ...order,
      refunds: [...(order.refunds ?? []), refund],
      totalRefunded: newTotalRefunded,
      status: isFullRefund ? 'refunded' : order.status,
      refundedAt: isFullRefund ? now : order.refundedAt,
      updatedAt: now,
      statusHistory: isFullRefund
        ? [
            ...(order.statusHistory ?? []),
            { status: 'refunded' as OrderStatus, timestamp: now },
          ]
        : order.statusHistory,
    }

    this.orders.set(id, updated)
    return refund
  }

  async addTracking(id: string, input: AddTrackingInput): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const updated: Order = {
      ...order,
      tracking: {
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl,
        estimatedDelivery: input.estimatedDelivery,
      },
      updatedAt: new Date(),
    }

    this.orders.set(id, updated)
    return updated
  }

  async addShipment(id: string, input: AddShipmentInput): Promise<Shipment> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const shipment: Shipment = {
      id: generateId('ship'),
      lineItems: input.lineItems,
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl,
      shippedAt: new Date(),
    }

    const updated: Order = {
      ...order,
      shipments: [...(order.shipments ?? []), shipment],
      updatedAt: new Date(),
    }

    this.orders.set(id, updated)
    return shipment
  }

  async fulfillLineItem(
    id: string,
    lineItemId: string,
    input: FulfillLineItemInput
  ): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const lineItems = order.lineItems.map((item) => {
      if (item.id === lineItemId) {
        return {
          ...item,
          fulfilledQuantity: (item.fulfilledQuantity ?? 0) + input.quantity,
        }
      }
      return item
    })

    // Calculate fulfillment status
    let totalQuantity = 0
    let fulfilledQuantity = 0
    for (const item of lineItems) {
      totalQuantity += item.quantity
      fulfilledQuantity += item.fulfilledQuantity ?? 0
    }

    let fulfillmentStatus: FulfillmentStatus = 'unfulfilled'
    if (fulfilledQuantity >= totalQuantity) {
      fulfillmentStatus = 'fulfilled'
    } else if (fulfilledQuantity > 0) {
      fulfillmentStatus = 'partial'
    }

    const updated: Order = {
      ...order,
      lineItems,
      fulfillmentStatus,
      updatedAt: new Date(),
    }

    this.orders.set(id, updated)
    return updated
  }

  async addNote(id: string, input: AddNoteInput): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const note: OrderNote = {
      id: generateId('note'),
      content: input.content,
      type: input.type,
      author: input.author,
      timestamp: new Date(),
    }

    const updated: Order = {
      ...order,
      notes: [...(order.notes ?? []), note],
      updatedAt: new Date(),
    }

    this.orders.set(id, updated)
    return updated
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>
  ): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const updated: Order = {
      ...order,
      metadata: { ...(order.metadata ?? {}), ...metadata },
      updatedAt: new Date(),
    }

    this.orders.set(id, updated)
    return updated
  }

  async updateShippingAddress(id: string, address: Address): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    // Can't update after shipping
    if (order.status === 'shipped' || order.status === 'delivered') {
      throw new Error('Cannot update address after shipping')
    }

    const updated: Order = {
      ...order,
      shippingAddress: address,
      updatedAt: new Date(),
    }

    this.orders.set(id, updated)
    return updated
  }

  async queryOrders(query: OrderQuery, options?: QueryOptions): Promise<Order[]> {
    let results = Array.from(this.orders.values())

    // Filter by status
    if (query.status) {
      results = results.filter((o) => o.status === query.status)
    }

    // Filter by order number
    if (query.orderNumber) {
      results = results.filter((o) => o.orderNumber === query.orderNumber)
    }

    // Filter by customer
    if (query.customerId) {
      results = results.filter((o) => o.customerId === query.customerId)
    }

    // Filter by date range
    if (query.createdAfter) {
      results = results.filter((o) => o.createdAt >= query.createdAfter!)
    }
    if (query.createdBefore) {
      results = results.filter((o) => o.createdAt <= query.createdBefore!)
    }

    // Filter by total
    if (query.totalMin !== undefined) {
      results = results.filter((o) => o.total >= query.totalMin!)
    }
    if (query.totalMax !== undefined) {
      results = results.filter((o) => o.total <= query.totalMax!)
    }

    // Sort
    if (options?.sortBy) {
      results.sort((a, b) => {
        let aVal: number | Date | string
        let bVal: number | Date | string

        switch (options.sortBy) {
          case 'createdAt':
            aVal = a.createdAt
            bVal = b.createdAt
            break
          case 'total':
            aVal = a.total
            bVal = b.total
            break
          case 'orderNumber':
            aVal = a.orderNumber
            bVal = b.orderNumber
            break
          default:
            return 0
        }

        if (aVal instanceof Date && bVal instanceof Date) {
          return options.sortOrder === 'desc'
            ? bVal.getTime() - aVal.getTime()
            : aVal.getTime() - bVal.getTime()
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return options.sortOrder === 'desc' ? bVal - aVal : aVal - bVal
        }
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return options.sortOrder === 'desc'
            ? bVal.localeCompare(aVal)
            : aVal.localeCompare(bVal)
        }
        return 0
      })
    }

    // Paginate
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? results.length
    return results.slice(offset, offset + limit)
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createOrderManager(): OrderManager {
  return new InMemoryOrderManager()
}
