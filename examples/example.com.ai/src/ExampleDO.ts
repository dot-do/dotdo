/**
 * ExampleDO - Live Demo Durable Object for example.com.ai
 *
 * This DO provides a fully functional demo environment for all documentation examples.
 * All code examples in docs, tests, and source use example.com.ai, making them runnable
 * against this live demo environment.
 *
 * Features:
 * - Seeded demo data (Customer, Order, Invoice, etc.)
 * - All example Noun methods
 * - Event handlers that log for demo visibility
 * - Scheduled job demos
 * - Read-only public access (data resets hourly)
 *
 * NOTE: This is a simplified standalone implementation that doesn't require the full
 * dotdo database schema. It uses in-memory data for the demo.
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

interface Thing {
  $id: string
  $type: string
}

interface CustomerData {
  email: string
  name: string
  plan: 'starter' | 'pro' | 'enterprise'
  region: string
  createdAt: string
}

interface OrderData {
  customer: string
  items: Array<{ sku: string; name: string; qty: number; price: number }>
  total: number
  status: 'pending' | 'paid' | 'shipped' | 'delivered'
  createdAt: string
}

interface InvoiceData {
  order: string
  amount: number
  status: 'pending' | 'paid' | 'overdue'
  dueDate: string
  daysOverdue?: number
}

interface ExpenseData {
  amount: number
  submitter: string
  description: string
  level: 'auto' | 'manager' | 'director' | 'cfo' | 'board'
  status: 'pending' | 'approved' | 'rejected'
}

interface ProductData {
  name: string
  sku: string
  price: number
  stock: number
}

// ============================================================================
// SEEDED DEMO DATA
// ============================================================================

const DEMO_CUSTOMERS: Record<string, CustomerData> = {
  alice: {
    email: 'alice@example.com.ai',
    name: 'Alice Johnson',
    plan: 'pro',
    region: 'SFO',
    createdAt: '2024-01-15T10:30:00Z',
  },
  bob: {
    email: 'bob@example.com.ai',
    name: 'Bob Smith',
    plan: 'enterprise',
    region: 'ORD',
    createdAt: '2024-02-20T14:45:00Z',
  },
  jane: {
    email: 'jane@example.com.ai',
    name: 'Jane Doe',
    plan: 'starter',
    region: 'LHR',
    createdAt: '2024-03-10T08:15:00Z',
  },
  john: {
    email: 'john@example.com.ai',
    name: 'John Williams',
    plan: 'pro',
    region: 'NYC',
    createdAt: '2024-04-05T16:20:00Z',
  },
  emma: {
    email: 'emma@example.com.ai',
    name: 'Emma Davis',
    plan: 'enterprise',
    region: 'TYO',
    createdAt: '2024-05-12T11:00:00Z',
  },
  charlie: {
    email: 'charlie@example.com.ai',
    name: 'Charlie Brown',
    plan: 'starter',
    region: 'SYD',
    createdAt: '2024-06-01T09:30:00Z',
  },
}

const DEMO_ORDERS: Record<string, OrderData> = {
  'ord-123': {
    customer: 'alice',
    items: [
      { sku: 'WIDGET-001', name: 'Premium Widget', qty: 2, price: 99.5 },
      { sku: 'GADGET-002', name: 'Smart Gadget', qty: 1, price: 100 },
    ],
    total: 299,
    status: 'shipped',
    createdAt: '2024-06-15T10:30:00Z',
  },
  'ord-456': {
    customer: 'bob',
    items: [{ sku: 'ENTERPRISE-001', name: 'Enterprise Suite', qty: 1, price: 1299 }],
    total: 1299,
    status: 'pending',
    createdAt: '2024-06-20T14:00:00Z',
  },
  'ord-789': {
    customer: 'jane',
    items: [{ sku: 'STARTER-001', name: 'Starter Pack', qty: 1, price: 49 }],
    total: 49,
    status: 'delivered',
    createdAt: '2024-06-01T08:00:00Z',
  },
}

const DEMO_INVOICES: Record<string, InvoiceData> = {
  'inv-001': {
    order: 'ord-123',
    amount: 299,
    status: 'paid',
    dueDate: '2024-07-15T00:00:00Z',
  },
  'inv-789': {
    order: 'ord-456',
    amount: 1299,
    status: 'overdue',
    dueDate: '2024-06-01T00:00:00Z',
    daysOverdue: 15,
  },
  'inv-002': {
    order: 'ord-789',
    amount: 49,
    status: 'paid',
    dueDate: '2024-06-30T00:00:00Z',
  },
}

const DEMO_EXPENSES: Record<string, ExpenseData> = {
  'exp-1': {
    amount: 50,
    submitter: 'alice',
    description: 'Office supplies',
    level: 'auto',
    status: 'approved',
  },
  'exp-123': {
    amount: 5000,
    submitter: 'bob',
    description: 'Conference registration',
    level: 'director',
    status: 'pending',
  },
  'exp-456': {
    amount: 25000,
    submitter: 'emma',
    description: 'New equipment purchase',
    level: 'cfo',
    status: 'pending',
  },
}

const DEMO_PRODUCTS: Record<string, ProductData> = {
  'WIDGET-001': {
    name: 'Premium Widget',
    sku: 'WIDGET-001',
    price: 99.5,
    stock: 150,
  },
  'GADGET-002': {
    name: 'Smart Gadget',
    sku: 'GADGET-002',
    price: 100,
    stock: 75,
  },
  'ENTERPRISE-001': {
    name: 'Enterprise Suite',
    sku: 'ENTERPRISE-001',
    price: 1299,
    stock: 10,
  },
  'STARTER-001': {
    name: 'Starter Pack',
    sku: 'STARTER-001',
    price: 49,
    stock: 500,
  },
}

// ============================================================================
// EXAMPLE DO CLASS
// ============================================================================

interface Env {
  ENVIRONMENT?: string
}

export class ExampleDO extends DurableObject<Env> {
  // ═══════════════════════════════════════════════════════════════════════════
  // NOUN METHODS - Customer
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a customer by ID
   */
  Customer(id: string): (Thing & CustomerData) | null {
    const data = DEMO_CUSTOMERS[id]
    if (!data) return null
    return { $id: id, $type: 'Customer', ...data }
  }

  /**
   * List all customers
   */
  Customers(): Array<Thing & CustomerData> {
    return Object.entries(DEMO_CUSTOMERS).map(([id, data]) => ({
      $id: id,
      $type: 'Customer',
      ...data,
    }))
  }

  /**
   * Get customer profile
   */
  getProfile(customerId: string): { customer: Thing & CustomerData; orders: number; totalSpent: number } | null {
    const customer = this.Customer(customerId)
    if (!customer) return null

    const customerOrders = Object.values(DEMO_ORDERS).filter((o) => o.customer === customerId)
    const totalSpent = customerOrders.reduce((sum, o) => sum + o.total, 0)

    return {
      customer,
      orders: customerOrders.length,
      totalSpent,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUN METHODS - Order
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get an order by ID
   */
  Order(id: string): (Thing & OrderData) | null {
    const data = DEMO_ORDERS[id]
    if (!data) return null
    return { $id: id, $type: 'Order', ...data }
  }

  /**
   * List all orders
   */
  Orders(): Array<Thing & OrderData> {
    return Object.entries(DEMO_ORDERS).map(([id, data]) => ({
      $id: id,
      $type: 'Order',
      ...data,
    }))
  }

  /**
   * Get orders for a customer
   */
  getOrdersForCustomer(customerId: string): Array<Thing & OrderData> {
    return Object.entries(DEMO_ORDERS)
      .filter(([, data]) => data.customer === customerId)
      .map(([id, data]) => ({
        $id: id,
        $type: 'Order',
        ...data,
      }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUN METHODS - Invoice
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get an invoice by ID
   */
  Invoice(id: string): (Thing & InvoiceData) | null {
    const data = DEMO_INVOICES[id]
    if (!data) return null
    return { $id: id, $type: 'Invoice', ...data }
  }

  /**
   * List all invoices
   */
  Invoices(): Array<Thing & InvoiceData> {
    return Object.entries(DEMO_INVOICES).map(([id, data]) => ({
      $id: id,
      $type: 'Invoice',
      ...data,
    }))
  }

  /**
   * Get overdue invoices
   */
  getOverdueInvoices(): Array<Thing & InvoiceData> {
    return Object.entries(DEMO_INVOICES)
      .filter(([, data]) => data.status === 'overdue')
      .map(([id, data]) => ({
        $id: id,
        $type: 'Invoice',
        ...data,
      }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUN METHODS - Product
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a product by SKU
   */
  Product(sku: string): (Thing & ProductData) | null {
    const data = DEMO_PRODUCTS[sku]
    if (!data) return null
    return { $id: sku, $type: 'Product', ...data }
  }

  /**
   * List all products
   */
  Products(): Array<Thing & ProductData> {
    return Object.entries(DEMO_PRODUCTS).map(([sku, data]) => ({
      $id: sku,
      $type: 'Product',
      ...data,
    }))
  }

  /**
   * Check inventory level
   */
  checkInventory(sku: string): { sku: string; stock: number; available: boolean } | null {
    const product = DEMO_PRODUCTS[sku]
    if (!product) return null
    return {
      sku: product.sku,
      stock: product.stock,
      available: product.stock > 0,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUN METHODS - Expense
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get an expense by ID
   */
  Expense(id: string): (Thing & ExpenseData) | null {
    const data = DEMO_EXPENSES[id]
    if (!data) return null
    return { $id: id, $type: 'Expense', ...data }
  }

  /**
   * List all expenses
   */
  Expenses(): Array<Thing & ExpenseData> {
    return Object.entries(DEMO_EXPENSES).map(([id, data]) => ({
      $id: id,
      $type: 'Expense',
      ...data,
    }))
  }

  /**
   * Get expenses pending approval
   */
  getPendingExpenses(): Array<Thing & ExpenseData> {
    return Object.entries(DEMO_EXPENSES)
      .filter(([, data]) => data.status === 'pending')
      .map(([id, data]) => ({
        $id: id,
        $type: 'Expense',
        ...data,
      }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get dashboard stats
   */
  getStats(): {
    customers: number
    orders: number
    revenue: number
    pendingInvoices: number
    overdueInvoices: number
  } {
    const customers = Object.keys(DEMO_CUSTOMERS).length
    const orders = Object.keys(DEMO_ORDERS).length
    const invoices = Object.values(DEMO_INVOICES)

    const revenue = Object.values(DEMO_ORDERS).reduce((sum, o) => sum + o.total, 0)
    const pendingInvoices = invoices.filter((i) => i.status === 'pending').length
    const overdueInvoices = invoices.filter((i) => i.status === 'overdue').length

    return {
      customers,
      orders,
      revenue,
      pendingInvoices,
      overdueInvoices,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle RPC endpoint
    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        // Call the method on this DO
        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Method '${method}' not found` },
            },
            { status: 400 }
          )
        }

        const result = methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json(
          {
            jsonrpc: '2.0',
            id: 0,
            error: { code: -32603, message: String(error) },
          },
          { status: 500 }
        )
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}

export default ExampleDO
