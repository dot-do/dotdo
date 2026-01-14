import { describe, it, expect } from 'vitest'
import { haversineDistance, findNearestReplica } from '../utils/geo'

describe('Nearest Replica Selection', () => {
  describe('haversineDistance', () => {
    it('should return 0 for identical coordinates', () => {
      const distance = haversineDistance(
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0 }
      )
      expect(distance).toBe(0)
    })

    it('should calculate distance between San Francisco and New York', () => {
      const sf = { lat: 37.7749, lon: -122.4194 }
      const nyc = { lat: 40.7128, lon: -74.0060 }
      const distance = haversineDistance(sf, nyc)

      // SF to NYC is approximately 4129 km
      // Allow for floating point precision and rounding differences
      expect(distance).toBeGreaterThan(4100)
      expect(distance).toBeLessThan(4150)
    })

    it('should return the same distance regardless of order', () => {
      const loc1 = { lat: 37.7749, lon: -122.4194 }
      const loc2 = { lat: 40.7128, lon: -74.0060 }

      const distance1 = haversineDistance(loc1, loc2)
      const distance2 = haversineDistance(loc2, loc1)

      expect(distance1).toBe(distance2)
    })

    it('should handle equatorial distances', () => {
      const point1 = { lat: 0, lon: 0 }
      const point2 = { lat: 0, lon: 1 }
      const distance = haversineDistance(point1, point2)

      // At equator, 1 degree is approximately 111.32 km
      expect(distance).toBeGreaterThan(100)
      expect(distance).toBeLessThan(120)
    })
  })

  describe('findNearestReplica', () => {
    const replicaRegions = [
      {
        id: 'us-west',
        lat: 37.7749,
        lon: -122.4194,
        binding: 'DO_US_WEST',
      },
      {
        id: 'us-east',
        lat: 40.7128,
        lon: -74.0060,
        binding: 'DO_US_EAST',
      },
      {
        id: 'eu-west',
        lat: 51.5074,
        lon: -0.1278,
        binding: 'DO_EU_WEST',
      },
    ]

    it('should return null for empty regions array', () => {
      const userLocation = { lat: 37.7749, lon: -122.4194 }
      const result = findNearestReplica(userLocation, [])

      expect(result).toBeNull()
    })

    it('should return the only region when array has one region', () => {
      const userLocation = { lat: 37.7749, lon: -122.4194 }
      const result = findNearestReplica(userLocation, [replicaRegions[0]])

      expect(result).toBe(replicaRegions[0])
    })

    it('should select us-west for San Francisco location', () => {
      const userLocation = { lat: 37.7749, lon: -122.4194 }
      const result = findNearestReplica(userLocation, replicaRegions)

      expect(result?.id).toBe('us-west')
      expect(result?.binding).toBe('DO_US_WEST')
    })

    it('should select us-east for New York location', () => {
      const userLocation = { lat: 40.7128, lon: -74.0060 }
      const result = findNearestReplica(userLocation, replicaRegions)

      expect(result?.id).toBe('us-east')
      expect(result?.binding).toBe('DO_US_EAST')
    })

    it('should select eu-west for London location', () => {
      const userLocation = { lat: 51.5074, lon: -0.1278 }
      const result = findNearestReplica(userLocation, replicaRegions)

      expect(result?.id).toBe('eu-west')
      expect(result?.binding).toBe('DO_EU_WEST')
    })

    it('should select us-west for Seattle location (closer to SF than NYC)', () => {
      const userLocation = { lat: 47.6062, lon: -122.3321 }
      const result = findNearestReplica(userLocation, replicaRegions)

      expect(result?.id).toBe('us-west')
    })

    it('should select us-east for Boston location (closer to NYC than SF)', () => {
      const userLocation = { lat: 42.3601, lon: -71.0589 }
      const result = findNearestReplica(userLocation, replicaRegions)

      expect(result?.id).toBe('us-east')
    })

    it('should select eu-west for Paris location (closer to London than US)', () => {
      const userLocation = { lat: 48.8566, lon: 2.3522 }
      const result = findNearestReplica(userLocation, replicaRegions)

      expect(result?.id).toBe('eu-west')
    })

    it('should return the entire replica region object with binding intact', () => {
      const userLocation = { lat: 37.7749, lon: -122.4194 }
      const result = findNearestReplica(userLocation, replicaRegions)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('lat')
      expect(result).toHaveProperty('lon')
      expect(result).toHaveProperty('binding')
      expect(result?.lat).toBe(37.7749)
      expect(result?.lon).toBe(-122.4194)
    })
  })
})
