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


describe('Listener', function () {

    describe('broadcast()', function () {

        it('sends message to all clients', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.onBroadcast = function (message) {

                        expect(message).to.equal('hello');
                        client.disconnect();
                        server.stop(done);
                    };

                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        server.broadcast('hello');
                    });
                });
            });
        });

        it('sends message to all clients (non participating connections)', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.onBroadcast = function (message) {

                        expect(message).to.equal('hello');
                        client.disconnect();
                        server.stop(done);
                    };

                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        server.connection();
                        server.broadcast('hello');
                    });
                });
            });
        });

        it('logs invalid message', function (done) {

            var server = new Hapi.Server();
            var client;
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.on('log', function (event, tags) {

                    expect(event.data).to.equal('broadcast');
                    client.disconnect();
                    server.stop(done);
                });

                server.start(function (err) {

                    client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        var a = { b: 1 };
                        a.c = a;                    // Circular reference

                        server.broadcast(a);
                    });
                });
            });
        });
    });

    describe('subscription()', function () {

        it('ignores non participating connections', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();
                server.connection();

                server.subscription('/');

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function () {

                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            client.disconnect();
                            server.stop(done);
                        });

                        setTimeout(function () {

                            server.publish('/', 'heya');
                        }, 10);
                    });
                });
            });
        });
    });

    describe('publish()', function () {

        it('publishes to a parameterized path', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/a/{id}');

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/a/b', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('2');
                            client.disconnect();
                            server.stop(done);
                        });

                        setTimeout(function () {

                            server.publish('/a/a', '1');
                            server.publish('/a/b', '2');
                        }, 10);
                    });
                });
            });
        });

        it('publishes with filter', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                var filter = function (path, update, options, next) {

                    return next(update.a === 1);
                };

                server.subscription('/updates', { filter: filter });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/updates', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.deep.equal({ a: 1 });
                            client.disconnect();
                            server.stop(done);
                        });

                        setTimeout(function () {

                            server.publish('/updates', { a: 2 });
                            server.publish('/updates', { a: 1 });
                        }, 10);
                    });
                });
            });
        });

        it('ignores unknown path', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();
                server.publish('/', 'ignored');
                done();
            });
        });

        it('throws on missing path', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();
                expect(function () {

                    server.publish('', 'ignored');
                }).to.throw('Missing or invalid subscription path: empty');
                done();
            });
        });

        it('throws on invalid path', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();
                expect(function () {

                    server.publish('a', 'ignored');
                }).to.throw('Missing or invalid subscription path: a');
                done();
            });
        });
    });

    describe('subscribe()', function () {

        it('errors on path with query', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: { auth: false } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/');

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/?5', function (err, update) {

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
});
