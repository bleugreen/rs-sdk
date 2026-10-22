// Per-tick input decode cap probe (docs/speedrun/research/demo-latency.md section 6, 'Decode cap').
//
//   cd server/webclient && bun install && cd ../..        # once per checkout (lite client deps)
//   bun docs/speedrun/scripts/decode-cap-probe.ts <bot> [--host=H] [--insecure] [--label=L] [--out=PATH]
//       [--user=5,6,8] [--client=5,6,8,19,20,21] [--failed=5,8] [--repeats=3]
//   NODE_TICKRATE=300 LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> docs/speedrun/scripts/decode-cap-probe.ts:--stage \
//       docs/speedrun/scripts/decode-cap-probe.ts:--label=lab
//
// The engine decodes a player's buffered input once per tick, and stops reading as soon as any
// one category reaches its limit (server/engine/src/engine/entity/NetworkPlayer.ts decodeIn and
// read: USER_EVENT 5, CLIENT_EVENT 20, RESTRICTED_EVENT 2 in ClientGameProtCategory.ts). What is
// left stays in the socket buffer and is read at the start of the next tick. Only a USER_EVENT
// whose handler succeeds counts as one; a failed one counts as a CLIENT_EVENT.
//
// The probe logs in on the lite client's direct socket (no gateway relay), and on the frame of a
// fresh tick writes one burst in ONE socket write (one websocket message), so every packet of it
// is in the server's buffer before the same input read. Then it reads the server's inventory
// frames tick by tick.
//
// The countable action is INV_BUTTOND (opcode 253, USER_EVENT; InvButtonDHandler runs
// [inv_buttond,inventory] at once: if_close then inv_movetoslot, no queue, no delay). A burst is
// a chain of drags of one tracer item (an item id held once): slot p -> p+1 -> p+2 ... The tracer's
// slot in each tick's inventory frame says exactly how many drags the server has applied so far.
// The other items it passes over only swap one place back.
//
// Classes:
//   user N    N chained drags.
//   client K  drag 1, then K EVENT_CAMERA_POSITION (opcode 193, CLIENT_EVENT, only recorded by
//             InputTracking), then drag 2. Drag 2 lands in drag 1's tick iff the client cap was
//             not reached first (fork: K <= 19 same tick, K >= 20 next tick).
//   failed K  drag 1, then K drags out of an empty slot (InvButtonDHandler returns false: a failed
//             USER_EVENT, which the fork counts as CLIENT_EVENT), then drag 2.
// Each repeat waits for a settled tick and sends on its frame. A repeat whose window held a glued
// frame (two ticks decoded in one drain) is recorded, flagged, and not counted.
//
// --stage (lab only) takes the bot off Tutorial Island through S00's tutorialSkip, where the hidden
// side tabs make the server drop every inventory drag (docs/speedrun/LAB.md, 'Staging a fresh
// account'), and logs it out. The probe itself aborts if a single preflight drag does not land.
// Credentials: BOT_USERNAME/PASSWORD in the environment, else bots/<bot>/bot.env (gitignored).
// The output JSON redacts the account name.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** server/content/pack/interface.pack: 3214=inventory:inv */
export const INVENTORY_COM = 3214;
export const INV_SLOTS = 28;

export type ProbeClass = 'user' | 'client' | 'failed' | 'ifbutton';

/** Ticks after the send tick, the drags applied by then, and whether that drain held more than one tick. */
export interface TickSample {
    rel: number;
    k: number | null;
    glued: boolean;
}

export interface RepeatSummary {
    /** Ticks after the send tick at which the first drag showed (null: none did). */
    firstRel: number | null;
    /** Drags applied in the first landing tick, in the next, and in any later one. */
    sameTick: number;
    nextTick: number;
    later: number;
    /** Drags never seen applied in the window. */
    missing: number;
    glued: boolean;
}

/** How many drags of a chain from `start` in direction `dir` the tracer's slot shows; null if off the chain. */
export function dragsApplied(tracerSlot: number, start: number, dir: 1 | -1, len: number): number | null {
    const k = (tracerSlot - start) * dir;
    return k >= 0 && k <= len ? k : null;
}

/**
 * Split a repeat's tick samples into same tick / next tick / later, relative to the first tick
 * that shows any drag applied. A null k (the tracer off its chain) counts as no progress.
 */
