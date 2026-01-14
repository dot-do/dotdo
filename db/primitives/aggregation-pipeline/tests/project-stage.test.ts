/**
 * $project Stage Tests (RED Phase)
 *
 * Tests for MongoDB-style $project stage with:
 * - Include/exclude fields
 * - Computed fields
 * - Field renaming
 * - Nested document projection
 * - Expression evaluation
 *
 * @see dotdo-jeffp
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ProjectStage,
  createProjectStage,
  ProjectSpec,
  FieldProjection,
  ComputedField,
} from '../stages/project'

// Test data types
interface FullDocument {
  _id: string
  name: string
  email: string
  password: string
  profile: {
    age: number
    location: {
      city: string
      country: string
      coordinates: { lat: number; lng: number }
    }
    preferences: {
      theme: string
      language: string
      notifications: boolean
    }
  }
  metadata: {
    createdAt: Date
    updatedAt: Date
    version: number
  }
  scores: number[]
  tags: string[]
}

interface OrderDocument {
  orderId: string
  customer: string
  items: Array<{
    productId: string
    name: string
    price: number
    quantity: number
  }>
  subtotal: number
  tax: number
  shipping: number
  total: number
  status: string
  createdAt: Date
}

describe('ProjectStage', () => {
  let sampleDocs: FullDocument[]
  let sampleOrders: OrderDocument[]

  beforeEach(() => {
    sampleDocs = [
      {
        _id: '1',
        name: 'Alice',
        email: 'alice@example.com',
        password: 'secret123',
        profile: {
          age: 30,
          location: {
            city: 'New York',
            country: 'USA',
            coordinates: { lat: 40.7128, lng: -74.006 },
          },
          preferences: {
            theme: 'dark',
            language: 'en',
            notifications: true,
          },
        },
        metadata: {
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-06-15'),
          version: 3,
        },
        scores: [85, 90, 78, 92],
        tags: ['premium', 'verified'],
      },
      {
        _id: '2',
        name: 'Bob',
        email: 'bob@example.com',
        password: 'pass456',
        profile: {
          age: 25,
          location: {
            city: 'London',
            country: 'UK',
            coordinates: { lat: 51.5074, lng: -0.1278 },
          },
          preferences: {
            theme: 'light',
            language: 'en',
            notifications: false,
          },
        },
        metadata: {
          createdAt: new Date('2024-02-15'),
          updatedAt: new Date('2024-02-15'),
          version: 1,
        },
        scores: [70, 65, 80],
        tags: ['standard'],
      },
    ]

    sampleOrders = [
      {
        orderId: 'ORD-001',
        customer: 'Alice',
        items: [
          { productId: 'P1', name: 'Widget', price: 10, quantity: 5 },
          { productId: 'P2', name: 'Gadget', price: 25, quantity: 2 },
        ],
        subtotal: 100,
        tax: 8,
        shipping: 5,
        total: 113,
        status: 'delivered',
        createdAt: new Date('2024-01-15'),
      },
      {
        orderId: 'ORD-002',
        customer: 'Bob',
        items: [{ productId: 'P3', name: 'Gizmo', price: 50, quantity: 1 }],
        subtotal: 50,
        tax: 4,
        shipping: 10,
        total: 64,
        status: 'pending',
        createdAt: new Date('2024-01-16'),
      },
    ]
  })

  describe('Stage properties', () => {
    it('should have name "$project"', () => {
      const stage = createProjectStage<FullDocument>({ name: 1, email: 1 })
      expect(stage.name).toBe('$project')
    })

    it('should expose the projection spec for inspection', () => {
      const spec: ProjectSpec<FullDocument> = { name: 1, email: 1 }
      const stage = createProjectStage(spec)
      expect(stage.specification).toEqual(spec)
    })
  })

  describe('Field inclusion', () => {
    it('should include specified fields with value 1', () => {
      const stage = createProjectStage<FullDocument>({
        name: 1,
        email: 1,
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).toHaveProperty('name', 'Alice')
      expect(result[0]).toHaveProperty('email', 'alice@example.com')
      expect(result[0]).not.toHaveProperty('password')
      expect(result[0]).not.toHaveProperty('profile')
    })

    it('should include specified fields with value true', () => {
      const stage = createProjectStage<FullDocument>({
        name: true,
        email: true,
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('email')
    })

    it('should always include _id by default', () => {
      const stage = createProjectStage<FullDocument>({
        name: 1,
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).toHaveProperty('_id', '1')
      expect(result[0]).toHaveProperty('name', 'Alice')
    })

    it('should include nested fields with dot notation', () => {
      const stage = createProjectStage<FullDocument>({
        'profile.age': 1,
        'profile.location.city': 1,
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).toHaveProperty('profile.age', 30)
      expect(result[0]).toHaveProperty('profile.location.city', 'New York')
    })

    it('should include entire nested object', () => {
      const stage = createProjectStage<FullDocument>({
        profile: 1,
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).toHaveProperty('profile')
      expect(result[0].profile).toHaveProperty('age', 30)
      expect(result[0].profile).toHaveProperty('location')
    })
  })

  describe('Field exclusion', () => {
    it('should exclude specified fields with value 0', () => {
      const stage = createProjectStage<FullDocument>({
        password: 0,
        metadata: 0,
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).not.toHaveProperty('password')
      expect(result[0]).not.toHaveProperty('metadata')
      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('email')
      expect(result[0]).toHaveProperty('profile')
    })

    it('should exclude specified fields with value false', () => {
      const stage = createProjectStage<FullDocument>({
        password: false,
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).not.toHaveProperty('password')
    })

    it('should exclude _id when explicitly set to 0', () => {
      const stage = createProjectStage<FullDocument>({
        _id: 0,
        name: 1,
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).not.toHaveProperty('_id')
      expect(result[0]).toHaveProperty('name')
    })

    it('should exclude nested fields', () => {
      const stage = createProjectStage<FullDocument>({
        'profile.preferences': 0,
      })
      const result = stage.process(sampleDocs)

      expect(result[0].profile).not.toHaveProperty('preferences')
      expect(result[0].profile).toHaveProperty('age')
      expect(result[0].profile).toHaveProperty('location')
    })

    it('should not mix inclusion and exclusion (except _id)', () => {
      // This should throw an error
      expect(() =>
        createProjectStage<FullDocument>({
          name: 1,
          password: 0, // Cannot mix inclusion and exclusion
        })
      ).toThrow()
    })
  })

  describe('Field renaming', () => {
    it('should rename field using $fieldRef', () => {
      const stage = createProjectStage<FullDocument>({
        username: '$name',
        contact: '$email',
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).toHaveProperty('username', 'Alice')
      expect(result[0]).toHaveProperty('contact', 'alice@example.com')
      expect(result[0]).not.toHaveProperty('name')
      expect(result[0]).not.toHaveProperty('email')
    })

    it('should rename nested fields', () => {
      const stage = createProjectStage<FullDocument>({
        city: '$profile.location.city',
        country: '$profile.location.country',
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).toHaveProperty('city', 'New York')
      expect(result[0]).toHaveProperty('country', 'USA')
    })

    it('should support renaming to nested output paths', () => {
      const stage = createProjectStage<FullDocument>({
        user: {
          fullName: '$name',
          emailAddress: '$email',
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).toHaveProperty('user.fullName', 'Alice')
      expect(result[0]).toHaveProperty('user.emailAddress', 'alice@example.com')
    })
  })

  describe('Computed fields', () => {
    it('should compute field using $literal', () => {
      const stage = createProjectStage<FullDocument>({
        name: 1,
        status: { $literal: 'active' },
      })
      const result = stage.process(sampleDocs)

      expect(result[0]).toHaveProperty('status', 'active')
    })

    it('should compute field using $concat', () => {
      const stage = createProjectStage<FullDocument>({
        displayName: { $concat: ['$name', ' <', '$email', '>'] },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].displayName).toBe('Alice <alice@example.com>')
    })

    it('should compute field using $add', () => {
      const stage = createProjectStage<OrderDocument>({
        orderId: 1,
        finalTotal: { $add: ['$subtotal', '$tax', '$shipping'] },
      })
      const result = stage.process(sampleOrders)

      expect(result[0].finalTotal).toBe(113)
    })

    it('should compute field using $subtract', () => {
      const stage = createProjectStage<OrderDocument>({
        orderId: 1,
        discount: { $subtract: ['$total', '$subtotal'] },
      })
      const result = stage.process(sampleOrders)

      expect(result[0].discount).toBe(13) // tax + shipping
    })

    it('should compute field using $multiply', () => {
      const stage = createProjectStage<OrderDocument>({
        orderId: 1,
        taxRate: { $multiply: [{ $divide: ['$tax', '$subtotal'] }, 100] },
      })
      const result = stage.process(sampleOrders)

      expect(result[0].taxRate).toBeCloseTo(8)
    })

    it('should compute field using $divide', () => {
      const stage = createProjectStage<OrderDocument>({
        orderId: 1,
        averageItemPrice: {
          $divide: ['$subtotal', { $size: '$items' }],
        },
      })
      const result = stage.process(sampleOrders)

      expect(result[0].averageItemPrice).toBe(50) // 100 / 2
    })

    it('should compute field using $cond (if-then-else)', () => {
      const stage = createProjectStage<FullDocument>({
        name: 1,
        ageGroup: {
          $cond: {
            if: { $gte: ['$profile.age', 30] },
            then: 'adult',
            else: 'young',
          },
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].ageGroup).toBe('adult')
      expect(result[1].ageGroup).toBe('young')
    })

    it('should compute field using $switch', () => {
      const stage = createProjectStage<OrderDocument>({
        orderId: 1,
        statusLabel: {
          $switch: {
            branches: [
              { case: { $eq: ['$status', 'pending'] }, then: 'Awaiting' },
              { case: { $eq: ['$status', 'delivered'] }, then: 'Complete' },
            ],
            default: 'Unknown',
          },
        },
      })
      const result = stage.process(sampleOrders)

      expect(result[0].statusLabel).toBe('Complete')
      expect(result[1].statusLabel).toBe('Awaiting')
    })

    it('should compute field using $ifNull', () => {
      const dataWithNull = [{ name: 'Test', nickname: null }]
      const stage = createProjectStage<(typeof dataWithNull)[0]>({
        displayName: { $ifNull: ['$nickname', '$name'] },
      })
      const result = stage.process(dataWithNull)

      expect(result[0].displayName).toBe('Test')
    })
  })

  describe('Array field projections', () => {
    it('should project entire array', () => {
      const stage = createProjectStage<FullDocument>({
        scores: 1,
      })
      const result = stage.process(sampleDocs)

      expect(result[0].scores).toEqual([85, 90, 78, 92])
    })

    it('should compute array field using $size', () => {
      const stage = createProjectStage<FullDocument>({
        name: 1,
        scoreCount: { $size: '$scores' },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].scoreCount).toBe(4)
    })

    it('should compute field using $arrayElemAt', () => {
      const stage = createProjectStage<FullDocument>({
        name: 1,
        firstScore: { $arrayElemAt: ['$scores', 0] },
        lastScore: { $arrayElemAt: ['$scores', -1] },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].firstScore).toBe(85)
      expect(result[0].lastScore).toBe(92)
    })

    it('should compute field using $slice', () => {
      const stage = createProjectStage<FullDocument>({
        name: 1,
        topScores: { $slice: ['$scores', 2] },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].topScores).toEqual([85, 90])
    })

    it('should compute field using $filter', () => {
      const stage = createProjectStage<FullDocument>({
        name: 1,
        highScores: {
          $filter: {
            input: '$scores',
            as: 'score',
            cond: { $gte: ['$$score', 80] },
          },
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].highScores).toEqual([85, 90, 92])
    })

    it('should compute field using $map', () => {
      const stage = createProjectStage<FullDocument>({
        name: 1,
        gradeLetters: {
          $map: {
            input: '$scores',
            as: 'score',
            in: {
              $switch: {
                branches: [
                  { case: { $gte: ['$$score', 90] }, then: 'A' },
                  { case: { $gte: ['$$score', 80] }, then: 'B' },
                  { case: { $gte: ['$$score', 70] }, then: 'C' },
                ],
                default: 'D',
              },
            },
          },
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].gradeLetters).toEqual(['B', 'A', 'C', 'A'])
    })

    it('should compute field using $reduce', () => {
      const stage = createProjectStage<FullDocument>({
        name: 1,
        totalScore: {
          $reduce: {
            input: '$scores',
            initialValue: 0,
            in: { $add: ['$$value', '$$this'] },
          },
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].totalScore).toBe(345)
    })
  })

  describe('String operations', () => {
    it('should compute using $toUpper', () => {
      const stage = createProjectStage<FullDocument>({
        upperName: { $toUpper: '$name' },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].upperName).toBe('ALICE')
    })

    it('should compute using $toLower', () => {
      const stage = createProjectStage<FullDocument>({
        lowerEmail: { $toLower: '$email' },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].lowerEmail).toBe('alice@example.com')
    })

    it('should compute using $substr', () => {
      const stage = createProjectStage<FullDocument>({
        emailDomain: {
          $substr: [
            '$email',
            { $add: [{ $indexOfBytes: ['$email', '@'] }, 1] },
            -1,
          ],
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].emailDomain).toBe('example.com')
    })

    it('should compute using $split', () => {
      const stage = createProjectStage<FullDocument>({
        emailParts: { $split: ['$email', '@'] },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].emailParts).toEqual(['alice', 'example.com'])
    })

    it('should compute using $strLenCP', () => {
      const stage = createProjectStage<FullDocument>({
        nameLength: { $strLenCP: '$name' },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].nameLength).toBe(5)
    })
  })

  describe('Date operations', () => {
    it('should extract year using $year', () => {
      const stage = createProjectStage<FullDocument>({
        createdYear: { $year: '$metadata.createdAt' },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].createdYear).toBe(2024)
    })

    it('should extract month using $month', () => {
      const stage = createProjectStage<FullDocument>({
        createdMonth: { $month: '$metadata.createdAt' },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].createdMonth).toBe(1)
    })

    it('should extract day using $dayOfMonth', () => {
      const stage = createProjectStage<FullDocument>({
        createdDay: { $dayOfMonth: '$metadata.createdAt' },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].createdDay).toBe(1)
    })

    it('should format date using $dateToString', () => {
      const stage = createProjectStage<FullDocument>({
        formattedDate: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$metadata.createdAt',
          },
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].formattedDate).toBe('2024-01-01')
    })

    it('should compute date difference', () => {
      const stage = createProjectStage<FullDocument>({
        daysSinceCreation: {
          $dateDiff: {
            startDate: '$metadata.createdAt',
            endDate: '$metadata.updatedAt',
            unit: 'day',
          },
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].daysSinceCreation).toBeGreaterThan(0)
    })
  })

  describe('Nested document projection', () => {
    it('should project nested document structure', () => {
      const stage = createProjectStage<FullDocument>({
        location: '$profile.location',
      })
      const result = stage.process(sampleDocs)

      expect(result[0].location).toEqual({
        city: 'New York',
        country: 'USA',
        coordinates: { lat: 40.7128, lng: -74.006 },
      })
    })

    it('should reshape nested structure', () => {
      const stage = createProjectStage<FullDocument>({
        userInfo: {
          name: '$name',
          age: '$profile.age',
          city: '$profile.location.city',
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].userInfo).toEqual({
        name: 'Alice',
        age: 30,
        city: 'New York',
      })
    })

    it('should handle deeply nested projections', () => {
      const stage = createProjectStage<FullDocument>({
        coords: {
          latitude: '$profile.location.coordinates.lat',
          longitude: '$profile.location.coordinates.lng',
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].coords.latitude).toBeCloseTo(40.7128)
      expect(result[0].coords.longitude).toBeCloseTo(-74.006)
    })

    it('should exclude specific nested fields', () => {
      const stage = createProjectStage<FullDocument>({
        profile: {
          age: 1,
          location: { city: 1, country: 1 },
          // Exclude preferences and coordinates
        },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].profile.age).toBe(30)
      expect(result[0].profile.location.city).toBe('New York')
      expect(result[0].profile.location).not.toHaveProperty('coordinates')
      expect(result[0].profile).not.toHaveProperty('preferences')
    })
  })

  describe('Type coercion', () => {
    it('should convert using $toString', () => {
      const stage = createProjectStage<FullDocument>({
        ageString: { $toString: '$profile.age' },
      })
      const result = stage.process(sampleDocs)

      expect(result[0].ageString).toBe('30')
      expect(typeof result[0].ageString).toBe('string')
    })

    it('should convert using $toInt', () => {
      const dataWithStringNum = [{ value: '42' }]
      const stage = createProjectStage<(typeof dataWithStringNum)[0]>({
        numValue: { $toInt: '$value' },
      })
      const result = stage.process(dataWithStringNum)

      expect(result[0].numValue).toBe(42)
      expect(typeof result[0].numValue).toBe('number')
    })

    it('should convert using $toBool', () => {
      const dataWithTruthy = [{ value: 1 }, { value: 0 }, { value: 'yes' }]
      const stage = createProjectStage<(typeof dataWithTruthy)[0]>({
        boolValue: { $toBool: '$value' },
      })
      const result = stage.process(dataWithTruthy)

      expect(result[0].boolValue).toBe(true)
      expect(result[1].boolValue).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty input array', () => {
      const stage = createProjectStage<FullDocument>({ name: 1 })
      const result = stage.process([])

      expect(result).toEqual([])
    })

    it('should handle missing fields gracefully', () => {
      const dataWithMissing = [{ _id: '1', name: 'Test' }]
      const stage = createProjectStage<(typeof dataWithMissing)[0]>({
        name: 1,
        missing: '$nonexistent',
      })
      const result = stage.process(dataWithMissing)

      expect(result[0].name).toBe('Test')
      expect(result[0]).toHaveProperty('missing')
      expect(result[0].missing).toBeUndefined()
    })

    it('should handle null field values', () => {
      const dataWithNull = [{ _id: '1', name: null }]
      const stage = createProjectStage<(typeof dataWithNull)[0]>({
        name: 1,
      })
      const result = stage.process(dataWithNull)

      expect(result[0].name).toBeNull()
    })

    it('should preserve document order', () => {
      const stage = createProjectStage<FullDocument>({ name: 1 })
      const result = stage.process(sampleDocs)

      expect(result[0].name).toBe('Alice')
      expect(result[1].name).toBe('Bob')
    })

    it('should handle special characters in field names', () => {
      const dataWithSpecial = [{ _id: '1', 'field.with.dots': 'value' }]
      // Access fields with special characters requires escape syntax
      expect(dataWithSpecial[0]['field.with.dots']).toBe('value')
    })
  })
})
