#!/usr/bin/env bun
// Passive in-game observer: tours training hotspots on one throwaway account
// and logs every nearby player (name, combat level, tile, animation, worn
// items) plus public chat, without ever interacting with anyone.
//
//   bun speedrun/tools/observe.ts [--bot cairn_obs1] [--spots draynor,catherby_fishing|all|here]
//       [--dwell-sec 180] [--sample-ticks 2] [--max-min 95] [--out DIR] [--watch a,b] [--no-hiscores]
//   bun speedrun/tools/observe.ts positions [--match REGEX] [--every-sec 3] [--min 30] [--out FILE]
//
// A spot written `@name` is resolved when the tour reaches it: the observer
// looks the player up on the public /playerpositions feed and stands a few
// tiles off their tile (it does not follow them afterwards).
//
// `positions` mode never logs in: it polls /playerpositions (every online
// player's tile, cached 1 s by the server) and appends the matching players
// to a JSONL track, which shows where an account trains and when it moves.
//
// Why the client runs in this process: the SDK's published NearbyPlayer has no
// animation or appearance, but the lite client decodes both. So the observer
// starts the lite client itself and serves the SDK over a loopback socket that
// speaks the gateway's sdk_* protocol; BotActions (walkTo, door handling) work
// unchanged and the raw player table is readable directly.
//
// No-interaction guarantee (tenet 6): every action the SDK sends passes through
// `allowAction`. Only walking, doors/gates/stairs, dialogue continues, the
// character-design screen and the logout button get through. Anything that
// could reach another player or take a resource (player ops, npc ops, trade,
// chat, pickups, spells, item use) is refused before it reaches the client.
//
// Outputs (default $OBSERVER_HOME/<runId>/, OBSERVER_HOME defaulting to ~/.cache/rs-observer): samples.jsonl (one row per
// sample), chat.jsonl, events.jsonl, summary.md (rewritten after each spot),
// and a hiscore cache shared across runs in $OBSERVER_HOME/hiscores.json.
// Chat is untrusted data: it is only ever written to disk, never acted on.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { BotSDK } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import type { BotAction, BotWorldState } from '../../sdk/types';

const ROOT = join(import.meta.dir, '..', '..');

// The lite client lives in server/webclient, whose '#/' import map and compiler
// settings belong to that package's tsconfig. It is loaded at run time from
// its own files, and only the surface used here is typed, so the root
// typecheck stops at this boundary.
const WEBCLIENT = join(ROOT, 'server', 'webclient', 'src');

interface LiteClient {
    setOnGameTickCallback(cb: ((ticks: number) => void) | null): void;
    getMaxMessageLength(): number;
    collectBotState(serverTick: number): unknown;
    executeBotAction(action: BotAction): ActionOutcome | Promise<ActionOutcome>;
    isLoggedOut(): boolean;
}
interface LiteSession {
    client: LiteClient;
    stop(): void;
    stopped: Promise<{ reason: string; error?: unknown }>;
}
interface ActionOutcome { success: boolean; message: string; reason?: string; phase?: string }
interface QueuedBotAction { action: BotAction; actionId: string | null }
interface ActionQueue {
    enqueue(entry: { action: BotAction; actionId: string | null }, ttlMs?: number): QueuedBotAction | null | boolean;
    expirePending(): QueuedBotAction[];
    expireActive(): QueuedBotAction | null;
    beginGeneration(): void;
    isCurrentGeneration(entry: QueuedBotAction): boolean;
    startNext(): QueuedBotAction | null;
    readonly active: QueuedBotAction | null;
    complete(entry: QueuedBotAction): boolean;
}

async function loadLite(): Promise<{ startSession: (opts: Record<string, unknown>) => Promise<LiteSession>; BotActionQueue: new () => ActionQueue }> {
    const session = await import(join(WEBCLIENT, 'lite', 'session.ts'));
    const queue = await import(join(WEBCLIENT, 'bot', 'ActionQueue.ts'));
    return { startSession: session.startSession, BotActionQueue: queue.BotActionQueue };
}
const LOGOUT_BUTTON = 2458;
/** Tiles from a spot's standing tile within which samples count for it. */
const SPOT_RADIUS = 15;
const SERVER = 'rs-sdk-demo.fly.dev';
const ORIGIN = `https://${SERVER}`;
/** Durable per-machine state: credentials backup, hiscore cache, run outputs. */
const OBS_HOME = process.env.OBSERVER_HOME ?? join(homedir(), '.cache', 'rs-observer');

// ------------------------------------------------------------------ hotspots

export interface Spot {
    name: string;
    /** Standing tile: off resources and off agility obstacles. */
    x: number;
    z: number;
    what: string;
}