export function summarize(samples: TickSample[], total: number): RepeatSummary {
    const at = (rel: number) => {
        let best = 0;
        for (const s of samples) if (s.rel <= rel && s.k !== null) best = Math.max(best, s.k);
        return best;
    };
    const first = samples.find(s => (s.k ?? 0) > 0) ?? null;
    const glued = samples.some(s => s.glued && first !== null && s.rel <= first.rel + 1);
    if (!first) return { firstRel: null, sameTick: 0, nextTick: 0, later: 0, missing: total, glued };
    const same = at(first.rel);
    const next = at(first.rel + 1);
    const final = at(Number.POSITIVE_INFINITY);
    return { firstRel: first.rel, sameTick: same, nextTick: next - same, later: final - next, missing: total - final, glued };
}

/** Slot of the only occurrence of `obj` (linkObjType value) in the inventory, else -1. */
export function slotOf(inv: readonly number[], obj: number): number {
    let hit = -1;
    for (let i = 0; i < inv.length; i++) {
        if (inv[i] !== obj) continue;
        if (hit >= 0) return -1;
        hit = i;
    }
    return hit;
}

/** A tracer: an item id held exactly once. Prefers one near the middle so chains go either way. */
export function pickTracer(inv: readonly number[]): number | null {
    const candidates = inv.map((o, i) => [o, i] as const).filter(([o]) => o > 0 && slotOf(inv, o) >= 0);
    if (!candidates.length) return null;
    candidates.sort((a, b) => Math.abs(a[1] - 13.5) - Math.abs(b[1] - 13.5));
    return candidates[0]![0];
}

// ------------------------------------------------------------------ live probe

