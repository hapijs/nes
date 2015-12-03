# nes Protocol v2.0.x

## Message

The nes protocol consists of JSON messages sent between the client and server.

Each incoming request from the client to the server contains:
- `type` - the message type:
    - `'ping'` - heartbeat response.
    - `'hello'` - connection initialization and authentication.
    - `'request'` - endpoint request.
    - `'sub'` - subscribe to a path.
    - `'unsub'` - unsubscribe from a path.
    - `'message'` - send custom message.
- `id` - a unique per-client request id (number or string).
- additional type-specific fields.

Each outgoing request from the server to the client contains:
- `type` - the message type:
    - `'ping'` - heartbeat request.
    - `'hello'` - connection initialization and authentication.
    - `'request'` - endpoint request.
    - `'sub'` - subscribe to a path.
    - `'message'` - send custom message.
    - `'update'` - an custom message push from the server.
    - `'pub'` - a subscription update.
- additional type-specific fields.

## Errors

When a message indicates an error, the message will include in addition to the message-specific fields:
- `statusCode` - an HTTP equivalent status code (4xx, 5xx).
- `headers` - optional headers related to the request.
- `payload` - the error details which include:
    - `error` - the HTTP equivalent error message.
    - `message` - a description of the error.
    - additional error-specific fields.

For example:

```js
{
    type: 'hello',
    id: 1,
    statusCode: 401,
    payload: {
        error: 'Unauthorized',
        message: 'Unknown username or incorrect password'
    }
}
```

## Heartbeat

Flow: `server` -> `client` -> `server`

For cases where it is not possible for the TCP connection to determine if the connection is still active,
the server sends a heartbeat message to the client every configured interval, and then expects the client
to respond within a configured timeout. The server sends:
- `type` - set to `'ping'`.

For example:

```js
{
    type: 'ping'
}
```

When the client receives the message, it sends back:
- `type` - set to `'ping'`.
- `id` - a unique per-client request id (number or string).

For example:

```js
{
    type: 'ping',
    id: 6
}
```

## Hello

Flow: `client` -> `server` -> `client`

Every client connection must first be initialized with a `hello` message. The client sends a message to the server
with the following:
- `type` - set to `'hello'`.
- `id` - a unique per-client request id (number or string).
- `version` - set to `'2'`.
- `auth` - optional authentication credentials. Can be any value understood by the server.
- `subs` - an optional array of strings indicating the path subscriptions the client is interested in.

For example:

```js
{
    type: 'hello',
    id: 1,
    version: '2',
    auth: {
        headers: {
            authorization: 'Basic am9objpzZWNyZXQ='
        }
    },
    subs: ['/a', '/b']
}
```

The server respond by sending a message back with the following:
- `type` - set to `'hello'`.
- `id` - the same `id` received from the client.
- `heartbeat` - the server heartbeat configuration which can be:
    - `false` - no heartbeats will be sent.
    - an object with:
        - `interval` - the heartbeat interval in milliseconds.
        - `timeout` - the time from sending a heartbeat to the client until a response is expected
          before a connection is considered closed by the server.
- `socket` - the server generated socket identifier for the connection.

Note: the client should assume the connection is closed if it has not heard from the server in
heartbeat.interval + heartbeat.timeout.

For example:

```js
{
    type: 'hello',
    id: 1,
    heartbeat: {
        interval: 15000,
        timeout: 5000
    },
    socket: 'abc-123'
}
```

If the request failed (including subscription errors), the server includes the [standard error fields](#errors).

For example:

```js
{
    type: 'hello',
    id: 1,
    statusCode: 401,
    payload: {
        error: 'Unauthorized',
        message: 'Unknown username or incorrect password'
    }
}
```

If the request fails due to a subscription error, the server will include the failed subscription path in the response:
- `path` - the requested path which failed to subscribe.

For example:

```js
{
    type: 'hello',
    id: 1,
    path: '/a',
    statusCode: 403,
    payload: {
        error: 'Subscription not found'
    }
}
```

## Request

Flow: `client` -> `server` -> `client`

Request a resource from the server where:
- `type` - set to `'request'`.
- `id` - a unique per-client request id (number or string).
- `method` - the corresponding HTTP method (e.g. `'GET'`).
- `path` - the requested resource (can be an HTTP path of resource name).
- `headers` - an optional object with the request headers (each header name is a key with a corresponding value).
- `payload` - an optional value to send with the request.

For example:

```js
{
    type: 'request',
    id: 2,
    method: 'POST',
    path: '/item/5',
    payload: {
        id: 5,
        status: 'done'
    }
}
```

The server response includes:
- `type` - set to `'request'`.
- `id` - the same `id` received from the client.
- `statusCode` - an HTTP equivalent status code.
- `payload` - the requested resource.
- `headers` - optional headers related to the request (e.g. `{ 'content-type': 'text/html; charset=utf-8' }').

For example:

```js
{
    type: 'request',
    id: 2,
    statusCode: 200,
    payload: {
        status: 'ok'
    }
}
```

If the request fails, the `statusCode`, `headers`, and `payload` fields will comply with the
[standard error values](#errors).

## Message

Flow: `client` -> `server` [-> `client`]

Sends a custom message to the server where:
- `type` - set to `'message'`.
- `id` - a unique per-client request id (number or string).
- `message` - any value (string, object, etc.).

For example:

```js
{
    type: 'message',
    id: 3,
    message: 'hi'
}
```

The server response includes:
- `type` - set to `'message'`.
- `id` - the same `id` received from the client.
- `message` - any value (string, object, etc.).

For example:

```js
{
    type: 'message',
    id: 3,
    message: 'hello back'
}
```

If the request fails, the response will include the [standard error fields](#errors).


## Subscribe

Flow: `client` -> `server` [-> `client`]

Sends a subscription request to the server:
- `type` - set to `'sub'`.
- `id` - a unique per-client request id (number or string).
- `path` - the requested subscription path.

For example:

```js
{
    type: 'sub',
    id: 4,
    path: '/box/blue'
}
```

The server response includes:
- `type` - set to `'sub'`.
- `id` - the same `id` received from the client.
- `path` - the requested path which failed to subscribe.
- the [standard error fields](#errors) if failed.

For example:

```js
{
    type: 'sub',
    id: 4,
    path: '/box/blue',
    statusCode: 403,
    payload: {
        error: 'Forbidden'
    }
}
```

## Unsubscribe

Flow: `client` -> `server`

Unsubscribe from a server subscription:
- `type` - set to `'unsub'`.
- `id` - a unique per-client request id (number or string).
- `path` - the subscription path.

For example:

```js
{
    type: 'unsub',
    id: 5,
    path: '/box/blue'
}
```

There is no server response.

## Update

Flow: `server` -> `client`

A custom message sent from the server to a specific client or to all connected clients:
- `type` - set to `'update'`.
- `message` - any value (string, object, etc.).

```js
{
    type: 'update',
    message: {
        some: 'message'
    }
}
```

## Publish

Flow: `server` -> `client`

A message sent from the server to all subscribed clients:
- `type` - set to `'pub'`.
- `path` - the subscription path.
- `message` - any value (string, object, etc.).

```js
{
    type: 'pub',
    path: '/box/blue',
    message: {
        status: 'closed'
    }
}
```
