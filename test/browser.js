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

        describe('request()', function () {

            it('errors when disconnected', function (done) {

                var client = new Nes.Client();

                client.request('GET', '/', function (err, payload, statusCode, headers) {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Disconnected');
                    done();
                });
            });
        });

        describe('_onClose()', function () {

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
                            }, 100);
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client();
                        client.connect('http://localhost:' + server.info.port, function () {

                            client.request('GET', '/', function (err, payload, statusCode, headers) {

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
    });
});
