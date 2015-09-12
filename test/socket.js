// Load modules

var Boom = require('boom');
var Code = require('code');
var Hapi = require('hapi');
var Lab = require('lab');
var Nes = require('../');
var Ws = require('ws');


// Declare internals

var internals = {};


// Test shortcuts

var lab = exports.lab = Lab.script();
var describe = lab.describe;
var it = lab.it;
var expect = Code.expect;


describe('Socket', function () {

    describe('disconnect()', function () {

        it('closes connection', function (done) {

            var onMessage = function (socket, message, reply) {

                socket.disconnect();
            };

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { onMessage: onMessage } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.onDisconnect = function () {

                        client.disconnect();
                        server.stop(done);
                    };

                    client.connect(function () {

                        client.message('winning', function (err, response) { });
                    });
                });
            });
        });
    });

    describe('_send()', function () {

        it('errors on invalid message', function (done) {

            var server = new Hapi.Server();
            var client;
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.on('log', function (event, tags) {

                    expect(event.data).to.equal('other');
                    client.disconnect();
                    server.stop(done);
                });

                server.start(function (err) {

                    client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        var a = { id: 1, type: 'other' };
                        a.c = a;                    // Circular reference

                        server.connections[0].plugins.nes._listener._sockets.forEach(function (socket) {

                            socket._send(a);
                        });
                    });
                });
            });
        });
    });

    describe('_onMessage()', function () {

        it('supports route id', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

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

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.request('resource', function (err, payload, statusCode, headers) {

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

        it('errors on unknown route id', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

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

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.request('something', function (err, payload, statusCode, headers) {

                            expect(err).to.exist();
                            expect(statusCode).to.equal(404);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on wildcard method route id', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

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

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.request('resource', function (err, payload, statusCode, headers) {

                            expect(err).to.exist();
                            expect(statusCode).to.equal(400);

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on invalid request message', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    var client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
                        expect(message.payload).to.deep.equal({
                            error: 'Bad Request',
                            message: 'Cannot parse message'
                        });

                        expect(message.statusCode).to.equal(400);

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        client.send('{', function (err) {

                            expect(err).to.not.exist();
                        });
                    });
                });
            });
        });

        it('errors on auth endpoint request', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: { password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.request('/nes/auth', function (err, payload, statusCode, headers) {

                            expect(statusCode).to.equal(404);
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on missing id', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    var client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
                        expect(message.payload).to.deep.equal({
                            error: 'Bad Request',
                            message: 'Message missing id'
                        });

                        expect(message.statusCode).to.equal(400);
                        expect(message.type).to.equal('request');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        client.send(JSON.stringify({ type: 'request', method: 'GET', path: '/' }), function (err) {

                            expect(err).to.not.exist();
                        });
                    });
                });
            });
        });

        it('errors on uninitialized connection', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    var client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
                        expect(message.payload.message).to.equal('Connection is not initialized');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        client.send(JSON.stringify({ id: 1, type: 'request', path: '/' }), function (err) {

                            expect(err).to.not.exist();
                        });
                    });
                });
            });
        });

        it('errors on missing method', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    var client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
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

                    client.on('open', function () {

                        client.send(JSON.stringify({ id: 1, type: 'hello' }), function (err) {

                            expect(err).to.not.exist();
                            client.send(JSON.stringify({ id: 2, type: 'request', path: '/' }), function (err) {

                                expect(err).to.not.exist();
                            });
                        });
                    });
                });
            });
        });

        it('errors on missing path', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    var client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
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

                    client.on('open', function () {

                        client.send(JSON.stringify({ id: 1, type: 'hello' }), function (err) {

                            expect(err).to.not.exist();
                            client.send(JSON.stringify({ id: 2, type: 'request', method: 'GET' }), function (err) {

                                expect(err).to.not.exist();
                            });
                        });
                    });
                });
            });
        });

        it('errors on unknown type', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    var client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
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

                    client.on('open', function () {

                        client.send(JSON.stringify({ id: 1, type: 'hello' }), function (err) {

                            expect(err).to.not.exist();
                            client.send(JSON.stringify({ id: 2, type: 'unknown' }), function (err) {

                                expect(err).to.not.exist();
                            });
                        });
                    });
                });
            });
        });

        it('unsubscribes to two paths on same subscription', function (done) {

            var server = new Hapi.Server();
            server.connection();

            var onMessage = function (socket, message, next) {

                return next('b');
            };

            server.register({ register: Nes, options: { auth: false, onMessage: onMessage } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/{id}', {});

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        var called = false;
                        client.subscribe('/5', function (err, update) { });

                        client.subscribe('/6', function (err, update) {

                            expect(err).to.not.exist();

                            client.unsubscribe('/5');
                            client.unsubscribe('/6');

                            client.message('a', function (err, message) {

                                var listener = server.connections[0].plugins.nes._listener;
                                var match = listener._router.route('sub', '/5');
                                expect(match.route.subscribers._items).to.deep.equal({});

                                client.disconnect();
                                server.stop(done);
                            });
                        });

                        setTimeout(function () {

                            server.publish('/6', 'b');
                        }, 10);
                    });
                });
            });
        });

        it('ignores double unsubscribe to same subscription', function (done) {

            var server = new Hapi.Server();
            server.connection();

            var onMessage = function (socket, message, next) {

                return next('b');
            };

            server.register({ register: Nes, options: { auth: false, onMessage: onMessage } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/{id}', {});

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.subscribe('/6', function (err, update) {

                            expect(err).to.not.exist();

                            client.unsubscribe('/6');
                            client._send({ type: 'unsub', path: '/6' });

                            client.message('a', function (err, message) {

                                var listener = server.connections[0].plugins.nes._listener;
                                var match = listener._router.route('sub', '/6');
                                expect(match.route.subscribers._items).to.deep.equal({});

                                client.disconnect();
                                server.stop(done);
                            });
                        });

                        setTimeout(function () {

                            server.publish('/6', 'b');
                        }, 10);
                    });
                });
            });
        });

        it('ignores double unsubscribe to same subscription with another path', function (done) {

            var server = new Hapi.Server();
            server.connection();

            var onMessage = function (socket, message, next) {

                return next('b');
            };

            server.register({ register: Nes, options: { auth: false, onMessage: onMessage } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/{id}', {});

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.subscribe('/5', function () { });

                        client.subscribe('/6', function (err, update) {

                            expect(err).to.not.exist();

                            client.unsubscribe('/6');
                            client._send({ type: 'unsub', path: '/6' });
                            client.unsubscribe('/5');

                            client.message('a', function (err, message) {

                                var listener = server.connections[0].plugins.nes._listener;
                                var match = listener._router.route('sub', '/6');
                                expect(match.route.subscribers._items).to.deep.equal({});

                                client.disconnect();
                                server.stop(done);
                            });
                        });

                        setTimeout(function () {

                            server.publish('/6', 'b');
                        }, 10);
                    });
                });
            });
        });
    });

    describe('_processRequest()', function () {

        it('passed headers', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false, headers: '*' } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello ' + request.headers.a);
                    }
                });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.request({ path: '/', headers: { a: 'b' } }, function (err, payload, statusCode, headers) {

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

        it('errors on authorization header', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.request({ path: '/', headers: { Authorization: 'something' } }, function (err, payload, statusCode, headers) {

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

    describe('_processMessage()', function () {

        it('calls onMessage callback', function (done) {

            var onMessage = function (socket, message, reply) {

                expect(message).to.equal('winning');
                reply('hello');
            };

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { onMessage: onMessage } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.message('winning', function (err, response) {

                            expect(err).to.not.exist();
                            expect(response).to.equal('hello');
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('sends errors from callback (raw)', function (done) {

            var client;

            var onMessage = function (socket, message, reply) {

                expect(message).to.equal('winning');
                reply(new Error('failed'));
            };

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { onMessage: onMessage } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.message('winning', function (err, response) {

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

        it('sends errors from callback (boom)', function (done) {

            var client;

            var onMessage = function (socket, message, reply) {

                expect(message).to.equal('winning');
                reply(Boom.badRequest('failed'));
            };

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { onMessage: onMessage } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.message('winning', function (err, response) {

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

        it('errors if missing onMessage callback', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: {} }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.message('winning', function (err, response) {

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
