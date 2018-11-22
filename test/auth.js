'use strict';

const Boom = require('boom');
const Code = require('code');
const Hapi = require('hapi');
const Hoek = require('hoek');
const Iron = require('iron');
const Lab = require('lab');
const Nes = require('../');
const Teamwork = require('teamwork');


const internals = {};


const { describe, it } = exports.lab = Lab.script();
const expect = Code.expect;


describe('authentication', () => {

    const password = 'some_not_random_password_that_is_also_long_enough';

    it('times out when hello is delayed', async () => {

        const server = Hapi.server();

        server.auth.scheme('custom', internals.implementation);
        server.auth.strategy('default', 'custom');
        server.auth.default('default');

        await server.register({ plugin: Nes, options: { auth: { timeout: 100 } } });

        server.route({
            method: 'GET',
            path: '/',
            handler: () => 'hello'
        });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port);
        client._hello = () => Promise.resolve();
        client.onError = Hoek.ignore;

        const team = new Teamwork();
        client.onDisconnect = () => team.attend();

        await client.connect({ auth: { headers: { authorization: 'Custom john' } } });

        await team.work;
        await server.stop();
    });

    it('disables timeout when hello is delayed', async () => {

        const server = Hapi.server();

        server.auth.scheme('custom', internals.implementation);
        server.auth.strategy('default', 'custom');
        server.auth.default('default');

        await server.register({ plugin: Nes, options: { auth: { timeout: false } } });

        server.route({
            method: 'GET',
            path: '/',
            handler: () => 'hello'
        });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port);
        client._hello = () => Promise.resolve();
        client.onError = Hoek.ignore;
        const connecting = client.connect({ auth: { headers: { authorization: 'Custom john' } } });

        await Hoek.wait(100);
        await server.stop();
        await connecting;
    });

    describe('cookie', () => {

        it('protects an endpoint', async () => {

            const server = Hapi.server();

            await server.register({ plugin: Nes, options: { auth: { type: 'cookie' } } });

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const res = await server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } });
            expect(res.result.status).to.equal('authenticated');

            const header = res.headers['set-cookie'][0];
            const cookie = header.match(/(?:[^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)\s*=\s*(?:([^\x00-\x20\"\,\;\\\x7F]*))/);

            const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: 'nes=' + cookie[1] } } });
            await client.connect();

            const { payload, statusCode } = await client.request('/');
            expect(payload).to.equal('hello');
            expect(statusCode).to.equal(200);

            client.disconnect();
            await server.stop();
        });

        it('limits connections per user', async () => {

            const server = Hapi.server();

            await server.register({ plugin: Nes, options: { auth: { type: 'cookie', maxConnectionsPerUser: 1, index: true } } });

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const res = await server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } });
            expect(res.result.status).to.equal('authenticated');

            const header = res.headers['set-cookie'][0];
            const cookie = header.match(/(?:[^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)\s*=\s*(?:([^\x00-\x20\"\,\;\\\x7F]*))/);

            const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: 'nes=' + cookie[1] } } });
            await client.connect();

            const client2 = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: 'nes=' + cookie[1] } } });
            await expect(client2.connect()).to.reject('Too many connections for the authenticated user');

            client.disconnect();
            client2.disconnect();
            await server.stop();
        });

        it('protects an endpoint (no default auth)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');

            await server.register({ plugin: Nes, options: { auth: { type: 'cookie', route: 'default' } } });

            server.route({
                method: 'GET',
                path: '/',
                config: {
                    auth: 'default',
                    handler: () => 'hello'
                }
            });

            await server.start();
            const res = await server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } });
            expect(res.result.status).to.equal('authenticated');

            const header = res.headers['set-cookie'][0];
            const cookie = header.match(/(?:[^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)\s*=\s*(?:([^\x00-\x20\"\,\;\\\x7F]*))/);

            const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: 'nes=' + cookie[1] } } });
            await client.connect();

            const { payload, statusCode } = await client.request('/');
            expect(payload).to.equal('hello');
            expect(statusCode).to.equal(200);

            client.disconnect();
            await server.stop();
        });

        it('errors on missing auth on an authentication endpoint', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'cookie', password, route: { mode: 'optional' } } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const res = await server.inject('/nes/auth');
            expect(res.result.status).to.equal('unauthenticated');

            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const err = await expect(client.request('/')).to.reject('Missing authentication');
            expect(err.statusCode).to.equal(401);

            client.disconnect();
            await server.stop();
        });

        it('errors on missing auth on an authentication endpoint (other cookies)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'cookie', password, route: { mode: 'optional' } } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const res = await server.inject('/nes/auth');
            expect(res.result.status).to.equal('unauthenticated');

            const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: 'xnes=123' } } });
            await client.connect();

            const err = await expect(client.request('/')).to.reject('Missing authentication');
            expect(err.statusCode).to.equal(401);

            client.disconnect();
            await server.stop();
        });

        it('errors on double auth', async () => {

            const server = Hapi.server();

            await server.register({ plugin: Nes, options: { auth: { type: 'cookie' } } });
            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const res = await server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } });
            expect(res.result.status).to.equal('authenticated');

            const header = res.headers['set-cookie'][0];
            const cookie = header.match(/(?:[^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)\s*=\s*(?:([^\x00-\x20\"\,\;\\\x7F]*))/);

            const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: 'nes=' + cookie[1] } } });
            const err = await expect(client.connect({ auth: 'something' })).to.reject('Connection already authenticated');
            expect(err.statusCode).to.equal(400);

            client.disconnect();
            await server.stop();
        });

        it('errors on invalid cookie', async () => {

            const server = Hapi.server();

            await server.register({ plugin: Nes, options: { auth: { type: 'cookie' } } });

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: '"' } } });
            await expect(client.connect()).to.reject('Invalid nes authentication cookie');
            client.disconnect();
            await server.stop();
        });

        it('overrides cookie path', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'cookie', password, path: '/nes/xyz' } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            const res = await server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } });
            expect(res.result.status).to.equal('authenticated');

            const header = res.headers['set-cookie'][0];
            expect(header).to.contain('Path=/nes/xyz');
        });
    });

    describe('token', () => {

        it('protects an endpoint', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'token', password } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: (request) => request.auth
            });

            await server.start();
            const res = await server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } });
            expect(res.result.status).to.equal('authenticated');
            expect(res.result.token).to.exist();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: res.result.token });
            const { payload, statusCode } = await client.request('/');

            expect(payload).to.include({
                isAuthenticated: true,
                credentials: { user: 'john', scope: 'a' },
                artifacts: 'abc'
            });

            expect(statusCode).to.equal(200);

            client.disconnect();
            await server.stop();
        });

        it('protects an endpoint (token with iron settings)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'token', password, iron: Iron.defaults } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const res = await server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } });
            expect(res.result.status).to.equal('authenticated');
            expect(res.result.token).to.exist();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: res.result.token });
            const { payload, statusCode } = await client.request('/');
            expect(payload).to.equal('hello');
            expect(statusCode).to.equal(200);

            client.disconnect();
            await server.stop();
        });

        it('errors on invalid token', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'token', password } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            const err = await expect(client.connect({ auth: 'abc' })).to.reject('Invalid token');
            expect(err.statusCode).to.equal(401);

            client.disconnect();
            await server.stop();
        });

        it('errors on missing token', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'token', password } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            const err = await expect(client.connect({ auth: '' })).to.reject('Connection requires authentication');
            expect(err.statusCode).to.equal(401);

            client.disconnect();
            await server.stop();
        });

        it('errors on invalid iron password', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'token', password: Buffer.from('') } } });
            const res = await server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } });
            expect(res.statusCode).to.equal(500);
        });

        it('errors on double authentication', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'token', password } } });
            await server.start();
            const res = await server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } });
            expect(res.result.status).to.equal('authenticated');
            expect(res.result.token).to.exist();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: res.result.token });
            const err = await expect(client._hello(res.result.token)).to.reject('Connection already initialized');
            expect(err.statusCode).to.equal(400);

            client.disconnect();
            await server.stop();
        });
    });

    describe('direct', () => {

        it('protects an endpoint', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register(Nes);

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom john' } } });
            const { payload, statusCode } = await client.request('/');
            expect(payload).to.equal('hello');
            expect(statusCode).to.equal(200);

            client.disconnect();
            await server.stop();
        });

        it('limits number of connections per user', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { index: true, maxConnectionsPerUser: 1 } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom john' } } });

            const client2 = new Nes.Client('http://localhost:' + server.info.port);
            await expect(client2.connect({ auth: { headers: { authorization: 'Custom john' } } })).to.reject('Too many connections for the authenticated user');

            client.disconnect();
            client2.disconnect();
            await server.stop();
        });

        it('protects an endpoint with prefix', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register(Nes, { routes: { prefix: '/foo' } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom john' } } });

            const { payload, statusCode } = await client.request('/');
            expect(payload).to.equal('hello');
            expect(statusCode).to.equal(200);

            client.disconnect();
            await server.stop();
        });

        it('reconnects automatically', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            let e = 0;
            client.onError = (err) => {

                expect(err).to.exist();
                ++e;
            };

            let c = 0;
            client.onConnect = () => ++c;

            expect(c).to.equal(0);
            expect(e).to.equal(0);
            await client.connect({ delay: 10, auth: { headers: { authorization: 'Custom john' } } });

            expect(c).to.equal(1);
            expect(e).to.equal(0);

            client._ws.close();
            await Hoek.wait(40);

            expect(c).to.equal(2);
            expect(e).to.equal(0);

            const { payload, statusCode } = await client.request('/');
            expect(payload).to.equal('hello');
            expect(statusCode).to.equal(200);

            client.disconnect();
            await server.stop();
        });

        it('does not reconnect when auth fails', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });
            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            let c = 0;
            client.onConnect = () => ++c;

            expect(c).to.equal(0);
            await expect(client.connect({ delay: 10, auth: { headers: { authorization: 'Custom steve' } } })).to.reject();
            expect(c).to.equal(0);

            await Hoek.wait(20);
            expect(c).to.equal(0);

            client.disconnect();
            await server.stop();
        });

        it('fails authentication', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await expect(client.connect({ auth: { headers: { authorization: 'Custom steve' } } })).to.reject('Unknown user');
            client.disconnect();
            await server.stop();
        });

        it('fails authentication', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await expect(client.connect({ auth: '' })).to.reject('Connection requires authentication');
            client.disconnect();
            await server.stop();
        });

        it('subscribes to a path', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/');

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom john' } } });

            const team = new Teamwork();
            const handler = (update) => {

                expect(client.subscriptions()).to.equal(['/']);
                expect(update).to.equal('heya');
                team.attend();
            };

            await client.subscribe('/', handler);
            server.publish('/', 'heya');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('subscribes to a path with filter', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            const filter = (path, update, options) => {

                return (options.credentials.user === update);
            };

            server.subscription('/', { filter });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom john' } } });

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('john');
                team.attend();
            };

            await client.subscribe('/', handler);
            server.publish('/', 'steve');
            server.publish('/', 'john');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('errors on missing auth to subscribe (config)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { mode: 'required' } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            await expect(client.subscribe('/', Hoek.ignore)).to.reject('Authentication required to subscribe');
            expect(client.subscriptions()).to.equal([]);

            client.disconnect();
            await server.stop();
        });

        it('does not require auth to subscribe without a default', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/');

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('heya');
                expect(client.subscriptions()).to.equal(['/']);

                team.attend();
            };

            await client.subscribe('/', handler);
            server.publish('/', 'heya');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('does not require auth to subscribe with optional auth', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default({ strategy: 'default', mode: 'optional' });

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/');

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('heya');
                expect(client.subscriptions()).to.equal(['/']);

                team.attend();
            };

            await client.subscribe('/', handler);
            server.publish('/', 'heya');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('matches entity (user)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password, index: true } } });

            server.subscription('/', { auth: { entity: 'user' } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom john' } } });

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('heya');
                expect(client.subscriptions()).to.equal(['/']);

                team.attend();
            };

            await client.subscribe('/', handler);
            server.publish('/', 'heya');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('matches entity (app)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password, index: true } } });

            server.subscription('/', { auth: { entity: 'app' } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom app' } } });

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('heya');
                expect(client.subscriptions()).to.equal(['/']);

                team.attend();
            };

            await client.subscribe('/', handler);
            server.publish('/', 'heya');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('errors on wrong entity (user)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { entity: 'app' } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom john' } } });

            await expect(client.subscribe('/', Hoek.ignore)).to.reject('User credentials cannot be used on an application subscription');
            expect(client.subscriptions()).to.equal([]);

            client.disconnect();
            await server.stop();
        });

        it('errors on wrong entity (app)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { entity: 'user' } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom app' } } });

            await expect(client.subscribe('/', Hoek.ignore)).to.reject('Application credentials cannot be used on a user subscription');
            expect(client.subscriptions()).to.equal([]);

            client.disconnect();
            await server.stop();
        });

        it('matches scope (string/string)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { scope: 'a' } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom john' } } });

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('heya');
                expect(client.subscriptions()).to.equal(['/']);

                team.attend();
            };

            await client.subscribe('/', handler);
            server.publish('/', 'heya');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('matches scope (array/string)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { scope: ['x', 'a'] } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom john' } } });

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('heya');
                expect(client.subscriptions()).to.equal(['/']);

                team.attend();
            };

            await client.subscribe('/', handler);
            server.publish('/', 'heya');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('matches scope (string/array)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { scope: 'a' } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom ed' } } });

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('heya');
                expect(client.subscriptions()).to.equal(['/']);

                team.attend();
            };

            await client.subscribe('/', handler);
            server.publish('/', 'heya');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('matches scope (array/array)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { scope: ['b', 'a'] } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom ed' } } });

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('heya');
                expect(client.subscriptions()).to.equal(['/']);

                team.attend();
            };

            await client.subscribe('/', handler);
            server.publish('/', 'heya');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('matches scope (dynamic)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/{id}', { auth: { scope: ['{params.id}'] } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom ed' } } });

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('heya');
                expect(client.subscriptions()).to.equal(['/5']);

                team.attend();
            };

            await client.subscribe('/5', handler);
            server.publish('/5', 'heya');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('errors on wrong scope (string/string)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { scope: 'b' } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom john' } } });

            await expect(client.subscribe('/', Hoek.ignore)).to.reject('Insufficient scope to subscribe, expected any of: b');
            expect(client.subscriptions()).to.equal([]);

            client.disconnect();
            await server.stop();
        });

        it('errors on wrong scope (string/array)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { scope: 'x' } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom ed' } } });

            await expect(client.subscribe('/', Hoek.ignore)).to.reject('Insufficient scope to subscribe, expected any of: x');
            expect(client.subscriptions()).to.equal([]);

            client.disconnect();
            await server.stop();
        });

        it('errors on wrong scope (string/none)', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { scope: 'x' } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ auth: { headers: { authorization: 'Custom app' } } });

            await expect(client.subscribe('/', Hoek.ignore)).to.reject('Insufficient scope to subscribe, expected any of: x');
            expect(client.subscriptions()).to.equal([]);

            client.disconnect();
            await server.stop();
        });

        it('disconnects the client after authentication expires', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');


            const authLifetime = 100;
            const expiresAt = () => Date.now() + authLifetime;
            await server.register({ plugin: Nes, options: { auth: { expiresAt } } });
            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ reconnect: false, auth: { headers: { authorization: 'Custom john' } } });

            const team = new Teamwork();
            client.onDisconnect = () => {

                team.attend();
            };

            await Hoek.wait(authLifetime + 1);

            await team.work;

            await server.stop();
        });

        it('extends authentication expiry', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            server.route({
                method: 'GET',
                path: '/',
                handler: (request) => request.auth.artifacts
            });

            const authLifetime = 100;
            let request = 0;
            const expiresAt = () => {

                ++request;

                if (request === 1) {
                    return Date.now() + authLifetime;
                }

                // only expire the first request - never expire again
                return undefined;
            };

            await server.register({ plugin: Nes, options: { auth: { expiresAt } } });
            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ reconnect: false, auth: { headers: { authorization: 'Custom john' } } });

            await Hoek.wait(authLifetime / 2);

            await client.reauthenticate({ headers: { authorization: 'Custom ed' } });

            await Hoek.wait(authLifetime + 1);

            const res2 = await client.request('/');
            expect(res2.statusCode).to.equal(200);

            await server.stop();
        });

        it('updates authentication information', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            server.route({
                method: 'GET',
                path: '/',
                handler: (request) => request.auth.artifacts
            });

            await server.register(Nes);
            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ reconnect: false, auth: { headers: { authorization: 'Custom john' } } });

            const res1 = await client.request('/');
            expect(res1.payload).to.equal('abc');
            expect(res1.statusCode).to.equal(200);

            await client.reauthenticate({ headers: { authorization: 'Custom ed' } });

            const res2 = await client.request('/');
            expect(res2.payload).to.equal('xyz'); // updated artifacts
            expect(res2.statusCode).to.equal(200);

            await server.stop();
        });

        it('disconnects the client when reauthentication fails', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register(Nes);
            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect({ reconnect: false, auth: { headers: { authorization: 'Custom john' } } });

            const team = new Teamwork();
            client.onDisconnect = () => {

                team.attend();
            };

            await expect(client.reauthenticate({ headers: { authorization: 'Custom no-such-user' } })).to.reject();

            await team.work;

            await server.stop();
        });
    });
});


internals.implementation = function (server, options) {

    const users = {
        john: {
            user: 'john',
            scope: 'a'
        },
        ed: {
            user: 'ed',
            scope: ['a', 'b', 5]
        },
        app: {
            app: 'app'
        }
    };

    const artifacts = {
        john: 'abc',
        ed: 'xyz'
    };

    const scheme = {
        authenticate: (request, h) => {

            const authorization = request.headers.authorization;
            if (!authorization) {
                throw Boom.unauthorized(null, 'Custom');
            }

            const parts = authorization.split(/\s+/);
            const username = parts[1];
            const user = users[username];
            if (!user) {
                throw Boom.unauthorized('Unknown user', 'Custom');
            }

            return h.authenticated({ credentials: user, artifacts: artifacts[username] });
        }
    };

    return scheme;
};
