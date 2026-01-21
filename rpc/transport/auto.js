// Auto Transport - Automatic transport detection and upgrade
// Starts with FetchTransport and upgrades to WebSocketTransport if available
import { generateCorrelationId } from '../headers';
import { FetchTransport } from './fetch';
import { WebSocketTransport } from './websocket';
import { createUnifiedErrorHandler } from './error-utils';
/**
 * Auto Transport - automatically selects and upgrades transport
 *
 * This transport starts with FetchTransport for immediate availability,
 * then attempts to upgrade to WebSocketTransport if the endpoint supports it.
 *
 * Features:
 * - Transparent fallback to Fetch if WebSocket unavailable
 * - Automatic upgrade detection via WebSocket handshake
 * - Configurable upgrade strategy
 * - Event notifications for transport changes
 * - Retry logic for upgrade failures
 *
 * @example
 * ```typescript
 * // Basic usage with auto-upgrade (default)
 * const transport = new AutoTransport({
 *   url: 'https://api.example.com',
 * })
 *
 * // Send immediately (uses fetch)
 * const response = await transport.send({ method: 'test', args: [] })
 *
 * // Listen for upgrade events
 * transport.addEventListener((event) => {
 *   if (event.type === 'upgrade') {
 *     console.log(`Upgraded to ${event.transport}`)
 *   }
 * })
 *
 * // Disable auto-upgrade
 * const fetchOnly = new AutoTransport({
 *   url: 'https://api.example.com',
 *   autoUpgrade: false,  // or strategy: 'fetch-only'
 * })
 *
 * // Force WebSocket only
 * const wsOnly = new AutoTransport({
 *   url: 'https://api.example.com',
 *   strategy: 'websocket-only',
 * })
 * ```
 */
