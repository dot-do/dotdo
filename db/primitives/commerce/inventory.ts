/**
 * Inventory Management - Stock tracking primitive
 *
 * Provides inventory management functionality:
 * - Stock level tracking
 * - Inventory reservations with TTL
 * - Low stock alerts
 * - Stock movements and audit trail
 * - Multi-location inventory
 *
 * @module db/primitives/commerce/inventory
 */

// =============================================================================
// Types
// =============================================================================

export type ReservationStatus = 'active' | 'confirmed' | 'released' | 'expired'

export type MovementType =
  | 'adjustment'
  | 'sale'
  | 'return'
  | 'transfer'
  | 'reservation'
  | 'initial'

export type LocationType = 'warehouse' | 'store' | 'dropship' | 'virtual'

export interface InventoryLevel {
  variantId: string
  available: number
  reserved: number
  onHand: number
  lowStockThreshold?: number
  locationId?: string
}

export interface Reservation {
  id: string
  variantId: string
  quantity: number
  referenceId: string
  referenceType: string
  locationId?: string
  status: ReservationStatus
  expiresAt?: Date
  createdAt: Date
  confirmedAt?: Date
  releasedAt?: Date
}

export interface StockMovement {
  id: string
  variantId: string
  quantity: number
  type: MovementType
  reason?: string
  referenceId?: string
  locationId?: string
  fromLocationId?: string
  toLocationId?: string
  timestamp: Date
}

export interface LowStockAlert {
  variantId: string
  currentStock: number
  threshold: number
  timestamp: Date
}

export interface InventoryLocation {
  id: string
  name: string
  type: LocationType
  coordinates?: { lat: number; lng: number }
  address?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface CreateReservationInput {
  variantId: string
  quantity: number
  referenceId: string
  referenceType: string
  locationId?: string
  ttl?: number
}

export interface BulkReservationInput {
  items: { variantId: string; quantity: number; locationId?: string }[]
  referenceId: string
  referenceType: string
  ttl?: number
}

export interface RecordMovementInput {
  type: MovementType
  quantity: number
  reason?: string
  referenceId?: string
  locationId?: string
  fromLocationId?: string
  toLocationId?: string
}

export interface CreateLocationInput {
  id?: string
  name: string
  type: LocationType
  coordinates?: { lat: number; lng: number }
  address?: string
  metadata?: Record<string, unknown>
}

export interface UpdateLocationInput {
  name?: string
  type?: LocationType
  coordinates?: { lat: number; lng: number }
  address?: string
  metadata?: Record<string, unknown>
}

export interface CheckAvailabilityResult {
  available: boolean
  items: {
    variantId: string
    requested: number
    availableQuantity: number
    available: boolean
  }[]
}

export interface GetMovementsOptions {
  from?: Date
  to?: Date
  type?: MovementType
}

export interface InventoryOptions {
  defaultReservationTTL?: number
  allowOverselling?: boolean
  multiLocation?: boolean
  onLowStock?: (alert: LowStockAlert) => void
}

// =============================================================================
// InventoryManager Interface
// =============================================================================

export interface InventoryManager {
  // Stock levels
  setStock(variantId: string, quantity: number): Promise<void>
  getStock(variantId: string): Promise<number>
  getInventoryLevel(variantId: string): Promise<InventoryLevel>
  adjustStock(variantId: string, delta: number, reason?: string): Promise<void>
  bulkSetStock(items: { variantId: string; quantity: number }[]): Promise<void>
  isAvailable(variantId: string, quantity: number): Promise<boolean>
  checkAvailability(
    items: { variantId: string; quantity: number }[]
  ): Promise<CheckAvailabilityResult>

  // Reservations
  createReservation(input: CreateReservationInput): Promise<Reservation>
  createBulkReservation(input: BulkReservationInput): Promise<Reservation[]>
  getReservation(id: string): Promise<Reservation | null>
  confirmReservation(id: string, orderId: string): Promise<void>
  releaseReservation(id: string): Promise<void>
  extendReservation(id: string, additionalMs: number): Promise<Reservation>
  cleanupExpiredReservations(): Promise<number>
  getReservationsByReference(
    referenceId: string,
    referenceType: string
  ): Promise<Reservation[]>

  // Stock movements
  recordMovement(variantId: string, input: RecordMovementInput): Promise<StockMovement>
  getStockMovements(variantId: string, options?: GetMovementsOptions): Promise<StockMovement[]>
  getStockAsOf(variantId: string, timestamp: Date): Promise<number>

