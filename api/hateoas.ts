// HATEOAS link generation - self-describing APIs

export interface Link {
  href: string
  rel: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  title?: string
}

export interface HATEOASResponse<T> {
  data: T
  _links: Record<string, Link>
}

export interface ResourceConfig {
  basePath: string
  actions?: string[]
  relations?: Record<string, { resource: string; type: 'hasOne' | 'hasMany' }>
}

// Generate links for a single resource
export function generateLinks(
  resource: string,
  id: string,
  baseUrl: string,
  config?: Partial<ResourceConfig>
): Record<string, Link> {
  const base = `${baseUrl}/${resource}`
  const links: Record<string, Link> = {
    self: {
      href: `${base}/${id}`,
      rel: 'self',
      method: 'GET',
      title: `Get ${resource}`
    },
    update: {
      href: `${base}/${id}`,
      rel: 'update',
      method: 'PUT',
      title: `Update ${resource}`
    },
    delete: {
      href: `${base}/${id}`,
      rel: 'delete',
      method: 'DELETE',
      title: `Delete ${resource}`
    },
    collection: {
      href: base,
      rel: 'collection',
      method: 'GET',
      title: `List all ${resource}`
    }
  }

  // Add relation links
  if (config?.relations) {
    for (const [name, _rel] of Object.entries(config.relations)) {
      links[name] = {
        href: `${base}/${id}/${name}`,
        rel: name,
        method: 'GET',
        title: `Get ${name} for ${resource}`
      }
    }
  }

  // Add custom action links
  if (config?.actions) {
    for (const action of config.actions) {
      links[action] = {
        href: `${base}/${id}/${action}`,
        rel: action,
        method: 'POST',
        title: `${action} ${resource}`
      }
    }
  }

  return links
}

// Generate links for a collection
export function generateCollectionLinks(
  resource: string,
  baseUrl: string,
  options?: { page?: number; limit?: number; total?: number }
): Record<string, Link> {
  const base = `${baseUrl}/${resource}`
  const { page = 1, limit = 20, total } = options || {}

  const links: Record<string, Link> = {
    self: {
      href: `${base}?page=${page}&limit=${limit}`,
      rel: 'self',
      method: 'GET'
    },
    create: {
      href: base,
      rel: 'create',
      method: 'POST',
      title: `Create ${resource}`
    }
  }

  // Pagination links
  if (page > 1) {
    links['prev'] = {
      href: `${base}?page=${page - 1}&limit=${limit}`,
      rel: 'prev',
      method: 'GET'
    }
    links['first'] = {
      href: `${base}?page=1&limit=${limit}`,
      rel: 'first',
      method: 'GET'
    }
  }

  if (total && page * limit < total) {
    links['next'] = {
      href: `${base}?page=${page + 1}&limit=${limit}`,
      rel: 'next',
      method: 'GET'
    }
    links['last'] = {
      href: `${base}?page=${Math.ceil(total / limit)}&limit=${limit}`,
      rel: 'last',
      method: 'GET'
    }
  }

  return links
}

// Wrap data with HATEOAS links
export function withLinks<T>(
  data: T,
  links: Record<string, Link>
): HATEOASResponse<T> {
  return { data, _links: links }
}

// Wrap collection with HATEOAS links
export function withCollectionLinks<T>(
  items: T[],
  resource: string,
  baseUrl: string,
  getId: (item: T) => string,
  options?: { page?: number; limit?: number; total?: number }
): HATEOASResponse<Array<T & { _links: Record<string, Link> }>> {
  const itemsWithLinks = items.map(item => ({
    ...item,
    _links: generateLinks(resource, getId(item), baseUrl)
  }))

  return {
    data: itemsWithLinks,
    _links: generateCollectionLinks(resource, baseUrl, options)
  }
}
