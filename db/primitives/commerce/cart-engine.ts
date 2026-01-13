/**
 * Cart Engine with Session Handling
 *
 * A higher-level cart management system that provides:
 * - Guest and authenticated cart support via session tokens
 * - Automatic cart merge on login
 * - Automatic inventory reservation when items are added
 * - Cart expiration cleanup with inventory release
 * - Session-based cart retrieval
 *
 * This wraps the lower-level CartManager and InventoryManager to provide
 * a complete cart solution with session handling.
 *
 * @module db/primitives/commerce/cart-engine
 */

import {
  createCartManager,
  type CartManager,
  type Cart,
  type CartItem,
  type CartOptions,
  type AddItemInput,
  type CartSnapshot,
} from './cart'

import {
  createInventoryManager,
  type InventoryManager,
  type Reservation,
  type InventoryOptions,
} from './inventory'

// =============================================================================
// Types
// =============================================================================

export interface Session {
  id: string
  customerId?: string
  isGuest: boolean
  cartId?: string
  createdAt: Date
  lastActivityAt: Date
  expiresAt?: Date
}

export interface CartEngineOptions {
  cart?: CartOptions
  inventory?: InventoryOptions
  sessionTTL?: number // Session TTL in ms
  reservationTTL?: number // Inventory reservation TTL in ms
  cleanupIntervalMs?: number // Auto-cleanup interval
  onSessionExpired?: (session: Session) => void
  onCartMerged?: (guestCart: Cart, customerCart: Cart, mergedCart: Cart) => void
  onReservationFailed?: (cartId: string, variantId: string, quantity: number, error: Error) => void
}

export interface AddToCartInput extends Omit<AddItemInput, 'productId' | 'variantId' | 'quantity'> {
  productId: string
  variantId: string
  quantity: number
}

export interface CartWithReservations extends Cart {
  reservations: Reservation[]
}

export interface MergeResult {
  cart: Cart
  releasedReservations: string[]
  createdReservations: string[]
}

export interface LoginResult {
  session: Session
  cart: Cart | null
  merged: boolean
  mergeDetails?: {
    guestItemCount: number
    customerItemCount: number
    mergedItemCount: number
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateSessionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `sess_${timestamp}${random}`
}

// =============================================================================
// CartEngine Implementation
// =============================================================================

export class CartEngine {
  private cartManager: CartManager
  private inventoryManager: InventoryManager
  private sessions: Map<string, Session> = new Map()
  private customerSessions: Map<string, string> = new Map() // customerId -> sessionId
  private cartReservations: Map<string, string[]> = new Map() // cartId -> reservationIds
  private options: CartEngineOptions
  private cleanupTimer?: ReturnType<typeof setInterval>

  constructor(options?: CartEngineOptions) {
    this.options = options ?? {}
    this.cartManager = createCartManager(this.options.cart)
    this.inventoryManager = createInventoryManager(this.options.inventory)

    // Start cleanup timer if configured
    if (this.options.cleanupIntervalMs) {
      this.startAutoCleanup()
    }
  }

  // =============================================================================
  // Session Management
  // =============================================================================

  /**
   * Create a new guest session
   */
  async createGuestSession(): Promise<Session> {
    const now = new Date()
    const session: Session = {
      id: generateSessionId(),
      isGuest: true,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: this.options.sessionTTL
        ? new Date(now.getTime() + this.options.sessionTTL)
        : undefined,
    }

    this.sessions.set(session.id, session)
    return session
  }

  /**
   * Create or get authenticated session for a customer
   */
  async getOrCreateAuthenticatedSession(customerId: string): Promise<Session> {
    // Check if customer already has a session
    const existingSessionId = this.customerSessions.get(customerId)
    if (existingSessionId) {
      const session = this.sessions.get(existingSessionId)
      if (session && !this.isSessionExpired(session)) {
        session.lastActivityAt = new Date()
        return session
      }
    }

    // Create new authenticated session
    const now = new Date()
    const session: Session = {
      id: generateSessionId(),
      customerId,
      isGuest: false,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: this.options.sessionTTL
        ? new Date(now.getTime() + this.options.sessionTTL)
        : undefined,
    }

    this.sessions.set(session.id, session)
    this.customerSessions.set(customerId, session.id)

    // Try to find existing customer cart
    const existingCart = await this.cartManager.getCartByCustomer(customerId)
    if (existingCart) {
      session.cartId = existingCart.id
    }

    return session
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    if (this.isSessionExpired(session)) {
      await this.expireSession(sessionId)
      return null
    }

    return session
  }

