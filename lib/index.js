// Load modules

var Hoek = require('hoek');
var Auth = require('./auth');
var Browser = require('./browser');
var Listener = require('./listener');


// Declare internals

var internals = {
    defaults: {
        auth: {
            endpoint: '/nes/auth',
            type: 'cookie',                     // Response type: 'token' or 'cookie'
            name: 'nes',                        // Cookie name
            cookieOptions: {                    // hapi server.state() options, except 'encoding' which is always 'iron'. 'password' required.
                isSecure: true,
                isHttpOnly: true
            },
            route: undefined
        }
    }
};


exports.register = function (server, options, next) {

    var settings = Hoek.clone(options);
    if (settings.auth) {
        settings.auth = Hoek.applyToDefaults(internals.defaults.auth, settings.auth);
    }

    // Authentication endpoint

    if (settings.auth) {
        Auth.initialize(server, settings.auth);
    }

    // Create a listener per connection

    var listners = [];

    var connections = server.connections;
    for (var i = 0, il = connections.length; i < il; ++i) {
        listners.push(new Listener(connections[i], settings));
    }

    // Stop connections when server stops

    server.ext('onPreStop', function (srv, extNext) {

        for (var l = 0, ll = listners.length; l < ll; ++l) {
            listners[l].close();
        }

        return extNext();
    });

    // Decorate server

    server.decorate('server', 'broadcast', Listener.broadcast);

    return next();
};

exports.register.attributes = {
    pkg: require('../package.json')
};


exports.Client = Browser.Client;
