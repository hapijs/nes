<img src="https://raw.github.com/hapijs/nes/master/images/nes.png" />

**nes** adds native WebSocket support to [**hapi**](https://github.com/hapijs/hapi)-based application
servers. Instead of treating the WebSocket connections as a separate platform with its own security
and application context, **nes** builds on top of the existing **hapi** architecture to provide a
flexible and organic extension.

Protocol version: 2.0.x

[![Build Status](https://secure.travis-ci.org/hapijs/nes.svg)](http://travis-ci.org/hapijs/nes)

Lead Maintainer - [Eran Hammer](https://github.com/hueniverse)

- [API](#api)
- [Protocol](#protocol)
- [Examples](#examples)
    - [Route invocation](#route-invocation)
    - [Subscriptions](#subscriptions)
    - [Broadcast](#broadcast)
    - [Route authentication](#route-authentication)
    - [Subscription filter](#subscription-filter)
- [Browser Client](#browser-client)

## API

The full client and server API is available in the [API documentation](https://github.com/hapijs/nes/blob/master/API.md).

## Protocol

The **nes** protocol is described in the [Protocol documentation](https://github.com/hapijs/nes/blob/master/PROTOCOL.md).

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
        server.publish('/item/6', { id: 6, status: 'initial' });
    });
});
```

#### Client

```js
var Nes = require('nes');

var client = new Nes.Client('ws://localhost');
client.connect(function (err) {

    var handler = function (update) {

        // update -> { id: 5, status: 'complete' }
        // Second publish is not received (doesn't match)
    };

    client.subscribe('/item/5', handler, function (err) { });
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

    client.onUpdate = function (update) {

        // update -> 'welcome!'
    };
});
```

### Route authentication

#### Server

```js
var Hapi = require('hapi');
var Basic = require('hapi-auth-basic');
var Bcrypt = require('bcrypt');
var Nes = require('nes');

var server = new Hapi.Server();
server.connection();

server.register([Basic, Nes], function (err) {

    // Set up HTTP Basic authentication

    var users = {
        john: {
            username: 'john',
            password: '$2a$10$iqJSHD.BGr0E2IxQwYgJmeP3NvhPrXAeLSaGCj6IR/XU5QtjVu5Tm',   // 'secret'
            name: 'John Doe',
            id: '2133d32a'
        }
    };

    var validate = function (request, username, password, callback) {

        var user = users[username];
        if (!user) {
            return callback(null, false);
        }

        Bcrypt.compare(password, user.password, function (err, isValid) {

            callback(err, isValid, { id: user.id, name: user.name });
        });
    };

    server.auth.strategy('simple', 'basic', 'required', { validateFunc: validate });

    // Configure route with authentication

    server.route({
        method: 'GET',
        path: '/h',
        config: {
            id: 'hello',
            handler: function (request, reply) {

                return reply('Hello ' + request.auth.credentials.name);
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
client.connect({ auth: { headers: { authorization: 'Basic am9objpzZWNyZXQ=' } } }, function (err) {

    client.request('hello', function (err, payload) {   // Can also request '/h'

        // payload -> 'Hello John Doe'
    });
});
```

### Subscription filter

#### Server

```js
var Hapi = require('hapi');
var Basic = require('hapi-auth-basic');
var Bcrypt = require('bcrypt');
var Nes = require('nes');

var server = new Hapi.Server();
server.connection();

server.register([Basic, Nes], function (err) {

    // Set up HTTP Basic authentication

    var users = {
        john: {
            username: 'john',
            password: '$2a$10$iqJSHD.BGr0E2IxQwYgJmeP3NvhPrXAeLSaGCj6IR/XU5QtjVu5Tm',   // 'secret'
            name: 'John Doe',
            id: '2133d32a'
        }
    };

    var validate = function (request, username, password, callback) {

        var user = users[username];
        if (!user) {
            return callback(null, false);
        }

        Bcrypt.compare(password, user.password, function (err, isValid) {

            callback(err, isValid, { id: user.id, name: user.name, username: user.username });
        });
    };

    server.auth.strategy('simple', 'basic', 'required', { validateFunc: validate });

    // Set up subscription

    server.subscription('/items', {
        filter: function (path, message, options, next) {

            return next(message.updater !== options.credentials.username);
        }
    });

    server.start(function (err) {

        server.publish('/items', { id: 5, status: 'complete', updater: 'john' });
        server.publish('/items', { id: 6, status: 'initial', updater: 'steve' });
    });
});
```

#### Client

```js
var Nes = require('nes');

var client = new Nes.Client('ws://localhost');

// Authenticate as 'john'

client.connect({ auth: { headers: { authorization: 'Basic am9objpzZWNyZXQ=' } } }, function (err) {

    var handler = function (err, update) {

        // First publish is not received (filtered due to updater key)
        // update -> { id: 6, status: 'initial', updater: 'steve' }
    };

    client.subscribe('/items', handler, function (err) { });
});
```

### Browser Client

When you `require('nes')` it loads the full module and adds a lot of extra code that is not needed for the browser. The browser will only need the **nes** client. If you are using CommonJS you can load the client with `require('nes/client')`.
