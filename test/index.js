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


describe('register()', function () {

    it('adds websocket support', function (done) {

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

                    client.request('/', function (err, payload, statusCode, headers) {

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

    it('calls onConnect callback', function (done) {

        var client;

        var onConnect = function (ws) {

            expect(ws).to.exist();
            client.disconnect();
            server.stop(done);
        };

        var server = new Hapi.Server();
        server.connection();
        server.register({ register: Nes, options: { onConnect: onConnect, auth: false } }, function (err) {

            expect(err).to.not.exist();

            server.route({
                method: 'GET',
                path: '/',
                handler: function (request, reply) {

                    return reply('hello');
                }
            });

            server.start(function (err) {

                client = new Nes.Client('http://localhost:' + server.info.port);
                client.connect(function () { });
            });
        });
    });
});
