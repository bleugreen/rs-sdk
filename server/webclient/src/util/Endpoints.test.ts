import { describe, expect, test } from 'bun:test';

import '../lite/test-support/browser-globals.js';

import { gatewayUrl, worldEndpoint } from './Endpoints.js';

const page = (search: string, protocol = 'https:', host = 'rs-sdk-demo.fly.dev') => ({ host, protocol, search });

describe('page endpoints', () => {
    test('default to the page host, as when the engine serves the page', () => {
        expect(worldEndpoint(page(''))).toEqual({ host: 'rs-sdk-demo.fly.dev', secured: true });
        expect(worldEndpoint(page('', 'http:', 'localhost:8888'))).toEqual({ host: 'localhost:8888', secured: false });
        expect(gatewayUrl(page('?bot=a'))).toBe('wss://rs-sdk-demo.fly.dev/gateway');
        expect(gatewayUrl(page('', 'http:', 'localhost:8888'))).toBe('ws://localhost:8888/gateway');
    });

    test('a locally served page reaches a remote world and a loopback gateway', () => {
        const local = page('?bot=a&password=b&server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7790', 'http:', 'localhost:8899');
        expect(worldEndpoint(local)).toEqual({ host: 'rs-sdk-demo.fly.dev', secured: true });
        expect(gatewayUrl(local)).toBe('ws://127.0.0.1:7790');
        expect(worldEndpoint(page('?server=localhost:8888', 'http:', 'localhost:8899'))).toEqual({ host: 'localhost:8888', secured: false });
        expect(worldEndpoint(page('?server=127.0.0.1:43594'))).toEqual({ host: '127.0.0.1:43594', secured: false });
    });

    test('ignore malformed values instead of connecting nowhere', () => {
        const errors: unknown[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            expect(worldEndpoint(page('?server=wss://evil/x'))).toEqual({ host: 'rs-sdk-demo.fly.dev', secured: true });
            expect(gatewayUrl(page('?gateway=http://127.0.0.1:7790'))).toBe('wss://rs-sdk-demo.fly.dev/gateway');
        } finally {
            console.error = original;
        }
        expect(errors).toHaveLength(2);
    });
});