/** Tour order: east (Draynor, Falador, Varrock, Al Kharid), then west (Catherby, Seers', Ardougne, Gnome, Barbarian). */
export const SPOTS: Spot[] = [
    { name: 'draynor', x: 3090, z: 3241, what: 'Draynor bank + willows' },
    { name: 'falador_east_bank', x: 3013, z: 3361, what: 'Falador east bank' },
    { name: 'mining_guild_entrance', x: 3023, z: 3336, what: 'Mining Guild / dwarven mine entrance (surface)' },
    { name: 'falador_west_bank', x: 2946, z: 3374, what: 'Falador west bank' },
    { name: 'barbarian_fishing', x: 3100, z: 3428, what: 'Barbarian Village fly fishing' },
    { name: 'edgeville_bank', x: 3088, z: 3494, what: 'Edgeville bank (yews, wilderness edge)' },
    { name: 'varrock_west_bank', x: 3183, z: 3431, what: 'Varrock west bank / Grand Exchange' },
    { name: 'varrock_sw_mine', x: 3181, z: 3376, what: 'Varrock south-west mine' },
    { name: 'aubury', x: 3256, z: 3398, what: 'Aubury rune shop (essence teleport)' },
    { name: 'varrock_east_bank', x: 3253, z: 3428, what: 'Varrock east bank' },
    { name: 'varrock_se_mine', x: 3290, z: 3375, what: 'Varrock south-east mine' },
    { name: 'alkharid_mine', x: 3293, z: 3305, what: 'Al Kharid mine' },
    { name: 'alkharid_bank', x: 3274, z: 3172, what: 'Al Kharid bank + furnace' },
    { name: 'taverley', x: 2895, z: 3440, what: 'Taverley' },
    { name: 'catherby_fishing', x: 2840, z: 3435, what: 'Catherby shore fishing' },
    { name: 'catherby_bank', x: 2809, z: 3436, what: 'Catherby bank' },
    { name: 'seers_bank', x: 2725, z: 3484, what: "Seers' Village bank" },
    { name: 'seers_magic', x: 2700, z: 3405, what: "Magic trees south of Seers'" },
    { name: 'fishing_guild', x: 2611, z: 3388, what: 'Fishing Guild gate (outside)' },
    { name: 'ardougne_market', x: 2662, z: 3308, what: 'East Ardougne market (stalls, knights)' },
    { name: 'ardougne_north_bank', x: 2616, z: 3328, what: 'East Ardougne north bank' },
    { name: 'gnome_agility', x: 2484, z: 3440, what: 'Gnome Stronghold agility course' },
    { name: 'barbarian_agility', x: 2550, z: 3562, what: 'Barbarian Outpost agility course' },
];

// ------------------------------------------------------------------ allowlist

const PASSABLE_LOC = /door|gate|stair|ladder|trapdoor|archway|curtain/i;

/**
 * The no-interaction guard. Pure: decides from the action and the latest state.
 * Returns null to allow, or the refusal reason.
 */
export function allowAction(action: BotAction, state: BotWorldState | null): string | null {
    switch (action.type) {
        case 'none':
        case 'wait':
        case 'walkTo':
        case 'scanNearbyLocs':
        case 'scanGroundItems':
        case 'clickDialogOption':
        case 'closeModal':
        case 'setTab':
        case 'acceptCharacterDesign':
        case 'randomizeCharacterDesign':
            return null;
        case 'clickComponent':
            return action.componentId === LOGOUT_BUTTON ? null : `component ${action.componentId} is not the logout button`;
        case 'talkToNpc':
        case 'interactNpc': {
            // Only the tutorial guide, to skip the tutorial on first login.
            const npc = state?.nearbyNpcs.find(n => n.index === action.npcIndex);
            return npc && /runescape guide|tutorial/i.test(npc.name) ? null : `npc ${npc?.name ?? action.npcIndex} is not the tutorial guide`;
        }
        case 'interactLoc': {
            const loc = state?.nearbyLocs.find(l => l.x === action.x && l.z === action.z && l.id === action.locId);
            if (!loc) return `loc ${action.locId} at (${action.x},${action.z}) is not a known passage`;
            return PASSABLE_LOC.test(loc.name) ? null : `loc '${loc.name}' is not a door, gate or stair`;
        }
        default:
            return `action '${action.type}' is never sent by the observer`;
    }
}

// ------------------------------------------------------------------ credentials

function randomString(n: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function parseEnv(text: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return env;
}

/**
 * bots/<bot>/bot.env is gitignored. Build slots are recreated from git, so a
 * copy also lives in $OBSERVER_HOME/<bot>.env on the machine, which keeps
 * the throwaway's password stable across slots.
 */
function loadOrCreateEnv(bot: string): { username: string; password: string } {
    const slotPath = join(ROOT, 'bots', bot, 'bot.env');
    const homePath = join(OBS_HOME, `${bot}.env`);
    let text: string | null = null;
    if (existsSync(slotPath)) text = readFileSync(slotPath, 'utf-8');
    else if (existsSync(homePath)) text = readFileSync(homePath, 'utf-8');
    if (!text) {
        text = `BOT_USERNAME=${bot}\nPASSWORD=${randomString(12)}\nSERVER=${SERVER}\nSHOW_CHAT=true\nTELEMETRY=false\n`;
        console.log(`[observe] created credentials for ${bot}`);
    }
    for (const p of [slotPath, homePath]) {
        if (!existsSync(p)) {
            mkdirSync(join(p, '..'), { recursive: true });
            writeFileSync(p, text, { mode: 0o600 });
        }
    }
    const env = parseEnv(text);
    if (!env.BOT_USERNAME || !env.PASSWORD) throw new Error(`bad env for ${bot}`);
    return { username: env.BOT_USERNAME, password: env.PASSWORD };
}

// ------------------------------------------------------------------ name tables

function loadPackNames(file: string): Map<number, string> {
    const map = new Map<number, string>();
    const path = join(ROOT, 'server', 'content', 'pack', file);
    if (!existsSync(path)) return map;
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) map.set(Number(line.slice(0, eq)), line.slice(eq + 1).trim());
    }
    return map;
}

