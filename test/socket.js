// Load modules

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

    describe('send()', function () {

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
                        var a = { b: 1 };
                        a.c = a;                    // Circular reference

                        server.connections[0].plugins.nes._listener._sockets[0].send(a, { id: 1, type: 'other' });
                    });
                });
            });
        });
    });

    describe('onMessage()', function () {

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
                            expect(headers).to.contain({ 'content-type': 'text/html; charset=utf-8' });

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
                            statusCode: 400,
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

        it('invokes callback on invalid request message', function (done) {

            var server = new Hapi.Server();
            server.connection();

            var client;
            var onUnknownMessage = function (message, ws) {

                expect(message).to.equal('some message');
                client.close();
                server.stop(done);
            };

            server.register({ register: Nes, options: { onUnknownMessage: onUnknownMessage, auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    client = new Ws('http://localhost:' + server.info.port);
                    client.on('open', function () {

                        client.send('some message', function (err) {

                            expect(err).to.not.exist();
                        });
                    });
                });
            });
        });

        it('invokes callback on request message missing nes', function (done) {

            var server = new Hapi.Server();
            server.connection();

            var client;
            var onUnknownMessage = function (message, ws) {

                expect(message).to.equal('{"a":"b"}');
                client.close();
                server.stop(done);
            };

            server.register({ register: Nes, options: { onUnknownMessage: onUnknownMessage, auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    client = new Ws('http://localhost:' + server.info.port);
                    client.on('open', function () {

                        client.send('{"a":"b"}', function (err) {

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
                            statusCode: 400,
                            error: 'Bad Request',
                            message: 'Message missing id'
                        });

                        expect(message.statusCode).to.equal(400);
                        expect(message.nes).to.equal('response');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        client.send(JSON.stringify({ nes: 'request', method: 'GET', path: '/' }), function (err) {

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
                        expect(message.payload).to.deep.equal({
                            statusCode: 400,
                            error: 'Bad Request',
                            message: 'Message missing method'
                        });

                        expect(message.statusCode).to.equal(400);
                        expect(message.nes).to.equal('response');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        client.send(JSON.stringify({ id: 1, nes: 'request', path: '/' }), function (err) {

                            expect(err).to.not.exist();
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
                        expect(message.payload).to.deep.equal({
                            statusCode: 400,
                            error: 'Bad Request',
                            message: 'Message missing path'
                        });

                        expect(message.statusCode).to.equal(400);

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        client.send(JSON.stringify({ id: 1, nes: 'request', method: 'GET' }), function (err) {

                            expect(err).to.not.exist();
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
                        expect(message.payload).to.deep.equal({
                            statusCode: 400,
                            error: 'Bad Request',
                            message: 'Unknown message type'
                        });

                        expect(message.statusCode).to.equal(400);

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        client.send(JSON.stringify({ id: 1, nes: 'unknown' }), function (err) {

                            expect(err).to.not.exist();
                        });
                    });
                });
            });
        });
    });
});
