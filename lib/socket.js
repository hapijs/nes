'use strict';

// Load modules

const Boom = require('boom');
const Hoek = require('hoek');
const Iron = require('iron');
const Items = require('items');


// Declare internals

const internals = {
    version: '2'
};


exports = module.exports = internals.Socket = function (ws, listener) {

    this._ws = ws;
    this._listener = listener;
    this._helloed = false;
    this._pinged = false;
    this._subscriptions = {};

    this.id = this._listener._generateId();
    this.app = {};
    this.auth = {
        isAuthenticated: false,
        credentials: null,
        artifacts: null
    };

    ws.on('message', (message) => this._onMessage(message));
    this._authenticate();
};


internals.Socket.prototype.disconnect = function () {

    this._ws.close();
};


internals.Socket.prototype.send = function (message) {

    const response = {
        type: 'update',
        message: message
    };

    return this._send(response);
};


internals.Socket.prototype._send = function (message) {

    if (this._ws.readyState !== 1) {        // Open
        return;
    }

    internals.stringify(message, (err, string) => {

        if (err) {
            this._listener._connection.server.log(['nes', 'serialization', 'error'], message.type);

            if (message.id) {
                return this._error(Boom.internal('Failed serializing message'), message);
            }

            return;
        }

        this._ws.send(string);
    });
};


internals.Socket.prototype._error = function (err, request) {

    err = Boom.wrap(err);

    const message = Hoek.clone(err.output);
    delete message.payload.statusCode;
    message.headers = this._filterHeaders(message.headers);

    if (request) {
        message.type = request.type;
        message.id = request.id;
        message.path = request.path;
    }

    return this._send(message);
};


internals.Socket.prototype._onMessage = function (message) {

    internals.parse(message, (err, request) => {

        if (err ||
            !request.type) {

            return this._error(Boom.badRequest('Cannot parse message'), request);
        }

        if (!request.id) {
            return this._error(Boom.badRequest('Message missing id'), request);
        }

        // Initialization and Authentication

        if (request.type === 'ping') {
            this._pinged = true;
            return;
        }

        if (request.type === 'hello') {
            return this._processHello(request);
        }

        if (!this._helloed) {
            return this._error(Boom.badRequest('Connection is not initialized'), request);
        }

        // Endpoint request

        if (request.type === 'request') {
            return this._processRequest(request);
        }

        // Custom message request

        if (request.type === 'message') {
            return this._processMessage(request);
        }

        // Subscriptions

        if (request.type === 'sub') {
            return this._processSubscription(request);
        }

        if (request.type === 'unsub') {
            return this._processUnsubscribe(request);           // Does not return a response
        }

        // Unknown

        return this._error(Boom.badRequest('Unknown message type'), request);
    });
};


internals.Socket.prototype._processHello = function (request) {

    if (this._helloed) {
        return this._error(Boom.badRequest('Connection already initialized'), request);
    }

    if (request.version !== internals.version) {
        return this._error(Boom.badRequest('Incorrect protocol version (expected ' + internals.version + ' but received ' + (request.version || 'none') + ')'), request);
    }

    if (!request.auth &&
        !this.auth.isAuthenticated &&
        this._listener._authRequired()) {

        return this._error(Boom.unauthorized('Connection requires authentication'), request);
    }

    if (request.auth &&
        this.auth.isAuthenticated) {        // Authenticated using a cookie during upgrade

        return this._error(Boom.badRequest('Connection already authenticated'), request);
    }

    this._helloed = true;                   // Prevents the client from reusing the socket if erred (leaves socket open to ensure client gets the error response)

    const response = {
        type: 'hello',
        id: request.id,
        heartbeat: this._listener._settings.heartbeat,
        socket: this.id
    };

    if (!request.auth) {
        return this._processHelloSubscriptions(request, response);
    }

    const config = this._listener._settings.auth;
    if (config.type === 'direct') {
        const route = this._listener._connection.lookup(config.id);
        this._listener._connection.inject({ url: route.path, method: 'auth', headers: request.auth.headers, allowInternals: true }, (res) => {

            if (res.statusCode !== 200) {
                return this._error(Boom.unauthorized(res.result.message), request);
            }

            this.auth = {
                isAuthenticated: true,
                credentials: res.result.credentials,
                artifacts: res.result.artifacts
            };

            return this._processHelloSubscriptions(request, response);
        });

        return;
    }

    Iron.unseal(request.auth, config.password, config.iron || Iron.defaults, (err, credentials) => {

        if (err) {
            return this._error(Boom.unauthorized('Invalid token'), request);
        }

        this.auth = {
            isAuthenticated: true,
            credentials: credentials,
            artifacts: null
        };

        return this._processHelloSubscriptions(request, response);
    });
};


