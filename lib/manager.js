// Load modules

var Boom = require('boom');
var Connection = require('./connection');


// Declare internals

var internals = {};


exports = module.exports = internals.Manager = function (server) {

    this._server = server;
    this._connections = [];
};


internals.Manager.prototype.connection = function (ws) {

    var self = this;

    var connection = new Connection(ws, this._server);
    this._connections.push(connection);

    ws.once('close', function (code, message) {

        self._connections.splice(self._connections.indexOf(connection), 1);
    });
};


internals.Manager.broadcast = function (message, headers) {

    var update = {
        type: 'broadcast',
        payload: message,
        headers: headers || {},
        statusCode: 200
    };

    var connections = this.plugins.nes.manager._connections;
    for (var i = 0, il = connections.length; i < il; ++i) {
        var connection = connections[i];
        connection.send(update);
    }
};
