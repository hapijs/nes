'use strict';

const Boom = require('boom');
const Bounce = require('bounce');
const Cryptiles = require('cryptiles');
const Hoek = require('hoek');
const Iron = require('iron');
const Teamwork = require('teamwork');


const internals = {
    version: '2'
};


exports = module.exports = internals.Socket = function (ws, req, listener) {

    this._ws = ws;
    this._cookies = req.headers.cookie;
    this._listener = listener;
    this._helloed = false;
    this._pinged = false;
    this._processingCount = 0;
    this._subscriptions = {};
    this._packets = [];
    this._sending = false;
    this._removed = new Teamwork();

    this.server = this._listener._server;
    this.id = this._listener._generateId();
    this.app = {};
    this.auth = {
        isAuthenticated: false,
        credentials: null,
        artifacts: null,
        _error: null,
        _initialAuthTimeout: null,
        _verified: 0
    };

    this.info = {
        remoteAddress: req.socket.remoteAddress,
        remotePort: req.socket.remotePort
    };

    if (this._listener._settings.auth &&
        this._listener._settings.auth.timeout) {

        this.auth._initialAuthTimeout = setTimeout(() => this.disconnect(), this._listener._settings.auth.timeout);
    }

    this._ws.on('message', (message) => this._onMessage(message));
};


internals.Socket.prototype.disconnect = function () {

    clearTimeout(this.auth._initialAuthTimeout);
    this.auth._initialAuthTimeout = null;

    this._ws.close();
    return this._removed;
};


internals.Socket.prototype.send = function (message) {

    const response = {
        type: 'update',
        message
    };

    return this._send(response);
};


internals.Socket.prototype.publish = function (path, update) {

    const message = {
        type: 'pub',
        path,
        message: update
    };

    return this._send(message);
};


internals.Socket.prototype.revoke = async function (path, update) {

    await this._unsubscribe(path);

    const message = {
        type: 'revoke',
        path
    };

    if (update !== null) {                  // Allow sending falsy values
        message.message = update;
    }

    return this._send(message);
};


internals.Socket.prototype._send = function (message, options) {

    options = options || {};

    if (this._ws.readyState !== 1) {                                // Open
        return Promise.reject(Boom.internal('Socket not open'));
    }

    try {
        var string = JSON.stringify(message);
        if (options.replace) {
            Object.keys(options.replace).forEach((token) => {

                string = string.replace(`"${token}"`, options.replace[token]);
            });
        }
    }
    catch (err) {
        this.server.log(['nes', 'serialization', 'error'], message.type);

        if (message.id) {
            return this._error(Boom.internal('Failed serializing message'), message);
        }

        return Promise.reject(err);
    }

    const team = new Teamwork();
    this._packets.push({ message: string, type: message.type, team });
    this._flush();
    return team.work;
};


internals.Socket.prototype._flush = async function () {

    if (this._sending ||
        !this._packets.length) {

        return;
    }

    this._sending = true;

    const packet = this._packets.shift();
    let messages = [packet.message];

    // Break message into smaller chunks

    const maxChunkChars = this._listener._settings.payload.maxChunkChars;
    if (maxChunkChars &&
        packet.message.length > maxChunkChars) {

        messages = [];
        const parts = Math.ceil(packet.message.length / maxChunkChars);
        for (let i = 0; i < parts; ++i) {
            const last = (i === parts - 1);
            const prefix = (last ? '!' : '+');
            messages.push(prefix + packet.message.slice(i * maxChunkChars, (i + 1) * maxChunkChars));
        }
    }

    for (let i = 0; i < messages.length; ++i) {
        const message = messages[i];

        const team = new Teamwork();
        this._ws.send(message, (err) => team.attend(err));
        try {
            await team.work;
        }
        catch (err) {
            var error = err;
            break;
        }

        if (packet.type !== 'ping') {
            this._pinged = true;                        // Consider the connection valid if send() was successful
        }
    }

    this._sending = false;
    packet.team.attend(error);

    setImmediate(() => this._flush());
};


internals.Socket.prototype._active = function () {

    return (this._pinged || this._sending || this._processingCount);
};


internals.Socket.prototype._error = function (err, request) {

    err = Boom.boomify(err);

    const message = Hoek.clone(err.output);
    delete message.payload.statusCode;
    message.headers = this._filterHeaders(message.headers);

    if (request) {
        message.type = request.type;
        message.id = request.id;
    }

    if (err.path) {
        message.path = err.path;
    }

    return this._send(message);
};


