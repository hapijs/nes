// Load modules

var Code = require('code');
var Hapi = require('hapi');
var Lab = require('lab');
var Nes = require('../');


// Declare internals

var internals = {};


// Test shortcuts

var lab = exports.lab = Lab.script();
var describe = lab.describe;
var it = lab.it;
var expect = Code.expect;


describe('Browser', function () {

    describe('Client', function () {

        describe('connect()', function () {

            it('fails to connect', function (done) {

                var client = new Nes.Client('http://no.such.example.com');

                client.connect(function (err) {

                    expect(err).to.exist();
                    expect(err.message).to.equal('getaddrinfo ENOTFOUND');
                    done();
                });
            });

            it('handles error before open events', function (done) {

                var client = new Nes.Client('http://no.such.example.com');

                client.connect(function (err) {

                    expect(err).to.exist();
                    expect(err.message).to.equal('test');
                    done();
                });

                client._ws.emit('error', new Error('test'));
                client._ws.emit('open');
            });
        });

        describe('disconnect()', function () {

            it('ignores when client not connected', function (done) {

                var client = new Nes.Client();

                client.disconnect();
                done();
            });

            it('ignores when client is disconnecting', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client.disconnect();
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        describe('_onClose()', function () {

            it('reconnects automatically', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var e = 0;
                        client.onError = function (err) {

                            ++e;
                        };

                        var c = 0;
                        client.onConnect = function () {

                            ++c;
                        };

                        expect(c).to.equal(0);
                        expect(e).to.equal(0);
                        client.connect({ delay: 10 }, function () {

                            expect(c).to.equal(1);
                            expect(e).to.equal(0);

                            client._ws.close();
                            setTimeout(function () {

                                expect(c).to.equal(2);
                                expect(e).to.equal(0);
                                client.disconnect();
                                server.stop(done);
                            }, 20);
                        });
                    });
                });
            });

            it('does not reconnect automatically', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var e = 0;
                        client.onError = function (err) {

                            ++e;
                        };

                        var c = 0;
                        client.onConnect = function () {

                            ++c;
                        };

                        expect(c).to.equal(0);
                        expect(e).to.equal(0);
                        client.connect({ reconnect: false, delay: 10 }, function () {

                            expect(c).to.equal(1);
                            expect(e).to.equal(0);

                            client._ws.close();
                            setTimeout(function () {

                                expect(c).to.equal(1);
                                server.stop(done);
                            }, 15);
                        });
                    });
                });
            });

            it('overrides max delay', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var c = 0;
                        var now = Date.now();
                        client.onConnect = function () {

                            ++c;

                            if (c < 5) {
                                client._ws.close();
                                return;
                            }

                            expect(Date.now() - now).to.be.below(90);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.connect({ delay: 10, maxDelay: 15 }, function () { });
                    });
                });
            });

            it('reconnects automatically (with errors)', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var url = 'http://localhost:' + server.info.port;
                        var client = new Nes.Client(url);

                        var e = 0;
                        client.onError = function (err) {

                            ++e;
                            client._url = 'http://localhost:' + server.info.port;
                        };

                        var c = 0;
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

                            client.disconnect();
                            server.stop(done);
                        };

                        expect(e).to.equal(0);
                        client.connect({ delay: 10, maxDelay: 15 }, function () { });
                    });
                });
            });

            it('errors on pending request when closed', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            setTimeout(function () {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Disconnected');

                                server.stop(done);
                            });

                            client.disconnect();
                        });
                    });
                });
            });
        });

        describe('request()', function () {

            it('errors when disconnected', function (done) {

                var client = new Nes.Client();

                client.request('/', function (err, payload, statusCode, headers) {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Disconnected');
                    done();
                });
            });

            it('errors on invalid payload', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'POST',
                        path: '/',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            var a = { b: 1 };
                            a.a = a;

                            client.request({ method: 'POST', path: '/', payload: a }, function (err, payload, statusCode, headers) {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Converting circular structure to JSON');
                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('errors on invalid data', { parallel: false }, function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'POST',
                        path: '/',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client._ws.send = function () {

                                throw new Error('boom');
                            };

                            client.request({ method: 'POST', path: '/', payload: 'a' }, function (err, payload, statusCode, headers) {

                                expect(err).to.exist();
                                expect(err.message).to.equal('boom');
                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        describe('_onMessage', function () {

            it('ignores invalid incoming message', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            request.connection.plugins.nes._listener._sockets[0]._ws.send('{');

                            setTimeout(function () {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var logged;
                        client.onError = function (err) {

                            logged = err.message;
                        };

                        client.connect(function () {

                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(err).to.not.exist();
                                expect(logged).to.equal('Unexpected end of input');

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('ignores incoming message with unknown id', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            request.connection.plugins.nes._listener._sockets[0]._ws.send('{"id":100,"type":"response","statusCode":200,"payload":"hello","headers":{}}');

                            setTimeout(function () {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var logged;
                        client.onError = function (err) {

                            logged = err.message;
                        };

                        client.connect(function () {

                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(err).to.not.exist();
                                expect(logged).to.equal('Received response for missing request');

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('ignores incoming message with unknown type', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: {} }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            request.connection.plugins.nes._listener._sockets[0]._ws.send('{"id":1,"type":"unknown","statusCode":200,"payload":"hello","headers":{}}');

                            setTimeout(function () {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var logged;
                        client.onError = function (err) {

                            if (!logged) {
                                logged = err.message;
                                return;
                            }

                            expect(logged).to.equal('Received unknown response type: unknown');
                            expect(err.message).to.equal('Received response for missing request');

                            client.disconnect();
                            server.stop(done);
                        };

                        client.connect(function () {

                            client.request('/', function (err, payload, statusCode, headers) { });
                        });
                    });
                });
            });
        });
    });
});
