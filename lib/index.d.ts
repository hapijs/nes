import * as Hapi from '@hapi/hapi';

import * as Iron from '@hapi/iron';
import { Client } from './client';

import {
    ClientConnectOptions,
    ClientRequestOptions,
    ErrorCodes,
    ErrorType,
    NesError,
    NesLog,
    NesReqRes,
    NesSubHandler
} from './client';

export namespace Nes {

    export {
        ClientConnectOptions,
        ClientRequestOptions,
        ErrorCodes,
        ErrorType,
        NesError,
        NesLog,
        NesReqRes,
        NesSubHandler
    }

    export interface SocketAuthObject<
        U extends object = Hapi.UserCredentials,
        A extends object = Hapi.AuthCredentials,
    > {
        isAuthenticated: boolean;
        credentials: Hapi.AuthCredentials<U, A> | null;
        artifacts: Hapi.AuthArtifacts | null;
    }

    export interface Socket<
        App extends object = {},
        Auth extends SocketAuthObject<any, any> = SocketAuthObject<any, any>
    > {
        id: string,
        app: App,
        auth: Auth,
        info: {
            remoteAddress: string,
            remotePort: number,
            'x-forwarded-for'?: string,
        }
        server: Hapi.Server,
        disconnect(): Promise<void>,
        send(message: unknown): Promise<void>,
        publish(path: string, message: unknown): Promise<void>,
        revoke(
            path: string,
            message?: unknown | null,
            options?: {
                ignoreClose?: boolean,
            }
        ): Promise<void>,
        isOpen(): boolean,
    }

    export interface ClientOpts {
        onDisconnect?: (
            willReconnect: boolean,
            log: {
                code: number,
                explanation: string,
                reason: string,
                wasClean: string,
                willReconnect: boolean,
                wasRequested: boolean,
            }
        ) => void
    }

    export interface BroadcastOptions {

        /**
         * Optional user filter. When provided, the
         * message will be sent only to
         * authenticated sockets with
         * `credentials.user` equal to `user`.
         * Requires the `auth.index` options to be
         * configured to `true`.
         */
        user?: string
    }

    type FilterReturn = (
        boolean | {
            /**
             * an override `message` to send to this `socket`
             * instead of the published one. Note that if you
             * want to modify `message`, you must clone it first
             * or the changes will apply to all other sockets.
             */
            override: unknown
        }
    )

    export interface SubscriptionOptions<S extends Socket = Socket<any, any>> {
        /**
         * Publishing filter function for making per-client
         * connection decisions about which matching publication
         * update should be sent to which client.
         * @param path The path of the published update. The path
         * is provided in case the subscription contains path
         * parameters
         * @param message The `JSON.stringify()` compliant
         * message being published
         * @param options Additional information about the
         * subscription and client
         * @returns
         */
        filter?: (
            path: string,
            message: unknown,
            options: {
                socket: S,
                credentials?: S['auth']['credentials'],

                /**
                 * The parameters parsed from the publish message
                 * path if the subscription path contains
                 * parameters.
                 */
                params?: unknown,

                /**
                 * The internal options data passed to the
                 * `server.publish()` call, if defined.
                 */
                internal: unknown
            },
        ) => (FilterReturn | Promise<FilterReturn>),

        /**
         * A method called when a client subscribes to this
         * subscription endpoint
         *
         * @param socket The `Socket` object of incoming
         * connection
         * @param path The path the client subscribed to
         * @param params The parameters parsed from the
         * subscription request path if the subscription path
         * definition contains parameters.

         * @returns
         */
        onSubscribe?: (
            socket: Socket,
            path: string,
            params?: unknown
        ) => void,

        /**
         * A method called when a client unsubscribes from this subscription endpoint
         * @param socket The `Socket` object of incoming
         * connection
         * @param path The path the client subscribed to
         * @param params The parameters parsed from the
         * subscription request path if the subscription path
         * definition contains parameters.
         * @returns
         */
        onUnsubscribe?: (
            socket: Socket,
            path: string,
            params?: unknown
        ) => void,

        /**
         * The subscription authentication options
         */
        auth?: boolean | {
            /**
             * Same as the ***hapi*** auth modes.
             */
            mode?: 'required' | 'optional',

            /**
             * Same as the ***hapi*** auth scopes.
             */
            scope?: string | string[],

            /**
             * Same as the ***hapi*** auth entities.
             */
            entity?: 'user' | 'app' | 'any',

            /**
             * if `true`, authenticated socket with `user`
             * property in `credentials` are mapped for usage
             * in `server.publish()` calls. Defaults to `false`.
             */
            index?: boolean,
        }
    }

    export interface PublishOptions {
        /**
         * Optional user filter. When provided, the message will
         * be sent only to authenticated sockets with
         * `credentials.user` equal to `user`. Requires the
         * subscription `auth.index` options to be configured to
         * `true`.
         */
        user?: string,

        /**
         * Internal data that is passed to `filter` and may be
         * used to filter messages on data that is not sent to
         * the client.
         */
        internal?: unknown
    }

    export interface EachSocketOptions {
        /**
         * When set to a string path, limits the results to sockets that are subscribed to that path.
         */
        subscription?: string,

        /**
         * Optional user filter. When provided, the `each` method
         * will be invoked with authenticated sockets with
         * `credentials.user` equal to `user`. Requires the
         * subscription `auth.index` options to be configured to
         * `true`.
         */
        user?: string

    }