export class AutoTransport {
    url;
    wsUrl;
    timeout;
    baseCorrelationId;
    headers;
    strategy;
    upgradeTimeout;
    upgradeRetryInterval;
    maxUpgradeRetries;
    fetchImpl;
    WebSocketImpl;
    fetchOptions;
    wsOptions;
    onError;
    errorHandler;
    fetchTransport = null;
    wsTransport = null;
    activeTransport = null;
    activeTransportType = 'fetch';
    state = 'DISCONNECTED';
    eventListeners = new Set();
    upgradeAttempts = 0;
    upgradeTimer = null;
    upgradeInProgress = false;
    upgradePromise = null;
    closed = false;
    constructor(options) {
        this.url = options.url;
        this.timeout = options.timeout ?? 30000;
        if (options.correlationId !== undefined) {
            this.baseCorrelationId = options.correlationId;
        }
        this.headers = options.headers ?? {};
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
        this.fetchOptions = options.fetchOptions ?? {};
        this.wsOptions = options.wsOptions ?? {};
        this.onError = options.onError;
        // Create unified error handler for consistent error responses
        this.errorHandler = createUnifiedErrorHandler({
            transportType: 'fetch', // Use 'fetch' as the base type for auto transport
            endpoint: this.url,
            onError: this.onError,
        });
        // Determine strategy
        // Default to 'auto-upgrade' for backward compatibility
        // Use 'websocket-first' explicitly for REPL and real-time use cases
        if (options.strategy) {
            this.strategy = options.strategy;
        }
        else if (options.autoUpgrade === false) {
            this.strategy = 'fetch-only';
        }
        else {
            // Default strategy: auto-upgrade (start with fetch, upgrade if available)
            this.strategy = 'auto-upgrade';
        }
        this.upgradeTimeout = options.upgradeTimeout ?? 3000;
        this.upgradeRetryInterval = options.upgradeRetryInterval ?? 30000;
        this.maxUpgradeRetries = options.maxUpgradeRetries ?? 3;
        // Build WebSocket URL
        const wsPath = options.wsPath ?? '/ws';
        this.wsUrl = this.buildWsUrl(this.url, wsPath);
        // Initialize transport based on strategy
        this.initializeTransport();
    }
    /**
     * Build WebSocket URL from HTTP URL
     */
    buildWsUrl(httpUrl, wsPath) {
        const url = new URL(httpUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
        return url.toString();
    }
    /**
     * Initialize the appropriate transport based on strategy
     */
    initializeTransport() {
        if (this.strategy === 'websocket-only') {
            // Start with WebSocket only (fail if unavailable)
            this.initWebSocket();
        }
        else if (this.strategy === 'websocket-first') {
            // Try WebSocket first, fall back to Fetch if unavailable
            // Initialize Fetch as fallback (but don't activate it yet)
            this.initFetchAsFallback();
            // Attempt WebSocket connection immediately
            setTimeout(() => this.attemptWebSocketFirst(), 0);
        }
        else {
            // Start with Fetch (default for auto-upgrade and fetch-only)
            this.initFetch();
            // Schedule upgrade check for auto-upgrade strategy
            if (this.strategy === 'auto-upgrade') {
                // Use setImmediate equivalent to not block constructor
                setTimeout(() => this.attemptUpgrade(), 0);
            }
        }
    }
    /**
     * Initialize FetchTransport as a fallback (not active yet)
     * Used by websocket-first strategy
     */
    initFetchAsFallback() {
        this.fetchTransport = new FetchTransport({
            url: this.url,
            timeout: this.timeout,
            correlationId: this.baseCorrelationId,
            headers: this.headers,
            fetch: this.fetchImpl,
            onError: this.onError,
            ...this.fetchOptions,
        });
        // Don't set as active yet - we'll try WebSocket first
        // Set state to CONNECTING while we attempt WebSocket
        this.state = 'CONNECTING';
    }
    /**
     * Attempt WebSocket connection first, fall back to Fetch if unavailable
     * Used by websocket-first strategy for optimal real-time experience
     */
    async attemptWebSocketFirst() {
        if (this.closed) {
            return;
        }
        try {
            // Check if WebSocket is available
            const available = await this.checkWebSocketAvailability();
            if (available && !this.closed) {
                // WebSocket is available, initialize and use it
                this.initWebSocket();
                // Try to establish connection
                const connectSuccess = await this.tryWebSocketConnect();
                if (connectSuccess) {
                    // Successfully connected via WebSocket
                    this.activeTransport = this.wsTransport;
                    this.activeTransportType = 'websocket';
                    this.state = 'CONNECTED';
                    this.emit({
                        type: 'connect',
                        transport: 'websocket',
                    });
                    return;
                }
            }
            // WebSocket unavailable or failed, fall back to Fetch
            this.fallbackToFetchOnInit();
        }
        catch {
            // Any error, fall back to Fetch
            this.fallbackToFetchOnInit();
        }
    }
    /**
     * Fall back to Fetch transport during initialization
     * Used by websocket-first strategy when WebSocket is unavailable
     */
    fallbackToFetchOnInit() {
        if (this.closed) {
            return;
        }
        // Activate the Fetch transport that was already initialized
        if (this.fetchTransport) {
            this.activeTransport = this.fetchTransport;
            this.activeTransportType = 'fetch';
            this.state = 'CONNECTED';
            this.emit({
                type: 'connect',
                transport: 'fetch',
            });
            // Schedule WebSocket retry for later
            if (this.upgradeRetryInterval > 0) {
                this.scheduleUpgradeRetry();
            }
        }
    }
    /**
     * Initialize FetchTransport
     */
    initFetch() {
        this.fetchTransport = new FetchTransport({
            url: this.url,
            timeout: this.timeout,
            correlationId: this.baseCorrelationId,
            headers: this.headers,
            fetch: this.fetchImpl,
            onError: this.onError,
            ...this.fetchOptions,
        });
        this.activeTransport = this.fetchTransport;
        this.activeTransportType = 'fetch';
        this.state = 'CONNECTED';
    }
    /**
     * Initialize WebSocketTransport
     */
    initWebSocket() {
        this.wsTransport = new WebSocketTransport({
            url: this.wsUrl,
            timeout: this.timeout,
            correlationId: this.baseCorrelationId,
            WebSocket: this.WebSocketImpl,
            onError: this.onError,
            ...this.wsOptions,
        });
        // Forward WebSocket events
        this.wsTransport.addEventListener((event) => {
            this.handleWsEvent(event);
        });
        this.activeTransport = this.wsTransport;
        this.activeTransportType = 'websocket';
        this.state = this.wsTransport.getState();
    }
    /**
     * Handle WebSocket transport events
     */
    handleWsEvent(event) {
        // Update our state based on WebSocket state
        if (event.type === 'connect') {
            this.state = 'CONNECTED';
        }
        else if (event.type === 'disconnect') {
            this.state = 'DISCONNECTED';
            // If we're in auto-upgrade mode and WebSocket disconnects,
            // fall back to Fetch and schedule reconnect
            if (this.strategy === 'auto-upgrade' && !this.closed) {
                this.fallbackToFetch();
            }
        }
        // Forward event to our listeners
        this.emit(event);
    }
    /**
     * Fall back to Fetch transport
     */
    fallbackToFetch() {
        if (this.fetchTransport) {
            this.activeTransport = this.fetchTransport;
            this.activeTransportType = 'fetch';
            this.state = 'CONNECTED';
            this.emit({ type: 'disconnect' });
            this.emit({ type: 'connect' });
            // Schedule upgrade retry
            if (this.upgradeRetryInterval > 0 && !this.closed) {
                this.scheduleUpgradeRetry();
            }
        }
    }
    /**
     * Attempt to upgrade to WebSocket
     */
    async attemptUpgrade() {
        // Prevent concurrent upgrade attempts
        if (this.upgradeInProgress) {
            return this.upgradePromise ?? Promise.resolve(false);
        }
        // Check if already on WebSocket
        if (this.activeTransportType === 'websocket' && this.wsTransport?.isConnected()) {
            return true;
        }
        // Check max retries
        if (this.maxUpgradeRetries > 0 && this.upgradeAttempts >= this.maxUpgradeRetries) {
            return false;
        }
        this.upgradeInProgress = true;
        this.upgradeAttempts++;
        this.upgradePromise = this.doUpgrade();
        const result = await this.upgradePromise;
        this.upgradeInProgress = false;
        this.upgradePromise = null;
        return result;
    }
    /**
     * Perform the actual upgrade
     */
    async doUpgrade() {
        if (this.closed) {
            return false;
        }
        try {
            // Check if WebSocket is available
            const available = await this.checkWebSocketAvailability();
            if (!available) {
                this.emit({
                    type: 'error',
                    error: new Error('WebSocket not available at endpoint'),
                    reason: 'not-available',
                });
                return false;
            }
            // Initialize WebSocket if not already done
            if (!this.wsTransport) {
                this.initWebSocket();
            }
            // Try to connect
            const connectSuccess = await this.tryWebSocketConnect();
            if (connectSuccess) {
                // Successfully upgraded
                this.activeTransport = this.wsTransport;
                this.activeTransportType = 'websocket';
                this.state = 'CONNECTED';
                this.upgradeAttempts = 0; // Reset attempts on success
                this.emit({
                    type: 'connect',
                    transport: 'websocket',
                });
                // Emit custom upgrade event
                this.emit({
                    type: 'reconnect',
                    attempt: this.upgradeAttempts,
                    transport: 'websocket',
                });
                return true;
            }
            this.emit({
                type: 'error',
                error: new Error('WebSocket connection failed'),
                reason: 'connect-failed',
            });
            return false;
        }
        catch (error) {
            this.emit({
                type: 'error',
                error: error instanceof Error ? error : new Error(String(error)),
                reason: 'upgrade-error',
            });
            return false;
        }
    }
    /**
     * Check if WebSocket is available at the endpoint
     */
    async checkWebSocketAvailability() {
        try {
            // Try to establish a WebSocket connection with a timeout
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    ws.close();
                    resolve(false);
                }, this.upgradeTimeout);
                let ws;
                try {
                    ws = new this.WebSocketImpl(this.wsUrl);
                }
                catch {
                    clearTimeout(timeout);
                    resolve(false);
                    return;
                }
                ws.addEventListener('open', () => {
                    clearTimeout(timeout);
                    ws.close();
                    resolve(true);
                });
                ws.addEventListener('error', () => {
                    clearTimeout(timeout);
                    resolve(false);
                });
                ws.addEventListener('close', () => {
                    clearTimeout(timeout);
                    // If it closed without opening, it's not available
                    // resolve(false) is already called by error handler typically
                });
            });
        }
        catch {
            return false;
        }
    }
    /**
     * Try to connect WebSocket transport
     */
    async tryWebSocketConnect() {
        if (!this.wsTransport) {
            return false;
        }
        try {
            // Send a ping to establish connection
            const response = await this.wsTransport.send({
                method: '$ping',
                args: [{ timestamp: Date.now() }],
                correlationId: generateCorrelationId(),
            });
            return !response.error;
        }
        catch {
            return false;
        }
    }
    /**
     * Schedule an upgrade retry
     */
    scheduleUpgradeRetry() {
        if (this.upgradeTimer) {
            clearTimeout(this.upgradeTimer);
        }
        if (this.closed || this.upgradeRetryInterval <= 0) {
            return;
        }
        this.upgradeTimer = setTimeout(() => {
            this.upgradeTimer = null;
            this.attemptUpgrade();
        }, this.upgradeRetryInterval);
    }
    /**
     * Emit event to all listeners
     */
    emit(event) {
        for (const listener of this.eventListeners) {
            try {
                listener(event);
            }
            catch {
                // Ignore listener errors
            }
        }
    }
    /**
     * Send an RPC message via the active transport
     */
    async send(message) {
        const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId();
        if (this.closed) {
            return this.errorHandler.fromClosed(message, correlationId);
        }
        if (!this.activeTransport) {
            return this.errorHandler.fromNoTransport(message, correlationId);
        }
        return this.activeTransport.send(message);
    }
    /**
     * Close all transports
     */
    async close() {
        this.closed = true;
        this.state = 'CLOSED';
        // Cancel upgrade timer
        if (this.upgradeTimer) {
            clearTimeout(this.upgradeTimer);
            this.upgradeTimer = null;
        }
        // Close all transports
        const closePromises = [];
        if (this.fetchTransport?.close) {
            closePromises.push(this.fetchTransport.close());
        }
        if (this.wsTransport?.close) {
            closePromises.push(this.wsTransport.close());
        }
        await Promise.all(closePromises);
        this.fetchTransport = null;
        this.wsTransport = null;
        this.activeTransport = null;
        this.eventListeners.clear();
    }
    /**
     * Get current transport state
     */
    getState() {
        return this.state;
    }
    /**
     * Add event listener
     */
    addEventListener(listener) {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
    }
    /**
     * Get the currently active transport type
     */
    getActiveTransportType() {
        return this.activeTransportType;
    }
    /**
     * Check if currently using WebSocket
     */
    isUsingWebSocket() {
        return this.activeTransportType === 'websocket';
    }
    /**
     * Check if currently connected
     */
    isConnected() {
        if (this.activeTransportType === 'websocket' && this.wsTransport) {
            return this.wsTransport.isConnected();
        }
        // FetchTransport is always "connected"
        return this.state === 'CONNECTED';
    }
    /**
     * Manually trigger an upgrade attempt
     * Useful for testing or when you know WebSocket became available
     */
    async tryUpgrade() {
        if (this.strategy === 'fetch-only') {
            return false;
        }
        return this.attemptUpgrade();
    }
    /**
     * Get the underlying fetch transport (if available)
     */
    getFetchTransport() {
        return this.fetchTransport;
    }
    /**
     * Get the underlying WebSocket transport (if available)
     */
    getWebSocketTransport() {
        return this.wsTransport;
    }
}
/**
 * Create an auto transport (convenience function)
 *
 * @example
 * ```typescript
 * const transport = createAutoTransport({
 *   url: 'https://api.example.com',
 *   autoUpgrade: true,
 * })
 * ```
 */
export function createAutoTransport(options) {
    return new AutoTransport(options);
}
//# sourceMappingURL=auto.js.map