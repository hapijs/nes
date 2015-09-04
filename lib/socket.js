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
    this._auth = {
        credentials: null,
        artifects: null
    };

    ws.on('message', function (message) {

        return self.onMessage(message);
    });
};


internals.Socket.prototype.send = function (message, options) {

    var self = this;

    options = options || {};

    if (this._ws.readyState !== 1) {        // Open
        return;
    }

    var response = Hoek.shallow(message.isBoom ? message.output : message);
    response.nes = options.type || response.nes || 'response';
    if (options.id) {
        response.id = options.id;
    }

    internals.stringify(response, function (err, string) {

        if (err) {
            self._listener._connection.server.log(['nes', 'serialization', 'error'], response.nes);

            if (options.id) {
                return self.send(Boom.internal('Failed serializing message'), { type: response.nes, id: options.id });
            }

            return;
        }

        self._ws.send(string);
    });
};


internals.Socket.prototype.onMessage = function (message) {

    var self = this;

    internals.parse(message, function (err, request) {

        if (err ||
            !request.nes) {

            if (self._listener._settings.onUnknownMessage) {
                return self._listener._settings.onUnknownMessage(message, self._ws);
            }

            return self.send(Boom.badRequest('Cannot parse message'));
        }

        if (!request.id) {
            return self.send(Boom.badRequest('Message missing id'));
        }

        // Initialization and Authentication

        if (request.nes === 'hello') {
            return self._processHello(request);
        }

        // Endpoint request

        if (request.nes === 'request') {
            return self._processRequest(request);
        }

        // Subscriptions

        if (request.nes === 'sub') {
            return self._processSubscription(request);
        }

        if (request.nes === 'unsub') {
            return;                             // Does not return a response
        }

        // Unknown

        return self.send(Boom.badRequest('Unknown message type'), { id: request.id });
    });
};


internals.Socket.prototype._processHello = function (request) {

    var self = this;

    var response = {
        nes: 'hello',
        id: request.id
    };

    if (!request.auth) {
        return this._processHelloSubscriptions(request, response);
    }

    if (this._auth.credentials) {
        response.error = 'Connection already authenticated';
        return this.send(response);
    }

    var config = this._listener._settings.auth;
    if (config.type === 'direct') {
        this._listener._connection.inject({ url: config.endpoint, headers: request.auth.headers }, function (res) {

            if (res.statusCode !== 200) {
                response.error = 'Unauthorized';
                return self.send(response);
            }

            self._auth = res.result;
            return self._processHelloSubscriptions(request, response);
        });

        return;
    }

    Iron.unseal(request.auth, config.password, config.iron || Iron.defaults, function (err, credentials) {

        if (err) {
            response.error = 'Invalid token';
            return self.send(response);
        }

        self._auth = credentials;
        return self._processHelloSubscriptions(request, response);
    });
};


internals.Socket.prototype._processHelloSubscriptions = function (request, response) {

    var self = this;

    var errors = [];
    var each = function (path, nextPath) {

        self._listener.subscribe(path, self, function (err) {

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

        return self.send(response);
    });
};


internals.Socket.prototype._processRequest = function (request) {

    var self = this;

    var method = request.method;
    if (!method) {
        return this.send(Boom.badRequest('Message missing method'), { id: request.id });
    }

    var path = request.path;
    if (!path) {
        return this.send(Boom.badRequest('Message missing path'), { id: request.id });
    }

    if (path[0] !== '/') {              // Route id
        var route = this._listener._connection.lookup(path);
        if (!route) {
            return this.send(Boom.notFound(), { id: request.id });
        }

        path = route.path;
        method = route.method;

        if (method === '*') {
            return this.send(Boom.badRequest('Cannot use route id with wildcard method route config'), { id: request.id });
        }
    }

    if (this._listener._settings.auth &&
        path === this._listener._settings.auth.endpoint) {

        return this.send(Boom.notFound(), { id: request.id });
    }

    var shot = {
        method: method,
        url: path,
        payload: request.payload,
        headers: request.headers,
        credentials: this._auth.credentials,
        artifects: this._auth.artifects
    };

    this._listener._connection.inject(shot, function (res) {

        var response = {
            nes: 'response',
            id: request.id,
            statusCode: res.statusCode,
            payload: res.result,
            headers: res.headers
        };

        return self.send(response);
    });
};


internals.Socket.prototype._processSubscription = function (request) {

    var self = this;

    var response = {
        nes: 'sub',
        id: request.id,
        path: request.path
    };

    self._listener.subscribe(request.path, self, function (err) {

        if (err) {
            response.error = err.message;
        }

        return self.send(response);
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


internals.Socket.prototype.authenticate = function (next) {

    var self = this;

    var config = this._listener._settings.auth;
    if (!config) {
        return next();
    }

    var cookies = this._ws.upgradeReq.headers.cookie;
    if (!cookies) {
        return next();
    }

    this._listener._connection.states.parse(cookies, function (err, state, failed) {

        var auth = state[config.cookie];
        if (auth) {
            self._auth = auth;
        }

        return next();
    });
};
