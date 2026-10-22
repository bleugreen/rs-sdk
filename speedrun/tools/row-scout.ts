// A dropped Firemaking row's scout, read-only: before the droppers' cue, attach to armed droppers'
// loopback gateways in observe mode (sdk connectionMode 'observe': no actions, no takeover of the
// fm-row role's own control session) and report what their published state shows on the planned
// tiles. Each dropper sees about 15 tiles around it, so the first dropper (at the row's entry) and
// one standing near the far end of the lap cover the whole row.
//
// What blocks (a finding, no cue): a loc on a planned tile (a fire, or any other: firemaking.rs2's
// area_allow_loc_add refuses a fire on a tile holding a loc), and a log on a planned tile (the
// lighter and fm-row both read a log on a planned tile as part of the row, and a stranger's log
// there is one the route doesn't own). What doesn't: any other ground item (coins, bones, ashes;
// ground objs don't stop a drop or a light, and lap 2 relights every tile on top of lap 1's ashes)
// and players standing on a tile. Those are reported, not refused.
//
//   bun speedrun/tools/row-scout.ts --tiles=<firemaking tile list> --bots-dir=<dir> <account>@<gateway port> ...
//
// Exit 0: every planned tile was seen and nothing blocks. 3: a blocking finding, or a tile no
// dropper saw. 2: usage or connection error. Credentials come from <bots-dir>/<account>/bot.env and
// are never printed.

import { readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { parseBotEnv } from '../helpers/accounts';
import { parseTiles, tierOf } from '../skills/firemaking';

export const VIEW = 15;

export interface RowLook {
    /** Planned tiles within this view. */
    seen: string[];
    /** Blocking: a loc or a log on a planned tile. */
    findings: string[];
    /** Not blocking: other ground items on a planned tile. */
    notes: string[];
    /** Players standing on planned tiles, by name. */
    players: Map<string, string[]>;
}

const at = (x: number, z: number) => `${x},${z}`;
const isLog = (name: string) => tierOf(name) !== undefined || /\blogs?$/i.test(name.trim());

/** What one dropper's published state shows on the planned tiles. */
export function lookAtRow(s: Pick<BotWorldState, 'player' | 'nearbyLocs' | 'groundItems' | 'nearbyPlayers'>, tiles: readonly (readonly [number, number])[], by: string): RowLook {
    const planned = new Set(tiles.map(([x, z]) => at(x, z)));
    const px = s.player!.worldX;
    const pz = s.player!.worldZ;
    const out: RowLook = { seen: [], findings: [], notes: [], players: new Map() };
    for (const [x, z] of tiles) if (Math.max(Math.abs(x - px), Math.abs(z - pz)) <= VIEW) out.seen.push(at(x, z));
    for (const l of s.nearbyLocs) if (planned.has(at(l.x, l.z))) out.findings.push(`loc ${l.name} on ${at(l.x, l.z)}, seen by ${by}`);
    for (const g of s.groundItems) {
        if (!planned.has(at(g.x, g.z))) continue;
        (isLog(g.name) ? out.findings : out.notes).push(`${g.count} ${g.name} on ${at(g.x, g.z)}, seen by ${by}`);
    }
    for (const p of s.nearbyPlayers) if (planned.has(at(p.x, p.z))) out.players.set(p.name, [...(out.players.get(p.name) ?? []), at(p.x, p.z)]);
    return out;
}

async function look(botsDir: string, account: string, port: number): Promise<BotWorldState> {
    const env = parseBotEnv(readFileSync(join(botsDir, account, 'bot.env'), 'utf8'));
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

if (import.meta.main) {
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

    const tiles = parseTiles(tilesSpec);
    const seen = new Set<string>();
    const findings: string[] = [];
    const notes: string[] = [];
    const players = new Map<string, Set<string>>();
    for (const { account, port } of targets) {
        let s: BotWorldState;
        try {
            s = await look(botsDir, account, port);
        } catch (e) {
            console.error(`[row-scout] ${account}@${port}: ${(e as Error).message}`);
            process.exit(2);
        }
        const r = lookAtRow(s, tiles, account);
        for (const t of r.seen) seen.add(t);
        findings.push(...r.findings);
        notes.push(...r.notes);
        for (const [name, on] of r.players) for (const t of on) players.set(name, (players.get(name) ?? new Set()).add(t));
        console.log(`[row-scout] ${account} at ${s.player!.worldX},${s.player!.worldZ} tick ${s.tick}: ${r.seen.length} planned tiles in view, ${s.nearbyLocs.length} locs, ${s.groundItems.length} ground items, ${s.nearbyPlayers.length} players`);
    }
    const unseen = tiles.map(([x, z]) => at(x, z)).filter(t => !seen.has(t));
    if (unseen.length) findings.push(`${unseen.length} planned tiles not in any view: ${unseen.join(' ')}`);
    for (const [name, on] of players) console.log(`[row-scout] player ${name} standing on ${[...on].join(' ')}`);
    for (const n of [...new Set(notes)]) console.log(`[row-scout] note (doesn't block): ${n}`);
    for (const f of [...new Set(findings)]) console.log(`[row-scout] FINDING: ${f}`);
    console.log(`[row-scout] ${findings.length ? 'NOT CLEAR' : 'clear'}: ${seen.size}/${tiles.length} planned tiles seen`);
    process.exit(findings.length ? 3 : 0);
}
