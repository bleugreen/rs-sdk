// Serve this webclient build in front of a remote world.
//
//   bun run proxy --world=https://rs-sdk-demo.fly.dev [--port=8899] [--gateway=ws://127.0.0.1:7780]
//   open http://localhost:8899/bot?bot=NAME&password=PW
//
// Every HTTP request is forwarded to the world, so the bot page, /crc and the
// cache archives are byte-for-byte what that world's own clients load (the
// world sends no CORS headers, so the page cannot fetch them cross-origin).
// Only the bot bundle, out/bot/*, comes from this build.
//
// No socket passes through here. A /bot request without ?server= is redirected
// with ?server=<world host> (and ?gateway= when --gateway is given), so the game
// and on-demand sockets connect straight to the world and the overlay to the
// named gateway - typically one on loopback beside the tab (src/util/Endpoints.ts).

import fs from 'fs';
import path from 'path';

const args = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
        const [k, ...v] = a.slice(2).split('=');
        return [k, v.join('=')];
    })
);

if (!args.world) {
    console.error('usage: bun run proxy --world=https://host [--port=8899] [--gateway=ws://127.0.0.1:7780]');
    process.exit(2);
}
const world = new URL(args.world);
const port = Number(args.port || 8899);
const gateway = args.gateway || null;
const bundleDir = path.resolve(import.meta.dir, 'out/bot');

if (!fs.existsSync(path.join(bundleDir, 'client.js'))) {
    console.error(`no bundle at ${bundleDir}/client.js: run \`bun run build\` first`);
    process.exit(2);
}

// Hop-by-hop and body-framing headers: fetch() has already decoded the body.
const DROP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

Bun.serve({
    port,
    async fetch(req) {
        const url = new URL(req.url);

        if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            return new Response('Sockets do not go through this server: open the page with ?server= (and ?gateway=).', { status: 400 });
        }

        if ((url.pathname === '/bot' || url.pathname === '/bot/' || url.pathname === '/') && !url.searchParams.has('server')) {
            url.searchParams.set('server', world.host);
            if (gateway && !url.searchParams.has('gateway')) {
                url.searchParams.set('gateway', gateway);
            }
            return Response.redirect(url.toString(), 302);
        }

        const local = url.pathname.match(/^\/bot\/([A-Za-z0-9_.-]+)$/);
        if (local) {
            const file = path.join(bundleDir, local[1]);
            if (fs.existsSync(file)) {
                return new Response(Bun.file(file), { headers: { 'Cache-Control': 'no-store' } });
            }
        }

        const headers = new Headers(req.headers);
        headers.delete('host');
        headers.delete('accept-encoding');
        const upstream = await fetch(new URL(url.pathname + url.search, world), {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
            redirect: 'manual'
        });
        const out = new Headers();
        upstream.headers.forEach((value, key) => {
            if (!DROP_RESPONSE.has(key.toLowerCase())) {
                out.set(key, value);
            }
        });
        return new Response(upstream.body, { status: upstream.status, headers: out });
    }
});

console.log(`[proxy] http://localhost:${port}/bot -> ${world.origin} (bundle from ${bundleDir}${gateway ? `, overlay gateway ${gateway}` : ''})`);
