// fm-demo (role): STEP-MANIFEST.md entry 16's demo acceptance (S03 Firemaking) on two throwaways, under
// the run-machine launcher (standalone.ts), so both clients drive through its loopback SDK gateway.
// A test double for the scored side; never run it on the scored account. Two modes:
//
//   stage  the dropper, before its fm-row role: out of the tutorial; keep the axe and drop the rest
//          of the starter kit; chop `logs` (default 20) normal logs at the nearest normal trees (a
//          32-tile scan around where it stands); then walk to the row's first tile.
//   light  the lighter (receiver: true, final: true): out of the tutorial and to the row's entry, then
//          the S03 step itself (speedrun/skills/firemaking.ts, supply row, on the same `tiles` the
//          fm-row role drops on) until the row runs out after `fires` (default 20) logs. It prints one
//          RESULT line that judges every gap between fires against the trace, on observed ticks.
//
// The judgement (entry 16's demo line). A chained gap is 4 ticks per roll. The trace shows one start
// of the roll animation per failed roll and none for the roll that lights (calibrated on the lab's
// 451 chained gaps: speedrun/lab/firemaking-accept.ts traces), so a gap passes when it equals
// 4 x (starts + 1); a walk, a dropped click or a wait for a helper breaks that equality. The demo
// passes when every gap does, all `fires` logs are lit, and no log was lost to anyone's pickup.
// The raw count of 4-tick gaps against the old 18 of 19 is reported beside it.
//
// Role options: mode ('stage' | 'light'), tiles ([[x, z], ...] in lighting order, as fm-row's),
//   logs (stage, default 20), fires (light, default 20), maxGap (light, default 40),
//   waitForRow (light, default 400: the dropper's 100-tick reveal starts when the lighter is sighted)

import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { TickLog } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import { runSteps } from '../runner/step';
import { DEFAULT_ID, steps, type LightEvent } from '../skills/firemaking';
import { ensureOutOfTutorial } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

const NORMAL_TREE = /^(tree|dead tree|evergreen)$/i;
const LOGS = /^logs$/i;
const AXE = /axe$/i;

type XZ = readonly [number, number];

export interface GapVerdict {
    /** The fire that closes the gap (1-based: the gap from fire n-1 to fire n). */
    n: number;
    gap: number;
    /** Ticks in the gap with no published state: a roll there can't be seen, so a gap with any is unverified, not failed. */
    unseen: number;
    /** Starts of the roll animation in the gap: the failed rolls. */
    starts: number;
    /** 4 x (starts + 1): the gap a chained light takes with this many failed rolls. */
    expected: number;
    chained: boolean;
}

/**
 * Judge each gap between consecutive fires from the roll animation per tick. A tick missing from
 * the trace keeps the animation of the tick before it.
 */
export function judgeGaps(fireTicks: readonly number[], anim: ReadonlyMap<number, number>): GapVerdict[] {
    const out: GapVerdict[] = [];
    for (let n = 1; n < fireTicks.length; n++) {
        const a = fireTicks[n - 1]!;
        const b = fireTicks[n]!;
        let starts = 0;
        let unseen = 0;
        let prev = anim.get(a) ?? -1;
        for (let t = a + 1; t <= b; t++) {
            if (!anim.has(t)) unseen++;
            const now = anim.get(t) ?? prev;
            if (now !== -1 && prev === -1) starts++;
            prev = now;
        }
        const expected = 4 * (starts + 1);
        out.push({ n, gap: b - a, unseen, starts, expected, chained: b - a === expected });
    }
    return out;
}

function tileList(v: unknown): XZ[] {
    if (!Array.isArray(v) || v.length === 0) throw new Error('fm-demo: tiles must be a non-empty list of [x, z]');
    return v.map((t, k) => {
        if (!Array.isArray(t) || t.length !== 2 || !t.every(Number.isInteger)) throw new Error(`fm-demo: tiles[${k}] must be [x, z]`);
        return [t[0], t[1]] as const;
    });
}

function whole(v: unknown, def: number, what: string): number {
    const n = v === undefined ? def : Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`fm-demo: ${what} must be a whole number >= 1 (got ${String(v)})`);
    return n;
}

const here = (s: BotWorldState | null): XZ => [s?.player?.worldX ?? -1, s?.player?.worldZ ?? -1];
const cheb = (a: XZ, b: XZ) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const held = (s: BotWorldState | null, re: RegExp) => (s?.inventory ?? []).filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);

async function walk(ctx: RoleContext, to: XZ, tolerance: number): Promise<void> {
    for (let attempt = 0; attempt < 4 && cheb(here(ctx.sdk.getState()), to) > tolerance; attempt++) await ctx.bot.walkTo(to[0], to[1], tolerance);
    if (cheb(here(ctx.sdk.getState()), to) > tolerance) throw new Error(`fm-demo: could not reach ${to.join(',')}`);
}

