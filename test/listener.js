'use strict';

const Boom = require('@hapi/boom');
const Code = require('@hapi/code');
const Hapi = require('@hapi/hapi');
const Hoek = require('@hapi/hoek');
const Lab = require('@hapi/lab');
const Nes = require('../');
const Socket = require('../lib/socket');
const Teamwork = require('@hapi/teamwork');


const internals = {};


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

        const team = new Teamwork.Team({ meetings: 20 });

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

    it('handles socket errors', async () => {

        const server = Hapi.server();

        const onConnection = (socket) => {

            socket._ws.emit('error', new Error());
        };

        await server.register({ plugin: Nes, options: { auth: false, onConnection } });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { origin: 'http://localhost:12345' } });
        client.onError = Hoek.ignore;
        await client.connect();
        await server.stop();
    });

    describe('_beat()', () => {

        it('disconnects client after timeout', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, heartbeat: { interval: 20, timeout: 10 } } });

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;

            const team = new Teamwork.Team();
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
            await server.register({ plugin: Nes, options: { auth: false, heartbeat: { interval: 200, timeout: 180 } } });

            server.route({
                method: 'GET',
                path: '/',
                handler: async () => {

                    await Hoek.wait(440);
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
            expect(client._heartbeatTimeout).to.equal(380);

            await client.request('/');
            await Hoek.wait(520);

            expect(d).to.equal(0);

            client._onMessage = Hoek.ignore;            // Stop processing messages
            await Hoek.wait(480);

            expect(d).to.equal(1);

            client.disconnect();
            await server.stop();
        });

        it('does not disconnect newly connecting sockets', async () => {

            const server = Hapi.server();
            let disconnected = 0;
            const onDisconnection = () => disconnected++;
            await server.register({ plugin: Nes, options: { onDisconnection, auth: false, heartbeat: { timeout: 50, interval: 55 } } });
            await server.start();

            const client = new Nes.Client('http://localhost:' + server.info.port);
            const canary = new Nes.Client('http://localhost:' + server.info.port);
            await canary.connect();

            const helloTeam = new Teamwork.Team();
            const socketOnMessage = Socket.prototype._onMessage;
            Socket.prototype._onMessage = async function (message) {

                if (JSON.parse(message).type === 'hello') {
                    await helloTeam.work;
                }

                return socketOnMessage.call(this, message);
            };

            const pingTeam = new Teamwork.Team();
            const _onMessage = canary._onMessage.bind(canary);
            canary._onMessage = function (message) {

                if (message.data === '{"type":"ping"}') {
                    pingTeam.attend();
                }

                return _onMessage(message);
            };

            // wait for the next ping
            await pingTeam.work;

            await Hoek.wait(30);
            const connectPromise = client.connect().catch(Code.fail);

            // client should not time out for another 50 milliseconds

            await Hoek.wait(40);

            // release "hello" message before the timeout hits
            helloTeam.attend();
            await connectPromise;

            await Hoek.wait(60); // ping should have been answered and connection still active

            expect(disconnected).to.equal(0);

            Socket.prototype._onMessage = socketOnMessage;
            canary.disconnect();
            client.disconnect();
            await server.stop();
        });

        it('disconnects sockets that have not fully connected in a long time', async () => {

            const server = Hapi.server();
            await server.register({ plugin: Nes, options: { auth: false, heartbeat: { interval: 20, timeout: 10 } } });

            const socketOnMessage = Socket.prototype._onMessage;
            Socket.prototype._onMessage = Hoek.ignore;     // Do not process messages

            await server.start();
            const client = new Nes.Client('http://localhost:' + server.info.port);
            client.onError = Hoek.ignore;

            const team = new Teamwork.Team();
            client.onDisconnect = () => team.attend();

            client.connect().catch(Hoek.ignore);

            await team.work;
            Socket.prototype._onMessage = socketOnMessage;
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

            const team = new Teamwork.Team();
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

            const team = new Teamwork.Team();
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

            const team = new Teamwork.Team();
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

            await client.subscribe('/', Hoek.ignore);
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

            const team = new Teamwork.Team();
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

            const team = new Teamwork.Team();
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

            const team = new Teamwork.Team();
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

        it('does not affect other sockets when given a filter override', async () => {

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

            await server.register({ plugin: Nes, options: { auth: { type: 'direct' } } });
            await server.start();

            const filter = (path, update, options) => {

                if (options.credentials.user === 'jane') {
                    return { override: { message: 'hello, jane' } };
                }

                return true;
            };

            server.subscription('/updates', { filter });

            const team = new Teamwork.Team({ meetings: 2 });

            const client1 = new Nes.Client('http://localhost:' + server.info.port);
            await client1.connect({ auth: { headers: { authorization: 'jane' } } });

            const handler1 = (update) => {

                expect(update).to.equal({ message: 'hello, jane' });
                team.attend();
            };

            await client1.subscribe('/updates', handler1);

            const client2 = new Nes.Client('http://localhost:' + server.info.port);
            await client2.connect({ auth: { headers: { authorization: 'john' } } });

            const handler2 = (update) => {

                expect(update).to.equal({ message: 'hello, world' });   // original message
                team.attend();
            };

            await client2.subscribe('/updates', handler2);

            server.publish('/updates', { message: 'hello, world' });

            await team.work;
            client1.disconnect();
            client2.disconnect();
            await server.stop();
        });

        it('ignores removed sockets', async () => {

            const server = Hapi.server();

            let filtered = 0;

            await server.register({ plugin: Nes, options: { auth: false } });

            const filter = async (path, update, options) => {

                await client2.unsubscribe('/updates');
                filtered++;
            };

            server.subscription('/updates', { filter });

            await server.start();

            const client1 = new Nes.Client('http://localhost:' + server.info.port);
            client1.onError = Hoek.ignore;
            await client1.connect();
            await client1.subscribe('/updates', Hoek.ignore);

            const client2 = new Nes.Client('http://localhost:' + server.info.port);
            client2.onError = Hoek.ignore;
            await client2.connect();
            await client2.subscribe('/updates', Hoek.ignore);

            server.publish('/updates', 42);

            await client1.disconnect();
            await server.stop();

            expect(filtered).to.equal(1);
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

            const team = new Teamwork.Team();
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

            const team = new Teamwork.Team();
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

        it('publishes to selected user (ignores non-user credentials)', async () => {

            const server = Hapi.server();

            const implementation = (srv, options) => {

                let count = 0;
                return {
                    authenticate: (request, h) => {

                        return h.authenticated({ credentials: { user: count++ ? 'steve' : null } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom');
            server.auth.default({ strategy: 'default', mode: 'optional' });

            const password = 'some_not_random_password_that_is_also_long_enough';
            await server.register({ plugin: Nes, options: { auth: { type: 'direct', password } } });

            const onUnsubscribe = Hoek.ignore;
            server.subscription('/', { onUnsubscribe, auth: { mode: 'optional', index: true } });

            await server.start();
            const client1 = new Nes.Client('http://localhost:' + server.info.port);
            await client1.connect({ auth: { headers: { authorization: 'Custom steve' } } });

            const updates = [];
            const handler = (update) => updates.push(update);

            await client1.subscribe('/', handler);
            const client2 = new Nes.Client('http://localhost:' + server.info.port);
            await client2.connect({ auth: { headers: { authorization: 'Custom steve' } } });
            await client2.subscribe('/', handler);

            server.publish('/', 'heya', { user: 'steve' });

            await Hoek.wait(50);

            await client1.unsubscribe('/', null);
            await client2.unsubscribe('/', null);
            client1.disconnect();
            client2.disconnect();

            expect(updates).to.equal(['heya']);
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

            const team = new Teamwork.Team();
            const handler2 = async (update2) => {

                expect(called).to.be.true();
                await client.disconnect();

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

            const countSockets = async (server, options) => {

                let seen = 0;
                await server.eachSocket((socket) => {

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
                expect(await countSockets(server)).to.equal(1);

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

                await client.subscribe('/b', Hoek.ignore);

                const client2 = new Nes.Client('http://localhost:' + server.info.port);
                await client2.connect();

                await client2.subscribe('/a/b', Hoek.ignore);

                expect(await countSockets(server)).to.equal(2);
                expect(await countSockets(server, { subscription: '/a/a' })).to.equal(0);
                expect(await countSockets(server, { subscription: '/a/b' })).to.equal(1);

                expect(await countSockets(server, { subscription: '/b' })).to.equal(1);

                expect(await countSockets(server, { subscription: '/foo' })).to.equal(0);

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
