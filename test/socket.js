'use strict';

// Load modules

const Boom = require('boom');
const Code = require('code');
const Hapi = require('hapi');
const Hoek = require('hoek');
const Lab = require('lab');
const Nes = require('../');
const Ws = require('ws');


// Declare internals

const internals = {};


// Test shortcuts

const lab = exports.lab = Lab.script();
const describe = lab.describe;
const it = lab.it;
const expect = Code.expect;


describe('Socket', () => {

    it('exposes app namespace', (done) => {

        const server = new Hapi.Server();
        server.connection();

        const onConnection = function (socket) {

            socket.app.x = 'hello';
        };

        server.register({ register: Nes, options: { onConnection: onConnection, auth: false } }, (err) => {

            expect(err).to.not.exist();

            server.route({
                method: 'GET',
                path: '/',
                handler: function (request, reply) {

                    return reply(request.socket.app.x);
                }
            });

            server.start((err) => {

                expect(err).to.not.exist();
                const client = new Nes.Client('http://localhost:' + server.info.port);
                client.connect(() => {

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

    describe('disconnect()', () => {

        it('closes connection', (done) => {

            const onMessage = function (socket, message, reply) {

                socket.disconnect();
            };

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { onMessage: onMessage } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.onDisconnect = function () {

                        client.disconnect();
                        server.stop(done);
                    };

                    client.connect(() => {

                        client.message('winning', (errIgnore, response) => { });
                    });
                });
            });
        });
    });

    describe('send()', () => {

        it('sends custom message', (done) => {

            const onConnection = function (socket) {

                socket.send('goodbye');
            };

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { onConnection: onConnection } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.onUpdate = function (message) {

                        expect(message).to.equal('goodbye');
                        client.disconnect();
                        server.stop(done);
                    };

                    client.connect(() => { });
                });
            });
        });

        it('sends custom message (callback)', (done) => {

            let sent = false;
            const onConnection = function (socket) {

                socket.send('goodbye', (err) => {

                    expect(err).to.not.exist();
                    sent = true;
                });
            };

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { onConnection: onConnection } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.onUpdate = function (message) {

                        expect(message).to.equal('goodbye');
                        expect(sent).to.be.true();
                        client.disconnect();
                        server.stop(done);
                    };

                    client.connect(() => { });
                });
            });
        });
    });

    describe('publish()', () => {

        it('updates a single socket subscription on subscribe', (done) => {

            const server = new Hapi.Server();

            const onSubscribe = function (socket, path, params, next) {

                expect(socket).to.exist();
                expect(path).to.equal('/1');
                expect(params.id).to.equal('1');

                socket.publish(path, 'Initial state');
                return next();
            };

            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                server.connection();

                server.subscription('/{id}', { onSubscribe: onSubscribe });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.connections[0].info.port);
                    client.connect(() => {

                        const each = (update) => {

                            expect(update).to.equal('Initial state');
                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/1', each, Hoek.ignore);
                    });
                });
            });
        });

        it('passes a callback', (done) => {

            const server = new Hapi.Server();

            const onSubscribe = function (socket, path, params, next) {

                expect(socket).to.exist();
                expect(path).to.equal('/1');
                expect(params.id).to.equal('1');

                socket.publish(path, 'Initial state', (err) => {

                    expect(err).to.not.exist();
                    socket.publish(path, 'Updated state');
                });

                return next();      // Does not wait for publish callback
            };

            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                server.connection();

                server.subscription('/{id}', { onSubscribe: onSubscribe });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.connections[0].info.port);
                    client.connect(() => {

                        let count = 0;
                        const each = (update) => {

                            ++count;
                            if (count === 1) {
                                expect(update).to.equal('Initial state');
                            }
                            else {
                                expect(update).to.equal('Updated state');
                                client.disconnect();
                                server.stop(done);
                            }
                        };

                        client.subscribe('/1', each, Hoek.ignore);
                    });
                });
            });
        });
    });

    describe('_send()', () => {

        it('errors on invalid message', (done) => {

            const server = new Hapi.Server();
            let client;
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.on('log', (event, tags) => {

                    expect(event.data).to.equal('other');
                    client.disconnect();
                    server.stop(done);
                });

                server.start((err) => {

                    expect(err).to.not.exist();
                    client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();
                        const a = { id: 1, type: 'other' };
                        a.c = a;                    // Circular reference

                        server.connections[0].plugins.nes._listener._sockets.forEach((socket) => {

                            socket._send(a, Hoek.ignore);
                        });
                    });
                });
            });
        });
    });

    describe('_flush()', () => {

        it('breaks large message into smaller packets', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false, payload: { maxChunkChars: 5 } } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    const text = 'this is a message longer than 5 bytes';

                    client.onUpdate = function (message) {

                        expect(message).to.equal(text);
                        client.disconnect();
                        server.stop(done);
                    };

                    client.connect((err) => {

                        expect(err).to.not.exist();
                        server.broadcast(text);
                    });
                });
            });
        });
    });

    describe('_active()', () => {

        it('shows active mode while publishing', (done) => {

            const server = new Hapi.Server();
            server.connection();

            let connection;
            const onConnection = (socket) => {

                connection = socket;
            };

            server.register({ register: Nes, options: { onConnection: onConnection, auth: false, payload: { maxChunkChars: 5 } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/{id}', {});

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        const handler = (update) => {

                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/5', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/5', '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890');
                            connection._pinged = false;
                            expect(connection._active()).to.be.true();
                        });
                    });
                });
            });
        });
    });

    describe('_onMessage()', () => {

        it('supports route id', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    config: {
                        id: 'resource',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    }
                });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.request('resource', (err, payload, statusCode, headers) => {

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

        it('errors on unknown route id', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    config: {
                        id: 'resource',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    }
                });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.request('something', (err, payload, statusCode, headers) => {

                            expect(err).to.exist();
                            expect(statusCode).to.equal(404);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on wildcard method route id', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: '*',
                    path: '/',
                    config: {
                        id: 'resource',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    }
                });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.request('resource', (err, payload, statusCode, headers) => {

                            expect(err).to.exist();
                            expect(statusCode).to.equal(400);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on invalid request message', (done) => {

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
                    const client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', (data, flags) => {

                        const message = JSON.parse(data);
                        expect(message.payload).to.deep.equal({
                            error: 'Bad Request',
                            message: 'Cannot parse message'
                        });

                        expect(message.statusCode).to.equal(400);

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', () => {

                        client.send('{', (err) => {

                            expect(err).to.not.exist();
                        });
                    });
                });
            });
        });

        it('errors on auth endpoint request', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: { password: 'password' } } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();
                        client.request('/nes/auth', (err, payload, statusCode, headers) => {

                            expect(err).to.exist();
                            expect(statusCode).to.equal(404);
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on missing id', (done) => {

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
                    const client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', (data, flags) => {

                        const message = JSON.parse(data);
                        expect(message.payload).to.deep.equal({
                            error: 'Bad Request',
                            message: 'Message missing id'
                        });

                        expect(message.statusCode).to.equal(400);
                        expect(message.type).to.equal('request');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', () => {

                        client.send(JSON.stringify({ type: 'request', method: 'GET', path: '/' }), (err) => {

                            expect(err).to.not.exist();
                        });
                    });
                });
            });
        });

        it('errors on uninitialized connection', (done) => {

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
                    const client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', (data, flags) => {

                        const message = JSON.parse(data);
                        expect(message.payload.message).to.equal('Connection is not initialized');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', () => {

                        client.send(JSON.stringify({ id: 1, type: 'request', path: '/' }), (err) => {

                            expect(err).to.not.exist();
                        });
                    });
                });
            });
        });

        it('errors on missing method', (done) => {

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
                    const client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', (data, flags) => {

                        const message = JSON.parse(data);
                        if (message.id !== 2) {
                            return;
                        }

                        expect(message.payload).to.deep.equal({
                            error: 'Bad Request',
                            message: 'Message missing method'
                        });

                        expect(message.statusCode).to.equal(400);
                        expect(message.type).to.equal('request');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', () => {

                        client.send(JSON.stringify({ id: 1, type: 'hello', version: '2' }), (err) => {

                            expect(err).to.not.exist();
                            client.send(JSON.stringify({ id: 2, type: 'request', path: '/' }), (err) => {

                                expect(err).to.not.exist();
                            });
                        });
                    });
                });
            });
        });

        it('errors on missing path', (done) => {

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
                    const client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', (data, flags) => {

                        const message = JSON.parse(data);
                        if (message.id !== 2) {
                            return;
                        }

                        expect(message.payload).to.deep.equal({
                            error: 'Bad Request',
                            message: 'Message missing path'
                        });

                        expect(message.statusCode).to.equal(400);
                        expect(message.type).to.equal('request');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', () => {

                        client.send(JSON.stringify({ id: 1, type: 'hello', version: '2' }), (err) => {

                            expect(err).to.not.exist();
                            client.send(JSON.stringify({ id: 2, type: 'request', method: 'GET' }), (err) => {

                                expect(err).to.not.exist();
                            });
                        });
                    });
                });
            });
        });

        it('errors on unknown type', (done) => {

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
                    const client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', (data, flags) => {

                        const message = JSON.parse(data);
                        if (message.id !== 2) {
                            return;
                        }

                        expect(message.payload).to.deep.equal({
                            error: 'Bad Request',
                            message: 'Unknown message type'
                        });

                        expect(message.statusCode).to.equal(400);
                        expect(message.type).to.equal('unknown');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', () => {

                        client.send(JSON.stringify({ id: 1, type: 'hello', version: '2' }), (err) => {

                            expect(err).to.not.exist();
                            client.send(JSON.stringify({ id: 2, type: 'unknown' }), (err) => {

                                expect(err).to.not.exist();
                            });
                        });
                    });
                });
            });
        });

        it('errors on incorrect version', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', (data, flags) => {

                        const message = JSON.parse(data);
                        expect(message.payload).to.deep.equal({
                            error: 'Bad Request',
                            message: 'Incorrect protocol version (expected 2 but received 1)'
                        });

                        expect(message.statusCode).to.equal(400);

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', () => {

                        client.send(JSON.stringify({ id: 1, type: 'hello', version: '1' }), (err) => {

                            expect(err).to.not.exist();
                        });
                    });
                });
            });
        });

        it('errors on missing version', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', (data, flags) => {

                        const message = JSON.parse(data);
                        expect(message.payload).to.deep.equal({
                            error: 'Bad Request',
                            message: 'Incorrect protocol version (expected 2 but received none)'
                        });

                        expect(message.statusCode).to.equal(400);

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', () => {

                        client.send(JSON.stringify({ id: 1, type: 'hello' }), (err) => {

                            expect(err).to.not.exist();
                        });
                    });
                });
            });
        });

        it('unsubscribes to two paths on same subscription', (done) => {

            const server = new Hapi.Server();
            server.connection();

            const onMessage = function (socket, message, next) {

                return next('b');
            };

            server.register({ register: Nes, options: { auth: false, onMessage: onMessage } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/{id}', {});

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.subscribe('/5', Hoek.ignore, (err) => {

                            expect(err).to.not.exist();
                            const handler = (update) => {

                                client.unsubscribe('/5');
                                client.unsubscribe('/6');

                                client.message('a', (err, message) => {

                                    expect(err).to.not.exist();
                                    const listener = server.connections[0].plugins.nes._listener;
                                    const match = listener._router.route('sub', '/5');
                                    expect(match.route.subscribers._items).to.deep.equal({});

                                    client.disconnect();
                                    server.stop(done);
                                });
                            };

                            client.subscribe('/6', handler, (err) => {

                                expect(err).to.not.exist();
                                server.publish('/6', 'b');
                            });
                        });
                    });
                });
            });
        });

        it('ignores double unsubscribe to same subscription', (done) => {

            const server = new Hapi.Server();
            server.connection();

            const onMessage = function (socket, message, next) {

                return next('b');
            };

            server.register({ register: Nes, options: { auth: false, onMessage: onMessage } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/{id}', {});

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        const handler = (update) => {

                            client.unsubscribe('/6');
                            client._send({ type: 'unsub', path: '/6' });

                            client.message('a', (err, message) => {

                                expect(err).to.not.exist();
                                const listener = server.connections[0].plugins.nes._listener;
                                const match = listener._router.route('sub', '/6');
                                expect(match.route.subscribers._items).to.deep.equal({});

                                client.disconnect();
                                server.stop(done);
                            });
                        };

                        client.subscribe('/6', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/6', 'b');
                        });
                    });
                });
            });
        });
    });

    describe('_processRequest()', () => {

        it('exposes socket to request', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply(request.socket.id);
                    }
                });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.request('/', (err, payload, statusCode, headers) => {

                            expect(err).to.not.exist();
                            expect(payload).to.equal(client.id);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('passed headers', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false, headers: '*' } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello ' + request.headers.a);
                    }
                });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.request({ path: '/', headers: { a: 'b' } }, (err, payload, statusCode, headers) => {

                            expect(err).to.not.exist();
                            expect(payload).to.equal('hello b');
                            expect(statusCode).to.equal(200);
                            expect(headers).to.contain({ 'content-type': 'text/html; charset=utf-8' });

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on authorization header', (done) => {

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

                        client.request({ path: '/', headers: { Authorization: 'something' } }, (err, payload, statusCode, headers) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Cannot include an Authorization header');

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });
    });

    describe('_processMessage()', () => {

        it('calls onMessage callback', (done) => {

            const onMessage = function (socket, message, reply) {

                expect(message).to.equal('winning');
                reply('hello');
            };

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { onMessage: onMessage } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.message('winning', (err, response) => {

                            expect(err).to.not.exist();
                            expect(response).to.equal('hello');
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('sends errors from callback (raw)', (done) => {

            const onMessage = function (socket, message, reply) {

                expect(message).to.equal('winning');
                reply(new Error('failed'));
            };

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { onMessage: onMessage } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.message('winning', (err, response) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('An internal server error occurred');
                            expect(err.statusCode).to.equal(500);
                            expect(response).to.not.exist();
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('sends errors from callback (boom)', (done) => {

            const onMessage = function (socket, message, reply) {

                expect(message).to.equal('winning');
                reply(Boom.badRequest('failed'));
            };

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { onMessage: onMessage } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.message('winning', (err, response) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('failed');
                            expect(err.statusCode).to.equal(400);
                            expect(response).to.not.exist();
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors if missing onMessage callback', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: {} }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.message('winning', (err, response) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Not Implemented');
                            expect(err.statusCode).to.equal(501);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });
    });
});
