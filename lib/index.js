// Load modules

var Cryptiles = require('cryptiles');
var Hoek = require('hoek');
var Iron = require('iron');
var Joi = require('joi');
var Client = require('./client');
var Listener = require('./listener');


// Declare internals

var internals = {
    defaults: {
        auth: {
            endpoint: '/nes/auth',
            id: 'nes.auth',
            type: 'cookie',
            cookie: 'nes',
            isSecure: true,
            isHttpOnly: true,
            path: '/',
            password: Cryptiles.randomString(24)
        }
    }
};


internals.schema = Joi.object({
    onConnect: Joi.func(),                                  // function (ws) {}
    onUnknownMessage: Joi.func(),                           // function (message, ws) { ws.send('string'); }
    auth: Joi.object({
        endpoint: Joi.string().required(),
        id: Joi.string(),
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
        .allow(false)
        .required()
});


exports.register = function (server, options, next) {

    var settings = Hoek.applyToDefaults(internals.defaults, options);
    Joi.assert(settings, internals.schema, 'Invalid nes configuration');

    // Authentication endpoint

    internals.auth(server, settings);

    // Create a listener per connection

    var listners = [];

    var connections = server.connections;
    for (var i = 0, il = connections.length; i < il; ++i) {
        listners.push(new Listener(connections[i], settings));              // Constructor registers with connection
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
    server.decorate('server', 'subscription', Listener.subscription);
    server.decorate('server', 'publish', Listener.publish);

    return next();
};

exports.register.attributes = {
    pkg: require('../package.json')
};


exports.Client = Client.Client;


internals.auth = function (server, settings) {

    var config = settings.auth;
    if (!config) {
        return;
    }

    if (config.type === 'cookie') {
        var cookieOptions = {
            isSecure: config.isSecure,
            isHttpOnly: config.isHttpOnly,
            path: config.path,
            domain: config.domain,
            ttl: config.ttl,
            encoding: 'iron',
            password: config.password,
            iron: config.iron
        };

        server.state(config.cookie, cookieOptions);
    }

    server.route({
        method: 'GET',
        path: config.endpoint,
        config: {
            id: config.id,
            isInternal: (config.type === 'direct'),
            auth: config.route,
            handler: function (request, reply) {

                if (!request.auth.isAuthenticated) {
                    return reply({ status: 'unauthenticated' });
                }

                var credentials = {
                    credentials: request.auth.credentials,
                    artifacts: request.auth.artifacts
                };

                if (config.type === 'direct') {
                    return reply(credentials);
                }

                var result = { status: 'authenticated' };

                if (config.type === 'cookie') {
                    return reply(result).state(config.cookie, credentials);
                }

                Iron.seal(credentials, config.password, config.iron || Iron.defaults, function (err, sealed) {

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
