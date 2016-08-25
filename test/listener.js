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


describe('Listener', () => {

    it('refuses connection while stopping', (done) => {

        const server = new Hapi.Server();
        server.connection();
        server.register({ register: Nes, options: { auth: false } }, (err) => {

            expect(err).to.not.exist();

            const onUnsubscribe = (socket, path, params, next) => {

                server.publish('/', 'ignore');
                server.eachSocket(Hoek.ignore);
                server.broadcast('ignore');

                setTimeout(next, 50);
            };

            server.subscription('/', { onUnsubscribe });
            server.start((err) => {

                expect(err).to.not.exist();

                const client = new Nes.Client('http://localhost:' + server.info.port);
                client.onError = Hoek.ignore;
                client.connect((err) => {

                    expect(err).to.not.exist();
                    client.subscribe('/', Hoek.ignore, (err) => {

                        expect(err).to.not.exist();

                        const client2 = new Nes.Client('http://localhost:' + server.info.port);
                        client2.onError = Hoek.ignore;
                        client2.onDisconnect = function () {

                            client.disconnect();
                            client2.disconnect();
                            done();
                        };

                        server.ext('onPreStop', (srv, next) => {

                            setTimeout(next, 50);
                        });

                        server.stop((err) => {

                            expect(err).to.not.exist();
                        });

                        client2.connect((err) => {

                            expect(err).to.exist();
                        });
                    });
                });
            });
        });
    });

    it('limits number of connections', (done) => {

        const server = new Hapi.Server();
        server.connection();
        server.register({ register: Nes, options: { auth: false, maxConnections: 1 } }, (err) => {

            expect(err).to.not.exist();

            server.start((err) => {

                expect(err).to.not.exist();
                const client = new Nes.Client('http://localhost:' + server.info.port);
                client.connect((err) => {

                    expect(err).to.not.exist();

                    const client2 = new Nes.Client('http://localhost:' + server.info.port);
                    client2.onError = Hoek.ignore;

                    client2.connect((err) => {

                        expect(err).to.exist();
                        client.disconnect();
                        client2.disconnect();
                        server.stop(done);
                    });
                });
            });
        });
    });

    it('rejects unknown origin', (done) => {

        const server = new Hapi.Server();
        server.connection();
        server.register({ register: Nes, options: { auth: false, origin: ['http://localhost:12345'] } }, (err) => {

            expect(err).to.not.exist();

            server.start((err) => {

                expect(err).to.not.exist();
                const client = new Nes.Client('http://localhost:' + server.info.port);
                client.connect((err) => {

                    expect(err).to.exist();
                    client.disconnect();
                    server.stop(done);
                });
            });
        });
    });

    it('accepts known origin', (done) => {

        const server = new Hapi.Server();
        server.connection();
        server.register({ register: Nes, options: { auth: false, origin: ['http://localhost:12345'] } }, (err) => {

            expect(err).to.not.exist();

            server.start((err) => {

                expect(err).to.not.exist();
                const client = new Nes.Client('http://localhost:' + server.info.port, { ws: { origin: 'http://localhost:12345' } });
                client.connect((err) => {

                    expect(err).not.to.exist();
                    client.disconnect();
                    server.stop(done);
                });
            });
        });
    });

    describe('_beat()', () => {

        it('disconnects client after timeout', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false, heartbeat: { interval: 20, timeout: 10 } } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.onError = Hoek.ignore;
                    client.onDisconnect = function () {

                        client.disconnect();
                        server.stop(done);
                    };

                    client.connect((err) => {

                        expect(err).to.not.exist();
                        expect(client._heartbeatTimeout).to.equal(30);

                        client._onMessage = function () { };                    // Stop processing messages
                    });
                });
            });
        });

        it('disables heartbeat', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false, heartbeat: false } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();
                        expect(client._heartbeatTimeout).to.be.false();

                        client.disconnect();
                        server.stop(done);
                    });
                });
            });
        });

        it('pauses heartbeat timeout while replying to client', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false, heartbeat: { interval: 50, timeout: 45 } } }, (err) => {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        setTimeout(() => reply('hello'), 110);
                    }
                });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    let e = 0;
                    client.onError = function (err) {

                        ++e;

                        if (e === 1) {
                            expect(err.message).to.equal('Disconnecting due to heartbeat timeout');
                        }
                    };

                    let d = 0;
                    client.onDisconnect = function (willReconnect, log) {

                        ++d;
                    };

                    client.connect((err) => {

                        expect(err).to.not.exist();
                        expect(client._heartbeatTimeout).to.equal(95);

                        client.request('/', (err, payload, statusCode, headers) => {

                            expect(err).to.not.exist();
                            setTimeout(() => {

                                expect(d).to.equal(0);

                                client._onMessage = function () { };                        // Stop processing messages
                                setTimeout(() => {

                                    expect(d).to.equal(1);

                                    client.disconnect();
                                    server.stop(done);
                                }, 120);
                            }, 130);                                                        // Two interval cycles
                        });
                    });
                });
            });
        });
    });

    describe('broadcast()', () => {

        it('sends message to all clients', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.onUpdate = function (message) {

                        expect(message).to.equal('hello');
                        client.disconnect();
                        server.stop(done);
                    };

                    client.connect((err) => {

                        expect(err).to.not.exist();
                        server.broadcast('hello');
                    });
                });
            });
        });

        it('sends message to all clients (non participating connections)', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.onUpdate = function (message) {

                        expect(message).to.equal('hello');
                        client.disconnect();
                        server.stop(done);
                    };

                    client.connect((err) => {

                        expect(err).to.not.exist();
                        server.connection();
                        server.broadcast('hello');
                    });
                });
            });
        });

        it('sends to all user sockets', (done) => {

            const server = new Hapi.Server();
            server.connection();

            const implementation = function (srv, options) {

                return {
                    authenticate: function (request, reply) {

                        return reply.continue({ credentials: { user: request.headers.authorization } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom', true);

            const password = 'some_not_random_password_that_is_also_long_enough';
            server.register({ register: Nes, options: { auth: { type: 'direct', password, index: true } } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client1 = new Nes.Client('http://localhost:' + server.info.port);
                    client1.connect({ auth: { headers: { authorization: 'steve' } } }, (err) => {

                        expect(err).to.not.exist();

                        const updates = [];
                        const handler = (update) => updates.push(update);

                        client1.onUpdate = handler;

                        const client2 = new Nes.Client('http://localhost:' + server.info.port);
                        client2.connect({ auth: { headers: { authorization: 'steve' } } }, (err) => {

                            expect(err).to.not.exist();
                            client2.onUpdate = handler;

                            server.broadcast('x', { user: 'steve' });
                            server.broadcast('y', { user: 'john' });
                            setTimeout(() => {

                                expect(updates).to.equal(['x', 'x']);
                                client1.disconnect();
                                client2.disconnect();
                                server.stop(done);
                            }, 50);
                        });
                    });
                });
            });
        });

        it('errors on missing auth index (disabled)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            const implementation = function (srv, options) {

                return {
                    authenticate: function (request, reply) {

                        return reply.continue({ credentials: { user: request.headers.authorization } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom', true);

            const password = 'some_not_random_password_that_is_also_long_enough';
            server.register({ register: Nes, options: { auth: { type: 'direct', password, index: false } } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    expect(() => {

                        server.broadcast('x', { user: 'steve' });
                    }).to.throw('Socket auth indexing is disabled');

                    server.stop(done);
                });
            });
        });

        it('errors on missing auth index (no auth)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            const implementation = function (srv, options) {

                return {
                    authenticate: function (request, reply) {

                        return reply.continue({ credentials: { user: request.headers.authorization } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.start((err) => {

                    expect(err).to.not.exist();
                    expect(() => {

                        server.broadcast('x', { user: 'steve' });
                    }).to.throw('Socket auth indexing is disabled');

                    server.stop(done);
                });
            });
        });

        it('logs invalid message', (done) => {

            const server = new Hapi.Server();
            let client;
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.once('log', (event, tags) => {

                    expect(event.data).to.equal('update');
                    client.disconnect();
                    server.stop(done);
                });

                server.start((err) => {

                    expect(err).to.not.exist();
                    client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();
                        const a = { b: 1 };
                        a.c = a;                    // Circular reference

                        server.broadcast(a);
                    });
                });
            });
        });
    });

    describe('subscription()', () => {

        it('ignores non participating connections', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                server.connection();

                server.subscription('/');

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.connections[0].info.port);
                    client.connect(() => {

                        const handler = (update) => {

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

        it('provides subscription notifications', (done) => {

            const server = new Hapi.Server();
            let client;

            const onSubscribe = function (socket, path, params, next) {

                expect(socket).to.exist();
                expect(path).to.equal('/');
                client.disconnect();
                return next();
            };

            const onUnsubscribe = function (socket, path, params, next) {

                expect(socket).to.exist();
                expect(path).to.equal('/');
                expect(params).to.equal({});
                client.disconnect();
                server.stop(done);
            };

            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                server.connection();

                server.subscription('/', { onSubscribe, onUnsubscribe });

                server.start((err) => {

                    expect(err).to.not.exist();
                    client = new Nes.Client('http://localhost:' + server.connections[0].info.port);
                    client.connect(() => {

                        client.subscribe('/', Hoek.ignore, Hoek.ignore);
                    });
                });
            });
        });

        it('removes subscription notification by path', (done) => {

            const server = new Hapi.Server();
            let client;

            const onSubscribe = function (socket, path, params, next) {

                expect(socket).to.exist();
                expect(path).to.equal('/foo');
                client.unsubscribe('/foo', null, Hoek.ignore);
                return next();
            };

            const onUnsubscribe = function (socket, path, params, next) {

                expect(socket).to.exist();
                expect(path).to.equal('/foo');
                expect(params).to.equal({ params: 'foo' });
                client.disconnect();
                server.stop(done);
            };

            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                server.connection();

                server.subscription('/{params*}', { onSubscribe, onUnsubscribe });

                server.start((err) => {

                    expect(err).to.not.exist();
                    client = new Nes.Client('http://localhost:' + server.connections[0].info.port);
                    client.connect(() => {

                        client.subscribe('/foo', Hoek.ignore, Hoek.ignore);
                    });
                });
            });
        });

        it('listen on multiple connections', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.connection();
            server.connection();

            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                server.connection();

                server.subscription('/');

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.connections[0].info.port);
                    client.connect(() => {

                        const updates = [];
                        const handler = (update) => updates.push(update);

                        client.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/', 'heya');

                            setTimeout(() => {

                                expect(updates).to.equal(['heya']);
                                client.disconnect();
                                server.stop(done);
                            }, 50);
                        });
                    });
                });
            });
        });

        it('errors on subscription onSubscribe callback error', (done) => {

            const server = new Hapi.Server();

            const onSubscribe = function (socket, path, params, next) {

                return next(Boom.badRequest('nah'));
            };

            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                server.connection();

                server.subscription('/', { onSubscribe });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.connections[0].info.port);
                    client.connect(() => {

                        client.subscribe('/', Hoek.ignore, (err) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('nah');
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });
    });

    describe('publish()', () => {

        it('publishes to a parameterized path', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/a/{id}');

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();

                        const handler = (update) => {

                            expect(update).to.equal('2');
                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/a/b', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/a/a', '1');
                            server.publish('/a/b', '2');
                        });
                    });
                });
            });
        });

        it('publishes with filter', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                const filter = function (path, update, options, next) {

                    return next(update.a === 1);
                };

                server.subscription('/updates', { filter });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();

                        const handler = (update) => {

                            expect(update).to.equal({ a: 1 });
                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/updates', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/updates', { a: 2 });
                            server.publish('/updates', { a: 1 });
                        });
                    });
                });
            });
        });

        it('publishes with a filter override', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                const filter = function (path, update, options, next) {

                    return next(update.a === 1, { a: 5 });
                };

                server.subscription('/updates', { filter });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();

                        const handler = (update) => {

                            expect(update).to.equal({ a: 5 });
                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/updates', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/updates', { a: 2 });
                            server.publish('/updates', { a: 1 });
                        });
                    });
                });
            });
        });

        it('publishes with filter (socket)', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                const filter = function (path, update, options, next) {

                    if (update.a === 1) {
                        options.socket.publish(path, { a: 5 });
                    }

                    return next(false);
                };

                server.subscription('/updates', { filter });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();

                        const handler = (update) => {

                            expect(update).to.equal({ a: 5 });
                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/updates', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/updates', { a: 2 });
                            server.publish('/updates', { a: 1 });
                        });
                    });
                });
            });
        });

        it('passes internal options to filter', (done) => {

            const server = new Hapi.Server();
            server.connection();

            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                const filter = function (path, update, options, next) {

                    return next(options.internal.b === 1);
                };

                server.subscription('/updates', { filter });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();

                        const handler = (update) => {

                            expect(update).to.equal({ a: 1 });
                            client.disconnect();
                            server.stop(done);
                        };

                        client.subscribe('/updates', handler, (err) => {

                            expect(err).to.not.exist();
                            server.publish('/updates', { a: 2 }, { internal: { b: 2 } });
                            server.publish('/updates', { a: 1 }, { internal: { b: 1 } });
                        });
                    });
                });
            });
        });

        it('publishes to selected user', (done) => {

            const server = new Hapi.Server();
            server.connection();

            const implementation = function (srv, options) {

                return {
                    authenticate: function (request, reply) {

                        return reply.continue({ credentials: { user: 'steve' } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom', 'optional');

            const password = 'some_not_random_password_that_is_also_long_enough';
            server.register({ register: Nes, options: { auth: { type: 'direct', password } } }, (err) => {

                expect(err).to.not.exist();

                const onUnsubscribe = (socket, path, params, next) => next();
                server.subscription('/', { onUnsubscribe, auth: { mode: 'optional', entity: 'user', index: true } });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client1 = new Nes.Client('http://localhost:' + server.info.port);
                    client1.connect({ auth: { headers: { authorization: 'Custom steve' } } }, (err) => {

                        expect(err).to.not.exist();

                        const updates = [];
                        const handler = (update) => updates.push(update);

                        client1.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            const client2 = new Nes.Client('http://localhost:' + server.info.port);
                            client2.connect({ auth: { headers: { authorization: 'Custom steve' } } }, (err) => {

                                expect(err).to.not.exist();
                                client2.subscribe('/', handler, (err) => {

                                    expect(err).to.not.exist();
                                    const client3 = new Nes.Client('http://localhost:' + server.info.port);
                                    client3.connect({ auth: false }, (err) => {

                                        expect(err).to.not.exist();
                                        client3.subscribe('/', handler, (err) => {

                                            expect(err).to.not.exist();

                                            server.publish('/', 'heya', { user: 'steve' });
                                            server.publish('/', 'wowa', { user: 'john' });
                                            setTimeout(() => {

                                                client1.unsubscribe('/', null, (err) => {

                                                    expect(err).to.not.exist();
                                                    client2.unsubscribe('/', null, (err) => {

                                                        expect(err).to.not.exist();
                                                        client3.unsubscribe('/', null, (err) => {

                                                            expect(err).to.not.exist();
                                                            client1.disconnect();
                                                            client2.disconnect();
                                                            client3.disconnect();

                                                            expect(updates).to.equal(['heya', 'heya']);
                                                            server.stop(done);
                                                        });
                                                    });
                                                });
                                            }, 50);
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });

        it('ignores unknown path', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                server.publish('/', 'ignored');
                done();
            });
        });

        it('throws on missing path', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                expect(() => {

                    server.publish('', 'ignored');
                }).to.throw('Missing or invalid subscription path: empty');
                done();
            });
        });

        it('throws on invalid path', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                expect(() => {

                    server.publish('a', 'ignored');
                }).to.throw('Missing or invalid subscription path: a');
                done();
            });
        });

        it('throws on disabled user mapping', (done) => {

            const server = new Hapi.Server();
            server.connection();

            const implementation = function (srv, options) {

                return {
                    authenticate: function (request, reply) {

                        return reply.continue({ credentials: { user: 'steve' } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom', 'optional');

            const password = 'some_not_random_password_that_is_also_long_enough';
            server.register({ register: Nes, options: { auth: { type: 'direct', password } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { mode: 'optional', entity: 'user', index: false } });

                server.start((err) => {

                    expect(() => {

                        server.publish('/', 'heya', { user: 'steve' });
                    }).to.throw('Subscription auth indexing is disabled');

                    expect(err).to.not.exist();
                    server.stop(done);
                });
            });
        });

        it('throws on disabled auth', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                server.subscription('/');
                server.start((err) => {

                    expect(() => {

                        server.publish('/', 'heya', { user: 'steve' });
                    }).to.throw('Subscription auth indexing is disabled');

                    expect(err).to.not.exist();
                    server.stop(done);
                });
            });
        });
    });

    describe('eachSocket()', () => {

        it('publishes to selected user', (done) => {

            const server = new Hapi.Server();
            server.connection();

            const implementation = function (srv, options) {

                return {
                    authenticate: function (request, reply) {

                        return reply.continue({ credentials: { user: 'steve' } });
                    }
                };
            };

            server.auth.scheme('custom', implementation);
            server.auth.strategy('default', 'custom', 'optional');

            const password = 'some_not_random_password_that_is_also_long_enough';
            server.register({ register: Nes, options: { auth: { type: 'direct', password } } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { mode: 'optional', entity: 'user', index: true } });

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client1 = new Nes.Client('http://localhost:' + server.info.port);
                    client1.connect({ auth: { headers: { authorization: 'Custom steve' } } }, (err) => {

                        expect(err).to.not.exist();

                        const updates = [];
                        const handler = (update) => updates.push(update);

                        client1.subscribe('/', handler, (err) => {

                            expect(err).to.not.exist();
                            const client2 = new Nes.Client('http://localhost:' + server.info.port);
                            client2.connect({ auth: { headers: { authorization: 'Custom steve' } } }, (err) => {

                                expect(err).to.not.exist();
                                client2.subscribe('/', handler, (err) => {

                                    expect(err).to.not.exist();
                                    const client3 = new Nes.Client('http://localhost:' + server.info.port);
                                    client3.connect({ auth: false }, (err) => {

                                        expect(err).to.not.exist();
                                        client3.subscribe('/', handler, (err) => {

                                            expect(err).to.not.exist();

                                            server.eachSocket((socket) => socket.publish('/', 'heya'), { user: 'steve', subscription: '/' });
                                            server.eachSocket((socket) => socket.publish('/', 'wowa'), { user: 'john', subscription: '/' });
                                            setTimeout(() => {

                                                client1.unsubscribe('/', null, (err) => {

                                                    expect(err).to.not.exist();
                                                    client2.unsubscribe('/', null, (err) => {

                                                        expect(err).to.not.exist();
                                                        client3.unsubscribe('/', null, (err) => {

                                                            expect(err).to.not.exist();
                                                            client1.disconnect();
                                                            client2.disconnect();
                                                            client3.disconnect();

                                                            expect(updates).to.equal(['heya', 'heya']);
                                                            server.stop(done);
                                                        });
                                                    });
                                                });
                                            }, 50);
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });

        it('throws on missing subscription with user option', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();
                expect(() => {

                    server.eachSocket(Hoek.ignore, { user: 'steve' });
                }).to.throw('Cannot specify user filter without a subscription path');
                done();
            });
        });
    });

    describe('_subscribe()', () => {

        it('subscribes to two paths on same subscription', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/{id}', {});

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        let called = false;
                        const handler1 = (update1) => {

                            called = true;
                        };

                        client.subscribe('/5', handler1, (err) => {

                            expect(err).to.not.exist();

                            const handler2 = (update2) => {

                                expect(called).to.be.true();
                                client.disconnect();

                                setTimeout(() => {

                                    server.stop(() => {

                                        const listener = server.connections[0].plugins.nes._listener;
                                        expect(listener._sockets._items).to.equal({});
                                        const match = listener._router.route('sub', '/5');
                                        expect(match.route.subscribers._items).to.equal({});
                                        done();
                                    });
                                }, 10);
                            };

                            client.subscribe('/6', handler2, (err) => {

                                expect(err).to.not.exist();
                                server.publish('/5', 'a');
                                server.publish('/6', 'b');
                            });
                        });
                    });
                });
            });
        });

        it('errors on double subscribe to same paths', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/{id}', {});

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(() => {

                        client.subscribe('/5', Hoek.ignore, (err) => {

                            expect(err).to.not.exist();
                            const request = {
                                type: 'sub',
                                path: '/5'
                            };

                            client._send(request, true, (err) => {

                                expect(err).to.not.exist();
                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('errors on path with query', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                server.subscription('/');

                server.start((err) => {

                    expect(err).to.not.exist();
                    const client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect((err) => {

                        expect(err).to.not.exist();
                        client.subscribe('/?5', Hoek.ignore, (err) => {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Subscription path cannot contain query');

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });
    });

    describe('Sockets', () => {

        describe('eachSocket()', () => {

            const countSockets = function (server, options) {

                let seen = 0;
                server.eachSocket((socket) => {

                    expect(socket).to.exist();
                    seen++;
                }, options);
                return seen;
            };

            it('returns connected sockets', (done) => {

                const server = new Hapi.Server();
                server.connection();

                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect((err) => {

                            expect(err).to.not.exist();
                            expect(countSockets(server)).to.equal(1);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });

            it('returns sockets on a subscription', (done) => {

                const server = new Hapi.Server();
                server.connection();

                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.subscription('/a/{id}');
                    server.subscription('/b');

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect((err) => {

                            expect(err).to.not.exist();

                            client.subscribe('/b', Hoek.ignore, Hoek.ignore);

                            const client2 = new Nes.Client('http://localhost:' + server.info.port);
                            client2.connect((err) => {

                                expect(err).to.not.exist();
                                client2.subscribe('/a/b', Hoek.ignore, (err) => {

                                    expect(err).to.not.exist();
                                    expect(countSockets(server)).to.equal(2);
                                    expect(countSockets(server, { subscription: '/a/a' })).to.equal(0);
                                    expect(countSockets(server, { subscription: '/a/b' })).to.equal(1);

                                    expect(countSockets(server, { subscription: '/b' })).to.equal(1);

                                    expect(countSockets(server, { subscription: '/foo' })).to.equal(0);

                                    client.disconnect();
                                    client2.disconnect();
                                    server.stop(done);
                                });
                            });
                        });
                    });
                });
            });

            it('ignores not participating connections', (done) => {

                const server = new Hapi.Server();
                server.connection();

                server.register({ register: Nes, options: { auth: false } }, (err) => {

                    expect(err).to.not.exist();

                    server.start((err) => {

                        expect(err).to.not.exist();
                        const client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect((err) => {

                            expect(err).to.not.exist();

                            server.connection();
                            expect(countSockets(server)).to.equal(1);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });
    });

    describe('_generateId()', () => {

        it('rolls over when reached max sockets per millisecond', (done) => {

            const server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, (err) => {

                expect(err).to.not.exist();

                const listener = server.connections[0].plugins.nes._listener;
                listener._socketCounter = 99999;
                let id = listener._generateId();
                expect(id.split(':')[4]).to.equal('99999');
                id = listener._generateId();
                expect(id.split(':')[4]).to.equal('10000');

                done();
            });
        });
    });
});