async function stage(ctx: RoleContext): Promise<void> {
    const { sdk, bot } = ctx;
    const want = whole(ctx.options.logs, 20, 'logs');
    const tiles = tileList(ctx.options.tiles);
    for (const item of [...(sdk.getState()?.inventory ?? [])]) {
        if (AXE.test(item.name) || LOGS.test(item.name)) continue;
        await bot.dropItem(item, 'all');
    }
    ctx.log('kit dropped', { inventory: sdk.getState()?.inventory.map(i => `${i.count} ${i.name}`) });
    while (held(sdk.getState(), LOGS) < want) {
        if (ctx.signal.aborted) return;
        if (held(sdk.getState(), /./) >= 28) throw new Error('fm-demo: the inventory filled before the logs did');
        const me = here(sdk.getState());
        const trees = (await sdk.scanNearbyLocs(32)).filter((l: NearbyLoc) => NORMAL_TREE.test(l.name));
        const tree = trees.sort((a, b) => cheb(me, [a.x, a.z]) - cheb(me, [b.x, b.z]))[0];
        if (!tree) throw new Error(`fm-demo: no normal tree within 32 tiles of ${me.join(',')}`);
        if (cheb(me, [tree.x, tree.z]) > 6) await walk(ctx, [tree.x, tree.z], 3);
        const r = await bot.chopTree(NORMAL_TREE);
        ctx.log('chop', { ok: r.success, message: r.message, logs: held(sdk.getState(), LOGS), tree: [tree.x, tree.z] });
    }
    await walk(ctx, tiles[0]!, 1);
    ctx.log('staged', { logs: held(sdk.getState(), LOGS), at: here(sdk.getState()), inventory: sdk.getState()?.inventory.map(i => `${i.count} ${i.name}`) });
}

async function light(ctx: RoleContext): Promise<void> {
    const { sdk, bot } = ctx;
    const tiles = tileList(ctx.options.tiles);
    const fires = whole(ctx.options.fires, 20, 'fires');
    const maxGap = whole(ctx.options.maxGap, 40, 'maxGap');
    const waitForRow = whole(ctx.options.waitForRow, 400, 'waitForRow');
    await bot.dismissBlockingUI();
    if (cheb(here(sdk.getState()), tiles[0]!) > 3) await walk(ctx, tiles[0]!, 3);

    // Observed ticks: the roll animation and position per published state.
    const anim = new Map<number, number>();
    const trace: Array<{ t: number; x: number; z: number; anim: number }> = [];
    const stop = sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p) return;
        anim.set(s.tick, p.animId);
        trace.push({ t: s.tick, x: p.worldX, z: p.worldZ, anim: p.animId });
    });
    const log = TickLog.memory(`fm-demo-${ctx.account}`);
    const session = { sdk, bot, name: ctx.account, sessionId: 1 };
    const list = steps({ tiles: tiles.map(t => [t[0], t[1]] as const), toLevel: 99, maxGap, waitForRow });
    let ended = 'done';
    const t0 = sdk.getState()?.tick ?? 0;
    await runSteps(session as never, list, { log, c: {}, shouldStop: () => ctx.signal.aborted }).catch(e => (ended = e instanceof Error ? e.message : String(e)));
    // The last fire's tick may still be filling in: one more state.
    await waitUntil(sdk, s => s.tick > (sdk.getState()?.tick ?? 0), { maxTicks: 3 }).catch(() => {});
    stop();

    const fireEvents = log.rows.filter(r => r.step === `${DEFAULT_ID} fire`).map(r => r.meta as unknown as Extract<LightEvent, { kind: 'fire' }>);
    const events = (kind: string) => log.rows.filter(r => r.step === `${DEFAULT_ID} ${kind}`).map(r => r.meta);
    const gaps = judgeGaps(fireEvents.map(f => f.tick), anim);
    const lost = events('lost');
    const nolog = events('nolog').filter(e => !(e as { first?: boolean }).first);
    const resends = events('resend');
    const refused = events('refused');
    const skips = events('skip');
    const lit = fireEvents.length;
    const pass = lit === fires && gaps.every(g => g.chained) && lost.length === 0 && nolog.length === 0 && refused.length === 0 && skips.length === 0;
    const fourTick = gaps.filter(g => g.gap === 4).length;
    const summary = log.rows.find(r => r.step === `${DEFAULT_ID} summary`)?.meta;
    const out = {
        account: ctx.account, pass, lit, planned: fires, ended,
        rule: 'every gap = 4 x (failed rolls + 1) per the trace; no walk, dropped click or helper wait; no log lost',
        gaps: gaps.map(g => [g.n, g.gap, g.starts, g.chained ? 'ok' : g.unseen ? `UNVERIFIED (${g.unseen} ticks unseen; ${g.expected} if none failed there)` : `NOT ${g.expected}`]),
        // The roll animation per tick from the first fire on: '-' none, 'a' rolling, '.' no state seen.
        strip: fireEvents.length ? Array.from({ length: fireEvents.at(-1)!.tick - fireEvents[0]!.tick + 1 }, (_, k) => { const v = anim.get(fireEvents[0]!.tick + k); return v === undefined ? '.' : v === -1 ? '-' : 'a'; }).join('') : '',
        failedRolls: gaps.reduce((a, g) => a + g.starts, 0),
        raw: { fourTickGaps: fourTick, of: gaps.length, old18of19: fourTick >= 18 },
        lost, laterNoLogWaits: nolog, resends, refused, skips,
        firstFire: fireEvents[0] ? { tick: fireEvents[0].tick, afterStart: fireEvents[0].tick - t0, tile: fireEvents[0].tile } : null,
        summary
    };
    ctx.log('result', out);
    console.log(`RESULT fm-demo ${JSON.stringify({ ...out, trace: trace.length })}`);
}

export const role: Role = {
    name: 'fm-demo',
    produces: [],
    async run(ctx) {
        await ensureOutOfTutorial(ctx);
        const mode = String(ctx.options.mode ?? '');
        if (mode === 'stage') return stage(ctx);
        if (mode === 'light') return light(ctx);
        throw new Error(`fm-demo: mode must be stage or light (got ${mode || 'none'})`);
    }
};

if (import.meta.main) await runStandalone(role);
