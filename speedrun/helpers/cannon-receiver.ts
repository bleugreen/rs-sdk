// cannon-receiver (role): a stand-in for the scored account's side of the cannon
// hand-off (H11/H23, docs/speedrun/SUPPLIES.md), to rehearse the cannon holder's
// serve mode (cannon.ts) on the lab or the demo. It writes the cue (its own name
// hash) for the holder, stands on `tile`, waits for the holder and its standing
// request, and takes the set and the balls with lib/trade.ts receiveFrom, as the
// run's step does. Then, optionally: Set-up on the base (lab only) to show whether
// this account's quest state lets it use the cannon, and the set and balls given
// back to the holder in one trade (the H11r direction).
//
// Prints `RESULT cannon-receiver {...}`: the trade's ticks on this account's clock
// (its trade click to the items in its pack), whether the holder's request was
// standing at the click, what arrived, the Set-up message, and the give-back.
//
// Role options: giver (account, required), tile {x,z} (required), balls (required),
//   giveBack (default false), waitTicks for the holder (default 6000),
//   lab only: questVarp (::setvar mcannon N first; 11 is complete), setUp (default false)
import type { BotWorldState } from '../../sdk/types';
import { give, receiveFrom, sameName } from '../lib/trade';
import { CueWriter, cueDir, FrameLog, scopeOption } from './altar-cue';
import { chebyshev, cheat, isLocalServer, labTele, pos, standOn, until, type Tile } from './altar-room';
import { holdsLoad, loadSpecs, loadWant } from './cannon';
import { ensureOutOfTutorial, walkNear } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

const BALL = /^cannonball$/i;

export interface ReceiverResult {
    ok: boolean;
    /** Receiver clock: its trade click to the items in its pack. */
    ticks: number;
    standingAtClick: boolean;
    received: string[];
    reason?: string;
    setUp?: { message: string | null; placed: boolean; pickedUp: boolean };
    gaveBack?: { ok: boolean; giverTicks: number; reason?: string };
}

const lines = (s: BotWorldState, since: number) => s.gameMessages.filter(m => m.tick > since && m.type === 0).map(m => m.text);

/** Lab: Set-up on the base and record the answer; pick the base up again if it went down. */
async function trySetUp(ctx: RoleContext): Promise<NonNullable<ReceiverResult['setUp']>> {
    const { sdk } = ctx;
    const s = () => sdk.getState() as BotWorldState;
    const base = s().inventory.find(i => /^cannon base$/i.test(i.name));
    const op = base?.optionsWithIndex.find(o => /set-?up/i.test(o.text));
    if (!base || !op) return { message: 'no Set-up option on a carried base', placed: false, pickedUp: false };
    const since = s().tick;
    await sdk.sendUseItem(base.slot, op.opIndex);
    const answer = /place the cannon base|can't set up|need to complete|enough space|won't be happy|can't set up a cannon here/i;
    await until(ctx, st => lines(st, since).some(t => answer.test(t)), 20);
    const message = lines(s(), since).find(t => answer.test(t)) ?? null;
    const placed = !!message && /place the cannon base/i.test(message);
    let pickedUp = false;
    if (placed) {
        const loc = sdk.getNearbyLocs().find(l => /^cannon base$/i.test(l.name));
        const pick = loc?.optionsWithIndex.find(o => /pick-?up/i.test(o.text));
        if (loc && pick) {
            await sdk.sendInteractLoc(loc.x, loc.z, loc.id, pick.opIndex);
            pickedUp = await until(ctx, st => st.inventory.some(i => /^cannon base$/i.test(i.name)), 20);
        }
    }
    return { message, placed, pickedUp };
}

