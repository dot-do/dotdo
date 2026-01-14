/**
 * Multi-Surface Example - Admin Component
 *
 * Administrative panel served at /admin.
 * Demonstrates a separate admin surface with its own styling.
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
    width: '240px',
    background: '#0f0f0f',
    borderRight: '1px solid #2a2a2a',
    padding: '1.5rem',
  },
  sidebarTitle: {
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    color: '#71717a',
    marginBottom: '1rem',
  },
  sidebarLink: {
    display: 'block',
    padding: '0.75rem 1rem',
    color: '#a1a1aa',
    textDecoration: 'none',
    borderRadius: '6px',
    marginBottom: '0.25rem',
    fontSize: '0.875rem',
  },
  sidebarLinkActive: {
    background: '#1a1a1a',
    color: '#fff',
  },
  main: {
    flex: 1,
    padding: '2rem',
  },
  header: {
    marginBottom: '2rem',
  },
  title: {
    fontSize: '1.75rem',
    marginBottom: '0.25rem',
  },
  subtitle: {
    color: '#71717a',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '1.5rem',
    marginBottom: '2rem',
  },
  statCard: {
    background: '#0f0f0f',
    borderRadius: '12px',
    padding: '1.5rem',
    border: '1px solid #2a2a2a',
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: 700,
    color: '#10b981',
  },
  statLabel: {
    color: '#71717a',
    fontSize: '0.875rem',
    marginTop: '0.25rem',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    background: '#0f0f0f',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid #2a2a2a',
  },
  th: {
    textAlign: 'left' as const,
    padding: '1rem',
    background: '#1a1a1a',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    color: '#71717a',
  },
  td: {
    padding: '1rem',
    borderBottom: '1px solid #2a2a2a',
  },
  badge: {
    display: 'inline-block',
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 500,
  },
} as const

export default function Admin() {
  const users = [
    { name: 'Alice Chen', email: 'alice@example.com', role: 'Admin', status: 'active', lastActive: '2 min ago' },
    { name: 'Bob Smith', email: 'bob@example.com', role: 'Editor', status: 'active', lastActive: '1 hour ago' },
    { name: 'Carol Davis', email: 'carol@example.com', role: 'Viewer', status: 'pending', lastActive: 'Never' },
    { name: 'Dan Wilson', email: 'dan@example.com', role: 'Editor', status: 'inactive', lastActive: '3 days ago' },
  ]

  const stats = [
    { label: 'Total Users', value: '1,234' },
    { label: 'Active Now', value: '89' },
    { label: 'API Requests', value: '45.2K' },
    { label: 'Error Rate', value: '0.02%' },
  ]

  return (
    <div style={styles.container}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTitle}>Admin Panel</div>
        <nav>
          <a href="/admin" style={{ ...styles.sidebarLink, ...styles.sidebarLinkActive }}>Dashboard</a>
          <a href="/admin/users" style={styles.sidebarLink}>Users</a>
          <a href="/admin/workspaces" style={styles.sidebarLink}>Workspaces</a>
          <a href="/admin/billing" style={styles.sidebarLink}>Billing</a>
          <a href="/admin/logs" style={styles.sidebarLink}>Audit Logs</a>
          <a href="/admin/settings" style={styles.sidebarLink}>Settings</a>
        </nav>

        <div style={{ ...styles.sidebarTitle, marginTop: '2rem' }}>Navigation</div>
        <a href="/" style={styles.sidebarLink}>Marketing Site</a>
        <a href="/app" style={styles.sidebarLink}>App Dashboard</a>
        <a href="/docs" style={styles.sidebarLink}>Documentation</a>
        <a href="/blog" style={styles.sidebarLink}>Blog</a>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.title}>Admin Dashboard</h1>
          <p style={styles.subtitle}>System overview and user management</p>
        </header>

        <div style={styles.statsGrid}>
          {stats.map((stat, i) => (
            <div key={i} style={styles.statCard}>
              <div style={styles.statValue}>{stat.value}</div>
              <div style={styles.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Recent Users</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Last Active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user, i) => (
              <tr key={i}>
                <td style={styles.td}>{user.name}</td>
                <td style={{ ...styles.td, color: '#71717a' }}>{user.email}</td>
                <td style={styles.td}>{user.role}</td>
                <td style={styles.td}>
                  <span style={{
                    ...styles.badge,
                    background: user.status === 'active' ? 'rgba(16, 185, 129, 0.2)' :
                               user.status === 'pending' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                    color: user.status === 'active' ? '#10b981' :
                           user.status === 'pending' ? '#f59e0b' : '#ef4444'
                  }}>
                    {user.status}
                  </span>
                </td>
                <td style={{ ...styles.td, color: '#71717a' }}>{user.lastActive}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  )
}
