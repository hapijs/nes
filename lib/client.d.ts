import type { ClientRequestArgs } from "http";
import type { ClientOptions } from "ws";

// Same as exported type in @hapi/hapi v20
type HTTP_METHODS = 'ACL' | 'BIND' | 'CHECKOUT' | 'CONNECT' | 'COPY' | 'DELETE' | 'GET' | 'HEAD' | 'LINK' | 'LOCK' |
    'M-SEARCH' | 'MERGE' | 'MKACTIVITY' | 'MKCALENDAR' | 'MKCOL' | 'MOVE' | 'NOTIFY' | 'OPTIONS' | 'PATCH' | 'POST' |
    'PROPFIND' | 'PROPPATCH' | 'PURGE' | 'PUT' | 'REBIND' | 'REPORT' | 'SEARCH' | 'SOURCE' | 'SUBSCRIBE' | 'TRACE' |
    'UNBIND' | 'UNLINK' | 'UNLOCK' | 'UNSUBSCRIBE';

type ErrorType = (
    'timeout' |
    'disconnect' |
    'server' |
    'protocol' |
    'ws' |
    'user'
);

type ErrorCodes = {
    1000: 'Normal closure',
    1001: 'Going away',
    1002: 'Protocol error',
    1003: 'Unsupported data',
    1004: 'Reserved',
    1005: 'No status received',
    1006: 'Abnormal closure',
    1007: 'Invalid frame payload data',
    1008: 'Policy violation',
    1009: 'Message too big',
    1010: 'Mandatory extension',
    1011: 'Internal server error',
    1015: 'TLS handshake'
};

type NesLog = {

    readonly code: keyof ErrorCodes;
    readonly explanation: ErrorCodes[keyof ErrorCodes] | 'Unknown';
    readonly reason: string;
    readonly wasClean: boolean;
    readonly willReconnect: boolean;
    readonly wasRequested: boolean;
}

export interface NesError extends Error {

    type: ErrorType;
    isNes: true;
    statusCode?: number;
    data?: any;
    headers?: Record<string, string>;
    path?: string;
}

export interface ClientConnectOptions {

    /**
     * sets the credentials used to authenticate.
     * when the server is configured for
     *
     * - `'token'` type authentication, the value
     * is the token response received from the
     * authentication endpoint (called manually by
     * the application). When the server is
     * configured for `'direct'` type
     * authentication, the value is the credentials
     * expected by the server for the specified
     * authentication strategy used which typically
     * means an object with headers
     * (e.g. `{ headers: { authorization: 'Basic am9objpzZWNyZXQ=' } }`).
     */
    auth?: string | {
        headers?: Record<string, string>;
        payload?: Record<string, string>;
    };

    /**
     * A boolean that indicates whether the client
     * should try to reconnect. Defaults to `true`.
     */
    reconnect?: boolean;

    /**
     * Time in milliseconds to wait between each
     * reconnection attempt. The delay time is
     * cumulative, meaning that if the value is set
     * to `1000` (1 second), the first wait will be
     * 1 seconds, then 2 seconds, 3 seconds, until
     * the `maxDelay` value is reached and then
     * `maxDelay` is used.
     */
    delay?: number;

    /**
     * The maximum delay time in milliseconds
     * between reconnections.
     */
    maxDelay?: number;

    /**
     * number of reconnection attempts. Defaults to
     * `Infinity` (unlimited).
     */
    retries?: number;

    /**
     * socket connection timeout in milliseconds.
     * Defaults to the WebSocket implementation
     * timeout default.
     */
    timeout?: number;
}

type NesReqRes<R> = {
    payload: R;
    statusCode: number;
    headers: Record<string, string>;
}

export interface ClientRequestOptions {

    /**
     * The requested endpoint path or route id.
     */
    path: string;

    /**
     * The requested HTTP method (can also be any
     * method string supported by the server).
     * Defaults to `'GET'`.
     */
    method?: Omit<HTTP_METHODS | Lowercase<HTTP_METHODS>, 'HEAD' | 'head'>;
    /**
     * An object where each key is a request header
     * and the value the header content. Cannot
     * include an Authorization header. Defaults to
     * no headers.
     */
    headers?: Record<string, string>;

    /**
     * The request payload sent to the server.
     */
    payload?: any;
}

export interface NesSubHandler {

    (
        message: unknown,
        flags: {

            /**
             * Set to `true` when the message is the
             * last update from the server due to a
             * subscription revocation.
             */
            revoked?: boolean;

        }
    ): void;
}

/**
 * Creates a new client object
 *
 * https://github.com/hapijs/nes/blob/master/API.md#client-5
 */
export class Client {

    /**
     * https://github.com/hapijs/nes/blob/master/API.md#new-clienturl-options
     * @param url
     * @param options
     */
    constructor(
        url: `ws://${string}` | `wss://${string}`,
        options?: {
            ws?: ClientOptions | ClientRequestArgs;
            timeout?: number | boolean;
        });

    /**
     * The unique socket identifier assigned by the
     * server. The value is set after the
     * connection is established.
     */
    readonly id: string | null;

    /**
     * A property set by the developer to handle
     * errors. Invoked whenever an error happens
     * that cannot be associated with a pending
     * request.
     *
     * https://github.com/hapijs/nes/blob/master/API.md#clientonerror
     */
    onError(err: NesError): void;

