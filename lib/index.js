// Load modules

var Hoek = require('hoek');
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
        internals.auth(server, settings.auth);
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


internals.auth = function (server, settings) {

    Hoek.assert(!settings.cookieOptions.encoding, 'Cannot override cookie encoding');
    settings.cookieOptions.encoding = 'iron';
    settings.cookieOptions.path = settings.cookieOptions.path || settings.endpoint;

    server.state(settings.name, settings.cookieOptions);

    server.route({
        method: 'GET',
        path: settings.endpoint,
        config: {
            auth: settings.route,
            handler: function (request, reply) {

                if (!request.auth.isAuthenticated) {
                    return reply({ status: 'unauthenticated' });
                }

                return reply({ status: 'authenticated' }).state(settings.name, { credentials: request.auth.credentials, artifacts: request.auth.artifacts });
            }
        }
    });
};
