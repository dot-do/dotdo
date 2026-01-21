# REST CRUD API Example

A complete RESTful API demonstrating CRUD operations with filtering, pagination, and relationships using dotdo Durable Objects.

## Features

This example demonstrates:

- **Full CRUD Operations**: Create, Read, Update, Delete for tasks, projects, and users
- **HATEOAS Links**: Self-describing API with hypermedia links
- **Filtering & Search**: Query parameters for filtering results
- **Pagination**: Offset-based pagination with navigation links
- **Relationships**: Projects contain tasks, users assigned to tasks
- **Bulk Operations**: Update multiple resources in one request
- **Proper HTTP Status Codes**: 200, 201, 204, 400, 404, 409

## Key dotdo Concepts

### Entity Management with things

```typescript
// Create
const task = await this.things.create({
  $type: 'Task',
  title: 'Build feature',
  status: 'pending',
  priority: 'high',
  createdAt: new Date().toISOString(),
})

// Read
const task = await this.things.get(taskId)

// Update (partial)
await this.things.update(taskId, { status: 'completed' })

// Delete
await this.things.delete(taskId)

// List with filtering
const tasks = await this.things.list({ type: 'Task' })
```

### Relationships

```typescript
// Add task to project
await this.relationships.add({
  subject: projectId,
  predicate: 'contains',
  object: taskId,
})

// Get tasks in project
const taskIds = await this.relationships.getRelated(projectId, 'contains')

// Get project containing task
const projectIds = await this.relationships.getSubjects(taskId, 'contains')

// Remove relationship
await this.relationships.remove({
  subject: projectId,
  predicate: 'contains',
  object: taskId,
})
```

### Event Handling

```typescript
// Track entity lifecycle events
this.$.on.Task.created(async (event) => {
  console.log(`Task created: ${event.payload.taskId}`)
})

this.$.on.Task.completed(async (event) => {
  // Send notification, update metrics, etc.
})

// Fire events from handlers
this.$.send({
  type: 'Task.created',
  payload: { taskId, title },
})
```

## API Endpoints

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List tasks with filtering/pagination |
| POST | `/tasks` | Create a new task |
| GET | `/tasks/:id` | Get a single task |
| PATCH | `/tasks/:id` | Partial update (specific fields) |
| PUT | `/tasks/:id` | Full replacement |
| DELETE | `/tasks/:id` | Delete a task |
| PATCH | `/tasks` | Bulk update multiple tasks |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | `/projects` | List all projects |
| POST | `/projects` | Create a new project |
| GET | `/projects/:id` | Get a single project |
| DELETE | `/projects/:id` | Delete a project |
| GET | `/projects/:id/tasks` | Get tasks in project |
| POST | `/projects/:id/tasks` | Create task in project |

### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | `/users` | List all users |
| POST | `/users` | Create a new user |
| GET | `/users/:id` | Get a single user |
| GET | `/users/:id/tasks` | Get tasks assigned to user |

### Statistics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/stats` | Get aggregated statistics |

## Query Parameters

### Filtering Tasks

```
GET /tasks?status=pending
GET /tasks?priority=high
GET /tasks?assigneeId=user-123
GET /tasks?projectId=project-456
GET /tasks?tag=urgent
GET /tasks?search=feature
```

### Pagination

```
GET /tasks?limit=20&offset=0
GET /tasks?limit=50&offset=100
```

## Usage Examples

### Create a Project and Tasks

```bash
# Create a project
curl -X POST http://localhost:8790/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Website Redesign", "color": "#3B82F6"}'

# Create a task in the project
curl -X POST http://localhost:8790/projects/{projectId}/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Design mockups",
    "description": "Create Figma mockups for new homepage",
    "priority": "high",
    "dueDate": "2024-02-01"
  }'
```

### List Tasks with Filters

