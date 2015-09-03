/*
    hapi-nes WebSocket Client
    Copyright (c) 2015, Eran Hammer <eran@hammer.io> and other contributors
    BSD Licensed
*/


// Declare namespace

var nes = {
    internals: {
        WebSocket: /* $lab:coverage:off$ */ (typeof WebSocket === 'undefined' ? require('ws') : WebSocket) /* $lab:coverage:on$ */
    }
};


nes.Client = function () {

    this._ws = null;
    this.status = 'closed';
};


nes.Client.prototype.connect = function (url, callback) {

    var self = this;

    this._ids = 0;                              // Id counter
    this._requests = {};                        // id -> callback

    this._ws = new nes.internals.WebSocket(url);

    this._ws.onopen = function () {

        self.status = 'open';
        return callback();
    };

    this._ws.onerror = function (err) {

    };

    this._ws.onclose = function () {

        self.status = 'open';
    };

    this._ws.onmessage = function (message) {

        self._onMessage(message);
    };
};


nes.Client.prototype.disconnect = function () {

    this._ws.close();
};


nes.Client.prototype.request = function (method, path, callback) {

    var self = this;

    if (this.status !== 'open') {
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