internals.Socket.prototype._onMessage = async function (message) {

    try {
        var request = JSON.parse(message);
    }
    catch (err) {
        return this._error(Boom.badRequest('Cannot parse message'));
    }

    this._pinged = true;
    ++this._processingCount;

    try {
        var { response, options } = await this._lifecycle(request);
    }
    catch (err) {
        Bounce.rethrow(err, 'system');
        var error = err;
    }

    try {
        if (error) {
            await this._error(error, request);
        }
        else if (response) {
            await this._send(response, options);
        }
    }
    catch (err) {
        Bounce.rethrow(err, 'system');
        this.disconnect();
    }

    --this._processingCount;
};


internals.Socket.prototype._lifecycle = async function (request) {

    if (!request.type) {
        throw Boom.badRequest('Cannot parse message');
    }

    if (!request.id) {
        throw Boom.badRequest('Message missing id');
    }

    await this._verifyAuth();

    // Initialization and Authentication

    if (request.type === 'ping') {
        return {};
    }

    if (request.type === 'hello') {
        return this._processHello(request);
    }

    if (!this._helloed) {
        throw Boom.badRequest('Connection is not initialized');
    }

    if (request.type === 'reauth') {
        return this._processReauth(request);
    }

    // Endpoint request

    if (request.type === 'request') {
        return this._processRequest(request);
    }

    // Custom message request

    if (request.type === 'message') {
        return this._processMessage(request);
    }

    // Subscriptions

    if (request.type === 'sub') {
        return this._processSubscription(request);
    }

    if (request.type === 'unsub') {
        return this._processUnsub(request);
    }

    // Unknown

    throw Boom.badRequest('Unknown message type');
};


internals.Socket.prototype._processHello = async function (request) {

    if (this._helloed) {
        throw Boom.badRequest('Connection already initialized');
    }

    if (request.version !== internals.version) {
        throw Boom.badRequest('Incorrect protocol version (expected ' + internals.version + ' but received ' + (request.version || 'none') + ')');
    }

    this._helloed = true;                   // Prevents the client from reusing the socket if erred (leaves socket open to ensure client gets the error response)
    await this._authenticate(request);

    if (this._listener._settings.onConnection) {
        await this._listener._settings.onConnection(this);
    }

    if (request.subs) {
        for (let i = 0; i < request.subs.length; ++i) {
            const path = request.subs[i];
            try {
                await this._listener._subscribe(path, this);
            }
            catch (err) {
                err.path = path;
                throw err;
            }
        }
    }

    const response = {
        type: 'hello',
        id: request.id,
        heartbeat: this._listener._settings.heartbeat,
        socket: this.id
    };

    return { response };
};


internals.Socket.prototype._processReauth = async function (request) {

    try {
        await this._authenticate(request);
    }
    catch (err) {
        Bounce.rethrow(err, 'system');
        setTimeout(() => this.disconnect()); // disconnect after sending the response to the client
        throw err;
    }

    const response = {
        type: 'reauth',
        id: request.id
    };

    return { response };
};


internals.Socket.prototype._processRequest = async function (request) {

    let method = request.method;
    if (!method) {
        throw Boom.badRequest('Message missing method');
    }

    let path = request.path;
    if (!path) {
        throw Boom.badRequest('Message missing path');
    }

    if (request.headers &&
        internals.caseInsensitiveKey(request.headers, 'authorization')) {

        throw Boom.badRequest('Cannot include an Authorization header');
    }

    if (path[0] !== '/') {              // Route id
        const route = this.server.lookup(path);
        if (!route) {
            throw Boom.notFound();
        }

        path = route.path;
        method = route.method;

        if (method === '*') {
            throw Boom.badRequest('Cannot use route id with wildcard method route config');
        }
    }

    if (this._listener._settings.auth &&
        path === this._listener._settings.auth.endpoint) {

        throw Boom.notFound();
    }

    const shot = {
        method,
        url: path,
        payload: request.payload,
        headers: request.headers,
        auth: this.auth.isAuthenticated ? this.auth : null,
        validate: false,
        plugins: {
            nes: {
                socket: this
            }
        }
    };

    const res = await this.server.inject(shot);

    const response = {
        type: 'request',
        id: request.id,
        statusCode: res.statusCode,
        payload: res.result,
        headers: this._filterHeaders(res.headers)
    };

    const options = {};
    if (typeof res.result === 'string' &&
        res.headers['content-type'] &&
        res.headers['content-type'].match(/^application\/json/)) {

        const token = Cryptiles.randomString(32);
        options.replace = { [token]: res.result };
        response.payload = token;
    }

    return { response, options };
};


