/**
 * compat-pusher-realtime Worker Entry Point
 *
 * Pusher-compatible WebSocket realtime backed by Durable Objects.
 * No per-connection fees. Unlimited connections. Edge-native.
 *
 * Features:
 * - Public, private, and presence channels
 * - Client events on private/presence channels
 * - Presence member tracking (who's online)
 * - Hibernatable WebSocket connections
 * - Pusher protocol compatibility
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export the RealtimeDO class for Cloudflare to instantiate
export { RealtimeDO } from './RealtimeDO'

// ============================================================================
// TYPES
// ============================================================================

interface Env {
  REALTIME_DO: DurableObjectNamespace
  ENVIRONMENT?: string
  PUSHER_APP_ID?: string
  PUSHER_KEY?: string
  PUSHER_SECRET?: string
}

// ============================================================================
// HONO APP
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for demo access
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// ============================================================================
// LANDING PAGE
// ============================================================================

app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>@dotdo/pusher - Realtime Demo</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #3b82f6; --muted: #71717a; --success: #22c55e; --warning: #f59e0b; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; }
    h1 { color: var(--accent); margin-bottom: 0.25rem; }
    .tagline { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
    .subtitle { color: var(--muted); margin-bottom: 2rem; }
    code { background: #1f1f1f; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: #1f1f1f; padding: 1rem; border-radius: 8px; overflow-x: auto; }
    .demo-section { display: grid; gap: 1.5rem; margin: 2rem 0; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
    .demo-card { background: #1f1f1f; padding: 1.5rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .demo-card h3 { margin: 0 0 0.5rem 0; color: var(--accent); }
    .demo-card p { margin: 0 0 1rem 0; color: var(--muted); }
    button { background: var(--accent); color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.875rem; }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem; }
    .status.connected { background: var(--success); color: black; }
    .status.disconnected { background: var(--warning); color: black; }
    .log { background: #0f0f0f; padding: 1rem; border-radius: 4px; height: 150px; overflow-y: auto; font-family: monospace; font-size: 0.8rem; margin-top: 1rem; }
    .log-entry { padding: 0.25rem 0; border-bottom: 1px solid #222; }
    .log-entry.event { color: var(--success); }
    .log-entry.error { color: #ef4444; }
    .input-row { display: flex; gap: 0.5rem; margin-top: 1rem; }
    .input-row input { flex: 1; background: #0f0f0f; border: 1px solid #333; color: white; padding: 0.5rem; border-radius: 4px; }
    .presence-list { margin-top: 1rem; }
    .presence-member { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; background: #0f0f0f; border-radius: 4px; margin-bottom: 0.5rem; }
    .presence-dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; }
    a { color: var(--accent); }
    footer { margin-top: 3rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>@dotdo/pusher</h1>
  <p class="tagline">Pusher channels. Self-hosted. Unlimited connections.</p>
  <p class="subtitle">Real-time for everyone. No per-connection fees.</p>

  <div class="demo-section">
    <!-- Connection Status -->
    <div class="demo-card">
      <h3>Connection <span id="status" class="status disconnected">Disconnected</span></h3>
      <p>WebSocket connection to Durable Object</p>
      <button id="connect-btn">Connect</button>
      <button id="disconnect-btn" disabled>Disconnect</button>
      <div id="connection-log" class="log"></div>
    </div>

    <!-- Broadcast Demo -->
    <div class="demo-card">
      <h3>Broadcast</h3>
      <p>Send events to all subscribers on a channel</p>
      <div class="input-row">
        <input id="broadcast-message" placeholder="Enter message..." value="Hello, realtime!">
        <button id="broadcast-btn" disabled>Send</button>
      </div>
      <div id="broadcast-log" class="log"></div>
    </div>

    <!-- Presence Demo -->
    <div class="demo-card">
      <h3>Presence Channel</h3>
      <p>See who's online in real-time</p>
      <button id="join-presence-btn" disabled>Join Room</button>
      <button id="leave-presence-btn" disabled>Leave Room</button>
      <div class="presence-list" id="presence-list"></div>
      <div id="presence-log" class="log"></div>
    </div>

    <!-- Client Events Demo -->
    <div class="demo-card">
      <h3>Client Events</h3>
      <p>Peer-to-peer messaging on private channels</p>
      <div class="input-row">
        <input id="typing-input" placeholder="Type something..." disabled>
      </div>
      <p style="color: var(--muted); font-size: 0.8rem; margin-top: 0.5rem;">
        <span id="typing-indicator"></span>
      </p>
      <div id="client-log" class="log"></div>
    </div>
  </div>

  <h2>Example Code</h2>
  <pre><code>import { Pusher } from '@dotdo/pusher'

// Connect to self-hosted Pusher
const pusher = new Pusher('demo-key', {
  wsHost: '${c.req.header('host') || 'localhost:8787'}'
})

// Subscribe to channels
const channel = pusher.subscribe('notifications')
channel.bind('message', (data) => {
  console.log('Received:', data)
})

// Presence channels
const room = pusher.subscribe('presence-lobby')
room.bind('pusher:member_added', (member) => {
  console.log('User joined:', member.id)
})</code></pre>

  <footer>
    <p>Powered by <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
  </footer>

  <script>
    // Demo state
    let ws = null;
    let socketId = null;
    let subscribedChannels = new Set();

    // DOM elements
    const statusEl = document.getElementById('status');
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const broadcastBtn = document.getElementById('broadcast-btn');
    const broadcastInput = document.getElementById('broadcast-message');
    const joinPresenceBtn = document.getElementById('join-presence-btn');
    const leavePresenceBtn = document.getElementById('leave-presence-btn');
    const presenceList = document.getElementById('presence-list');
    const typingInput = document.getElementById('typing-input');
    const typingIndicator = document.getElementById('typing-indicator');

    // Log functions
    function log(elementId, message, type = '') {
      const el = document.getElementById(elementId);
      const entry = document.createElement('div');
      entry.className = 'log-entry ' + type;
      entry.textContent = new Date().toLocaleTimeString() + ' - ' + message;
      el.appendChild(entry);
      el.scrollTop = el.scrollHeight;
    }

    // Connect to WebSocket
    connectBtn.addEventListener('click', () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host + '/ws/demo');

      ws.onopen = () => {
        log('connection-log', 'WebSocket opened', 'event');
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      };

      ws.onclose = () => {
        statusEl.textContent = 'Disconnected';
        statusEl.className = 'status disconnected';
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        broadcastBtn.disabled = true;
        joinPresenceBtn.disabled = true;
        leavePresenceBtn.disabled = true;
        typingInput.disabled = true;
        log('connection-log', 'WebSocket closed', 'error');
      };

      ws.onerror = () => {
        log('connection-log', 'WebSocket error', 'error');
      };
    });

    // Disconnect
    disconnectBtn.addEventListener('click', () => {
      if (ws) ws.close();
    });

    // Handle incoming messages
    function handleMessage(msg) {
      switch (msg.event) {
        case 'pusher:connection_established':
          const data = JSON.parse(msg.data);
          socketId = data.socket_id;
          statusEl.textContent = 'Connected';
          statusEl.className = 'status connected';
          connectBtn.disabled = true;
          disconnectBtn.disabled = false;
          broadcastBtn.disabled = false;
          joinPresenceBtn.disabled = false;
          typingInput.disabled = false;
          log('connection-log', 'Connected with socket_id: ' + socketId, 'event');

          // Auto-subscribe to demo channels
          subscribe('demo-channel');
          subscribe('private-chat');
          break;

        case 'pusher:subscription_succeeded':
          subscribedChannels.add(msg.channel);
          if (msg.channel === 'presence-lobby') {
            const presence = JSON.parse(msg.data).presence;
            updatePresenceList(presence.hash);
            log('presence-log', 'Joined presence-lobby (' + presence.count + ' members)', 'event');
          } else {
            log('connection-log', 'Subscribed to ' + msg.channel, 'event');
          }
          break;

        case 'pusher:member_added':
          const newMember = JSON.parse(msg.data);
          addPresenceMember(newMember);
          log('presence-log', 'Member joined: ' + newMember.id, 'event');
          break;

        case 'pusher:member_removed':
          const leftMember = JSON.parse(msg.data);
          removePresenceMember(leftMember.id);
          log('presence-log', 'Member left: ' + leftMember.id, 'event');
          break;

        case 'message':
          log('broadcast-log', 'Received: ' + JSON.parse(msg.data).text, 'event');
          break;

        case 'client-typing':
          const typingData = JSON.parse(msg.data);
          showTypingIndicator(typingData.user);
          log('client-log', typingData.user + ' is typing...', 'event');
          break;

        default:
          log('connection-log', 'Event: ' + msg.event, '');
      }
    }

    // Subscribe to channel
    function subscribe(channel) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          event: 'pusher:subscribe',
          data: { channel }
        }));
      }
    }

    // Unsubscribe from channel
    function unsubscribe(channel) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          event: 'pusher:unsubscribe',
          data: { channel }
        }));
        subscribedChannels.delete(channel);
      }
    }

    // Broadcast message
    broadcastBtn.addEventListener('click', () => {
      const message = broadcastInput.value;
      if (message && ws && ws.readyState === WebSocket.OPEN) {
        // Use HTTP API for broadcast (server-side trigger)
        fetch('/api/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'demo-channel',
            event: 'message',
            data: { text: message, sender: socketId }
          })
        }).then(() => {
          log('broadcast-log', 'Sent: ' + message, 'event');
        });
      }
    });

    // Join presence channel
    joinPresenceBtn.addEventListener('click', () => {
      subscribe('presence-lobby');
      joinPresenceBtn.disabled = true;
      leavePresenceBtn.disabled = false;
    });

    // Leave presence channel
    leavePresenceBtn.addEventListener('click', () => {
      unsubscribe('presence-lobby');
      presenceList.innerHTML = '';
      joinPresenceBtn.disabled = false;
      leavePresenceBtn.disabled = true;
      log('presence-log', 'Left presence-lobby', 'event');
    });

    // Typing indicator (client events)
    let typingTimeout;
    typingInput.addEventListener('keydown', () => {
      if (ws && ws.readyState === WebSocket.OPEN && subscribedChannels.has('private-chat')) {
        ws.send(JSON.stringify({
          event: 'client-typing',
          channel: 'private-chat',
          data: JSON.stringify({ user: 'User-' + socketId.split('.')[0] })
        }));
      }
    });

    function showTypingIndicator(user) {
      typingIndicator.textContent = user + ' is typing...';
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        typingIndicator.textContent = '';
      }, 2000);
    }

    // Presence list management
    function updatePresenceList(members) {
      presenceList.innerHTML = '';
      for (const [id, info] of Object.entries(members)) {
        addPresenceMember({ id, info });
      }
    }

    function addPresenceMember(member) {
      const existing = document.getElementById('member-' + member.id);
      if (existing) return;

      const div = document.createElement('div');
      div.className = 'presence-member';
      div.id = 'member-' + member.id;
      div.innerHTML = '<span class="presence-dot"></span><span>' + member.id + '</span>';
      presenceList.appendChild(div);
    }

    function removePresenceMember(id) {
      const el = document.getElementById('member-' + id);
      if (el) el.remove();
    }
  </script>
</body>
</html>
  `)
})

// ============================================================================
// WEBSOCKET ROUTING
// ============================================================================

/**
 * Get DO stub for a namespace
 */
