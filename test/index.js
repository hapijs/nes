'use strict';

// Load modules

const Code = require('code');
const Hapi = require('hapi');
const Lab = require('lab');
const Nes = require('../');


// Declare internals

const internals = {};


// Test shortcuts

const lab = exports.lab = Lab.script();
const describe = lab.describe;
const it = lab.it;
const expect = Code.expect;


describe('register()', () => {

    it('adds websocket support', (done) => {

        const server = new Hapi.Server();
        server.connection();
        server.register({ register: Nes, options: { auth: false, headers: ['Content-Type'] } }, (err) => {

            expect(err).to.not.exist();

            server.route({
                method: 'GET',
                path: '/',
                handler: function (request, reply) {

                    return reply('hello');
                }
            });

            server.start((err) => {

                const client = new Nes.Client('http://localhost:' + server.info.port);
                client.connect(() => {

                    client.request('/', (err, payload, statusCode, headers) => {

                        expect(err).to.not.exist();
                        expect(payload).to.equal('hello');
                        expect(statusCode).to.equal(200);
                        expect(headers).to.deep.equal({ 'content-type': 'text/html; charset=utf-8' });

                        client.disconnect();
                        server.stop(done);
                    });
                });
            });
        });
    });

    it('calls onConnection callback', (done) => {

        const server = new Hapi.Server();
        server.connection();

        let client;
        const onConnection = function (ws) {

            expect(ws).to.exist();
            client.disconnect();
            server.stop(done);
        };

        server.register({ register: Nes, options: { onConnection: onConnection, auth: false } }, (err) => {

            expect(err).to.not.exist();

            server.route({
                method: 'GET',
                path: '/',
                handler: function (request, reply) {

                    return reply('hello');
                }
            });

            server.start((err) => {

                client = new Nes.Client('http://localhost:' + server.info.port);
                client.connect(() => { });
            });
        });
    });

    it('calls onDisconnection callback', (done) => {

        const server = new Hapi.Server();
        server.connection();

        let client;
        const onDisconnection = function (ws) {

            expect(ws).to.exist();
            client.disconnect();
            server.stop(done);
        };

        server.register({ register: Nes, options: { onDisconnection: onDisconnection, auth: false } }, (err) => {

            expect(err).to.not.exist();

            server.route({
                method: 'GET',
                path: '/',
                handler: function (request, reply) {

                    return reply('hello');
                }
            });

            server.start((err) => {

                client = new Nes.Client('http://localhost:' + server.info.port);
                client.connect(() => {

                    client.disconnect();
                });
            });
        });
    });
});