internals.Socket.prototype._processMessage = async function (request) {

    if (!this._listener._settings.onMessage) {
        throw Boom.notImplemented();
    }

    const message = await this._listener._settings.onMessage(this, request.message);
    const response = {
        type: 'message',
        id: request.id,
        message
    };

    return { response };
};


internals.Socket.prototype._processSubscription = async function (request) {

    await this._listener._subscribe(request.path, this);

    const response = {
        type: 'sub',
        id: request.id,
        path: request.path
    };

    return { response };
};


internals.Socket.prototype._processUnsub = async function (request) {

    await this._unsubscribe(request.path);

    const response = {
        type: 'unsub',
        id: request.id
    };

    return { response };
};


internals.Socket.prototype._unsubscribe = function (path) {

    const sub = this._subscriptions[path];
    if (sub) {
        delete this._subscriptions[path];
        return sub.remove(this, path);
    }
};


internals.Socket.prototype._authenticate = async function (request) {

    await this._authByCookie();

    if (!request.auth &&
        !this.auth.isAuthenticated &&
        this._listener._authRequired()) {

        throw Boom.unauthorized('Connection requires authentication');
    }

    if (request.auth &&
        request.type !== 'reauth' &&
        this.auth.isAuthenticated) {        // Authenticated using a cookie during upgrade

        throw Boom.badRequest('Connection already authenticated');
    }

    clearTimeout(this.auth._initialAuthTimeout);
    this.auth._initialAuthTimeout = null;

    if (request.auth) {
        const config = this._listener._settings.auth;
        if (config.type === 'direct') {
            const route = this.server.lookup(config.id);
            const res = await this.server.inject({ url: route.path, method: 'auth', headers: request.auth.headers, allowInternals: true, validate: false });
            if (res.statusCode !== 200) {
                throw Boom.unauthorized(res.result.message);
            }

            this._setCredentials(res.result);
            return;
        }

        try {
            const auth = await Iron.unseal(request.auth, config.password, config.iron || Iron.defaults);
            this._setCredentials(auth);
        }
        catch (err) {
            throw Boom.unauthorized('Invalid token');
        }
    }
};


internals.Socket.prototype._authByCookie = async function () {

    const config = this._listener._settings.auth;
    if (!config) {
        return;
    }

    const cookies = this._cookies;
    if (!cookies) {
        return;
    }

    try {
        var { states } = await this.server.states.parse(cookies);
    }
    catch (err) {
        throw Boom.unauthorized('Invalid nes authentication cookie');
    }

    const auth = states[config.cookie];
    if (auth) {
        this._setCredentials(auth);
    }
};


internals.Socket.prototype._setCredentials = function (auth) {

    this.auth.isAuthenticated = true;
    this.auth.credentials = auth.credentials;
    this.auth.artifacts = auth.artifacts;
    this.auth.strategy = auth.strategy;

    this.auth._verified = Date.now();

    this._listener._sockets.auth(this);
};


internals.Socket.prototype._verifyAuth = async function () {

    const now = Date.now();

    if (!this._listener._settings.auth.minAuthVerifyInterval ||
        now - this.auth._verified < this._listener._settings.auth.minAuthVerifyInterval) {

        return;
    }

    this.auth._verified = now;

    try {
        await this.server.auth.verify(this);
    }
    catch (err) {
        Bounce.rethrow(err, 'system');
        setImmediate(() => this.disconnect());
        throw Boom.forbidden('Credential verification failed');
    }
};


internals.Socket.prototype._filterHeaders = function (headers) {

    const filter = this._listener._settings.headers;
    if (!filter) {
        return undefined;
    }

    if (filter === '*') {
        return headers;
    }

    const filtered = {};
    const fields = Object.keys(headers);
    for (let i = 0; i < fields.length; ++i) {
        const field = fields[i];
        if (filter.indexOf(field.toLowerCase()) !== -1) {
            filtered[field] = headers[field];
        }
    }

    return filtered;
};


internals.caseInsensitiveKey = function (object, key) {

    const keys = Object.keys(object);
    for (let i = 0; i < keys.length; ++i) {
        const current = keys[i];
        if (key === current.toLowerCase()) {
            return object[current];
        }
    }

    return undefined;
};
