/**
 * Aggregation Pipeline Tests
 *
 * These tests verify that our Collection.aggregate() implementation matches the
 * MongoDB driver's aggregation pipeline interface.
 *
 * RED PHASE: All tests should fail - aggregate() method doesn't exist yet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Document } from 'mongodb';
import { MongoClient, Collection, clearAllStorage } from '../src/index.js';
import { TEST_ENDPOINT } from './setup.js';

/**
 * Test document types for e-commerce scenarios
 */
interface Order {
  _id?: string;
  customerId: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  total: number;
  items: OrderItem[];
  category: string;
  region: string;
  createdAt: Date;
}

interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

interface Product {
  _id?: string;
  sku: string;
  name: string;
  price: number;
  category: string;
  tags: string[];
  inStock: boolean;
  rating: number;
}

interface Customer {
  _id?: string;
  name: string;
  email: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  totalSpent: number;
}

interface PageView {
  _id?: string;
  userId: string;
  page: string;
  duration: number;
  timestamp: Date;
}

describe('Collection.aggregate()', () => {
  let client: MongoClient;
  let orders: Collection<Order>;
  let products: Collection<Product>;
  let customers: Collection<Customer>;
  let pageViews: Collection<PageView>;

  // Sample test data
  const sampleOrders: Order[] = [
    {
      customerId: 'c1',
      status: 'delivered',
      total: 150.0,
      items: [
        { productId: 'p1', name: 'Widget', quantity: 2, price: 50.0 },
        { productId: 'p2', name: 'Gadget', quantity: 1, price: 50.0 },
      ],
      category: 'electronics',
      region: 'west',
      createdAt: new Date('2024-01-15'),
    },
    {
      customerId: 'c1',
      status: 'delivered',
      total: 200.0,
      items: [{ productId: 'p3', name: 'Gizmo', quantity: 4, price: 50.0 }],
      category: 'electronics',
      region: 'west',
      createdAt: new Date('2024-02-10'),
    },
    {
      customerId: 'c2',
      status: 'pending',
      total: 75.0,
      items: [{ productId: 'p1', name: 'Widget', quantity: 1, price: 75.0 }],
      category: 'home',
      region: 'east',
      createdAt: new Date('2024-03-01'),
    },
    {
      customerId: 'c3',
      status: 'shipped',
      total: 300.0,
      items: [
        { productId: 'p4', name: 'Thingamajig', quantity: 3, price: 100.0 },
      ],
      category: 'electronics',
      region: 'central',
      createdAt: new Date('2024-03-05'),
    },
    {
      customerId: 'c2',
      status: 'cancelled',
      total: 50.0,
      items: [{ productId: 'p5', name: 'Doohickey', quantity: 1, price: 50.0 }],
      category: 'home',
      region: 'east',
      createdAt: new Date('2024-03-10'),
    },
  ];

  const sampleProducts: Product[] = [
    { sku: 'W001', name: 'Widget', price: 50.0, category: 'electronics', tags: ['popular', 'sale'], inStock: true, rating: 4.5 },
    { sku: 'G001', name: 'Gadget', price: 75.0, category: 'electronics', tags: ['new'], inStock: true, rating: 4.0 },
    { sku: 'G002', name: 'Gizmo', price: 100.0, category: 'electronics', tags: ['popular'], inStock: false, rating: 3.5 },
    { sku: 'T001', name: 'Thingamajig', price: 150.0, category: 'home', tags: ['premium', 'new'], inStock: true, rating: 5.0 },
    { sku: 'D001', name: 'Doohickey', price: 25.0, category: 'home', tags: ['budget'], inStock: true, rating: 3.0 },
  ];

  const sampleCustomers: Customer[] = [
    { _id: 'c1', name: 'Alice', email: 'alice@example.com', tier: 'gold', totalSpent: 5000 },
    { _id: 'c2', name: 'Bob', email: 'bob@example.com', tier: 'silver', totalSpent: 2000 },
    { _id: 'c3', name: 'Charlie', email: 'charlie@example.com', tier: 'platinum', totalSpent: 10000 },
  ];

  const samplePageViews: PageView[] = [
    { userId: 'u1', page: '/home', duration: 30, timestamp: new Date('2024-01-01T10:00:00') },
    { userId: 'u1', page: '/products', duration: 120, timestamp: new Date('2024-01-01T10:01:00') },
    { userId: 'u2', page: '/home', duration: 15, timestamp: new Date('2024-01-01T10:02:00') },
    { userId: 'u1', page: '/checkout', duration: 60, timestamp: new Date('2024-01-01T10:03:00') },
    { userId: 'u2', page: '/products', duration: 90, timestamp: new Date('2024-01-01T10:04:00') },
  ];

  beforeEach(async () => {
    clearAllStorage();
    client = new MongoClient(TEST_ENDPOINT);
    await client.connect();
    const db = client.db('testdb');
    orders = db.collection<Order>('orders');
    products = db.collection<Product>('products');
    customers = db.collection<Customer>('customers');
    pageViews = db.collection<PageView>('pageviews');

    // Insert sample data
    await orders.insertMany(sampleOrders);
    await products.insertMany(sampleProducts);
    await customers.insertMany(sampleCustomers);
    await pageViews.insertMany(samplePageViews);
  });

  afterEach(async () => {
    try {
      await client.close();
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe('aggregate() method basics', () => {
    it('aggregate method exists on Collection', () => {
      expect(typeof (orders as any).aggregate).toBe('function');
    });

    it('aggregate returns an AggregationCursor', () => {
      const cursor = (orders as any).aggregate([]);
      expect(cursor).toBeDefined();
      expect(typeof cursor.toArray).toBe('function');
    });

    it('aggregate with empty pipeline returns all documents', async () => {
      const results = await (orders as any).aggregate([]).toArray();
      expect(results).toHaveLength(5);
    });

    it('AggregationCursor supports toArray()', async () => {
      const cursor = (orders as any).aggregate([{ $match: { status: 'delivered' } }]);
      const results = await cursor.toArray();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('$match stage', () => {
    it('$match filters documents by equality', async () => {
      const pipeline = [{ $match: { status: 'delivered' } }];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(2);
      expect(results.every((r: Order) => r.status === 'delivered')).toBe(true);
    });

    it('$match supports comparison operators', async () => {
      const pipeline = [{ $match: { total: { $gt: 100 } } }];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(3);
      expect(results.every((r: Order) => r.total > 100)).toBe(true);
    });

    it('$match supports $in operator', async () => {
      const pipeline = [{ $match: { status: { $in: ['pending', 'shipped'] } } }];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(2);
    });

    it('$match supports $and logic', async () => {
      const pipeline = [
        { $match: { $and: [{ status: 'delivered' }, { region: 'west' }] } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(2);
    });

    it('$match supports $or logic', async () => {
      const pipeline = [
        { $match: { $or: [{ status: 'cancelled' }, { total: { $gt: 250 } }] } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(2);
    });
  });

  describe('$group stage', () => {
    it('$group groups documents by field', async () => {
      const pipeline = [
        { $group: { _id: '$category' } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      const categories = results.map((r: Document) => r._id);
      expect(categories).toContain('electronics');
      expect(categories).toContain('home');
      expect(results).toHaveLength(2);
    });

    it('$group with $sum accumulator', async () => {
      const pipeline = [
        { $group: { _id: '$category', totalRevenue: { $sum: '$total' } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      const electronics = results.find((r: Document) => r._id === 'electronics');
      expect(electronics.totalRevenue).toBe(650); // 150 + 200 + 300
    });

    it('$group with $avg accumulator', async () => {
      const pipeline = [
        { $group: { _id: '$category', avgOrder: { $avg: '$total' } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      const home = results.find((r: Document) => r._id === 'home');
      expect(home.avgOrder).toBeCloseTo(62.5); // (75 + 50) / 2
    });

    it('$group with $min accumulator', async () => {
      const pipeline = [
        { $group: { _id: '$category', minOrder: { $min: '$total' } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      const electronics = results.find((r: Document) => r._id === 'electronics');
      expect(electronics.minOrder).toBe(150);
    });

    it('$group with $max accumulator', async () => {
      const pipeline = [
        { $group: { _id: '$category', maxOrder: { $max: '$total' } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      const electronics = results.find((r: Document) => r._id === 'electronics');
      expect(electronics.maxOrder).toBe(300);
    });

    it('$group with $count accumulator', async () => {
      const pipeline = [
        { $group: { _id: '$status', count: { $count: {} } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      const delivered = results.find((r: Document) => r._id === 'delivered');
      expect(delivered.count).toBe(2);
    });

    it('$group with $push accumulator', async () => {
      const pipeline = [
        { $group: { _id: '$customerId', orderTotals: { $push: '$total' } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      const c1 = results.find((r: Document) => r._id === 'c1');
      expect(c1.orderTotals).toContain(150);
      expect(c1.orderTotals).toContain(200);
      expect(c1.orderTotals).toHaveLength(2);
    });

    it('$group with multiple accumulators', async () => {
      const pipeline = [
        {
          $group: {
            _id: '$region',
            totalOrders: { $count: {} },
            totalRevenue: { $sum: '$total' },
            avgOrder: { $avg: '$total' },
          },
        },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      const west = results.find((r: Document) => r._id === 'west');
      expect(west.totalOrders).toBe(2);
      expect(west.totalRevenue).toBe(350);
      expect(west.avgOrder).toBe(175);
    });

    it('$group with null _id aggregates all documents', async () => {
      const pipeline = [
        { $group: { _id: null, totalRevenue: { $sum: '$total' } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(1);
      expect(results[0].totalRevenue).toBe(775); // Sum of all orders
    });
  });

  describe('$project stage', () => {
    it('$project includes specified fields', async () => {
      const pipeline = [
        { $project: { customerId: 1, total: 1 } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0]).toHaveProperty('customerId');
      expect(results[0]).toHaveProperty('total');
      expect(results[0]).toHaveProperty('_id');
      expect(results[0]).not.toHaveProperty('status');
    });

    it('$project excludes specified fields', async () => {
      const pipeline = [
        { $project: { items: 0, createdAt: 0 } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0]).not.toHaveProperty('items');
      expect(results[0]).not.toHaveProperty('createdAt');
      expect(results[0]).toHaveProperty('customerId');
    });

    it('$project excludes _id when specified', async () => {
      const pipeline = [
        { $project: { _id: 0, customerId: 1, total: 1 } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0]).not.toHaveProperty('_id');
      expect(results[0]).toHaveProperty('customerId');
    });

    it('$project creates computed fields', async () => {
      const pipeline = [
        { $project: { customerId: 1, doubled: { $multiply: ['$total', 2] } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0].doubled).toBe(results[0].total * 2 || 300); // First order total is 150
    });

    it('$project renames fields', async () => {
      const pipeline = [
        { $project: { customer: '$customerId', orderValue: '$total' } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0]).toHaveProperty('customer');
      expect(results[0]).toHaveProperty('orderValue');
      expect(results[0]).not.toHaveProperty('customerId');
      expect(results[0]).not.toHaveProperty('total');
    });
  });

  describe('$sort stage', () => {
    it('$sort ascending', async () => {
      const pipeline = [
        { $sort: { total: 1 } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0].total).toBe(50);
      expect(results[results.length - 1].total).toBe(300);
    });

    it('$sort descending', async () => {
      const pipeline = [
        { $sort: { total: -1 } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0].total).toBe(300);
      expect(results[results.length - 1].total).toBe(50);
    });

    it('$sort by multiple fields', async () => {
      const pipeline = [
        { $sort: { category: 1, total: -1 } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      // Electronics should come first, sorted by total descending
      expect(results[0].category).toBe('electronics');
      expect(results[0].total).toBe(300);
    });
  });

  describe('$limit stage', () => {
    it('$limit restricts number of documents', async () => {
      const pipeline = [
        { $limit: 2 },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(2);
    });

    it('$limit after $sort returns top N', async () => {
      const pipeline = [
        { $sort: { total: -1 } },
        { $limit: 3 },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(3);
      expect(results[0].total).toBe(300);
    });
  });

  describe('$skip stage', () => {
    it('$skip skips documents', async () => {
      const pipeline = [
        { $sort: { total: 1 } },
        { $skip: 2 },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(3);
      expect(results[0].total).toBeGreaterThan(50); // Skipped the two lowest
    });

    it('$skip and $limit for pagination', async () => {
      const pipeline = [
        { $sort: { total: -1 } },
        { $skip: 1 },
        { $limit: 2 },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(2);
      expect(results[0].total).toBe(200); // Second highest
    });
  });

  describe('$unwind stage', () => {
    it('$unwind flattens arrays', async () => {
      const pipeline = [
        { $match: { customerId: 'c1' } },
        { $unwind: '$items' },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      // c1 has 2 orders: first with 2 items, second with 1 item = 3 docs
      expect(results).toHaveLength(3);
      expect(results[0].items).not.toBeInstanceOf(Array);
    });

    it('$unwind creates document per array element', async () => {
      const pipeline = [
        { $limit: 1 }, // First order has 2 items
        { $unwind: '$items' },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(2);
      expect(results[0].items.name).toBe('Widget');
      expect(results[1].items.name).toBe('Gadget');
    });

    it('$unwind preserves empty arrays when preserveNullAndEmptyArrays is true', async () => {
      // First add an order with empty items
      await orders.insertOne({
        customerId: 'c4',
        status: 'pending',
        total: 0,
        items: [],
        category: 'other',
        region: 'north',
        createdAt: new Date(),
      });

      const pipeline = [
        { $match: { customerId: 'c4' } },
        { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(1);
    });
  });

  describe('$addFields stage', () => {
    it('$addFields adds new fields', async () => {
      const pipeline = [
        { $addFields: { isHighValue: { $gt: ['$total', 100] } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0]).toHaveProperty('isHighValue');
      expect(results.every((r: Document) => 'isHighValue' in r)).toBe(true);
    });

    it('$addFields preserves existing fields', async () => {
      const pipeline = [
        { $addFields: { newField: 'test' } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0]).toHaveProperty('customerId');
      expect(results[0]).toHaveProperty('total');
      expect(results[0]).toHaveProperty('newField');
    });

    it('$addFields can compute values from existing fields', async () => {
      const pipeline = [
        { $addFields: { discountedTotal: { $multiply: ['$total', 0.9] } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0].discountedTotal).toBeCloseTo(results[0].total * 0.9);
    });
  });

  describe('$lookup stage', () => {
    it('$lookup performs basic join', async () => {
      const pipeline = [
        {
          $lookup: {
            from: 'customers',
            localField: 'customerId',
            foreignField: '_id',
            as: 'customer',
          },
        },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0]).toHaveProperty('customer');
      expect(Array.isArray(results[0].customer)).toBe(true);
    });

    it('$lookup populates joined documents', async () => {
      const pipeline = [
        { $match: { customerId: 'c1' } },
        { $limit: 1 },
        {
          $lookup: {
            from: 'customers',
            localField: 'customerId',
            foreignField: '_id',
            as: 'customerInfo',
          },
        },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0].customerInfo).toHaveLength(1);
      expect(results[0].customerInfo[0].name).toBe('Alice');
    });

    it('$lookup returns empty array when no match', async () => {
      await orders.insertOne({
        customerId: 'nonexistent',
        status: 'pending',
        total: 10,
        items: [],
        category: 'test',
        region: 'test',
        createdAt: new Date(),
      });

      const pipeline = [
        { $match: { customerId: 'nonexistent' } },
        {
          $lookup: {
            from: 'customers',
            localField: 'customerId',
            foreignField: '_id',
            as: 'customerInfo',
          },
        },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0].customerInfo).toHaveLength(0);
    });
  });

  describe('multi-stage pipelines', () => {
    it('$match -> $group pipeline', async () => {
      const pipeline = [
        { $match: { status: 'delivered' } },
        { $group: { _id: '$customerId', totalSpent: { $sum: '$total' } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      const c1 = results.find((r: Document) => r._id === 'c1');
      expect(c1.totalSpent).toBe(350); // 150 + 200
    });

    it('$match -> $group -> $sort pipeline', async () => {
      const pipeline = [
        { $match: { status: { $ne: 'cancelled' } } },
        { $group: { _id: '$category', revenue: { $sum: '$total' } } },
        { $sort: { revenue: -1 } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0]._id).toBe('electronics');
      expect(results[0].revenue).toBe(650);
    });

    it('$group -> $match (having) pipeline', async () => {
      const pipeline = [
        { $group: { _id: '$customerId', orderCount: { $count: {} } } },
        { $match: { orderCount: { $gt: 1 } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(2); // c1 and c2 have multiple orders
    });

    it('full e-commerce analytics pipeline', async () => {
      const pipeline = [
        { $match: { status: { $in: ['delivered', 'shipped'] } } },
        { $group: { _id: '$region', totalRevenue: { $sum: '$total' }, orderCount: { $count: {} } } },
        { $addFields: { avgOrderValue: { $divide: ['$totalRevenue', '$orderCount'] } } },
        { $sort: { totalRevenue: -1 } },
        { $limit: 10 },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('totalRevenue');
      expect(results[0]).toHaveProperty('orderCount');
      expect(results[0]).toHaveProperty('avgOrderValue');
    });

    it('$unwind -> $group pipeline for item-level aggregation', async () => {
      const pipeline = [
        { $unwind: '$items' },
        { $group: { _id: '$items.productId', totalQuantitySold: { $sum: '$items.quantity' } } },
        { $sort: { totalQuantitySold: -1 } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('totalQuantitySold');
    });

    it('$lookup -> $unwind -> $project pipeline', async () => {
      const pipeline = [
        { $match: { customerId: 'c1' } },
        {
          $lookup: {
            from: 'customers',
            localField: 'customerId',
            foreignField: '_id',
            as: 'customer',
          },
        },
        { $unwind: '$customer' },
        { $project: { orderTotal: '$total', customerName: '$customer.name', customerTier: '$customer.tier' } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0].customerName).toBe('Alice');
      expect(results[0].customerTier).toBe('gold');
    });
  });

  describe('error handling', () => {
    it('throws error for unknown stage', async () => {
      const pipeline = [{ $unknownStage: {} }];

      await expect((orders as any).aggregate(pipeline).toArray()).rejects.toThrow();
    });

    it('throws error for invalid $group _id', async () => {
      const pipeline = [{ $group: { total: { $sum: '$total' } } }]; // Missing _id

      await expect((orders as any).aggregate(pipeline).toArray()).rejects.toThrow();
    });

    it('handles empty result from $match gracefully', async () => {
      const pipeline = [
        { $match: { status: 'nonexistent' } },
        { $group: { _id: '$category', count: { $count: {} } } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results).toHaveLength(0);
    });
  });

  describe('real-world scenarios', () => {
    it('calculates customer lifetime value', async () => {
      const pipeline = [
        { $match: { status: { $ne: 'cancelled' } } },
        {
          $group: {
            _id: '$customerId',
            totalSpent: { $sum: '$total' },
            orderCount: { $count: {} },
            avgOrderValue: { $avg: '$total' },
          },
        },
        { $sort: { totalSpent: -1 } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0]).toHaveProperty('totalSpent');
      expect(results[0]).toHaveProperty('orderCount');
      expect(results[0]).toHaveProperty('avgOrderValue');
    });

    it('generates sales by region report', async () => {
      const pipeline = [
        { $match: { status: 'delivered' } },
        {
          $group: {
            _id: '$region',
            revenue: { $sum: '$total' },
            orders: { $count: {} },
          },
        },
        {
          $project: {
            region: '$_id',
            revenue: 1,
            orders: 1,
            _id: 0,
          },
        },
        { $sort: { revenue: -1 } },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results[0]).toHaveProperty('region');
      expect(results[0]).not.toHaveProperty('_id');
    });

    it('finds top-selling products', async () => {
      const pipeline = [
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            productName: { $first: '$items.name' },
            totalQuantity: { $sum: '$items.quantity' },
            totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
          },
        },
        { $sort: { totalQuantity: -1 } },
        { $limit: 5 },
      ];
      const results = await (orders as any).aggregate(pipeline).toArray();

      expect(results.length).toBeLessThanOrEqual(5);
      expect(results[0]).toHaveProperty('productName');
      expect(results[0]).toHaveProperty('totalQuantity');
    });

    it('calculates page view analytics', async () => {
      const pipeline = [
        {
          $group: {
            _id: '$page',
            totalViews: { $count: {} },
            avgDuration: { $avg: '$duration' },
            uniqueUsers: { $addToSet: '$userId' },
          },
        },
        { $sort: { totalViews: -1 } },
      ];
      const results = await (pageViews as any).aggregate(pipeline).toArray();

      expect(results[0]).toHaveProperty('totalViews');
      expect(results[0]).toHaveProperty('avgDuration');
    });
  });
});
