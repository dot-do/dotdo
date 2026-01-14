/**
 * Config with Surfaces Example - Admin Component
 *
 * Administrative panel served at /admin.
 * Shows system settings, configuration status, and environment info.
 */

const styles = {
  container: {
    fontFamily: 'system-ui, sans-serif',
    minHeight: '100vh',
    display: 'flex',
    background: '#0a0a0a',
    color: '#fff',
  },
  sidebar: {
    width: '260px',
    background: '#0f0f0f',
    borderRight: '1px solid #1f1f1f',
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  sidebarTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    marginBottom: '2rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  sidebarSection: {
    marginBottom: '2rem',
  },
  sidebarLabel: {
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    color: '#525252',
    marginBottom: '0.75rem',
  },
  sidebarLink: {
    display: 'block',
    padding: '0.6rem 0.75rem',
    color: '#a1a1aa',
    textDecoration: 'none',
    borderRadius: '6px',
    fontSize: '0.875rem',
    marginBottom: '0.25rem',
    transition: 'background 0.2s, color 0.2s',
  },
  sidebarLinkActive: {
    background: 'rgba(239, 68, 68, 0.1)',
    color: '#ef4444',
  },
  main: {
    flex: 1,
    padding: '2rem',
    overflow: 'auto',
  },
  header: {
    marginBottom: '2rem',
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 700,
    marginBottom: '0.25rem',
  },
  subtitle: {
    color: '#525252',
  },
  configGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
    gap: '1.5rem',
    marginBottom: '2rem',
  },
  card: {
    background: '#111111',
    borderRadius: '12px',
    border: '1px solid #1f1f1f',
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '1rem 1.25rem',
    borderBottom: '1px solid #1f1f1f',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: '0.875rem',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  cardBody: {
    padding: '1.25rem',
  },
  configRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.6rem 0',
    borderBottom: '1px solid #1f1f1f',
  },
  configKey: {
    color: '#a1a1aa',
    fontSize: '0.875rem',
  },
  configValue: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.875rem',
    color: '#ef4444',
  },
  badge: {
    display: 'inline-block',
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 500,
  },
  envTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    textAlign: 'left' as const,
    padding: '0.75rem 1rem',
    background: '#0f0f0f',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#525252',
  },
  td: {
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #1f1f1f',
    fontSize: '0.875rem',
  },
} as const

