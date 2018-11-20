<img src="https://raw.github.com/hapijs/nes/master/images/nes.png" />

**nes** adds native WebSocket support to [**hapi**](https://github.com/hapijs/hapi)-based application
servers. Instead of treating the WebSocket connections as a separate platform with its own security
and application context, **nes** builds on top of the existing **hapi** architecture to provide a
flexible and organic extension.

Protocol version: 2.4.x (different from module version)

[![Build Status](https://secure.travis-ci.org/hapijs/nes.svg)](http://travis-ci.org/hapijs/nes)

Lead Maintainer - [Matt Harrison](https://github.com/mtharrison)

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
const Hapi = require('hapi');
const Nes = require('nes');

const server = new Hapi.Server();

const start = async () => {

    await server.register(Nes);
    server.route({
        method: 'GET',
        path: '/h',
        config: {
            id: 'hello',
            handler: (request, h) => {

                return 'world!';
            }
        }
    });

    await server.start();
};

start();
```

#### Client

```js
const Nes = require('nes');

var client = new Nes.Client('ws://localhost');

const start = async () => {

    await client.connect();
    const payload = await client.request('hello');  // Can also request '/h'
    // payload -> 'world!'
};

start();
```

### Subscriptions

#### Server

```js
const Hapi = require('hapi');
const Nes = require('nes');

const server = new Hapi.Server();

const start = async () => {

    await server.register(Nes);
    server.subscription('/item/{id}');
    await server.start();
    server.publish('/item/5', { id: 5, status: 'complete' });
    server.publish('/item/6', { id: 6, status: 'initial' });
};

start();
```

#### Client

```js
const Nes = require('nes');

const client = new Nes.Client('ws://localhost');
const start = async () => {

    await client.connect();
    const handler = (update, flags) => {

        // update -> { id: 5, status: 'complete' }
        // Second publish is not received (doesn't match)
    };

    client.subscribe('/item/5', handler);
};

start();
```

### Broadcast

#### Server

```js
const Hapi = require('hapi');
const Nes = require('nes');

const server = new Hapi.Server();

const start = async () => {

    await server.register(Nes);
    await server.start();
    server.broadcast('welcome!');
};

start();
```

#### Client

```js
const Nes = require('nes');

const client = new Nes.Client('ws://localhost');
const start = async () => {

    await client.connect();
    client.onUpdate = (update) => {

        // update -> 'welcome!'
    };
};

start();
```

### Route authentication

#### Server

```js
const Hapi = require('hapi');
const Basic = require('hapi-auth-basic');
const Bcrypt = require('bcrypt');
const Nes = require('nes');

const server = new Hapi.Server();

const start = async () => {

    await server.register([Basic, Nes]);

    // Set up HTTP Basic authentication

    const users = {
        john: {
            username: 'john',
            password: '$2a$10$iqJSHD.BGr0E2IxQwYgJmeP3NvhPrXAeLSaGCj6IR/XU5QtjVu5Tm',   // 'secret'
            name: 'John Doe',
            id: '2133d32a'
        }
    };

    const validate = async (request, username, password) => {

        const user = users[username];
        if (!user) {
            return { isValid: false };
        }

        const isValid = await Bcrypt.compare(password, user.password);
        const  credentials = { id: user.id, name: user.name };
        return { isValid, credentials };
    };

    server.auth.strategy('simple', 'basic', { validate });

    // Configure route with authentication

    server.route({
        method: 'GET',
        path: '/h',
        config: {
            id: 'hello',
            handler: (request, h) => {

                return `Hello ${request.auth.credentials.name}`;
            }
        }
    });

    await server.start();
};

start();
```

#### Client

```js
const Nes = require('nes');

const client = new Nes.Client('ws://localhost');
const start = async () => {

    await client.connect({ auth: { headers: { authorization: 'Basic am9objpzZWNyZXQ=' } } });
    const payload = await client.request('hello')  // Can also request '/h'
    // payload -> 'Hello John Doe'
};

start();
```

### Subscription filter

#### Server

```js
const Hapi = require('hapi');
const Basic = require('hapi-auth-basic');
const Bcrypt = require('bcrypt');
const Nes = require('nes');

const server = new Hapi.Server();

const start = async () => {

    await server.register([Basic, Nes]);

    // Set up HTTP Basic authentication

    const users = {
        john: {
            username: 'john',
            password: '$2a$10$iqJSHD.BGr0E2IxQwYgJmeP3NvhPrXAeLSaGCj6IR/XU5QtjVu5Tm',   // 'secret'
            name: 'John Doe',
            id: '2133d32a'
        }
    };

    const validate = async (request, username, password) => {

        const user = users[username];
        if (!user) {
            return { isValid: false };
        }

        const isValid = await Bcrypt.compare(password, user.password);
        const  credentials = { id: user.id, name: user.name };
        return { isValid, credentials };
    };

    server.auth.strategy('simple', 'basic', 'required', { validate });

    // Set up subscription

    server.subscription('/items', {
        filter: (path, message, options) => {

            return (message.updater !== options.credentials.username);
        }
    });

    await server.start();
    server.publish('/items', { id: 5, status: 'complete', updater: 'john' });
    server.publish('/items', { id: 6, status: 'initial', updater: 'steve' });
};

start();
```

#### Client

```js
const Nes = require('nes');

const client = new Nes.Client('ws://localhost');

// Authenticate as 'john'

const start = async () => {

    await client.connect({ auth: { headers: { authorization: 'Basic am9objpzZWNyZXQ=' } } });
    const handler = (err, update) => {

        // First publish is not received (filtered due to updater key)
        // update -> { id: 6, status: 'initial', updater: 'steve' }
    };

    client.subscribe('/items', handler);
};

start();
```

### Browser Client

When you `require('nes')` it loads the full module and adds a lot of extra code that is not needed
for the browser. The browser will only need the **nes** client. If you are using CommonJS you can
load the client with `require('nes/client')`.
