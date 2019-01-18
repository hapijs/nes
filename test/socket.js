'use strict';

const Boom = require('boom');
const Code = require('code');
const Hapi = require('hapi');
const Hoek = require('hoek');
const Lab = require('lab');
const Nes = require('../');
const Teamwork = require('teamwork');
const Ws = require('ws');


const internals = {};


const { describe, it } = exports.lab = Lab.script();
const expect = Code.expect;


describe('Socket', () => {

    it('exposes app namespace', async () => {

        const server = Hapi.server();

        const onConnection = (socket) => {

            socket.app.x = 'hello';
        };

        await server.register({ plugin: Nes, options: { onConnection, auth: false } });

        server.route({
            method: 'GET',
            path: '/',
            handler: (request) => {

                expect(request.socket.server).to.exist();
                return request.socket.app.x;
            }
        });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port);
        await client.connect();

        const { payload, statusCode } = await client.request('/');
        expect(payload).to.equal('hello');
        expect(statusCode).to.equal(200);

        client.disconnect();
        await server.stop();
    });

    it('includes socket info', async () => {

        const team = new Teamwork();
        const server = Hapi.server();

        const onConnection = (socket) => {

            expect(socket.info.remoteAddress).to.equal('127.0.0.1');
            expect(socket.info.remotePort).to.be.a.number();

            team.attend();
        };

        await server.register({ plugin: Nes, options: { onConnection, auth: false } });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port);
        await client.connect();

        client.disconnect();
        await team.work;
        await server.stop();
    });

    describe('disconnect()', () => {

        it('closes connection', async () => {

            const server = Hapi.server();
            const onMessage = (socket, message) => socket.disconnect();
            await server.register({ plugin: Nes, options: { onMessage } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            const team = new Teamwork();
            client.onDisconnect = () => team.attend();

            await client.connect();
            await expect(client.message('winning')).to.reject();

            await team.work;
            client.disconnect();
            await server.stop();
        });
    });

    describe('send()', () => {

        it('sends custom message', async () => {

            const server = Hapi.server();
            const onConnection = (socket) => socket.send('goodbye');
            await server.register({ plugin: Nes, options: { onConnection } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            const team = new Teamwork();
            client.onUpdate = (message) => {

                expect(message).to.equal('goodbye');
                team.attend();
            };

            await client.connect();

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('sends custom message (callback)', async () => {

            let sent = false;
            const onConnection = async (socket) => {

                await socket.send('goodbye');
                sent = true;
            };

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { onConnection } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            const team = new Teamwork();
            client.onUpdate = (message) => {

                expect(message).to.equal('goodbye');
                expect(sent).to.be.true();
                team.attend();
            };

            await client.connect();

            await team.work;
            client.disconnect();
            await server.stop();
        });
    });

    describe('publish()', () => {

        it('updates a single socket subscription on subscribe', async () => {

            const server = Hapi.server();

            const onSubscribe = (socket, path, params) => {

                expect(socket).to.exist();
                expect(path).to.equal('/1');
                expect(params.id).to.equal('1');

                socket.publish(path, 'Initial state');
            };

            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/{id}', { onSubscribe });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const each = (update) => {

                expect(update).to.equal('Initial state');
                team.attend();
            };

            client.subscribe('/1', each);

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('passes a callback', async () => {

            const server = Hapi.server();

            const onSubscribe = (socket, path, params) => {

                expect(socket).to.exist();
                expect(path).to.equal('/1');
                expect(params.id).to.equal('1');

                socket.publish(path, 'Initial state').then(() => socket.publish(path, 'Updated state'));

                // Does not wait for publish callback
            };

            await server.register({ plugin: Nes, options: { auth: false } });
            server.subscription('/{id}', { onSubscribe });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();

            let count = 0;
            const each = (update) => {

                ++count;
                if (count === 1) {
                    expect(update).to.equal('Initial state');
                }
                else {
                    expect(update).to.equal('Updated state');
                    team.attend();
                }
            };

            client.subscribe('/1', each);

            await team.work;
            client.disconnect();
            await server.stop();
        });
    });

    describe('_send()', () => {

        it('errors on invalid message', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            const log = server.events.once('log');

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;
            await client.connect();

            const a = { id: 1, type: 'other' };
            a.c = a;                    // Circular reference

            server.plugins.nes._listener._sockets._forEach((socket) => {

                socket._send(a, null, Hoek.ignore);
            });

            const [event] = await log;
            expect(event.data).to.equal('other');
            client.disconnect();
            await server.stop();
        });

        it('reuses previously stringified value', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: (request, h) => {

                    return h.response(JSON.stringify({ a: 1, b: 2 })).type('application/json');
                }
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const { payload, statusCode } = await client.request('/');
            expect(payload).to.equal({ a: 1, b: 2 });
            expect(statusCode).to.equal(200);

            client.disconnect();
            await server.stop();
        });

        it('ignores previously stringified value when no content-type header', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => JSON.stringify({ a: 1, b: 2 })
            });

            server.ext('onPreResponse', (request, h) => {

                request.response._contentType = null;
                return h.continue;
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const { payload, statusCode } = await client.request('/');
            expect(payload).to.equal('{"a":1,"b":2}');
            expect(statusCode).to.equal(200);

            client.disconnect();
            await server.stop();
        });
    });

    describe('_flush()', () => {

        it('breaks large message into smaller packets', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, payload: { maxChunkChars: 5 } } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            const text = 'this is a message longer than 5 bytes';

            const team = new Teamwork();
            client.onUpdate = (message) => {

                expect(message).to.equal(text);
                team.attend();
            };

            await client.connect();
            server.broadcast(text);

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('leaves message small enough to fit into single packets', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, payload: { maxChunkChars: 100 } } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            const text = 'this is a message shorter than 100 bytes';

            const team = new Teamwork();
            client.onUpdate = (message) => {

                expect(message).to.equal(text);
                team.attend();
            };

            await client.connect();
            server.broadcast(text);

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('errors on socket send error', async () => {

            const server = Hapi.server();

            const onConnection = (socket) => {

                socket._ws.send = (message, next) => next(new Error());
            };

            await server.register({ plugin: Nes, options: { auth: false, payload: { maxChunkChars: 5 }, onConnection } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;

            await expect(client.connect({ timeout: 100 })).to.reject('Request failed - server disconnected');

            client.disconnect();
            await server.stop();
        });
    });

    describe('_active()', () => {

        it('shows active mode while publishing', async () => {

            const server = Hapi.server();

            let connection;
            const onConnection = (socket) => {

                connection = socket;
            };

            await server.register({ plugin: Nes, options: { onConnection, auth: false, payload: { maxChunkChars: 5 } } });

            server.subscription('/{id}', {});

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler = (update) => {

                team.attend();
            };

            await client.subscribe('/5', handler);
            server.publish('/5', '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890');
            connection._pinged = false;
            expect(connection._active()).to.be.true();

            await team.work;
            client.disconnect();
            await server.stop();
        });
    });

    describe('_onMessage()', () => {

        it('supports route id', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                config: {
                    id: 'resource',
                    handler: () => 'hello'
                }
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const { payload, statusCode } = await client.request('resource');
            expect(payload).to.equal('hello');
            expect(statusCode).to.equal(200);

            client.disconnect();
            await server.stop();
        });

        it('errors on unknown route id', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                config: {
                    id: 'resource',
                    handler: () => 'hello'
                }
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const err = await expect(client.request('something')).to.reject();
            expect(err.statusCode).to.equal(404);

            client.disconnect();
            await server.stop();
        });

        it('errors on wildcard method route id', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: '*',
                path: '/',
                config: {
                    id: 'resource',
                    handler: () => 'hello'
                }
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const err = await expect(client.request('resource')).to.reject();
            expect(err.statusCode).to.equal(400);

            client.disconnect();
            await server.stop();
        });

        it('errors on invalid request message', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Ws('http://localhost:' + server.info.port);
            client.onerror = Hoek.ignore;

            const team = new Teamwork();
            client.on('message', (data) => {

                const message = JSON.parse(data);
                expect(message.payload).to.equal({
                    error: 'Bad Request',
                    message: 'Cannot parse message'
                });

                expect(message.statusCode).to.equal(400);

                team.attend();
            });

            client.on('open', () => {

                client.send('{', (err) => {

                    expect(err).to.not.exist();
                });
            });

            await team.work;
            client.close();
            await server.stop();
        });

        it('errors on auth endpoint request', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: { password: 'password' } } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();
            const err = await expect(client.request('/nes/auth')).to.reject();
            expect(err.statusCode).to.equal(404);

            client.disconnect();
            await server.stop();
        });

        it('errors on missing id', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Ws('http://localhost:' + server.info.port);
            client.onerror = Hoek.ignore;

            const team = new Teamwork();
            client.on('message', (data) => {

                const message = JSON.parse(data);
                expect(message.payload).to.equal({
                    error: 'Bad Request',
                    message: 'Message missing id'
                });

                expect(message.statusCode).to.equal(400);
                expect(message.type).to.equal('request');

                team.attend();
            });

            client.on('open', () => client.send(JSON.stringify({ type: 'request', method: 'GET', path: '/' }), Hoek.ignore));

            await team.work;
            client.close();
            await server.stop();
        });

        it('errors on uninitialized connection', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Ws('http://localhost:' + server.info.port);
            client.onerror = Hoek.ignore;

            const team = new Teamwork();
            client.on('message', (data) => {

                const message = JSON.parse(data);
                expect(message.payload.message).to.equal('Connection is not initialized');

                team.attend();
            });

            client.on('open', () => client.send(JSON.stringify({ id: 1, type: 'request', path: '/' }), Hoek.ignore));

            await team.work;
            client.close();
            await server.stop();
        });

        it('errors on missing method', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Ws('http://localhost:' + server.info.port);
            client.onerror = Hoek.ignore;

            const team = new Teamwork();
            client.on('message', (data) => {

                const message = JSON.parse(data);
                if (message.id !== 2) {
                    client.send(JSON.stringify({ id: 2, type: 'request', path: '/' }), Hoek.ignore);
                    return;
                }

                expect(message.payload).to.equal({
                    error: 'Bad Request',
                    message: 'Message missing method'
                });

                expect(message.statusCode).to.equal(400);
                expect(message.type).to.equal('request');

                team.attend();
            });

            client.on('open', () => client.send(JSON.stringify({ id: 1, type: 'hello', version: '2' }), Hoek.ignore));

            await team.work;
            client.close();
            await server.stop();
        });

        it('errors on missing path', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Ws('http://localhost:' + server.info.port);
            client.onerror = Hoek.ignore;

            const team = new Teamwork();
            client.on('message', (data) => {

                const message = JSON.parse(data);
                if (message.id !== 2) {
                    client.send(JSON.stringify({ id: 2, type: 'request', method: 'GET' }), Hoek.ignore);
                    return;
                }

                expect(message.payload).to.equal({
                    error: 'Bad Request',
                    message: 'Message missing path'
                });

                expect(message.statusCode).to.equal(400);
                expect(message.type).to.equal('request');

                team.attend();
            });

            client.on('open', () => client.send(JSON.stringify({ id: 1, type: 'hello', version: '2' }), Hoek.ignore));

            await team.work;
            client.close();
            await server.stop();
        });

        it('errors on unknown type', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: () => 'hello'
            });

            await server.start();
            const client = new Ws('http://localhost:' + server.info.port);
            client.onerror = Hoek.ignore;

            const team = new Teamwork();
            client.on('message', (data) => {

                const message = JSON.parse(data);
                if (message.id !== 2) {
                    client.send(JSON.stringify({ id: 2, type: 'unknown' }), Hoek.ignore);
                    return;
                }

                expect(message.payload).to.equal({
                    error: 'Bad Request',
                    message: 'Unknown message type'
                });

                expect(message.statusCode).to.equal(400);
                expect(message.type).to.equal('unknown');

                team.attend();
            });

            client.on('open', () => client.send(JSON.stringify({ id: 1, type: 'hello', version: '2' }), Hoek.ignore));

            await team.work;
            client.close();
            await server.stop();
        });

        it('errors on incorrect version', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Ws('http://localhost:' + server.info.port);
            client.onerror = Hoek.ignore;

            const team = new Teamwork();
            client.on('message', (data) => {

                const message = JSON.parse(data);
                expect(message.payload).to.equal({
                    error: 'Bad Request',
                    message: 'Incorrect protocol version (expected 2 but received 1)'
                });

                expect(message.statusCode).to.equal(400);

                team.attend();
            });

            client.on('open', () => client.send(JSON.stringify({ id: 1, type: 'hello', version: '1' }), Hoek.ignore));

            await team.work;
            client.close();
            await server.stop();
        });

        it('errors on missing version', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Ws('http://localhost:' + server.info.port);
            client.onerror = Hoek.ignore;

            const team = new Teamwork();
            client.on('message', (data) => {

                const message = JSON.parse(data);
                expect(message.payload).to.equal({
                    error: 'Bad Request',
                    message: 'Incorrect protocol version (expected 2 but received none)'
                });

                expect(message.statusCode).to.equal(400);

                team.attend();
            });

            client.on('open', () => client.send(JSON.stringify({ id: 1, type: 'hello' }), Hoek.ignore));

            await team.work;
            client.close();
            await server.stop();
        });

        it('errors on missing type', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Ws('http://localhost:' + server.info.port);
            client.onerror = Hoek.ignore;

            const team = new Teamwork();
            client.on('message', (data) => {

                const message = JSON.parse(data);
                expect(message.payload).to.equal({
                    error: 'Bad Request',
                    message: 'Cannot parse message'
                });

                expect(message.statusCode).to.equal(400);
                team.attend();
            });

            client.on('open', () => client.send(JSON.stringify({ id: 1 }), Hoek.ignore));

            await team.work;
            client.close();
            await server.stop();
        });

        it('unsubscribes to two paths on same subscription', async () => {

            const server = Hapi.server();

            const onMessage = (socket, message) => 'b';
            await server.register({ plugin: Nes, options: { auth: false, onMessage } });

            server.subscription('/{id}', {});

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            await client.subscribe('/5', Hoek.ignore);

            const team = new Teamwork();
            const handler = async (update) => {

                client.unsubscribe('/5', null, Hoek.ignore);
                client.unsubscribe('/6', null, Hoek.ignore);

                await client.message('a');
                const listener = server.plugins.nes._listener;
                const match = listener._router.route('sub', '/5');
                expect(match.route.subscribers._items).to.equal({});

                team.attend();
            };

            await client.subscribe('/6', handler);
            server.publish('/6', 'b');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('ignores double unsubscribe to same subscription', async () => {

            const server = Hapi.server();

            const onMessage = (socket, message) => 'b';
            await server.register({ plugin: Nes, options: { auth: false, onMessage } });

            server.subscription('/{id}', {});

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;
            await client.connect();

            const team = new Teamwork();
            const handler = async (update) => {

                await client.unsubscribe('/6', null);
                client._send({ type: 'unsub', path: '/6' });

                await client.message('a');
                const listener = server.plugins.nes._listener;
                const match = listener._router.route('sub', '/6');
                expect(match.route.subscribers._items).to.equal({});

                team.attend();
            };

            await client.subscribe('/6', handler);
            server.publish('/6', 'b');

            await team.work;
            client.disconnect();
            await server.stop();
        });
    });

    describe('_processRequest()', () => {

        it('exposes socket to request', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.route({
                method: 'GET',
                path: '/',
                handler: (request) => request.socket.id
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const { payload } = await client.request('/');
            expect(payload).to.equal(client.id);

            client.disconnect();
            await server.stop();
        });

        it('passed headers', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, headers: '*' } });

            server.route({
                method: 'GET',
                path: '/',
                handler: (request) => ('hello ' + request.headers.a)
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const { payload, statusCode, headers } = await client.request({ path: '/', headers: { a: 'b' } });
            expect(payload).to.equal('hello b');
            expect(statusCode).to.equal(200);
            expect(headers).to.contain({ 'content-type': 'text/html; charset=utf-8' });

            client.disconnect();
            await server.stop();
        });

        it('errors on authorization header', async () => {

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

            await expect(client.request({ path: '/', headers: { Authorization: 'something' } })).to.reject('Cannot include an Authorization header');

            client.disconnect();
            await server.stop();
        });
    });

    describe('_processMessage()', () => {

        it('calls onMessage callback', async () => {

            const server = Hapi.server();

            const onMessage = (socket, message) => {

                expect(message).to.equal('winning');
                return 'hello';
            };

            await server.register({ plugin: Nes, options: { onMessage } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const { payload } = await client.message('winning');
            expect(payload).to.equal('hello');
            client.disconnect();
            await server.stop();
        });

        it('sends errors from callback (raw)', async () => {

            const onMessage = (socket, message) => {

                expect(message).to.equal('winning');
                throw new Error('failed');
            };

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { onMessage } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const err = await expect(client.message('winning')).to.reject('An internal server error occurred');
            expect(err.statusCode).to.equal(500);
            client.disconnect();
            await server.stop();
        });

        it('sends errors from callback (boom)', async () => {

            const onMessage = (socket, message) => {

                expect(message).to.equal('winning');
                throw Boom.badRequest('failed');
            };

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { onMessage } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const err = await expect(client.message('winning')).to.reject('failed');
            expect(err.statusCode).to.equal(400);
            client.disconnect();
            await server.stop();
        });

        it('sends errors from callback (code)', async () => {

            const onMessage = (socket, message) => {

                expect(message).to.equal('winning');
                const error = Boom.badRequest();
                error.output.payload = {};
                throw error;
            };

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { onMessage } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const err = await expect(client.message('winning')).to.reject('Error');
            expect(err.statusCode).to.equal(400);
            client.disconnect();
            await server.stop();
        });

        it('errors if missing onMessage callback', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: {} });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const err = await expect(client.message('winning')).to.reject('Not Implemented');
            expect(err.statusCode).to.equal(501);

            client.disconnect();
            await server.stop();
        });
    });
});
