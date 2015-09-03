/*
    hapi-nes WebSocket Client
    Copyright (c) 2015, Eran Hammer <eran@hammer.io> and other contributors
    BSD Licensed
*/


(function (root, factory) {

    // Export if used as a module

    // $lab:coverage:off$
    if (typeof exports === 'object' && typeof module === 'object') {
        module.exports = factory();
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
})(this, function () {

    var ignore = function () { };

    // Using just require here vs proper UMD binding as we assume WebSocket is available through
    // native bindings in all environments that you'd do something silly like use AMD or globals
    var WS = /* $lab:coverage:off$ */ (typeof WebSocket === 'undefined' ? require('ws') : WebSocket); /* $lab:coverage:on$ */

    var Client = function () {

        this._ws = null;
        this._ids = 0;                              // Id counter
        this._requests = {};                        // id -> callback

        this.onerror = ignore;                      // General error callback (only when an error cannot be associated with a request)
    };

    Client.prototype.connect = function (url, callback) {

        var self = this;

        var ws = new WS(url);
        this._ws = ws;

        var sentCallback = false;
        ws.onopen = function () {

            if (!sentCallback) {
                sentCallback = true;
                return callback();
            }
        };

        ws.onerror = function (err) {

            if (!sentCallback) {
                sentCallback = true;
                return callback(err);
            }

            return self.onerror(err);
        };

        ws.onclose = function () {

            return self._onClose();
        };

        ws.onmessage = function (message) {

            return self._onMessage(message);
        };
    };

    Client.prototype.disconnect = function () {

        if (!this._ws) {
            return;
        }

        if (this._ws.readyState === 1 ||                    // Open
            this._ws.readyState === 0) {                    // Connecting

            this._ws.close();
        }
    };

    Client.prototype.request = function (method, path, callback) {

        var self = this;

        if (!this._ws ||
            this._ws.readyState !== 1) {                    // Open

            return callback(new Error('Disconnected'));
        }

        var request = {
            id: ++this._ids,
            type: 'request',
            method: method,
            path: path
        };

        stringify(request, function (err, encoded) {

            if (err) {
                return callback(err);
            }

            self._requests[request.id] = callback;

            try {
                self._ws.send(encoded);
            }
            catch (err) {
                delete self._requests[request.id];
                return callback(err);
            }
        });
    };

    Client.prototype._onMessage = function (message) {

        var self = this;

        parse(message.data, function (err, update) {

            if (err) {
                return;                                     // Do something
            }

            if (update.type === 'response') {
                var callback = self._requests[update.id];
                if (!callback) {
                    return;                                 // Do something
                }

                delete self._requests[update.id];
                return callback(null, update.payload, update.statusCode, update.headers);
            }
        });
    };

    Client.prototype._onClose = function () {

        // Flush pending requests

        var error = new Error('Disconnected');

        var ids = Object.keys(this._requests);
        for (var i = 0, il = ids.length; i < il; ++i) {
            var id = ids[i];
            var callback = this._requests[id];
            delete this._requests[id];
            callback(error);
        }
    };

    var parse = function (message, next) {

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

    var stringify = function (message, next) {

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


    // Declare namespace

    var nes = {
        Client: Client
    };

    return nes;
});
