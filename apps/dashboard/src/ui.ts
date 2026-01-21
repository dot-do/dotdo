/**
 * Dashboard UI
 *
 * Simple HTML/CSS admin interface for monitoring Durable Objects
 */

export function renderDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>dotdo Operator Dashboard</title>
  <style>
    :root {
      --bg-primary: #0f1419;
      --bg-secondary: #1a1f2e;
      --bg-tertiary: #252b3b;
      --text-primary: #e7e9ea;
      --text-secondary: #8b98a5;
      --accent-primary: #1d9bf0;
      --accent-success: #00ba7c;
      --accent-warning: #ffad1f;
      --accent-error: #f4212e;
      --border-color: #2f3336;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.5;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 0;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 20px;
    }

    h1 {
      font-size: 24px;
      font-weight: 600;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
    }

    .status-healthy { background: rgba(0, 186, 124, 0.15); color: var(--accent-success); }
    .status-degraded { background: rgba(255, 173, 31, 0.15); color: var(--accent-warning); }
    .status-unhealthy { background: rgba(244, 33, 46, 0.15); color: var(--accent-error); }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .metric-card {
      background: var(--bg-secondary);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid var(--border-color);
    }

    .metric-label {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    .metric-value {
      font-size: 28px;
      font-weight: 600;
    }

    .metric-change {
      font-size: 12px;
      margin-top: 4px;
    }

    .metric-change.positive { color: var(--accent-success); }
    .metric-change.negative { color: var(--accent-error); }

    .section {
      background: var(--bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      margin-bottom: 20px;
      overflow: hidden;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
    }

    .section-title {
      font-size: 16px;
      font-weight: 600;
    }

    .section-content {
      padding: 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 12px 20px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }

    th {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover {
      background: var(--bg-tertiary);
    }

    .do-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
    }

    .do-status.active { color: var(--accent-success); }
    .do-status.inactive { color: var(--text-secondary); }
    .do-status.unknown { color: var(--accent-warning); }

    .event-type {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      background: var(--bg-tertiary);
      padding: 2px 8px;
      border-radius: 4px;
    }

    .event-status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 4px;
    }

    .event-status.completed { background: rgba(0, 186, 124, 0.15); color: var(--accent-success); }
    .event-status.pending { background: rgba(29, 155, 240, 0.15); color: var(--accent-primary); }
    .event-status.failed { background: rgba(244, 33, 46, 0.15); color: var(--accent-error); }

    .time-ago {
      color: var(--text-secondary);
      font-size: 13px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      border: none;
      cursor: pointer;
      transition: background 0.2s;
    }

    .btn-primary {
      background: var(--accent-primary);
      color: white;
    }

    .btn-primary:hover {
      background: #1a8cd8;
    }

    .btn-secondary {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    .btn-secondary:hover {
      background: #323d4d;
    }

    .chart-container {
      padding: 20px;
      height: 200px;
      display: flex;
      align-items: flex-end;
      gap: 4px;
    }

    .chart-bar {
      flex: 1;
      background: var(--accent-primary);
      border-radius: 4px 4px 0 0;
      min-height: 4px;
      transition: height 0.3s ease;
      position: relative;
    }

    .chart-bar:hover {
      background: #1a8cd8;
    }

    .chart-bar.error {
      background: var(--accent-error);
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-secondary);
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .tabs {
      display: flex;
      gap: 8px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-color);
    }

    .tab {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
      background: transparent;
      border: none;
      color: var(--text-secondary);
    }

    .tab:hover {
      background: var(--bg-tertiary);
    }

    .tab.active {
      background: var(--accent-primary);
      color: white;
    }

    .inspect-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: 500px;
      height: 100vh;
      background: var(--bg-secondary);
      border-left: 1px solid var(--border-color);
      transform: translateX(100%);
      transition: transform 0.3s ease;
      z-index: 1000;
      overflow-y: auto;
    }

    .inspect-panel.open {
      transform: translateX(0);
    }

    .inspect-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px;
      border-bottom: 1px solid var(--border-color);
      position: sticky;
      top: 0;
      background: var(--bg-secondary);
    }

    .inspect-close {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 24px;
      cursor: pointer;
    }

    .inspect-content {
      padding: 20px;
    }

    .inspect-section {
      margin-bottom: 24px;
    }

    .inspect-section h4 {
      font-size: 13px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    .inspect-field {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-color);
    }

    .inspect-field-label {
      color: var(--text-secondary);
      font-size: 14px;
    }

    .inspect-field-value {
      font-size: 14px;
      font-family: 'SF Mono', Monaco, monospace;
    }

    .refresh-indicator {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .refresh-indicator.loading {
      color: var(--accent-primary);
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .spinner {
      animation: spin 1s linear infinite;
    }

    .clickable {
      cursor: pointer;
    }

    .clickable:hover {
      background: var(--bg-tertiary);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>dotdo Operator Dashboard</h1>
      <div style="display: flex; align-items: center; gap: 16px;">
        <span class="refresh-indicator" id="refreshIndicator">
          <span id="refreshIcon">&#x21bb;</span>
          Auto-refresh: <span id="refreshStatus">5s</span>
        </span>
        <span class="status-badge status-healthy" id="systemStatus">
          <span class="status-dot"></span>
          <span id="statusText">Healthy</span>
        </span>
      </div>
    </header>

    <div class="metrics-grid" id="metricsGrid">
      <div class="metric-card">
        <div class="metric-label">Active DOs</div>
        <div class="metric-value" id="activeDOs">-</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Requests</div>
        <div class="metric-value" id="totalRequests">-</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Error Rate</div>
        <div class="metric-value" id="errorRate">-</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Events (1h)</div>
        <div class="metric-value" id="recentEvents">-</div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <span class="section-title">Request Rate (Last Hour)</span>
        <button class="btn btn-secondary" onclick="refreshTimeseries()">Refresh</button>
      </div>
      <div class="chart-container" id="requestChart">
        <div class="empty-state">Loading chart data...</div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <span class="section-title">Durable Objects</span>
        <button class="btn btn-secondary" onclick="refreshDOs()">Refresh</button>
      </div>
      <div class="section-content">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Class</th>
              <th>Status</th>
              <th>Last Seen</th>
              <th>Requests</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody id="dosTable">
            <tr>
              <td colspan="6" class="empty-state">Loading Durable Objects...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <span class="section-title">Recent Events</span>
        <div style="display: flex; gap: 8px;">
          <select id="eventFilter" onchange="refreshEvents()" style="padding: 8px 12px; border-radius: 8px; background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary);">
            <option value="">All Events</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
          <button class="btn btn-secondary" onclick="refreshEvents()">Refresh</button>
        </div>
      </div>
      <div class="section-content">
        <table>
          <thead>
            <tr>
              <th>DO</th>
              <th>Type</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody id="eventsTable">
            <tr>
              <td colspan="5" class="empty-state">Loading events...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Inspect Panel -->
  <div class="inspect-panel" id="inspectPanel">
    <div class="inspect-header">
      <h3 id="inspectTitle">DO Details</h3>
      <button class="inspect-close" onclick="closeInspect()">&times;</button>
    </div>
    <div class="inspect-content" id="inspectContent">
      Loading...
    </div>
  </div>

  <script>
    const API_BASE = '/api';
    let refreshInterval;

    // Security: HTML escape function to prevent XSS
    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      const div = document.createElement('div');
      div.textContent = String(str);
      return div.innerHTML;
    }

    // Security: Escape for use in HTML attributes (more strict)
    function escapeAttr(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // Utility functions
    function formatNumber(num) {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
      return num.toString();
    }

    function timeAgo(timestamp) {
      const seconds = Math.floor((Date.now() - timestamp) / 1000);
      if (seconds < 60) return seconds + 's ago';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      return Math.floor(seconds / 86400) + 'd ago';
    }

    // API calls
    async function fetchHealth() {
      try {
        const res = await fetch(API_BASE + '/health');
        const data = await res.json();

        // Update status badge
        const statusBadge = document.getElementById('systemStatus');
        const statusText = document.getElementById('statusText');
        statusBadge.className = 'status-badge status-' + data.status;
        statusText.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);

        // Update metrics
        document.getElementById('activeDOs').textContent = data.dos.active;
        document.getElementById('totalRequests').textContent = formatNumber(data.metrics.totalRequests);
        document.getElementById('errorRate').textContent = data.metrics.errorRate;
        document.getElementById('recentEvents').textContent = data.events.lastHour;
      } catch (err) {
        console.error('Failed to fetch health:', err);
      }
    }

    async function refreshDOs() {
      try {
        const res = await fetch(API_BASE + '/dos');
        const data = await res.json();

        const tbody = document.getElementById('dosTable');

        if (data.dos.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No Durable Objects registered yet</td></tr>';
          return;
        }

        tbody.innerHTML = data.dos.map(doObj => {
          const statusClass = doObj.status === 'active' ? 'active' :
                             doObj.status === 'inactive' ? 'inactive' : 'unknown';
          return \`
            <tr class="clickable" onclick="inspectDO('\${escapeAttr(doObj.id)}')">
              <td><strong>\${escapeHtml(doObj.name)}</strong></td>
              <td>\${escapeHtml(doObj.className)}</td>
              <td>
                <span class="do-status \${escapeAttr(statusClass)}">
                  <span class="status-dot"></span>
                  \${escapeHtml(doObj.status)}
                </span>
              </td>
              <td class="time-ago">\${timeAgo(doObj.lastSeen)}</td>
              <td>-</td>
              <td>-</td>
            </tr>
          \`;
        }).join('');
      } catch (err) {
        console.error('Failed to fetch DOs:', err);
      }
    }

    async function refreshEvents() {
      try {
        const filter = document.getElementById('eventFilter').value;
        const url = filter ? API_BASE + '/events?status=' + filter : API_BASE + '/events';
        const res = await fetch(url);
        const data = await res.json();

        const tbody = document.getElementById('eventsTable');

        if (data.events.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No events recorded yet</td></tr>';
          return;
        }

        tbody.innerHTML = data.events.map(event => \`
          <tr>
            <td>\${escapeHtml(event.doName)}</td>
            <td><span class="event-type">\${escapeHtml(event.type)}</span></td>
            <td><span class="event-status \${escapeAttr(event.status)}">\${escapeHtml(event.status)}</span></td>
            <td>\${event.duration ? escapeHtml(event.duration) + 'ms' : '-'}</td>
            <td class="time-ago">\${timeAgo(event.timestamp)}</td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('Failed to fetch events:', err);
      }
    }

    async function refreshTimeseries() {
      try {
        const res = await fetch(API_BASE + '/metrics/timeseries?hours=1');
        const data = await res.json();

        const container = document.getElementById('requestChart');

        if (data.timeseries.length === 0) {
          container.innerHTML = '<div class="empty-state">No metrics data yet</div>';
          return;
        }

        const maxRequests = Math.max(...data.timeseries.map(t => t.requests), 1);

        container.innerHTML = data.timeseries.map(bucket => {
          const height = Math.max(4, (bucket.requests / maxRequests) * 160);
          const errorHeight = bucket.errors > 0 ? Math.max(4, (bucket.errors / maxRequests) * 160) : 0;
          const time = new Date(bucket.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return \`
            <div class="chart-bar" style="height: \${height}px" title="\${escapeAttr(time)}: \${escapeAttr(bucket.requests)} requests">
              \${errorHeight > 0 ? \`<div class="chart-bar error" style="height: \${errorHeight}px; position: absolute; bottom: 0; left: 0; right: 0;"></div>\` : ''}
            </div>
          \`;
        }).join('');
      } catch (err) {
        console.error('Failed to fetch timeseries:', err);
      }
    }

    async function inspectDO(doId) {
      const panel = document.getElementById('inspectPanel');
      const content = document.getElementById('inspectContent');
      const title = document.getElementById('inspectTitle');

      panel.classList.add('open');
      content.innerHTML = 'Loading...';

      try {
        const res = await fetch(API_BASE + '/inspect/' + doId);
        const data = await res.json();

        title.textContent = data.registration.name;

        content.innerHTML = \`
          <div class="inspect-section">
            <h4>Registration</h4>
            <div class="inspect-field">
              <span class="inspect-field-label">ID</span>
              <span class="inspect-field-value">\${escapeHtml(doId)}</span>
            </div>
            <div class="inspect-field">
              <span class="inspect-field-label">Class</span>
              <span class="inspect-field-value">\${escapeHtml(data.registration.className)}</span>
            </div>
            <div class="inspect-field">
              <span class="inspect-field-label">Namespace</span>
              <span class="inspect-field-value">\${escapeHtml(data.registration.namespace)}</span>
            </div>
            <div class="inspect-field">
              <span class="inspect-field-label">Status</span>
              <span class="inspect-field-value">\${escapeHtml(data.registration.status)}</span>
            </div>
            <div class="inspect-field">
              <span class="inspect-field-label">Registered</span>
              <span class="inspect-field-value">\${escapeHtml(new Date(data.registration.registeredAt).toLocaleString())}</span>
            </div>
            <div class="inspect-field">
              <span class="inspect-field-label">Last Seen</span>
              <span class="inspect-field-value">\${timeAgo(data.registration.lastSeen)}</span>
            </div>
          </div>

          \${data.metrics ? \`
          <div class="inspect-section">
            <h4>Metrics</h4>
            <div class="inspect-field">
              <span class="inspect-field-label">Total Requests</span>
              <span class="inspect-field-value">\${formatNumber(data.metrics.requestCount)}</span>
            </div>
            <div class="inspect-field">
              <span class="inspect-field-label">Errors</span>
              <span class="inspect-field-value">\${formatNumber(data.metrics.errorCount)}</span>
            </div>
            <div class="inspect-field">
              <span class="inspect-field-label">Error Rate</span>
              <span class="inspect-field-value">\${escapeHtml(data.metrics.errorRate)}</span>
            </div>
            <div class="inspect-field">
              <span class="inspect-field-label">Avg Response Time</span>
              <span class="inspect-field-value">\${data.metrics.avgResponseTime.toFixed(2)}ms</span>
            </div>
          </div>
          \` : ''}

          <div class="inspect-section">
            <h4>Recent Events (\${data.recentEvents.length})</h4>
            \${data.recentEvents.length === 0 ? '<p style="color: var(--text-secondary)">No recent events</p>' :
              data.recentEvents.slice(0, 10).map(event => \`
                <div style="padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="event-type">\${escapeHtml(event.type)}</span>
                    <span class="event-status \${escapeAttr(event.status)}">\${escapeHtml(event.status)}</span>
                  </div>
                  <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                    \${timeAgo(event.timestamp)}\${event.duration ? ' | ' + event.duration + 'ms' : ''}
                    \${event.error ? '<br><span style="color: var(--accent-error)">' + escapeHtml(event.error) + '</span>' : ''}
                  </div>
                </div>
              \`).join('')
            }
          </div>

          \${data.registration.metadata ? \`
          <div class="inspect-section">
            <h4>Metadata</h4>
            <pre style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px;">\${escapeHtml(JSON.stringify(data.registration.metadata, null, 2))}</pre>
          </div>
          \` : ''}
        \`;
      } catch (err) {
        content.innerHTML = '<div class="empty-state">Failed to load DO details</div>';
        console.error('Failed to inspect DO:', err);
      }
    }

    function closeInspect() {
      document.getElementById('inspectPanel').classList.remove('open');
    }

    // Initialize
    async function init() {
      await fetchHealth();
      await refreshDOs();
      await refreshEvents();
      await refreshTimeseries();

      // Auto-refresh every 5 seconds
      refreshInterval = setInterval(async () => {
        const indicator = document.getElementById('refreshIndicator');
        const icon = document.getElementById('refreshIcon');
        indicator.classList.add('loading');
        icon.classList.add('spinner');

        await fetchHealth();
        await refreshDOs();
        await refreshEvents();

        indicator.classList.remove('loading');
        icon.classList.remove('spinner');
      }, 5000);
    }

    // Close inspect panel on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeInspect();
    });

    // Click outside inspect panel to close
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('inspectPanel');
      const isClickInside = panel.contains(e.target) || e.target.closest('.clickable');
      if (!isClickInside && panel.classList.contains('open')) {
        closeInspect();
      }
    });

    init();
  </script>
</body>
</html>`;
}
