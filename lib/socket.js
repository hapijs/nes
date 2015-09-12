// Load modules

var Boom = require('boom');
var Hoek = require('hoek');
var Iron = require('iron');
var Items = require('items');


// Declare internals

var internals = {};


exports = module.exports = internals.Socket = function (ws, listener) {

    var self = this;

    this._ws = ws;
    this._listener = listener;
    this._helloed = false;
    this._subscriptions = {};

    this.id = this._listener._generateId();

    this.auth = {
        isAuthenticated: false,
        credentials: null,
        artifacts: null
    };

    ws.on('message', function (message) {

        return self._onMessage(message);
    });

    this._authenticate();
};


internals.Socket.prototype.disconnect = function () {

    this._ws.close();
};


internals.Socket.prototype._send = function (message) {

    var self = this;

    if (this._ws.readyState !== 1) {        // Open
        return;
    }

    internals.stringify(message, function (err, string) {

        if (err) {
            self._listener._connection.server.log(['nes', 'serialization', 'error'], message.type);

            if (message.id) {
                return self._error(Boom.internal('Failed serializing message'), message);
            }

            return;
        }

        self._ws.send(string);
    });
};


internals.Socket.prototype._error = function (err, request) {

    var self = this;

    err = Boom.wrap(err);

    var message = Hoek.clone(err.output);
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

    var self = this;

    internals.parse(message, function (err, request) {

        if (err ||
            !request.type) {

            return self._error(Boom.badRequest('Cannot parse message'), request);
        }

        if (!request.id) {
            return self._error(Boom.badRequest('Message missing id'), request);
        }

        // Initialization and Authentication

        if (request.type === 'hello') {
            return self._processHello(request);
        }

        if (!self._helloed) {
            return self._error(Boom.badRequest('Connection is not initialized'), request);
        }

        // Endpoint request

        if (request.type === 'request') {
            return self._processRequest(request);
        }

        // Custom message request

        if (request.type === 'message') {
            return self._processMessage(request);
        }

        // Subscriptions

        if (request.type === 'sub') {
            return self._processSubscription(request);
        }

        if (request.type === 'unsub') {
            var sub = self._subscriptions[request.path];
            if (sub) {
                sub.remove(self, request.path);
            }

            return;                             // Does not return a response
        }

        // Unknown

        return self._error(Boom.badRequest('Unknown message type'), request);
    });
};


internals.Socket.prototype._processHello = function (request) {

    var self = this;

    if (this._helloed) {
        return this._error(Boom.badRequest('Connection already initialized'), request);
    }

    if (!request.auth &&
        !this.auth.isAuthenticated &&
        this._listener._authRequired()) {

        return this._error(Boom.unauthorized('Connection requires authentication'), request);
    }

    if (request.auth &&
        this.auth.isAuthenticated) {

        return this._error(Boom.badRequest('Connection already authenticated'), request);
    }

    this._helloed = true;

    var response = {
        type: 'hello',
        id: request.id
    };

    if (!request.auth) {
        return this._processHelloSubscriptions(request, response);
    }

    var config = this._listener._settings.auth;
    if (config.type === 'direct') {
        this._listener._connection.inject({ url: config.endpoint, method: 'auth', headers: request.auth.headers, allowInternals: true }, function (res) {

            if (res.statusCode !== 200) {
                return self._error(Boom.unauthorized(), request);
            }

            self.auth = {
                isAuthenticated: true,
                credentials: res.result.credentials,
                artifacts: res.result.artifacts
            };

            return self._processHelloSubscriptions(request, response);
        });

        return;
    }

    Iron.unseal(request.auth, config.password, config.iron || Iron.defaults, function (err, credentials) {

        if (err) {
            return self._error(Boom.unauthorized('Invalid token'), request);
        }

        self.auth = {
            isAuthenticated: true,
            credentials: credentials,
            artifacts: null
        };

        return self._processHelloSubscriptions(request, response);
    });
};