export default function Admin() {
  const configSettings = {
    project: [
      { key: 'name', value: 'configured-app' },
      { key: 'entryPoint', value: './src/index.ts' },
      { key: 'port', value: '4000' },
      { key: 'persist', value: 'true' },
    ],
    cloudflare: [
      { key: 'compatibilityDate', value: '2024-01-01' },
      { key: 'compatibilityFlags', value: '[nodejs_compat]' },
    ],
    durableObjects: [
      { key: 'COUNTER', value: 'Counter' },
      { key: 'WORKSPACE', value: 'Workspace' },
    ],
  }

  const surfaces = [
    { name: 'app', path: '/app', file: './src/App.tsx', type: 'TSX' },
    { name: 'admin', path: '/admin', file: './src/Admin.tsx', type: 'TSX' },
    { name: 'site', path: '/', file: './src/Site.mdx', type: 'MDX', content: './content/site/' },
    { name: 'docs', path: '/docs', file: './src/Docs.mdx', type: 'MDX', content: './content/docs/' },
    { name: 'blog', path: '/blog', file: './src/Blog.mdx', type: 'MDX', content: './content/blog/' },
  ]

  const envVars = [
    { name: 'DOTDO_PORT', description: 'Override dev server port', default: '4000' },
    { name: 'DOTDO_HOST', description: 'Override dev server host', default: 'localhost' },
    { name: 'NODE_ENV', description: 'Environment mode', default: 'development' },
    { name: 'CLOUDFLARE_ACCOUNT_ID', description: 'Cloudflare account for deployment', default: '-' },
  ]

  return (
    <div style={styles.container}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTitle}>
          <span style={{ color: '#ef4444' }}>*</span>
          Admin Panel
        </div>

        <div style={styles.sidebarSection}>
          <div style={styles.sidebarLabel}>Configuration</div>
          <a href="/admin" style={{ ...styles.sidebarLink, ...styles.sidebarLinkActive }}>Overview</a>
          <a href="/admin/surfaces" style={styles.sidebarLink}>Surfaces</a>
          <a href="/admin/durable-objects" style={styles.sidebarLink}>Durable Objects</a>
          <a href="/admin/bindings" style={styles.sidebarLink}>Bindings</a>
        </div>

        <div style={styles.sidebarSection}>
          <div style={styles.sidebarLabel}>System</div>
          <a href="/admin/logs" style={styles.sidebarLink}>Logs</a>
          <a href="/admin/metrics" style={styles.sidebarLink}>Metrics</a>
          <a href="/admin/health" style={styles.sidebarLink}>Health Check</a>
        </div>

        <div style={{ marginTop: 'auto', paddingTop: '1.5rem', borderTop: '1px solid #1f1f1f' }}>
          <div style={styles.sidebarLabel}>Navigate</div>
          <a href="/" style={styles.sidebarLink}>Marketing Site</a>
          <a href="/app" style={styles.sidebarLink}>App Dashboard</a>
          <a href="/docs" style={styles.sidebarLink}>Documentation</a>
          <a href="/blog" style={styles.sidebarLink}>Blog</a>
        </div>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.title}>Configuration Overview</h1>
          <p style={styles.subtitle}>View and manage your do.config.ts settings</p>
        </header>

        <div style={styles.configGrid}>
          {/* Project Settings */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.cardTitle}>Project Settings</span>
              <span style={{ ...styles.badge, background: 'rgba(16, 185, 129, 0.2)', color: '#10b981' }}>Active</span>
            </div>
            <div style={styles.cardBody}>
              {configSettings.project.map((item, i) => (
                <div key={i} style={{ ...styles.configRow, ...(i === configSettings.project.length - 1 ? { borderBottom: 'none' } : {}) }}>
                  <span style={styles.configKey}>{item.key}</span>
                  <span style={styles.configValue}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Cloudflare Settings */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.cardTitle}>Cloudflare</span>
              <span style={{ ...styles.badge, background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>Workers</span>
            </div>
            <div style={styles.cardBody}>
              {configSettings.cloudflare.map((item, i) => (
                <div key={i} style={{ ...styles.configRow, ...(i === configSettings.cloudflare.length - 1 ? { borderBottom: 'none' } : {}) }}>
                  <span style={styles.configKey}>{item.key}</span>
                  <span style={styles.configValue}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Durable Objects */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.cardTitle}>Durable Objects</span>
              <span style={{ ...styles.badge, background: 'rgba(99, 102, 241, 0.2)', color: '#6366f1' }}>2 bound</span>
            </div>
            <div style={styles.cardBody}>
              {configSettings.durableObjects.map((item, i) => (
                <div key={i} style={{ ...styles.configRow, ...(i === configSettings.durableObjects.length - 1 ? { borderBottom: 'none' } : {}) }}>
                  <span style={styles.configKey}>{item.key}</span>
                  <span style={styles.configValue}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Surfaces Table */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardTitle}>Configured Surfaces</span>
            <span style={{ ...styles.badge, background: 'rgba(139, 92, 246, 0.2)', color: '#8b5cf6' }}>5 surfaces</span>
          </div>
          <table style={styles.envTable}>
            <thead>
              <tr>
                <th style={styles.th}>Surface</th>
                <th style={styles.th}>Path</th>
                <th style={styles.th}>File</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Content Dir</th>
              </tr>
            </thead>
            <tbody>
              {surfaces.map((surface, i) => (
                <tr key={i}>
                  <td style={styles.td}>
                    <span style={{ fontWeight: 600 }}>{surface.name}</span>
                  </td>
                  <td style={styles.td}>
                    <code style={{ color: '#ef4444' }}>{surface.path}</code>
                  </td>
                  <td style={styles.td}>
                    <code style={{ color: '#71717a' }}>{surface.file}</code>
                  </td>
                  <td style={styles.td}>
                    <span style={{
                      ...styles.badge,
                      background: surface.type === 'TSX' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                      color: surface.type === 'TSX' ? '#3b82f6' : '#eab308',
                    }}>
                      {surface.type}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {surface.content ? (
                      <code style={{ color: '#71717a' }}>{surface.content}</code>
                    ) : (
                      <span style={{ color: '#525252' }}>-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Environment Variables */}
        <div style={{ ...styles.card, marginTop: '1.5rem' }}>
          <div style={styles.cardHeader}>
            <span style={styles.cardTitle}>Environment Overrides</span>
            <span style={{ color: '#525252', fontSize: '0.75rem' }}>Set these to override do.config.ts</span>
          </div>
          <table style={styles.envTable}>
            <thead>
              <tr>
                <th style={styles.th}>Variable</th>
                <th style={styles.th}>Description</th>
                <th style={styles.th}>Default</th>
              </tr>
            </thead>
            <tbody>
              {envVars.map((envVar, i) => (
                <tr key={i}>
                  <td style={styles.td}>
                    <code style={{ color: '#ef4444' }}>{envVar.name}</code>
                  </td>
                  <td style={{ ...styles.td, color: '#a1a1aa' }}>{envVar.description}</td>
                  <td style={styles.td}>
                    <code style={{ color: '#71717a' }}>{envVar.default}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
