// E-commerce checkout example - Type definitions

export interface Product {
  $type: 'Product'
  name: string
  price: number
  description: string
  inventory: number
  sku: string
}

export interface CartItem {
  $type: 'CartItem'
  productId: string
  quantity: number
  price: number
  name: string
}

export interface Cart {
  $type: 'Cart'
  customerId: string
  items: CartItem[]
  total: number
  status: 'active' | 'checked_out' | 'abandoned'
}

export interface Order {
  $type: 'Order'
  customerId: string
  cartId: string
  items: OrderItem[]
  subtotal: number
  tax: number
  total: number
  status: OrderStatus
  paymentId?: string | undefined
  shippingAddress?: ShippingAddress | undefined
}

export interface OrderItem {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  total: number
}

export type OrderStatus =
  | 'pending'
  | 'payment_processing'
  | 'payment_failed'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'

export interface ShippingAddress {
  name: string
  line1: string
  line2?: string | undefined
  city: string
  state: string
  postalCode: string
  country: string
}

export interface Payment {
  $type: 'Payment'
  orderId: string
  amount: number
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded'
  provider: string
  transactionId?: string | undefined
  errorMessage?: string | undefined
}

export interface Customer {
  $type: 'Customer'
  email: string
  name: string
  defaultShippingAddress?: ShippingAddress | undefined
}
