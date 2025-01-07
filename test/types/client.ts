import { types as lab } from '@hapi/lab';
import { expect } from '@hapi/code';

const { expect: check } = lab;

import { Client } from '../../lib/client';

const init = () => {

    const client = new Client('ws://localhost', {
        ws: { // optional
            origin: 'http://localhost:12345',
            maxPayload: 1000,
            headers: { cookie: 'xnes=123' }
        }
    });

    client.connect()

    client.connect({
        auth: {
            headers: {
                authorization: 'Basic am9objpzZWNyZXQ='
            }
        }
    });

    client.request('hello');

    client.reauthenticate({
        headers: {
            authorization: 'Bearer am9objpzZWNyZXQ='
        }
    });

    client.onConnect = () => console.log('connected');
    client.onDisconnect = (willReconnect) => console.log('disconnected', willReconnect);
    client.onError = (err) => console.error(err);
    client.onUpdate = (update) => console.log(update);

    client.connect();

    client.subscribe('/item/5', (update) => console.log(update));
    client.unsubscribe('/item/5');

    client.disconnect();
}
