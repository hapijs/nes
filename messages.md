# Messages

## General

All messages on the channel have the `type` field which is used to identify the expected behavior. Valid values to the server include `hello`, ``sub`, `unsub`, `request`, `message`. Valid values to the client include `hello`, `broadcast`, `pub`, `sub`, `response`, and `message`. All other message types are considered a protocol error.

Most client -> server messages support the `id` parameter, which can be used to identify the message's response from the server. This value may be any valid JSON value and the server will simply echo this back to the client with the associated response.

## Handshake

Client -> Server. Sent when the client first connects and wishes to perform authentication and setup initial subscriptions. This message may only be sent once for a given connection.

```
{
  id: callbackId,
  type: 'hello',
  auth: Object,
  subs: ['path', 'path']
}
```

When the authentication mode is `direct`, the `auth` field is an object containing the headers that needs to be passed to the server's authentication tier, ex:

```
  auth: {
    headers: {
      Authorization: 'Bearer SuperSecret'
    }
  }
```

Other authentication modes must pass the result from the nes authentication endpoint.

The optional `subs` array provides a list of all subscription paths that have been registered prior to connection.

Response:

```
{
  id: callbackId
  error: 'Optional Error message'
  subs: 
```


## Broadcast

Server -> Client. Sent when the server wishes to send a message to all clients.

```
{
  type: 'broadcast',
  message: JSONObject
}
```

The `message` field may be any arbitrary JSON object.


## Subscribe

Client -> Server. Registers a subscription for the client on the server. This should be done only once for a given route that the client is concerned about. Routing the message to multiple callbacks on the same client should be done within the client rather than through multiple requests from the server.

```
{
  type: 'sub',
  path: '/example/value'
}
```

Response:

```
{
  type: 'sub',
  error: Optional Error message'
}
```

## Unsubscribe

Client -> Server. Unregisters a previously registered subscription. This message has not response from the server and is assumed to always be successful.

```
{
  type: 'sub',
  path: '/example/value'
}
```

Response: None

## Request

Client -> Server. Primary action sent from the client. This executes a given hapi route on the server.

```
{
  type: 'request',
  id: callbackId,
  method: 'httpMethod',
  path: '/route/path',
  headers: httpHeadersObject,
  payload: JSONObject
}
```

Response:
```
{
  type: 'response',
  id: callbackId,
  statusCode: httpStatusCode,
  payload: JSONObject
  headers:  httpHeadersObject
}
```

The `headers` fields is a key value set defining the HTTP headers that would be sent if this were a HTTP request. Ex:
```
  headers: { 'content-type': 'text/html; charset=utf-8' }
```

The `payload` field maybe be a string or an arbitrary JSON object as returned by the server.


## Custom Message

Client -> Server. Sends an arbitrary custom message to the server. This will be handled by the `onMessage` callback supplied to the hes plugin options. If no option was provided, the server will send back an error to the client.

```
{
  type: 'message',
  id: callbackId,
  message: JSONObject
}
```

Response:

```
{
  type: 'message',
  id: callbackId,
  error: 'Optional Error message',
  message: JSONObject
}
```

The `message` field may be any arbitrary JSON object.
