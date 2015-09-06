// Load modules

var Boom = require('boom');
var Call = require('call');
var Hoek = require('hoek');
var Joi = require('joi');
var Ws = require('ws');
var Socket = require('./socket');


// Declare internals

var internals = {};


exports = module.exports = internals.Listener = function (connection, settings) {

    var self = this;

    this._connection = connection;
    this._settings = settings;
    this._sockets = [];
    this._router = new Call.Router();

    // WebSocket listener

    this._wss = new Ws.Server({ server: connection.listener });

    this._wss.on('connection', function (ws) {

        self._add(ws);
    });

    this._wss.on('error', function (err) {

    });

    // Register with connection

    connection.plugins.nes = {
        _listener: this
    };
};


internals.Listener.prototype._add = function (ws) {

    var self = this;

    // Socket object

    var socket = new Socket(ws, this);

    // Subscriptions

    self._sockets.push(socket);

    ws.once('close', function (code, message) {

        self._sockets.splice(self._sockets.indexOf(socket), 1);
    });

    // Authentication

    socket.authenticate(function () {

        if (self._settings.onConnect) {
            self._settings.onConnect(ws);
        }
    });
};


internals.Listener.prototype.close = function () {

    this._wss.close();
};


internals.Listener.broadcast = function (message) {

    var update = {
        nes: 'broadcast',
        message: message
    };

    var connections = this.connections;
    for (var i = 0, il = connections.length; i < il; ++i) {
        var connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener.broadcast(update);
        }
    }
};


internals.Listener.prototype.broadcast = function (update) {

    var sockets = this._sockets;
    for (var i = 0, il = sockets.length; i < il; ++i) {
        var socket = sockets[i];
        socket.send(update);
    }
};


internals.subSchema = Joi.object({
    filter: Joi.func(),                                             // function (path, update, options, next), where options: { credentials, params }
    auth: Joi.object({
        mode: Joi.string().valid('required', 'optional', 'try'),
        scope: Joi.array().items(Joi.string()).single().min(1),
        entity: Joi.valid('user', 'app', 'any')
    })
        .allow(false)
});


internals.Listener.subscription = function (path, options) {

    Hoek.assert(path, 'Subscription missing path');
    Joi.assert(options, internals.subSchema, 'Invalid subscription options: ' + path);

    var settings = Hoek.clone(options || {});

    // Auth configuration

    var auth = settings.auth;
    if (auth) {
        if (auth.scope) {
            if (typeof auth.scope === 'string') {
                auth.scope = [auth.scope];
            }

            for (var i = 0, il = auth.scope.length; i < il; ++i) {
                if (/{([^}]+)}/.test(auth.scope[i])) {
                    auth.hasScopeParameters = true;
                    break;
                }
            }
        }

        auth.mode = auth.mode || 'required';
    }

    // Path configuration

    var route = {
        method: 'sub',
        path: path
    };

    var config = {
        subscribers: [],                        // { socket, path }
        filter: settings.filter,
        auth: auth
    };

    var connections = this.connections;
    for (var c = 0, cl = connections.length; c < cl; ++c) {
        var connection = connections[c];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener._router.add(route, config);
        }
    }
};


internals.Listener.publish = function (path, update) {

    Hoek.assert(path && path[0] === '/', 'Missing or invalid subscription path:', path || 'empty');

    var message = {
        nes: 'pub',
        path: path,
        message: update
    };

    var connections = this.connections;
    for (var i = 0, il = connections.length; i < il; ++i) {
        var connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener.publish(path, message);
        }
    }
};


internals.Listener.prototype.publish = function (path, update) {

    var sub = this._router.route('sub', path);
    if (sub.isBoom) {
        return;
    }

    var route = sub.route;
    var actives = this._sockets;
    var subscribers = route.subscribers;

    var live = [];
    for (var i = 0, il = subscribers.length; i < il; ++i) {
        var subscribed = subscribers[i];
        var socket = subscribed.socket;
        if (actives.indexOf(socket) === -1) {
            continue;
        }

        // Keep active socket in subscription

        live.push(subscribed);

        // Validate path matches

        if (!sub.paramsArray.length ||                                      // Literal path
            subscribed.path === path) {                                     // Exact parameterized match

            if (!route.filter) {
                socket.send(update);
            }
            else {
                route.filter(path, update.message, { credentials: socket._auth.credentials, params: sub.params }, internals.send(socket, update));
            }
        }
    }

    route.subscribers = live;
};


internals.send = function (socket, update) {

    return function (isMatch) {

        if (isMatch) {
            return socket.send(update);
        }
    };
};


internals.Listener.prototype.subscribe = function (path, socket, next) {

    if (path.indexOf('?') !== -1) {
        return next(Boom.badRequest('Subscription path cannot contain query'));
    }

    var match = this._router.route('sub', path);
    if (match.isBoom) {
        return next(Boom.notFound());
    }

    var auth = this._connection.auth.lookup({ settings: { auth: match.route.auth } });         // Create a synthetic route
    if (auth) {
        var credentials = socket._auth.credentials;
        if (credentials) {

            // Check scope

            if (auth.scope) {
                var scopes = auth.scope;
                if (auth.hasScopeParameters) {
                    scopes = [];
                    var context = { params: match.params };
                    for (var i = 0, il = auth.scope.length; i < il; ++i) {
                        scopes[i] = Hoek.reachTemplate(context, auth.scope[i]);
                    }
                }

                if (!credentials.scope ||
                    (typeof credentials.scope === 'string' ? scopes.indexOf(credentials.scope) === -1 : !Hoek.intersect(scopes, credentials.scope).length)) {

                    return next(Boom.forbidden('Insufficient scope, expected any of: ' + scopes));
                }
            }

            // Check entity

            var entity = auth.entity || 'any';
            if (entity === 'user' &&
                !credentials.user) {

                return next(Boom.forbidden('Application credentials cannot be used on a user subscription'));
            }

            if (entity === 'app' &&
                credentials.user) {

                return next(Boom.forbidden('User credentials cannot be used on an application subscription'));
            }
        }
        else if (auth.mode === 'required') {
            return next(Boom.unauthorized());
        }
    }

    match.route.subscribers.push({ socket: socket, path: path });
    return next();
};
