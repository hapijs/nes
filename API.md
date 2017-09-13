# 6.4.x API Reference

- [Registration](#registration)
- [Server](#server)
    - [`server.broadcast(message, [options])`](#serverbroadcastmessage-options)
    - [`server.subscription(path, [options])`](#serversubscriptionpath-options)
    - [`server.publish(path, message, [options])`](#serverpublishpath-message-options)
    - [`server.eachSocket(each, [options])`](#servereachsocketeach-options)
- [Socket](#socket)
    - [`socket.id`](#socketid)
    - [`socket.app`](#socketapp)
    - [`socket.auth`](#socketauth)
    - [`socket.server`](#socketserver)
    - [`socket.connection`](#socketconnection)
    - [`socket.disconnect()`](#socketdisconnect)
    - [`socket.send(message, [callback])`](#socketsendmessage-callback)
    - [`socket.publish(path, message, [callback])`](#socketpublishpath-message-callback)
    - [`socket.revoke(path, message, [callback])`](#socketrevokepath-message-callback)
- [Request](#request)
    - [`request.socket`](#requestsocket)
- [Client](#client)
    - [`new Client(url, [options])`](#new-clienturl-options)
    - [`client.onError`](#clientonerror)
    - [`client.onConnect`](#clientonconnect)
    - [`client.onDisconnect`](#clientondisconnect)
    - [`client.onUpdate`](#clientonupdate)
    - [`client.connect([options], callback)`](#clientconnectoptions-callback)
    - [`client.disconnect([callback])`](#clientdisconnectcallback)
    - [`client.id`](#clientid)
    - [`client.request(options, callback)`](#clientrequestoptions-callback)
    - [`client.message(message, callback)`](#clientmessagemessage-callback)
    - [`client.subscribe(path, handler, callback)`](#clientsubscribepath-handler-callback)
    - [`client.unsubscribe(path, handler, callback)`](#clientunsubscribepath-handler-callback)
    - [`client.subscriptions()`](#clientsubscriptions)
    - [`client.overrideReconnectionAuth(auth)`](#clientoverriderecinnectionauthauth)
    - [Errors](#errors)

## Registration

The **nes** plugin uses the standard **hapi** registration process using the `server.register()`
method. The plugin accepts the following optional registration options:
- `onConnection` - a function with the signature `function(socket)` invoked for each incoming client
  connection where:
    - `socket` - the [`Socket`](#socket) object of the incoming connection.
- `onDisconnection` - a function with the signature `function(socket)` invoked for each incoming client
  connection on disconnect where:
    - `socket` - the [`Socket`](#socket) object of the connection.
- `onMessage` - a function with the signature `function(socket, message, next)` used to receive custom
  client messages (when the client calls [`client.message()`](#clientmessagedata-callback)) where:
    - `socket` - the [`Socket`](#socket) object of the message source.
    - `message` - the message sent by the client.
    - `next` - the required callback function used to return a response to the client using
      signature `function(data)` where:
          - `data` - the message sent back to the client.
- `auth` - optional plugin authentication options with the following supported values:
    - `false` - no client authentication supported.
    - an object with the following optional keys:
        - `type` - the type of authentication flow supported by the server. Each type has a very different
          security profile. The following types are supported:
            - `'direct'` - the plugin configures an internal authentication endpoint which is only called
              internally by the plugin when the client provides its authentication credentials (or by
              passing an `auth` option to [`client.connect()](#clientconnectoptions-callback)). The
              endpoint returns a copy of the credentials object (along with any artifacts) to the plugin
              which is then used for all subsequent client requests and subscriptions. This type requires
              exposing the underlying credentials to the application. Note that if the authentication scheme
              uses the HTTP request method (e.g. [hawk](https://github.com/hueniverse/hawk) or
              [oz](https://github.com/hueniverse/oz)) you need to use `'auth'` as the value (and
              not `'GET'`). This is the default value.
            - `'cookie'` - the plugin configures a public authentication endpoint which must be called
              by the client application manually before it calls [`client.connect()](#clientconnectoptions-callback).
              When the endpoint is called with valid credentials, it sets a cookie with the provided
              `name` which the browser then transmits back to the server when the WebSocket connection
              is made. This type removes the need to expose the authentication credentials to the
              JavaScript layer but requires an additional round trip before establishing a client
              connection.
            - `'token'` - the plugin configures a public authentication endpoint which must be called
              by the client application manually before it calls [`client.connect()](#clientconnectoptions-callback).
              When the endpoint is called with valid credentials, it returns an encrypted authentication
              token which the client can use to authenticate the connection by passing an `auth` option
              to [`client.connect()](#clientconnectoptions-callback) with the token. This type is useful
              when the client-side application needs to manage its credentials differently than relying
              on cookies (e.g. non-browser clients).
        - `endpoint` - the HTTP path of the authentication endpoint. Note that even though the `'direct'`
          type does not exposes the endpoint, it is still created internally and registered using the
          provided path. Change it only if the default path creates a conflict. Defaults to `'/nes/auth'`.
        - `id` - the authentication endpoint identifier. Change it only if the default id creates a conflict.
          Defaults to `nes.auth`.
        - `route` - the **hapi** route `config.auth` settings. The authentication endpoint must be
          configured with at least one authentication strategy which the client is going to use to
          authenticate. The `route` value must be set to a valid value supported by the **hapi** route
          `auth` configuration. Defaults to the default authentication strategy if one is present,
          otherwise no authentication will be possible (clients will fail to authenticate).
        - `password` - the password used by the [**iron**](https://github.com/hueniverse/iron) module
          to encrypt the cookie or token values. If no password is provided, one is automatically
          generated. However, the password will change every time the process is restarted (as well
          as generate different results on a distributed system). It is recommended that a password
          is manually set and managed by the application.
        - `iron` - the settings used by the [**iron**](https://github.com/hueniverse/iron) module.
          Defaults to the **iron** defaults.
        - `cookie` - the cookie name when using type `'cookie'`. Defaults to `'nes'`.
        - `isSecure` - the cookie secure flag when using type `'cookie'`. Defaults to `true`.
        - `isHttpOnly` - the cookie HTTP only flag when using type `'cookie'`. Defaults to `true`.
        - `path` - the cookie path when using type `'cookie'`. Defaults to `'/'`.
        - `domain` - the cookie domain when using type `'cookie'`. Defaults to no domain.
        - `ttl` - the cookie expiration milliseconds when using type `'cookie'`. Defaults to current
          session only.
        - `index` - the key property in `credentials` that is mapped
          for usage in [`server.broadcast()`](#serverbroadcastmessage-options) calls. If `true`, the key property is `user`. Defaults to `false`.
        - `timeout` - number of milliseconds after which a new connection is disconnected if authentication
          is required but the connection has not yet sent a hello message. No timeout if set to `false`.
          Defaults to `5000` (5 seconds).
        - `maxConnectionsPerUser` - if specified, limits authenticated users to a maximum number of
          client connections. Requires the `index` option enabled. Defaults to `false`.
- `headers` - an optional array of header field names to include in server responses to the client.
  If set to `'*'` (without an array), allows all headers. Defaults to `null` (no headers).
- `payload` - optional message payload settings where:
    - `maxChunkChars` - the maximum number of characters (after the full protocol object is converted
      to a string using `JSON.stringify()`) allowed in a single WebSocket message. This is important
      when using the protocol over a slow network (e.g. mobile) with large updates as the transmission
      time can exceed the timeout or heartbeat limits which will cause the client to disconnect.
      Defaults to `false` (no limit).
- `heartbeat` - configures connection keep-alive settings where value can be:
    - `false` - no heartbeats.
    - an object with:
        - `interval` - time interval between heartbeat messages in milliseconds. Defaults to `15000`
          (15 seconds).
        - `timeout` - timeout in milliseconds after a heartbeat is sent to the client and before the
          client is considered disconnected by the server. Defaults to `5000` (5 seconds).
- `maxConnections` - if specified, limits the number of simultaneous client connections. Defaults to
  `false`.
- `origin` - an origin string or an array of origin strings incoming client requests must match for
  the connection to be permitted. Defaults to no origin validation.

## Server

The plugin decorates the server with a few new methods for interacting with the incoming WebSocket
connections.

### `server.broadcast(message, [options])`

Sends a message to all connected clients where:
- `message` - the message sent to the clients. Can be any type which can be safely converted to
  string using `JSON.stringify()`.
- `options` - optional object with the following:
    - `user` - optional user filter. When provided, the message will be sent only to authenticated
      sockets with `credentials.user` equal to  `user`. Requires the `auth.index` options to be
      configured to `true`.

Note that in a multi server deployment, only the client connected to the current server will receive
the message.

### `server.subscription(path, [options])`

Declares a subscription path client can subscribe to where:
- `path` - an HTTP-like path. The path must begin with the `'/'` character. The path may contain
  path parameters as supported by the **hapi** route path parser.
- `options` - an optional object where:
    - `filter` - a publishing filter function for making per-client connection decisions about which
      matching publication update should be sent to which client. The function uses the signature
      `function(path, message, options, next)` where:
        - `path` - the path of the published update. The path is provided in case the subscription
          contains path parameters.
        - `message` - the message being published.
        - `options` - additional information about the subscription and client:
            - `socket` - the current socket being published to.
            - `credentials` - the client credentials if authenticated.
            - `params` - the parameters parsed from the publish message path if the subscription
              path contains parameters.
            - `internal` - the `internal` options data passed to the publish call, if defined.
        - `next` - the continuation method using signature `function(isMatch, [override])` where:
            - `isMatch` - a boolean to indicate if the published message should be sent to the
              current client where `true` means the message will be sent.
            - `override` - an optional `message` to send to this `socket` instead of the published
              one. Note that if you want to modify `message`, you must clone it first or the changes
              will apply to all other sockets.
    - `auth` - the subscription authentication options with the following supported values:
        - `false` - no authentication required to subscribe.
        - a configuration object with the following optional keys:
            - `mode` - same as the **hapi** route auth modes:
                - `'required'` - authentication is required. This is the default value.
                - `'optional'` - authentication is optional.
            - `scope` - a string or array of string of authentication scope as supported by the
              **hapi** route authenticate configuration.
            - `entity` - the required credentials type as supported by the **hapi** route
              authentication configuration:
                - `'user'`
                - `'app'`
                - `'any'`
            - `index` - if `true`, authenticated socket with `user` property in `credentials` are
              mapped for usage in [`server.publish()`](#serverpublishpath-message-options) calls.
              Defaults to `false`.
    - `onSubscribe` - a method called when a client subscribes to this subscription endpoint using
      the signature `function(socket, path, params, next)` where:
        - `socket` - the [`Socket`](#socket) object of the incoming connection.
        - `path` - the path the client subscribed to
        - `params` - the parameters parsed from the subscription request path if the subscription
          path definition contains parameters.
        - `next` - the continuation method required to complete the subscription request using the
          signature `function(err)` where:
            - `err` - if present, indicates the subscription request failed and the error will be
              passed back to the client.
    - `onUnsubscribe` - Callback called when a client unsubscribes from this subscription endpoint
      using the signature `function(socket, path, params, next)` where:
        - `socket` - the [`Socket`](#socket) object of the incoming connection.
        - `path` - Path of the unsubscribed route.
        - `params` - the parameters parsed from the subscription request path if the subscription
          path definition contains parameters.
        - `next` - the continuation method required to complete the unsubscribe request using the
          signature `function()`.

### `server.publish(path, message, [options])`

Sends a message to all the subscribed clients where:
- `path` - the subscription path. The path is matched first against the available subscriptions
  added via `server.subscription()` and then against the specific path provided by each client
  at the time of registration (only matter when the subscription path contains parameters). When
  a match is found, the subscription `filter` function is called (if present) to further filter
  which client should receive which update.
- `message` - the message sent to the clients. Can be any type which can be safely converted to
  string using `JSON.stringify()`.
- `options` - optional object that may include
    - `internal` - Internal data that is passed to `filter` and may be used to filter messages
      on data that is not sent to the client.
    - `user` - optional user filter. When provided, the message will be sent only to authenticated
      sockets with `credentials.user` equal to  `user`. Requires the subscription `auth.index`
      options to be configured to `true`.

### `server.eachSocket(each, [options])`

Iterates over all connected sockets, optionally filtering on those that have subscribed to
a given subscription. This operation is synchronous.
- `each` - Iteration callback in the form `function(socket)`.
- `options` - Optional options object
    - `subscription` - When set to a string path, limits the results to sockets that are 
      subscribed to that path.
    - `user` - optional user filter. When provided, the `each` method will be invoked with
      authenticated sockets with `credentials.user` equal to  `user`. Requires the subscription
      `auth.index` options to be configured to `true`.

## Socket

An object representing a client connection.

### `socket.id`

A unique socket identifier.

### `socket.app`

An object used to store application state per socket. Provides a safe namespace to avoid conflicts
with the socket methods.

### `socket.auth`

The socket authentication state if any. Similar to the normal **hapi** `request.auth` object where:
- `isAuthenticated` - a boolean set to `true` when authenticated.
- `credentials` - the authentication credentials used.
- `artifacts` - authentication artifacts specific to the authentication strategy used.

### `socket.server`

The socket's server reference.

### `socket.connection`

The socket's connection reference.

### `socket.disconnect([callback])`

Closes a client connection where:
- `callback` - optional callback for when the connection is fully closed using the signature
  `function()`.

### `socket.send(message, [callback])`

Sends a custom message to the client where:
- `message` - the message sent to the client. Can be any type which can be safely converted to
  string using `JSON.stringify()`.
- `callback` - optional callback method using signature `function(err)` where:
    - `err` - an error condition.

### `socket.publish(path, message, [callback])`

Sends a subscription update to a specific client where:
- `path` - the subscription string. Note that if the client did not subscribe to the provided `path`,
  the client will ignore the update silently.
- `message` - the message sent to the client. Can be any type which can be safely converted to
  string using `JSON.stringify()`.
- `callback` - optional callback method using signature `function(err)` where:
    - `err` - an error condition.

### `socket.revoke(path, message, [callback])`

Revokes a subscription and optionally includes a last update where:
- `path` - the subscription string. Note that if the client is not subscribe to the provided `path`,
  the client will ignore the it silently.
- `message` - an optional last subscription update sent to the client. Can be any type which can be
  safely converted to string using `JSON.stringify()`. Pass `null` to revoke the subscription without
  sending a last update.
- `callback` - optional callback method using signature `function(err)` where:
    - `err` - an error condition.

## Request

The following decorations are available on each request received via the nes connection.

### `request.socket`

Provides access to the [`Socket`](#socket) object of the incoming connection.

## Client

The client implements the **nes** protocol and provides methods for interacting with the server.
It supports auto-connect by default as well as authentication.

### `new Client(url, [options])`

Creates a new client object where:
- `url` - the WebSocket address to connect to (e.g. `'wss://localhost:8000'`).
- `option` - optional configuration object where:
    - `ws` - available only when the client is used in node.js and passed as-is to the
      [**ws** module](https://www.npmjs.com/package/ws).
    - `timeout` - server response timeout in milliseconds. Defaults to `false` (no timeout).

### `client.onError`

A property used to set an error handler with the signature `function(err)`. Invoked whenever an
error happens that cannot be associated with a pending request with a callback.

### `client.onConnect`

A property used to set a handler for connection events (initial connection and subsequent
reconnections) with the signature `function()`.

### `client.onDisconnect`

A property used to set a handler for disconnection events with the signature `function(willReconnect, log)`
where:
- `willReconnect` - a boolean indicating if the client will automatically attempt to reconnect.
- `log` - an object with the following optional keys:
    - `code` - the [RFC6455](https://tools.ietf.org/html/rfc6455#section-7.4.1) status code.
    - `explanation` - the [RFC6455](https://tools.ietf.org/html/rfc6455#section-7.4.1) explanation for the
      `code`.
    - `reason` - a human-readable text explaining the reason for closing.
    - `wasClean` - if `false`, the socket was closed abnormally.

### `client.onUpdate`

A property used to set a custom message handler with the signature `function(message)`. Invoked whenever
the server calls `server.broadcast()` or `socket.send()`.

### `client.connect([options], callback)`

Connects the client to the server where:
- `options` - an optional configuration object with the following options:
    - `auth` - sets the credentials used to authenticate. when the server is configured for
      `'token'` type authentication, the value is the token response received from the
      authentication endpoint (called manually by the application). When the server is
      configured for `'direct'` type authentication, the value is the credentials expected
      by the server for the specified authentication strategy used which typically means an
      object with headers (e.g. `{ headers: { authorization: 'Basic am9objpzZWNyZXQ=' } }`).
    - `delay` - time in milliseconds to wait between each reconnection attempt. The delay time
      is cumulative, meaning that if the value is set to `1000` (1 second), the first wait will
      be 1 seconds, then 2 seconds, 3 seconds, until the `maxDelay` value is reached and then
      `maxDelay` is used.
    - `maxDelay` - the maximum delay time in milliseconds between reconnections.
    - `retries` - number of reconnection attempts. Defaults to `Infinity` (unlimited).
    - `timeout` - socket connection timeout in milliseconds. Defaults to the WebSocket
      implementation timeout default.
- `callback` - the server response callback using the signature `function(err)` where:
    - `err` - an error response.

### `client.disconnect()`

Disconnects the client from the server and stops future reconnects.

### `client.id`

The unique socket identifier assigned by the server. The value is set after the connection is
established.

### `client.request(options, callback)`

Sends an endpoint request to the server where:
- `options` - value can be one of:
    - a string with the requested endpoint path or route id (defaults to a GET method).
    - an object with the following keys:
        - `path` - the requested endpoint path or route id.
        - `method` - the requested HTTP method (can also be any method string supported by the
          server). Defaults to `'GET'`.
        - `headers` - an object where each key is a request header and the value the header
          content. Cannot include an Authorization header. Defaults to no headers.
        - `payload` - the request payload sent to the server.
- `callback` - the callback method using the signature `function(err, payload, statusCode, headers)`
  where:
    - `err` - the `Error` condition if the request failed.
    - `payload` - the server response object.
    - `statusCode` - the HTTP response status code.
    - `headers` - an object containing the HTTP response headers returned by the server (based on
      the server configuration).

### `client.message(message, callback)`

Sends a custom message to the server which is received by the server `onMessage` handler where:
- `message` - the message sent to the server. Can be any type which can be safely converted to
  string using `JSON.stringify()`.
- `callback` - the server response callback using the signature `function(err, message)` where:
    - `err` - an error response.
    - `message` - the server response if no error occurred.

### `client.subscribe(path, handler, callback)`

Subscribes to a server subscription where:
- `path` - the requested subscription path. Paths are just like HTTP request paths (e.g.
  `'/item/5'` or `'/updates'` based on the paths supported by the server).
- `handler` - the function used to receive subscription updates using the
  signature `function(message, flags)` where:
    - `message` - the subscription update sent by the server.
    - `flags` - an object with the following optional flags:
        - `revoked` - set to `true` when the message is the last update from the server due to
          a subscription revocation.
- `callback` - the callback function called when the subscription request was received by the server
  or failed to transmit using the signature `function(err)` where:
    - `err` - if present, indicates the subscription request has failed.

Note that when `subscribe()` is called before the client connects, any server errors will be
received via the `connect()` callback.

### `client.unsubscribe(path, handler, callback)`

Cancels a subscription where:
- `path` - the subscription path used to subscribe.
- `handler` - remove a specific handler from a subscription or `null` to remove all handlers for
  the given path.
- `callback` - the callback function called when the subscription request was received by the server
  or failed to transmit using the signature `function(err)` where:
    - `err` - if present, indicates the request has failed.

### `client.subscriptions()`

Returns an array of the current subscription paths.

### `client.overrideReconnectionAuth(auth)`

Sets or overrides the authentication credentials used to reconnect the client on disconnect when
the client is configured to automatically reconnect, where:
- `auth` - same as the `auth` option passed to [`client.connect()`](#clientconnectoptions-callback).

Returns `true` if reconnection is enabled, otherwise `false` (in which case the method was ignored).

### Errors

When a client callback or handler returns an error, the error is decorated with:
- `type` - a string indicating the source of the error where:
    - `'disconnect'` - the socket disconnected before the request completed.
    - `'protocol'` - the client received an invalid message from the server violating the protocol.
    - `'server'` - an error response sent from the server.
    - `'timeout'` - a timeout event.
    - `'user'` - user error (e.g. incorrect use of the API).
    - `'ws'` - a socket error.
