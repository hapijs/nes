// Load modules

var Boom = require('boom');
var Hoek = require('hoek');


// Declare internals

var internals = {};


exports = module.exports = internals.Connection = function (ws, server) {

    var self = this;

    this._ws = ws;
    this._server = server;

    ws.on('message', function (message) {

        return self.onMessage(message);
    });
};


internals.Connection.prototype.send = function (message, type) {

    var self = this;

    var response = Hoek.shallow(message.isBoom ? message.output : message);
    response.type = response.type || type || 'response';

    internals.stringify(response, function (err, string) {

        if (err) {
            return self.send(Boom.internal('Failed serializing message'), response.type);
        }

        self._ws.send(string);
    });
};


internals.Connection.prototype.onMessage = function (message) {

    var self = this;

    internals.parse(message, function (err, request) {

        if (err) {
            return self.send(Boom.badRequest('Cannot parse message'));
        }

        if (!request.method) {
            return self.send(Boom.badRequest('Message missing method'));
        }

        if (!request.path) {
            return self.send(Boom.badRequest('Message missing path'));
        }

        self._server.inject({ method: request.method, url: request.path }, function (res) {

            self.send({ statusCode: res.statusCode, payload: res.result, headers: res.headers });
        });
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
