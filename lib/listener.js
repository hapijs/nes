'use strict';

// Load modules

const Boom = require('boom');
const Call = require('call');
const Hoek = require('hoek');
const Items = require('items');
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
    this._sockets = new internals.Sockets(this);
    this._router = new Call.Router();
    this._authRoute = this._settings.auth && connection.lookup(this._settings.auth.id);
    this._socketCounter = internals.counter.min;
    this._heartbeat = null;
    this._timeout = null;
    this._stopped = false;

    // WebSocket listener

    const options = { server: connection.listener };
    if (settings.origin) {
        options.verifyClient = (info) => settings.origin.indexOf(info.origin) >= 0;
    }

    this._wss = new Ws.Server(options);

    this._wss.on('connection', (ws) => {

        if (this._stopped ||
            (this._settings.maxConnections && this._sockets.length() >= this._settings.maxConnections)) {

            return ws.close();
        }

        this._add(ws);
    });

    this._wss.on('error', Hoek.ignore);

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
        clearTimeout(socket.auth._timeout);
        socket.auth._timeout = null;

        const subs = Object.keys(socket._subscriptions);
        const each = (sub, nextSub) => {

            const subscribers = socket._subscriptions[sub];
            subscribers.remove(socket, null, nextSub);
        };

        Items.serial(subs, each, (errIgnore) => {

            socket._subscriptions = {};

            if (this._settings.onDisconnection) {
                this._settings.onDisconnection(socket);
            }

            ws.emit('nes-removed');
        });
    });
};


