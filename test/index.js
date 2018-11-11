'use strict';

const Code = require('code');
const Hapi = require('hapi');
const Lab = require('lab');
const Nes = require('../');
const Teamwork = require('teamwork');


const internals = {};


const { describe, it } = exports.lab = Lab.script();
const expect = Code.expect;


describe('register()', () => {

    it('adds websocket support', async () => {

        const server = Hapi.server();
        await server.register({ plugin: Nes, options: { auth: false, headers: ['Content-Type'] } });

        server.route({
            method: 'GET',
            path: '/',
            handler: () => 'hello'
        });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port);
        await client.connect();

        const { payload, statusCode, headers } = await client.request('/');
        expect(payload).to.equal('hello');
        expect(statusCode).to.equal(200);
        expect(headers).to.equal({ 'content-type': 'text/html; charset=utf-8' });

        client.disconnect();
        await server.stop();
    });

    it('calls onConnection callback', async () => {

        const server = Hapi.server();
        const team = new Teamwork();
        const onConnection = (ws) => {

            expect(ws).to.exist();
            client.disconnect();
            team.attend();
        };

        await server.register({ plugin: Nes, options: { onConnection, auth: false } });

        server.route({
            method: 'GET',
            path: '/',
            handler: () => 'hello'
        });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port);
        await client.connect();
        await team.work;
        await server.stop();
    });

    it('calls onDisconnection callback', async () => {

        const server = Hapi.server();
        const team = new Teamwork();
        const onDisconnection = (ws) => {

            expect(ws).to.exist();
            client.disconnect();
            team.attend();
        };

        await server.register({ plugin: Nes, options: { onDisconnection, auth: false } });

        server.route({
            method: 'GET',
            path: '/',
            handler: () => 'hello'
        });

        await server.start();
        const client = new Nes.Client('http://localhost:' + server.info.port);
        await client.connect();
        client.disconnect();
        await team.work;
        await server.stop();
    });
});
