// bone-receiver (role, local lab only): a stand-in for the scored account's S07
// step, to measure the bone giver (bone-giver.ts) from the scored side. It stands
// on the chopping tile, writes the cue (its name hash) for the giver, buries one
// bone every `buryEvery` ticks as the knife cycle does (so it is busy two ticks in
// three, like the real loop, and the giver's requests really bounce), and when its
// last bone is gone takes the next load with lib/trade.ts receiveFrom, as the
// run's step script does. On the loads listed in `pageLoads` it raises a real
// level-up page right after the trade and holds it open `holdTicks` ticks, the
// case where the giver's request is refused until the page closes.
//
// Prints `RESULT bone-receiver {...}`: per load, the ticks from its trade click
// to the bones in its pack, whether a request was standing at the click, the gap
// from its last bury to its next, and for page loads the ticks from the page
// closing to the giver's request reaching it.
//
// Role options: giver (account, required), loads (default 8), n (23), buryEvery (3),
//   site {x,z} (default the oak tile 2914,3494), pageLoads (default [2, 5]), holdTicks (6)
import type { BotWorldState } from '../../sdk/types';
import { receiveFrom } from '../lib/trade';
import { CueWriter, cueDir, FrameLog } from './altar-cue';
import { cheat, count, isLocalServer, labTele, pos, until, type Tile } from './altar-room';
import { S07_SITES } from './bone-giver';
import { runStandalone, type Role, type RoleContext } from './role';

const BONES = /^dragon bones$/i;
/** How a trade request shows in the receiver's chat (lite/protocol/incoming.ts: type 4, "wishes to trade with you."). */
const isRequestFrom = (giver: string) => (m: { type: number; text: string; sender: string }) =>
    m.type === 4 && /wishes to trade/i.test(m.text) && m.sender.toLowerCase().replace(/\s+/g, '_') === giver.toLowerCase();

interface LoadResult {
    load: number;
    ok: boolean;
    clickToBones: number;
    standingAtClick: boolean;
    /** Ticks from the last bury of the previous load to the first bury of this one (3 when the trade cost nothing). */
    buryGap?: number;
    page?: { held: number; requestAfterClose: number | null };
    reason?: string;
}

export const role: Role = {
    name: 'bone-receiver',
    produces: [],
    async run(ctx: RoleContext) {
        if (!isLocalServer()) throw new Error('bone-receiver is a lab stand-in; it uses staff commands');
        const o = ctx.options;
        const giver = String(o.giver ?? '');
        if (!giver) throw new Error('bone-receiver: options.giver is required');
        const loads = Number(o.loads ?? 8);
        const n = Number(o.n ?? 23);
        const buryEvery = Number(o.buryEvery ?? 3);
        const site: Tile = (o.site as Tile) ?? S07_SITES[0]!.receiver;
        const pageLoads = new Set((o.pageLoads as number[]) ?? [2, 5]);
        const holdTicks = Number(o.holdTicks ?? 6);
        const { sdk } = ctx;
        const s = () => sdk.getState() as BotWorldState;

        const frames = new FrameLog();
        const unsub = sdk.onStateUpdate(st => void frames.add(st.tick));
        const writer = new CueWriter(cueDir(), ctx.account);
        const results: LoadResult[] = [];
        try {
            await cheat(ctx, '~clearinv inv');
            await until(ctx, st => st.inventory.length === 0, 10);
            if (pos(s()).x !== site.x || pos(s()).z !== site.z) await labTele(ctx, site);
            await until(ctx, () => frames.recent().length >= 4, 10);
            writer.write({ beacons: frames.recent(), turns: [] });

            let lastBury = -1;
            let requestSince = s().tick;
            for (let load = 0; load < loads && !ctx.signal.aborted; load++) {
                // The trade, once the pack is empty (the first load starts empty).
                const standingAtClick = s().gameMessages.some(m => m.tick >= requestSince && isRequestFrom(giver)(m));
                const r = await receiveFrom(sdk, giver, { want: [{ item: BONES, amount: n }], openTimeoutMs: 60_000 });
                const res: LoadResult = { load, ok: r.ok && count(s(), BONES) >= n, clickToBones: r.ticks, standingAtClick, ...(r.reason ? { reason: r.reason } : {}) };
                results.push(res);
                ctx.log('load', { ...res });
                if (!res.ok) break;

                if (pageLoads.has(load)) {
                    // A level-up page right after the trade, while the giver restocks and requests again.
                    const level = sdk.getSkill('woodcutting')?.baseLevel ?? 1;
                    await cheat(ctx, `advancestat woodcutting ${Math.min(99, level + 1)}`);
                    if (await until(ctx, st => st.dialog.isOpen, 10)) {
                        const opened = s().tick;
                        await until(ctx, st => st.tick >= opened + holdTicks, holdTicks + 5);
                        await ctx.bot.dismissBlockingUI();
                        await until(ctx, st => !st.dialog.isOpen, 10);
                        const closed = s().tick;
                        const got = await until(ctx, st => st.gameMessages.some(m => m.tick >= closed && isRequestFrom(giver)(m)), 20);
                        const at = got ? s().gameMessages.filter(m => m.tick >= closed && isRequestFrom(giver)(m))[0]!.tick : null;
                        res.page = { held: closed - opened, requestAfterClose: at === null ? null : at - closed };
                        ctx.log('page', { load, ...res.page });
                    }
                }
                requestSince = s().tick;

                // The knife cycle's buries: one bone per `buryEvery` ticks until the pack is empty.
                let first = true;
                while (count(s(), BONES) > 0 && !ctx.signal.aborted) {
                    const bone = s().inventory.find(i => BONES.test(i.name));
                    const op = bone?.optionsWithIndex.find(x => /bury/i.test(x.text));
                    if (!bone || !op) throw new Error('no buryable bone in the pack');
                    const t = s().tick;
                    if (first && lastBury >= 0) res.buryGap = t - lastBury;
                    first = false;
                    lastBury = t;
                    const before = count(s(), BONES);
                    void sdk.sendUseItem(bone.slot, op.opIndex);
                    await until(ctx, st => count(st, BONES) < before, 6);
                    await until(ctx, st => st.tick >= t + buryEvery, buryEvery + 4);
                }
                requestSince = Math.min(requestSince, s().tick);
            }
        } finally {
            unsub();
            const last = frames.recent(1);
            if (last.length) writer.stop(last);
        }
        const done = results.filter(r => r.ok);
        const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
        console.log(
            `RESULT bone-receiver ${JSON.stringify({
                loads: results.length,
                ok: done.length,
                clickToBones: { mean: mean(done.map(r => r.clickToBones)), all: done.map(r => r.clickToBones) },
                standingAtClick: done.filter(r => r.standingAtClick).length,
                buryGap: { mean: mean(done.flatMap(r => (r.buryGap === undefined ? [] : [r.buryGap]))), all: done.map(r => r.buryGap ?? null) },
                pages: results.flatMap(r => (r.page ? [{ load: r.load, ...r.page }] : []))
            })}`
        );
    }
};

if (import.meta.main) await runStandalone(role);
