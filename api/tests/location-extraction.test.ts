import { describe, it, expect } from 'vitest'
import { extractLocation, getRegionFromColo } from '../utils/location'

describe('Location Extraction', () => {
  describe('extractLocation', () => {
    it('should extract LocationInfo from request.cf', () => {
      const request = {
        cf: {
          colo: 'SJC',
          region: 'Northern California',
          latitude: '37.3382',
          longitude: '-121.8863',
          country: 'US',
        },
      } as any

      const result = extractLocation(request)

      expect(result).toBeDefined()
      expect(result?.colo).toBe('SJC')
      expect(result?.region).toBe('Northern California')
      expect(result?.country).toBe('US')
    })

    it('should parse latitude and longitude as numbers', () => {
      const request = {
        cf: {
          colo: 'IAD',
          region: 'Northern Virginia',
          latitude: '38.9697',
          longitude: '-77.3830',
          country: 'US',
        },
      } as any

      const result = extractLocation(request)

      expect(result?.lat).toBe(38.9697)
      expect(result?.lon).toBe(-77.3830)
      expect(typeof result?.lat).toBe('number')
      expect(typeof result?.lon).toBe('number')
    })

    it('should handle missing cf object by returning null', () => {
      const request = {} as any

      const result = extractLocation(request)

      expect(result).toBeNull()
    })

    it('should handle null cf object by returning null', () => {
      const request = {
        cf: null,
      } as any

      const result = extractLocation(request)

      expect(result).toBeNull()
    })

    it('should handle partial cf data with defaults', () => {
      const request = {
        cf: {
          colo: 'SJC',
          region: 'Northern California',
          // missing latitude, longitude, country
        },
      } as any

      const result = extractLocation(request)

      expect(result?.colo).toBe('SJC')
      expect(result?.region).toBe('Northern California')
      expect(result?.lat).toBeDefined()
      expect(result?.lon).toBeDefined()
      expect(result?.country).toBeDefined()
    })
  })

  describe('getRegionFromColo', () => {
    it('should return "us-west" for SJC', () => {
      expect(getRegionFromColo('SJC')).toBe('us-west')
    })

    it('should return "us-east" for IAD', () => {
      expect(getRegionFromColo('IAD')).toBe('us-east')
    })

    it('should return "eu-west" for LHR', () => {
      expect(getRegionFromColo('LHR')).toBe('eu-west')
    })

    it('should return "asia-east" for NRT', () => {
      expect(getRegionFromColo('NRT')).toBe('asia-east')
    })

    it('should handle case-insensitive colo codes', () => {
      expect(getRegionFromColo('sjc')).toBe('us-west')
      expect(getRegionFromColo('iad')).toBe('us-east')
    })

    it('should return null for unknown colo', () => {
      expect(getRegionFromColo('XXX')).toBeNull()
    })
  })
})
