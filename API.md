# 0.4.x API Reference

- [Registration](#registration)
- [Server](#server)
    - [`server.broadcast(message)`](#serverbroadcastmessage)
    - [`server.subscription(path, [options])`](#serversubscriptionpath-options)
    - [`server.publish(path, message)`](#serverpublishpath-message)
- [Socket](#socket)
    - [`socket.id`](#socketid)
    - [`socket.auth`](#socketauth)
    - [`socket.disconnect()`](#socketdisconnect)
- [Client](#client)
    - [`new Client(url, [options])`](#new-clienturl-options)
    - [`client.onError`](#clientonerror)
    - [`client.onConnect`](#clientonconnect)
    - [`client.onDisconnect`](#clientondisconnect)
    - [`client.onBroadcast`](#clientonbroadcast)
    - [`client.connect([options], callback)`](#clientconnectoptions-callback)
    - [`client.disconnect()`](#clientdisconnect)
    - [`client.request(options, callback)`](#clientrequestoptions-callback)
    - [`client.message(message, callback)`](#clientmessagemessage-callback)
    - [`client.subscribe(path, handler)`](#clientsubscribepath-handler)
    - [`client.unsubscribe(path, [handler])`](#clientunsubscribepath-handler)
    - [`client.subscriptions()`](#clientsubscriptions)

## Registration

The **nes** plugin uses the standard **hapi** registration process using the `server.register()`
method. The plugin accepts the following optional registration options:
- `onConnect` - a function with the signature `function(ws)` invoked for each incoming client
  connection where:
    - `ws` - the WebSocket connection object.
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
              exposing the underlying credentials to the application. This is the default value.
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
        - `ttl` - the cookie expiration milliseconds when using type `'cookie'`. Defaults to current session only.
- `headers` - an optional array of header field names to include in server responses to the client.
  If set to `'*'` (without an array), allows all headers. Defaults to `null` (no headers).

## Server

The plugin decorates the server with a few new methods for interacting with the incoming WebSocket
connections.

### `server.broadcast(message)`

Sends a message to all connected clients where:
- `message` - the message sent to the clients. Can be any type which can be safely converted to
  string using `JSON.stringify()`.

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
            - `credentials` - the client credentials if authenticated.
            - `params` - the parameters parsed from the publish message path is the subscription
              path contains parameters.
        - `next` - the continuation method using signature `function(isMatch)` where:
            - `isMatch` - a boolean to indicate if the published message should be sent to the
              current client where `true` means the message will be sent.
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

### `server.publish(path, message)`

Sends a message to all the subscribed clients where:
- `path` - the subscription path. The path is matched first against the available subscriptions
  added via `server.subscription()` and then against the specific path provided by each client
  at the time of registration (only matter when the subscription path contains parameters). When
  a match is found, the subscription `filter` function is called (if present) to further filter
  which client should receive which update.
- `message` - the message sent to the clients. Can be any type which can be safely converted to
  string using `JSON.stringify()`.

## Socket

An object representing a client connection.

### `socket.id`

A unique socket identifier.

### `socket.auth`

The socket authentication state if any. Similar to the normal **hapi** `request.auth` object where:
- `isAuthenticated` - a boolean set to `true` when authenticated.
- `credentials` - the authentication credentials used.
- `artifacts` - authentication artifacts specific to the authentication strategy used.

### `socket.disconnect()`

Closes a client connection.

## Client

The client implements the **nes** protocol and provides methods for interacting with the server.
It supports auto-connect by default as well as authentication.

### `new Client(url, [options])`

Creates a new client object where:
- `url` - the WebSocket address to connect to (e.g. `'wss://localhost:8000'`).
- `option` - optional configuration object available only when the client is used in node.js
  and passed as-is to the [**ws** module](https://www.npmjs.com/package/ws).

### `client.onError`

A property used to set an error handler with the signature `function(err)`. Invoked whenever an
error happens that cannot be associated with a pending request with a callback.

### `client.onConnect`

A property used to set a handler for connection events (initial connection and subsequent
reconnections) with the signature `function()`.

### `client.onDisconnect`

A property used to set a handler for disconnection events with the signature `function(willReconnect)`
where:
- `willReconnect` - a boolean indicating if the client will automatically attempt to reconnect.

### `client.onBroadcast`

A property used to set a broadcast handler with the signature `function(message)`. Invoked whenever
the server calls `server.broadcast()`.

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
- `callback` - the server response callback using the signature `function(err)` where:
    - `err` - an error response.

### `client.disconnect()`

Disconnects the client from the server and stops future reconnects.

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

### `client.message(message, callback)`

Sends a custom message to the server which is received by the server `onMessage` handler where:
- `message` - the message sent to the server. Can be any type which can be safely converted to
  string using `JSON.stringify()`.
- `callback` - the server response callback using the signature `function(err, message)` where:
    - `err` - an error response.
    - `message` - the server response if no error occurred.

### `client.subscribe(path, handler)`

Subscribes to a server subscription where:
- `path` - the requested subscription path. Paths are just like HTTP request paths (e.g.
  `'/item/5'` or `'/updates'` based on the paths supported by the server).
- `handler` - the function used to receive subscription updates and errors using the
  signature `function(err, message)` where:
    - `err` - if present, indicates the subscription request has failed and the handler
      will not be called again.
    - `message` - the subscription update sent by the server.

### `client.unsubscribe(path, [handler])`

Cancels a subscription where:
- `path` - the subscription path used to subscribe.
- `handler` - an optional handler used to remove a specific handler from a subscription.
  Defaults to `null` which removes all existing handlers for the given path.

### `client.subscriptions()`

Returns an array of the current subscription paths.
