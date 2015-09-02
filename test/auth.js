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


describe('initialize()', function () {

    it('sets up an authentication endpoint', function (done) {

        var server = new Hapi.Server();
        server.connection();

        server.auth.scheme('custom', internals.implementation);
        server.auth.strategy('default', 'custom', true);

        server.register({ register: Nes, options: { auth: { cookieOptions: { password: 'password' } } } }, function (err) {

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

                    var client = new Ws('http://localhost:' + server.info.port, { headers: { cookie: 'nes=' + cookie[1] } });

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
                        expect(message.payload).to.equal('hello');
                        expect(message.statusCode).to.equal(200);
                        expect(message.headers).to.contain({
                            'content-type': 'text/html; charset=utf-8'
                        });

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        client.send(JSON.stringify({ method: 'GET', path: '/' }), function (err) {

                            expect(err).to.not.exist();
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

        server.register({ register: Nes, options: { auth: { cookieOptions: { password: 'password' }, route: { mode: 'optional' } } } }, function (err) {

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

                    var client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
                        expect(message.statusCode).to.equal(401);

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        client.send(JSON.stringify({ method: 'GET', path: '/' }), function (err) {

                            expect(err).to.not.exist();
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

        server.register({ register: Nes, options: { auth: { cookieOptions: { password: 'password' }, route: { mode: 'optional' } } } }, function (err) {

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

                    var client = new Ws('http://localhost:' + server.info.port, { headers: { cookie: 'xnes=123' } });

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
                        expect(message.statusCode).to.equal(401);

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        client.send(JSON.stringify({ method: 'GET', path: '/' }), function (err) {

                            expect(err).to.not.exist();
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

        server.register({ register: Nes, options: { auth: { cookieOptions: { password: 'password', path: '/nes/xyz' } } } }, function (err) {

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


internals.implementation = function (server, options) {

    var users = {
        john: {
            id: 'john'
        }
    };

    var scheme = {
        authenticate: function (request, reply) {

            var authorization = request.headers.authorization;
            if (!authorization) {
                return reply(Boom.unauthorized(null, 'Custom'));
            }

            var parts = authorization.split(/\s+/);
            return reply.continue({ credentials: users[parts[1]] });
        }
    };

    return scheme;
};
