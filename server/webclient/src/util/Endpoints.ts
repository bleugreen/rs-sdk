// Where this page's sockets connect.
//
// The engine serves the client page, so by default every socket goes to the
// page's own host: the game and on-demand sockets to wss://<host>/ and the bot
// overlay to wss://<host>/gateway (a proxy inside the engine to its SDK
// gateway). A page served from somewhere else - server/webclient/proxy.ts on a
// run host, in front of a remote world - names its endpoints in the query:
//
//   ?server=host[:port]      game and on-demand sockets; TLS unless the host is
//                            localhost or 127.x (the lite client's rule)
//   ?gateway=ws(s)://host... the overlay's SDK gateway, e.g. one on loopback
//                            beside the tab
//
// A malformed value is reported and ignored, so the page falls back to its own
// host rather than failing to connect anywhere.

export interface SocketEndpoint {
    host: string;
    secured: boolean;
}

const HOST_PORT = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;
const WS_URL = /^wss?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/\S*)?$/;

function isLoopback(host: string): boolean {
    return host.startsWith('localhost') || host.startsWith('127.');
}

export function worldEndpoint(location: Pick<Location, 'host' | 'protocol' | 'search'> = window.location): SocketEndpoint {
    const server = new URLSearchParams(location.search).get('server');
    if (server !== null) {
        if (HOST_PORT.test(server)) {
            return { host: server, secured: !isLoopback(server) };
        }
        console.error(`[Endpoints] ignoring ?server=${server}: expected host[:port]`);
    }
    return { host: location.host, secured: location.protocol === 'https:' };
}

export function gatewayUrl(location: Pick<Location, 'host' | 'protocol' | 'search'> = window.location): string {
    const gateway = new URLSearchParams(location.search).get('gateway');
    if (gateway !== null) {
        if (WS_URL.test(gateway)) {
            return gateway;
        }
        console.error(`[Endpoints] ignoring ?gateway=${gateway}: expected ws://host[:port][/path] or wss://...`);
    }
    return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/gateway`;
}
