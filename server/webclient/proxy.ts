// Serve this webclient build in front of a remote world.
//
//   bun run proxy --world=https://rs-sdk-demo.fly.dev [--port=8899] [--gateway=ws://127.0.0.1:7780]
//                 [--bots-dir=../../bots] [--insecure-query-login]
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
//
// Login. The page logs in with a one-time token, never a password in its URL
// (login-token.ts): POST /bot/login-token mints one for an account whose
// bot.env sits at <bots-dir>/<account>/bot.env (mode 600), and the page opened
// at /bot?bot=NAME&token=T redeems it at POST /bot/login. A request carrying
// ?password= is refused unless --insecure-query-login is given, which is
// allowed only for a loopback world (the local lab). Neither ?token= nor
// ?password= is ever forwarded to the world.

import fs from 'fs';
import path from 'path';
import { LoginError, LoginTokens, isLoopbackAddress, proofMatches, readBotCredentials } from './login-token';

export interface ProxyOptions {
    world: URL;
    gateway: string | null;
    bundleDir: string;
    botsDir: string;
    insecureQueryLogin: boolean;
    tokens?: LoginTokens;
    upstreamFetch?: (url: URL, init: RequestInit) => Promise<Response>;
}

export interface PeerAddress {
    requestIP(req: Request): { address: string } | null;
}

// Hop-by-hop and body-framing headers: fetch() has already decoded the body.
const DROP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);
/** Login secrets the world never sees. */
const PRIVATE_PARAMS = ['token', 'password'];

export function isLoopbackWorld(world: URL): boolean {
    return world.hostname === 'localhost' || isLoopbackAddress(world.hostname.replace(/^\[|\]$/g, ''));
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
    // A JSON content type keeps these out of reach of a cross-origin "simple" POST.
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        throw new LoginError(415, 'expected Content-Type: application/json');
    }
    try {
        const body = await req.json();
        if (body && typeof body === 'object') return body as Record<string, unknown>;
    } catch {}
    throw new LoginError(400, 'expected a JSON object');
}

export function createProxyHandler(opts: ProxyOptions): (req: Request, peer: PeerAddress) => Promise<Response> {
    const tokens = opts.tokens ?? new LoginTokens();
    const upstreamFetch = opts.upstreamFetch ?? ((url, init) => fetch(url, init));

    async function login(req: Request, peer: PeerAddress, route: 'mint' | 'redeem'): Promise<Response> {
        if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
        if (!isLoopbackAddress(peer.requestIP(req)?.address)) return json({ error: 'loopback clients only' }, 403);
        try {
            const body = await readJson(req);
            const account = typeof body.bot === 'string' ? body.bot : '';
            if (route === 'mint') {
                const creds = readBotCredentials(opts.botsDir, account);
                if (typeof body.proof !== 'string' || !proofMatches(creds, body.proof)) {
                    return json({ error: 'proof does not match this account\'s bot.env' }, 403);
                }
                return json({ token: tokens.mint(account) });
            }
            const outcome = typeof body.token === 'string' ? tokens.redeem(body.token, account) : 'unknown';
            if (outcome !== 'ok') return json({ error: `login token ${outcome}` }, 403);
            const creds = readBotCredentials(opts.botsDir, account);
            return json({ bot: creds.username, password: creds.password });
        } catch (err) {
            if (err instanceof LoginError) return json({ error: err.message }, err.status);
            throw err;
        }
    }

    return async (req, peer) => {
        const url = new URL(req.url);

        if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            return new Response('Sockets do not go through this server: open the page with ?server= (and ?gateway=).', { status: 400 });
        }

        if (url.pathname === '/bot/login-token') return login(req, peer, 'mint');
        if (url.pathname === '/bot/login') return login(req, peer, 'redeem');

        if (url.searchParams.has('password') && !opts.insecureQueryLogin) {
            return new Response(
                'This page server does not take ?password=: launch with a login token (speedrun/tools/tab-login.ts, session.ts), ' +
                    'or start it with --insecure-query-login for a local lab world.',
                { status: 400 }
            );
        }

        if ((url.pathname === '/bot' || url.pathname === '/bot/' || url.pathname === '/') && !url.searchParams.has('server')) {
            url.searchParams.set('server', opts.world.host);
            if (opts.gateway && !url.searchParams.has('gateway')) {
                url.searchParams.set('gateway', opts.gateway);
            }
            return Response.redirect(url.toString(), 302);
        }

        const local = url.pathname.match(/^\/bot\/([A-Za-z0-9_.-]+)$/);
        if (local) {
            const file = path.join(opts.bundleDir, local[1]!);
            if (fs.existsSync(file)) {
                return new Response(Bun.file(file), { headers: { 'Cache-Control': 'no-store' } });
            }
        }

        const upstreamUrl = new URL(url.pathname + url.search, opts.world);
        for (const p of PRIVATE_PARAMS) upstreamUrl.searchParams.delete(p);
        const headers = new Headers(req.headers);
        headers.delete('host');
        headers.delete('accept-encoding');
        headers.delete('referer');
        const upstream = await upstreamFetch(upstreamUrl, {
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
    };
}

if (import.meta.main) {
    const args = Object.fromEntries(
        process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
            const [k, ...v] = a.slice(2).split('=');
            return [k, v.join('=')];
        })
    );

    if (!args.world) {
        console.error('usage: bun run proxy --world=https://host [--port=8899] [--gateway=ws://127.0.0.1:7780] [--bots-dir=DIR] [--insecure-query-login]');
        process.exit(2);
    }
    const world = new URL(args.world);
    const port = Number(args.port || 8899);
    const bundleDir = path.resolve(import.meta.dir, 'out/bot');
    const botsDir = path.resolve(args['bots-dir'] || path.join(import.meta.dir, '..', '..', 'bots'));
    const insecureQueryLogin = 'insecure-query-login' in args;

    if (insecureQueryLogin && !isLoopbackWorld(world)) {
        console.error(`--insecure-query-login is for a local lab world only, not ${world.host}`);
        process.exit(2);
    }
    if (!fs.existsSync(path.join(bundleDir, 'client.js'))) {
        console.error(`no bundle at ${bundleDir}/client.js: run \`bun run build\` first`);
        process.exit(2);
    }

    const handler = createProxyHandler({ world, gateway: args.gateway || null, bundleDir, botsDir, insecureQueryLogin });
    Bun.serve({ port, fetch: (req, server) => handler(req, server) });

    console.log(
        `[proxy] http://localhost:${port}/bot -> ${world.origin} (bundle from ${bundleDir}${args.gateway ? `, overlay gateway ${args.gateway}` : ''}; ` +
            `login tokens for ${botsDir}/<account>/bot.env${insecureQueryLogin ? '; INSECURE ?password= logins allowed' : ''})`
    );
}
