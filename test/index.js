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


describe('register()', function () {

    it('adds websocket support', function (done) {

        var server = new Hapi.Server();
        server.connection();
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

                var client = new Ws('http://localhost:' + server.info.port);

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
