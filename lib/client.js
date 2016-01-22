'use strict';

/*
    (hapi)nes WebSocket Client (https://github.com/hapijs/nes)
    Copyright (c) 2015, Eran Hammer <eran@hammer.io> and other contributors
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

})(this, () => {

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
        this._ids = 0;                              // Id counter
        this._requests = {};                        // id -> { callback, timeout }
        this._subscriptions = {};                   // path -> [callbacks]
        this._heartbeat = null;

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

        let sentCallback = false;
        const timeoutHandler = () => {

            sentCallback = true;
            this._ws.close();
            callback(new NesError('Connection timed out', 'timeout'));
            this._cleanup();
            if (initial) {
                return this._reconnect();
            }
        };

        const timeout = (options.timeout ? setTimeout(timeoutHandler, options.timeout) : null);

        const ws = new Client.WebSocket(this._url, this._settings.ws);          // Settings used by node.js only
        this._ws = ws;

        ws.onopen = () => {

            clearTimeout(timeout);

            if (!sentCallback) {
                sentCallback = true;
                return this._hello(options.auth, (err) => {

                    if (err) {
                        if (err.path) {
                            delete this._subscriptions[err.path];
                        }

                        this.disconnect();                  // Stop reconnection when the hello message returns error
                        return callback(err);
                    }

                    this.onConnect();
                    return callback();
                });
            }
        };

        ws.onerror = (event) => {

            const err = new NesError('Socket error', 'ws');

            clearTimeout(timeout);

            if (!sentCallback) {
                sentCallback = true;
                return callback(err);
            }

            return this.onError(err);
        };

        ws.onclose = (event) => {

            const log = {
                code: event.code,
                explanation: errorCodes[event.code] || 'Unknown',
                reason: event.reason,
                wasClean: event.wasClean
            };

            this._cleanup();
            this.onDisconnect(!!(this._reconnection && this._reconnection.retries >= 1), log);
            this._reconnect();
        };

        ws.onmessage = (message) => {

            return this._onMessage(message);
        };
    };

    Client.prototype.disconnect = function () {

        this._reconnection = null;

        if (!this._ws) {
            return;
        }

        if (this._ws.readyState === Client.WebSocket.OPEN ||
            this._ws.readyState === Client.WebSocket.CONNECTING) {

            this._ws.close();
        }
    };

    Client.prototype._cleanup = function () {

        const ws = this._ws;
        if (!ws) {
            return;
        }

        this._ws = null;
        this.id = null;
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = ignore;
        ws.onmessage = null;

        clearTimeout(this._heartbeat);

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
    };

    Client.prototype._reconnect = function () {

        // Reconnect

        if (this._reconnection) {
            if (this._reconnection.retries < 1) {
                this.disconnect();                      // Clear _reconnection state
                return;
            }

            --this._reconnection.retries;
            this._reconnection.wait = this._reconnection.wait + this._reconnection.delay;

            const timeout = Math.min(this._reconnection.wait, this._reconnection.maxDelay);
            setTimeout(() => {

                if (!this._reconnection) {
                    return;
                }

                this._connect(this._reconnection.settings, false, (err) => {

                    if (err) {
                        this.onError(err);
                        this._cleanup();
                        return this._reconnect();
                    }
                });
            }, timeout);
        }
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
            message: message
        };

        return this._send(request, true, callback);
    };

    Client.prototype._send = function (request, track, callback) {

        callback = callback || ignore;

        if (!this._ws ||
            this._ws.readyState !== Client.WebSocket.OPEN) {

            return callback(new NesError('Failed to send message - server disconnected', 'disconnect'));
        }

        request.id = ++this._ids;

        stringify(request, (err, encoded) => {

            if (err) {
                return callback(err);
            }

            // Ignore errors

            if (!track) {
                try {
                    return this._ws.send(encoded);
                }
                catch (err) {
                    return callback(new NesError(err, 'ws'));
                }
            }

            // Track errors

            const record = {
                callback: callback,
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
                return callback(new NesError(err, 'ws'));
            }
        });
    };

    Client.prototype._hello = function (auth, callback) {

        const request = {
            type: 'hello',
            version: version
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

            return callback(new NesError('Invalid path', 'user'));
        }

        const subs = this._subscriptions[path];
        if (subs) {

            // Already subscribed

            if (subs.indexOf(handler) === -1) {
                subs.push(handler);
            }

            return callback();
        }

        this._subscriptions[path] = [handler];

        if (!this._ws ||
            this._ws.readyState !== Client.WebSocket.OPEN) {

            // Queued subscription

            return callback();
        }

        const request = {
            type: 'sub',
            path: path
        };

        return this._send(request, true, (err) => {

            if (err) {
                delete this._subscriptions[path];
            }

            return callback(err);
        });
    };

    Client.prototype.unsubscribe = function (path, handler) {

        if (!path ||
            path[0] !== '/') {

            return handler(new NesError('Invalid path', 'user'));
        }

        const subs = this._subscriptions[path];
        if (!subs) {
            return;
        }

        let sync = false;
        if (!handler) {
            delete this._subscriptions[path];
            sync = true;
        }
        else {
            const pos = subs.indexOf(handler);
            if (pos === -1) {
                return;
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

            return;
        }

        const request = {
            type: 'unsub',
            path: path
        };

        return this._send(request, false);      // Ignoring errors as the subscription handlers are already removed
    };

    Client.prototype._onMessage = function (message) {

        this._beat();

        parse(message.data, (err, update) => {

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

            // Publish

            if (update.type === 'pub') {
                const handlers = this._subscriptions[update.path];
                if (handlers) {
                    for (let i = 0; i < handlers.length; ++i) {
                        handlers[i](update.message);
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

            if (update.type === 'sub') {
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

    return { Client: Client };
});
