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
    filter: Joi.func(),                                             // function (credentials, update, next) - update can be null
    auth: {
        scope: Joi.array().items(Joi.string()).single().min(1),
        entity: Joi.valid('user', 'app', 'any')
    }
});


internals.Listener.subscription = function (path, options) {

    options = options || {};

    Hoek.assert(path, 'Subscription missing path');

    var route = {
        method: 'sub',
        path: path
    };

    var config = {
        subscribers: [],                        // { socket, path }
        filter: options.filter,
        auth: options.auth
    };

    var connections = this.connections;
    for (var i = 0, il = connections.length; i < il; ++i) {
        var connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener._router.add(route, config);
        }
    }
};


internals.Listener.publish = function (path, update) {

    Hoek.assert(path && path[0] === '/', 'Missing or invalid subscription path:', path || 'empty');

    var connections = this.connections;
    for (var i = 0, il = connections.length; i < il; ++i) {
        var connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener.publish(path, update);
        }
    }
};


internals.Listener.prototype.publish = function (path, update) {

    var config = this._router.route('sub', path);
    if (config.isBoom) {
        return;
    }

    var route = config.route;
    var actives = this._sockets;
    var subscribers = route.subscribers;

    var live = [];
    for (var i = 0, il = subscribers.length; i < il; ++i) {
        var subscribed = subscribers[i];
        var socket = subscribed.socket;
        if (actives.indexOf(socket) === -1) {
            continue;                                                       // Will cause the subscriber to be removed from the array
        }

        // TODO Check for auth and filter

        socket.send({ nes: 'pub', path: subscribed.path, message: update });
        live.push(subscribed);
    }

    route.subscribers = live;
};


internals.Listener.prototype.subscribe = function (path, socket, next) {

    var config = this._router.route('sub', path);
    if (config.isBoom) {
        return next(Boom.notFound());
    }

    // TODO Check for auth and filter

    config.route.subscribers.push({ socket: socket, path: path });
    return next();
};
