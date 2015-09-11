// Load modules

var Boom = require('boom');
var Call = require('call');
var Hoek = require('hoek');
var Joi = require('joi');
var Ws = require('ws');
var Socket = require('./socket');


// Declare internals

var internals = {
    counter: {
        min: 10000,
        max: 99999
    }
};


exports = module.exports = internals.Listener = function (connection, settings) {

    var self = this;

    this._connection = connection;
    this._settings = settings;
    this._sockets = new internals.Sockets();
    this._router = new Call.Router();
    this._authRoute = this._settings.auth && connection.lookup(this._settings.auth.id);
    this._socketCounter = internals.counter.min;

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

    this._sockets.add(socket);

    ws.once('close', function (code, message) {

        self._sockets.remove(socket);
        var subs = Object.keys(socket._subscriptions);
        for (var i = 0, il = subs.length; i < il; ++i) {
            var subscribers = socket._subscriptions[subs[i]];
            subscribers.remove(socket);
        }
    });
};


internals.Listener.prototype._close = function () {

    this._wss.close();
};


internals.Listener.prototype._authRequired = function () {

    if (!this._authRoute) {
        return false;
    }

    var auth = this._connection.auth.lookup(this._authRoute);
    if (!auth) {
        return false;
    }

    return auth.mode === 'required';
};


internals.Listener.broadcast = function (message) {

    var update = {
        type: 'broadcast',
        message: message
    };

    var connections = this.connections;
    for (var i = 0, il = connections.length; i < il; ++i) {
        var connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener._broadcast(update);
        }
    }
};


internals.Listener.prototype._broadcast = function (update) {

    this._sockets.forEach(function (socket) {

        socket._send(update);
    });
};


internals.subSchema = Joi.object({
    filter: Joi.func(),                                             // function (path, update, options, next), where options: { credentials, params }
    auth: Joi.object({
        mode: Joi.string().valid('required', 'optional'),
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
        subscribers: new internals.Subscribers(),
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
        type: 'pub',
        path: path,
        message: update
    };

    var connections = this.connections;
    for (var i = 0, il = connections.length; i < il; ++i) {
        var connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener._publish(path, message);
        }
    }
};


internals.Listener.prototype._publish = function (path, update) {

    var sub = this._router.route('sub', path);
    if (sub.isBoom) {
        return;
    }

    var route = sub.route;
    route.subscribers.forEach(sub.paramsArray.length ? path : null, function (socket) {     // Filter on path if has parameters

        if (!route.filter) {
            socket._send(update);
        }
        else {
            route.filter(path, update.message, { credentials: socket.auth.credentials, params: sub.params }, function (isMatch) {

                if (isMatch) {
                    return socket._send(update);
                }
            });
        }
    });
};


internals.Listener.prototype._subscribe = function (path, socket, next) {

    if (path.indexOf('?') !== -1) {
        return next(Boom.badRequest('Subscription path cannot contain query'));
    }

    if (socket._subscriptions[path]) {
        return next(Boom.badRequest('Client already subscribed'));
    }

    var match = this._router.route('sub', path);
    if (match.isBoom) {
        return next(Boom.notFound());
    }

    var auth = this._connection.auth.lookup({ settings: { auth: match.route.auth } });         // Create a synthetic route
    if (auth) {
        var credentials = socket.auth.credentials;
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

    match.route.subscribers.add(socket, path);
    socket._subscriptions[path] = match.route.subscribers;
    return next();
};


internals.Listener.prototype._generateId = function () {

    var id = Date.now() + ':' + this._connection.info.id + ':' + this._socketCounter++;
    if (this._socketCounter > internals.counter.max) {
        this._socketCounter = internals.counter.min;
    }

    return id;
};


// Sockets manager

internals.Sockets = function () {

    this._items = {};
};


internals.Sockets.prototype.add = function (socket) {

    this._items[socket.id] = socket;
};


internals.Sockets.prototype.remove = function (socket) {

    delete this._items[socket.id];
};


internals.Sockets.prototype.forEach = function (each) {

    var items = Object.keys(this._items);
    for (var i = 0, il = items.length; i < il; ++i) {
        each(this._items[items[i]]);
    }
};


// Subscribers manager

internals.Subscribers = function () {

    this._items = {};
};


internals.Subscribers.prototype.add = function (socket, path) {

    var item = this._items[socket.id];
    if (item) {
        item.paths.push(path);
    }
    else {
        this._items[socket.id] = { socket: socket, paths: [path] };
    }
};


internals.Subscribers.prototype.remove = function (socket, path) {

    if (!path) {
        delete this._items[socket.id];
        return;
    }

    var item = this._items[socket.id];
    if (!item) {
        return;
    }

    var pos = item.paths.indexOf(path);
    if (pos === -1) {
        return;
    }

    if (item.paths.length === 1) {
        delete this._items[socket.id];
        return;
    }

    item.paths.splice(pos, 1);
};


internals.Subscribers.prototype.forEach = function (path, each) {

    var items = Object.keys(this._items);
    for (var i = 0, il = items.length; i < il; ++i) {
        var item = this._items[items[i]];
        if (!path ||
            item.paths.indexOf(path) !== -1) {

            each(item.socket);
        }
    }
};