  // Low stock alerts
  setLowStockThreshold(variantId: string, threshold: number): Promise<void>
  getLowStockItems(): Promise<InventoryLevel[]>
  getOutOfStockItems(): Promise<InventoryLevel[]>

  // Multi-location
  createLocation(input: CreateLocationInput): Promise<InventoryLocation>
  updateLocation(id: string, input: UpdateLocationInput): Promise<InventoryLocation>
  getLocation(id: string): Promise<InventoryLocation | null>
  setStockAtLocation(variantId: string, locationId: string, quantity: number): Promise<void>
  getStockAtLocation(variantId: string, locationId: string): Promise<number>
  getInventoryLevelAtLocation(variantId: string, locationId: string): Promise<InventoryLevel>
  getInventoryByLocation(locationId: string): Promise<InventoryLevel[]>
  transferStock(
    variantId: string,
    fromLocationId: string,
    toLocationId: string,
    quantity: number,
    reason?: string
  ): Promise<void>
  findNearestLocationWithStock(
    variantId: string,
    quantity: number,
    coordinates: { lat: number; lng: number }
  ): Promise<{ locationId: string; distance: number } | null>
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}${random}`
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371 // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// =============================================================================
// Implementation
// =============================================================================

interface StockData {
  onHand: number
  reserved: number
  lowStockThreshold?: number
  alertTriggered?: boolean
}

class InMemoryInventoryManager implements InventoryManager {
  private stock: Map<string, StockData> = new Map()
  private locationStock: Map<string, Map<string, StockData>> = new Map() // locationId -> variantId -> stock
  private reservations: Map<string, Reservation> = new Map()
  private movements: Map<string, StockMovement[]> = new Map() // variantId -> movements
  private locations: Map<string, InventoryLocation> = new Map()
  private options: InventoryOptions

  constructor(options?: InventoryOptions) {
    this.options = options ?? {}
  }

  private getStockData(variantId: string): StockData {
    return this.stock.get(variantId) ?? { onHand: 0, reserved: 0 }
  }

  private setStockData(variantId: string, data: StockData): void {
    this.stock.set(variantId, data)
  }

  private getLocationStockData(variantId: string, locationId: string): StockData {
    const locationMap = this.locationStock.get(locationId)
    if (!locationMap) return { onHand: 0, reserved: 0 }
    return locationMap.get(variantId) ?? { onHand: 0, reserved: 0 }
  }

  private setLocationStockData(
    variantId: string,
    locationId: string,
    data: StockData
  ): void {
    if (!this.locationStock.has(locationId)) {
      this.locationStock.set(locationId, new Map())
    }
    this.locationStock.get(locationId)!.set(variantId, data)
  }

  private checkLowStock(variantId: string, stockData: StockData): void {
    if (!this.options.onLowStock) return
    if (!stockData.lowStockThreshold) return

    const available = stockData.onHand - stockData.reserved
    if (available < stockData.lowStockThreshold && !stockData.alertTriggered) {
      stockData.alertTriggered = true
      this.options.onLowStock({
        variantId,
        currentStock: available,
        threshold: stockData.lowStockThreshold,
        timestamp: new Date(),
      })
    } else if (available >= stockData.lowStockThreshold && stockData.alertTriggered) {
      stockData.alertTriggered = false
    }
  }

  private addMovement(variantId: string, movement: StockMovement): void {
    if (!this.movements.has(variantId)) {
      this.movements.set(variantId, [])
    }
    this.movements.get(variantId)!.push(movement)
  }

  // Stock levels

  async setStock(variantId: string, quantity: number): Promise<void> {
    const current = this.getStockData(variantId)
    const newData: StockData = {
      ...current,
      onHand: quantity,
    }
    this.setStockData(variantId, newData)

    this.addMovement(variantId, {
      id: generateId('mov'),
      variantId,
      quantity,
      type: 'initial',
      reason: 'Initial stock set',
      timestamp: new Date(),
    })
  }

  async getStock(variantId: string): Promise<number> {
    if (this.options.multiLocation) {
      // Aggregate across all locations
      let total = 0
      for (const locationMap of this.locationStock.values()) {
        const data = locationMap.get(variantId)
        if (data) {
          total += data.onHand - data.reserved
        }
      }
      return total
    }

    const data = this.getStockData(variantId)
    return data.onHand - data.reserved
  }

  async getInventoryLevel(variantId: string): Promise<InventoryLevel> {
    const data = this.getStockData(variantId)
    return {
      variantId,
      available: data.onHand - data.reserved,
      reserved: data.reserved,
      onHand: data.onHand,
      lowStockThreshold: data.lowStockThreshold,
    }
  }

  async adjustStock(variantId: string, delta: number, reason?: string): Promise<void> {
    const current = this.getStockData(variantId)
    const newOnHand = current.onHand + delta

    if (newOnHand < 0 && !this.options.allowOverselling) {
      throw new Error('Insufficient stock')
    }

    const newData: StockData = {
      ...current,
      onHand: newOnHand,
    }
    this.setStockData(variantId, newData)
    this.checkLowStock(variantId, newData)

    this.addMovement(variantId, {
      id: generateId('mov'),
      variantId,
      quantity: delta,
      type: 'adjustment',
      reason,
      timestamp: new Date(),
    })
  }

  async bulkSetStock(items: { variantId: string; quantity: number }[]): Promise<void> {
    for (const item of items) {
      await this.setStock(item.variantId, item.quantity)
    }
  }

  async isAvailable(variantId: string, quantity: number): Promise<boolean> {
    const available = await this.getStock(variantId)
    return available >= quantity
  }

  async checkAvailability(
    items: { variantId: string; quantity: number }[]
  ): Promise<CheckAvailabilityResult> {
    const results = await Promise.all(
      items.map(async (item) => {
        const available = await this.getStock(item.variantId)
        return {
          variantId: item.variantId,
          requested: item.quantity,
          availableQuantity: available,
          available: available >= item.quantity,
        }
      })
    )

    return {
      available: results.every((r) => r.available),
      items: results,
    }
  }

  // Reservations

  async createReservation(input: CreateReservationInput): Promise<Reservation> {
    const data = input.locationId
      ? this.getLocationStockData(input.variantId, input.locationId)
      : this.getStockData(input.variantId)

    const available = data.onHand - data.reserved

    if (available < input.quantity && !this.options.allowOverselling) {
      throw new Error('Insufficient available stock')
    }

    const ttl = input.ttl ?? this.options.defaultReservationTTL ?? 15 * 60 * 1000
    const now = new Date()

    const reservation: Reservation = {
      id: generateId('res'),
      variantId: input.variantId,
      quantity: input.quantity,
      referenceId: input.referenceId,
      referenceType: input.referenceType,
      locationId: input.locationId,
      status: 'active',
      expiresAt: new Date(now.getTime() + ttl),
      createdAt: now,
    }

    // Update reserved count
    const newData: StockData = {
      ...data,
      reserved: data.reserved + input.quantity,
    }

    if (input.locationId) {
      this.setLocationStockData(input.variantId, input.locationId, newData)
    } else {
      this.setStockData(input.variantId, newData)
    }

    this.reservations.set(reservation.id, reservation)
    return reservation
  }

  async createBulkReservation(input: BulkReservationInput): Promise<Reservation[]> {
    const reservations: Reservation[] = []

    try {
      for (const item of input.items) {
        const reservation = await this.createReservation({
          variantId: item.variantId,
          quantity: item.quantity,
          referenceId: input.referenceId,
          referenceType: input.referenceType,
          locationId: item.locationId,
          ttl: input.ttl,
        })
        reservations.push(reservation)
      }
      return reservations
    } catch (error) {
      // Rollback created reservations
      for (const reservation of reservations) {
        await this.releaseReservation(reservation.id)
      }
      throw error
    }
  }

  async getReservation(id: string): Promise<Reservation | null> {
    return this.reservations.get(id) ?? null
  }

  async confirmReservation(id: string, orderId: string): Promise<void> {
    const reservation = this.reservations.get(id)
    if (!reservation) {
      throw new Error('Reservation not found')
    }

    if (reservation.status !== 'active') {
      throw new Error('Reservation is not active')
    }

    const data = reservation.locationId
      ? this.getLocationStockData(reservation.variantId, reservation.locationId)
      : this.getStockData(reservation.variantId)

    // Deduct from on-hand and clear reservation
    const newData: StockData = {
      ...data,
      onHand: data.onHand - reservation.quantity,
      reserved: data.reserved - reservation.quantity,
    }

    if (reservation.locationId) {
      this.setLocationStockData(reservation.variantId, reservation.locationId, newData)
    } else {
      this.setStockData(reservation.variantId, newData)
    }

    reservation.status = 'confirmed'
    reservation.confirmedAt = new Date()
    this.reservations.set(id, reservation)

    // Record movement
    this.addMovement(reservation.variantId, {
      id: generateId('mov'),
      variantId: reservation.variantId,
      quantity: -reservation.quantity,
      type: 'sale',
      referenceId: orderId,
      locationId: reservation.locationId,
      timestamp: new Date(),
    })

    this.checkLowStock(reservation.variantId, newData)
  }

  async releaseReservation(id: string): Promise<void> {
    const reservation = this.reservations.get(id)
    if (!reservation) {
      throw new Error('Reservation not found')
    }

    if (reservation.status !== 'active') {
      return // Already released or confirmed
    }

    const data = reservation.locationId
      ? this.getLocationStockData(reservation.variantId, reservation.locationId)
      : this.getStockData(reservation.variantId)

    // Release reserved quantity
    const newData: StockData = {
      ...data,
      reserved: data.reserved - reservation.quantity,
    }

    if (reservation.locationId) {
      this.setLocationStockData(reservation.variantId, reservation.locationId, newData)
    } else {
      this.setStockData(reservation.variantId, newData)
    }

    reservation.status = 'released'
    reservation.releasedAt = new Date()
    this.reservations.set(id, reservation)
  }

  async extendReservation(id: string, additionalMs: number): Promise<Reservation> {
    const reservation = this.reservations.get(id)
    if (!reservation) {
      throw new Error('Reservation not found')
    }

    const currentExpiry = reservation.expiresAt?.getTime() ?? Date.now()
    reservation.expiresAt = new Date(currentExpiry + additionalMs)
    this.reservations.set(id, reservation)

    return reservation
  }

  async cleanupExpiredReservations(): Promise<number> {
    let count = 0
    const now = new Date()

    for (const [id, reservation] of this.reservations) {
      if (reservation.status === 'active' && reservation.expiresAt && now >= reservation.expiresAt) {
        await this.releaseReservation(id)
        reservation.status = 'expired'
        this.reservations.set(id, reservation)
        count++
      }
    }

    return count
  }

  async getReservationsByReference(
    referenceId: string,
    referenceType: string
  ): Promise<Reservation[]> {
    const results: Reservation[] = []
    for (const reservation of this.reservations.values()) {
      if (
        reservation.referenceId === referenceId &&
        reservation.referenceType === referenceType
      ) {
        results.push(reservation)
      }
    }
    return results
  }

  // Stock movements

  async recordMovement(
    variantId: string,
    input: RecordMovementInput
  ): Promise<StockMovement> {
    const movement: StockMovement = {
      id: generateId('mov'),
      variantId,
      quantity: input.quantity,
      type: input.type,
      reason: input.reason,
      referenceId: input.referenceId,
      locationId: input.locationId,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      timestamp: new Date(),
    }

    // Apply stock change
    if (input.type !== 'transfer') {
      const data = input.locationId
        ? this.getLocationStockData(variantId, input.locationId)
        : this.getStockData(variantId)

      const newData: StockData = {
        ...data,
        onHand: data.onHand + input.quantity,
      }

      if (input.locationId) {
        this.setLocationStockData(variantId, input.locationId, newData)
      } else {
        this.setStockData(variantId, newData)
      }
    }

    this.addMovement(variantId, movement)
    return movement
  }

  async getStockMovements(
    variantId: string,
    options?: GetMovementsOptions
  ): Promise<StockMovement[]> {
    let movements = this.movements.get(variantId) ?? []

    if (options?.from) {
      movements = movements.filter((m) => m.timestamp >= options.from!)
    }
    if (options?.to) {
      movements = movements.filter((m) => m.timestamp <= options.to!)
    }
    if (options?.type) {
      movements = movements.filter((m) => m.type === options.type)
    }

    return movements.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  async getStockAsOf(variantId: string, timestamp: Date): Promise<number> {
    const movements = await this.getStockMovements(variantId, { to: timestamp })

    let stock = 0
    for (const movement of movements) {
      if (movement.type === 'initial') {
        stock = movement.quantity
      } else {
        stock += movement.quantity
      }
    }

    return stock
  }

  // Low stock alerts

  async setLowStockThreshold(variantId: string, threshold: number): Promise<void> {
    const data = this.getStockData(variantId)
    const newData: StockData = {
      ...data,
      lowStockThreshold: threshold,
    }
    this.setStockData(variantId, newData)
    this.checkLowStock(variantId, newData)
  }

  async getLowStockItems(): Promise<InventoryLevel[]> {
    const lowStock: InventoryLevel[] = []

    for (const [variantId, data] of this.stock) {
      if (data.lowStockThreshold) {
        const available = data.onHand - data.reserved
        if (available < data.lowStockThreshold) {
          lowStock.push({
            variantId,
            available,
            reserved: data.reserved,
            onHand: data.onHand,
            lowStockThreshold: data.lowStockThreshold,
          })
        }
      }
    }

    return lowStock
  }

  async getOutOfStockItems(): Promise<InventoryLevel[]> {
    const outOfStock: InventoryLevel[] = []

    for (const [variantId, data] of this.stock) {
      const available = data.onHand - data.reserved
      if (available <= 0) {
        outOfStock.push({
          variantId,
          available,
          reserved: data.reserved,
          onHand: data.onHand,
          lowStockThreshold: data.lowStockThreshold,
        })
      }
    }

    return outOfStock
  }

  // Multi-location

  async createLocation(input: CreateLocationInput): Promise<InventoryLocation> {
    const location: InventoryLocation = {
      id: input.id ?? generateId('loc'),
      name: input.name,
      type: input.type,
      coordinates: input.coordinates,
      address: input.address,
      metadata: input.metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.locations.set(location.id, location)
    return location
  }

  async updateLocation(
    id: string,
    input: UpdateLocationInput
  ): Promise<InventoryLocation> {
    const location = this.locations.get(id)
    if (!location) {
      throw new Error('Location not found')
    }

    const updated: InventoryLocation = {
      ...location,
      ...input,
      updatedAt: new Date(),
    }

    this.locations.set(id, updated)
    return updated
  }

  async getLocation(id: string): Promise<InventoryLocation | null> {
    return this.locations.get(id) ?? null
  }

  async setStockAtLocation(
    variantId: string,
    locationId: string,
    quantity: number
  ): Promise<void> {
    const current = this.getLocationStockData(variantId, locationId)
    const newData: StockData = {
      ...current,
      onHand: quantity,
    }
    this.setLocationStockData(variantId, locationId, newData)
  }

  async getStockAtLocation(variantId: string, locationId: string): Promise<number> {
    const data = this.getLocationStockData(variantId, locationId)
    return data.onHand - data.reserved
  }

  async getInventoryLevelAtLocation(
    variantId: string,
    locationId: string
  ): Promise<InventoryLevel> {
    const data = this.getLocationStockData(variantId, locationId)
    return {
      variantId,
      available: data.onHand - data.reserved,
      reserved: data.reserved,
      onHand: data.onHand,
      lowStockThreshold: data.lowStockThreshold,
      locationId,
    }
  }

  async getInventoryByLocation(locationId: string): Promise<InventoryLevel[]> {
    const locationMap = this.locationStock.get(locationId)
    if (!locationMap) return []

    const levels: InventoryLevel[] = []
    for (const [variantId, data] of locationMap) {
      levels.push({
        variantId,
        available: data.onHand - data.reserved,
        reserved: data.reserved,
        onHand: data.onHand,
        lowStockThreshold: data.lowStockThreshold,
        locationId,
      })
    }

    return levels
  }

  async transferStock(
    variantId: string,
    fromLocationId: string,
    toLocationId: string,
    quantity: number,
    reason?: string
  ): Promise<void> {
    const fromData = this.getLocationStockData(variantId, fromLocationId)
    const toData = this.getLocationStockData(variantId, toLocationId)

    const available = fromData.onHand - fromData.reserved
    if (available < quantity && !this.options.allowOverselling) {
      throw new Error('Insufficient stock at source location')
    }

    // Deduct from source
    this.setLocationStockData(variantId, fromLocationId, {
      ...fromData,
      onHand: fromData.onHand - quantity,
    })

    // Add to destination
    this.setLocationStockData(variantId, toLocationId, {
      ...toData,
      onHand: toData.onHand + quantity,
    })

    // Record movement
    this.addMovement(variantId, {
      id: generateId('mov'),
      variantId,
      quantity,
      type: 'transfer',
      reason,
      fromLocationId,
      toLocationId,
      timestamp: new Date(),
    })
  }

  async findNearestLocationWithStock(
    variantId: string,
    quantity: number,
    coordinates: { lat: number; lng: number }
  ): Promise<{ locationId: string; distance: number } | null> {
    let nearest: { locationId: string; distance: number } | null = null

    for (const [locationId, location] of this.locations) {
      if (!location.coordinates) continue

      const available = await this.getStockAtLocation(variantId, locationId)
      if (available < quantity) continue

      const distance = haversineDistance(
        coordinates.lat,
        coordinates.lng,
        location.coordinates.lat,
        location.coordinates.lng
      )

      if (!nearest || distance < nearest.distance) {
        nearest = { locationId, distance }
      }
    }

    return nearest
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createInventoryManager(options?: InventoryOptions): InventoryManager {
  return new InMemoryInventoryManager(options)
}
