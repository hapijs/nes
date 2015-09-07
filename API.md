# 0.3.x API Reference

- [Registration](#registration)
- [Server](#server)
    - [`server.broadcast(message)`](#serverbroadcastmessage)
    - [`server.subscription(path, [options])`](#serversubscriptionpath-options)
    - [`server.publish(path, message)`](#serverpublishpath-message)
- [Client](#client)
    - [`new Client([options], callback)`](#new-clientoptions-callback)
- [`client.onError`](#clientonerror)
- [`client.onConnect`](#clientonconnect)
- [`client.onBroadcast`](#clientonbroadcast)
- [`client.connect([options], callback)`](#clientconnectoptions-callback)
- [`client.disconnect()`](#clientdisconnect)
- [`client.request(options, callback)`](#clientrequestoptions-callback)
- [`client.message(data, callback)`](#clientmessagedata-callback)
- [`client.authenticate(credentials, callback)`](#clientauthenticatecredentials-callback)
- [`client.subscribe(path, handler)`](#clientsubscribepath-handler)
- [`client.unsubscribe(path, [handler])`](#clientunsubscribepath-handler)
- [`client.subscriptions()`](#clientsubscriptions)

## Registration

The **nes** plugin uses the standard **hapi** registration process using the `server.register()`
method. The plugin accepts the following optional registration options:
- `onConnect` - a function with the signature `function(ws)` invoked for each incoming client
  connection where:
    - `ws` - the WebSocket connection object.
- `onMessage` - a function with the signature `function(message, next)` used to receive custom
  client messages (when the client calls [`client.message()`](#clientmessagedata-callback)) where:
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
              internally by the plugin when the client provides its authentication credentials (via
              [`client.authenticate()`](#clientauthenticatecredentials-callback) or by passing an `auth`
              option to [`client.connect()](#clientconnectoptions-callback)). The endpoint returns a
              copy of the credentials object (along with any artifacts) to the plugin which is then
              used for all subsequent client requests and subscriptions. This type requires exposing the
              underlying credentials to the application. This is the default value.
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
              token which the client can use to authenticate the connection by passing it to the
              [`client.authenticate()`](#clientauthenticatecredentials-callback) method or by passing
              an `auth` option to [`client.connect()](#clientconnectoptions-callback) with the token.
              This type is useful when the client-side application needs to manage its credentials
              differently than relying on cookies (e.g. non-browser clients).
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

## Client

### `new Client([options], callback)`

### `client.onError`

### `client.onConnect`

### `client.onBroadcast`

### `client.connect([options], callback)`

### `client.disconnect()`

### `client.request(options, callback)`

### `client.message(data, callback)`

### `client.authenticate(credentials, callback)`

### `client.subscribe(path, handler)`

### `client.unsubscribe(path, [handler])`

### `client.subscriptions()`



