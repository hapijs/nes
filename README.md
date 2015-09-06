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
        server.publish('/item/6', { id: 6, status: 'initial' });
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
        // Second publish is not received (doesn't match)
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

    // Setup HTTP Basic authentication

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
client.connect({ headers: { authorization: 'Basic am9objpzZWNyZXQ=' } }, function (err) {

    client.request('hello', function (err, payload) {   // Can also request '/h'

        // payload -> 'Hello John Doe'
    });
});
```
