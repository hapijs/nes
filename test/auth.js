// Load modules

var Boom = require('boom');
var Code = require('code');
var Hapi = require('hapi');
var Iron = require('iron');
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


describe('authentication', function () {

    describe('cookie', function () {

        it('protects an endpoint', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: {} }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, function (res) {

                        expect(res.result.status).to.equal('authenticated');

                        var header = res.headers['set-cookie'][0];
                        var cookie = header.match(/(?:[^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)\s*=\s*(?:([^\x00-\x20\"\,\;\\\x7F]*))/);

                        var client = new Nes.Client('http://localhost:' + server.info.port, { headers: { cookie: 'nes=' + cookie[1] } });
                        client.connect(function (err) {

                            expect(err).to.not.exist();
                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(payload).to.equal('hello');
                                expect(statusCode).to.equal(200);
                                expect(headers).to.contain({
                                    'content-type': 'text/html; charset=utf-8'
                                });

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('errors on missing auth on an authentication endpoint', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { password: 'password', route: { mode: 'optional' } } } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    server.inject('/nes/auth', function (res) {

                        expect(res.result.status).to.equal('unauthenticated');

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function (err) {

                            expect(err).to.not.exist();
                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(statusCode).to.equal(401);

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('errors on missing auth on an authentication endpoint (other cookies)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { password: 'password', route: { mode: 'optional' } } } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    server.inject('/nes/auth', function (res) {

                        expect(res.result.status).to.equal('unauthenticated');

                        var client = new Nes.Client('http://localhost:' + server.info.port, { headers: { cookie: 'xnes=123' } });
                        client.connect(function (err) {

                            expect(err).to.not.exist();
                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(statusCode).to.equal(401);

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('overrides cookie path', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { password: 'password', path: '/nes/xyz' } } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, function (res) {

                    expect(res.result.status).to.equal('authenticated');

                    var header = res.headers['set-cookie'][0];
                    expect(header).to.contain('Path=/nes/xyz');
                    done();
                });
            });
        });
    });

    describe('token', function () {

        it('protects an endpoint', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, function (res) {

                        expect(res.result.status).to.equal('authenticated');
                        expect(res.result.token).to.exist();

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function (err) {

                            expect(err).to.not.exist();
                            client.authenticate(res.result.token, function (err) {

                                expect(err).to.not.exist();
                                client.request('/', function (err, payload, statusCode, headers) {

                                    expect(payload).to.equal('hello');
                                    expect(statusCode).to.equal(200);
                                    expect(headers).to.contain({
                                        'content-type': 'text/html; charset=utf-8'
                                    });

                                    client.disconnect();
                                    server.stop(done);
                                });
                            });
                        });
                    });
                });
            });
        });

        it('protects an endpoint (token with iron settings)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: 'password', iron: Iron.defaults } } }, function (err) {

                expect(err).to.not.exist();

                server.route({
                    method: 'GET',
                    path: '/',
                    handler: function (request, reply) {

                        return reply('hello');
                    }
                });

                server.start(function (err) {

                    server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, function (res) {

                        expect(res.result.status).to.equal('authenticated');
                        expect(res.result.token).to.exist();

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function (err) {

                            expect(err).to.not.exist();
                            client.authenticate(res.result.token, function (err) {

                                expect(err).to.not.exist();
                                client.request('/', function (err, payload, statusCode, headers) {

                                    expect(payload).to.equal('hello');
                                    expect(statusCode).to.equal(200);
                                    expect(headers).to.contain({
                                        'content-type': 'text/html; charset=utf-8'
                                    });

                                    client.disconnect();
                                    server.stop(done);
                                });
                            });
                        });
                    });
                });
            });
        });

        it('errors on invalid token', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: 'password' } } }, function (err) {

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
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.authenticate('abc', function (err) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Invalid token');

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on missing token', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: 'password' } } }, function (err) {

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
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.authenticate('', function (err) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Authentication missing credentials');

                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('errors on invalid iron password', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: new Buffer('') } } }, function (err) {

                expect(err).to.not.exist();
                server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, function (res) {

                    expect(res.statusCode).to.equal(500);
                    done();
                });
            });
        });

        it('errors on double authentication', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'token', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();
                server.start(function (err) {

                    server.inject({ url: '/nes/auth', headers: { authorization: 'Custom john' } }, function (res) {

                        expect(res.result.status).to.equal('authenticated');
                        expect(res.result.token).to.exist();

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function (err) {

                            expect(err).to.not.exist();
                            client.authenticate(res.result.token, function (err) {

                                expect(err).to.not.exist();
                                client.authenticate(res.result.token, function (err) {

                                    expect(err).to.exist();
                                    expect(err.message).to.equal('Connection already authenticated');

                                    client.disconnect();
                                    server.stop(done);
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    describe('direct', function () {

        it('protects an endpoint', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

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
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.authenticate({ headers: { authorization: 'Custom john' } }, function (err) {

                            expect(err).to.not.exist();
                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(payload).to.equal('hello');
                                expect(statusCode).to.equal(200);
                                expect(headers).to.contain({
                                    'content-type': 'text/html; charset=utf-8'
                                });

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        it('reconnects automatically', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

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
                    client.connect({ delay: 10, auth: { headers: { authorization: 'Custom john' } } }, function () {

                        expect(c).to.equal(1);
                        expect(e).to.equal(0);

                        client._ws.close();
                        setTimeout(function () {

                            expect(c).to.equal(2);
                            expect(e).to.equal(0);

                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(payload).to.equal('hello');
                                expect(statusCode).to.equal(200);

                                client.disconnect();
                                server.stop(done);
                            });
                        }, 30);
                    });
                });
            });
        });

        it('does not reconnect when auth fails', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();
                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);

                    var c = 0;
                    client.onConnect = function () {

                        ++c;
                    };

                    expect(c).to.equal(0);
                    client.connect({ delay: 10, auth: { headers: { authorization: 'Custom steve' } } }, function (err) {

                        expect(c).to.equal(0);

                        client._ws.close();
                        setTimeout(function () {

                            expect(c).to.equal(0);

                            client.disconnect();
                            server.stop(done);
                        }, 20);
                    });
                });
            });
        });

        it('fails authentication', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.authenticate({ headers: { authorization: 'Custom steve' } }, function (err) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Unauthorized');
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('fails authentication', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.authenticate('', function (err) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Authentication missing credentials');
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        it('subscribes to a path', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/');

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(client.subscriptions()).to.deep.equal(['/']);
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

        it('subscribes to a path with filter', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                var filter = function (path, update, options, next) {

                    return next(options.credentials.id === update);
                };

                server.subscription('/', { filter: filter });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('john');
                            client.disconnect();
                            server.stop(done);
                        });

                        setTimeout(function () {

                            server.publish('/', 'steve');
                            server.publish('/', 'john');
                        }, 10);
                    });
                });
            });
        });

        it('errors on missing auth to subscribe (default)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/');

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Unauthorized');
                            expect(client.subscriptions()).to.deep.equal([]);

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

        it('errors on missing auth to subscribe (config)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { mode: 'required' } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Unauthorized');
                            expect(client.subscriptions()).to.deep.equal([]);

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

        it('does not require auth to subscribe without a default', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom');

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/');

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

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

        it('does not require auth to subscribe with optional auth', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', 'optional');

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/');

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect(function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

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

        it('matches entity (user)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { entity: 'user' } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

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

        it('matches entity (app)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { entity: 'app' } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom app' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

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

        it('errors on wrong entity (user)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { entity: 'app' } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('User credentials cannot be used on an application subscription');
                            expect(client.subscriptions()).to.deep.equal([]);

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

        it('errors on wrong entity (app)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { entity: 'user' } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom app' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Application credentials cannot be used on a user subscription');
                            expect(client.subscriptions()).to.deep.equal([]);

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

        it('matches scope (string/string)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: 'a' } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

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

        it('matches scope (array/string)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: ['x', 'a'] } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

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

        it('matches scope (string/array)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: 'a' } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom ed' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

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

        it('matches scope (array/array)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: ['b', 'a'] } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom ed' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/']);

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

        it('matches scope (dynamic)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/{id}', { auth: { scope: ['b', '{id}'] } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom ed' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/5', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            expect(client.subscriptions()).to.deep.equal(['/5']);

                            client.disconnect();
                            server.stop(done);
                        });

                        setTimeout(function () {

                            server.publish('/5', 'heya');
                        }, 10);
                    });
                });
            });
        });

        it('errors on wrong scope (string/string)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: 'b' } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom john' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Insufficient scope, expected any of: b');
                            expect(client.subscriptions()).to.deep.equal([]);

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

        it('errors on wrong scope (string/array)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: 'x' } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom ed' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Insufficient scope, expected any of: x');
                            expect(client.subscriptions()).to.deep.equal([]);

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

        it('errors on wrong scope (string/none)', function (done) {

            var server = new Hapi.Server();
            server.connection();

            server.auth.scheme('custom', internals.implementation);
            server.auth.strategy('default', 'custom', true);

            server.register({ register: Nes, options: { auth: { type: 'direct', password: 'password' } } }, function (err) {

                expect(err).to.not.exist();

                server.subscription('/', { auth: { scope: 'x' } });

                server.start(function (err) {

                    var client = new Nes.Client('http://localhost:' + server.info.port);
                    client.connect({ auth: { headers: { authorization: 'Custom app' } } }, function (err) {

                        expect(err).to.not.exist();
                        client.subscribe('/', function (err, update) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Insufficient scope, expected any of: x');
                            expect(client.subscriptions()).to.deep.equal([]);

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
});


internals.implementation = function (server, options) {

    var users = {
        john: {
            id: 'john',
            user: true,
            scope: 'a'
        },
        ed: {
            id: 'ed',
            scope: ['a', 'b', 5]
        },
        app: {
            id: 'app'
        }
    };

    var scheme = {
        authenticate: function (request, reply) {

            var authorization = request.headers.authorization;
            if (!authorization) {
                return reply(Boom.unauthorized(null, 'Custom'));
            }

            var parts = authorization.split(/\s+/);
            var user = users[parts[1]];
            if (!user) {
                return reply(Boom.unauthorized('Unknown user', 'Custom'));
            }

            return reply.continue({ credentials: user });
        }
    };

    return scheme;
};
