// Load modules

var Hoek = require('hoek');
var Iron = require('iron');
var Joi = require('joi');
var Browser = require('./browser');
var Listener = require('./listener');


// Declare internals

var internals = {
    defaults: {
        auth: {
            endpoint: '/nes/auth',
            type: 'cookie',
            cookie: 'nes',
            isSecure: true,
            isHttpOnly: true,
            path: '/'
        }
    }
};


internals.schema = Joi.object({
    onUnknownMessage: Joi.func(),                           // function (message, ws) { ws.send('string'); }
    auth: Joi.object({
        endpoint: Joi.string().required(),
        type: Joi.valid('cookie', 'token', 'direct').required(),
        route: Joi.object(),
        cookie: Joi.string().required(),
        isSecure: Joi.boolean(),
        isHttpOnly: Joi.boolean(),
        path: Joi.string().allow(null),
        domain: Joi.string().allow(null),
        ttl: Joi.number().allow(null),
        iron: Joi.object(),
        password: Joi.alternatives([
            Joi.string(),
            Joi.binary(),
            Joi.object()
        ]).required()
    })
});


exports.register = function (server, options, next) {

    var settings = Hoek.clone(options);
    if (settings.auth) {
        settings.auth = Hoek.applyToDefaults(internals.defaults.auth, settings.auth);
    }

    Joi.assert(settings, internals.schema, 'Invalid nes configuration');

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

    if (settings.type === 'cookie') {
        var cookieOptions = {
            isSecure: settings.isSecure,
            isHttpOnly: settings.isHttpOnly,
            path: settings.path,
            domain: settings.domain,
            ttl: settings.ttl,
            encoding: 'iron',
            password: settings.password,
            iron: settings.iron
        };

        server.state(settings.cookie, cookieOptions);
    }

    server.route({
        method: 'GET',
        path: settings.endpoint,
        config: {
            isInternal: (settings.type === 'direct'),
            auth: settings.route,
            handler: function (request, reply) {

                if (!request.auth.isAuthenticated) {
                    return reply({ status: 'unauthenticated' });
                }

                var credentials = {
                    credentials: request.auth.credentials,
                    artifacts: request.auth.artifacts
                };

                if (settings.type === 'direct') {
                    return reply(credentials);
                }

                var result = { status: 'authenticated' };

                if (settings.type === 'cookie') {
                    return reply(result).state(settings.cookie, credentials);
                }

                Iron.seal(credentials, settings.password, settings.iron || Iron.defaults, function (err, sealed) {

                    if (err) {
                        return reply(err);
                    }

                    result.token = sealed;
                    return reply(result);
                });
            }
        }
    });
};