const SEQ = loadPackNames('seq.pack');
const OBJ = loadPackNames('obj.pack');
const SLOT_NAMES = ['head', 'cape', 'neck', 'weapon', 'body', 'shield', 'arms', 'legs', 'hair', 'hands', 'feet', 'jaw'];

/** Activity guessed from an animation name (seq.pack debug names). */
export function activityOf(anim: string | null): string | null {
    if (!anim) return null;
    const rules: [RegExp, string][] = [
        [/mining|pickaxe/, 'mining'],
        [/woodcutting|axe_chop$|human_axe_hack/, 'woodcutting'],
        [/harpoon|lobster|largenet|smallnet|fishing_casting|fish_onspot/, 'fishing'],
        [/pickpocket|steal/, 'thieving'],
        [/runecraft/, 'runecraft'],
        [/cooking|firecooking/, 'cooking'],
        [/smithing|anvil/, 'smithing'],
        [/createfire/, 'firemaking'],
        [/herbing/, 'herblore'],
        [/spinningwheel|crafting|human_craft/, 'crafting'],
        [/fletch|knife/, 'fletching'],
        [/pray/, 'prayer'],
        [/cast|casting|teleport/, 'magic'],
        [/logbalance|ropeswing|pipesqueeze|climbing|crawling|steppingstone|longjump|spot_jump|crumbledwall|stumble/, 'agility'],
        [/bow|crossbow|dart|throw/, 'ranged'],
        [/pickup/, 'pickup'],
    ];
    for (const [re, label] of rules) if (re.test(anim)) return label;
    return null;
}

// ------------------------------------------------------------------ hiscores

export interface HiscoreSkill { skill: string; rank: string; level: string; ticks: number }
export interface HiscoreEntry { name: string; fetchedAt: string; found: boolean; skills: HiscoreSkill[] }

export function parseHiscorePage(name: string, html: string): HiscoreEntry {
    const skills: HiscoreSkill[] = [];
    const re = />([A-Za-z ]+)<\/a><\/td>\s*<td align="right">([^<]*)<\/td>\s*<td align="right">([^<]*)<\/td>\s*<td align="right"><span title="([\d,]+) ticks"/g;
    for (const m of html.matchAll(re)) {
        skills.push({ skill: m[1]!.trim(), rank: m[2]!.trim(), level: m[3]!.trim(), ticks: Number(m[4]!.replace(/,/g, '')) });
    }
    return { name, fetchedAt: new Date().toISOString(), found: skills.length > 0, skills };
}

class Hiscores {
    private cache: Record<string, HiscoreEntry> = {};
    private queue: string[] = [];
    private busy = false;
    constructor(private path: string, private enabled: boolean) {
        if (existsSync(path)) this.cache = JSON.parse(readFileSync(path, 'utf-8'));
    }
    get(name: string): HiscoreEntry | undefined {
        return this.cache[name.toLowerCase()];
    }
    /** Queue a lookup; refreshes entries older than 30 minutes. One request at a time, 1 s apart. */
    want(name: string): void {
        if (!this.enabled) return;
        const key = name.toLowerCase();
        const have = this.cache[key];
        if (have && Date.now() - Date.parse(have.fetchedAt) < 30 * 60_000) return;
        if (this.queue.includes(key)) return;
        this.queue.push(key);
        void this.drain();
    }
    private async drain(): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        try {
            while (this.queue.length) {
                const key = this.queue.shift()!;
                try {
                    const res = await fetch(`${ORIGIN}/hiscores/player/${encodeURIComponent(key)}?profile=main`, { signal: AbortSignal.timeout(10_000) });
                    this.cache[key] = parseHiscorePage(key, await res.text());
                    writeFileSync(this.path, JSON.stringify(this.cache));
                } catch (e) {
                    console.warn(`[observe] hiscore ${key}: ${e}`);
                }
                await Bun.sleep(1000);
            }
        } finally {
            this.busy = false;
        }
    }
}

