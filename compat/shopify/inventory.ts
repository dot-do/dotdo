/**
 * @dotdo/shopify - Inventory Resource
 *
 * Shopify Admin API compatible inventory operations including:
 * - Inventory Levels
 * - Inventory Items
 * - Locations
 *
 * @module @dotdo/shopify/inventory
 */

import type { RestClient } from './client'
import type {
  InventoryLevel,
  InventoryItem,
  Location,
  RestResponse,
} from './types'

// =============================================================================
// Inventory Level Input Types
// =============================================================================

/**
 * Input for adjusting inventory level
 */
export interface InventoryAdjustInput {
  inventory_item_id: number
  location_id: number
  available_adjustment: number
}

/**
 * Input for setting inventory level
 */
export interface InventorySetInput {
  inventory_item_id: number
  location_id: number
  available: number
}

/**
 * Input for connecting inventory to location
 */
export interface InventoryConnectInput {
  inventory_item_id: number
  location_id: number
  relocate_if_necessary?: boolean
}

// =============================================================================
// Inventory Item Input Types
// =============================================================================

/**
 * Input for updating an inventory item
 */
export interface InventoryItemUpdateInput {
  sku?: string
  cost?: string
  tracked?: boolean
  requires_shipping?: boolean
  country_code_of_origin?: string
  province_code_of_origin?: string
  harmonized_system_code?: string
  country_harmonized_system_codes?: { harmonized_system_code: string; country_code: string }[]
}

// =============================================================================
// Inventory Resource
// =============================================================================

/**
 * Inventory resource for Shopify Admin API
 */
export class InventoryResource {
  private client: RestClient

  /** Inventory levels sub-resource */
  levels: InventoryLevelsResource
  /** Inventory items sub-resource */
  items: InventoryItemsResource
  /** Locations sub-resource */
  locations: LocationsResource

  constructor(client: RestClient) {
    this.client = client
    this.levels = new InventoryLevelsResource(client)
    this.items = new InventoryItemsResource(client)
    this.locations = new LocationsResource(client)
  }
}

// =============================================================================
// Inventory Levels Resource
// =============================================================================

/**
 * Inventory Levels resource for Shopify Admin API
 */
export class InventoryLevelsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List inventory levels
   *
   * Requires at least one of: inventory_item_ids, location_ids
   */
  async list(params: {
    inventory_item_ids?: string
    location_ids?: string
    limit?: number
    updated_at_min?: string
  }): Promise<RestResponse<{ inventory_levels: InventoryLevel[] }>> {
    return this.client.get({
      path: 'inventory_levels',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Adjust an inventory level
   *
   * Adjusts the available inventory quantity by a relative amount.
   */
  async adjust(input: InventoryAdjustInput): Promise<RestResponse<{ inventory_level: InventoryLevel }>> {
    return this.client.post({
      path: 'inventory_levels/adjust',
      data: input,
    })
  }

  /**
   * Set an inventory level
   *
   * Sets the available inventory quantity to an absolute value.
   */
  async set(input: InventorySetInput): Promise<RestResponse<{ inventory_level: InventoryLevel }>> {
    return this.client.post({
      path: 'inventory_levels/set',
      data: input,
    })
  }

  /**
   * Connect an inventory item to a location
   *
   * Enables inventory tracking for the item at the specified location.
   */
  async connect(input: InventoryConnectInput): Promise<RestResponse<{ inventory_level: InventoryLevel }>> {
    return this.client.post({
      path: 'inventory_levels/connect',
      data: input,
    })
  }

  /**
   * Delete an inventory level
   *
   * Disconnects inventory tracking for the item at the specified location.
   */
  async delete(params: {
    inventory_item_id: number
    location_id: number
  }): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: 'inventory_levels',
      query: params,
    })
  }
}

// =============================================================================
// Inventory Items Resource
// =============================================================================

/**
 * Inventory Items resource for Shopify Admin API
 */
export class InventoryItemsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List inventory items
   */
  async list(params: {
    ids: string
    limit?: number
  }): Promise<RestResponse<{ inventory_items: InventoryItem[] }>> {
    return this.client.get({
      path: 'inventory_items',
      query: params,
    })
  }

  /**
   * Get an inventory item
   */
  async get(inventoryItemId: number): Promise<RestResponse<{ inventory_item: InventoryItem }>> {
    return this.client.get({
      path: `inventory_items/${inventoryItemId}`,
    })
  }

  /**
   * Update an inventory item
   */
  async update(inventoryItemId: number, input: InventoryItemUpdateInput): Promise<RestResponse<{ inventory_item: InventoryItem }>> {
    return this.client.put({
      path: `inventory_items/${inventoryItemId}`,
      data: { inventory_item: input },
    })
  }
}

// =============================================================================
// Locations Resource
// =============================================================================

/**
 * Locations resource for Shopify Admin API
 */
export class LocationsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all locations
   */
  async list(params?: {
    limit?: number
    active?: boolean
  }): Promise<RestResponse<{ locations: Location[] }>> {
    return this.client.get({
      path: 'locations',
      query: params,
    })
  }

  /**
   * Get a location
   */
  async get(locationId: number): Promise<RestResponse<{ location: Location }>> {
    return this.client.get({
      path: `locations/${locationId}`,
    })
  }

  /**
   * Count locations
   */
  async count(): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: 'locations/count',
    })
  }

  /**
   * Get inventory levels for a location
   */
  async inventoryLevels(locationId: number, params?: {
    limit?: number
  }): Promise<RestResponse<{ inventory_levels: InventoryLevel[] }>> {
    return this.client.get({
      path: `locations/${locationId}/inventory_levels`,
      query: params,
    })
  }
}
