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


internals.Socket.prototype._send = function (message, options) {

    var self = this;

    options = options || {};

    if (this._ws.readyState !== 1) {        // Open
        return;
    }

    var response = Hoek.shallow(message.isBoom ? message.output : message);
    response.type = options.type || response.type || 'response';
    if (options.id) {
        response.id = options.id;
    }

    internals.stringify(response, function (err, string) {

        if (err) {
            self._listener._connection.server.log(['nes', 'serialization', 'error'], response.type);

            if (options.id) {
                return self._send(Boom.internal('Failed serializing message'), { type: response.type, id: options.id });
            }

            return;
        }

        self._ws.send(string);
    });
};


internals.Socket.prototype._onMessage = function (message) {

    var self = this;

    internals.parse(message, function (err, request) {

        if (err ||
            !request.type) {

            return self._send(Boom.badRequest('Cannot parse message'));
        }

        if (!request.id) {
            return self._send(Boom.badRequest('Message missing id'));
        }

        // Initialization and Authentication

        if (request.type === 'hello') {
            return self._processHello(request);
        }

        if (!self._helloed) {
            return self._send({ type: request.type, id: request.id, error: 'Connection is not initialized' });
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
            return;                             // Does not return a response
        }

        // Unknown

        return self._send(Boom.badRequest('Unknown message type'), { id: request.id });
    });
};


internals.Socket.prototype._processHello = function (request) {

    var self = this;

    var response = {
        type: 'hello',
        id: request.id
    };

    if (this._helloed) {
        response.error = 'Connection already initialized';
        return this._send(response);
    }

    if (!request.auth &&
        !this.auth.isAuthenticated &&
        this._listener._authRequired()) {

        response.error = 'Connection requires authentication';
        return this._send(response);
    }

    if (request.auth &&
        this.auth.isAuthenticated) {

        response.error = 'Connection already authenticated';
        return this._send(response);
    }

    this._helloed = true;

    if (!request.auth) {
        return this._processHelloSubscriptions(request, response);
    }

    var config = this._listener._settings.auth;
    if (config.type === 'direct') {
        this._listener._connection.inject({ url: config.endpoint, method: 'auth', headers: request.auth.headers, allowInternals: true }, function (res) {

            if (res.statusCode !== 200) {
                response.error = 'Unauthorized';
                return self._send(response);
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
            response.error = 'Invalid token';
            return self._send(response);
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
                errors.push({ path: path, error: err.message });
            }

            return nextPath();
        });
    };

    Items.serial(request.subs || [], each, function (err) {

        if (errors.length) {
            response.subs = errors;
        }

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
        return this._send(Boom.badRequest('Message missing method'), { id: request.id });
    }

    var path = request.path;
    if (!path) {
        return this._send(Boom.badRequest('Message missing path'), { id: request.id });
    }

    if (path[0] !== '/') {              // Route id
        var route = this._listener._connection.lookup(path);
        if (!route) {
            return this._send(Boom.notFound(), { id: request.id });
        }

        path = route.path;
        method = route.method;

        if (method === '*') {
            return this._send(Boom.badRequest('Cannot use route id with wildcard method route config'), { id: request.id });
        }
    }

    if (this._listener._settings.auth &&
        path === this._listener._settings.auth.endpoint) {

        return this._send(Boom.notFound(), { id: request.id });
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
            type: 'response',
            id: request.id,
            statusCode: res.statusCode,
            payload: res.result,
            headers: res.headers
        };

        return self._send(response);
    });
};


internals.Socket.prototype._processMessage = function (request) {

    var self = this;

    if (!this._listener._settings.onMessage) {
        return this._send({ type: 'message', id: request.id, error: 'Custom messages are not supported' });
    }

    var response = {
        type: 'message',
        id: request.id
    };

    this._listener._settings.onMessage(this, request.message, function (message) {

        if (message instanceof Error) {
            response.error = message.message;
        }
        else {
            response.message = message;
        }

        return self._send(response);
    });
};


internals.Socket.prototype._processSubscription = function (request) {

    var self = this;

    var response = {
        type: 'sub',
        id: request.id,
        path: request.path
    };

    self._listener._subscribe(request.path, self, function (err) {

        if (err) {
            response.error = err.message;
        }

        return self._send(response);
    });
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
