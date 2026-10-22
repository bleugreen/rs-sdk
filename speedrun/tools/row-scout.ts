// A dropped Firemaking row's scout, read-only: before the droppers' cue, attach to armed droppers'
// loopback gateways in observe mode (sdk connectionMode 'observe': no actions, no takeover of the
// fm-row role's own control session) and report what their published state shows on the planned
// tiles: fires, ground items and players standing on them. Each dropper sees about 15 tiles
// around it, so the first dropper (at the row's entry) and one standing near the far end of the
// lap cover the whole row. A planned tile with a fire or a log on it costs a log the route can't
// spare above willow (157 logs leave 3,332 xp over 99), so any finding is a reason not to cue.
//
//   bun speedrun/tools/row-scout.ts --tiles=<firemaking tile list> --bots-dir=<dir> <account>@<gateway port> ...
//
// Exit 0: every planned tile was seen and is clear (players on a tile are reported, not refused;
// they don't stop a drop or a light). 3: a fire or ground item on a planned tile, or a tile no
// dropper saw. 2: usage or connection error. Credentials come from <bots-dir>/<account>/bot.env and
// are never printed.

import { readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { parseBotEnv } from '../helpers/accounts';
import { parseTiles } from '../skills/firemaking';

const argv = process.argv.slice(2);
const flag = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const tilesSpec = flag('tiles');
const botsDir = flag('bots-dir');
const targets = argv.filter(a => !a.startsWith('--')).map(a => {
    const [account, port] = a.split('@');
    return { account: account!, port: Number(port) };
});
if (!tilesSpec || !botsDir || targets.length === 0 || targets.some(t => !t.account || !Number.isInteger(t.port))) {
    console.error('usage: bun speedrun/tools/row-scout.ts --tiles=<list> --bots-dir=<dir> <account>@<gateway port> ...');
    process.exit(2);
}

const VIEW = 15;
const FIRE = /fire/i;
const tiles = parseTiles(tilesSpec);
const at = (x: number, z: number) => `${x},${z}`;
const planned = new Set(tiles.map(([x, z]) => at(x, z)));
const seen = new Set<string>();
const findings: string[] = [];
const players = new Map<string, Set<string>>();

async function look(account: string, port: number): Promise<BotWorldState> {
    const env = parseBotEnv(readFileSync(join(botsDir!, account, 'bot.env'), 'utf8'));
    const sdk = new BotSDK({ botUsername: account, password: env.PASSWORD ?? '', gatewayUrl: `ws://127.0.0.1:${port}`, connectionMode: 'observe', autoLaunchBrowser: false, autoReconnect: false, readyTimeout: 15_000, showChat: false });
    try {
        await sdk.connect();
        const s = sdk.getState();
        if (!s?.player) throw new Error('no published state');
        return s;
    } finally {
        await sdk.disconnect().catch(() => {});
    }
}

for (const { account, port } of targets) {
    let s: BotWorldState;
    try {
        s = await look(account, port);
    } catch (e) {
        console.error(`[row-scout] ${account}@${port}: ${(e as Error).message}`);
        process.exit(2);
    }
    const px = s.player!.worldX;
    const pz = s.player!.worldZ;
    let n = 0;
    for (const [x, z] of tiles) {
        if (Math.max(Math.abs(x - px), Math.abs(z - pz)) > VIEW) continue;
        seen.add(at(x, z));
        n++;
    }
    for (const l of s.nearbyLocs) if (planned.has(at(l.x, l.z)) && FIRE.test(l.name)) findings.push(`fire (${l.name}) on ${at(l.x, l.z)}, seen by ${account}`);
    for (const g of s.groundItems) if (planned.has(at(g.x, g.z))) findings.push(`${g.count} ${g.name} on ${at(g.x, g.z)}, seen by ${account}`);
    for (const p of s.nearbyPlayers) if (planned.has(at(p.x, p.z))) players.set(p.name, (players.get(p.name) ?? new Set()).add(at(p.x, p.z)));
    console.log(`[row-scout] ${account} at ${at(px, pz)} tick ${s.tick}: ${n} planned tiles in view, ${s.nearbyLocs.length} locs, ${s.groundItems.length} ground items, ${s.nearbyPlayers.length} players`);
}

const unseen = [...planned].filter(t => !seen.has(t));
if (unseen.length) findings.push(`${unseen.length} planned tiles not in any view: ${unseen.join(' ')}`);
for (const [name, at] of players) console.log(`[row-scout] player ${name} standing on ${[...at].join(' ')}`);
for (const f of findings) console.log(`[row-scout] FINDING: ${f}`);
console.log(`[row-scout] ${findings.length ? 'NOT CLEAR' : 'clear'}: ${seen.size}/${planned.size} planned tiles seen`);
process.exit(findings.length ? 3 : 0);
