/**
 * Event Type Definitions for Order Choreography
 *
 * Each event represents a domain action. Services emit events
 * without knowing who consumes them. This is the contract layer.
 */

// ============================================================================
// ORDER EVENTS
// ============================================================================

export interface OrderItem {
  sku: string
  name: string
  quantity: number
  price: number
}

export interface OrderPlacedEvent {
  orderId: string
  customerId: string
  items: OrderItem[]
  total: number
  shippingAddress: Address
  createdAt: string
}

export interface OrderCancelledEvent {
  orderId: string
  customerId: string
  reason: string
  cancelledAt: string
}

export interface OrderCompletedEvent {
  orderId: string
  customerId: string
  completedAt: string
}

// ============================================================================
// PAYMENT EVENTS
// ============================================================================

export interface PaymentRequestedEvent {
  orderId: string
  customerId: string
  amount: number
  idempotencyKey: string
}

export interface PaymentCompletedEvent {
  orderId: string
  paymentId: string
  amount: number
  completedAt: string
}

export interface PaymentFailedEvent {
  orderId: string
  error: string
  code: 'INSUFFICIENT_FUNDS' | 'CARD_DECLINED' | 'FRAUD_DETECTED' | 'EXPIRED' | 'UNKNOWN'
  failedAt: string
}

export interface PaymentRefundedEvent {
  orderId: string
  paymentId: string
  refundId: string
  amount: number
  reason: string
  refundedAt: string
}

// ============================================================================
// INVENTORY EVENTS
// ============================================================================

export interface InventoryReserveRequestedEvent {
  orderId: string
  items: Array<{ sku: string; quantity: number }>
  reservationExpiry: string // ISO timestamp when reservation expires
}

export interface InventoryReservedEvent {
  orderId: string
  reservationId: string
  items: Array<{ sku: string; quantity: number }>
  reservedAt: string
}

export interface InventoryReservationFailedEvent {
  orderId: string
  failedItems: Array<{
    sku: string
    requested: number
    available: number
  }>
  failedAt: string
}

export interface InventoryReleasedEvent {
  orderId: string
  reservationId?: string
  items: Array<{ sku: string; quantity: number }>
  reason: 'ORDER_CANCELLED' | 'PAYMENT_FAILED' | 'EXPIRED' | 'MANUAL'
  releasedAt: string
}

export interface InventoryDeductedEvent {
  orderId: string
  items: Array<{ sku: string; quantity: number }>
  deductedAt: string
}

// ============================================================================
// SHIPPING EVENTS
// ============================================================================

export interface Address {
  street: string
  city: string
  state: string
  zip: string
  country: string
}

export interface ShipmentCreatedEvent {
  orderId: string
  shipmentId: string
  carrier: string
  trackingNumber: string
  address: Address
  items: Array<{ sku: string; quantity: number }>
  createdAt: string
}

export interface ShipmentDispatchedEvent {
  orderId: string
  shipmentId: string
  trackingNumber: string
  carrier: string
  estimatedDelivery: string
  dispatchedAt: string
}

export interface ShipmentInTransitEvent {
  orderId: string
  shipmentId: string
  location: string
  timestamp: string
}

export interface ShipmentDeliveredEvent {
  orderId: string
  shipmentId: string
  deliveredAt: string
  signature?: string
}

export interface ShipmentCancelledEvent {
  orderId: string
  shipmentId: string
  reason: string
  cancelledAt: string
}

// ============================================================================
// NOTIFICATION EVENTS (for observability/UI)
// ============================================================================

export interface CustomerNotificationEvent {
  customerId: string
  orderId: string
  type:
    | 'order_confirmed'
    | 'payment_received'
    | 'payment_failed'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'refunded'
  message: string
  data?: Record<string, unknown>
  sentAt: string
}

// ============================================================================
// SAGA COORDINATION EVENTS
// ============================================================================

/**
 * Saga status tracking for the order lifecycle.
 * Used to coordinate compensation on failures.
 */
export interface SagaStep {
  name: string
  status: 'pending' | 'completed' | 'failed' | 'compensated'
  completedAt?: string
  error?: string
}

export interface OrderSagaState {
  orderId: string
  status: 'in_progress' | 'completed' | 'compensating' | 'failed'
  steps: {
    payment: SagaStep
    inventory: SagaStep
    shipping: SagaStep
  }
  startedAt: string
  completedAt?: string
  failedAt?: string
}

// ============================================================================
// EVENT UNION TYPES
// ============================================================================

export type OrderEvent =
  | { type: 'Order.placed'; data: OrderPlacedEvent }
  | { type: 'Order.cancelled'; data: OrderCancelledEvent }
  | { type: 'Order.completed'; data: OrderCompletedEvent }

export type PaymentEvent =
  | { type: 'Payment.requested'; data: PaymentRequestedEvent }
  | { type: 'Payment.completed'; data: PaymentCompletedEvent }
  | { type: 'Payment.failed'; data: PaymentFailedEvent }
  | { type: 'Payment.refunded'; data: PaymentRefundedEvent }

export type InventoryEvent =
  | { type: 'Inventory.reserveRequested'; data: InventoryReserveRequestedEvent }
  | { type: 'Inventory.reserved'; data: InventoryReservedEvent }
  | { type: 'Inventory.reservationFailed'; data: InventoryReservationFailedEvent }
  | { type: 'Inventory.released'; data: InventoryReleasedEvent }
  | { type: 'Inventory.deducted'; data: InventoryDeductedEvent }

export type ShippingEvent =
  | { type: 'Shipment.created'; data: ShipmentCreatedEvent }
  | { type: 'Shipment.dispatched'; data: ShipmentDispatchedEvent }
  | { type: 'Shipment.inTransit'; data: ShipmentInTransitEvent }
  | { type: 'Shipment.delivered'; data: ShipmentDeliveredEvent }
  | { type: 'Shipment.cancelled'; data: ShipmentCancelledEvent }

export type ChoreographyEvent =
  | OrderEvent
  | PaymentEvent
  | InventoryEvent
  | ShippingEvent
  | { type: 'Customer.notified'; data: CustomerNotificationEvent }