export function hiscoreBrief(h: HiscoreEntry | undefined): string {
    if (!h) return '?';
    if (!h.found) return 'unranked';
    const overall = h.skills.find(s => s.skill === 'Overall');
    const top = h.skills
        .filter(s => s.skill !== 'Overall' && s.skill !== 'Quest Points' && Number(s.level) >= 60)
        .sort((a, b) => Number(b.level) - Number(a.level))
        .slice(0, 6)
        .map(s => `${s.skill} ${s.level}@${s.ticks}t`);
    return `total ${overall?.level ?? '?'} (${overall?.ticks ?? '?'}t)${top.length ? '; ' + top.join(', ') : ''}`;
}

// ------------------------------------------------------------------ positions feed

export interface Position { name: string; x: number; z: number; level: number }

export async function fetchPositions(): Promise<Position[]> {
    const res = await fetch(`${ORIGIN}/playerpositions`, { signal: AbortSignal.timeout(10_000) });
    const body: any = await res.json();
    return (Array.isArray(body) ? body : body.players ?? []) as Position[];
}

export const DEFAULT_TARGETS = '^(stun|nick|asukalabs|zaynelab|zayne|soko|claudefable|codexastra|gh_kadeski)';

/** Poll /playerpositions and append matching players as one JSONL row per poll. */
async function trackPositions(): Promise<void> {
    const re = new RegExp(arg('match', DEFAULT_TARGETS)!, 'i');
    const everyMs = Number(arg('every-sec', '3')) * 1000;
    const until = Date.now() + Number(arg('min', '30')) * 60_000;
    const out = arg('out', join(OBS_HOME, `positions-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.jsonl`))!;
    mkdirSync(join(out, '..'), { recursive: true });
    console.log(`[positions] ${re} every ${everyMs} ms -> ${out}`);
    while (Date.now() < until) {
        try {
            const all = await fetchPositions();
            const hit = all.filter(p => re.test(p.name));
            appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), online: all.length, players: hit }) + '\n');
        } catch (e) {
            appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), error: String(e) }) + '\n');
        }
        await Bun.sleep(everyMs);
    }
}

// ------------------------------------------------------------------ loopback gateway

/**
 * Serves one SDK over ws://127.0.0.1 with the gateway's sdk_* messages, driving
 * the in-process lite client the way the lite runner does (BotActionQueue,
 * one action per 20 ms pump, state published once per decoded tick).
 */
class LoopbackGateway {
    private queue: ActionQueue;
    private waitTicks = 0;
    private socket: import('bun').ServerWebSocket<unknown> | null = null;
    private pumpTimer: ReturnType<typeof setInterval>;
    private server: import('bun').Server;
    serverTick = 0;
    lastState: BotWorldState | null = null;
    refused: { at: string; type: string; reason: string }[] = [];

    constructor(private client: LiteClient, Queue: new () => ActionQueue, private onTick: (tick: number) => void) {
        this.queue = new Queue();
        client.setOnGameTickCallback(ticks => {
            this.serverTick += ticks;
            this.publish();
            try {
                this.onTick(this.serverTick);
            } catch (e) {
                console.error('[observe] tick handler:', e);
            }
        });
        this.pumpTimer = setInterval(() => this.pump(), 20);
        const self = this;
        this.server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch(req, srv) {
                if (srv.upgrade(req)) return undefined;
                return new Response('loopback gateway', { status: 400 });
            },
            websocket: {
                message(ws, data) {
                    self.onMessage(ws, String(data));
                },
                close(ws) {
                    if (self.socket === ws) self.socket = null;
                },
            },
        });
    }

    get url(): string {
        return `ws://127.0.0.1:${this.server.port}`;
    }

    stop(): void {
        clearInterval(this.pumpTimer);
        this.server.stop(true);
    }

    private onMessage(ws: import('bun').ServerWebSocket<unknown>, raw: string): void {
        let msg: any;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }
        if (msg.type === 'sdk_connect') {
            this.socket = ws;
            this.queue.beginGeneration();
            ws.send(JSON.stringify({ type: 'sdk_connected', maxMessageLength: this.client.getMaxMessageLength() }));
            this.publish();
        } else if (msg.type === 'sdk_action') {
            const action = msg.action as BotAction;
            const refusal = allowAction(action, this.lastState);
            if (refusal) {
                this.refused.push({ at: new Date().toISOString(), type: action.type, reason: refusal });
                console.warn(`[observe] refused ${action.type}: ${refusal}`);
                this.result(msg.actionId, { success: false, message: `observer refused: ${refusal}`, reason: 'refused', phase: 'validation' });
                return;
            }
            const ttl = typeof msg.actionTimeoutMs === 'number' ? Math.max(0, msg.actionTimeoutMs - 1000) : undefined;
            if (!this.queue.enqueue({ action, actionId: msg.actionId ?? null }, ttl)) {
                this.result(msg.actionId, { success: false, message: 'Action queue is full', reason: 'busy', phase: 'validation' });
            }
        }
    }

    private result(actionId: string | null, result: unknown): void {
        if (actionId && this.socket) this.socket.send(JSON.stringify({ type: 'sdk_action_result', actionId, result }));
    }

    private publish(): void {
        const state = this.client.collectBotState(this.serverTick) as unknown as BotWorldState | null;
        if (!state) return;
        this.lastState = state;
        this.socket?.send(JSON.stringify({ type: 'sdk_state', state, stateReceivedAt: Date.now() }));
    }

    private pump(): void {
        for (const expired of this.queue.expirePending()) {
            this.result(expired.actionId, { success: false, message: `expired: ${expired.action.type}`, reason: 'queue_expired', phase: 'validation' });
        }
        const activeExpired = this.queue.expireActive();
        if (activeExpired && this.queue.isCurrentGeneration(activeExpired)) {
            this.result(activeExpired.actionId, { success: false, message: `expired while active: ${activeExpired.action.type}`, reason: 'queue_expired', phase: 'completion' });
        }
        if (this.waitTicks > 0) {
            this.waitTicks--;
            const active = this.queue.active;
            if (this.waitTicks === 0 && active) this.finish(active, { success: true, message: 'Wait complete', phase: 'completion' });
            return;
        }
        if (this.queue.active) return;
        const queued = this.queue.startNext();
        if (!queued) return;
        const out = this.client.executeBotAction(queued.action);
        if (out instanceof Promise) {
            out.then(r => this.finish(queued, r)).catch(e => this.finish(queued, { success: false, message: `Error: ${e}`, reason: 'execution_error', phase: 'completion' }));
            return;
        }
        if (queued.action.type === 'wait' && out.success) {
            this.waitTicks = (queued.action as any).ticks || 1;
            return;
        }
        this.finish(queued, out);
    }

    private finish(entry: QueuedBotAction, result: unknown): void {
        if (this.queue.active !== entry) return;
        const current = this.queue.isCurrentGeneration(entry);
        this.queue.complete(entry);
        if (current) {
            this.result(entry.actionId, result);
            this.publish();
        }
    }
}

