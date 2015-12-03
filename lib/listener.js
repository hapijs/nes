'use strict';

// Load modules

const Boom = require('boom');
const Call = require('call');
const Hoek = require('hoek');
const Joi = require('joi');
const Ws = require('ws');
const Socket = require('./socket');


// Declare internals

const internals = {
    counter: {
        min: 10000,
        max: 99999
    }
};


exports = module.exports = internals.Listener = function (connection, settings) {

    this._connection = connection;
    this._settings = settings;
    this._sockets = new internals.Sockets();
    this._router = new Call.Router();
    this._authRoute = this._settings.auth && connection.lookup(this._settings.auth.id);
    this._socketCounter = internals.counter.min;
    this._heartbeat = null;
    this._timeout = null;

    // WebSocket listener

    this._wss = new Ws.Server({ server: connection.listener });

    this._wss.on('connection', (ws) => {

        this._add(ws);
    });

    this._wss.on('error', (err) => {

    });

    // Register with connection

    connection.plugins.nes = {
        _listener: this
    };

    // Start heartbeats

    this._beat();
};


internals.Listener.prototype._add = function (ws) {

    // Socket object

    const socket = new Socket(ws, this);

    // Subscriptions

    this._sockets.add(socket);

    ws.once('close', (code, message) => {

        this._sockets.remove(socket);
        const subs = Object.keys(socket._subscriptions);
        for (let i = 0; i < subs.length; ++i) {
            const subscribers = socket._subscriptions[subs[i]];
            subscribers.remove(socket);
        }

        socket._subscriptions = {};

        if (this._settings.onDisconnection) {
            this._settings.onDisconnection(socket);
        }
    });
};


internals.Listener.prototype._close = function () {

    clearTimeout(this._heartbeat);
    clearTimeout(this._timeout);

    this._wss.close();
};


internals.Listener.prototype._authRequired = function () {

    if (!this._authRoute) {
        return false;
    }

    const auth = this._connection.auth.lookup(this._authRoute);
    if (!auth) {
        return false;
    }

    return auth.mode === 'required';
};


internals.Listener.prototype._beat = function () {

    if (!this._settings.heartbeat) {
        return;
    }

    if (this._heartbeat &&                              // Skip the first time
        this._sockets.length()) {

        // Send heartbeats

        const update = {
            type: 'ping'
        };

        this._sockets.forEach((socket) => {

            socket._send(update);
        });

        // Verify client responded

        this._timeout = setTimeout(() => {

            this._sockets.forEach((socket) => {

                if (!socket._pinged) {
                    socket.disconnect();
                }

                socket._pinged = false;
            });
        }, this._settings.heartbeat.timeout);
    }

    // Schedule next heartbeat

    this._heartbeat = setTimeout(() => {

        this._beat();
    }, this._settings.heartbeat.interval);
};


internals.Listener.broadcast = function (message) {

    const update = {
        type: 'update',
        message: message
    };

    const connections = this.connections;
    for (let i = 0; i < connections.length; ++i) {
        const connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener._broadcast(update);
        }
    }
};


internals.Listener.prototype._broadcast = function (update) {

    this._sockets.forEach((socket) => {

        socket._send(update);
    });
};


internals.subSchema = Joi.object({
    filter: Joi.func(),                                             // function (path, update, options, next), where options: { credentials, params }
    onSubscribe: Joi.func(),                                        // function (socket)
    onUnsubscribe: Joi.func(),                                      // function (socket)
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

    const settings = Hoek.clone(options || {});

    // Auth configuration

    const auth = settings.auth;
    if (auth) {
        if (auth.scope) {
            if (typeof auth.scope === 'string') {
                auth.scope = [auth.scope];
            }

            for (let i = 0; i < auth.scope.length; ++i) {
                if (/{([^}]+)}/.test(auth.scope[i])) {
                    auth.hasScopeParameters = true;
                    break;
                }
            }
        }

        auth.mode = auth.mode || 'required';
    }

    // Path configuration

    const route = {
        method: 'sub',
        path: path
    };

    const config = {
        subscribers: new internals.Subscribers(settings),
        filter: settings.filter,
        auth: auth
    };

    const connections = this.connections;
    for (let i = 0; i < connections.length; ++i) {
        const connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener._router.add(route, config);
        }
    }
};


internals.Listener.publish = function (path, update, options) {

    Hoek.assert(path && path[0] === '/', 'Missing or invalid subscription path:', path || 'empty');

    options = options || {};

    const message = {
        type: 'pub',
        path: path,
        message: update
    };

    const connections = this.connections;
    for (let i = 0; i < connections.length; ++i) {
        const connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener._publish(path, message, options);
        }
    }
};


