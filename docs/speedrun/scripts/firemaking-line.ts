#!/usr/bin/env bun
/**
 * Firemaking line cadence lab. Lights logs along a "snake" of rows and logs
 * the server tick of every lighting start ("You attempt to light the logs.")
 * and every success ("The fire catches..."), every refused tile, walk, xp
 * drop and level-up dialog.
 *
 *   bun docs/speedrun/scripts/firemaking-line.ts <bot> [flags]
 *
 * Flags:
 *   --logs=NAME     log debugname for ::give (logs, oak_logs, willow_logs,
 *                   maple_logs, yew_logs, magic_logs; default magic_logs)
 *   --level=N       ::setstat firemaking N first
 *   --hold=1|0      re-set the level after every level-up (default 1)
 *   --until=N       stop when Firemaking reaches level N (use with --hold=0)
 *   --fires=N       successes to record (default 27)
 *   --row=X,Z,LEN   snake origin and row length: row 0 runs west from (X,Z)
 *                   over LEN tiles, row 1 (Z-1) runs back east, and so on
 *                   (default 3019,3362,27, south of Falador east bank; rows
 *                   z=3362 and z=3361 are clear for 27 tiles, z=3360 is not)
 *   --rows=N        rows in the snake before it repeats from row 0 (default 2)
 *   --mode=inv|ground  inv: tinderbox on an inventory log (the log is dropped
 *                   and lit where the player stands). ground: "Light" (op4)
 *                   on a log already on the target tile, e.g. one a helper
 *                   dropped (see firemaking-drop.ts); the client walks there.
 *   --send=K        first light/walk is sent K ticks after the success is
 *                   seen (default 0: at once; the success message is emitted
 *                   the tick after the roll, once push_player's p_delay(0)
 *                   resumes, so the reply lands two ticks after the roll)
 *   --retry=K       resend a light/walk that has not taken effect after K
 *                   ticks (default 1, right at 300 ms; at 100 ms the bot's
 *                   round trip is about 2 ticks, and a premature resend in
 *                   inv mode drops a second log, counted as logsPerSuccess)
 *   --restock=give|none  inv mode: ::give 27 more logs when out (default
 *                   give; the resupply itself is costed by firemaking-supply.ts)
 *   --out=PATH      JSONL per-tick log
 *
 * Ticks are the lite client's count of server ticks. Base xp = game xp / 25.
 * Failures are not announced by the server (firemaking.rs2:69-74 only
 * replays the animation), so they are inferred from the success gaps: a light
 * started fresh rolls 3 ticks after the start, every roll re-arms the clock by
 * 4 ticks, so a gap of 4k ticks between successes (or 3 + 4k after a start)
 * contains k-1 failed rolls.
 */
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const BOT = argv.find(a => !a.startsWith('--')) ?? 'bot';
const LOGS = flag('logs', 'magic_logs')!;
const LEVEL = Number(flag('level', '0'));
const HOLD = flag('hold', '1') !== '0';
const UNTIL = Number(flag('until', '0'));
const FIRES = Number(flag('fires', '27'));
const [RX, RZ, RLEN] = flag('row', '3019,3362,27')!.split(',').map(Number);
const ROWS = Number(flag('rows', '2'));
const MODE = flag('mode', 'inv')!;
const SEND = Number(flag('send', '0'));
const RETRY = Number(flag('retry', '1'));
const RESTOCK = flag('restock', 'give')!;
const OUT = flag('out', `${process.env.TMPDIR ?? '/tmp'}/firemaking-line-${BOT}-${LOGS}-${LEVEL}-${MODE}.jsonl`)!;
const logName = LOGS === 'logs' ? /^logs$/i : new RegExp(`^${LOGS.replace('_logs', '').replace(/_/g, ' ')} logs$`, 'i');

/** stat_random(firemaking, 64, 512) success chance (PlayerOps.ts STAT_RANDOM). */
const chance = (l: number) => Math.min(1, (Math.floor((64 * (99 - l)) / 98) + Math.floor((512 * (l - 1)) / 98) + 1) / 256);

/** The i-th tile of the snake: even rows run west from RX, odd rows run east. */
function snakeTile(i: number): [number, number] {
    const row = Math.floor(i / RLEN) % ROWS;
    const k = i % RLEN;
    const x = row % 2 === 0 ? RX - k : RX - RLEN + 1 + k;
    return [x, RZ - row];
}

