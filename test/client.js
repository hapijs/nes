'use strict';

// Load modules

const Boom = require('boom');
const Code = require('code');
const Hapi = require('hapi');
const Hoek = require('hoek');
const Lab = require('lab');
const Nes = require('../');
const Teamwork = require('teamwork');


// Declare internals

const internals = {};


// Test shortcuts

const { describe, it } = exports.lab = Lab.script();
const expect = Code.expect;


describe('Client', () => {

    describe('onError', () => {

        it('logs error to console by default', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });
            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);

            const team = new Teamwork();
            const orig = console.error;
            console.error = (err) => {

                expect(err).to.exist();
                console.error = orig;
                client.disconnect();
                team.attend();
            };

            await client.connect();
            client._ws.emit('error', new Error('test'));
            await team.work;
        });
    });

    describe('connect()', () => {

        it('fails to connect', async () => {

            const client = new Nes.Client('http://0');

            const err = await expect(client.connect()).to.reject('Socket error');
            expect(err.type).to.equal('ws');
            client.disconnect();
        });

        it('errors if already connected', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });
            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);

            await client.connect({ reconnect: false });
            await expect(client.connect()).to.reject('Already connected');
            client.disconnect();
            await server.stop();
        });

        it('errors if set to reconnect', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });
            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);

            await client.connect();
            await expect(client.connect()).to.reject('Cannot connect while client attempts to reconnect');
            client.disconnect();
            await server.stop();
        });
    });

    describe('_connect()', () => {

        it('handles unknown error code', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });
            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            client.onError = Hoek.ignore;
            client.onDisconnect = (willReconnect, log) => {

                expect(log.explanation).to.equal('Unknown');
                client.disconnect();
                team.attend();
            };

            client._ws.onclose({ code: 9999, reason: 'bug', wasClean: false });
            await team.work;
            await server.stop();
        });
    });

    describe('overrideReconnectionAuth()', () => {

        it('reconnects automatically', async () => {

            const server = Hapi.server();

            server.auth.scheme('custom', (srv, options) => {

                return {
                    authenticate: (request, h) => {

                        const authorization = request.headers.authorization;
                        if (!authorization) {
                            throw Boom.unauthorized(null, 'Custom');
                        }

                        const parts = authorization.split(/\s+/);
                        return h.authenticated({ credentials: { user: parts[1] } });
                    }
                };
            });

            server.auth.strategy('default', 'custom');
            server.auth.default({ strategy: 'default', mode: 'optional' });

            server.route({
                method: 'GET',
                path: '/',
                config: {
                    auth: {
                        mode: 'optional'
                    },
                    handler: (request) => {

                        if (request.auth.isAuthenticated) {
                            return request.auth.credentials.user;
                        }

                        return 'nope';
                    }
                }
            });

            await server.register(Nes);
            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;

            const team = new Teamwork();
            let c = 0;
            client.onConnect = async () => {

                ++c;
                if (c === 2) {
                    const { payload } = await client.request('/');
                    expect(payload).to.equal('john');
                    client.disconnect();

                    expect(client.overrideReconnectionAuth({ headers: { authorization: 'Custom steve' } })).to.be.false();

                    team.attend();
                }
            };

            client.onDisconnect = (willReconnect, log) => {

                if (c === 1) {
                    expect(client.overrideReconnectionAuth({ headers: { authorization: 'Custom john' } })).to.be.true();
                }
            };

            await client.connect({ delay: 10 });

            const { payload } = await client.request('/');
            expect(payload).to.equal('nope');
            client._ws.close();
            await team.work;
            await server.stop();
        });
    });

    describe('disconnect()', () => {

        it('ignores when client not connected', () => {

            const client = new Nes.Client();
            client.disconnect();
        });

        it('ignores when client is disconnecting', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            client.disconnect();
            await Hoek.wait(5);
            client.disconnect();
            await server.stop();
        });

        it('avoids closing a socket in closing state', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            client._ws.close();
            await client.disconnect();
            await server.stop();
        });

        it('closes socket while connecting', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            const orig = client._connect;
            client._connect = (...args) => {

                orig.apply(client, args);
                client._ws.onerror = client._ws.onclose;
            };

            const reject = expect(client.connect()).to.reject('Connection terminated while waiting to connect');
            client.disconnect();

            await reject;
            await server.stop();
        });

        it('disconnects once', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            let disconnected = 0;
            client.onDisconnect = (willReconnect, log) => ++disconnected;

            client.disconnect();
            client.disconnect();
            await client.disconnect();

            await Hoek.wait(50);

            expect(disconnected).to.equal(1);
            await server.stop();
        });

        it('logs manual disconnection request', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            client.onDisconnect = (willReconnect, log) => {

                expect(log.wasRequested).to.be.true();
                team.attend();
            };

            client.disconnect();

            await team.work;
            await server.stop();
        });

        it('logs error disconnection request as not requested', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;
            await client.connect();

            const team = new Teamwork();
            client.onDisconnect = (willReconnect, log) => {

                expect(log.wasRequested).to.be.false();
                team.attend();
            };

            client._ws.close();

            await team.work;
            await server.stop();
        });

        it('logs error disconnection request as not requested after manual disconnect while already disconnected', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;
            client.disconnect();
            await client.connect();

            const team = new Teamwork();
            client.onDisconnect = (willReconnect, log) => {

                expect(log.wasRequested).to.be.false();
                team.attend();
            };

            client._ws.close();

            await team.work;
            await server.stop();
        });

        it('allows closing from inside request callback', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            await client.request('/');
            client.disconnect();
            await Hoek.wait(100);
            await server.stop();
        });
    });

    describe('_cleanup()', () => {

        it('ignores when client not connected', () => {

            const client = new Nes.Client();
            client._cleanup();
        });
    });

    describe('_reconnect()', () => {

        it('reconnects automatically', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            let e = 0;
            client.onError = (err) => {

                expect(err).to.exist();
                ++e;
            };

            const team = new Teamwork();

            let c = 0;
            client.onConnect = () => {

                ++c;
                if (c === 2) {
                    expect(e).to.equal(0);
                    team.attend();
                }
            };

            expect(c).to.equal(0);
            expect(e).to.equal(0);
            await client.connect({ delay: 10 });

            expect(c).to.equal(1);
            expect(e).to.equal(0);

            client._ws.close();

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('aborts reconnecting', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;

            let c = 0;
            client.onConnect = () => ++c;

            await client.connect({ delay: 100 });

            client._ws.close();
            await Hoek.wait(50);
            await client.disconnect();

            expect(c).to.equal(1);
            await server.stop();
        });

        it('does not reconnect automatically', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            let e = 0;
            client.onError = (err) => {

                expect(err).to.exist();
                ++e;
            };

            let c = 0;
            client.onConnect = () => ++c;

            let r = '';
            client.onDisconnect = (willReconnect, log) => {

                r += willReconnect ? 't' : 'f';
            };

            expect(c).to.equal(0);
            expect(e).to.equal(0);
            await client.connect({ reconnect: false, delay: 10 });

            expect(c).to.equal(1);
            expect(e).to.equal(0);

            client._ws.close();
            await Hoek.wait(15);

            expect(c).to.equal(1);
            expect(r).to.equal('f');
            client.disconnect();
            await server.stop();
        });

        it('overrides max delay', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            let c = 0;
            const now = Date.now();
            const team = new Teamwork();
            client.onConnect = () => {

                ++c;

                if (c < 6) {
                    client._ws.close();
                    return;
                }

                expect(Date.now() - now).to.be.below(150);

                team.attend();
            };

            await client.connect({ delay: 10, maxDelay: 11 });

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('reconnects automatically (with errors)', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const url = 'http://localhost:' + server.info.port;
            const client = new Nes.Client(url);

            let e = 0;
            client.onError = (err) => {

                expect(err).to.exist();
                expect(err.message).to.equal('Socket error');
                expect(err.type).to.equal('ws');

                ++e;
                client._url = 'http://localhost:' + server.info.port;
            };

            let r = '';
            client.onDisconnect = (willReconnect, log) => {

                r += willReconnect ? 't' : 'f';
            };

            const team = new Teamwork();

            let c = 0;
            client.onConnect = () => {

                ++c;

                if (c < 5) {
                    client._ws.close();

                    if (c === 3) {
                        client._url = 'http://0';
                    }

                    return;
                }

                expect(e).to.equal(1);
                expect(r).to.equal('tttt');

                team.attend();
            };

            expect(e).to.equal(0);
            await client.connect({ delay: 10, maxDelay: 15 });

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('errors on pending request when closed', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: async () => {

                    await Hoek.wait(10);
                    return 'hello';
                }
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const request = client.request('/');
            client.disconnect();

            const err = await expect(request).to.reject('Request failed - server disconnected');
            expect(err.type).to.equal('disconnect');
            await server.stop();
        });

        it('times out', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            const orig = client._connect;
            client._connect = (...args) => {

                orig.apply(client, args);
                client._ws.onopen = null;
            };

            let c = 0;
            client.onConnect = () => ++c;

            let e = 0;
            client.onError = async (err) => {

                ++e;
                expect(err).to.exist();
                expect(err.message).to.equal('Connection timed out');
                expect(err.type).to.equal('timeout');

                if (e < 4) {
                    return;
                }

                expect(c).to.equal(0);
                client.disconnect();
                await server.stop({ timeout: 1 });
            };

            await expect(client.connect({ delay: 50, maxDelay: 50, timeout: 50 })).to.reject('Connection timed out');
        });

        it('limits retries', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            let c = 0;
            client.onConnect = () => {

                ++c;
                client._ws.close();
            };

            let r = '';
            client.onDisconnect = (willReconnect, log) => {

                r += willReconnect ? 't' : 'f';
            };

            await client.connect({ delay: 5, maxDelay: 10, retries: 2 });

            await Hoek.wait(100);

            expect(c).to.equal(3);
            expect(r).to.equal('ttf');
            client.disconnect();
            await server.stop();
        });

        it('aborts reconnect if disconnect is called in between attempts', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            const team = new Teamwork();

            let c = 0;
            client.onConnect = async () => {

                ++c;
                client._ws.close();

                if (c === 1) {
                    setTimeout(() => client.disconnect(), 5);
                    await Hoek.wait(15);

                    expect(c).to.equal(1);
                    team.attend();
                }
            };

            await client.connect({ delay: 10 });

            await team.work;
            await server.stop();
        });
    });

    describe('request()', () => {

        it('defaults to GET', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, headers: '*' } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const { payload, statusCode, headers } = await client.request({ path: '/' });
            expect(payload).to.equal('hello');
            expect(statusCode).to.equal(200);
            expect(headers).to.contain({ 'content-type': 'text/html; charset=utf-8' });

            client.disconnect();
            await server.stop();
        });

        it('errors when disconnected', async () => {

            const client = new Nes.Client();

            const err = await expect(client.request('/')).to.reject('Failed to send message - server disconnected');
            expect(err.type).to.equal('disconnect');
        });

        it('errors on invalid payload', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'POST',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const a = { b: 1 };
            a.a = a;

            const err = await expect(client.request({ method: 'POST', path: '/', payload: a })).to.reject('Converting circular structure to JSON');
            expect(err.type).to.equal('user');
            client.disconnect();
            await server.stop();
        });

        it('errors on invalid data', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'POST',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            client._ws.send = () => {

                throw new Error('boom');
            };

            const err = await expect(client.request({ method: 'POST', path: '/', payload: 'a' })).to.reject('boom');
            expect(err.type).to.equal('ws');
            client.disconnect();
            await server.stop();
        });
    });

    describe('message()', () => {

        it('errors on timeout', async () => {

            const onMessage = async (socket, message) => {

                await Hoek.wait(50);
                return 'hello';
            };

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { onMessage } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port, { timeout: 20 });
            await client.connect();

            const err = await expect(client.message('winning')).to.reject('Request timed out');
            expect(err.type).to.equal('timeout');

            await Hoek.wait(50);

            client.disconnect();
            await server.stop();
        });
    });

    describe('_send()', () => {

        it('catches send error without tracking', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            client._ws.send = () => {

                throw new Error('failed');
            };

            const err = await expect(client._send({}, false)).to.reject('failed');
            expect(err.type).to.equal('ws');

            client.disconnect();
            await server.stop();
        });
    });

    describe('_onMessage', () => {

        it('ignores invalid incoming message', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: async (request) => {

                    request.server.plugins.nes._listener._sockets._forEach((socket) => {

                        socket._ws.send('{');
                    });

                    await Hoek.wait(10);
                    return 'hello';
                }
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            let logged;
            client.onError = (err) => {

                logged = err;
            };

            await client.connect();

            await client.request('/');
            expect(logged.message).to.match(/Unexpected end of(?: JSON)? input/);
            expect(logged.type).to.equal('protocol');

            client.disconnect();
            await server.stop();
        });

        it('reports incomplete message', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: async (request) => {

                    request.server.plugins.nes._listener._sockets._forEach((socket) => {

                        socket._ws.send('+abc');
                    });

                    await Hoek.wait(10);
                    return 'hello';
                }
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            let logged;
            client.onError = (err) => {

                logged = err;
            };

            await client.connect();

            await client.request('/');
            expect(logged.message).to.equal('Received an incomplete message');
            expect(logged.type).to.equal('protocol');

            client.disconnect();
            await server.stop();
        });

        it('ignores incoming message with unknown id', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: async (request) => {

                    request.server.plugins.nes._listener._sockets._forEach((socket) => {

                        socket._ws.send('{"id":100,"type":"response","statusCode":200,"payload":"hello","headers":{}}');
                    });

                    await Hoek.wait(10);
                    return 'hello';
                }
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            let logged;
            client.onError = (err) => {

                logged = err;
            };

            await client.connect();

            await client.request('/');
            expect(logged.message).to.equal('Received response for unknown request');
            expect(logged.type).to.equal('protocol');

            client.disconnect();
            await server.stop();
        });

        it('ignores incoming message with unknown type', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: async (request) => {

                    request.server.plugins.nes._listener._sockets._forEach((socket) => {

                        socket._ws.send('{"id":2,"type":"unknown","statusCode":200,"payload":"hello","headers":{}}');
                    });

                    await Hoek.wait(10);
                    return 'hello';
                }
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            const team = new Teamwork({ meetings: 2 });

            const logged = [];
            client.onError = (err) => {

                logged.push(err);
                team.attend();
            };

            await client.connect();
            await expect(client.request('/')).to.reject('Received invalid response');
            await team.work;

            expect(logged[0].message).to.equal('Received unknown response type: unknown');
            expect(logged[0].type).to.equal('protocol');

            expect(logged[1].message).to.equal('Received response for unknown request');
            expect(logged[1].type).to.equal('protocol');

            client.disconnect();
            await server.stop();
        });

        it('uses error when message is missing', async () => {

            const server = Hapi.server();

            const onSubscribe = (socket, path, params) => {

                const error = Boom.badRequest();
                delete error.output.payload.message;
                throw error;
            };

            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/', { onSubscribe });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            await expect(client.subscribe('/', Hoek.ignore)).to.reject('Bad Request');
            client.disconnect();
            await server.stop();
        });
    });

    describe('subscribe()', () => {

        it('subscribes to a path', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/', {});

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler = (update, flags) => {

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

        it('subscribes to a unknown path (pre connect)', async () => {

            const server = Hapi.server();

            const order = [];
            const onConnection = () => order.push(1);
            const onDisconnection = () => order.push(2);
            await server.register({ plugin: Nes, options: { auth: false, onConnection, onDisconnection } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            const team = new Teamwork();
            client.onDisconnect = async (willReconnect, log) => {

                expect(log.wasRequested).to.be.false();
                await Hoek.wait(50);

                expect(order).to.equal([1, 2]);
                team.attend();
            };

            await client.subscribe('/b', Hoek.ignore);

            const err = await expect(client.connect()).to.reject('Subscription not found');
            expect(err.type).to.equal('server');
            expect(err.statusCode).to.equal(404);
            expect(client.subscriptions()).to.be.empty();

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('subscribes to a path (pre connect)', async () => {

            const server = Hapi.server();

            const order = [];
            const onConnection = () => order.push(1);
            const onDisconnection = () => order.push(3);
            await server.register({ plugin: Nes, options: { auth: false, onConnection, onDisconnection } });

            const onSubscribe = (socket, path, params) => {

                order.push(2);
            };

            server.subscription('/', { onSubscribe });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            const team = new Teamwork();
            const handler = async (update, flags) => {

                expect(update).to.equal('heya');
                client.disconnect();
                await Hoek.wait(50);

                expect(order).to.equal([1, 2, 3]);
                team.attend();
            };

            await client.subscribe('/', handler);

            await client.connect();
            server.publish('/', 'heya');

            await team.work;
            await server.stop();
        });

        it('manages multiple subscriptions', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/');

            await server.start();
            const client1 = new Nes.Client('http://localhost:' + server.info.port);
            const client2 = new Nes.Client('http://localhost:' + server.info.port);

            await client1.connect();
            await client2.connect();

            const team = new Teamwork();
            const handler = (update, flags) => {

                expect(update).to.equal('heya');
                team.attend();
            };

            await client1.subscribe('/', handler);
            await client2.subscribe('/', Hoek.ignore);

            client2.disconnect();
            await Hoek.wait(10);
            server.publish('/', 'heya');

            await team.work;
            client1.disconnect();
            await server.stop();
        });

        it('ignores publish to a unknown path', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/');

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            await client.subscribe('/', Hoek.ignore);
            delete client._subscriptions['/'];

            server.publish('/', 'heya');
            await Hoek.wait(10);

            client.disconnect();
            await server.stop();
        });

        it('errors on unknown path', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const err = await expect(client.subscribe('/', Hoek.ignore)).to.reject('Subscription not found');
            expect(err.type).to.equal('server');
            client.disconnect();
            await server.stop();
        });

        it('subscribes and immediately unsubscribe to a path (all handlers)', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const handler = (update, flags) => {

                throw new Error('Must not be called');
            };

            const err = await expect(client.subscribe('/', handler)).to.reject('Subscription not found');
            expect(err.type).to.equal('server');

            await client.unsubscribe('/', null);
            client.disconnect();
            await server.stop();
        });

        it('subscribes and immediately unsubscribe to a path (single handler)', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const handler = (update, flags) => {

                throw new Error('Must not be called');
            };

            const err = await expect(client.subscribe('/', handler)).to.reject('Subscription not found');
            expect(err.type).to.equal('server');

            await client.unsubscribe('/', handler);
            client.disconnect();
            await server.stop();
        });

        it('subscribes and unsubscribes to a path before connecting', () => {

            const client = new Nes.Client('http://localhost');

            const handler1 = (update, flags) => { };
            const handler2 = (update, flags) => { };
            const handler3 = (update, flags) => { };
            const handler4 = (update, flags) => { };

            // Initial subscription

            client.subscribe('/', handler1);
            client.subscribe('/a', handler2);
            client.subscribe('/a/b', handler3);
            client.subscribe('/b/c', handler4);

            // Ignore duplicates

            client.subscribe('/', handler1);
            client.subscribe('/a', handler2);
            client.subscribe('/a/b', handler3);
            client.subscribe('/b/c', handler4);

            // Subscribe to some with additional handlers

            client.subscribe('/a', handler1);
            client.subscribe('/b/c', handler2);

            // Unsubscribe initial set

            client.unsubscribe('/', handler1);
            client.unsubscribe('/a', handler2);
            client.unsubscribe('/a/b', handler3);
            client.unsubscribe('/b/c', handler4);

            expect(client.subscriptions()).to.equal(['/a', '/b/c']);
        });

        it('errors on subscribe fail', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/');

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            client._ws.send = () => {

                throw new Error('failed');
            };

            const err = await expect(client.subscribe('/', Hoek.ignore)).to.reject('failed');
            expect(err.type).to.equal('ws');

            client.disconnect();
            await server.stop();
        });

        it('errors on missing path', async () => {

            const client = new Nes.Client('http://localhost');

            const err = await expect(client.subscribe(null, Hoek.ignore)).to.reject('Invalid path');
            expect(err.type).to.equal('user');
        });

        it('errors on invalid path', async () => {

            const client = new Nes.Client('http://localhost');

            const err = await expect(client.subscribe('asd', Hoek.ignore)).to.reject('Invalid path');
            expect(err.type).to.equal('user');
        });

        it('subscribes, unsubscribes, then subscribes again to a path', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/', {});

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler1 = async (update1, flags1) => {

                expect(client.subscriptions()).to.equal(['/']);
                expect(update1).to.equal('abc');

                await client.unsubscribe('/', null);
                const handler2 = (update2, flags2) => {

                    expect(client.subscriptions()).to.equal(['/']);
                    expect(update2).to.equal('def');
                    team.attend();
                };

                await client.subscribe('/', handler2);
                server.publish('/', 'def');
            };

            await client.subscribe('/', handler1);
            server.publish('/', 'abc');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('handles revocation', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/', {});

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler = (update, flags) => {

                expect(client.subscriptions()).to.equal([]);
                expect(update).to.equal('heya');
                expect(flags.revoked).to.be.true();

                team.attend();
            };

            await client.subscribe('/', handler);
            expect(client.subscriptions()).to.equal(['/']);
            server.eachSocket((socket) => socket.revoke('/', 'heya'));

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('handles revocation (no update)', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/', {});

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            let updated = false;
            const handler = (update, flags) => {

                updated = true;
            };

            await client.subscribe('/', handler);
            expect(client.subscriptions()).to.equal(['/']);

            const team = new Teamwork();
            server.eachSocket(async (socket) => {

                await socket.revoke('/', null);
                await Hoek.wait(50);

                expect(client.subscriptions()).to.equal([]);
                expect(updated).to.be.false();
                team.attend();
            });

            await team.work;
            client.disconnect();
            await server.stop();
        });
    });

    describe('unsubscribe()', () => {

        it('drops all handlers', async () => {

            const client = new Nes.Client('http://localhost');

            client.subscribe('/a/b', Hoek.ignore);
            client.subscribe('/a/b', Hoek.ignore);

            await client.unsubscribe('/a/b', null);
            expect(client.subscriptions()).to.be.empty();
        });

        it('ignores unknown path', () => {

            const client = new Nes.Client('http://localhost');

            const handler1 = (update, flags) => { };

            client.subscribe('/a/b', handler1);
            client.subscribe('/b/c', Hoek.ignore);

            client.unsubscribe('/a/b/c', handler1);
            client.unsubscribe('/b/c', handler1);

            expect(client.subscriptions()).to.equal(['/a/b', '/b/c']);
        });

        it('errors on missing path', async () => {

            const client = new Nes.Client('http://localhost');

            const err = await expect(client.unsubscribe('', null)).to.reject('Invalid path');
            expect(err.type).to.equal('user');
        });

        it('errors on invalid path', async () => {

            const client = new Nes.Client('http://localhost');

            const err = await expect(client.unsubscribe('asd', null)).to.reject('Invalid path');
            expect(err.type).to.equal('user');
        });
    });

    describe('_beat()', () => {

        it('disconnects when server fails to ping', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, heartbeat: { interval: 20, timeout: 10 } } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;

            const team = new Teamwork();
            client.onDisconnect = (willReconnect, log) => {

                team.attend();
            };

            await client.connect();
            clearTimeout(server.plugins.nes._listener._heartbeat);

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('disconnects when server fails to ping (after a few pings)', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, heartbeat: { interval: 20, timeout: 10 } } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;

            const team = new Teamwork();
            client.onDisconnect = (willReconnect, log) => {

                team.attend();
            };

            await client.connect();
            await Hoek.wait(50);
            clearTimeout(server.plugins.nes._listener._heartbeat);

            await team.work;
            client.disconnect();
            await server.stop();
        });
    });
});
