// Load modules

var Boom = require('boom');
var Ws = require('ws');
var Socket = require('./socket');


// Declare internals

var internals = {};


exports = module.exports = internals.Listener = function (connection, settings) {

    var self = this;

    this._connection = connection;
    this._settings = settings;
    this._sockets = [];

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
