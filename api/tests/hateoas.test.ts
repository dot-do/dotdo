import { describe, it, expect } from 'vitest'
import {
  generateLinks,
  generateCollectionLinks,
  withLinks,
  withCollectionLinks
} from '../hateoas'
import { expectValidLink } from '../../test-utils'

describe('HATEOAS Link Generation', () => {
  const baseUrl = 'https://api.example.com'

  describe('generateLinks', () => {
    it('should generate standard CRUD links', () => {
      const links = generateLinks('users', '123', baseUrl)

      expectValidLink(links.self, 'self', 'GET')
      expect(links.self.href).toBe('https://api.example.com/users/123')
      expectValidLink(links.update, 'update', 'PUT')
      expect(links.update.href).toBe('https://api.example.com/users/123')
      expectValidLink(links.delete, 'delete', 'DELETE')
      expectValidLink(links.collection, 'collection', 'GET')
      expect(links.collection.href).toBe('https://api.example.com/users')
    })

    it('should include relation links', () => {
      const links = generateLinks('users', '123', baseUrl, {
        relations: {
          orders: { resource: 'orders', type: 'hasMany' },
          profile: { resource: 'profiles', type: 'hasOne' }
        }
      })

      expect(links.orders.href).toBe('https://api.example.com/users/123/orders')
      expect(links.profile.href).toBe('https://api.example.com/users/123/profile')
    })

    it('should include action links', () => {
      const links = generateLinks('users', '123', baseUrl, {
        actions: ['activate', 'deactivate']
      })

      expect(links.activate.href).toBe('https://api.example.com/users/123/activate')
      expect(links.activate.method).toBe('POST')
      expect(links.deactivate.href).toBe('https://api.example.com/users/123/deactivate')
    })
  })

  describe('generateCollectionLinks', () => {
    it('should generate basic collection links', () => {
      const links = generateCollectionLinks('users', baseUrl)

      expect(links.self.href).toContain('users')
      expect(links.create.href).toBe('https://api.example.com/users')
      expect(links.create.method).toBe('POST')
    })

    it('should include pagination links', () => {
      const links = generateCollectionLinks('users', baseUrl, {
        page: 2,
        limit: 10,
        total: 50
      })

      expect(links.prev.href).toContain('page=1')
      expect(links.next.href).toContain('page=3')
      expect(links.first.href).toContain('page=1')
      expect(links.last.href).toContain('page=5')
    })

    it('should not include prev on first page', () => {
      const links = generateCollectionLinks('users', baseUrl, {
        page: 1,
        limit: 10,
        total: 50
      })

      expect(links.prev).toBeUndefined()
      expect(links.next).toBeDefined()
    })

    it('should not include next on last page', () => {
      const links = generateCollectionLinks('users', baseUrl, {
        page: 5,
        limit: 10,
        total: 50
      })

      expect(links.prev).toBeDefined()
      expect(links.next).toBeUndefined()
    })
  })

  describe('withLinks', () => {
    it('should wrap data with links', () => {
      const data = { id: '123', name: 'Alice' }
      const links = generateLinks('users', '123', baseUrl)

      const result = withLinks(data, links)

      expect(result.data).toEqual(data)
      expect(result._links).toEqual(links)
    })
  })

  describe('withCollectionLinks', () => {
    it('should wrap collection items with individual links', () => {
      const items = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' }
      ]

      const result = withCollectionLinks(
        items,
        'users',
        baseUrl,
        (item) => item.id
      )

      expect(result.data).toHaveLength(2)
      expect(result.data[0]._links.self.href).toContain('/1')
      expect(result.data[1]._links.self.href).toContain('/2')
      expect(result._links.create).toBeDefined()
    })
  })
})
