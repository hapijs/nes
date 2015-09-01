// Load modules

var Ws = require('ws');
var Manager = require('./manager');


// Declare internals

var internals = {};


exports.register = function (server, options, next) {

    // Connection manager

    var manager = new Manager(server);
    server.expose('manager', manager);
    server.decorate('server', 'broadcast', Manager.broadcast);

    // WebSocket listener

    var wss = new Ws.Server({ server: server.listener });

    wss.on('connection', function (ws) {

        manager.connection(ws);
    });

    wss.on('error', function (err) {

    });

    server.ext('onPreStop', function (srv, extNext) {

        wss.close();
        return extNext();
    });

    return next();
};

exports.register.attributes = {
    pkg: require('../package.json')
};
