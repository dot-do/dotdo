import { describe, it, expect, beforeEach } from 'vitest'
import { createRelationshipsStore, type RelationshipsStore } from '../relationships'

describe('Relationships Store', () => {
  let store: RelationshipsStore

  beforeEach(() => {
    store = createRelationshipsStore()
  })

  describe('add', () => {
    it('should add a relationship', async () => {
      const rel = await store.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      expect(rel.subject).toBe('user-1')
      expect(rel.predicate).toBe('owns')
      expect(rel.object).toBe('order-1')
      expect(rel.$createdAt).toBeDefined()
    })

    it('should reject duplicate relationships', async () => {
      await store.add({ subject: 'a', predicate: 'b', object: 'c' })

      await expect(
        store.add({ subject: 'a', predicate: 'b', object: 'c' })
      ).rejects.toThrow('Relationship already exists')
    })
  })

  describe('remove', () => {
    it('should remove a relationship', async () => {
      await store.add({ subject: 'a', predicate: 'b', object: 'c' })
      await store.remove({ subject: 'a', predicate: 'b', object: 'c' })

      const found = await store.find({ subject: 'a' })
      expect(found).toHaveLength(0)
    })

    it('should throw for non-existent relationship', async () => {
      await expect(
        store.remove({ subject: 'x', predicate: 'y', object: 'z' })
      ).rejects.toThrow('Relationship not found')
    })
  })

  describe('find', () => {
    beforeEach(async () => {
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-2' })
      await store.add({ subject: 'user-2', predicate: 'owns', object: 'order-3' })
      await store.add({ subject: 'user-1', predicate: 'created', object: 'post-1' })
    })

    it('should find by subject', async () => {
      const found = await store.find({ subject: 'user-1' })
      expect(found).toHaveLength(3)
    })

    it('should find by predicate', async () => {
      const found = await store.find({ predicate: 'owns' })
      expect(found).toHaveLength(3)
    })

    it('should find by object', async () => {
      const found = await store.find({ object: 'order-1' })
      expect(found).toHaveLength(1)
    })

    it('should find by multiple criteria', async () => {
      const found = await store.find({ subject: 'user-1', predicate: 'owns' })
      expect(found).toHaveLength(2)
    })
  })

  describe('getRelated', () => {
    it('should get related object IDs', async () => {
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await store.add({ subject: 'user-1', predicate: 'owns', object: 'order-2' })

      const orders = await store.getRelated('user-1', 'owns')
      expect(orders).toEqual(['order-1', 'order-2'])
    })
  })

  describe('getRelatedTo', () => {
    it('should get related subject IDs (reverse lookup)', async () => {
      await store.add({ subject: 'user-1', predicate: 'likes', object: 'post-1' })
      await store.add({ subject: 'user-2', predicate: 'likes', object: 'post-1' })

      const likers = await store.getRelatedTo('post-1', 'likes')
      expect(likers).toEqual(['user-1', 'user-2'])
    })
  })
})