// ------------------------------------------------------------------ sampling

export interface PlayerSample {
    name: string;
    cb: number;
    /** Appearance skill level (total level in skill areas), when the server sends it. */
    sk: number;
    x: number;
    z: number;
    d: number;
    anim: string | null;
    act: string | null;
    spot: string | null;
    worn: Record<string, string>;
    fight: string | null;
}

function samplePlayers(client: LiteClient, state: BotWorldState | null): PlayerSample[] {
    const c = client as any;
    const me = c.localPlayer;
    if (!me) return [];
    const fights = new Map<string, string>();
    for (const p of state?.nearbyPlayers ?? []) {
        if (p.inCombat && p.combatTargetType && p.combatTargetType !== 'none') {
            const target = p.combatTargetType === 'npc'
                ? state?.nearbyNpcs.find(n => n.index === p.combatTargetIndex)?.name ?? `npc#${p.combatTargetIndex}`
                : `player#${p.combatTargetIndex}`;
            fights.set(p.name, target);
        }
    }
    const out: PlayerSample[] = [];
    for (let i = 0; i < c.playerCount; i++) {
        const p = c.players[c.playerIds[i]];
        if (!p || p === me || !p.name) continue;
        const worn: Record<string, string> = {};
        for (let part = 0; part < 12; part++) {
            const v = p.appearance?.[part] ?? 0;
            if (v >= 512) worn[SLOT_NAMES[part]!] = OBJ.get(v - 512) ?? `obj${v - 512}`;
        }
        const anim = p.primaryAnim >= 0 ? SEQ.get(p.primaryAnim) ?? `seq${p.primaryAnim}` : null;
        const spot = p.spotanimId >= 0 ? `spot${p.spotanimId}` : null;
        out.push({
            name: p.name,
            cb: p.combatLevel || 0,
            sk: p.skillLevel || 0,
            x: c.mapBuildBaseX + (p.x >> 7),
            z: c.mapBuildBaseZ + (p.z >> 7),
            d: Math.max(Math.abs(p.x - me.x), Math.abs(p.z - me.z)) >> 7,
            anim,
            act: activityOf(anim),
            spot,
            worn,
            fight: fights.get(p.name) ?? null,
        });
    }
    return out.sort((a, b) => a.d - b.d);
}

interface Track {
    name: string;
    cb: number;
    sk: number;
    firstTick: number;
    lastTick: number;
    samples: number;
    acts: Record<string, number>;
    anims: Record<string, number>;
    worn: Set<string>;
    tiles: Set<string>;
    fights: Set<string>;
    /** Times it left view while close (d <= 8): a logout or teleport, not a walk-off. */
    vanishedClose: number;
    lastD: number;
    lastXZ: string;
}

class SpotLog {
    tracks = new Map<string, Track>();
    chat: string[] = [];
    startTick = 0;
    endTick = 0;
    startWall = new Date();
    endWall = new Date();
    arrived = true;
    note = '';
    constructor(public spot: Spot) {}