internals.Socket.prototype._processHelloSubscriptions = function (request, response) {

    var self = this;

    var errors = [];
    var each = function (path, nextPath) {

        self._listener._subscribe(path, self, function (err) {

            if (err) {
                self._error(err, { type: 'sub', path: path });              // Keep going (do not include the id)
            }

            return nextPath();
        });
    };

    Items.serial(request.subs || [], each, function (err) {

        self._send(response);

        if (self._listener._settings.onConnection) {
            self._listener._settings.onConnection(self);
        }

        return;
    });
};


internals.Socket.prototype._processRequest = function (request) {

    var self = this;

    var method = request.method;
    if (!method) {
        return this._error(Boom.badRequest('Message missing method'), request);
    }

    var path = request.path;
    if (!path) {
        return this._error(Boom.badRequest('Message missing path'), request);
    }

    if (request.headers &&
        internals.caseInsensitiveKey(request.headers, 'authorization')) {

        return this._error(Boom.badRequest('Cannot include an Authorization header'), request);
    }

    if (path[0] !== '/') {              // Route id
        var route = this._listener._connection.lookup(path);
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

    var shot = {
        method: method,
        url: path,
        payload: request.payload,
        headers: request.headers,
        credentials: this.auth.credentials,
        artifacts: this.auth.artifacts
    };

    this._listener._connection.inject(shot, function (res) {

        var response = {
            type: 'request',
            id: request.id,
            statusCode: res.statusCode,
            payload: res.result,
            headers: self._filterHeaders(res.headers)
        };

        return self._send(response);
    });
};


internals.Socket.prototype._processMessage = function (request) {

    var self = this;

    if (!this._listener._settings.onMessage) {
        return this._error(Boom.notImplemented(), request);
    }

    this._listener._settings.onMessage(this, request.message, function (message) {

        if (message instanceof Error) {
            return self._error(message, request);
        }

        var response = {
            type: 'message',
            id: request.id,
            message: message
        };

        return self._send(response);
    });
};


internals.Socket.prototype._processSubscription = function (request) {

    var self = this;

    self._listener._subscribe(request.path, self, function (err) {

        if (err) {
            return self._error(err, request);
        }
    });
};


internals.Socket.prototype._authenticate = function () {

    var self = this;

    var config = this._listener._settings.auth;
    if (!config) {
        return;
    }

    var cookies = this._ws.upgradeReq.headers.cookie;
    if (!cookies) {
        return;
    }

    this._listener._connection.states.parse(cookies, function (err, state, failed) {

        var auth = state[config.cookie];
        if (auth) {
            self.auth = {
                isAuthenticated: true,
                credentials: auth.credentials,
                artifacts: auth.artifacts
            };
        }
    });
};


internals.Socket.prototype._filterHeaders = function (headers) {

    var filter = this._listener._settings.headers;
    if (!filter) {
        return undefined;
    }

    if (filter === '*') {
        return headers;
    }

    var filtered = {};
    var fields = Object.keys(headers);
    for (var i = 0, il = fields.length; i < il; ++i) {
        var field = fields[i];
        if (filter.indexOf(field.toLowerCase()) !== -1) {
            filtered[field] = headers[field];
        }
    }

    return filtered;
};


internals.parse = function (message, next) {

    var obj = null;
    var error = null;

    try {
        obj = JSON.parse(message);
    }
    catch (err) {
        error = err;
    }

    return next(error, obj);
};


internals.stringify = function (message, next) {

    var string = null;
    var error = null;

    try {
        string = JSON.stringify(message);
    }
    catch (err) {
        error = err;
    }

    return next(error, string);
};


internals.caseInsensitiveKey = function (object, key) {

    var keys = Object.keys(object);
    for (var i = 0, il = keys.length; i < il; ++i) {
        var current = keys[i];
        if (key === current.toLowerCase()) {
            return object[current];
        }
    }

    return undefined;
};
