/**
 * @dotdo/woocommerce - Shipping Resource
 *
 * WooCommerce REST API compatible shipping operations including:
 * - Shipping zones CRUD
 * - Shipping zone locations
 * - Shipping zone methods
 * - Shipping methods list
 *
 * @module @dotdo/woocommerce/shipping
 */

import type { RestClient } from './client'
import type { RestResponse } from './types'

// =============================================================================
// Shipping Types
// =============================================================================

/**
 * Shipping zone
 */
export interface ShippingZone {
  id: number
  name: string
  order: number
}

/**
 * Shipping zone location type
 */
export type ShippingZoneLocationType = 'postcode' | 'state' | 'country' | 'continent'

/**
 * Shipping zone location
 */
export interface ShippingZoneLocation {
  code: string
  type: ShippingZoneLocationType
}

/**
 * Shipping zone method
 */
export interface ShippingZoneMethod {
  instance_id: number
  title: string
  order: number
  enabled: boolean
  method_id: string
  method_title: string
  method_description: string
  settings: Record<string, ShippingMethodSetting>
}

/**
 * Shipping method setting
 */
export interface ShippingMethodSetting {
  id: string
  label: string
  description: string
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'price' | 'decimal'
  value: string
  default: string
  tip: string
  placeholder: string
  options?: Record<string, string>
}

/**
 * Shipping method (global)
 */
export interface ShippingMethod {
  id: string
  title: string
  description: string
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Shipping zone input
 */
export interface ShippingZoneInput {
  name?: string
  order?: number
}

/**
 * Shipping zone location input
 */
export interface ShippingZoneLocationInput {
  code: string
  type: ShippingZoneLocationType
}

/**
 * Shipping zone method input
 */
export interface ShippingZoneMethodInput {
  method_id?: string
  title?: string
  order?: number
  enabled?: boolean
  settings?: Record<string, string>
}

// =============================================================================
// Shipping Zones Resource
// =============================================================================

/**
 * Shipping zones resource for WooCommerce REST API
 */
export class ShippingZonesResource {
  private client: RestClient

  /** Shipping zone locations sub-resource */
  locations: ShippingZoneLocationsResource

  /** Shipping zone methods sub-resource */
  methods: ShippingZoneMethodsResource

  constructor(client: RestClient) {
    this.client = client
    this.locations = new ShippingZoneLocationsResource(client)
    this.methods = new ShippingZoneMethodsResource(client)
  }

  /**
   * List all shipping zones
   */
  async list(): Promise<RestResponse<ShippingZone[]>> {
    return this.client.get({
      path: 'shipping/zones',
    })
  }

  /**
   * Get a single shipping zone
   */
  async get(zoneId: number): Promise<RestResponse<ShippingZone>> {
    return this.client.get({
      path: `shipping/zones/${zoneId}`,
    })
  }

  /**
   * Create a shipping zone
   */
  async create(input: ShippingZoneInput): Promise<RestResponse<ShippingZone>> {
    return this.client.post({
      path: 'shipping/zones',
      data: input,
    })
  }

  /**
   * Update a shipping zone
   */
  async update(zoneId: number, input: ShippingZoneInput): Promise<RestResponse<ShippingZone>> {
    return this.client.put({
      path: `shipping/zones/${zoneId}`,
      data: input,
    })
  }

  /**
   * Delete a shipping zone
   */
  async delete(
    zoneId: number,
    options?: { force?: boolean }
  ): Promise<RestResponse<ShippingZone>> {
    return this.client.delete({
      path: `shipping/zones/${zoneId}`,
      query: options,
    })
  }
}

// =============================================================================
// Shipping Zone Locations Resource
// =============================================================================

/**
 * Shipping zone locations resource for WooCommerce REST API
 */
export class ShippingZoneLocationsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all locations for a shipping zone
   */
  async list(zoneId: number): Promise<RestResponse<ShippingZoneLocation[]>> {
    return this.client.get({
      path: `shipping/zones/${zoneId}/locations`,
    })
  }

  /**
   * Update all locations for a shipping zone (replaces existing)
   */
  async update(
    zoneId: number,
    locations: ShippingZoneLocationInput[]
  ): Promise<RestResponse<ShippingZoneLocation[]>> {
    return this.client.put({
      path: `shipping/zones/${zoneId}/locations`,
      data: locations,
    })
  }
}

// =============================================================================
// Shipping Zone Methods Resource
// =============================================================================

/**
 * Shipping zone methods resource for WooCommerce REST API
 */
export class ShippingZoneMethodsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all methods for a shipping zone
   */
  async list(zoneId: number): Promise<RestResponse<ShippingZoneMethod[]>> {
    return this.client.get({
      path: `shipping/zones/${zoneId}/methods`,
    })
  }

  /**
   * Get a single method from a shipping zone
   */
  async get(zoneId: number, instanceId: number): Promise<RestResponse<ShippingZoneMethod>> {
    return this.client.get({
      path: `shipping/zones/${zoneId}/methods/${instanceId}`,
    })
  }

  /**
   * Add a method to a shipping zone
   */
  async create(
    zoneId: number,
    input: ShippingZoneMethodInput
  ): Promise<RestResponse<ShippingZoneMethod>> {
    return this.client.post({
      path: `shipping/zones/${zoneId}/methods`,
      data: input,
    })
  }

  /**
   * Update a method in a shipping zone
   */
  async update(
    zoneId: number,
    instanceId: number,
    input: ShippingZoneMethodInput
  ): Promise<RestResponse<ShippingZoneMethod>> {
    return this.client.put({
      path: `shipping/zones/${zoneId}/methods/${instanceId}`,
      data: input,
    })
  }

  /**
   * Delete a method from a shipping zone
   */
  async delete(
    zoneId: number,
    instanceId: number,
    options?: { force?: boolean }
  ): Promise<RestResponse<ShippingZoneMethod>> {
    return this.client.delete({
      path: `shipping/zones/${zoneId}/methods/${instanceId}`,
      query: options,
    })
  }
}

// =============================================================================
// Shipping Methods Resource
// =============================================================================

/**
 * Shipping methods resource for WooCommerce REST API
 */
export class ShippingMethodsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all shipping methods
   */
  async list(): Promise<RestResponse<ShippingMethod[]>> {
    return this.client.get({
      path: 'shipping_methods',
    })
  }

  /**
   * Get a single shipping method
   */
  async get(methodId: string): Promise<RestResponse<ShippingMethod>> {
    return this.client.get({
      path: `shipping_methods/${methodId}`,
    })
  }
}
