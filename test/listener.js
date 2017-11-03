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


describe('Listener', () => {

    it('refuses connection while stopping', async () => {

        const server = Hapi.server();

        const onConnection = (socket) => {

            const orig = socket.disconnect;
            socket.disconnect = async () => {

                await Hoek.wait(50);
                return orig.call(socket);
            };
        };

        await server.register({ plugin: Nes, options: { auth: false, onConnection } });

        const onUnsubscribe = (socket, path, params) => {

            server.publish('/', 'ignore');
            server.eachSocket(Hoek.ignore);
            server.broadcast('ignore');
        };

        server.subscription('/', { onUnsubscribe });
        await server.start();

        const team = new Teamwork({ meetings: 20 });

        const clients = [];
        for (let i = 0; i < 20; ++i) {
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onDisconnect = () => team.attend();
            client.onError = Hoek.ignore;
            await client.connect();
            await client.subscribe('/', Hoek.ignore);
            clients.push(client);
        }

        const client2 = new Nes.Client('http://localhost:' + server.info.port);
        client2.onError = Hoek.ignore;

        server.stop();
        await expect(client2.connect()).to.reject();
        await team.work;
    });

    it('limits number of connections', async () => {

        const server = Hapi.server();
        await server.register({ plugin: Nes, options: { auth: false, maxConnections: 1 } });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port);
        await client.connect();

        const client2 = new Nes.Client('http://localhost:' + server.info.port);
        client2.onError = Hoek.ignore;

        await expect(client2.connect()).to.reject();

        client.disconnect();
        client2.disconnect();
        await server.stop();
    });

    it('rejects unknown origin', async () => {

        const server = Hapi.server();
        await server.register({ plugin: Nes, options: { auth: false, origin: ['http://localhost:12345'] } });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port);
        await expect(client.connect()).to.reject();
        client.disconnect();
        await server.stop();
    });

    it('accepts known origin', async () => {

        const server = Hapi.server();
        await server.register({ plugin: Nes, options: { auth: false, origin: ['http://localhost:12345'] } });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { origin: 'http://localhost:12345' } });
        await client.connect();
        client.disconnect();
        await server.stop();
    });

    describe('_beat()', () => {

        it('disconnects client after timeout', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, heartbeat: { interval: 20, timeout: 10 } } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;

            const team = new Teamwork();
            client.onDisconnect = () => team.attend();

            await client.connect();
            expect(client._heartbeatTimeout).to.equal(30);

            client._onMessage = Hoek.ignore;            // Stop processing messages

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('disables heartbeat', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, heartbeat: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();
            expect(client._heartbeatTimeout).to.be.false();

            client.disconnect();
            await server.stop();
        });

        it('pauses heartbeat timeout while replying to client', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, heartbeat: { interval: 50, timeout: 45 } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: async () => {

                    await Hoek.wait(110);
                    return 'hello';
                }
            });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            let e = 0;
            client.onError = (err) => {

                ++e;

                if (e === 1) {
                    expect(err.message).to.equal('Disconnecting due to heartbeat timeout');
                }
            };

            let d = 0;
            client.onDisconnect = (willReconnect, log) => ++d;

            await client.connect();
            expect(client._heartbeatTimeout).to.equal(95);

            await client.request('/');
            await Hoek.wait(130);

            expect(d).to.equal(0);

            client._onMessage = Hoek.ignore;            // Stop processing messages
            await Hoek.wait(120);

            expect(d).to.equal(1);

            client.disconnect();
            await server.stop();
        });
    });

    describe('broadcast()', () => {

        it('sends message to all clients', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);

            const team = new Teamwork();
            client.onUpdate = (message) => {

                expect(message).to.equal('hello');
                team.attend();
            };

            await client.connect();
            server.broadcast('hello');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('sends to all user sockets', async () => {

            const server = Hapi.server();

            const implementation = (srv, options) => {

                return {
                    authenticate: (request, h) => {

                        return h.authenticated({ credentials: { user: request.headers.authorization } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            const password = 'some_not_random_password_that_is_also_long_enough';
            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password, index: true } } });

            await server.start();
            const client1 = new Nes.Client('http://localhost:' + server.info.port);
            await client1.connect({ auth: { headers: { authorization: 'steve' } } });

            const updates = [];
            const handler = (update) => updates.push(update);

            client1.onUpdate = handler;

            const client2 = new Nes.Client('http://localhost:' + server.info.port);
            await client2.connect({ auth: { headers: { authorization: 'steve' } } });
            client2.onUpdate = handler;

            server.broadcast('x', { user: 'steve' });
            server.broadcast('y', { user: 'john' });

            await Hoek.wait(50);

            expect(updates).to.equal(['x', 'x']);
            client1.disconnect();
            client2.disconnect();
            await server.stop();
        });

        it('errors on missing auth index (disabled)', async () => {

            const server = Hapi.server();

            const implementation = (srv, options) => {

                return {
                    authenticate: (request, h) => {

                        return h.authenticated({ credentials: { user: request.headers.authorization } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            const password = 'some_not_random_password_that_is_also_long_enough';
            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password, index: false } } });

            await server.start();
            expect(() => {

                server.broadcast('x', { user: 'steve' });
            }).to.throw('Socket auth indexing is disabled');

            await server.stop();
        });

        it('errors on missing auth index (no auth)', async () => {

            const server = Hapi.server();

            const implementation = (srv, options) => {

                return {
                    authenticate: (request, h) => {

                        return h.authenticated({ credentials: { user: request.headers.authorization } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default('default');

            await server.register({ plugin: Nes, options: { auth: false } });

            await server.start();
            expect(() => {

                server.broadcast('x', { user: 'steve' });
            }).to.throw('Socket auth indexing is disabled');

            await server.stop();
        });

        it('logs invalid message', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            const log = server.events.once('log');

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const a = { b: 1 };
            a.c = a;                    // Circular reference

            server.broadcast(a);

            const [event] = await log;
            expect(event.data).to.equal('update');
            client.disconnect();
            await server.stop();
        });
    });

    describe('subscription()', () => {

        it('provides subscription notifications', async () => {

            const server = Hapi.server();

            const onSubscribe = (socket, path, params) => {

                expect(socket).to.exist();
                expect(path).to.equal('/');
                client.disconnect();
            };

            const team = new Teamwork();
            const onUnsubscribe = (socket, path, params) => {

                expect(socket).to.exist();
                expect(path).to.equal('/');
                expect(params).to.equal({});

                team.attend();
            };

            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/', { onSubscribe, onUnsubscribe });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();
            await client.subscribe('/', Hoek.ignore);

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('removes subscription notification by path', async () => {

            const server = Hapi.server();

            const onSubscribe = (socket, path, params) => {

                expect(socket).to.exist();
                expect(path).to.equal('/foo');
                client.unsubscribe('/foo', null, Hoek.ignore);
            };

            const team = new Teamwork();
            const onUnsubscribe = (socket, path, params) => {

                expect(socket).to.exist();
                expect(path).to.equal('/foo');
                expect(params).to.equal({ params: 'foo' });
                team.attend();
            };

            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/{params*}', { onSubscribe, onUnsubscribe });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            await client.subscribe('/foo', Hoek.ignore);

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('errors on subscription onSubscribe callback error', async () => {

            const server = Hapi.server();

            const onSubscribe = (socket, path, params) => {

                throw Boom.badRequest('nah');
            };

            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/', { onSubscribe });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            await expect(client.subscribe('/', Hoek.ignore)).to.reject('nah');
            client.disconnect();
            await server.stop();
        });

        it('errors on subscription onUnsubscribe callback error', async () => {

            const server = Hapi.server();
            const log = server.events.once('log');

            const onUnsubscribe = (socket, path, params) => {

                socket.a.b.c.d();
            };

            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/', { onUnsubscribe });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            client.subscribe('/', Hoek.ignore);
            await client.disconnect();

            const [event] = await log;
            expect(event.tags).to.equal(['nes', 'onUnsubscribe', 'error']);

            await server.stop();
        });
    });

    describe('publish()', () => {

        it('publishes to a parameterized path', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/a/{id}');

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal('2');
                team.attend();
            };

            await client.subscribe('/a/b', handler);
            server.publish('/a/a', '1');
            server.publish('/a/b', '2');

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('publishes with filter', async () => {

            const server = Hapi.server();

            await server.register({ plugin: Nes, options: { auth: false } });

            const filter = (path, update, options) => {

                return (update.a === 1);
            };

            server.subscription('/updates', { filter });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal({ a: 1 });
                team.attend();
            };

            await client.subscribe('/updates', handler);
            server.publish('/updates', { a: 2 });
            server.publish('/updates', { a: 1 });

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('publishes with a filter override', async () => {

            const server = Hapi.server();

            await server.register({ plugin: Nes, options: { auth: false } });

            const filter = (path, update, options) => {

                return (update.a === 1 ? { override: { a: 5 } } : false);
            };

            server.subscription('/updates', { filter });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal({ a: 5 });
                team.attend();
            };

            await client.subscribe('/updates', handler);
            server.publish('/updates', { a: 2 });
            server.publish('/updates', { a: 1 });

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('publishes with filter (socket)', async () => {

            const server = Hapi.server();

            await server.register({ plugin: Nes, options: { auth: false } });

            const filter = (path, update, options) => {

                if (update.a === 1) {
                    options.socket.publish(path, { a: 5 });
                }

                return false;
            };

            server.subscription('/updates', { filter });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal({ a: 5 });
                team.attend();
            };

            await client.subscribe('/updates', handler);
            server.publish('/updates', { a: 2 });
            server.publish('/updates', { a: 1 });

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('throws on filter system errors', async () => {

            const server = Hapi.server();

            await server.register({ plugin: Nes, options: { auth: false } });

            const filter = (path, update, options) => {

                return (update.a.x.y === 1);
            };

            server.subscription('/updates', { filter });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            await client.subscribe('/updates', Hoek.ignore);
            await expect(server.publish('/updates', { a: 2 })).to.reject();

            client.disconnect();
            await server.stop();
        });

        it('passes internal options to filter', async () => {

            const server = Hapi.server();

            await server.register({ plugin: Nes, options: { auth: false } });

            const filter = (path, update, options) => {

                return (options.internal.b === 1);
            };

            server.subscription('/updates', { filter });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            const team = new Teamwork();
            const handler = (update) => {

                expect(update).to.equal({ a: 1 });
                team.attend();
            };

            await client.subscribe('/updates', handler);
            server.publish('/updates', { a: 2 }, { internal: { b: 2 } });
            server.publish('/updates', { a: 1 }, { internal: { b: 1 } });

            await team.work;
            client.disconnect();
            await server.stop();
        });

        it('publishes to selected user', async () => {

            const server = Hapi.server();

            const implementation = (srv, options) => {

                return {
                    authenticate: (request, h) => {

                        return h.authenticated({ credentials: { user: 'steve' } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default({ strategy: 'default', mode: 'optional' });

            const password = 'some_not_random_password_that_is_also_long_enough';
            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            const onUnsubscribe = Hoek.ignore;
            server.subscription('/', { onUnsubscribe, auth: { mode: 'optional', entity: 'user', index: true } });

            await server.start();
            const client1 = new Nes.Client('http://localhost:' + server.info.port);
            await client1.connect({ auth: { headers: { authorization: 'Custom steve' } } });

            const updates = [];
            const handler = (update) => updates.push(update);

            await client1.subscribe('/', handler);
            const client2 = new Nes.Client('http://localhost:' + server.info.port);
            await client2.connect({ auth: { headers: { authorization: 'Custom steve' } } });
            await client2.subscribe('/', handler);
            const client3 = new Nes.Client('http://localhost:' + server.info.port);
            await client3.connect({ auth: false });
            await client3.subscribe('/', handler);

            server.publish('/', 'heya', { user: 'steve' });
            server.publish('/', 'wowa', { user: 'john' });

            await Hoek.wait(50);

            await client1.unsubscribe('/', null);
            await client2.unsubscribe('/', null);
            await client3.unsubscribe('/', null);
            client1.disconnect();
            client2.disconnect();
            client3.disconnect();

            expect(updates).to.equal(['heya', 'heya']);
            await server.stop();
        });

        it('ignores unknown path', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });
            server.publish('/', 'ignored');
        });

        it('throws on missing path', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });
            expect(() => {

                server.publish('', 'ignored');
            }).to.throw('Missing or invalid subscription path: empty');
        });

        it('throws on invalid path', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });
            expect(() => {

                server.publish('a', 'ignored');
            }).to.throw('Missing or invalid subscription path: a');
        });

        it('throws on disabled user mapping', async () => {

            const server = Hapi.server();

            const implementation = (srv, options) => {

                return {
                    authenticate: (request, h) => {

                        return h.authenticated({ credentials: { user: 'steve' } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default({ strategy: 'default', mode: 'optional' });

            const password = 'some_not_random_password_that_is_also_long_enough';
            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { mode: 'optional', entity: 'user', index: false } });

            await server.start();
            await expect(server.publish('/', 'heya', { user: 'steve' })).to.reject('Subscription auth indexing is disabled');
            await server.stop();
        });

        it('throws on disabled auth', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });
            server.subscription('/');

            await server.start();
            await expect(server.publish('/', 'heya', { user: 'steve' })).to.reject('Subscription auth indexing is disabled');
            await server.stop();
        });
    });

    describe('eachSocket()', () => {

        it('publishes to selected user', async () => {

            const server = Hapi.server();

            const implementation = (srv, options) => {

                return {
                    authenticate: (request, h) => {

                        return h.authenticated({ credentials: { user: 'steve' } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default({ strategy: 'default', mode: 'optional' });

            const password = 'some_not_random_password_that_is_also_long_enough';
            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            server.subscription('/', { auth: { mode: 'optional', entity: 'user', index: true } });

            await server.start();
            const client1 = new Nes.Client('http://localhost:' + server.info.port);
            await client1.connect({ auth: { headers: { authorization: 'Custom steve' } } });

            const updates = [];
            const handler = (update) => updates.push(update);

            await client1.subscribe('/', handler);

            const client2 = new Nes.Client('http://localhost:' + server.info.port);
            await client2.connect({ auth: { headers: { authorization: 'Custom steve' } } });
            await client2.subscribe('/', handler);

            const client3 = new Nes.Client('http://localhost:' + server.info.port);
            await client3.connect({ auth: false });
            await client3.subscribe('/', handler);

            server.eachSocket((socket) => socket.publish('/', 'heya'), { user: 'steve', subscription: '/' });
            server.eachSocket((socket) => socket.publish('/', 'wowa'), { user: 'john', subscription: '/' });

            await Hoek.wait(50);

            await client1.unsubscribe('/', null);
            await client2.unsubscribe('/', null);
            await client3.unsubscribe('/', null);
            client1.disconnect();
            client2.disconnect();
            client3.disconnect();

            expect(updates).to.equal(['heya', 'heya']);
            await server.stop();
        });

        it('throws on missing subscription with user option', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });
            expect(() => {

                server.eachSocket(Hoek.ignore, { user: 'steve' });
            }).to.throw('Cannot specify user filter without a subscription path');
        });
    });

    describe('_subscribe()', () => {

        it('subscribes to two paths on same subscription', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/{id}', {});

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            let called = false;
            const handler1 = (update1) => {

                called = true;
            };

            await client.subscribe('/5', handler1);

            const team = new Teamwork();
            const handler2 = async (update2) => {

                expect(called).to.be.true();
                client.disconnect();

                await Hoek.wait(10);
                await server.stop();

                const listener = server.plugins.nes._listener;
                expect(listener._sockets._items).to.equal({});
                const match = listener._router.route('sub', '/5');
                expect(match.route.subscribers._items).to.equal({});
                team.attend();
            };

            await client.subscribe('/6', handler2);
            server.publish('/5', 'a');
            server.publish('/6', 'b');

            await team.work;
        });

        it('errors on double subscribe to same paths', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/{id}', {});

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();

            await client.subscribe('/5', Hoek.ignore);
            const request = {
                type: 'sub',
                path: '/5'
            };

            await client._send(request, true);
            client.disconnect();
            await server.stop();
        });

        it('errors on path with query', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            server.subscription('/');

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            await client.connect();
            await expect(client.subscribe('/?5', Hoek.ignore)).to.reject('Subscription path cannot contain query');
            client.disconnect();
            await server.stop();
        });
    });

    describe('Sockets', () => {

        describe('eachSocket()', () => {

            const countSockets = (server, options) => {

                let seen = 0;
                server.eachSocket((socket) => {

                    expect(socket).to.exist();
                    seen++;
                }, options);
                return seen;
            };

            it('returns connected sockets', async () => {

                const server = Hapi.server();

                await server.register({ plugin: Nes, options: { auth: false } });

                await server.start();
                const client = new Nes.Client('http://localhost:' + server.info.port);
                await client.connect();
                expect(countSockets(server)).to.equal(1);

                client.disconnect();
                await server.stop();
            });

            it('returns sockets on a subscription', async () => {

                const server = Hapi.server();

                await server.register({ plugin: Nes, options: { auth: false } });

                server.subscription('/a/{id}');
                server.subscription('/b');

                await server.start();
                const client = new Nes.Client('http://localhost:' + server.info.port);
                await client.connect();

                client.subscribe('/b', Hoek.ignore);

                const client2 = new Nes.Client('http://localhost:' + server.info.port);
                await client2.connect();

                await client2.subscribe('/a/b', Hoek.ignore);

                expect(countSockets(server)).to.equal(2);
                expect(countSockets(server, { subscription: '/a/a' })).to.equal(0);
                expect(countSockets(server, { subscription: '/a/b' })).to.equal(1);

                expect(countSockets(server, { subscription: '/b' })).to.equal(1);

                expect(countSockets(server, { subscription: '/foo' })).to.equal(0);

                client.disconnect();
                client2.disconnect();
                await server.stop();
            });
        });
    });

    describe('_generateId()', () => {

        it('rolls over when reached max sockets per millisecond', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false } });

            const listener = server.plugins.nes._listener;
            listener._socketCounter = 99999;
            let id = listener._generateId();
            expect(id.split(':')[4]).to.equal('99999');
            id = listener._generateId();
            expect(id.split(':')[4]).to.equal('10000');
        });
    });
});