function getDO(c: { env: Env }, namespace: string): DurableObjectStub {
  const id = c.env.REALTIME_DO.idFromName(namespace)
  return c.env.REALTIME_DO.get(id)
}

/**
 * WebSocket upgrade endpoint
 * Route: /ws/:namespace
 */
app.get('/ws/:namespace', async (c) => {
  // Verify WebSocket upgrade
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426)
  }

  const namespace = c.req.param('namespace') || 'default'
  const stub = getDO(c, namespace)

  // Forward to Durable Object
  return stub.fetch(c.req.raw)
})

// ============================================================================
// REST API ROUTING
// ============================================================================

/**
 * Broadcast to channel
 * POST /api/broadcast
 */
app.post('/api/broadcast', async (c) => {
  const body = await c.req.json<{ channel: string; namespace?: string }>()
  const namespace = body.namespace || 'demo'
  const stub = getDO(c, namespace)

  return stub.fetch(new Request('http://internal/api/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }))
})

/**
 * Channel authentication
 * POST /api/auth
 */
app.post('/api/auth', async (c) => {
  const body = await c.req.json<{ namespace?: string }>()
  const namespace = body.namespace || 'demo'
  const stub = getDO(c, namespace)

  return stub.fetch(new Request('http://internal/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }))
})

/**
 * Get presence members
 * GET /api/presence/:channel
 */
app.get('/api/presence/:channel', async (c) => {
  const channel = c.req.param('channel')
  const namespace = c.req.query('namespace') || 'demo'
  const stub = getDO(c, namespace)

  return stub.fetch(new Request(`http://internal/api/presence/${channel}`))
})

/**
 * Get channel info (admin)
 * GET /api/channels
 */
app.get('/api/channels', async (c) => {
  const namespace = c.req.query('namespace') || 'demo'
  const stub = getDO(c, namespace) as DurableObjectStub & { getChannelInfo(): Promise<unknown> }

  // RPC call to DO
  const info = await stub.getChannelInfo()
  return c.json(info)
})

// ============================================================================
// SERVER SDK EXAMPLE
// ============================================================================

/**
 * Alternative broadcast using PusherServer SDK
 * POST /api/trigger
 *
 * Shows how to use the server SDK for event triggering
 */
app.post('/api/trigger', async (c) => {
  // Import the server SDK dynamically to avoid bundling issues
  const { PusherServer } = await import('../../../streaming/compat/pusher/server')

  const pusher = new PusherServer({
    appId: c.env.PUSHER_APP_ID || 'dotdo-realtime',
    key: c.env.PUSHER_KEY || 'demo-key',
    secret: c.env.PUSHER_SECRET || 'demo-secret',
    doNamespace: c.env.REALTIME_DO,
  })

  const body = await c.req.json<{
    channel: string | string[]
    event: string
    data: unknown
  }>()

  const result = await pusher.trigger(body.channel, body.event, body.data)

  if (result.ok) {
    return c.json({ success: true })
  } else {
    return c.json({ success: false, error: result.error }, 500)
  }
})

/**
 * Get channel info using PusherServer SDK
 * GET /api/channel/:name
 */
app.get('/api/channel/:name', async (c) => {
  const { PusherServer } = await import('../../../streaming/compat/pusher/server')

  const pusher = new PusherServer({
    appId: c.env.PUSHER_APP_ID || 'dotdo-realtime',
    key: c.env.PUSHER_KEY || 'demo-key',
    secret: c.env.PUSHER_SECRET || 'demo-secret',
    doNamespace: c.env.REALTIME_DO,
  })

  const channelName = c.req.param('name')
  const info = await pusher.getChannelInfo(channelName)

  if (info) {
    return c.json(info)
  } else {
    return c.json({ error: 'Channel not found' }, 404)
  }
})

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'compat-pusher-realtime',
    environment: c.env.ENVIRONMENT
  })
})

export default app