await runScript(async ({ bot, sdk }) => {
    const log = Bun.file(OUT).writer();
    const fm = (s: BotWorldState) => s.skills.find(k => k.name === 'Firemaking')!;
    const nextTick = (after: number) => new Promise<BotWorldState>(resolve => {
        const now = sdk.getState();
        if (now && now.tick > after) return resolve(now);
        const off = sdk.onStateUpdate(s => { if (s.tick > after) { off(); resolve(s); } });
    });
    const waitTicks = async (n: number) => { let t = sdk.getState()!.tick; for (let i = 0; i < n; i++) t = (await nextTick(t)).tick; };
    const sendAction = (a: object) => (sdk as any).sendAction({ reason: 'firemaking-line', ...a });

    await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 15000);
    await bot.skipTutorial().catch(() => {});
    const [sx, sz] = snakeTile(0);
    await sdk.sendSay(`::tele 0,${sx >> 6},${sz >> 6},${sx & 63},${sz & 63}`);
    await waitTicks(3);
    if (LEVEL) { await sdk.sendSay(`::setstat firemaking ${LEVEL}`); await waitTicks(2); }
    await sdk.sendSay('::~clearinv inv'); await waitTicks(2);
    await sdk.sendSay('::give tinderbox 1'); await waitTicks(2);
    if (MODE === 'inv') { await sdk.sendSay(`::give ${LOGS} 27`); await waitTicks(3); }
    while (sdk.getState()?.dialog.isOpen) { await sdk.sendClickDialog(0); await waitTicks(1); }

    let state = sdk.getState()!;
    const seen = new Set<number>();
    for (const m of state.gameMessages) if (m.observationId !== undefined) seen.add(m.observationId);
    const startTick = state.tick;
    const startXp = fm(state).experience;
    let lastXp = startXp;

    type Ev = { t: number; kind: 'start' | 'success' | 'refused'; level: number; tile: [number, number] };
    const evs: Ev[] = [];
    let idx = 0;                 // snake index of the tile the next fire goes on
    let phase: 'idle' | 'pending' = 'idle';
    let notBefore = state.tick + 1;
    let sentAt = -1, sends = 0, walks = 0, restocks = 0, dialogs = 0, setstats = 0, refused = 0;
    let logsBefore = 0, logsUsed = 0, prevLogs = -1, walkedAt = -100;
    let successes = 0;
    const rejectedSends: number[] = [];   // per fire: sends that did not take
    let sendsThisFire = 0;

    let lastProgress = state.tick, walkStart = -1, skipped = 0;
    while (successes < FIRES && !(UNTIL && fm(state).baseLevel >= UNTIL)) {
        state = await nextTick(state.tick);
        const t = state.tick;
        if (t - lastProgress > 80) { console.log(`stalled at tick ${t}`); break; }
        const me: [number, number] = [state.player!.worldX, state.player!.worldZ];
        const level = fm(state).baseLevel;
        const ev: string[] = [];
        const fresh: string[] = [];
        for (const m of state.gameMessages) {
            if (m.observationId === undefined || seen.has(m.observationId)) continue;
            seen.add(m.observationId);
            fresh.push(m.text);
        }
        const xp = fm(state).experience;
        if (xp > lastXp) ev.push(`xp+${(xp - lastXp) / 25}`);
        lastXp = xp;
        if (fresh.some(x => /You attempt to light/.test(x))) { evs.push({ t, kind: 'start', level, tile: me }); ev.push('start'); lastProgress = t; }
        if (fresh.some(x => /fire catches/.test(x))) lastProgress = t;
        if (fresh.some(x => /fire catches/.test(x))) {
            evs.push({ t, kind: 'success', level, tile: snakeTile(idx) }); ev.push('success');
            successes++; idx++; phase = 'idle'; notBefore = t + SEND;
            rejectedSends.push(sendsThisFire - 1); sendsThisFire = 0;
        }
        if (fresh.some(x => /can't light a fire here/.test(x))) {
            evs.push({ t, kind: 'refused', level, tile: me }); ev.push('refused'); refused++;
            idx++; phase = 'idle'; notBefore = t;
        }
        if (state.dialog.isOpen) { await sdk.sendClickDialog(0); dialogs++; ev.push('dialog'); }
        if (LEVEL && HOLD && level !== LEVEL) { await sdk.sendSay(`::setstat firemaking ${LEVEL}`); setstats++; ev.push('setstat'); }

        const logsNow = state.inventory.filter(i => logName.test(i.name)).length;
        if (prevLogs >= 0 && logsNow < prevLogs) logsUsed += prevLogs - logsNow;
        prevLogs = logsNow;
        const tinder = state.inventory.find(i => /tinderbox/i.test(i.name));
        if (phase === 'pending' && MODE === 'inv' && logsNow >= logsBefore && t - sentAt >= RETRY) phase = 'idle'; // send did not take
        if (phase === 'pending' && MODE === 'ground' && !fresh.length && t - sentAt >= 6) phase = 'idle';

        if (phase === 'idle' && t >= notBefore) {
            const target = snakeTile(idx);
            const onTarget = me[0] === target[0] && me[1] === target[1];
            if (MODE === 'inv') {
                if (!logsNow) {
                    if (RESTOCK === 'give') { await sdk.sendSay(`::give ${LOGS} 27`); restocks++; ev.push('restock'); notBefore = t + 2; }
                    else break;
                } else if (!onTarget && walkStart >= 0 && t - walkStart > 4) {
                    ev.push(`skip(${target})`); skipped++; idx++; walkStart = -1;
                } else if (!onTarget) {
                    if (walkStart < 0) walkStart = t;
                    if (t - walkedAt >= RETRY) { await sdk.sendWalk(target[0], target[1], true); walks++; walkedAt = t; ev.push(`walk(${target})`); }
                } else if (tinder) {
                    walkStart = -1;
                    const lg = state.inventory.find(i => logName.test(i.name))!;
                    await sdk.sendUseItemOnItem(tinder.slot, lg.slot);
                    sends++; sendsThisFire++; sentAt = t; logsBefore = logsNow; phase = 'pending'; ev.push('light');
                }
            } else {
                const item = state.groundItems.find(g => g.x === target[0] && g.z === target[1] && logName.test(g.name));
                if (!item) { ev.push(`nolog(${target})`); if (t - (evs.at(-1)?.t ?? startTick) > 40) break; }
                else {
                    await sendAction({ type: 'interactGroundItem', x: item.x, z: item.z, itemId: item.id, optionIndex: 4 });
                    sends++; sendsThisFire++; sentAt = t; phase = 'pending'; ev.push('light');
                }
            }
        }
        log.write(JSON.stringify({ t, me, lvl: level, xp, ev, msg: fresh }) + '\n');
    }
    await log.end();

    // ---- summary ----
    const succ = evs.filter(e => e.kind === 'success');
    const gaps: Record<number, number> = {};
    let failures = 0, expectedFails = 0;
    for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.kind !== 'success') continue;
        const prev = evs.slice(0, i).reverse().find(p => p.kind === 'success' || p.kind === 'start');
        if (!prev) continue;
        const g = e.t - prev.t;
        if (prev.kind === 'success') gaps[g] = (gaps[g] ?? 0) + 1;
        // fresh start: roll at +3, then every 4; chained: roll at +4, then every 4
        const k = prev.kind === 'start' ? Math.round((g - 3) / 4) : Math.round(g / 4) - 1;
        failures += Math.max(0, k);
        const p = chance(e.level);
        expectedFails += (1 - p) / p;
    }
    const starts = evs.filter(e => e.kind === 'start').length;
    const span = succ.length > 1 ? succ.at(-1)!.t - succ[0].t : 0;
    const rej: Record<number, number> = {};
    for (const r of rejectedSends) rej[r] = (rej[r] ?? 0) + 1;
    console.log(JSON.stringify({
        logs: LOGS, mode: MODE, level: LEVEL, hold: HOLD, row: [RX, RZ, RLEN], rows: ROWS, send: SEND,
        successes: succ.length, starts, refused, failuresInferred: failures,
        rolls: succ.length + failures, successRate: +(succ.length / Math.max(1, succ.length + failures)).toFixed(4),
        predictedRate: +(succ.reduce((a, e) => a + chance(e.level), 0) / Math.max(1, succ.length)).toFixed(4),
        expectedFails: +expectedFails.toFixed(1),
        gapBetweenSuccesses: gaps, ticksFirstToLastSuccess: span,
        ticksPerFire: span ? +(span / (succ.length - 1)).toFixed(3) : null,
        baseXpGained: +((fm(state).experience - startXp) / 25).toFixed(1), ticksTotal: state.tick - startTick,
        baseXpPerTickFirstToLast: span ? +(((fm(state).experience - startXp) / 25) * ((succ.length - 1) / succ.length) / span).toFixed(2) : null,
        sends, rejectedSendsPerFire: rej, walks, skipped, restocks, dialogs, setstats,
        logsUsed, logsPerSuccess: MODE === 'inv' ? +(logsUsed / Math.max(1, succ.length)).toFixed(3) : null,
        gapsList: succ.map((e, i) => i ? e.t - succ[i - 1].t : 0).slice(1).join(''),
        levels: [succ[0]?.level, succ.at(-1)?.level], log: OUT,
    }, null, 1));
}, { timeout: 0, printState: false });
