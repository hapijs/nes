'use strict';

/*
    (hapi)nes WebSocket Client (https://github.com/hapijs/nes)
    Copyright (c) 2015-2016, Eran Hammer <eran@hammer.io> and other contributors
    BSD Licensed
*/


(function (root, factory) {

    // $lab:coverage:off$

    if (typeof exports === 'object' && typeof module === 'object') {
        module.exports = factory();                 // Export if used as a module
    }
    else if (typeof define === 'function' && define.amd) {
        define(factory);
    }
    else if (typeof exports === 'object') {
        exports.nes = factory();
    }
    else {
        root.nes = factory();
    }

    // $lab:coverage:on$

})(/* $lab:coverage:off$ */ typeof window !== 'undefined' ? window : global /* $lab:coverage:on$ */, () => {

    // Utilities

    const version = '2';
    const ignore = function () { };

    const parse = function (message, next) {

        let obj = null;
        let error = null;

        try {
            obj = JSON.parse(message);
        }
        catch (err) {
            error = new NesError(err, 'protocol');
        }

        return next(error, obj);
    };

    const stringify = function (message, next) {

        let string = null;
        let error = null;

        try {
            string = JSON.stringify(message);
        }
        catch (err) {
            error = new NesError(err, 'user');
        }

        return next(error, string);
    };

    const nextTick = function (callback) {

        return (err) => {

            setTimeout(() => callback(err), 0);
        };
    };

    const NesError = function (err, type) {

        if (typeof err === 'string') {
            err = new Error(err);
        }

        err.type = type;
        return err;
    };

    // Error codes

    const errorCodes = {
        1000: 'Normal closure',
        1001: 'Going away',
        1002: 'Protocol error',
        1003: 'Unsupported data',
        1004: 'Reserved',
        1005: 'No status received',
        1006: 'Abnormal closure',
        1007: 'Invalid frame payload data',
        1008: 'Policy violation',
        1009: 'Message too big',
        1010: 'Mandatory extension',
        1011: 'Internal server error',
        1015: 'TLS handshake'
    };

    // Client

    const Client = function (url, options) {

        options = options || {};

        // Configuration

        this._url = url;
        this._settings = options;
        this._heartbeatTimeout = false;             // Server heartbeat configuration

        // State

        this._ws = null;
        this._reconnection = null;
        this._reconnectionTimer = null;
        this._ids = 0;                              // Id counter
        this._requests = {};                        // id -> { callback, timeout }
        this._subscriptions = {};                   // path -> [callbacks]
        this._heartbeat = null;
        this._packets = [];
        this._disconnectListeners = null;
        this._disconnectRequested = false;

        // Events

        this.onError = (err) => console.error(err); // General error callback (only when an error cannot be associated with a request)
        this.onConnect = ignore;                    // Called whenever a connection is established
        this.onDisconnect = ignore;                 // Called whenever a connection is lost: function(willReconnect)
        this.onUpdate = ignore;

        // Public properties

        this.id = null;                             // Assigned when hello response is received
    };

    Client.WebSocket = /* $lab:coverage:off$ */ (typeof WebSocket === 'undefined' ? null : WebSocket); /* $lab:coverage:on$ */

    Client.prototype.connect = function (options, callback) {

        if (typeof options === 'function') {
            callback = arguments[0];
            options = {};
        }

        if (this._reconnection) {
            return nextTick(callback)(new Error('Cannot connect while client attempts to reconnect'));
        }

        if (this._ws) {
            return nextTick(callback)(new Error('Already connected'));
        }

        if (options.reconnect !== false) {                  // Defaults to true
            this._reconnection = {                          // Options: reconnect, delay, maxDelay
                wait: 0,
                delay: options.delay || 1000,               // 1 second
                maxDelay: options.maxDelay || 5000,         // 5 seconds
                retries: options.retries || Infinity,       // Unlimited
                settings: {
                    auth: options.auth,
                    timeout: options.timeout
                }
            };
        }
        else {
            this._reconnection = null;
        }

        this._connect(options, true, callback);
    };

    Client.prototype._connect = function (options, initial, callback) {

        const ws = new Client.WebSocket(this._url, this._settings.ws);          // Settings used by node.js only
        this._ws = ws;

        clearTimeout(this._reconnectionTimer);
        this._reconnectionTimer = null;

        const finalize = (err) => {

            if (callback) {                     // Call only once when connect() is called
                const cb = callback;
                callback = null;
                return cb(err);
            }

            return this.onError(err);
        };

        const timeoutHandler = () => {

            this._cleanup();

            finalize(new NesError('Connection timed out', 'timeout'));

            if (initial) {
                return this._reconnect();
            }
        };

        const timeout = (options.timeout ? setTimeout(timeoutHandler, options.timeout) : null);

        ws.onopen = () => {

            clearTimeout(timeout);
            ws.onopen = null;

            return this._hello(options.auth, (err) => {

                if (err) {
                    if (err.path) {
                        delete this._subscriptions[err.path];
                    }

                    return this._disconnect(() => finalize(err), true);         // Stop reconnection when the hello message returns error
                }

                this.onConnect();
                return finalize();
            });
        };

        ws.onerror = (event) => {

            clearTimeout(timeout);
            this._cleanup();

            const error = new NesError('Socket error', 'ws');
            return finalize(error);
        };

        ws.onclose = (event) => {

            if (ws.onopen) {
                finalize(new Error('Connection terminated while while to connect'));
            }

            const wasRequested = this._disconnectRequested;         // Get value before _cleanup()

            this._cleanup();

            const log = {
                code: event.code,
                explanation: errorCodes[event.code] || 'Unknown',
                reason: event.reason,
                wasClean: event.wasClean,
                willReconnect: !!(this._reconnection && this._reconnection.retries >= 1),
                wasRequested
            };

            this.onDisconnect(log.willReconnect, log);
            this._reconnect();
        };

        ws.onmessage = (message) => {

            return this._onMessage(message);
        };
    };

    Client.prototype.overrideReconnectionAuth = function (auth) {

        if (!this._reconnection) {
            return false;
        }

        this._reconnection.settings.auth = auth;
        return true;
    };

    Client.prototype.disconnect = function (callback) {

        callback = callback || ignore;
        return this._disconnect(callback, false);
    };

    Client.prototype._disconnect = function (callback, isInternal) {

        this._reconnection = null;
        clearTimeout(this._reconnectionTimer);
        this._reconnectionTimer = null;
        const requested = this._disconnectRequested || !isInternal;       // Retain true

        if (this._disconnectListeners) {
            this._disconnectRequested = requested;
            this._disconnectListeners.push(callback);
            return;
        }

        if (!this._ws ||
            (this._ws.readyState !== Client.WebSocket.OPEN &&
            this._ws.readyState !== Client.WebSocket.CONNECTING)) {

            return nextTick(callback)();
        }

        this._disconnectRequested = requested;
        this._disconnectListeners = [callback];
        this._ws.close();
    };

    Client.prototype._cleanup = function () {

        if (this._ws) {
            if (this._ws.readyState === Client.WebSocket.OPEN ||
                this._ws.readyState === Client.WebSocket.CONNECTING) {

                this._ws.close();
            }

            this._ws.onopen = null;
            this._ws.onclose = null;
            this._ws.onerror = ignore;
            this._ws.onmessage = null;
            this._ws = null;
        }

        this._packets = [];
        this.id = null;

        clearTimeout(this._heartbeat);
        this._heartbeat = null;

        // Flush pending requests

        const error = new NesError('Request failed - server disconnected', 'disconnect');

        const ids = Object.keys(this._requests);
        for (let i = 0; i < ids.length; ++i) {
            const id = ids[i];
            const request = this._requests[id];
            const callback = request.callback;
            clearTimeout(request.timeout);
            delete this._requests[id];
            callback(error);
        }

        if (this._disconnectListeners) {
            const listeners = this._disconnectListeners;
            this._disconnectListeners = null;
            this._disconnectRequested = false;
            listeners.forEach((listener) => listener());
        }
    };

    Client.prototype._reconnect = function () {

        // Reconnect

        if (!this._reconnection) {
            return;
        }

        if (this._reconnection.retries < 1) {
            return this._disconnect(ignore, true);      // Clear _reconnection state
        }

        --this._reconnection.retries;
        this._reconnection.wait = this._reconnection.wait + this._reconnection.delay;

        const timeout = Math.min(this._reconnection.wait, this._reconnection.maxDelay);
        this._reconnectionTimer = setTimeout(() => {

            this._connect(this._reconnection.settings, false, (err) => {

                if (err) {
                    this.onError(err);
                    return this._reconnect();
                }
            });
        }, timeout);
    };

    Client.prototype.request = function (options, callback) {

        if (typeof options === 'string') {
            options = {
                method: 'GET',
                path: options
            };
        }

        const request = {
            type: 'request',
            method: options.method || 'GET',
            path: options.path,
            headers: options.headers,
            payload: options.payload
        };

        return this._send(request, true, callback);
    };

    Client.prototype.message = function (message, callback) {

        const request = {
            type: 'message',
            message
        };

        return this._send(request, true, callback);
    };

    Client.prototype._send = function (request, track, callback) {

        callback = callback || ignore;

        if (!this._ws ||
            this._ws.readyState !== Client.WebSocket.OPEN) {

            return nextTick(callback)(new NesError('Failed to send message - server disconnected', 'disconnect'));
        }

        request.id = ++this._ids;

        stringify(request, (err, encoded) => {

            if (err) {
                return nextTick(callback)(err);
            }

            // Ignore errors

            if (!track) {
                try {
                    return this._ws.send(encoded);
                }
                catch (err) {
                    return nextTick(callback)(new NesError(err, 'ws'));
                }
            }

            // Track errors

            const record = {
                callback,
                timeout: null
            };

            if (this._settings.timeout) {
                record.timeout = setTimeout(() => {

                    record.callback = null;
                    record.timeout = null;

                    return callback(new NesError('Request timed out', 'timeout'));
                }, this._settings.timeout);
            }

            this._requests[request.id] = record;

            try {
                this._ws.send(encoded);
            }
            catch (err) {
                clearTimeout(this._requests[request.id].timeout);
                delete this._requests[request.id];
                return nextTick(callback)(new NesError(err, 'ws'));
            }
        });
    };

    Client.prototype._hello = function (auth, callback) {

        const request = {
            type: 'hello',
            version
        };

        if (auth) {
            request.auth = auth;
        }

        const subs = this.subscriptions();
        if (subs.length) {
            request.subs = subs;
        }

        return this._send(request, true, callback);
    };

    Client.prototype.subscriptions = function () {

        return Object.keys(this._subscriptions);
    };

    Client.prototype.subscribe = function (path, handler, callback) {

        if (!path ||
            path[0] !== '/') {

            return nextTick(callback)(new NesError('Invalid path', 'user'));
        }

        const subs = this._subscriptions[path];
        if (subs) {

            // Already subscribed

            if (subs.indexOf(handler) === -1) {
                subs.push(handler);
            }

            return nextTick(callback)();
        }

        this._subscriptions[path] = [handler];

        if (!this._ws ||
            this._ws.readyState !== Client.WebSocket.OPEN) {

            // Queued subscription

            return nextTick(callback)();
        }

        const request = {
            type: 'sub',
            path
        };

        return this._send(request, true, (err) => {

            if (err) {
                delete this._subscriptions[path];
            }

            return callback(err);
        });
    };

    Client.prototype.unsubscribe = function (path, handler, callback) {

        if (!path ||
            path[0] !== '/') {

            return nextTick(callback)(new NesError('Invalid path', 'user'));
        }

        const subs = this._subscriptions[path];
        if (!subs) {
            return nextTick(callback)();
        }

        let sync = false;
        if (!handler) {
            delete this._subscriptions[path];
            sync = true;
        }
        else {
            const pos = subs.indexOf(handler);
            if (pos === -1) {
                return nextTick(callback)();
            }

            subs.splice(pos, 1);
            if (!subs.length) {
                delete this._subscriptions[path];
                sync = true;
            }
        }

        if (!sync ||
            !this._ws ||
            this._ws.readyState !== Client.WebSocket.OPEN) {

            return nextTick(callback)();
        }

        const request = {
            type: 'unsub',
            path
        };

        return this._send(request, true, (errIgnore) => callback());       // Ignoring errors as the subscription handlers are already removed
    };

    Client.prototype._onMessage = function (message) {

        this._beat();

        let data = message.data;
        const prefix = data[0];
        if (prefix !== '{') {
            this._packets.push(data.slice(1));
            if (prefix !== '!') {
                return;
            }

            data = this._packets.join('');
            this._packets = [];
        }

        if (this._packets.length) {
            this._packets = [];
            this.onError(new NesError('Received an incomplete message', 'protocol'));
        }

        parse(data, (err, update) => {

            if (err) {
                return this.onError(err);
            }

            // Recreate error

            let error = null;
            if (update.statusCode &&
                update.statusCode >= 400 &&
                update.statusCode <= 599) {

                error = new NesError(update.payload.message || update.payload.error, 'server');
                error.statusCode = update.statusCode;
                error.data = update.payload;
                error.headers = update.headers;
                error.path = update.path;
            }

            // Ping

            if (update.type === 'ping') {
                return this._send({ type: 'ping' }, false);         // Ignore errors
            }

            // Broadcast and update

            if (update.type === 'update') {
                return this.onUpdate(update.message);
            }

            // Publish or Revoke

            if (update.type === 'pub' ||
                update.type === 'revoke') {

                const handlers = this._subscriptions[update.path];
                if (update.type === 'revoke') {
                    delete this._subscriptions[update.path];
                }

                if (handlers &&
                    update.message !== undefined) {

                    const flags = {};
                    if (update.type === 'revoke') {
                        flags.revoked = true;
                    }

                    for (let i = 0; i < handlers.length; ++i) {
                        handlers[i](update.message, flags);
                    }
                }

                return;
            }

            // Lookup callback (message must include an id from this point)

            const request = this._requests[update.id];
            if (!request) {
                return this.onError(new NesError('Received response for unknown request', 'protocol'));
            }

            const callback = request.callback;
            clearTimeout(request.timeout);
            delete this._requests[update.id];

            if (!callback) {
                return;                     // Response received after timeout
            }

            // Response

            if (update.type === 'request') {
                return callback(error, update.payload, update.statusCode, update.headers);
            }

            // Custom message

            if (update.type === 'message') {
                return callback(error, update.message);
            }

            // Authentication

            if (update.type === 'hello') {
                this.id = update.socket;
                if (update.heartbeat) {
                    this._heartbeatTimeout = update.heartbeat.interval + update.heartbeat.timeout;
                    this._beat();           // Call again once timeout is set
                }

                return callback(error);
            }

            // Subscriptions

            if (update.type === 'sub' ||
                update.type === 'unsub') {

                return callback(error);
            }

            return this.onError(new NesError('Received unknown response type: ' + update.type, 'protocol'));
        });
    };

    Client.prototype._beat = function () {

        if (!this._heartbeatTimeout) {
            return;
        }

        clearTimeout(this._heartbeat);

        this._heartbeat = setTimeout(() => {

            this.onError(new NesError('Disconnecting due to heartbeat timeout', 'timeout'));
            this._ws.close();
        }, this._heartbeatTimeout);
    };

    // Expose interface

    return { Client };
});
