// Load modules

var Hoek = require('hoek');


// Declare internals

var internals = {};


exports.initialize = function (server, settings) {

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