internals.Socket.prototype._processHelloSubscriptions = function (request, response) {

    const each = (path, nextPath) => {

        this._listener._subscribe(path, this, (err) => {

            if (err) {
                err.path = path;
            }

            return nextPath(err);
        });
    };

    Items.serial(request.subs || [], each, (err) => {

        if (err) {
            return this._error(err, { type: 'hello', id: request.id, path: err.path });
        }

        if (this._listener._settings.onConnection) {
            this._listener._settings.onConnection(this);
        }

        return this._send(response);
    });
};


internals.Socket.prototype._processRequest = function (request) {

    let method = request.method;
    if (!method) {
        return this._error(Boom.badRequest('Message missing method'), request);
    }

    let path = request.path;
    if (!path) {
        return this._error(Boom.badRequest('Message missing path'), request);
    }

    if (request.headers &&
        internals.caseInsensitiveKey(request.headers, 'authorization')) {

        return this._error(Boom.badRequest('Cannot include an Authorization header'), request);
    }

    if (path[0] !== '/') {              // Route id
        const route = this._listener._connection.lookup(path);
        if (!route) {
            return this._error(Boom.notFound(), request);
        }

        path = route.path;
        method = route.method;

        if (method === '*') {
            return this._error(Boom.badRequest('Cannot use route id with wildcard method route config'), request);
        }
    }

    if (this._listener._settings.auth &&
        path === this._listener._settings.auth.endpoint) {

        return this._error(Boom.notFound(), request);
    }

    const shot = {
        method: method,
        url: path,
        payload: request.payload,
        headers: request.headers,
        credentials: this.auth.credentials,
        artifacts: this.auth.artifacts,
        plugins: {
            nes: {
                socket: this
            }
        }
    };

    this._listener._connection.inject(shot, (res) => {

        const response = {
            type: 'request',
            id: request.id,
            statusCode: res.statusCode,
            payload: res.result,
            headers: this._filterHeaders(res.headers)
        };

        return this._send(response);
    });
};


internals.Socket.prototype._processMessage = function (request) {

    if (!this._listener._settings.onMessage) {
        return this._error(Boom.notImplemented(), request);
    }

    this._listener._settings.onMessage(this, request.message, (message) => {

        if (message instanceof Error) {
            return this._error(message, request);
        }

        const response = {
            type: 'message',
            id: request.id,
            message: message
        };

        return this._send(response);
    });
};


internals.Socket.prototype._processSubscription = function (request) {

    this._listener._subscribe(request.path, this, (err) => {

        if (err) {
            return this._error(err, request);
        }

        const response = {
            type: 'sub',
            id: request.id,
            path: request.path
        };

        return this._send(response);
    });
};


internals.Socket.prototype._processUnsubscribe = function (request) {

    const sub = this._subscriptions[request.path];
    if (sub) {
        sub.remove(this, request.path);
        delete this._subscriptions[request.path];
    }
};


internals.Socket.prototype._authenticate = function () {

    const config = this._listener._settings.auth;
    if (!config) {
        return;
    }

    const cookies = this._ws.upgradeReq.headers.cookie;
    if (!cookies) {
        return;
    }

    this._listener._connection.states.parse(cookies, (err, state, failed) => {

        const auth = state[config.cookie];
        if (auth) {
            this.auth = {
                isAuthenticated: true,
                credentials: auth.credentials,
                artifacts: auth.artifacts
            };
        }
    });
};


internals.Socket.prototype._filterHeaders = function (headers) {

    const filter = this._listener._settings.headers;
    if (!filter) {
        return undefined;
    }

    if (filter === '*') {
        return headers;
    }

    const filtered = {};
    const fields = Object.keys(headers);
    for (let i = 0; i < fields.length; ++i) {
        const field = fields[i];
        if (filter.indexOf(field.toLowerCase()) !== -1) {
            filtered[field] = headers[field];
        }
    }

    return filtered;
};


internals.parse = function (message, next) {

    let obj = null;
    let error = null;

    try {
        obj = JSON.parse(message);
    }
    catch (err) {
        error = err;
    }

    return next(error, obj);
};


internals.stringify = function (message, next) {

    let string = null;
    let error = null;

    try {
        string = JSON.stringify(message);
    }
    catch (err) {
        error = err;
    }

    return next(error, string);
};


internals.caseInsensitiveKey = function (object, key) {

    const keys = Object.keys(object);
    for (let i = 0; i < keys.length; ++i) {
        const current = keys[i];
        if (key === current.toLowerCase()) {
            return object[current];
        }
    }

    return undefined;
};
