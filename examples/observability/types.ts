// Observability Example - Type definitions

/**
 * A product entity - demonstrates business logic with full observability
 */
export interface Product {
  $type: 'Product'
  name: string
  price: number
  category: string
  inventory: number
  createdAt: string
  updatedAt?: string
}

/**
 * An order entity - demonstrates distributed tracing across operations
 */
export interface Order {
  $type: 'Order'
  customerId: string
  items: OrderItem[]
  status: 'pending' | 'processing' | 'completed' | 'failed'
  total: number
  createdAt: string
  processedAt?: string
  completedAt?: string
}

/**
 * Order item
 */
export interface OrderItem {
  productId: string
  quantity: number
  price: number
}

/**
 * Create product request
 */
export interface CreateProductRequest {
  name: string
  price: number
  category: string
  inventory?: number
}

/**
 * Create order request
 */
export interface CreateOrderRequest {
  customerId: string
  items: Array<{
    productId: string
    quantity: number
  }>
}

/**
 * Metrics response format
 */
export interface MetricsResponse {
  counters: Array<{
    name: string
    value: number
    attributes: Record<string, unknown>
  }>
  gauges: Array<{
    name: string
    value: number
    attributes: Record<string, unknown>
  }>
  histograms: Array<{
    name: string
    count: number
    sum: number
    min: number
    max: number
    attributes: Record<string, unknown>
  }>
  timestamp: string
}
