// Relationships storage - subject-predicate-object triples

export interface Relationship {
  subject: string    // Thing $id
  predicate: string  // Verb (e.g., "owns", "created", "belongsTo")
  object: string     // Thing $id
  $createdAt: number
}

export interface RelationshipsStore {
  add(rel: Omit<Relationship, '$createdAt'>): Promise<Relationship>
  remove(rel: Pick<Relationship, 'subject' | 'predicate' | 'object'>): Promise<void>
  find(query: Partial<Pick<Relationship, 'subject' | 'predicate' | 'object'>>): Promise<Relationship[]>

  // Convenience methods
  getRelated(subjectId: string, predicate: string): Promise<string[]>
  getRelatedTo(objectId: string, predicate: string): Promise<string[]>
}

export function createRelationshipsStore(): RelationshipsStore {
  const relationships: Relationship[] = []

  const findIndex = (rel: Pick<Relationship, 'subject' | 'predicate' | 'object'>) => {
    return relationships.findIndex(
      r => r.subject === rel.subject &&
           r.predicate === rel.predicate &&
           r.object === rel.object
    )
  }

  return {
    async add(rel) {
      // Check for duplicate
      if (findIndex(rel) !== -1) {
        throw new Error('Relationship already exists')
      }

      const relationship: Relationship = {
        ...rel,
        $createdAt: Date.now()
      }

      relationships.push(relationship)
      return relationship
    },

    async remove(rel) {
      const index = findIndex(rel)
      if (index === -1) {
        throw new Error('Relationship not found')
      }
      relationships.splice(index, 1)
    },

    async find(query) {
      return relationships.filter(r => {
        if (query.subject && r.subject !== query.subject) return false
        if (query.predicate && r.predicate !== query.predicate) return false
        if (query.object && r.object !== query.object) return false
        return true
      })
    },

    async getRelated(subjectId, predicate) {
      const rels = await this.find({ subject: subjectId, predicate })
      return rels.map(r => r.object)
    },

    async getRelatedTo(objectId, predicate) {
      const rels = await this.find({ object: objectId, predicate })
      return rels.map(r => r.subject)
    }
  }
}