    /**
     * Plugin options
     *
     * https://github.com/hapijs/nes/blob/master/API.md#registration
     */
    export interface PluginOptions<
        App extends object = {},
        Auth extends SocketAuthObject<any, any> = SocketAuthObject<any, any>
    > {
        /**
         * A function invoked for each incoming connection
         * @param socket  The `Socket` object of incoming
         * connection
         */
        onConnection?: (socket: Socket<App, Auth>) => void

        /**
         * A function invoked for each disconnection
         * @param socket The `Socket` object of incoming
         * connection
         */
        onDisconnection?: (socket: Socket<App, Auth>) => void

        /**
         * A function used to receive custom client messages
         * @param message The message sent by the client
         * @returns
         */
        onMessage?: (
            socket: Socket<App, Auth>,
            message: unknown
        ) => void

        /**
         * Optional plugin authentication options. The details of
         * this object do imply quiet a bit of  logic, so it is
         * best to see the documentation for more information.
         *
         * https://github.com/hapijs/nes/blob/master/API.md#registration
         */
        auth?: false | {
            endpoint?: string
            id?: string
            type?: 'cookie' | 'token' | 'direct',
            route?: Hapi.RouteOptions<any>['auth'],
            cookie?: string,
            isSecure?: boolean,
            isHttpOnly?: boolean,
            isSameSite?: 'Strict' | 'Lax' | false,
            path?: string | null,
            domain?: string | null,
            ttl?: number | null,
            iron?: Iron.SealOptions,
            password?: Iron.Password | Iron.password.Secret,
            index?: boolean,
            timeout?: number | false,
            maxConnectionsPerUser?: number | false,
            minAuthVerifyInterval?: number | false,
        },

        /**
         * An optional array of header field names to include in
         * server responses to the client. If set to `'*'`
         * (without an array), allows all headers. Defaults to
         * `null` (no headers).
         */
        headers?: string[] | '*' | null,

        /**
         * Optional message payload
         */
        payload?: {

            /**
             *  the maximum number of characters (after the full
             * protocol object is converted to a string using
             * `JSON.stringify()`) allowed in a single WebSocket
             * message. This is important when using the protocol
             * over a slow network (e.g. mobile) with large
             * updates as the transmission time can exceed the
             * timeout or heartbeat limits which will cause the
             * client to disconnect. Defaults to `false`
             * (no limit).
             */
            maxChunkChars?: number | false,
        },

        /**
         * Configures connection keep-alive settings.
         * When set to `false`, the server will not send
         * heartbeats. Defaults to:
         *
         * ```js
         * {
         *     interval: 15000,
         *     timeout: 5000
         * }
         * ```
         */
        heartbeat?: false | {

            /**
             * The time interval between heartbeat messages in
             * milliseconds. Defaults to `15000` (15 seconds).
             */
            interval: number,

            /**
             * timeout in milliseconds after a heartbeat is sent
             * to the client and before the client is considered
             * disconnected by the server. Defaults to `5000`
             * (5 seconds).
             */
            timeout?: number,
        },

        /**
         * If specified, limits the number of simultaneous client
         * connections. Defaults to `false`.
         */
        maxConnections?: number | false,

        /**
         * An origin string or an array of origin strings
         * incoming client requests must match for the connection
         * to be permitted. Defaults to no origin validation.
         */
        origins?: string | string[]
    }
}

export { Client }

export const plugin: Hapi.Plugin<Nes.PluginOptions>;


declare module '@hapi/hapi' {

    interface Server {

        /**
         * Sends a message to all connected clients
         * where:
         *
         * https://hapi.dev/module/nes/api/?v=13.0.1#await-serverbroadcastmessage-options
         *
         * @param message The message sent to the
         * clients. Can be any type which can be
         * safely converted to string using `JSON.
         * stringify()`.
         * @param options An optional object
         */
        broadcast(message: unknown, options?: Nes.BroadcastOptions): void;

        /**
         * Declares a subscription path client can
         * subscribe to where:
         *
         * https://hapi.dev/module/nes/api/?v=13.0.1#serversubscriptionpath-options
         *
         * @param path An HTTP-like path. The path
         * must begin with the `'/'` character. The
         * path may contain path parameters as
         * supported by the ***hapi*** route path parser.

         * @param options An optional object
         */
        subscription(path: string, options?: Nes.SubscriptionOptions): void;

        /**
         * Sends a message to all the subscribed clients
         *
         * https://github.com/hapijs/nes/blob/master/API.md#await-serverpublishpath-message-options
         *
         * @param path the subscription path. The path is matched
         * first against the available subscriptions added via
         * `server.subscription()` and then against the specific
         * path provided by each client at the time of
         * registration (only matter when the subscription path
         * contains parameters). When a match is found, the
         * subscription `filter` function is called (if present)
         * to further filter which client should receive which
         * update.
         *
         * @param message The message sent to the clients. Can be any type which can be safely converted to string using `JSON.stringify()`.
         * @param options optional object
         */
        publish(path: string, message: unknown, options?: Nes.PublishOptions): void;

        /**
         * Iterates over all connected sockets, optionally
         * filtering on those that have subscribed to a given
         * subscription. This operation is synchronous
         *
         * @param each Iteration method
         * @param options Optional options
         */
        eachSocket(
            each: (socket: Nes.Socket) => void,
            options?: Nes.EachSocketOptions
        ): void;
    }

    interface Request {

        /**
         * Provides access to the `Socket` object of the incoming
         * connection
         */
        socket: Nes.Socket;
    }
}

