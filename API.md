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

## Server

### `server.broadcast(message)`

### `server.subscription(path, [options])`

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



