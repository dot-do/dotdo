// Workflow Event Choreography Example - Type definitions

export type OrderStatus =
  | 'pending'
  | 'payment_requested'
  | 'payment_completed'
  | 'payment_failed'
  | 'inventory_reserved'
  | 'inventory_failed'
  | 'shipping_created'
  | 'shipping_dispatched'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'compensating'

export interface Order {
  $type: 'Order'
  customerId: string
  items: OrderItem[]
  total: number
  status: OrderStatus
  shippingAddress: ShippingAddress
  saga: SagaState
  paymentId?: string
  reservationId?: string
  shipmentId?: string
  createdAt: string
  completedAt?: string
  cancelledAt?: string
}

export interface OrderItem {
  sku: string
  name: string
  quantity: number
  price: number
}

export interface ShippingAddress {
  street: string
  city: string
  state: string
  zip: string
  country: string
}

export interface SagaState {
  steps: {
    payment: SagaStep
    inventory: SagaStep
    shipping: SagaStep
  }
  compensationReason?: string
}

export interface SagaStep {
  name: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'compensated'
  startedAt?: string
  completedAt?: string
  error?: string
}

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'refunded'

export interface Payment {
  $type: 'Payment'
  orderId: string
  amount: number
  status: PaymentStatus
  transactionId?: string
  refundId?: string
  errorMessage?: string
  createdAt: string
  completedAt?: string
}

export interface InventoryItem {
  $type: 'InventoryItem'
  sku: string
  name: string
  available: number
  reserved: number
}

export interface Reservation {
  $type: 'Reservation'
  orderId: string
  items: ReservationItem[]
  status: 'pending' | 'confirmed' | 'released' | 'deducted'
  createdAt: string
}

export interface ReservationItem {
  sku: string
  quantity: number
}

export type ShipmentStatus =
  | 'pending'
  | 'created'
  | 'dispatched'
  | 'in_transit'
  | 'delivered'
  | 'cancelled'

export interface Shipment {
  $type: 'Shipment'
  orderId: string
  trackingNumber: string
  carrier: string
  status: ShipmentStatus
  address: ShippingAddress
  estimatedDelivery?: string
  actualDelivery?: string
  createdAt: string
}

// Event types for choreography
export interface OrderPlacedEvent {
  type: 'Order.placed'
  payload: {
    orderId: string
    customerId: string
    items: OrderItem[]
    total: number
    shippingAddress: ShippingAddress
  }
}

export interface PaymentRequestedEvent {
  type: 'Payment.requested'
  payload: {
    orderId: string
    amount: number
    idempotencyKey: string
  }
}

export interface PaymentCompletedEvent {
  type: 'Payment.completed'
  payload: {
    orderId: string
    paymentId: string
    transactionId: string
  }
}

export interface PaymentFailedEvent {
  type: 'Payment.failed'
  payload: {
    orderId: string
    paymentId: string
    reason: string
  }
}

export interface InventoryReserveRequestedEvent {
  type: 'Inventory.reserveRequested'
  payload: {
    orderId: string
    items: ReservationItem[]
  }
}

export interface InventoryReservedEvent {
  type: 'Inventory.reserved'
  payload: {
    orderId: string
    reservationId: string
  }
}

export interface InventoryReservationFailedEvent {
  type: 'Inventory.reservationFailed'
  payload: {
    orderId: string
    reason: string
  }
}

export interface ShipmentCreateEvent {
  type: 'Shipment.create'
  payload: {
    orderId: string
    address: ShippingAddress
    items: OrderItem[]
  }
}

export interface ShipmentCreatedEvent {
  type: 'Shipment.created'
  payload: {
    orderId: string
    shipmentId: string
    trackingNumber: string
  }
}

export interface ShipmentDispatchedEvent {
  type: 'Shipment.dispatched'
  payload: {
    orderId: string
    shipmentId: string
  }
}

export interface ShipmentDeliveredEvent {
  type: 'Shipment.delivered'
  payload: {
    orderId: string
    shipmentId: string
  }
}
