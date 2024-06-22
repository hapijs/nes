import { types as lab } from '@hapi/lab';

const { expect: check } = lab;

import * as Hapi from '@hapi/hapi';
import { Plugin, ServerRegisterPluginObjectDirect } from '@hapi/hapi';

import * as NesPlugin from '../../lib';
import { Nes, Client, plugin } from '../../lib';

const init = async () => {

    const server = Hapi.server();

    await server.register(NesPlugin);

    const nesPlugin: ServerRegisterPluginObjectDirect<Nes.PluginOptions, any> = {
        plugin,
        options: {
            auth: {
                cookie: 'wee',
                endpoint: '/hello',
                id: 'hello',
                route: 'woo',
                type: 'cookie',
                domain: '',
                index: true,
                iron: {
                    encryption: {
                        algorithm: 'aes-128-ctr',
                        iterations: 4,
                        minPasswordlength: 8,
                        saltBits: 16
                    },
                    integrity: {

                        algorithm: 'aes-128-ctr',
                        iterations: 4,
                        minPasswordlength: 8,
                        saltBits: 16
                    },
                    localtimeOffsetMsec: 10 * 1000,
                    timestampSkewSec: 10 * 1000,
                    ttl: 10 * 1000
                }
            },
            async onMessage(socket, _message) {

                const message = _message as { test: true };

                if (message.test === true) {

                    await socket.send({ hey: 'man' })
                }
            },
        }
    }

    await server.register(nesPlugin);

    check.type<Plugin<Nes.PluginOptions>>(NesPlugin.plugin);

    server.subscription('/item/{id}');
    server.broadcast('welcome');

    server.route({
        method: 'GET',
        path: '/test',
        handler: (request) => {

            check.type<Nes.Socket>(request.socket);

            return {
                test: 'passes ' + request.socket.id
            };
        }
    });

    server.publish('/item/5', { id: 5, status: 'complete' });
    server.publish('/item/6', { id: 6, status: 'initial' });

    const socket: Nes.Socket = {} as any;

    socket.send('message');
    socket.publish('path', 'message');
    socket.revoke('path', 'message');
    socket.disconnect();

    check.type<
        (p: string, m: unknown, o: Nes.PublishOptions) => void
    >(server.publish);

    const client = new Client('ws://localhost');

    client.connect();
};