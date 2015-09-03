/*
    hapi-nes WebSocket Client
    Copyright (c) 2015, Eran Hammer <eran@hammer.io> and other contributors
    BSD Licensed
*/


// Declare namespace

var nes = {
    internals: {
        ignore: function () { },
        WebSocket: /* $lab:coverage:off$ */ (typeof WebSocket === 'undefined' ? require('ws') : WebSocket) /* $lab:coverage:on$ */
    }
};


nes.Client = function () {

    this._ws = null;
    this._ids = 0;                              // Id counter
    this._requests = {};                        // id -> callback

    this.onerror = nes.internals.ignore;        // General error callback (only when an error cannot be associated with a request)
};


nes.Client.prototype.connect = function (url, callback) {

    var self = this;

    var ws = new nes.internals.WebSocket(url);
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


nes.Client.prototype.disconnect = function () {

    if (!this._ws) {
        return;
    }

    if (this._ws.readyState === 1 ||                    // Open
        this._ws.readyState === 0) {                    // Connecting

        this._ws.close();
    }
};


nes.Client.prototype.request = function (method, path, callback) {

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

    nes.internals.stringify(request, function (err, encoded) {

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


nes.Client.prototype._onMessage = function (message) {

    var self = this;

    nes.internals.parse(message.data, function (err, update) {

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


nes.Client.prototype._onClose = function () {

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


nes.internals.parse = function (message, next) {

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


nes.internals.stringify = function (message, next) {

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


// $lab:coverage:off$

// Export if used as a module

if (typeof module !== 'undefined' && module.exports) {
    module.exports = nes;
}

// $lab:coverage:on$
