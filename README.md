<img src="https://raw.github.com/hapijs/nes/master/images/nes.png" />

**nes** adds native WebSocket support to [**hapi**](https://github.com/hapijs/hapi)-based application
servers. Instead of treating the WebSocket connections as a separate platform with its own security
and application context, **nes** builds on top of the existing **hapi** architecture to provide a
flexible and organic extension.

[![Build Status](https://secure.travis-ci.org/hapijs/nes.png)](http://travis-ci.org/hapijs/nes)

Lead Maintainer - [Eran Hammer](https://github.com/hueniverse)

## Examples

### Route invocation

#### Server

```js
var Hapi = require('hapi');
var Nes = require('nes');

var server = new Hapi.Server();
server.connection();

server.register(Nes, function (err) {

    server.route({
        method: 'GET',
        path: '/h',
        config: {
            id: 'hello',
            handler: function (request, reply) {

                return reply('world!');
            }
        }
    });

    server.start(function (err) { /* ... */ });
});
```

#### Client

```js
var Nes = require('nes');

var client = new Nes.Client('ws://localhost');
client.connect(function (err) {

    client.request('hello', function (err, payload) {   // Can also request '/h'

        // payload -> 'world!'
    });
});
```

### Subscriptions

#### Server

```js
var Hapi = require('hapi');
var Nes = require('nes');

var server = new Hapi.Server();
server.connection();

server.register(Nes, function (err) {

    server.subscription('/item/{id}');

    server.start(function (err) {
    
        server.publish('/item/5', { id: 5, status: 'complete' });
    });
});
```

#### Client

```js
var Nes = require('nes');

var client = new Nes.Client('ws://localhost');
client.connect(function (err) {

    client.subscribe('/item/5', function (err, update) {

        // update -> { id: 5, status: 'complete' }
    });
});
```

### Broadcast

#### Server

```js
var Hapi = require('hapi');
var Nes = require('nes');

var server = new Hapi.Server();
server.connection();

server.register(Nes, function (err) {

    server.start(function (err) {
    
        server.broadcast('welcome!');
    });
});
```

#### Client

```js
var Nes = require('nes');

var client = new Nes.Client('ws://localhost');
client.connect(function (err) {

    client.onBroadcast = function (update) {

        // update -> 'welcome!'
    });
});
```