    add(tick: number, samples: PlayerSample[]): void {
        const seen = new Set<string>();
        for (const s of samples) {
            seen.add(s.name);
            let t = this.tracks.get(s.name);
            if (!t) {
                t = { name: s.name, cb: s.cb, sk: s.sk, firstTick: tick, lastTick: tick, samples: 0, acts: {}, anims: {}, worn: new Set(), tiles: new Set(), fights: new Set(), vanishedClose: 0, lastD: s.d, lastXZ: '' };
                this.tracks.set(s.name, t);
            }
            t.lastTick = tick;
            t.samples++;
            t.cb = s.cb;
            t.sk = s.sk;
            if (s.act) t.acts[s.act] = (t.acts[s.act] ?? 0) + 1;
            if (s.anim) t.anims[s.anim] = (t.anims[s.anim] ?? 0) + 1;
            for (const w of Object.values(s.worn)) t.worn.add(w);
            t.tiles.add(`${s.x},${s.z}`);
            if (s.fight) t.fights.add(s.fight);
            t.lastD = s.d;
            t.lastXZ = `${s.x},${s.z}`;
        }
        for (const t of this.tracks.values()) {
            if (!seen.has(t.name) && t.lastTick === this.prevTick && t.lastD <= 8) t.vanishedClose++;
        }
        this.prevTick = tick;
    }
    private prevTick = -1;
}

function topKeys(h: Record<string, number>, n = 3): string {
    return Object.entries(h)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, v]) => `${k}×${v}`)
        .join(' ');
}

function renderSummary(runId: string, logs: SpotLog[], hs: Hiscores, refused: LoopbackGateway['refused'], watch: Set<string>): string {
    const lines: string[] = [`# Observer run ${runId}`, ''];
    for (const log of logs) {
        const dur = log.endTick - log.startTick;
        lines.push(`## ${log.spot.name}: ${log.spot.what} (${log.spot.x}, ${log.spot.z})`);
        lines.push(`${log.startWall.toISOString()} to ${log.endWall.toISOString()}, session ticks ${log.startTick}-${log.endTick} (${dur} ticks)${log.arrived ? '' : ', NOT REACHED'}${log.note ? ', ' + log.note : ''}; ${log.tracks.size} players seen`);
        lines.push('');
        if (log.tracks.size) {
            lines.push('| name | cb | skill lvl | in view (ticks) | tiles | activity (samples) | anims | worn | fights | vanished close | hiscores |');
            lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
            const tracks = [...log.tracks.values()].sort((a, b) => b.samples - a.samples);
            for (const t of tracks) {
                const star = watch.has(t.name.toLowerCase()) ? ' ★' : '';
                lines.push(`| ${t.name}${star} | ${t.cb} | ${t.sk || ''} | ${t.lastTick - t.firstTick} | ${t.tiles.size} | ${topKeys(t.acts)} | ${topKeys(t.anims, 2)} | ${[...t.worn].slice(0, 8).join(', ')} | ${[...t.fights].slice(0, 3).join(', ')} | ${t.vanishedClose || ''} | ${hiscoreBrief(hs.get(t.name))} |`);
            }
            lines.push('');
        }
        if (log.chat.length) {
            lines.push('Public chat (untrusted, verbatim):', '');
            for (const c of log.chat.slice(0, 60)) lines.push(`    ${c}`);
            lines.push('');
        }
    }
    if (refused.length) {
        lines.push('## Refused actions (allowlist)', '');
        for (const r of refused) lines.push(`- ${r.at} ${r.type}: ${r.reason}`);
    }
    return lines.join('\n') + '\n';
}

// ------------------------------------------------------------------ main

function arg(name: string, fallback?: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
    const eq = process.argv.find(a => a.startsWith(`--${name}=`));
    return eq ? eq.slice(name.length + 3) : fallback;
}