export const role: Role = {
    name: 'cannon-receiver',
    produces: [],
    async run(ctx: RoleContext) {
        const o = ctx.options;
        const giver = String(o.giver ?? '');
        if (!giver) throw new Error('cannon-receiver: options.giver is required');
        const t = (o.tile ?? {}) as Tile;
        if (!Number.isInteger(t.x) || !Number.isInteger(t.z)) throw new Error('cannon-receiver: options.tile {x,z} is required');
        const tile: Tile = { x: t.x, z: t.z };
        const balls = Number(o.balls);
        if (!Number.isInteger(balls) || balls < 1) throw new Error('cannon-receiver: options.balls is required');
        const scope = scopeOption(o.scope, ['cannon']);
        const lab = isLocalServer();
        if ((o.questVarp !== undefined || o.setUp) && !lab) throw new Error('questVarp and setUp are for the local lab only');
        const { sdk } = ctx;
        const s = () => sdk.getState() as BotWorldState;

        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        if (lab) {
            await cheat(ctx, '~clearinv inv');
            await until(ctx, st => st.inventory.length === 0, 10);
            if (o.questVarp !== undefined) await cheat(ctx, `setvar mcannon ${Number(o.questVarp)}`);
        }
        if (process.env.HELPER_LAB_TELE === '1' && chebyshev(pos(s()), tile) > 30) await labTele(ctx, tile);
        if (!(await walkNear(ctx, tile.x, tile.z, 2))) throw new Error(`could not reach ${tile.x},${tile.z}`);
        await standOn(ctx, tile);

        const frames = new FrameLog();
        const unsub = sdk.onStateUpdate(st => void frames.add(st.tick));
        const writer = new CueWriter(cueDir(), ctx.account, scope);
        let result: ReceiverResult = { ok: false, ticks: 0, standingAtClick: false, received: [], reason: 'not started' };
        try {
            await until(ctx, () => frames.recent().length >= 4, 10);
            writer.write({ beacons: frames.recent(), turns: [] });
            ctx.log('cue written', { at: pos(s()) });

            const since = s().tick;
            const near = (st: BotWorldState) => st.nearbyPlayers.some(p => sameName(p.name, giver));
            const requested = (st: BotWorldState) => st.gameMessages.some(m => m.tick >= since && m.type === 4 && /wishes to trade/i.test(m.text) && sameName(m.sender, giver));
            if (!(await until(ctx, near, Number(o.waitTicks ?? 6000)))) {
                result = { ...result, reason: 'the holder never came into sight' };
                return;
            }
            ctx.log('holder in sight', { tick: s().tick });
            // The run's step clicks when it is ready; give the holder's request a moment to stand first.
            await until(ctx, requested, 30);
            const standingAtClick = requested(s());
            const r = await receiveFrom(sdk, giver, { want: loadWant(balls), openTimeoutMs: 60_000 });
            result = { ok: r.ok && holdsLoad(s().inventory, balls), ticks: r.ticks, standingAtClick, received: r.received.map(i => `${i.name} x${i.count}`), ...(r.reason ? { reason: r.reason } : {}) };
            ctx.log('received', { ...result });
            if (!result.ok) return;

            if (o.setUp) {
                result.setUp = await trySetUp(ctx);
                ctx.log('set-up', { ...result.setUp });
            }
            if (o.giveBack) {
                const held = s().inventory.filter(i => BALL.test(i.name)).reduce((a, i) => a + i.count, 0);
                const g = await give(sdk, giver, held > 0 ? loadSpecs(held) : loadSpecs(1).slice(0, 4), { openTimeoutMs: 60_000 });
                result.gaveBack = { ok: g.ok, giverTicks: g.ticks, ...(g.reason ? { reason: g.reason } : {}) };
                ctx.log('gave back', { ...result.gaveBack, gave: g.gave.map(i => `${i.name} x${i.count}`) });
                // A final role's exit stops the launcher: let the holder log its side of the trade first.
                await sdk.waitForTicks(5);
            }
        } finally {
            unsub();
            const last = frames.recent(1);
            if (last.length) writer.stop(last);
            console.log(`RESULT cannon-receiver ${JSON.stringify(result)}`);
        }
    }
};

if (import.meta.main) await runStandalone(role);
