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
                    done();
                });
            });
        });
    });
});