```bash
# Get all pending high-priority tasks
curl "http://localhost:8790/tasks?status=pending&priority=high"

# Search tasks
curl "http://localhost:8790/tasks?search=mockup"

# Paginate through results
curl "http://localhost:8790/tasks?limit=10&offset=0"
curl "http://localhost:8790/tasks?limit=10&offset=10"
```

### Update Tasks

```bash
# Partial update - only change status
curl -X PATCH http://localhost:8790/tasks/{taskId} \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'

# Bulk update - mark multiple tasks complete
curl -X PATCH http://localhost:8790/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "ids": ["task-1", "task-2", "task-3"],
    "update": {"status": "completed"}
  }'
```

### Delete a Task

```bash
curl -X DELETE http://localhost:8790/tasks/{taskId}
# Returns 204 No Content
```

### Get Statistics

```bash
curl http://localhost:8790/stats
```

Response:
```json
{
  "tasks": {
    "total": 42,
    "byStatus": {
      "pending": 15,
      "in_progress": 10,
      "completed": 15,
      "cancelled": 2
    },
    "byPriority": {
      "high": 8,
      "medium": 25,
      "low": 9
    },
    "dueToday": 3,
    "overdue": 5
  },
  "projects": {
    "total": 5,
    "active": 4
  },
  "users": {
    "total": 8
  }
}
```

## HATEOAS Response Format

All responses include `_links` for discoverability:

```json
{
  "$id": "task-abc123",
  "$type": "Task",
  "title": "Design mockups",
  "status": "pending",
  "priority": "high",
  "_links": {
    "self": { "href": "/tasks/task-abc123" },
    "update": { "href": "/tasks/task-abc123", "method": "PATCH" },
    "delete": { "href": "/tasks/task-abc123", "method": "DELETE" },
    "project": { "href": "/projects/proj-xyz789" }
  }
}
```

List responses include pagination links:

```json
{
  "data": [...],
  "pagination": {
    "total": 42,
    "limit": 20,
    "offset": 20,
    "hasMore": true
  },
  "_links": {
    "self": { "href": "/tasks?limit=20&offset=20" },
    "prev": { "href": "/tasks?limit=20&offset=0" },
    "next": { "href": "/tasks?limit=20&offset=40" }
  }
}
```

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Project Structure

```
examples/rest-crud/
  TasksDO.ts          # Main Durable Object implementation
  types.ts            # TypeScript type definitions
  index.ts            # Worker entrypoint
  wrangler.jsonc      # Cloudflare configuration
  package.json        # Package configuration
  README.md           # This file
```

## Architecture

```
HTTP Request (GET /tasks?status=pending)
         |
         v
+---------------------+
|   Worker (index)    |
|   Route by tenant   |
+---------------------+
         |
         v
+---------------------+
|      TasksDO        |
|  - things           |  <-- Task, Project, User entities
|  - relationships    |  <-- Project contains Task
|  - events           |  <-- Task.created, Task.completed
+---------------------+
         |
         v
+---------------------+
|   SQLite Storage    |
+---------------------+
```

## HTTP Status Codes Used

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful GET, PATCH, PUT |
| 201 | Created | Successful POST (new resource) |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Validation errors |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource (e.g., email) |

## Extending the API

### Add a New Entity Type

```typescript
// 1. Define the type in types.ts
export interface Label {
  $type: 'Label'
  name: string
  color: string
}

// 2. Add routes in TasksDO.ts
app.get('/labels', async (c) => {
  const labels = await this.things.list({ type: 'Label' })
  return c.json({ data: labels })
})

app.post('/labels', async (c) => {
  const body = await c.req.json<{ name: string; color: string }>()
  const label = await this.things.create({
    $type: 'Label',
    name: body.name,
    color: body.color,
  })
  return c.json(label, 201)
})
```

### Add a New Relationship

```typescript
// Add label to task
app.post('/tasks/:taskId/labels/:labelId', async (c) => {
  await this.relationships.add({
    subject: c.req.param('taskId'),
    predicate: 'has_label',
    object: c.req.param('labelId'),
  })
  return c.json({ success: true })
})
```
