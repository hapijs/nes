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


describe('Manager', function () {

    describe('broadcast()', function () {

        it('sends message to all clients', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: {} }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    var client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
                        expect(message.payload).to.equal('hello');
                        expect(message.headers).to.deep.equal({});
                        expect(message.statusCode).to.equal(200);
                        expect(message.type).to.equal('broadcast');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        server.broadcast('hello');
                    });
                });
            });
        });

        it('sends message to all clients with headers', function (done) {

            var server = new Hapi.Server();
            server.connection();
            server.register({ register: Nes, options: {} }, function (err) {

                expect(err).to.not.exist();

                server.start(function (err) {

                    var client = new Ws('http://localhost:' + server.info.port);

                    client.on('message', function (data, flags) {

                        var message = JSON.parse(data);
                        expect(message.payload).to.equal('hello');
                        expect(message.headers).to.deep.equal({ test: 1 });
                        expect(message.statusCode).to.equal(200);
                        expect(message.type).to.equal('broadcast');

                        client.close();
                        server.stop(done);
                    });

                    client.on('open', function () {

                        server.broadcast('hello', { test: 1 });
                    });
                });
            });
        });
    });
});
