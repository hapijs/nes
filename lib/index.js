'use strict';

const Cryptiles = require('cryptiles');
const Hoek = require('hoek');
const Iron = require('iron');
const Joi = require('joi');
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


internals.schema = Joi.object({
    onConnection: Joi.func(),                               // async function (socket) {}
    onDisconnection: Joi.func(),                            // function (socket) {}
    onMessage: Joi.func(),                                  // async function (socket, message) { return data; }    // Or throw errors
    auth: Joi.object({
        endpoint: Joi.string().required(),
        id: Joi.string(),
        type: Joi.valid('cookie', 'token', 'direct').required(),
        route: [
            Joi.object(),
            Joi.string()
        ],
        cookie: Joi.string().required(),
        isSecure: Joi.boolean(),
        isHttpOnly: Joi.boolean(),
        isSameSite: Joi.valid('Strict', 'Lax').allow(false),
        path: Joi.string().allow(null),
        domain: Joi.string().allow(null),
        ttl: Joi.number().allow(null),
        iron: Joi.object(),
        password: Joi.alternatives([
            Joi.string(),
            Joi.binary(),
            Joi.object()
        ]),
        index: Joi.boolean(),
        timeout: Joi.number().integer().min(1).allow(false),
        maxConnectionsPerUser: Joi.number().integer().min(1).allow(false).when('index', { is: true, otherwise: Joi.valid(false) }),
        minAuthVerifyInterval: Joi.number().integer().allow(false)
    })
        .allow(false)
        .required(),
    headers: Joi.array().items(Joi.string().lowercase()).min(1).allow('*', null),
    payload: {
        maxChunkChars: Joi.number().integer().min(1).allow(false)
    },
    heartbeat: Joi.object({
        interval: Joi.number().integer().min(1).required(),
        timeout: Joi.number().integer().min(1).less(Joi.ref('interval')).required()
    })
        .allow(false),
    maxConnections: Joi.number().integer().min(1).allow(false),
    origin: Joi.array().items(Joi.string()).single().min(1)
})
    .assert('auth.minAuthVerifyInterval', Joi.when('heartbeat', {
        is: false,
        then: Joi.number().min(1),
        otherwise: Joi.number().min(Joi.ref('heartbeat.interval'))
    }));


exports.plugin = {
    pkg: require('../package.json'),
    requirements: {
        hapi: '>=18.0.0'
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

        Joi.assert(settings, internals.schema, 'Invalid nes configuration');

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
        method: (config.type === 'direct' ? 'auth' : 'GET'),
        path: config.endpoint,
        config: {
            id: config.id,
            isInternal: (config.type === 'direct'),
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

                const sealed = await Iron.seal(credentials, config.password, config.iron || Iron.defaults);
                result.token = sealed;
                return result;
            }
        }
    });
};


internals.socket = function (request) {

    return (request.plugins.nes ? request.plugins.nes.socket : null);
};
