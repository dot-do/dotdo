/**
 * Config with Surfaces Example - App Component
 *
 * Main application dashboard served at /app.
 * Configured explicitly in do.config.ts instead of auto-discovered.
 */

const styles = {
  container: {
    fontFamily: 'system-ui, sans-serif',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 100%)',
    color: '#fff',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 2rem',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    backdropFilter: 'blur(8px)',
    background: 'rgba(0,0,0,0.3)',
  },
  logo: {
    fontSize: '1.25rem',
    fontWeight: 700,
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  nav: {
    display: 'flex',
    gap: '1.5rem',
    alignItems: 'center',
  },
  navLink: {
    color: '#a1a1aa',
    textDecoration: 'none',
    fontSize: '0.875rem',
    transition: 'color 0.2s',
  },
  main: {
    padding: '2rem',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  welcomeCard: {
    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(139, 92, 246, 0.1) 100%)',
    borderRadius: '16px',
    padding: '2rem',
    marginBottom: '2rem',
    border: '1px solid rgba(99, 102, 241, 0.3)',
  },
  title: {
    fontSize: '2rem',
    marginBottom: '0.5rem',
    fontWeight: 700,
  },
  subtitle: {
    color: '#a1a1aa',
    fontSize: '1.1rem',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem',
  },
  statCard: {
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '12px',
    padding: '1.5rem',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: 700,
    color: '#8b5cf6',
  },
  statLabel: {
    color: '#71717a',
    fontSize: '0.875rem',
    marginTop: '0.25rem',
  },
  sectionTitle: {
    fontSize: '1.25rem',
    fontWeight: 600,
    marginBottom: '1rem',
    marginTop: '2rem',
  },
  projectGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '1.5rem',
  },
  projectCard: {
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '12px',
    padding: '1.5rem',
    border: '1px solid rgba(255,255,255,0.1)',
    transition: 'transform 0.2s, border-color 0.2s',
  },
  projectTitle: {
    fontSize: '1.125rem',
    fontWeight: 600,
    marginBottom: '0.5rem',
  },
  projectDescription: {
    color: '#a1a1aa',
    fontSize: '0.875rem',
    lineHeight: 1.6,
    marginBottom: '1rem',
  },
  badge: {
    display: 'inline-block',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 500,
  },
  codeBlock: {
    background: 'rgba(0,0,0,0.4)',
    borderRadius: '8px',
    padding: '1rem',
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.875rem',
    overflow: 'auto',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  configNote: {
    background: 'rgba(99, 102, 241, 0.1)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '8px',
    padding: '1rem',
    marginTop: '2rem',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
  },
} as const

export default function App() {
  const projects = [
    { name: 'API Gateway', description: 'Central routing and rate limiting for microservices', status: 'active', progress: 85 },
    { name: 'Dashboard v2', description: 'Redesigned analytics dashboard with real-time updates', status: 'active', progress: 62 },
    { name: 'Mobile SDK', description: 'Native iOS and Android SDK for partner integrations', status: 'in-review', progress: 45 },
    { name: 'Data Pipeline', description: 'ETL infrastructure for analytics and reporting', status: 'planning', progress: 15 },
  ]

  const stats = [
    { label: 'Active Projects', value: '12' },
    { label: 'Team Members', value: '8' },
    { label: 'Tasks Completed', value: '234' },
    { label: 'This Week', value: '+18' },
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return { background: 'rgba(16, 185, 129, 0.2)', color: '#10b981' }
      case 'in-review': return { background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }
      case 'planning': return { background: 'rgba(99, 102, 241, 0.2)', color: '#6366f1' }
      default: return { background: 'rgba(113, 113, 122, 0.2)', color: '#71717a' }
    }
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <span style={styles.logo}>ConfiguredApp</span>
        <nav style={styles.nav}>
          <a href="/app" style={{ ...styles.navLink, color: '#8b5cf6' }}>Dashboard</a>
          <a href="/app/projects" style={styles.navLink}>Projects</a>
          <a href="/app/team" style={styles.navLink}>Team</a>
          <a href="/admin" style={styles.navLink}>Admin</a>
          <a href="/docs" style={styles.navLink}>Docs</a>
          <a href="/" style={styles.navLink}>Home</a>
        </nav>
      </header>

      <main style={styles.main}>
        <div style={styles.welcomeCard}>
          <h1 style={styles.title}>Welcome to Your Workspace</h1>
          <p style={styles.subtitle}>
            This surface is configured explicitly in <code style={{ color: '#8b5cf6' }}>do.config.ts</code> rather than auto-discovered.
          </p>
        </div>

        <div style={styles.statsGrid}>
          {stats.map((stat, i) => (
            <div key={i} style={styles.statCard}>
              <div style={styles.statValue}>{stat.value}</div>
              <div style={styles.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        <h2 style={styles.sectionTitle}>Active Projects</h2>
        <div style={styles.projectGrid}>
          {projects.map((project, i) => (
            <div key={i} style={styles.projectCard}>
              <h3 style={styles.projectTitle}>{project.name}</h3>
              <p style={styles.projectDescription}>{project.description}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ ...styles.badge, ...getStatusColor(project.status) }}>
                  {project.status}
                </span>
                <span style={{ fontSize: '0.875rem', color: '#71717a' }}>
                  {project.progress}% complete
                </span>
              </div>
              <div style={{
                marginTop: '0.75rem',
                height: '4px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '2px',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${project.progress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                  borderRadius: '2px',
                }} />
              </div>
            </div>
          ))}
        </div>

        <h2 style={styles.sectionTitle}>API Endpoints</h2>
        <div style={styles.codeBlock}>
          <p style={{ color: '#71717a', marginBottom: '1rem' }}>Workspace Durable Object (from src/index.ts):</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <code style={{ color: '#10b981' }}>POST /Workspace/:id/createProject</code>
            <code style={{ color: '#10b981' }}>GET  /Workspace/:id/listProjects</code>
            <code style={{ color: '#10b981' }}>POST /Workspace/:id/createTask</code>
            <code style={{ color: '#10b981' }}>GET  /Workspace/:id/listTasks</code>
            <code style={{ color: '#10b981' }}>POST /Workspace/:id/addMember</code>
            <code style={{ color: '#10b981' }}>GET  /Workspace/:id/listMembers</code>
          </div>
        </div>

        <div style={styles.configNote}>
          <span style={{ fontSize: '1.25rem' }}>*</span>
          <div>
            <strong>Configuration Note:</strong> This app surface is defined at{' '}
            <code style={{ color: '#8b5cf6', background: 'rgba(0,0,0,0.3)', padding: '0.1rem 0.3rem', borderRadius: '4px' }}>
              surfaces.app: './src/App.tsx'
            </code>{' '}
            in do.config.ts, overriding the default auto-discovery behavior.
          </div>
        </div>
      </main>
    </div>
  )
}