async function main() {
    const args = new Map<string, string>();
    const positional: string[] = [];
    for (const a of process.argv.slice(2)) {
        const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
        if (m) args.set(m[1]!, m[2] ?? 'true');
        else positional.push(a);
    }
    const REPO = new URL('../../../', import.meta.url).pathname;
    const botName = args.get('bot') ?? positional[0];
    const list = (k: string, d: string) => (args.get(k) ?? d).split(',').filter(Boolean).map(Number);
    const REPEATS = Number(args.get('repeats') ?? 3);
    const USER = list('user', '5,6,8');
    const CLIENT = list('client', '5,6,8,19,20,21');
    const FAILED = list('failed', '5,8');
    const IFBUTTON = list('ifbutton', '');
    const BUTTON = Number(args.get('button') ?? 1193);

    const botEnv = (): Record<string, string> => {
        const path = botName ? join(REPO, 'bots', botName, 'bot.env') : '';
        if (!botName || !existsSync(path)) return {};
        return Object.fromEntries(
            readFileSync(path, 'utf8')
                .split('\n')
                .filter(l => l.includes('=') && !l.startsWith('#'))
                .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
        );
    };
    const env = botEnv();
    const HOST = args.get('host') ?? env.SERVER ?? 'rs-sdk-demo.fly.dev';
    const SECURED = !args.has('insecure') && !/^(localhost|127\.0\.0\.1)(:|$)/.test(HOST);
    const ORIGIN = `${SECURED ? 'https' : 'http'}://${HOST}`;
    const LABEL = args.get('label') ?? hostname();

    if (args.has('stage')) {
        if (!botName) throw new Error('--stage needs a bot name');
        const { openSession: openRunner, logoutClean, closeSession } = await import('../../../speedrun/lib/session');
        const { leaveTutorial } = await import('../../../speedrun/lab/setup');
        const session = await openRunner(botName, { launch: true });
        await leaveTutorial(session as any);
        const p = session.sdk.getState()?.player;
        console.log(`stage: ${botName} at ${p?.worldX},${p?.worldZ}`);
        console.log(`stage: logout ${JSON.stringify(await logoutClean(session))}`);
        await closeSession(session);
        process.exit(0);
    }

    const username = process.env.BOT_USERNAME ?? env.BOT_USERNAME;
    const password = process.env.PASSWORD ?? env.PASSWORD;
    if (!username || !password) throw new Error('no credentials: BOT_USERNAME/PASSWORD, or <bot> with bots/<bot>/bot.env');

    const now = (): number => performance.timeOrigin + performance.now();
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const STARTED = new Date();
    const OUT = args.get('out') ?? join(process.env.TMPDIR ?? tmpdir(), `decode-cap-${LABEL}-${STARTED.toISOString().replace(/[:.]/g, '-')}.json`);

    /** The page's process-start token (client.js?v=<Date.now() at engine start>): a change means a restart. */
    const pageToken = async (): Promise<string | null> => {
        for (const path of ['/', '/rs2.cgi', '/client']) {
            try {
                const html = await (await fetch(ORIGIN + path, { signal: AbortSignal.timeout(8000) })).text();
                const m = /client\.js\?v=([0-9a-zA-Z]+)/.exec(html);
                if (m) return m[1]!;
            } catch {}
        }
        return null;
    };

    await import('../../../server/webclient/src/lite/dom-shim.js');
    const { loadCache } = await import('../../../server/webclient/src/lite/cache.js');
    const { LocIndex } = await import('../../../server/webclient/src/lite/world/LocIndex.js');
    const { GameConnection } = await import('../../../server/webclient/src/lite/net/GameConnection.js');
    const { LiteClient } = await import('../../../server/webclient/src/lite/LiteClient.js');
    const { ClientProt } = await import('../../../server/webclient/src/io/ClientProt.js');

    const tokenBefore = await pageToken();
    const cacheDir = `${process.env.HOME ?? tmpdir()}/.cache/rs-sdk-lite${SECURED ? '' : '-' + HOST.replace(/[^a-z0-9]/gi, '_')}`;
    const { checksums } = await loadCache({ origin: ORIGIN, cacheDir, quiet: true });
    const locIndex = await LocIndex.load({ origin: ORIGIN, cacheDir, versionlistCrc: checksums[5]!, quiet: true });
    const connection = await GameConnection.connect({ host: HOST, secured: SECURED, username, password, checksums });
    const client = new LiteClient({ connection, locIndex, username, password });

    interface Tick {
        label: number;
        n: number;
        arrival: number;
        inv: number[];
        cnt: number[];
    }
    const ticks: Tick[] = [];
    const listeners: ((t: Tick) => void)[] = [];
    let label = 0;
    let lastArrival = 0;
    let pumping = false;
    let again = false;
    const readInv = (): number[] => Array.from(client.ifType(INVENTORY_COM)?.linkObjType ?? new Int32Array(INV_SLOTS)).slice(0, INV_SLOTS);
    const pump = async () => {
        if (pumping) {
            again = true;
            return;
        }
        pumping = true;
        try {
            do {
                again = false;
                await client.pumpPackets();
                client.tickCycle();
                client.flush();
            } while (again);
        } catch (e) {
            console.error('[decode-cap] pump failed', e);
        } finally {
            pumping = false;
        }
    };
    client.setOnGameTickCallback(n => {
        label += n;
        const t: Tick = { label, n, arrival: lastArrival, inv: readInv(), cnt: Array.from(client.ifType(INVENTORY_COM)?.linkObjNumber ?? new Int32Array(INV_SLOTS)).slice(0, INV_SLOTS) };
        ticks.push(t);
        for (const l of [...listeners]) l(t);
    });
    const sock = (connection.stream as any).socket as WebSocket;
    sock.addEventListener('message', () => {
        lastArrival = now();
        void pump();
    });
    const keepalive = setInterval(() => {
        client.writeOpcode(ClientProt.NO_TIMEOUT); // no decoder in the engine: counts toward no limit
        client.flush();
    }, 1000);
    void pump();

    const nextTick = () => new Promise<Tick>(resolve => {
        const l = (t: Tick) => {
            listeners.splice(listeners.indexOf(l), 1);
            resolve(t);
        };
        listeners.push(l);
    });
    const waitTicks = async (n: number) => {
        for (let i = 0; i < n; i++) await nextTick();
    };

    const cheat = (cmd: string) => {
        client.writeOpcode(ClientProt.CLIENT_CHEAT);
        client.out.p1(cmd.length + 1);
        client.out.pjstr(cmd);
        client.flush();
    };

    await waitTicks(8);
    // ifbutton (lab only): Charge (magic:charge, com 1193; charge.rs2 casts at once: settimer, runes,
    // no queue). Casts are counted by the blood-rune stack, given as 301 so its slot is recognisable.
    let counterObj = 0;
    if (IFBUTTON.length && args.has('charge-setup')) {
        for (const c of ['setstat magic 80', 'setvar magearena 8', 'give blood_rune 301', 'give fire_rune 302', 'give air_rune 303']) {
            cheat(c);
            await waitTicks(3);
        }
        await waitTicks(3);
    }
    if (IFBUTTON.length) {
        const t = ticks.at(-1)!;
        const i = t.cnt.findIndex((c, j) => c === 301 && t.inv[j]! > 0);
        if (i < 0) throw new Error('ifbutton: no stack of 301 (the counter) in the inventory; run with --charge-setup on the lab');
        counterObj = t.inv[i]!;
    }
    const counter = (t: Tick) => t.inv.reduce((s, o, j) => (o === counterObj ? s + t.cnt[j]! : s), 0);
    const inv0 = ticks.at(-1)!.inv;
    const tracer = pickTracer(inv0);
    if (tracer === null) throw new Error(`no item held exactly once in the inventory (${JSON.stringify(inv0)})`);

    const drag = (from: number, to: number) => {
        client.writeOpcode(ClientProt.INV_BUTTOND);
        client.out.p2(INVENTORY_COM);
        client.out.p2(from);
        client.out.p2(to);
        client.out.p1(0);
    };
    const camera = (i: number) => {
        client.writeOpcode(ClientProt.EVENT_CAMERA_POSITION);
        client.out.p2(128 + ((i * 7) % 255));
        client.out.p2((i * 37) % 2048);
    };

    interface Repeat {
        cls: ProbeClass;
        n: number;
        drags: number;
        start: number;
        dir: 1 | -1;
        sendLabel: number;
        /** ms from the tick frame's arrival to the write */
        sendAfterFrameMs: number;
        bytes: number;
        samples: TickSample[];
        tickArrivalsMs: number[];
        summary: RepeatSummary;
    }

    let perCast = 3;
    const run = async (cls: ProbeClass | 'preflight', n: number): Promise<Repeat> => {
        // Settle: two ticks with the tracer unmoved.
        for (;;) {
            const a = await nextTick();
            const b = await nextTick();
            if (slotOf(a.inv, tracer) === slotOf(b.inv, tracer) && slotOf(b.inv, tracer) >= 0) break;
        }
        const drags = cls === 'user' || cls === 'ifbutton' ? n : cls === 'preflight' ? 1 : 2;
        let counter0 = 0;
        return await new Promise<Repeat>(resolve => {
            let rep: Repeat | null = null;
            let sendArrival = 0;
            let doneAt = -1;
            const l = (t: Tick) => {
                if (!rep) {
                    const start = slotOf(t.inv, tracer);
                    const dir: 1 | -1 = start + drags < INV_SLOTS ? 1 : -1;
                    const at = (k: number) => start + k * dir;
                    const [lo, hi] = [Math.min(at(0), at(drags)), Math.max(at(0), at(drags))];
                    const empty = t.inv.findIndex((o, i) => o === 0 && (i < lo || i > hi));
                    const before = client.out.pos;
                    counter0 = counterObj ? counter(t) : 0;
                    if (cls === 'ifbutton') {
                        for (let i = 0; i < n; i++) {
                            client.writeOpcode(ClientProt.IF_BUTTON);
                            client.out.p2(BUTTON);
                        }
                    } else drag(at(0), at(1));
                    if (cls === 'user') for (let i = 1; i < n; i++) drag(at(i), at(i + 1));
                    if (cls === 'client') for (let i = 0; i < n; i++) camera(i);
                    if (cls === 'failed') {
                        if (empty < 0) throw new Error('failed class needs an empty slot off the chain');
                        for (let i = 0; i < n; i++) drag(empty, empty === 0 ? 1 : empty - 1);
                    }
                    if (cls === 'client' || cls === 'failed') drag(at(1), at(2));
                    const bytes = client.out.pos - before;
                    client.flush(); // one websocket message
                    sendArrival = t.arrival;
                    rep = { cls: cls as ProbeClass, n, drags, start, dir, sendLabel: t.label, sendAfterFrameMs: Math.round((now() - t.arrival) * 10) / 10, bytes, samples: [], tickArrivalsMs: [], summary: null as any };
                    return;
                }
                const k = cls === 'ifbutton' ? (counter0 - counter(t)) / perCast : dragsApplied(slotOf(t.inv, tracer), rep.start, rep.dir, rep.drags);
                rep.samples.push({ rel: t.label - rep.sendLabel, k, glued: t.n > 1 });
                rep.tickArrivalsMs.push(Math.round((t.arrival - sendArrival) * 10) / 10);
                if (k === rep.drags && doneAt < 0) doneAt = t.label;
                if ((doneAt >= 0 && t.label - doneAt >= 2) || t.label - rep.sendLabel >= 10) {
                    listeners.splice(listeners.indexOf(l), 1);
                    rep.summary = summarize(rep.samples, rep.drags);
                    resolve(rep);
                }
            };
            listeners.push(l);
        });
    };

    const report: any = {
        label: LABEL,
        machine: hostname(),
        platform: `${process.platform}/${process.arch}`,
        host: HOST,
        path: 'lite client, direct game socket (no gateway relay)',
        account: '<redacted>',
        startedUtc: STARTED.toISOString(),
        speedrunTickMs: process.env.SPEEDRUN_TICK_MS ?? null,
        pageTokenBefore: tokenBefore,
        packets: {
            user: 'INV_BUTTOND opcode 253 (USER_EVENT), com 3214 inventory:inv, [inv_buttond,inventory] -> inv_movetoslot',
            client: 'EVENT_CAMERA_POSITION opcode 193 (CLIENT_EVENT), 4 bytes',
            failed: 'INV_BUTTOND out of an empty slot: handler returns false, counted as CLIENT_EVENT by the fork'
        },
        tracer,
        inventoryAtStart: inv0,
        repeats: [] as Repeat[]
    };
    const save = () => {
        mkdirSync(dirname(OUT), { recursive: true });
        writeFileSync(OUT, JSON.stringify(report, null, 1));
    };

    const pre = await run('preflight', 1);
    report.preflight = pre;
    if (pre.summary.firstRel === null) {
        save();
        throw new Error(`preflight drag never landed (${JSON.stringify(pre.samples)}): side tabs hidden (Tutorial Island), delayed, or a modal in the way`);
    }
    console.log(`preflight: drag landed ${pre.summary.firstRel} tick(s) after the send tick, sent ${pre.sendAfterFrameMs} ms after the frame`);

    const plan: [ProbeClass, number][] = [...USER.map(n => ['user', n] as [ProbeClass, number]), ...CLIENT.map(n => ['client', n] as [ProbeClass, number]), ...FAILED.map(n => ['failed', n] as [ProbeClass, number]), ...IFBUTTON.map(n => ['ifbutton', n] as [ProbeClass, number])];
    if (IFBUTTON.length) {
        const one = await run('ifbutton', 1);
        const t = ticks.at(-1)!;
        report.ifbuttonCalibration = { counterBefore: null, samples: one.samples };
        const drop = 301 - counter(t);
        if (drop <= 0) throw new Error(`ifbutton: one click of ${BUTTON} used no counter runes (${JSON.stringify(one.samples)})`);
        perCast = drop;
        report.ifbutton = { button: BUTTON, counterObj, perCast, packet: 'IF_BUTTON opcode 86 (USER_EVENT), magic:charge' };
        console.log(`ifbutton: one click of ${BUTTON} used ${perCast} counter runes`);
    }
    for (const [cls, n] of plan) {
        let clean = 0;
        for (let attempt = 0; clean < REPEATS && attempt < REPEATS * 2; attempt++) {
            const r = await run(cls, n);
            report.repeats.push(r);
            if (!r.summary.glued) clean++;
            const s = r.summary;
            console.log(`${cls} n=${n}: first +${s.firstRel} same ${s.sameTick} next ${s.nextTick} later ${s.later} missing ${s.missing}${s.glued ? ' GLUED' : ''} (sent +${r.sendAfterFrameMs} ms, ${r.bytes} B)`);
            save();
        }
    }

    const iv: number[] = [];
    for (let i = 1; i < ticks.length; i++) if (ticks[i]!.n === 1) iv.push(ticks[i]!.arrival - ticks[i - 1]!.arrival);
    iv.sort((a, b) => a - b);
    report.tickIntervalMs = iv.length ? { n: iv.length, p10: Math.round(iv[Math.floor(iv.length * 0.1)]!), p50: Math.round(iv[Math.floor(iv.length * 0.5)]!), p90: Math.round(iv[Math.floor(iv.length * 0.9)]!) } : null;
    report.pageTokenAfter = await pageToken();
    report.restartedDuringRun = tokenBefore !== null && report.pageTokenAfter !== null && tokenBefore !== report.pageTokenAfter;
    report.endedUtc = new Date().toISOString();

    // Table: per class and N, counts of repeats by (same, next, later) over clean repeats.
    const table: Record<string, Record<string, number>> = {};
    for (const r of report.repeats as Repeat[]) {
        if (r.summary.glued) continue;
        const key = `${r.cls} ${r.n}`;
        const cell = `${r.summary.sameTick}/${r.summary.nextTick}/${r.summary.later}${r.summary.missing ? ` miss ${r.summary.missing}` : ''}`;
        (table[key] ??= {})[cell] = (table[key]![cell] ?? 0) + 1;
    }
    report.table = table;
    save();
    console.log(`tick interval ${JSON.stringify(report.tickIntervalMs)}; page token ${tokenBefore} -> ${report.pageTokenAfter}${report.restartedDuringRun ? ' RESTARTED' : ''}`);
    for (const [k, v] of Object.entries(table)) console.log(`TABLE ${k}: ${Object.entries(v).map(([c, m]) => `${c} x${m}`).join(', ')}`);
    console.log(`wrote ${OUT}`);

    clearInterval(keepalive);
    await sleep(500);
    connection.close();
    process.exit(0);
}

if (import.meta.main) await main();
