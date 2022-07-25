'use strict';

const Cryptiles = require('@hapi/cryptiles');
const Hoek = require('@hapi/hoek');
const Iron = require('@hapi/iron');
const Validate = require('@hapi/validate');
const Ws = require('ws');

const Client = require('./client');
const Listener = require('./listener');


const internals = {
    defaults: {
        auth: {
            endpoint: '/nes/auth',
            id: 'nes.auth',
            type: 'direct',
            cookie: 'nes',
            isSecure: true,
            isHttpOnly: true,
            isSameSite: 'Strict',
            path: '/',
            index: false,
            timeout: 5000,                                  // 5 seconds
            maxConnectionsPerUser: false
        },
        headers: null,
        payload: {
            maxChunkChars: false
        },
        heartbeat: {
            interval: 15000,                                // 15 seconds
            timeout: 5000                                   // 5 seconds
        },
        maxConnections: false
    }
};


internals.schema = Validate.object({
    onConnection: Validate.function(),                               // async function (socket) {}
    onDisconnection: Validate.function(),                            // function (socket) {}
    onMessage: Validate.function(),                                  // async function (socket, message) { return data; }    // Or throw errors
    auth: Validate.object({
        endpoint: Validate.string().required(),
        id: Validate.string(),
        type: Validate.valid('cookie', 'token', 'direct').required(),
        route: [
            Validate.object(),
            Validate.string()
        ],
        cookie: Validate.string().required(),
        isSecure: Validate.boolean(),
        isHttpOnly: Validate.boolean(),
        isSameSite: Validate.valid('Strict', 'Lax').allow(false),
        path: Validate.string().allow(null),
        domain: Validate.string().allow(null),
        ttl: Validate.number().allow(null),
        iron: Validate.object(),
        password: Validate.alternatives([
            Validate.string(),
            Validate.binary(),
            Validate.object()
        ]),
        index: Validate.boolean(),
        timeout: Validate.number().integer().min(1).allow(false),
        maxConnectionsPerUser: Validate.number().integer().min(1).allow(false).when('index', { is: true, otherwise: Validate.valid(false) }),
        minAuthVerifyInterval: Validate.number().integer().allow(false).when('...heartbeat', {
            is: false,
            then: Validate.number().min(1),
            otherwise: Validate.number().min(Validate.ref('...heartbeat.interval'))
        })
    })
        .allow(false)
        .required(),
    headers: Validate.array().items(Validate.string().lowercase()).min(1).allow('*', null),
    payload: {
        maxChunkChars: Validate.number().integer().min(1).allow(false)
    },
    heartbeat: Validate.object({
        interval: Validate.number().integer().min(1).required(),
        timeout: Validate.number().integer().min(1).less(Validate.ref('interval')).required()
    })
        .allow(false),
    maxConnections: Validate.number().integer().min(1).allow(false),
    origin: Validate.array().items(Validate.string()).single().min(1)
});


exports.plugin = {
    pkg: require('../package.json'),
    requirements: {
        hapi: '>=19.0.0'
    },
    register: function (server, options) {

        const settings = Hoek.applyToDefaults(internals.defaults, options);

        if (Array.isArray(settings.headers)) {
            settings.headers = settings.headers.map((field) => field.toLowerCase());
        }

        if (settings.auth &&
            settings.auth.minAuthVerifyInterval === undefined) {

            settings.auth.minAuthVerifyInterval = (settings.heartbeat ? settings.heartbeat.interval : internals.defaults.heartbeat.interval);
        }

        Validate.assert(settings, internals.schema, 'Invalid nes configuration');

        // Authentication endpoint

        internals.auth(server, settings);

        // Create a listener per connection

        const listener = new Listener(server, settings);

        server.ext('onPreStart', () => {

            // Start heartbeats

            listener._beat();

            // Clear stopped state if restarted

            listener._stopped = false;
        });

        // Stop connections when server stops

        server.ext('onPreStop', () => listener._close());

        // Decorate server and request

        server.decorate('server', 'broadcast', Listener.broadcast);
        server.decorate('server', 'subscription', Listener.subscription);
        server.decorate('server', 'publish', Listener.publish);
        server.decorate('server', 'eachSocket', Listener.eachSocket);
        server.decorate('request', 'socket', internals.socket, { apply: true });
    }
};


Client.Client.WebSocket = Ws;
exports.Client = Client.Client;


internals.auth = function (server, settings) {

    const config = settings.auth;
    if (!config) {
        return;
    }

    if (config.type !== 'direct' &&
        !config.password) {

        config.password = Cryptiles.randomString(32);
    }

    if (config.type === 'cookie') {
        const cookieOptions = {
            isSecure: config.isSecure,
            isHttpOnly: config.isHttpOnly,
            isSameSite: config.isSameSite,
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
        method: config.type === 'direct' ? 'auth' : 'GET',
        path: config.endpoint,
        config: {
            id: config.id,
            isInternal: config.type === 'direct',
            auth: config.route,
            handler: async (request, h) => {

                if (!request.auth.isAuthenticated) {
                    return { status: 'unauthenticated' };
                }

                const credentials = {
                    credentials: request.auth.credentials,
                    artifacts: request.auth.artifacts,
                    strategy: request.auth.strategy
                };

                if (config.type === 'direct') {
                    return credentials;
                }

                const result = { status: 'authenticated' };

                if (config.type === 'cookie') {
                    return h.response(result).state(config.cookie, credentials);
                }

                const sealed = await Iron.seal(credentials, config.password, config.iron ?? Iron.defaults);
                result.token = sealed;
                return result;
            }
        }
    });
};


internals.socket = function (request) {

    return request.plugins.nes ? request.plugins.nes.socket : null;
};