    /**
     * A property set by the developer used to set
     * a handler for connection events (initial
     * connection and subsequent reconnections)
     *
     * https://github.com/hapijs/nes/blob/master/API.md#clientonconnect
     */
    onConnect(): void;

    /**
     * A property set by the developer used to set
     * a handler for disconnection events
     *
     * https://github.com/hapijs/nes/blob/master/API.md#clientondisconnect
     *
     * @param willReconnect A boolean indicating if
     * the client will automatically attempt to
     * reconnect
     * @param log A log object containing
     * information about the disconnection
     */
    onDisconnect(willReconnect: boolean, log: NesLog): void;

    /**
     * A property set by the developer used to set
     * a handler for heartbeat timeout events
     *
     * https://github.com/hapijs/nes/blob/master/API.md#clientonheartbeattimeout
     *
     * @param willReconnect A boolean indicating if
     * the client will automatically attempt to
     * reconnect
     */
    onHeartbeatTimeout(willReconnect: boolean): void;

    /**
     * A property set by the developer used to set
     * a custom message handler. Invoked whenever
     * the server calls `server.broadcast()` or
     * `socket.send()`.
     *
     * https://github.com/hapijs/nes/blob/master/API.md#clientonupdate
     *
     * @param message
     */

    onUpdate(message: unknown): void;


    /**
     * Connects the client to the server
     *
     * https://github.com/hapijs/nes/blob/master/API.md#await-clientconnectoptions
     */
    connect(options?: ClientConnectOptions): Promise<void>;

    /**
     * Disconnects the client from the server and
     * stops future reconnects.
     *
     * https://github.com/hapijs/nes/blob/master/API.md#await-clientdisconnect
     */
    disconnect(): Promise<void>;

    /**
     * Sends an endpoint request to the server.
     * This overload will perform a `GET` request by
     * default.
     *
     * Rejects with `Error` if the request failed.
     *
     * https://github.com/hapijs/nes/blob/master/API.md#await-clientrequestoptions
     *
     * @param path The endpoint path
     */
    request <R = any>(path: string): Promise<NesReqRes<R>>;

    /**
     * Sends an endpoint request to the server.
     *
     * Rejects with `Error` if the request failed.
     *
     * https://github.com/hapijs/nes/blob/master/API.md#await-clientrequestoptions
     *
     * @param options The request options
     */
    request <R = any>(options: ClientRequestOptions): Promise<NesReqRes<R>>;


    /**
     * Sends a custom message to the server which
     * is received by the server `onMessage` handler
     *
     * https://github.com/hapijs/nes/blob/master/API.md#await-clientmessagemessage
     *
     * @param message The message sent to the
     * server. Can be any type which can be safely
     * converted to string using `JSON.stringify()`.
     */
    message <R = any>(message: unknown): Promise<R>;

    /**
     * Subscribes to a server subscription
     *
     * https://github.com/hapijs/nes/blob/master/API.md#await-clientsubscribepath-handler
     *
     * @param path The requested subscription path.
     * Paths are just like HTTP request paths (e.g.
     * `'/item/5'` or `'/updates'` based on the
     * paths supported by the server).
     *
     * @param handler The function used to receive subscription updates
     */
    subscribe(path: string, handler: NesSubHandler): Promise<void>;

    /**
     * Cancels a subscription
     *
     * https://github.com/hapijs/nes/blob/master/API.md#await-clientunsubscribepath-handler
     *
     * @param path the subscription path used to subscribe
     * @param handler remove a specific handler from a
     * subscription or `null` to remove all handlers for
     * the given path
     */
    unsubscribe(path: string, handler?: NesSubHandler): Promise<void>;

    /**
     * Returns an array of the current subscription paths.
     *
     * https://github.com/hapijs/nes/blob/master/API.md#clientsubscriptions
     *
     */
    subscriptions(): string[];

    /**
     * Sets or overrides the authentication credentials used
     * to reconnect the client on disconnect when the client
     * is configured to automatically reconnect
     *
     * Returns `true` if reconnection is enabled, otherwise
     * `false` (in which case the method was ignored).
     *
     * Note: this will not update the credentials on the
     * server - use `client.reauthenticate()`
     *
     * https://github.com/hapijs/nes/blob/master/API.md#clientoverridereconnectionauthauth
     *
     * @param auth same as the `auth` option passed to
     * `client.connect()`
     */
    overrideReconnectionAuth(auth: ClientConnectOptions['auth']): boolean;

    /**
     * Will issue the `reauth` message to the server with
     * updated `auth` details and also override the
     * reconnection information, if reconnection is enabled.
     * The server will respond with an error and drop the
     * connection in case the new `auth` credentials are
     * invalid.
     *
     * Rejects with `Error` if the request failed.
     *
     * Resolves with `true` if the request succeeds.
     *
     * Note: when authentication has a limited lifetime,
     * `reauthenticate()` should be called early enough to
     * avoid the server dropping the connection.
     *
     * https://github.com/hapijs/nes/blob/master/API.md#await-clientreauthenticateauth
     *
     * @param auth same as the `auth` option passed to
     * `client.connect()`
     */
    reauthenticate(auth: ClientConnectOptions['auth']): Promise<unknown>;
}
