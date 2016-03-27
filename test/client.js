'use strict';

// Load modules

const Boom = require('boom');
const Code = require('code');
const Hapi = require('hapi');
const Hoek = require('hoek');
const Lab = require('lab');
const Nes = require('../');


// Declare internals

const internals = {};


// Test shortcuts

const lab = exports.lab = Lab.script();
const describe = lab.describe;
const it = lab.it;
const expect = Code.expect;


describe('Browser', () => {

    describe('Client', () => {

        describe('onError', () => {

            it('logs error to console by default', { parallel: false }, (done) => {

                const orig = console.error;
                console.error = (err) => {

                    expect(err).to.exist();
                    console.error = orig;
                    done();
                };

                const client = new Nes.Client('http://nosuchexamplecom');
                client.connect((err) => {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Socket error');
                    expect(err.type).to.equal('ws');
                });

                client._ws.emit('error', new Error('test'));
                client._ws.emit('open');
            });
        });

        describe('connect()', () => {

            it('fails to connect', (done) => {

                const client = new Nes.Client('http://nosuchexamplecom');

                client.connect((err) => {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Socket error');
                    expect(err.type).to.equal('ws');
                    done();
                });
            });

            it('handles error before open events', (done) => {

                const client = new Nes.Client('http://nosuchexamplecom');
                client.onError = Hoek.ignore;

                client.connect((err) => {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Socket error');
                    expect(err.type).to.equal('ws');

                    done();
                });

                client._ws.emit('error', new Error('test'));
                client._ws.emit('open');
            });
        });

        describe('_connect()', () => {

            it('handles unknown error code', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();
                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            client.onError = Hoek.ignore;
                            client.onDisconnect = (willReconnect, log) => {

                                expect(log.explanation).to.equal('Unknown');
                                server.stop(done);
                            };

                            client._ws.onclose({ code: 9999, reason: 'bug', wasClean: false });
                        });
                    });
                });
            });
        });

        describe('overrideReconnectionAuth()', () => {

            it('reconnects automatically', (done) => {

                const server = new Hapi.Server();
                server.connection();

                server.auth.scheme('custom', (srv, options) => {

                    return {
                        authenticate: function (request, reply) {

                            const authorization = request.headers.authorization;
                            if (!authorization) {
                                return reply(Boom.unauthorized(null, 'Custom'));
                            }

                            const parts = authorization.split(/\s+/);
                            return reply.continue({ credentials: { user: parts[1] } });
                        }
                    };
                });

                server.auth.strategy('default', 'custom', 'optional');

                server.route({
                    method: 'GET',
                    path: '/',
                    config: {
                        auth: {
                            mode: 'optional'
                        },
                        handler: function (request, reply) {

                            if (request.auth.isAuthenticated) {
                                return reply(request.auth.credentials.user);
                            }

                            return reply('nope');
                        }
                    }
                });

                server.register(Nes, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        client.onError = Hoek.ignore;

                        let c = 0;
                        client.onConnect = function () {

                            ++c;
                            if (c === 2) {
                                client.request('/', (err, result) => {

                                    expect(err).to.not.exist();
                                    expect(result).to.equal('john');
                                    client.disconnect();

                                    expect(client.overrideReconnectionAuth({ headers: { authorization: 'Custom steve' } })).to.be.false();

                                    server.stop(done);
                                });
                            }
                        };

                        client.onDisconnect = function (willReconnect, log) {

                            if (c === 1) {
                                expect(client.overrideReconnectionAuth({ headers: { authorization: 'Custom john' } })).to.be.true();
                            }
                        };

                        client.connect({ delay: 10 }, (err) => {

                            expect(err).to.not.exist();

                            client.request('/', (err, result) => {

                                expect(err).to.not.exist();
                                expect(result).to.equal('nope');
                                client._ws.close();
                            });
                        });
                    });
                });
            });
        });

        describe('disconnect()', () => {

            it('ignores when client not connected', (done) => {

                const client = new Nes.Client();

                client.disconnect();
                done();
            });

            it('ignores when client is disconnecting', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            client.disconnect();
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });

            it('allows closing from inside request callback', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    });

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                                client.disconnect();
                                setTimeout(() => server.stop(done), 100);
                            });
                        });
                    });
                });
            });
        });

        describe('_reconnect()', () => {

            it('reconnects automatically', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        let e = 0;
                        client.onError = function (err) {

                            expect(err).to.exist();
                            ++e;
                        };

                        let c = 0;
                        client.onConnect = function () {

                            ++c;
                            if (c === 2) {
                                expect(e).to.equal(0);
                                client.disconnect();
                                server.stop(done);
                            }
                        };

                        expect(c).to.equal(0);
                        expect(e).to.equal(0);
                        client.connect({ delay: 10 }, (err) => {

                            expect(err).to.not.exist();

                            expect(c).to.equal(1);
                            expect(e).to.equal(0);

                            client._ws.close();
                        });
                    });
                });
            });

            it('does not reconnect automatically', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        let e = 0;
                        client.onError = function (err) {

                            expect(err).to.exist();
                            ++e;
                        };

                        let c = 0;
                        client.onConnect = function () {

                            ++c;
                        };

                        let r = '';
                        client.onDisconnect = function (willReconnect) {

                            r += willReconnect ? 't' : 'f';
                        };

                        expect(c).to.equal(0);
                        expect(e).to.equal(0);
                        client.connect({ reconnect: false, delay: 10 }, () => {

                            expect(c).to.equal(1);
                            expect(e).to.equal(0);

                            client._ws.close();
                            setTimeout(() => {

                                expect(c).to.equal(1);
                                expect(r).to.equal('f');
                                server.stop(done);
                            }, 15);
                        });
                    });
                });
            });

            it('overrides max delay', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        let c = 0;
                        const now = Date.now();
                        client.onConnect = function () {

                            ++c;

                            if (c < 6) {
                                client._ws.close();
                                return;
                            }

                            expect(Date.now() - now).to.be.below(150);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.connect({ delay: 10, maxDelay: 11 }, () => { });
                    });
                });
            });

            it('reconnects automatically (with errors)', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const url = 'http://localhost:' + server.info.port;
                        const client = new Nes.Client(url);

                        let e = 0;
                        client.onError = function (err) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Socket error');
                            expect(err.type).to.equal('ws');

                            ++e;
                            client._url = 'http://localhost:' + server.info.port;
                        };

                        let r = '';
                        client.onDisconnect = function (willReconnect) {

                            r += willReconnect ? 't' : 'f';
                        };

                        let c = 0;
                        client.onConnect = function () {

                            ++c;

                            if (c < 5) {
                                client._ws.close();

                                if (c === 3) {
                                    client._url = 'http://invalid';
                                }

                                return;
                            }

                            expect(e).to.equal(1);
                            expect(r).to.equal('tttt');

                            client.disconnect();
                            server.stop(done);
                        };

                        expect(e).to.equal(0);
                        client.connect({ delay: 10, maxDelay: 15 }, () => { });
                    });
                });
            });

            it('errors on pending request when closed', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            setTimeout(() => {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Request failed - server disconnected');
                                expect(err.type).to.equal('disconnect');

                                server.stop(done);
                            });

                            client.disconnect();
                        });
                    });
                });
            });

            it('times out', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        server.connections[0].plugins.nes._listener._wss.handleUpgrade = function () { };

                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        let c = 0;
                        client.onConnect = function () {

                            ++c;
                        };

                        let e = 0;
                        client.onError = function (err) {

                            ++e;
                            expect(err).to.exist();
                            expect(err.message).to.equal('Connection timed out');
                            expect(err.type).to.equal('timeout');

                            if (e < 4) {
                                return;
                            }

                            expect(c).to.equal(0);
                            client.disconnect();
                            server.stop({ timeout: 1 }, done);
                        };

                        client.connect({ delay: 10, maxDelay: 10, timeout: 10 }, (err) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Connection timed out');
                            expect(err.type).to.equal('timeout');
                        });
                    });
                });
            });

            it('limits retries', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        let c = 0;
                        client.onConnect = function () {

                            ++c;
                            client._ws.close();
                        };

                        let r = '';
                        client.onDisconnect = function (willReconnect) {

                            r += willReconnect ? 't' : 'f';
                        };

                        client.connect({ delay: 5, maxDelay: 10, retries: 2 }, () => {

                            setTimeout(() => {

                                expect(c).to.equal(3);
                                expect(r).to.equal('ttf');
                                server.stop(done);
                            }, 100);
                        });
                    });
                });
            });

            it('aborts reconnect if disconnect is called in between attempts', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        let c = 0;
                        client.onConnect = function () {

                            ++c;
                            client._ws.close();

                            if (c === 1) {
                                setTimeout(() => {

                                    client.disconnect();
                                }, 5);

                                setTimeout(() => {

                                    expect(c).to.equal(1);
                                    server.stop(done);
                                }, 15);
                            }
                        };

                        client.connect({ delay: 10 }, () => { });
                    });
                });
            });
        });

        describe('request()', () => {

            it('defaults to GET', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false, headers: '*' } }, (err) => {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    });

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            client.request({ path: '/' }, (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                                expect(payload).to.equal('hello');
                                expect(statusCode).to.equal(200);
                                expect(headers).to.contain({ 'content-type': 'text/html; charset=utf-8' });

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('errors when disconnected', (done) => {

                const client = new Nes.Client();

                client.request('/', (err, payload, statusCode, headers) => {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Failed to send message - server disconnected');
                    expect(err.type).to.equal('disconnect');
                    done();
                });
            });

            it('errors on invalid payload', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'POST',
                        path: '/',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    });

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            const a = { b: 1 };
                            a.a = a;

                            client.request({ method: 'POST', path: '/', payload: a }, (err, payload, statusCode, headers) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Converting circular structure to JSON');
                                expect(err.type).to.equal('user');
                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('errors on invalid data', { parallel: false }, (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'POST',
                        path: '/',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    });

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            client._ws.send = function () {

                                throw new Error('boom');
                            };

                            client.request({ method: 'POST', path: '/', payload: 'a' }, (err, payload, statusCode, headers) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('boom');
                                expect(err.type).to.equal('ws');
                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        describe('message()', () => {

            it('errors on timeout', (done) => {

                const onMessage = function (socket, message, reply) {

                    setTimeout(() => {

                        return reply('hello');
                    }, 50);
                };

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { onMessage: onMessage } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port, { timeout: 20 });
                        client.connect(() => {

                            client.message('winning', (err, response) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Request timed out');
                                expect(err.type).to.equal('timeout');
                                expect(response).to.not.exist();

                                setTimeout(() => {

                                    client.disconnect();
                                    server.stop(done);
                                }, 50);
                            });
                        });
                    });
                });
            });
        });

        describe('_send()', () => {

            it('catches send error without tracking', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            client._ws.send = function () {

                                throw new Error('failed');
                            };

                            client._send({}, false, (err) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('failed');
                                expect(err.type).to.equal('ws');

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        describe('_onMessage', () => {

            it('ignores invalid incoming message', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            request.connection.plugins.nes._listener._sockets.forEach((socket) => {

                                socket._ws.send('{');
                            });

                            setTimeout(() => {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        let logged;
                        client.onError = function (err) {

                            logged = err;
                        };

                        client.connect(() => {

                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                                expect(logged.message).to.equal('Unexpected end of input');
                                expect(logged.type).to.equal('protocol');

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('reports incomplete message', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            request.connection.plugins.nes._listener._sockets.forEach((socket) => {

                                socket._ws.send('+abc');
                            });

                            setTimeout(() => {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        let logged;
                        client.onError = function (err) {

                            logged = err;
                        };

                        client.connect(() => {

                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                                expect(logged.message).to.equal('Received an incomplete message');
                                expect(logged.type).to.equal('protocol');

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('ignores incoming message with unknown id', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            request.connection.plugins.nes._listener._sockets.forEach((socket) => {

                                socket._ws.send('{"id":100,"type":"response","statusCode":200,"payload":"hello","headers":{}}');
                            });

                            setTimeout(() => {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        let logged;
                        client.onError = function (err) {

                            logged = err;
                        };

                        client.connect(() => {

                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                                expect(logged.message).to.equal('Received response for unknown request');
                                expect(logged.type).to.equal('protocol');

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('ignores incoming message with unknown type', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            request.connection.plugins.nes._listener._sockets.forEach((socket) => {

                                socket._ws.send('{"id":2,"type":"unknown","statusCode":200,"payload":"hello","headers":{}}');
                            });

                            setTimeout(() => {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        let logged;
                        client.onError = function (err) {

                            if (!logged) {
                                logged = err;
                                return;
                            }

                            expect(logged.message).to.equal('Received unknown response type: unknown');
                            expect(logged.type).to.equal('protocol');

                            expect(err.message).to.equal('Received response for unknown request');
                            expect(err.type).to.equal('protocol');

                            client.disconnect();
                            server.stop(done);
                        };

                        client.connect(() => {

                            client.request('/', (err, payload, statusCode, headers) => {

                                expect(err).to.not.exist();
                            });
                        });
                    });
                });
            });
        });

        describe('subscribe()', () => {

            it('subscribes to a path', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.subscription('/', {});

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

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

            it('subscribes to a unknown path (pre connect)', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        client.subscribe('/b', Hoek.ignore, (err) => {

                            expect(err).to.not.exist();

                            client.connect((err) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Subscription not found');
                                expect(err.type).to.equal('server');
                                expect(err.statusCode).to.equal(404);
                                expect(client.subscriptions()).to.be.empty();

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('subscribes to a path (pre connect)', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.subscription('/');

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);

                        const handler = (update) => {

                            expect(update).to.equal('heya');
                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();

                            client.connect((err) => {

                                expect(err).to.not.exist();
                                server.publish('/', 'heya');
                            });
                        });
                    });
                });
            });

            it('manages multiple subscriptions', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.subscription('/');

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client1 = new Nes.Client('http://localhost:' + server.info.port);
                        const client2 = new Nes.Client('http://localhost:' + server.info.port);

                        client1.connect((err) => {

                            expect(err).to.not.exist();
                            client2.connect((err) => {

                                expect(err).to.not.exist();
                                const handler = (update) => {

                                    expect(update).to.equal('heya');
                                    client1.disconnect();
                                    server.stop(done);
                                };

                                client1.subscribe('/', handler, (err) => {

                                    expect(err).to.not.exist();

                                    client2.subscribe('/', Hoek.ignore, (err) => {

                                        expect(err).to.not.exist();

                                        client2.disconnect();
                                        setTimeout(() => {

                                            server.publish('/', 'heya');
                                        }, 10);
                                    });
                                });
                            });
                        });
                    });
                });
            });

            it('ignores publish to a unknown path', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.subscription('/');

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            client.subscribe('/', Hoek.ignore, (err) => {

                                expect(err).to.not.exist();
                                delete client._subscriptions['/'];

                                server.publish('/', 'heya');
                                setTimeout(() => {

                                    client.disconnect();
                                    server.stop(done);
                                }, 10);
                            });
                        });
                    });
                });
            });

            it('errors on unknown path', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            client.subscribe('/', Hoek.ignore, (err) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Subscription not found');
                                expect(err.type).to.equal('server');
                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('subscribes and immediately unsubscribe to a path (all handlers)', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            const handler = (update) => {

                                throw new Error('Must not be called');
                            };

                            client.subscribe('/', handler, (err) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Subscription not found');
                                expect(err.type).to.equal('server');

                                client.unsubscribe('/');

                                setTimeout(() => {

                                    client.disconnect();
                                    server.stop(done);
                                }, 20);
                            });
                        });
                    });
                });
            });

            it('subscribes and immediately unsubscribe to a path (single handler)', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            const handler = function (update) {

                                throw new Error('Must not be called');
                            };

                            client.subscribe('/', handler, (err) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Subscription not found');
                                expect(err.type).to.equal('server');

                                client.unsubscribe('/', handler);

                                setTimeout(() => {

                                    client.disconnect();
                                    server.stop(done);
                                }, 20);
                            });
                        });
                    });
                });
            });

            it('subscribes and unsubscribes to a path before connecting', (done) => {

                const client = new Nes.Client('http://localhost');

                const handler1 = (update) => { };
                const handler2 = (update) => { };
                const handler3 = (update) => { };
                const handler4 = (update) => { };

                // Initial subscription

                client.subscribe('/', handler1, Hoek.ignore);
                client.subscribe('/a', handler2, Hoek.ignore);
                client.subscribe('/a/b', handler3, Hoek.ignore);
                client.subscribe('/b/c', handler4, Hoek.ignore);

                // Ignore duplicates

                client.subscribe('/', handler1, Hoek.ignore);
                client.subscribe('/a', handler2, Hoek.ignore);
                client.subscribe('/a/b', handler3, Hoek.ignore);
                client.subscribe('/b/c', handler4, Hoek.ignore);

                // Subscribe to some with additional handlers

                client.subscribe('/a', handler1, Hoek.ignore);
                client.subscribe('/b/c', handler2, Hoek.ignore);

                // Unsubscribe initial set

                client.unsubscribe('/', handler1);
                client.unsubscribe('/a', handler2);
                client.unsubscribe('/a/b', handler3);
                client.unsubscribe('/b/c', handler4);

                expect(client.subscriptions()).to.deep.equal(['/a', '/b/c']);
                done();
            });

            it('errors on subscribe fail', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.subscription('/');

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            client._ws.send = function () {

                                throw new Error('failed');
                            };

                            client.subscribe('/', Hoek.ignore, (err) => {

                                expect(err).to.exist();
                                expect(err.message).to.equal('failed');
                                expect(err.type).to.equal('ws');

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('errors on missing path', (done) => {

                const client = new Nes.Client('http://localhost');

                client.subscribe('', Hoek.ignore, (err) => {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Invalid path');
                    expect(err.type).to.equal('user');
                    done();
                });
            });

            it('errors on invalid path', (done) => {

                const client = new Nes.Client('http://localhost');

                client.subscribe('asd', Hoek.ignore, (err) => {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Invalid path');
                    expect(err.type).to.equal('user');
                    done();
                });
            });

            it('subscribes, unsubscribes, then subscribes again to a path', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.subscription('/', {});

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(() => {

                            const handler1 = (update1) => {

                                expect(client.subscriptions()).to.deep.equal(['/']);
                                expect(update1).to.equal('abc');

                                client.unsubscribe('/');

                                const handler2 = (update2) => {

                                    expect(client.subscriptions()).to.deep.equal(['/']);
                                    expect(update2).to.equal('def');
                                    client.disconnect();
                                    server.stop(done);
                                };

                                client.subscribe('/', handler2, (err) => {

                                    expect(err).to.not.exist();
                                    server.publish('/', 'def');
                                });
                            };

                            client.subscribe('/', handler1, (err) => {

                                expect(err).to.not.exist();

                                server.publish('/', 'abc');
                            });
                        });
                    });
                });
            });
        });

        describe('unsubscribe()', () => {

            it('drops all handlers', (done) => {

                const client = new Nes.Client('http://localhost');

                client.subscribe('/a/b', Hoek.ignore, Hoek.ignore);
                client.subscribe('/a/b', Hoek.ignore, Hoek.ignore);

                client.unsubscribe('/a/b');

                expect(client.subscriptions()).to.be.empty();
                done();
            });

            it('ignores unknown path', (done) => {

                const client = new Nes.Client('http://localhost');

                const handler1 = (update) => { };

                client.subscribe('/a/b', handler1, Hoek.ignore);
                client.subscribe('/b/c', Hoek.ignore, Hoek.ignore);

                client.unsubscribe('/a/b/c', handler1);
                client.unsubscribe('/b/c', handler1);

                expect(client.subscriptions()).to.deep.equal(['/a/b', '/b/c']);
                done();
            });

            it('errors on missing path', (done) => {

                const client = new Nes.Client('http://localhost');

                client.unsubscribe('', (err, update) => {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Invalid path');
                    expect(err.type).to.equal('user');
                    done();
                });
            });

            it('errors on invalid path', (done) => {

                const client = new Nes.Client('http://localhost');

                client.unsubscribe('asd', (err, update) => {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Invalid path');
                    expect(err.type).to.equal('user');
                    done();
                });
            });
        });

        describe('_beat()', () => {

            it('disconnects when server fails to ping', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false, heartbeat: { interval: 20, timeout: 10 } } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.onError = Hoek.ignore;
                        client.onDisconnect = function () {

                            server.stop(done);
                        };

                        client.connect((err) => {

                            expect(err).to.not.exist();

                            clearTimeout(server.connections[0].plugins.nes._listener._heartbeat);
                        });
                    });
                });
            });

            it('disconnects when server fails to ping (after a few pings)', (done) => {

                const server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false, heartbeat: { interval: 20, timeout: 10 } } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.onError = Hoek.ignore;
                        client.onDisconnect = function () {

                            server.stop(done);
                        };

                        client.connect((err) => {

                            expect(err).to.not.exist();

                            setTimeout(() => {

                                clearTimeout(server.connections[0].plugins.nes._listener._heartbeat);
                            }, 50);
                        });
                    });
                });
            });
        });
    });
});
