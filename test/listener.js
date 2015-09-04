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
            server.register({ register: Nes, options: {} }, function (err) {

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
            server.register({ register: Nes, options: {} }, function (err) {

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
    });
});