internals.Listener.prototype._close = function (next) {

    this._stopped = true;
    clearTimeout(this._heartbeat);
    clearTimeout(this._timeout);

    const each = (id, nextSocket) => {

        const socket = this._sockets._items[id];
        if (!socket) {
            return nextSocket();
        }

        return socket.disconnect(nextSocket);
    };

    const ids = Object.keys(this._sockets._items);
    Items.serial(ids, each, (ignoreErr) => {

        this._wss.close();
        return next();
    });
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

        this._sockets._forEach((socket) => {

            socket._send(update, null, Hoek.ignore);          // Ignore errors
        });

        // Verify client responded

        this._timeout = setTimeout(() => {

            this._sockets._forEach((socket) => {

                if (!socket._active()) {
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


internals.Listener.broadcast = function (message, options) {

    options = options || {};

    const update = {
        type: 'update',
        message
    };

    const connections = this.connections;
    for (let i = 0; i < connections.length; ++i) {
        const connection = connections[i];
        if (connection.plugins.nes) {
            connection.plugins.nes._listener._broadcast(update, options);
        }
    }
};


internals.Listener.prototype._broadcast = function (update, options) {

    Hoek.assert(!options.user || (this._settings.auth && this._settings.auth.index), 'Socket auth indexing is disabled');

    if (this._stopped) {
        return;
    }

    const each = (socket) => socket._send(update, null, Hoek.ignore);     // Ignore errors

    if (options.user) {
        const sockets = this._sockets._byUser[options.user];
        if (!sockets) {
            return;
        }

        return sockets.forEach(each);
    }

    this._sockets._forEach(each);
};


internals.subSchema = Joi.object({
    filter: Joi.func(),                                             // function (path, update, options, next), where options: { credentials, params }
    onSubscribe: Joi.func(),                                        // function (socket, path, params, next)
    onUnsubscribe: Joi.func(),                                      // function (socket, path, params, next)
    auth: Joi.object({
        mode: Joi.string().valid('required', 'optional'),
        scope: Joi.array().items(Joi.string()).single().min(1),
        entity: Joi.valid('user', 'app', 'any'),
        index: Joi.boolean()
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
        path
    };

    const connections = this.connections;
    for (let i = 0; i < connections.length; ++i) {
        const connection = connections[i];
        if (connection.plugins.nes) {
            const config = {
                subscribers: new internals.Subscribers(settings),
                filter: settings.filter,
                auth
            };

            connection.plugins.nes._listener._router.add(route, config);
        }
    }
};


internals.Listener.publish = function (path, update, options) {

    Hoek.assert(path && path[0] === '/', 'Missing or invalid subscription path:', path || 'empty');

    options = options || {};

    const message = {
        type: 'pub',
        path,
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

    if (this._stopped) {
        return;
    }

    const match = this._router.route('sub', path);
    if (match.isBoom) {
        return;
    }

    const route = match.route;
    route.subscribers._forEachSubscriber(match.paramsArray.length ? path : null, options, (socket) => {         // Filter on path if has parameters

        if (!route.filter) {
            return socket._send(update, null, Hoek.ignore);                           // Ignore errors
        }

        route.filter(path, update.message, { socket, credentials: socket.auth.credentials, params: match.params, internal: options.internal }, (isMatch, override) => {

            if (isMatch) {
                if (override === undefined) {
                    return socket._send(update, null, Hoek.ignore);                   // Ignore errors
                }

                const copy = Hoek.shallow(update);
                copy.message = override;
                return socket._send(copy, null, Hoek.ignore);                         // Ignore errors
            }
        });
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

    match.route.subscribers.add(socket, path, match, (err) => {

        if (err) {
            return next(err);
        }

        socket._subscriptions[path] = match.route.subscribers;
        return next();
    });
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

    if (this._stopped) {
        return;
    }

    if (!options.subscription) {
        Hoek.assert(!options.user, 'Cannot specify user filter without a subscription path');
        return this._sockets._forEach(each);
    }

    const sub = this._router.route('sub', options.subscription);
    if (sub.isBoom) {
        return;
    }

    const route = sub.route;
    route.subscribers._forEachSubscriber(sub.paramsArray.length ? options.subscription : null, options, (socket) => each(socket));   // Filter on path if has parameters
};


internals.Listener.prototype._generateId = function () {

    const id = Date.now() + ':' + this._connection.info.id + ':' + this._socketCounter++;
    if (this._socketCounter > internals.counter.max) {
        this._socketCounter = internals.counter.min;
    }

    return id;
};


// Sockets manager

internals.Sockets = function (listener) {

    this._listener = listener;
    this._items = {};
    this._byUser = {};                  // user -> [sockets]
};


internals.Sockets.prototype.add = function (socket) {

    this._items[socket.id] = socket;
};


internals.Sockets.prototype.auth = function (socket) {

    if (!this._listener._settings.auth.index) {
        return null;
    }

    if (!socket.auth.credentials.user) {
        return null;
    }

    const user = socket.auth.credentials.user;
    if (this._listener._settings.auth.maxConnectionsPerUser &&
        this._byUser[user] &&
        this._byUser[user].length >= this._listener._settings.auth.maxConnectionsPerUser) {

        return Boom.serverUnavailable('Too many connections for the authenticated user');
    }

    this._byUser[user] = this._byUser[user] || [];
    this._byUser[user].push(socket);
    return null;
};


internals.Sockets.prototype.remove = function (socket) {

    delete this._items[socket.id];

    if (socket.auth.credentials &&
        socket.auth.credentials.user) {

        const user = socket.auth.credentials.user;
        if (this._byUser[user]) {
            this._byUser[user] = this._byUser[user].filter((item) => item !== socket);
            if (!this._byUser[user].length) {
                delete this._byUser[user];
            }
        }
    }
};


internals.Sockets.prototype._forEach = function (each) {

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

    this._settings = options;
    this._items = {};
    this._byUser = {};          // user -> [item]
};


internals.Subscribers.prototype.add = function (socket, path, match, next) {

    const add = (err) => {

        if (err) {
            return next(err);
        }

        const item = this._items[socket.id];
        if (item) {
            item.paths.push(path);
            item.params.push(match.params);
        }
        else {
            this._items[socket.id] = { socket, paths: [path], params: [match.params] };

            if (this._settings.auth &&
                this._settings.auth.index &&
                socket.auth.credentials &&
                socket.auth.credentials.user) {

                const user = socket.auth.credentials.user;
                this._byUser[user] = this._byUser[user] || [];
                this._byUser[user].push(this._items[socket.id]);
            }
        }

        return next();
    };

    if (!this._settings.onSubscribe) {
        return add();
    }

    this._settings.onSubscribe(socket, path, match.params, add);
};


internals.Subscribers.prototype.remove = function (socket, path, next) {

    const item = this._items[socket.id];
    if (!item) {
        return next();
    }

    const cleanup = () => {

        delete this._items[socket.id];

        if (socket.auth.credentials &&
            socket.auth.credentials.user &&
            this._byUser[socket.auth.credentials.user]) {

            const user = socket.auth.credentials.user;
            this._byUser[user] = this._byUser[user].filter((record) => record !== item);
            if (!this._byUser[user].length) {
                delete this._byUser[user];
            }
        }
    };

    if (!path) {
        cleanup();

        if (this._settings.onUnsubscribe) {
            return Items.serial(item.paths, (itemPath, nextUnsub, i) => this._settings.onUnsubscribe(socket, itemPath, item.params[i], nextUnsub), (ignoreErr) => {

                cleanup();
                return next();
            });
        }

        return next();
    }

    const pos = item.paths.indexOf(path);
    const params = item.params[pos];

    if (item.paths.length === 1) {
        cleanup();
    }
    else {
        item.paths.splice(pos, 1);
        item.params.splice(pos, 1);
    }

    if (!this._settings.onUnsubscribe) {
        return next();
    }

    this._settings.onUnsubscribe(socket, path, params, () => next());       // Wrap next() to remove any arguments
};


internals.Subscribers.prototype._forEachSubscriber = function (path, options, each) {

    const itemize = (item) => {

        if (!path ||
            item.paths.indexOf(path) !== -1) {

            return each(item.socket);
        }
    };

    if (options.user) {
        Hoek.assert(this._settings.auth && this._settings.auth.index, 'Subscription auth indexing is disabled');

        const items = this._byUser[options.user];
        if (items) {
            items.forEach(itemize);
        }
    }
    else {
        const items = Object.keys(this._items);
        for (let i = 0; i < items.length; ++i) {
            const item = this._items[items[i]];
            itemize(item);
        }
    }
};