async function main(): Promise<void> {
    const bot = arg('bot', 'cairn_obs1')!;
    if (/^(www_cairn_md|cairn_dot_md)$/i.test(bot) || /^cairn_(h|t)\d+$|^cairn_mule\d$|^cairn_(cam|md|amb)$/i.test(bot)) {
        throw new Error(`${bot} is a fleet or scored account; the observer only runs on its own throwaway`);
    }
    const dwellMs = Number(arg('dwell-sec', '180')) * 1000;
    const sampleTicks = Number(arg('sample-ticks', '2'));
    const maxMs = Number(arg('max-min', '95')) * 60_000;
    const watch = new Set((arg('watch', '') ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    const spotArg = arg('spots', 'all')!;
    const spots: Spot[] = spotArg === 'all' ? SPOTS
        : spotArg === 'here' ? []
        : spotArg.split(',').map(n => {
            if (n.trim().startsWith('@')) return { name: n.trim(), x: 0, z: 0, what: `near ${n.trim().slice(1)} (resolved from /playerpositions)` };
            const s = SPOTS.find(sp => sp.name === n.trim());
            if (!s) throw new Error(`unknown spot ${n}; known: ${SPOTS.map(sp => sp.name).join(', ')}`);
            return s;
        });
    const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = arg('out', join(OBS_HOME, runId))!;
    mkdirSync(outDir, { recursive: true });
    const hs = new Hiscores(join(OBS_HOME, 'hiscores.json'), !process.argv.includes('--no-hiscores'));
    const write = (file: string, row: unknown) => appendFileSync(join(outDir, file), JSON.stringify(row) + '\n');
    const t0 = Date.now();
    console.log(`[observe] run ${runId} -> ${outDir}`);

    const creds = loadOrCreateEnv(bot);
    initPathfinding();
    const { startSession, BotActionQueue } = await loadLite();
    const session = await startSession({ host: SERVER, username: creds.username, password: creds.password, quiet: true, loginJitterMs: 0 });
    console.log(`[observe] ${creds.username} logged in`);
    // A session that ends without our logout (server restart, dropped socket) ends the tour:
    // there is nothing left to observe, and the player leaves the world on the server's timeout.
    let ended: string | null = null;
    void session.stopped.then(end => {
        ended = end.reason;
    });

    const logs: SpotLog[] = [];
    let current: SpotLog | null = null;
    let lastSampleTick = -1;
    let deaths = 0;
    const seenChat = new Set<string>();
    const gw: LoopbackGateway = new LoopbackGateway(session.client, BotActionQueue, tick => {
        const state = gw.lastState;
        // Chat: public (1, 2) only; recorded, never acted on.
        for (const m of state?.gameMessages ?? []) {
            if (m.fromSelf) continue;
            const key = `${m.type}|${m.sender}|${m.text}|${m.tick}`;
            if (seenChat.has(key)) continue;
            seenChat.add(key);
            if (m.type === 0) {
                if (/you are dead/i.test(m.text)) deaths++;
                // System messages (deaths, random events) explain displacements.
                write('events.jsonl', { at: new Date().toISOString(), event: 'mes', tick, text: m.text });
                continue;
            }
            if (m.type !== 1 && m.type !== 2) continue;
            const row = { at: new Date().toISOString(), tick, spot: current?.spot.name ?? null, sender: m.sender, text: m.text };
            write('chat.jsonl', row);
            current?.chat.push(`${row.at.slice(11, 19)} ${m.sender}: ${JSON.stringify(m.text)}`);
        }
        if (tick - lastSampleTick < sampleTicks) return;
        lastSampleTick = tick;
        const players = samplePlayers(session.client, state);
        const me = state?.player;
        // A sample belongs to the spot only while the observer is actually there.
        const here = current && me && Math.max(Math.abs(me.worldX - current.spot.x), Math.abs(me.worldZ - current.spot.z)) <= SPOT_RADIUS ? current : null;
        write('samples.jsonl', { at: new Date().toISOString(), tick, spot: here?.spot.name ?? null, me: me ? [me.worldX, me.worldZ, me.level, me.hp] : null, players });
        here?.add(tick, players);
        for (const p of players) hs.want(p.name);
    });

    const sdk = new BotSDK({ botUsername: creds.username, password: creds.password, gatewayUrl: gw.url, autoLaunchBrowser: false, autoReconnect: false, showChat: true });
    await sdk.connect();
    await sdk.waitForCondition(s => s.inGame && !!s.player, 30_000);
    const bot_ = new BotActions(sdk);
    const st0 = sdk.getState()!;
    write('events.jsonl', { at: new Date().toISOString(), event: 'login', tick: gw.serverTick, me: [st0.player?.worldX, st0.player?.worldZ, st0.player?.level], modal: (st0 as any).modalInterface });
    console.log(`[observe] at (${st0.player?.worldX}, ${st0.player?.worldZ}) modal=${(st0 as any).modalInterface}`);

    // A fresh account starts in the tutorial: design screen, then the guide's skip option.
    for (let i = 0; i < 8 && (sdk.findNearbyNpc(/runescape guide/i) || sdk.getState()?.modalInterface === 3559 || sdk.getState()?.dialog.isOpen); i++) {
        const r = await bot_.skipTutorial({ randomizeAppearance: true });
        console.log(`[observe] skipTutorial: ${r.message}`);
        await Bun.sleep(1500);
    }
    const st1 = sdk.getState()!;
    write('events.jsonl', { at: new Date().toISOString(), event: 'ready', tick: gw.serverTick, me: [st1.player?.worldX, st1.player?.worldZ, st1.player?.level] });
    console.log(`[observe] ready at (${st1.player?.worldX}, ${st1.player?.worldZ})`);

    let stopping = false;
    const logout = async (why: string) => {
        if (stopping) return;
        stopping = true;
        write('events.jsonl', { at: new Date().toISOString(), event: 'logout', why, tick: gw.serverTick });
        console.log(`[observe] logging out (${why})`);
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline && !ended && !session.client.isLoggedOut()) {
            await sdk.sendClickComponent(LOGOUT_BUTTON).catch(() => {});
            const end = await Promise.race([session.stopped, Bun.sleep(6000).then(() => null)]);
            if (end) break;
        }
        const end = await Promise.race([session.stopped, Bun.sleep(2000).then(() => ({ reason: 'timeout' }))]);
        console.log(`[observe] session ended: ${(end as any).reason}`);
        if ((end as any).reason === 'timeout') session.stop();
        writeFileSync(join(outDir, 'summary.md'), renderSummary(runId, logs, hs, gw.refused, watch));
        await sdk.disconnect().catch(() => {});
        gw.stop();
    };
    process.on('SIGINT', () => void logout('SIGINT').then(() => process.exit(0)));
    process.on('SIGTERM', () => void logout('SIGTERM').then(() => process.exit(0)));

    const dwell = async (spot: Spot, arrived: boolean, note = '') => {
        const log = new SpotLog(spot);
        log.arrived = arrived;
        log.note = note;
        log.startTick = gw.serverTick;
        logs.push(log);
        current = log;
        write('events.jsonl', { at: new Date().toISOString(), event: 'dwell', spot: spot.name, arrived, tick: gw.serverTick });
        const until = Math.min(Date.now() + dwellMs, t0 + maxMs);
        const deathsAtStart = deaths;
        while (Date.now() < until && !stopping && !ended) {
            await Bun.sleep(500);
            // A death means the way here is lethal for a level-3 observer (White Wolf
            // Mountain): give the spot up rather than walk the same path again.
            if (deaths > deathsAtStart || !arrived) {
                log.note = (log.note ? log.note + '; ' : '') + (deaths > deathsAtStart ? 'died; spot abandoned' : 'not reached; spot abandoned');
                break;
            }
            // Displaced (random event): walk back and keep dwelling.
            const me = sdk.getState()?.player;
            if (me && Math.max(Math.abs(me.worldX - spot.x), Math.abs(me.worldZ - spot.z)) > SPOT_RADIUS && until - Date.now() > 20_000) {
                write('events.jsonl', { at: new Date().toISOString(), event: 'displaced', spot: spot.name, me: [me.worldX, me.worldZ], tick: gw.serverTick });
                console.log(`[observe] displaced from ${spot.name} to (${me.worldX}, ${me.worldZ}); walking back`);
                log.note = (log.note ? log.note + '; ' : '') + `displaced at tick ${gw.serverTick}`;
                await bot_.walkTo(spot.x, spot.z, 4, { timeout: Math.max(5_000, until - Date.now()) }).catch(() => {});
            }
        }
        // Let the last hiscore lookups land before the summary is written.
        await Bun.sleep(1500);
        log.endTick = gw.serverTick;
        log.endWall = new Date();
        current = null;
        writeFileSync(join(outDir, 'summary.md'), renderSummary(runId, logs, hs, gw.refused, watch));
        console.log(`[observe] ${spot.name}: ${log.tracks.size} players`);
    };

    try {
        if (spots.length === 0) {
            const me = sdk.getState()!.player!;
            await dwell({ name: 'here', x: me.worldX, z: me.worldZ, what: 'current position' }, true);
        }
        for (let spot of spots) {
            if (spot.name.startsWith('@')) {
                const who = spot.name.slice(1).toLowerCase();
                const pos = (await fetchPositions().catch(() => [])).find(p => p.name.toLowerCase() === who);
                if (!pos || pos.level !== 0 || pos.z > 6400) {
                    write('events.jsonl', { at: new Date().toISOString(), event: 'target_unavailable', spot: spot.name, pos: pos ?? null });
                    console.log(`[observe] ${spot.name}: ${pos ? `at (${pos.x}, ${pos.z}, ${pos.level}), not reachable` : 'offline'}; skipped`);
                    continue;
                }
                // Stand off their tile, never on it.
                spot = { ...spot, x: pos.x + 3, z: pos.z + 3, what: `${spot.what}; target at (${pos.x}, ${pos.z})` };
            }
            if (stopping || ended || Date.now() - t0 > maxMs) {
                if (ended) write('events.jsonl', { at: new Date().toISOString(), event: 'session_ended', reason: ended, tick: gw.serverTick });
                break;
            }
            const w0 = gw.serverTick;
            let r = await bot_.walkTo(spot.x, spot.z, 4, { timeout: 240_000 });
            if (!r.success) r = await bot_.walkTo(spot.x, spot.z, 6, { timeout: 120_000 });
            const me = sdk.getState()?.player;
            write('events.jsonl', { at: new Date().toISOString(), event: 'walk', spot: spot.name, ok: r.success, msg: r.message, ticks: gw.serverTick - w0, me: [me?.worldX, me?.worldZ] });
            console.log(`[observe] walk ${spot.name}: ${r.success ? 'ok' : 'FAILED ' + r.message} (${gw.serverTick - w0} ticks)`);
            await dwell(spot, r.success, r.success ? '' : `stopped at (${me?.worldX}, ${me?.worldZ})`);
        }
    } catch (e) {
        console.error('[observe] tour error:', e);
        write('events.jsonl', { at: new Date().toISOString(), event: 'error', error: String(e) });
    } finally {
        await logout('tour finished');
    }
    process.exit(0);
}

if (import.meta.main) {
    (process.argv[2] === 'positions' ? trackPositions().then(() => process.exit(0)) : main()).catch(e => {
        console.error('[observe] fatal:', e);
        process.exit(1);
    });
}