  /**
   * Login: Convert guest session to authenticated or merge carts
   */
  async login(guestSessionId: string, customerId: string): Promise<LoginResult> {
    const guestSession = await this.getSession(guestSessionId)

    // Get or create authenticated session
    const authSession = await this.getOrCreateAuthenticatedSession(customerId)

    // If no guest session or no guest cart, just return authenticated session
    if (!guestSession || !guestSession.cartId) {
      // Get existing customer cart if any
      const customerCart = authSession.cartId
        ? await this.cartManager.getCart(authSession.cartId)
        : await this.cartManager.getCartByCustomer(customerId)

      return {
        session: authSession,
        cart: customerCart,
        merged: false,
      }
    }

    // Get guest cart
    const guestCart = await this.cartManager.getCart(guestSession.cartId)
    if (!guestCart || guestCart.items.length === 0) {
      // Delete empty guest session
      await this.deleteSession(guestSessionId)
      const customerCart = authSession.cartId
        ? await this.cartManager.getCart(authSession.cartId)
        : null
      return {
        session: authSession,
        cart: customerCart,
        merged: false,
      }
    }

    // Get or create customer cart
    let customerCart = authSession.cartId
      ? await this.cartManager.getCart(authSession.cartId)
      : await this.cartManager.getCartByCustomer(customerId)

    if (!customerCart) {
      customerCart = await this.cartManager.createCart({ customerId })
      authSession.cartId = customerCart.id
    }

    const guestItemCount = guestCart.itemCount
    const customerItemCount = customerCart.itemCount

    // Merge carts
    const mergedCart = await this.mergeCarts(guestSession.cartId, customerCart.id)
    authSession.cartId = mergedCart.id

    // Delete guest session
    await this.deleteSession(guestSessionId)

    // Trigger callback
    if (this.options.onCartMerged) {
      this.options.onCartMerged(guestCart, customerCart, mergedCart)
    }

    return {
      session: authSession,
      cart: mergedCart,
      merged: true,
      mergeDetails: {
        guestItemCount,
        customerItemCount,
        mergedItemCount: mergedCart.itemCount,
      },
    }
  }

  /**
   * Logout: Invalidate authenticated session
   */
  async logout(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)
    if (session && session.customerId) {
      this.customerSessions.delete(session.customerId)
    }
    await this.deleteSession(sessionId)
  }

  private isSessionExpired(session: Session): boolean {
    if (!session.expiresAt) return false
    return new Date() >= session.expiresAt
  }

  private async expireSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      // Trigger callback
      if (this.options.onSessionExpired) {
        this.options.onSessionExpired(session)
      }

      // Release cart reservations for guest carts
      if (session.isGuest && session.cartId) {
        await this.releaseCartReservations(session.cartId)
      }

