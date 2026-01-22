// Transport Layer Types
// Defines the interface for all RPC transports
/**
 * Transport state for stateful transports (e.g., WebSocket)
 */
export var TransportState;
(function (TransportState) {
    /** Transport is ready to send messages */
    TransportState["CONNECTED"] = "CONNECTED";
    /** Transport is establishing connection */
    TransportState["CONNECTING"] = "CONNECTING";
    /** Transport is disconnected */
    TransportState["DISCONNECTED"] = "DISCONNECTED";
    /** Transport has closed permanently */
    TransportState["CLOSED"] = "CLOSED";
})(TransportState || (TransportState = {}));
/**
 * Type guard to check if a transport supports close
 */
export function isCloseable(transport) {
    return typeof transport.close === 'function';
}
/**
 * Type guard to check if a transport supports state tracking
 */
export function isStateful(transport) {
    return typeof transport.getState === 'function';
}
/**
 * Type guard to check if a transport supports events
 */
export function supportsEvents(transport) {
    return typeof transport.addEventListener === 'function';
}
//# sourceMappingURL=types.js.map