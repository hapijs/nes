'use strict';

const Url = require('url');

const Code = require('@hapi/code');
const Hapi = require('@hapi/hapi');
const Lab = require('@hapi/lab');
const Nes = require('../');
const Teamwork = require('@hapi/teamwork');


const internals = {};


const { describe, it } = exports.lab = Lab.script();
const expect = Code.expect;


describe('register()', () => {

    const getUri = ({ protocol, address, port }) => Url.format({ protocol, hostname: address, port });

    it('adds websocket support', async () => {

        const server = Hapi.server();
        await server.register({ plugin: Nes, options: { auth: false, headers: ['Content-Type'] } });

        server.route({
            method: 'GET',
            path: '/',
            handler: () => 'hello'
        });
        await server.start();

        const client = new Nes.Client(getUri(server.info));
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
        const team = new Teamwork.Team();
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
        const client = new Nes.Client(getUri(server.info));
        await client.connect();
        await team.work;
        await server.stop();
    });

    it('calls onDisconnection callback', async () => {

        const server = Hapi.server();
        const team = new Teamwork.Team();
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
        const client = new Nes.Client(getUri(server.info));
        await client.connect();
        client.disconnect();
        await team.work;
        await server.stop();
    });
});
