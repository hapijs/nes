// Load modules

var Boom = require('boom');
var Hoek = require('hoek');
var Iron = require('iron');


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

        var response = {
            id: request.id
        };

        // Initialization and Authentication

        if (request.nes === 'hello') {
            response.nes = 'hello';

            if (!request.auth) {
                return self.send(response);
            }

            if (self._auth.credentials) {
                response.error = 'Connection already authenticated';
                return self.send(response);
            }

            var config = self._listener._settings.auth;
            if (config.type === 'direct') {
                self._listener._connection.inject({ url: config.endpoint, headers: request.auth.headers }, function (res) {

                    if (res.statusCode !== 200) {
                        response.error = 'Unauthorized';
                        return self.send(response);
                    }

                    self._auth = res.result;
                    return self.send(response);
                });

                return;
            }

            Iron.unseal(request.auth, config.password, config.iron || Iron.defaults, function (err, credentials) {

                if (err) {
                    response.error = 'Invalid token';
                    return self.send(response);
                }

                self._auth = credentials;
                return self.send(response);
            });

            return;
        }

        // Endpoint request

        if (request.nes === 'request') {
            var method = request.method;
            if (!method) {
                return self.send(Boom.badRequest('Message missing method'), { id: request.id });
            }

            var path = request.path;
            if (!path) {
                return self.send(Boom.badRequest('Message missing path'), { id: request.id });
            }

            if (path[0] !== '/') {              // Route id
                var route = self._listener._connection.lookup(path);
                if (!route) {
                    return self.send(Boom.notFound(), { id: request.id });
                }

                path = route.path;
                method = route.method;

                if (method === '*') {
                    return self.send(Boom.badRequest('Cannot use route id with wildcard method route config'), { id: request.id });
                }
            }

            if (self._listener._settings.auth &&
                path === self._listener._settings.auth.endpoint) {

                return self.send(Boom.notFound(), { id: request.id });
            }

            var shot = {
                method: method,
                url: path,
                payload: request.payload,
                headers: request.headers,
                credentials: self._auth.credentials,
                artifects: self._auth.artifects
            };

            self._listener._connection.inject(shot, function (res) {

                response.nes = 'response';
                response.statusCode = res.statusCode;
                response.payload = res.result;
                response.headers = res.headers;

                return self.send(response);
            });

            return;
        }

        // Subscriptions

        if (request.nes === 'sub') {
            response.nes = 'sub';
            response.criterion = request.criterion;
            response.error = 'Not yet supported';
            return self.send(response);
        }

        if (request.nes === 'unsub') {
            return;                             // Does not return a response
        }

        // Unknown

        return self.send(Boom.badRequest('Unknown message type'), { id: request.id });
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