internals.Listener.prototype._publish = function (path, update, options) {

    const sub = this._router.route('sub', path);
    if (sub.isBoom) {
        return;
    }

    const route = sub.route;
    route.subscribers.forEach(sub.paramsArray.length ? path : null, (socket) => {       // Filter on path if has parameters

        if (!route.filter) {
            socket._send(update);
        }
        else {
            route.filter(path, update.message, { credentials: socket.auth.credentials, params: sub.params, internal: options.internal }, (isMatch) => {

                if (isMatch) {
                    return socket._send(update);
                }
            });
        }
    });
};


internals.Listener.prototype._subscribe = function (path, socket, next) {

    // Errors include subscription context in messages in case returned as connection errors

    if (path.indexOf('?') !== -1) {
        return next(Boom.badRequest('Subscription path cannot contain query'));
    }

    if (socket._subscriptions[path]) {
        return next();
    }

    const match = this._router.route('sub', path);
    if (match.isBoom) {
        return next(Boom.notFound('Subscription not found'));
    }

    const auth = this._connection.auth.lookup({ settings: { auth: match.route.auth } });         // Create a synthetic route
    if (auth) {
        const credentials = socket.auth.credentials;
        if (credentials) {

            // Check scope

            if (auth.scope) {
                let scopes = auth.scope;
                if (auth.hasScopeParameters) {
                    scopes = [];
                    const context = { params: match.params };
                    for (let i = 0; i < auth.scope.length; ++i) {
                        scopes[i] = Hoek.reachTemplate(context, auth.scope[i]);
                    }
                }

                if (!credentials.scope ||
                    (typeof credentials.scope === 'string' ? scopes.indexOf(credentials.scope) === -1 : !Hoek.intersect(scopes, credentials.scope).length)) {

                    return next(Boom.forbidden('Insufficient scope to subscribe, expected any of: ' + scopes));
                }
            }

            // Check entity

            const entity = auth.entity || 'any';
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
            return next(Boom.unauthorized('Authentication required to subscribe'));
        }
    }

    match.route.subscribers.add(socket, path);
    socket._subscriptions[path] = match.route.subscribers;
    return next();
};


internals.Listener.eachSocket = function (each, options) {

    options = options || {};

    const connections = this.connections;
    for (let i = 0; i < connections.length; ++i) {
        const connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener._eachSocket(each, options);
        }
    }
};


internals.Listener.prototype._eachSocket = function (each, options) {

    const subscription = options.subscription;
    if (!subscription) {
        return this._sockets.forEach(each);
    }

    const sub = this._router.route('sub', subscription);
    if (sub.isBoom) {
        return;
    }

    const route = sub.route;
    route.subscribers.forEach(sub.paramsArray.length ? subscription : null, (socket) => each(socket));   // Filter on path if has parameters
};


internals.Listener.prototype._generateId = function () {

    const id = Date.now() + ':' + this._connection.info.id + ':' + this._socketCounter++;
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

    const items = Object.keys(this._items);
    for (let i = 0; i < items.length; ++i) {
        each(this._items[items[i]]);
    }
};


internals.Sockets.prototype.length = function () {

    return Object.keys(this._items).length;
};


// Subscribers manager

internals.Subscribers = function (options) {

    this._onSubscribe = options.onSubscribe;
    this._onUnsubscribe = options.onUnsubscribe;
    this._items = {};
};


internals.Subscribers.prototype.add = function (socket, path) {

    const item = this._items[socket.id];
    if (item) {
        item.paths.push(path);
    }
    else {
        this._items[socket.id] = { socket: socket, paths: [path] };
    }

    if (this._onSubscribe) {
        this._onSubscribe(socket, path);
    }
};


internals.Subscribers.prototype.remove = function (socket, path) {

    const item = this._items[socket.id];
    if (!item) {
        return;
    }

    if (!path) {
        if (this._onUnsubscribe) {
            for (let i = 0; i < item.paths.length; ++i) {
                this._onUnsubscribe(socket, item.paths[i]);
            }
        }

        delete this._items[socket.id];
        return;
    }

    const pos = item.paths.indexOf(path);
    if (item.paths.length === 1) {
        delete this._items[socket.id];
    }
    else {
        item.paths.splice(pos, 1);
    }

    if (this._onUnsubscribe) {
        this._onUnsubscribe(socket, path);
    }
};


internals.Subscribers.prototype.forEach = function (path, each) {

    const items = Object.keys(this._items);
    for (let i = 0; i < items.length; ++i) {
        const item = this._items[items[i]];
        if (!path ||
            item.paths.indexOf(path) !== -1) {

            each(item.socket);
        }
    }
};
