import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import type { Thing } from '../../../db/things'
import type { Event } from '../../../db/events'
import type { Relationship } from '../../../db/relationships'

export const Route = createFileRoute('/admin/$')({
  component: AdminPortal,
})

type EntityType = 'things' | 'events' | 'relationships'
type ViewMode = 'list' | 'detail' | 'create'

interface AdminState {
  things: Thing[]
  events: Event[]
  relationships: Relationship[]
  selectedEntity: Thing | Event | Relationship | null
  loading: boolean
  error: string | null
}

function AdminPortal() {
  const params = useParams({ from: '/admin/$' })
  const navigate = useNavigate()
  const path = params['*'] || 'things'

  const [entityType, viewMode, entityId] = path.split('/') as [EntityType, ViewMode?, string?]

  const [state, setState] = useState<AdminState>({
    things: [],
    events: [],
    relationships: [],
    selectedEntity: null,
    loading: false,
    error: null,
  })

  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [websocket, setWebsocket] = useState<WebSocket | null>(null)

  // Connect WebSocket for real-time updates
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8787/admin/ws')

    ws.onopen = () => {
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        handleRealtimeUpdate(data)
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
    }

    setWebsocket(ws)

    return () => {
      ws.close()
    }
  }, [])

  // Load data
  useEffect(() => {
    loadData(entityType)
  }, [entityType])

  // Load detail view
  useEffect(() => {
    if (viewMode === 'detail' && entityId) {
      loadDetail(entityType, entityId)
    }
  }, [entityType, viewMode, entityId])

  const handleRealtimeUpdate = (data: { type: string; payload: unknown }) => {
    setState(prev => {
      switch (data.type) {
        case 'thing.created':
        case 'thing.updated':
          return {
            ...prev,
            things: prev.things.map(t =>
              t.$id === (data.payload as Thing).$id ? data.payload as Thing : t
            ).concat(
              prev.things.find(t => t.$id === (data.payload as Thing).$id)
                ? []
                : [data.payload as Thing]
            ),
          }
        case 'thing.deleted':
          return {
            ...prev,
            things: prev.things.filter(t => t.$id !== (data.payload as { $id: string }).$id),
          }
        case 'event.emitted':
          return {
            ...prev,
            events: [data.payload as Event, ...prev.events],
          }
        case 'relationship.added':
          return {
            ...prev,
            relationships: [...prev.relationships, data.payload as Relationship],
          }
        case 'relationship.removed':
          return {
            ...prev,
            relationships: prev.relationships.filter(r =>
              !(r.subject === (data.payload as Relationship).subject &&
                r.predicate === (data.payload as Relationship).predicate &&
                r.object === (data.payload as Relationship).object)
            ),
          }
        default:
          return prev
      }
    })
  }

  const loadData = async (type: EntityType) => {
    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const response = await fetch(`/api/admin/${type}`)
      if (!response.ok) throw new Error(`Failed to load ${type}`)

      const data = await response.json()
      setState(prev => ({
        ...prev,
        [type]: data,
        loading: false,
      }))
    } catch (e) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      }))
    }
  }

  const loadDetail = async (type: EntityType, id: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const response = await fetch(`/api/admin/${type}/${id}`)
      if (!response.ok) throw new Error(`Failed to load ${type} ${id}`)

      const data = await response.json()
      setState(prev => ({
        ...prev,
        selectedEntity: data,
        loading: false,
      }))
      setFormData(data)
    } catch (e) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      }))
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const response = await fetch(`/api/admin/${entityType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!response.ok) throw new Error(`Failed to create ${entityType}`)

      setFormData({})
      navigate({ to: `/admin/${entityType}` })
      await loadData(entityType)
    } catch (e) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      }))
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId) return

    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const response = await fetch(`/api/admin/${entityType}/${entityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!response.ok) throw new Error(`Failed to update ${entityType}`)

      navigate({ to: `/admin/${entityType}` })
      await loadData(entityType)
    } catch (e) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      }))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`Are you sure you want to delete this ${entityType.slice(0, -1)}?`)) return

    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const response = await fetch(`/api/admin/${entityType}/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error(`Failed to delete ${entityType}`)

      await loadData(entityType)
    } catch (e) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      }))
    }
  }

  return (
    <div className="container py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Admin Portal</h1>
        <p className="text-gray-600">Manage Things, Events, and Relationships</p>
      </div>

      {/* Error Display */}
      {state.error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
          {state.error}
        </div>
      )}

      {/* Entity Type Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="flex space-x-8">
          {(['things', 'events', 'relationships'] as const).map(type => (
            <button
              key={type}
              onClick={() => navigate({ to: `/admin/${type}` })}
              className={`pb-4 px-2 font-medium transition-colors ${
                entityType === type
                  ? 'border-b-2 border-primary-600 text-primary-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Loading State */}
      {state.loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading...</div>
        </div>
      )}

      {/* Content Area */}
      {!state.loading && (
        <>
          {/* List View */}
          {(!viewMode || viewMode === 'list') && (
            <div>
              <div className="mb-6 flex justify-between items-center">
                <h2 className="text-2xl font-semibold">
                  {entityType.charAt(0).toUpperCase() + entityType.slice(1)}
                </h2>
                {entityType !== 'events' && (
                  <button
                    onClick={() => {
                      setFormData({})
                      navigate({ to: `/admin/${entityType}/create` })
                    }}
                    className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 transition-colors"
                  >
                    Create New
                  </button>
                )}
              </div>

              {entityType === 'things' && <ThingsList things={state.things} onDelete={handleDelete} />}
              {entityType === 'events' && <EventsList events={state.events} />}
              {entityType === 'relationships' && (
                <RelationshipsList
                  relationships={state.relationships}
                  onDelete={(rel) => handleDelete(`${rel.subject}/${rel.predicate}/${rel.object}`)}
                />
              )}
            </div>
          )}

          {/* Create View */}
          {viewMode === 'create' && (
            <div>
              <div className="mb-6">
                <button
                  onClick={() => navigate({ to: `/admin/${entityType}` })}
                  className="text-primary-600 hover:text-primary-700"
                >
                  ← Back to list
                </button>
              </div>

              <h2 className="text-2xl font-semibold mb-6">
                Create {entityType.slice(0, -1).charAt(0).toUpperCase() + entityType.slice(1, -1)}
              </h2>

              {entityType === 'things' && (
                <ThingForm data={formData} onChange={setFormData} onSubmit={handleCreate} />
              )}
              {entityType === 'relationships' && (
                <RelationshipForm data={formData} onChange={setFormData} onSubmit={handleCreate} />
              )}
            </div>
          )}

          {/* Detail/Edit View */}
          {viewMode === 'detail' && entityId && state.selectedEntity && (
            <div>
              <div className="mb-6">
                <button
                  onClick={() => navigate({ to: `/admin/${entityType}` })}
                  className="text-primary-600 hover:text-primary-700"
                >
                  ← Back to list
                </button>
              </div>

              <h2 className="text-2xl font-semibold mb-6">
                Edit {entityType.slice(0, -1).charAt(0).toUpperCase() + entityType.slice(1, -1)}
              </h2>

              {entityType === 'things' && (
                <ThingForm data={formData} onChange={setFormData} onSubmit={handleUpdate} isEdit />
              )}
              {entityType === 'relationships' && (
                <RelationshipForm data={formData} onChange={setFormData} onSubmit={handleUpdate} isEdit />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// List Components

function ThingsList({ things, onDelete }: { things: Thing[]; onDelete: (id: string) => void }) {
  const navigate = useNavigate()

  if (things.length === 0) {
    return <div className="text-gray-500 py-8 text-center">No things found</div>
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {things.map(thing => (
            <tr key={thing.$id} className="hover:bg-gray-50">
              <td className="px-6 py-4 text-sm font-mono text-gray-900">{thing.$id}</td>
              <td className="px-6 py-4 text-sm text-gray-900">{thing.$type}</td>
              <td className="px-6 py-4 text-sm text-gray-500">
                {new Date(thing.$createdAt).toLocaleString()}
              </td>
              <td className="px-6 py-4 text-sm text-gray-500">
                {new Date(thing.$updatedAt).toLocaleString()}
              </td>
              <td className="px-6 py-4 text-sm text-right space-x-2">
                <button
                  onClick={() => navigate({ to: `/admin/things/detail/${thing.$id}` })}
                  className="text-primary-600 hover:text-primary-700"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(thing.$id)}
                  className="text-red-600 hover:text-red-700"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EventsList({ events }: { events: Event[] }) {
  if (events.length === 0) {
    return <div className="text-gray-500 py-8 text-center">No events found</div>
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payload</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {events.map(event => (
            <tr key={event.$id} className="hover:bg-gray-50">
              <td className="px-6 py-4 text-sm font-mono text-gray-900">{event.$id}</td>
              <td className="px-6 py-4 text-sm text-gray-900">{event.type}</td>
              <td className="px-6 py-4 text-sm text-gray-500">{event.source || 'N/A'}</td>
              <td className="px-6 py-4 text-sm text-gray-500">
                {new Date(event.$timestamp).toLocaleString()}
              </td>
              <td className="px-6 py-4 text-sm text-gray-500">
                <pre className="text-xs overflow-x-auto max-w-xs">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RelationshipsList({
  relationships,
  onDelete
}: {
  relationships: Relationship[]
  onDelete: (rel: Relationship) => void
}) {
  if (relationships.length === 0) {
    return <div className="text-gray-500 py-8 text-center">No relationships found</div>
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Predicate</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Object</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {relationships.map((rel, idx) => (
            <tr key={idx} className="hover:bg-gray-50">
              <td className="px-6 py-4 text-sm font-mono text-gray-900">{rel.subject}</td>
              <td className="px-6 py-4 text-sm text-gray-900">{rel.predicate}</td>
              <td className="px-6 py-4 text-sm font-mono text-gray-900">{rel.object}</td>
              <td className="px-6 py-4 text-sm text-gray-500">
                {new Date(rel.$createdAt).toLocaleString()}
              </td>
              <td className="px-6 py-4 text-sm text-right">
                <button
                  onClick={() => onDelete(rel)}
                  className="text-red-600 hover:text-red-700"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Form Components

function ThingForm({
  data,
  onChange,
  onSubmit,
  isEdit = false
}: {
  data: Record<string, unknown>
  onChange: (data: Record<string, unknown>) => void
  onSubmit: (e: React.FormEvent) => void
  isEdit?: boolean
}) {
  const handleFieldChange = (key: string, value: unknown) => {
    onChange({ ...data, [key]: value })
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Type
          </label>
          <input
            type="text"
            value={(data['$type'] as string) || ''}
            onChange={e => handleFieldChange('$type', e.target.value)}
            disabled={isEdit}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Additional Fields (JSON)
          </label>
          <textarea
            value={JSON.stringify(
              Object.fromEntries(
                Object.entries(data).filter(([k]) => !k.startsWith('$'))
              ),
              null,
              2
            )}
            onChange={e => {
              try {
                const parsed = JSON.parse(e.target.value)
                onChange({
                  ...Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith('$'))),
                  ...parsed
                })
              } catch {
                // Invalid JSON, ignore
              }
            }}
            rows={10}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
          />
          <p className="mt-1 text-sm text-gray-500">
            Enter additional fields as JSON object
          </p>
        </div>

        <div className="flex space-x-4">
          <button
            type="submit"
            className="bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 transition-colors"
          >
            {isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </form>
  )
}

function RelationshipForm({
  data,
  onChange,
  onSubmit,
  isEdit = false
}: {
  data: Record<string, unknown>
  onChange: (data: Record<string, unknown>) => void
  onSubmit: (e: React.FormEvent) => void
  isEdit?: boolean
}) {
  const handleFieldChange = (key: string, value: string) => {
    onChange({ ...data, [key]: value })
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Subject (Thing ID)
          </label>
          <input
            type="text"
            value={(data['subject'] as string) || ''}
            onChange={e => handleFieldChange('subject', e.target.value)}
            disabled={isEdit}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 font-mono"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Predicate (Relationship Type)
          </label>
          <input
            type="text"
            value={(data['predicate'] as string) || ''}
            onChange={e => handleFieldChange('predicate', e.target.value)}
            disabled={isEdit}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100"
            required
          />
          <p className="mt-1 text-sm text-gray-500">
            E.g., "owns", "created", "belongsTo"
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Object (Thing ID)
          </label>
          <input
            type="text"
            value={(data['object'] as string) || ''}
            onChange={e => handleFieldChange('object', e.target.value)}
            disabled={isEdit}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 font-mono"
            required
          />
        </div>

        <div className="flex space-x-4">
          <button
            type="submit"
            className="bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 transition-colors"
          >
            {isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </form>
  )
}
