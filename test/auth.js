'use strict';

// Load modules

const Boom = require('boom');
const Code = require('code');
const Hapi = require('hapi');
const Hoek = require('hoek');
const Iron = require('iron');
const Lab = require('lab');
const Nes = require('../');


// Declare internals

const internals = {};


// Test shortcuts

const lab = exports.lab = Lab.script();
const describe = lab.describe;
const it = lab.it;
const expect = Code.expect;


describe('authentication', () => {

    describe('cookie', () => {

        it('protects an endpoint', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.register({ register: Nes, options: { auth: { type: 'cookie' } } }, (err) => {

                server.auth.scheme('custom', internals.implementation);
                server.auth.strategy('default', 'custom', true);

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, (res) => {

                        expect(res.result.status).to.equal('authenticated');

                        const header = res.headers['set-cookie'][0];
                        const cookie = header.match(/(?:[^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)\s*=\s*(?:([^\x00-\x20\"\,\;\\\x7F]*))/);

                        const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: 'nes=' + cookie[1] } } });
                        client.connect((err) => {

                            expect(err).to.not.exist();
                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                                expect(payload).to.equal('hello');
                                expect(statusCode).to.equal(200);

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('protects an endpoint (no default auth)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');

            server.register({ register: Nes, options: { auth: { type: 'cookie', route: 'default' } } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    config: {
                        auth: 'default',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    }
                });

                server.start((err) => {

                    server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, (res) => {

                        expect(res.result.status).to.equal('authenticated');

                        const header = res.headers['set-cookie'][0];
                        const cookie = header.match(/(?:[^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)\s*=\s*(?:([^\x00-\x20\"\,\;\\\x7F]*))/);

                        const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: 'nes=' + cookie[1] } } });
                        client.connect((err) => {

                            expect(err).to.not.exist();
                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                                expect(payload).to.equal('hello');
                                expect(statusCode).to.equal(200);

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('errors on missing auth on an authentication endpoint', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'cookie', password: 'password', route: { mode: 'optional' } } } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    server.inject('/nes/auth', (res) => {

                        expect(res.result.status).to.equal('unauthenticated');

                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect((err) => {

                            expect(err).to.not.exist();
                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Missing authentication');
                                expect(err.statusCode).to.equal(401);

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('errors on missing auth on an authentication endpoint (other cookies)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'cookie', password: 'password', route: { mode: 'optional' } } } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    server.inject('/nes/auth', (res) => {

                        expect(res.result.status).to.equal('unauthenticated');

                        const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: 'xnes=123' } } });
                        client.connect((err) => {

                            expect(err).to.not.exist();
                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Missing authentication');
                                expect(err.statusCode).to.equal(401);

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('errors on double auth', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.register({ register: Nes, options: { auth: { type: 'cookie' } } }, (err) => {

                server.auth.scheme('custom', internals.implementation);
                server.auth.strategy('default', 'custom', true);

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, (res) => {

                        expect(res.result.status).to.equal('authenticated');

                        const header = res.headers['set-cookie'][0];
                        const cookie = header.match(/(?:[^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)\s*=\s*(?:([^\x00-\x20\"\,\;\\\x7F]*))/);

                        const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { headers: { cookie: 'nes=' + cookie[1] } } });
                        client.connect({ auth: 'something' }, (err) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Connection already authenticated');
                            expect(err.statusCode).to.equal(400);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('overrides cookie path', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'cookie', password: 'password', path: '/nes/xyz' } } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, (res) => {

                    expect(res.result.status).to.equal('authenticated');

                    const header = res.headers['set-cookie'][0];
                    expect(header).to.contain('Path=/nes/xyz');
                    done();
                });
            });
        });
    });

    describe('token', () => {

        it('protects an endpoint', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, (res) => {

                        expect(res.result.status).to.equal('authenticated');
                        expect(res.result.token).to.exist();

                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect({ auth: res.result.token }, (err) => {

                            expect(err).to.not.exist();
                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                                expect(payload).to.equal('hello');
                                expect(statusCode).to.equal(200);

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('protects an endpoint (token with iron settings)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: 'password', iron: Iron.defaults } } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, (res) => {

                        expect(res.result.status).to.equal('authenticated');
                        expect(res.result.token).to.exist();

                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect({ auth: res.result.token }, (err) => {

                            expect(err).to.not.exist();
                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                                expect(payload).to.equal('hello');
                                expect(statusCode).to.equal(200);

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('errors on invalid token', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: 'abc' }, (err) => {

                        expect(err).to.exist();
                        expect(err.message).to.equal('Invalid token');
                        expect(err.statusCode).to.equal(401);

                        client.disconnect();
                        server.stop(done);
                    });
                });
            });
        });

        it('errors on missing token', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: '' }, (err) => {

                        expect(err).to.exist();
                        expect(err.message).to.equal('Connection requires authentication');
                        expect(err.statusCode).to.equal(401);

                        client.disconnect();
                        server.stop(done);
                    });
                });
            });
        });

        it('errors on invalid iron password', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: new Buffer('') } } }, (err) => {

                expect(err).to.not.exist();
                server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, (res) => {

                    expect(res.statusCode).to.equal(500);
                    done();
                });
            });
        });

        it('errors on double authentication', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();
                server.start((err) => {

                    server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, (res) => {

                        expect(res.result.status).to.equal('authenticated');
                        expect(res.result.token).to.exist();

                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect({ auth: res.result.token }, (err) => {

                            expect(err).to.not.exist();
                            client._hello(res.result.token, (err) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Connection already initialized');
                                expect(err.statusCode).to.equal(400);

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });
    });

    describe('direct', () => {

        it('protects an endpoint', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register(Nes, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, (err) => {

                        expect(err).to.not.exist();
                        client.request('/', (err, payload, statusCode, headers) => {

                            expect(err).to.not.exist();
                            expect(payload).to.equal('hello');
                            expect(statusCode).to.equal(200);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('protects an endpoint with prefix', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register(Nes, { routes: { prefix: '/foo' } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, (err) => {

                        expect(err).to.not.exist();
                        client.request('/', (err, payload, statusCode, headers) => {

                            expect(err).to.not.exist();
                            expect(payload).to.equal('hello');
                            expect(statusCode).to.equal(200);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('reconnects automatically', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);

                    let e = 0;
                    client.onError = function (err) {

                        ++e;
                    };

                    let c = 0;
                    client.onConnect = function () {

                        ++c;
                    };

                    expect(c).to.equal(0);
                    expect(e).to.equal(0);
                    client.connect({ delay: 10, auth: { headers: { authorization: 'Custom john' } } }, () => {

                        expect(c).to.equal(1);
                        expect(e).to.equal(0);

                        client._ws.close();
                        setTimeout(() => {

                            expect(c).to.equal(2);
                            expect(e).to.equal(0);

                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                                expect(payload).to.equal('hello');
                                expect(statusCode).to.equal(200);

                                client.disconnect();
                                server.stop(done);
                            });
                        }, 40);
                    });
                });
            });
        });

        it('does not reconnect when auth fails', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();
                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);

                    let c = 0;
                    client.onConnect = function () {

                        ++c;
                    };

                    expect(c).to.equal(0);
                    client.connect({ delay: 10, auth: { headers: { authorization: 'Custom steve' } } }, (err) => {

                        expect(c).to.equal(0);

                        client._ws.close();
                        setTimeout(() => {

                            expect(c).to.equal(0);

                            client.disconnect();
                            server.stop(done);
                        }, 20);
                    });
                });
            });
        });

        it('fails authentication', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom steve' } } }, (err) => {

                        expect(err).to.exist();
                        expect(err.message).to.equal('Unknown user');
                        client.disconnect();
                        server.stop(done);
                    });
                });
            });
        });

        it('fails authentication', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: '' }, (err) => {

                        expect(err).to.exist();
                        expect(err.message).to.equal('Connection requires authentication');
                        client.disconnect();
                        server.stop(done);
                    });
                });
            });
        });

        it('subscribes to a path', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/');

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, (err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(client.subscriptions()).to.deep.equal(['/']);
                            expect(update).to.equal('heya');
                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/', 'heya');
                        });
                    });
                });
            });
        });

        it('subscribes to a path with filter', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                const filter = function (path, update, options, next) {

                    return next(options.credentials.id === update);
                };

                server.subscription('/', { filter: filter });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, (err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(update).to.equal('john');
                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();

                            server.publish('/', 'steve');
                            server.publish('/', 'john');
                        });
                    });
                });
            });
        });

        it('errors on missing auth to subscribe (config)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { mode: 'required' } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();

                        client.subscribe('/', Hoek.ignore, (err) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Authentication required to subscribe');
                            expect(client.subscriptions()).to.deep.equal([]);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('does not require auth to subscribe without a default', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/');

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/', 'heya');
                        });
                    });
                });
            });
        });

        it('does not require auth to subscribe with optional auth', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', 'optional');

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/');

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/', 'heya');
                        });
                    });
                });
            });
        });

        it('matches entity (user)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { entity: 'user' } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, (err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/', 'heya');
                        });
                    });
                });
            });
        });

        it('matches entity (app)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { entity: 'app' } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom app' } } }, (err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/', 'heya');
                        });
                    });
                });
            });
        });

        it('errors on wrong entity (user)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { entity: 'app' } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, (err) => {

                        expect(err).to.not.exist();

                        client.subscribe('/', Hoek.ignore, (err) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('User credentials cannot be used on an application subscription');
                            expect(client.subscriptions()).to.deep.equal([]);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on wrong entity (app)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { entity: 'user' } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom app' } } }, (err) => {

                        expect(err).to.not.exist();

                        client.subscribe('/', Hoek.ignore, (err) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Application credentials cannot be used on a user subscription');
                            expect(client.subscriptions()).to.deep.equal([]);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('matches scope (string/string)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: 'a' } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, (err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/', 'heya');
                        });
                    });
                });
            });
        });

        it('matches scope (array/string)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: ['x', 'a'] } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, (err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/', 'heya');
                        });
                    });
                });
            });
        });

        it('matches scope (string/array)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: 'a' } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom ed' } } }, (err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/', 'heya');
                        });
                    });
                });
            });
        });

        it('matches scope (array/array)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: ['b', 'a'] } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom ed' } } }, (err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/', 'heya');
                        });
                    });
                });
            });
        });

        it('matches scope (dynamic)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/{id}', { auth: { scope: ['b', '{id}'] } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom ed' } } }, (err) => {

                        expect(err).to.not.exist();
                        const handler = (update) => {

                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/5']);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/5', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/5', 'heya');
                        });
                    });
                });
            });
        });

        it('errors on wrong scope (string/string)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: 'b' } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, (err) => {

                        expect(err).to.not.exist();
                        client.subscribe('/', Hoek.ignore, (err) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Insufficient scope to subscribe, expected any of: b');
                            expect(client.subscriptions()).to.deep.equal([]);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on wrong scope (string/array)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: 'x' } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom ed' } } }, (err) => {

                        expect(err).to.not.exist();
                        client.subscribe('/', Hoek.ignore, (err) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Insufficient scope to subscribe, expected any of: x');
                            expect(client.subscriptions()).to.deep.equal([]);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on wrong scope (string/none)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: 'x' } });

                server.start((err) => {

                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom app' } } }, (err) => {

                        expect(err).to.not.exist();
                        client.subscribe('/', Hoek.ignore, (err) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Insufficient scope to subscribe, expected any of: x');
                            expect(client.subscriptions()).to.deep.equal([]);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });
    });
});


internals.implementation = function (server, options) {

    const users = {
        john: {
            id: 'john',
            user: true,
            scope: 'a'
        },
        ed: {
            id: 'ed',
            scope: ['a', 'b', 5]
        },
        app: {
            id: 'app'
        }
    };

    const scheme = {
        authenticate: function (request, reply) {

            const authorization = request.headers.authorization;
            if (!authorization) {
                return reply(Boom.unauthorized(null, 'Custom'));
            }

            const parts = authorization.split(/\s+/);
            const user = users[parts[1]];
            if (!user) {
                return reply(Boom.unauthorized('Unknown user', 'Custom'));
            }

            return reply.continue({ credentials: user });
        }
    };

    return scheme;
};
