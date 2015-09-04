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


internals.Socket.prototype.send = function (message, type) {

    var self = this;

    if (this._ws.readyState !== 1) {        // Open
        return;
    }

    var response = Hoek.shallow(message.isBoom ? message.output : message);
    response.nes = response.nes || type || 'response';

    internals.stringify(response, function (err, string) {

        if (err) {
            return self.send(Boom.internal('Failed serializing message'), response.nes);
        }

        self._ws.send(string);
    });
};


internals.Socket.prototype.onMessage = function (message) {

    var self = this;

    internals.parse(message, function (err, request) {

        if (err) {
            return self.send(Boom.badRequest('Cannot parse message'));
        }

        if (!request.id) {
            return self.send(Boom.badRequest('Message missing id'));
        }

        var response = {
            id: request.id
        };

        // Endpoint request

        if (request.nes === 'request') {
            if (!request.method) {
                return self.send(Boom.badRequest('Message missing method'));
            }

            if (!request.path) {
                return self.send(Boom.badRequest('Message missing path'));
            }

            var shot = {
                method: request.method,
                url: request.path,
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

                self.send(response);
            });

            return;
        }

        // Authentication

        if (request.nes === 'auth') {
            response.nes = 'auth';
            if (!request.token) {
                response.error = 'Authentication missing token';
                return self.send(response);
            }

            if (self._auth.credentials) {
                response.error = 'Connection already authenticated';
                return self.send(response);
            }

            var config = self._listener._settings.auth;
            Iron.unseal(request.token, config.password, config.iron || Iron.defaults, function (err, credentials) {

                if (err) {
                    response.error = 'Invalid token';
                    return self.send(response);
                }

                self._auth = credentials;
                return self.send(response);
            });

            return;
        }

        // Unknown

        return self.send(Boom.badRequest('Unknown message type'));
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
