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
 */

import { DO } from '../../../objects/DO'
import type { Thing } from '../../../types/Thing'

// ============================================================================
// TYPES
// ============================================================================

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
      { sku: 'WIDGET-001', name: 'Premium Widget', qty: 2, price: 99.50 },
      { sku: 'GADGET-002', name: 'Smart Gadget', qty: 1, price: 100 },
    ],
    total: 299,
    status: 'shipped',
    createdAt: '2024-06-15T10:30:00Z',
  },
  'ord-456': {
    customer: 'bob',
    items: [
      { sku: 'ENTERPRISE-001', name: 'Enterprise Suite', qty: 1, price: 1299 },
    ],
    total: 1299,
    status: 'pending',
    createdAt: '2024-06-20T14:00:00Z',
  },
  'ord-789': {
    customer: 'jane',
    items: [
      { sku: 'STARTER-001', name: 'Starter Pack', qty: 1, price: 49 },
    ],
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
    price: 99.50,
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

export class ExampleDO extends DO {
  static readonly $type = 'ExampleDO'

  // Track last reset time for hourly data reset
  private lastResetTime: number = 0

  /**
   * Called when the DO starts. Sets up event handlers and schedules.
   */
  async onStart(): Promise<void> {
    await this.seedDemoData()
    this.registerEventHandlers()
    this.registerScheduledJobs()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA SEEDING
  // ═══════════════════════════════════════════════════════════════════════════

  private async seedDemoData(): Promise<void> {
    // Check if we need to reset (hourly)
    const now = Date.now()
    if (this.lastResetTime && now - this.lastResetTime < 3600000) {
      return // Less than 1 hour since last reset
    }

    console.log('[ExampleDO] Seeding demo data...')

    // Register nouns
    await this.registerNoun('Customer', { plural: 'Customers', description: 'Customer accounts' })
    await this.registerNoun('Order', { plural: 'Orders', description: 'Customer orders' })
    await this.registerNoun('Invoice', { plural: 'Invoices', description: 'Payment invoices' })
    await this.registerNoun('Product', { plural: 'Products', description: 'Product catalog' })
    await this.registerNoun('Expense', { plural: 'Expenses', description: 'Expense reports' })
    await this.registerNoun('Payment', { plural: 'Payments', description: 'Payment transactions' })

    // Seed customers
    const customers = this.collection<Thing & CustomerData>('Customer')
    for (const [id, data] of Object.entries(DEMO_CUSTOMERS)) {
      await customers.create({ $id: id, $type: 'Customer', ...data })
    }

    // Seed orders
    const orders = this.collection<Thing & OrderData>('Order')
    for (const [id, data] of Object.entries(DEMO_ORDERS)) {
      await orders.create({ $id: id, $type: 'Order', ...data })
    }

    // Seed invoices
    const invoices = this.collection<Thing & InvoiceData>('Invoice')
    for (const [id, data] of Object.entries(DEMO_INVOICES)) {
      await invoices.create({ $id: id, $type: 'Invoice', ...data })
    }

    // Seed products
    const products = this.collection<Thing & ProductData>('Product')
    for (const [id, data] of Object.entries(DEMO_PRODUCTS)) {
      await products.create({ $id: id, $type: 'Product', ...data })
    }

    // Seed expenses
    const expenses = this.collection<Thing & ExpenseData>('Expense')
    for (const [id, data] of Object.entries(DEMO_EXPENSES)) {
      await expenses.create({ $id: id, $type: 'Expense', ...data })
    }

    this.lastResetTime = now
    console.log('[ExampleDO] Demo data seeded successfully')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  private registerEventHandlers(): void {
    // Customer events
    this.$.on.Customer.signup(async (event) => {
      console.log('[Event] Customer.signup:', event.data)
      // In production: send welcome email, update CRM, etc.
    })

    this.$.on.Customer.upgraded(async (event) => {
      console.log('[Event] Customer.upgraded:', event.data)
      // In production: notify sales team, update billing
    })

    // Order events
    this.$.on.Order.placed(async (event) => {
      console.log('[Event] Order.placed:', event.data)
      // In production: decrement inventory, create invoice
    })

    this.$.on.Order.shipped(async (event) => {
      console.log('[Event] Order.shipped:', event.data)
      // In production: send tracking email, update status
    })

    // Payment events
    this.$.on.Payment.completed(async (event) => {
      console.log('[Event] Payment.completed:', event.data)
      // In production: mark invoice paid, send receipt
    })

    this.$.on.Payment.failed(async (event) => {
      console.log('[Event] Payment.failed:', event.data)
      // In production: retry logic, notify customer
    })

    // Invoice events
    this.$.on.Invoice.overdue(async (event) => {
      console.log('[Event] Invoice.overdue:', event.data)
      // In production: escalation workflow, send reminder
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULED JOBS
  // ═══════════════════════════════════════════════════════════════════════════

  private registerScheduledJobs(): void {
    // Weekly metrics (every Monday at 9am)
    this.$.every.Monday.at('9am')(async () => {
      console.log('[Schedule] Weekly metrics report')
      const stats = await this.getStats()
      console.log('[Schedule] Stats:', stats)
    })

    // Daily digest (every day at 6am)
    this.$.every.day.at('6am')(async () => {
      console.log('[Schedule] Daily digest')
    })

    // Hourly health check
    this.$.every.hour(async () => {
      console.log('[Schedule] Health check - OK')
      // Reset demo data hourly
      await this.seedDemoData()
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUN METHODS - Customer
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a customer by ID
   */
  async Customer(id: string): Promise<Thing & CustomerData | null> {
    const customers = this.collection<Thing & CustomerData>('Customer')
    return customers.get(id)
  }

  /**
   * List all customers
   */
  async Customers(): Promise<Array<Thing & CustomerData>> {
    const customers = this.collection<Thing & CustomerData>('Customer')
    return customers.list()
  }

  /**
   * Get customer profile
   */
  async getProfile(customerId: string): Promise<{ customer: Thing & CustomerData; orders: number; totalSpent: number } | null> {
    const customer = await this.Customer(customerId)
    if (!customer) return null

    const orders = this.collection<Thing & OrderData>('Order')
    const customerOrders = await orders.find({ customer: customerId })
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
  async Order(id: string): Promise<Thing & OrderData | null> {
    const orders = this.collection<Thing & OrderData>('Order')
    return orders.get(id)
  }

  /**
   * List all orders
   */
  async Orders(): Promise<Array<Thing & OrderData>> {
    const orders = this.collection<Thing & OrderData>('Order')
    return orders.list()
  }

  /**
   * Get orders for a customer
   */
  async getOrdersForCustomer(customerId: string): Promise<Array<Thing & OrderData>> {
    const orders = this.collection<Thing & OrderData>('Order')
    return orders.find({ customer: customerId })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUN METHODS - Invoice
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get an invoice by ID
   */
  async Invoice(id: string): Promise<Thing & InvoiceData | null> {
    const invoices = this.collection<Thing & InvoiceData>('Invoice')
    return invoices.get(id)
  }

  /**
   * List all invoices
   */
  async Invoices(): Promise<Array<Thing & InvoiceData>> {
    const invoices = this.collection<Thing & InvoiceData>('Invoice')
    return invoices.list()
  }

  /**
   * Get overdue invoices
   */
  async getOverdueInvoices(): Promise<Array<Thing & InvoiceData>> {
    const invoices = this.collection<Thing & InvoiceData>('Invoice')
    return invoices.find({ status: 'overdue' })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUN METHODS - Product
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a product by SKU
   */
  async Product(sku: string): Promise<Thing & ProductData | null> {
    const products = this.collection<Thing & ProductData>('Product')
    return products.get(sku)
  }

  /**
   * List all products
   */
  async Products(): Promise<Array<Thing & ProductData>> {
    const products = this.collection<Thing & ProductData>('Product')
    return products.list()
  }

  /**
   * Check inventory level
   */
  async checkInventory(sku: string): Promise<{ sku: string; stock: number; available: boolean } | null> {
    const product = await this.Product(sku)
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
  async Expense(id: string): Promise<Thing & ExpenseData | null> {
    const expenses = this.collection<Thing & ExpenseData>('Expense')
    return expenses.get(id)
  }

  /**
   * List all expenses
   */
  async Expenses(): Promise<Array<Thing & ExpenseData>> {
    const expenses = this.collection<Thing & ExpenseData>('Expense')
    return expenses.list()
  }

  /**
   * Get expenses pending approval
   */
  async getPendingExpenses(): Promise<Array<Thing & ExpenseData>> {
    const expenses = this.collection<Thing & ExpenseData>('Expense')
    return expenses.find({ status: 'pending' })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get dashboard stats
   */
  async getStats(): Promise<{
    customers: number
    orders: number
    revenue: number
    pendingInvoices: number
    overdueInvoices: number
  }> {
    const customers = await this.Customers()
    const orders = await this.Orders()
    const invoices = await this.Invoices()

    const revenue = orders.reduce((sum, o) => sum + o.total, 0)
    const pendingInvoices = invoices.filter((i) => i.status === 'pending').length
    const overdueInvoices = invoices.filter((i) => i.status === 'overdue').length

    return {
      customers: customers.length,
      orders: orders.length,
      revenue,
      pendingInvoices,
      overdueInvoices,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMAIL (Demo methods - just log in demo mode)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send email (demo - just logs)
   */
  async sendEmail(to: string, subject: string, body: string): Promise<{ sent: boolean; messageId: string }> {
    const messageId = crypto.randomUUID()
    console.log(`[Email] To: ${to}, Subject: ${subject}, Body: ${body.slice(0, 100)}...`)
    return { sent: true, messageId }
  }

  /**
   * Notify customer
   */
  async notifyCustomer(customerId: string, message: string): Promise<boolean> {
    const customer = await this.Customer(customerId)
    if (!customer) return false

    await this.sendEmail(customer.email, 'Notification from example.com.ai', message)
    return true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RPC/MCP EXPOSED METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  static $mcp = {
    tools: {
      getStats: {
        description: 'Get dashboard statistics including customer count, orders, and revenue',
        inputSchema: {},
      },
      Customer: {
        description: 'Get a customer by ID',
        inputSchema: { id: { type: 'string', description: 'Customer ID (e.g., "alice", "bob")' } },
        required: ['id'],
      },
      Order: {
        description: 'Get an order by ID',
        inputSchema: { id: { type: 'string', description: 'Order ID (e.g., "ord-123")' } },
        required: ['id'],
      },
      Invoice: {
        description: 'Get an invoice by ID',
        inputSchema: { id: { type: 'string', description: 'Invoice ID (e.g., "inv-001")' } },
        required: ['id'],
      },
      checkInventory: {
        description: 'Check product inventory level',
        inputSchema: { sku: { type: 'string', description: 'Product SKU (e.g., "WIDGET-001")' } },
        required: ['sku'],
      },
      getOverdueInvoices: {
        description: 'Get all overdue invoices',
        inputSchema: {},
      },
      getPendingExpenses: {
        description: 'Get all expenses pending approval',
        inputSchema: {},
      },
    },
    resources: ['customers', 'orders', 'invoices', 'products', 'expenses'],
  }
}

export default ExampleDO