      // Delete session
      await this.deleteSession(sessionId)
    }
  }

  private async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      if (session.customerId) {
        this.customerSessions.delete(session.customerId)
      }
      this.sessions.delete(sessionId)
    }
  }

  // =============================================================================
  // Cart Management
  // =============================================================================

  /**
   * Get or create cart for session
   */
  async getOrCreateCart(sessionId: string): Promise<Cart> {
    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error('Invalid or expired session')
    }

    // Update session activity
    session.lastActivityAt = new Date()

    // Return existing cart if present
    if (session.cartId) {
      const cart = await this.cartManager.getCart(session.cartId)
      if (cart) return cart
    }

    // Create new cart
    const cart = await this.cartManager.createCart({
      customerId: session.customerId,
    })

    session.cartId = cart.id
    return cart
  }

  /**
   * Get cart for session (returns null if no cart)
   */
  async getCart(sessionId: string): Promise<Cart | null> {
    const session = await this.getSession(sessionId)
    if (!session || !session.cartId) {
      return null
    }

    session.lastActivityAt = new Date()
    return this.cartManager.getCart(session.cartId)
  }

  /**
   * Get cart with reservation details
   */
  async getCartWithReservations(sessionId: string): Promise<CartWithReservations | null> {
    const cart = await this.getCart(sessionId)
    if (!cart) return null

    const reservationIds = this.cartReservations.get(cart.id) ?? []
    const reservations: Reservation[] = []

    for (const reservationId of reservationIds) {
      const reservation = await this.inventoryManager.getReservation(reservationId)
      if (reservation && reservation.status === 'active') {
        reservations.push(reservation)
      }
    }

    return {
      ...cart,
      reservations,
    }
  }

  /**
   * Add item to cart with automatic inventory reservation
   */
  async addItem(sessionId: string, input: AddToCartInput): Promise<CartItem> {
    const cart = await this.getOrCreateCart(sessionId)

    // Check inventory availability
    const available = await this.inventoryManager.isAvailable(input.variantId, input.quantity)
    if (!available) {
      throw new Error('Insufficient inventory')
    }

    // Add item to cart
    const item = await this.cartManager.addItem(cart.id, input)

    // Create inventory reservation
    try {
      const reservation = await this.inventoryManager.createReservation({
        variantId: input.variantId,
        quantity: input.quantity,
        referenceId: cart.id,
        referenceType: 'cart',
        ttl: this.options.reservationTTL,
      })

      // Track reservation
      const reservations = this.cartReservations.get(cart.id) ?? []
      reservations.push(reservation.id)
      this.cartReservations.set(cart.id, reservations)
    } catch (error) {
      // Reservation failed - remove item from cart
      await this.cartManager.removeItem(cart.id, item.id)
      if (this.options.onReservationFailed) {
        this.options.onReservationFailed(cart.id, input.variantId, input.quantity, error as Error)
      }
      throw new Error('Failed to reserve inventory')
    }

    return item
  }

  /**
   * Update item quantity with inventory reservation adjustment
   */
  async updateItemQuantity(
    sessionId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    const cart = await this.getCart(sessionId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    const item = cart.items.find((i) => i.id === itemId)
    if (!item) {
      throw new Error('Item not found')
    }

    const quantityDelta = quantity - item.quantity

    if (quantityDelta > 0) {
      // Increasing quantity - need more inventory
      const available = await this.inventoryManager.isAvailable(item.variantId, quantityDelta)
      if (!available) {
        throw new Error('Insufficient inventory')
      }

      // Create additional reservation
      const reservation = await this.inventoryManager.createReservation({
        variantId: item.variantId,
        quantity: quantityDelta,
        referenceId: cart.id,
        referenceType: 'cart',
        ttl: this.options.reservationTTL,
      })

      const reservations = this.cartReservations.get(cart.id) ?? []
      reservations.push(reservation.id)
      this.cartReservations.set(cart.id, reservations)
    } else if (quantityDelta < 0) {
      // Decreasing quantity - release some inventory
      await this.releasePartialReservation(cart.id, item.variantId, -quantityDelta)
    }

    if (quantity === 0) {
      // Remove all reservations for this item
      await this.releaseItemReservations(cart.id, item.variantId)
    }

    await this.cartManager.updateItemQuantity(cart.id, itemId, quantity)
  }

  /**
   * Remove item from cart with inventory release
   */
  async removeItem(sessionId: string, itemId: string): Promise<void> {
    const cart = await this.getCart(sessionId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    const item = cart.items.find((i) => i.id === itemId)
    if (item) {
      await this.releaseItemReservations(cart.id, item.variantId)
    }

    await this.cartManager.removeItem(cart.id, itemId)
  }

  /**
   * Clear cart with inventory release
   */
  async clearCart(sessionId: string): Promise<void> {
    const cart = await this.getCart(sessionId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    await this.releaseCartReservations(cart.id)
    await this.cartManager.clearCart(cart.id)
  }

  /**
   * Merge guest cart into authenticated cart
   */
  private async mergeCarts(guestCartId: string, customerCartId: string): Promise<Cart> {
    const guestCart = await this.cartManager.getCart(guestCartId)
    if (!guestCart) {
      throw new Error('Guest cart not found')
    }

    // Transfer reservations from guest cart to customer cart
    const guestReservations = this.cartReservations.get(guestCartId) ?? []
    const customerReservations = this.cartReservations.get(customerCartId) ?? []

    // Update reservation references to point to customer cart
    for (const reservationId of guestReservations) {
      // Note: In a real implementation, we'd update the reservation's referenceId
      // For now, we just transfer the tracking
      customerReservations.push(reservationId)
    }

    this.cartReservations.set(customerCartId, customerReservations)
    this.cartReservations.delete(guestCartId)

    // Merge carts via cart manager
    const mergedCart = await this.cartManager.mergeCarts(guestCartId, customerCartId)

    return mergedCart
  }

  // =============================================================================
  // Checkout
  // =============================================================================

  /**
   * Mark cart as converted and confirm reservations
   */
  async checkout(sessionId: string, orderId: string): Promise<CartSnapshot> {
    const cart = await this.getCart(sessionId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    // Confirm all reservations
    const reservationIds = this.cartReservations.get(cart.id) ?? []
    for (const reservationId of reservationIds) {
      try {
        await this.inventoryManager.confirmReservation(reservationId, orderId)
      } catch {
        // Reservation may have already been confirmed or expired
      }
    }

    // Clear reservation tracking
    this.cartReservations.delete(cart.id)

    // Mark cart as converted
    const snapshot = await this.cartManager.markAsConverted(cart.id, orderId)

    // Clear session cart reference
    const session = await this.getSession(sessionId)
    if (session) {
      session.cartId = undefined
    }

    return snapshot
  }

  // =============================================================================
  // Cleanup
  // =============================================================================

  /**
   * Cleanup expired sessions and carts
   */
  async cleanup(): Promise<{ expiredSessions: number; expiredCarts: number; expiredReservations: number }> {
    let expiredSessions = 0
    let expiredCarts = 0

    // Cleanup expired sessions
    const now = new Date()
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt && now >= session.expiresAt) {
        await this.expireSession(sessionId)
        expiredSessions++
      }
    }

    // Cleanup expired carts
    expiredCarts = await this.cartManager.cleanupExpiredCarts()

    // Cleanup expired reservations
    const expiredReservations = await this.inventoryManager.cleanupExpiredReservations()

    return { expiredSessions, expiredCarts, expiredReservations }
  }

  /**
   * Start automatic cleanup timer
   */
  private startAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }

    this.cleanupTimer = setInterval(async () => {
      await this.cleanup()
    }, this.options.cleanupIntervalMs)
  }

  /**
   * Stop automatic cleanup timer
   */
  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }

  // =============================================================================
  // Inventory Helpers
  // =============================================================================

  private async releaseCartReservations(cartId: string): Promise<void> {
    const reservationIds = this.cartReservations.get(cartId) ?? []
    for (const reservationId of reservationIds) {
      try {
        await this.inventoryManager.releaseReservation(reservationId)
      } catch {
        // Reservation may have already been released
      }
    }
    this.cartReservations.delete(cartId)
  }

  private async releaseItemReservations(cartId: string, variantId: string): Promise<void> {
    const reservationIds = this.cartReservations.get(cartId) ?? []
    const reservations = await this.inventoryManager.getReservationsByReference(cartId, 'cart')

    for (const reservation of reservations) {
      if (reservation.variantId === variantId && reservation.status === 'active') {
        await this.inventoryManager.releaseReservation(reservation.id)
        const idx = reservationIds.indexOf(reservation.id)
        if (idx !== -1) {
          reservationIds.splice(idx, 1)
        }
      }
    }

    this.cartReservations.set(cartId, reservationIds)
  }

  private async releasePartialReservation(
    cartId: string,
    variantId: string,
    quantityToRelease: number
  ): Promise<void> {
    // Find reservations for this item and release partial quantity
    // In a real implementation, this would adjust the reservation quantity
    // For simplicity, we release entire reservations until we've released enough

    const reservations = await this.inventoryManager.getReservationsByReference(cartId, 'cart')
    let released = 0

    for (const reservation of reservations) {
      if (
        reservation.variantId === variantId &&
        reservation.status === 'active' &&
        released < quantityToRelease
      ) {
        if (reservation.quantity <= quantityToRelease - released) {
          // Release entire reservation
          await this.inventoryManager.releaseReservation(reservation.id)
          released += reservation.quantity

          const reservationIds = this.cartReservations.get(cartId) ?? []
          const idx = reservationIds.indexOf(reservation.id)
          if (idx !== -1) {
            reservationIds.splice(idx, 1)
          }
          this.cartReservations.set(cartId, reservationIds)
        }
        // In a full implementation, we'd support partial reservation release
      }
    }
  }

  // =============================================================================
  // Accessors for underlying managers (for advanced use cases)
  // =============================================================================

  getCartManager(): CartManager {
    return this.cartManager
  }

  getInventoryManager(): InventoryManager {
    return this.inventoryManager
  }

  /**
   * Set stock level (for testing or initialization)
   */
  async setStock(variantId: string, quantity: number): Promise<void> {
    await this.inventoryManager.setStock(variantId, quantity)
  }

  /**
   * Get current stock level
   */
  async getStock(variantId: string): Promise<number> {
    return this.inventoryManager.getStock(variantId)
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCartEngine(options?: CartEngineOptions): CartEngine {
  return new CartEngine(options)
}
