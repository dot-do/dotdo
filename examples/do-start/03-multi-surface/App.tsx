/**
 * Multi-Surface Example - App Component
 *
 * The main application dashboard, served at /app.
 * Demonstrates a full-featured app surface with routing.
 */

import { DO } from 'dotdo'

// ============================================================================
// Durable Object for App State
// ============================================================================

/**
 * Workspace Durable Object
 *
 * Manages workspace data with automatic REST endpoints.
 */
export class Workspace extends DO {
  static readonly $type = 'Workspace'

  async createProject(name: string, description?: string) {
    return this.things.create({
      $type: 'Project',
      name,
      description: description ?? '',
      status: 'active',
      createdAt: new Date().toISOString(),
    })
  }

  async listProjects() {
    return this.things.list({ $type: 'Project' })
  }

  async archiveProject(id: string) {
    return this.things.update(id, { status: 'archived' })
  }
}

// ============================================================================
// App Component
// ============================================================================

const styles = {
  container: {
    fontFamily: 'system-ui, sans-serif',
    minHeight: '100vh',
    background: '#0f0f0f',
    color: '#fff',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 2rem',
    borderBottom: '1px solid #2a2a2a',
    background: '#0a0a0a',
  },
  logo: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#10b981',
  },
  nav: {
    display: 'flex',
    gap: '1.5rem',
  },
  navLink: {
    color: '#a1a1aa',
    textDecoration: 'none',
    fontSize: '0.875rem',
  },
  main: {
    padding: '2rem',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  title: {
    fontSize: '2rem',
    marginBottom: '0.5rem',
  },
  subtitle: {
    color: '#71717a',
    marginBottom: '2rem',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '1.5rem',
  },
  card: {
    background: '#1a1a1a',
    borderRadius: '12px',
    padding: '1.5rem',
    border: '1px solid #2a2a2a',
  },
  cardTitle: {
    fontSize: '1.125rem',
    fontWeight: 600,
    marginBottom: '0.5rem',
  },
  cardDescription: {
    color: '#a1a1aa',
    fontSize: '0.875rem',
    lineHeight: 1.6,
  },
  badge: {
    display: 'inline-block',
    padding: '0.25rem 0.75rem',
    background: '#10b981',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    marginTop: '1rem',
  },
} as const

export default function App() {
  const projects = [
    { name: 'Marketing Site', description: 'Landing page and conversion funnel', status: 'active' },
    { name: 'API Gateway', description: 'Central routing for microservices', status: 'active' },
    { name: 'Mobile App', description: 'React Native customer app', status: 'in-review' },
    { name: 'Data Pipeline', description: 'ETL and analytics infrastructure', status: 'planning' },
  ]

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <span style={styles.logo}>Acme Workspace</span>
        <nav style={styles.nav}>
          <a href="/app" style={styles.navLink}>Dashboard</a>
          <a href="/app/projects" style={styles.navLink}>Projects</a>
          <a href="/app/settings" style={styles.navLink}>Settings</a>
          <a href="/admin" style={styles.navLink}>Admin</a>
        </nav>
      </header>

      <main style={styles.main}>
        <h1 style={styles.title}>Dashboard</h1>
        <p style={styles.subtitle}>Welcome back! Here's what's happening with your projects.</p>

        <div style={styles.grid}>
          {projects.map((project, i) => (
            <div key={i} style={styles.card}>
              <h3 style={styles.cardTitle}>{project.name}</h3>
              <p style={styles.cardDescription}>{project.description}</p>
              <span style={{
                ...styles.badge,
                background: project.status === 'active' ? '#10b981' :
                           project.status === 'in-review' ? '#f59e0b' : '#6366f1'
              }}>
                {project.status}
              </span>
            </div>
          ))}
        </div>

        <section style={{ marginTop: '3rem' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>API Reference</h2>
          <div style={{ ...styles.card, fontFamily: 'monospace', fontSize: '0.875rem' }}>
            <p style={{ color: '#a1a1aa', marginBottom: '1rem' }}>Workspace Durable Object endpoints:</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid #2a2a2a' }}>
                <code style={{ color: '#10b981' }}>GET /Workspace/:id</code> - Get workspace data
              </li>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid #2a2a2a' }}>
                <code style={{ color: '#10b981' }}>POST /Workspace/:id/createProject</code> - Create project
              </li>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid #2a2a2a' }}>
                <code style={{ color: '#10b981' }}>GET /Workspace/:id/listProjects</code> - List projects
              </li>
              <li style={{ padding: '0.5rem 0' }}>
                <code style={{ color: '#10b981' }}>POST /Workspace/:id/archiveProject</code> - Archive project
              </li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  )
}
