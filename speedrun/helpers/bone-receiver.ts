// bone-receiver (role, a stand-in, never the scored account): a stand-in for the scored account's S07
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
//   site {x,z} (default the oak tile 2914,3494), pageLoads (default [2, 5]), holdTicks (6),
//   asks [15, 21, ...]: S18's top-ups instead (the giver in mode on-request): click trade,
//   and on the frame that shows it open write that many bones as the top-up ask
//   (altar-cue.ts writeTopUpAsk), as the Thieving module does; loads = asks.length;
//   item (default 'Dragon bones'): the bones it takes and buries.
//   returnLoads (S07's trade-and-return rehearsal, with `givers`): bury nothing. Each load goes straight
//   back to the giver that served it (the giver's `acceptReturn`), then the stand-in waits out
//   `paceTicks` (default n x buryEvery, a load's bury time) from the receive before the next, so
//   the rotation runs at the run's pace. At the end it waits for every giver to go off (each banks
//   what it holds first), so every giver's bank ends as it was staged. It banks, eats and equips
//   nothing, and needs the free slots for the biggest load (n, or finalN plus the extras).
//
// On the local lab it clears its pack and teleports with staff commands. Anywhere else (the
// demo) it uses none: it banks what it carries at Falador west, walks to the site, and raises
// no level-up pages. There it runs only as a run-machine test account (STAND_IN_ACCOUNTS), never
// a fleet or scored account, because it buries what it is given; with returnLoads it buries and
// banks nothing, so any helper outside the forbidden list and the group will do.
import type { BotWorldState } from '../../sdk/types';
import { give, receiveFrom, tradeOf } from '../lib/trade';
import { canonName, CueWriter, cueDir, FrameLog, scopeOption, writeTopUpAsk } from './altar-cue';
import { altarData, altarRoomOf, cheat, count, exactItem, isLocalServer, labTele, leaveRoom, pos, standOn, until, type Tile } from './altar-room';
import { awaitBoneServer, DEFAULT_BONE_BANK, readBoneStatuses, S07_SITES } from './bone-giver';
import { FORBIDDEN_ACCOUNTS } from './fleet-config';
import { closeBank, depositAllExcept, openBank, walkNear } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

/** The run machine's test accounts (bbs ~/rs-run-machine/bots), the only ones the stand-in runs as off the lab. */
export const STAND_IN_ACCOUNTS: ReadonlySet<string> = new Set(['cairn_h70', 'cairn_h71', 'cairn_h72', 'cairn_h75']);

/**
 * Off the lab: refuse any account but a run-machine test account, or with `returnLoads` (it keeps
 * nothing) any helper that is neither forbidden nor one of the givers.
 */
export function assertDemoStandIn(account: string, o: { returnLoads?: boolean; givers?: readonly string[] } = {}): void {
    const a = canonName(account);
    if (o.returnLoads) {
        if (FORBIDDEN_ACCOUNTS.has(a) || !/^cairn_[a-z0-9_]+$/.test(a) || (o.givers ?? []).map(canonName).includes(a)) {
            throw new Error(`bone-receiver with returnLoads runs as a cairn_ helper that is neither forbidden nor a giver (got ${account})`);
        }
        return;
    }
    if (FORBIDDEN_ACCOUNTS.has(a) || !STAND_IN_ACCOUNTS.has(a)) {
        throw new Error(`bone-receiver buries what it is given: off the local lab it runs only as a run-machine test account (${[...STAND_IN_ACCOUNTS].join(', ')}), never a fleet or scored account (got ${account})`);
    }
}
/** How a trade request shows in the receiver's chat (lite/protocol/incoming.ts: type 4, "wishes to trade with you."). */
const isRequestFrom = (giver: string) => (m: { type: number; text: string; sender: string }) =>
    m.type === 4 && /wishes to trade/i.test(m.text) && m.sender.toLowerCase().replace(/\s+/g, '_') === giver.toLowerCase();

interface LoadResult {
    load: number;
    /** The giver this load came from. */
    giver?: string;
    /** The last load's extras received, against what was due. */
    extras?: string[];
    /** With a bone list: how many of each the load brought. */
    bones?: string[];
    ok: boolean;
    clickToBones: number;
    standingAtClick: boolean;
    /** Ticks from the last bury of the previous load to the first bury of this one (3 when the trade cost nothing). */
    buryGap?: number;
    /** returnLoads: ticks from wanting the load (pace over) to the trade click: a stall when the group had nobody ready. */
    waitForGiver?: number;
    /** returnLoads: the hand-back to the giver. */
    returned?: { ok: boolean; ticks: number; reason?: string };
    /** returnLoads: ticks from the previous load's receive to this one's. */
    loadGap?: number;
    page?: { held: number; requestAfterClose: number | null };
    reason?: string;
}

export const role: Role = {
    name: 'bone-receiver',
    produces: [],
    async run(ctx: RoleContext) {
        const lab = isLocalServer();
        const o = ctx.options;
        const returnLoads = o.returnLoads === true;
        if (returnLoads && !Array.isArray(o.givers)) throw new Error('bone-receiver: returnLoads needs givers (the group whose loads go back)');
        if (!lab) assertDemoStandIn(ctx.account, { returnLoads, givers: Array.isArray(o.givers) ? (o.givers as string[]) : [] });
        // item: one bone, or the givers' priority list (bone-giver.ts item), every one of which it takes and buries.
        const boneNames = (Array.isArray(o.item) ? o.item : [o.item ?? 'Dragon bones']).map(String);
        const BONES = new RegExp(`^(?:${boneNames.map(n => exactItem(n).source.slice(1, -1)).join('|')})$`, 'i');
        // One giver by name, or a group taking turns (bone-giver.ts group): then each load comes from the group's server (boneServer).
        const givers = Array.isArray(o.givers) ? (o.givers as string[]).map(String) : null;
        if (!!givers === (o.giver !== undefined)) throw new Error('bone-receiver: give exactly one of options.giver and options.givers');
        const named = String(o.giver ?? '');
        if (!givers && !named) throw new Error('bone-receiver: options.giver must name the giver');
        let giver = named;
        const asks = Array.isArray(o.asks) ? (o.asks as number[]).map(Number) : null;
        const loads = asks ? asks.length : Number(o.loads ?? 8);
        // The giver it stands in for reads only its own step's cue: 'courier' for the asks (S18), else 'bone' (S07).
        const scope = scopeOption(o.scope, [asks ? 'courier' : 'bone']);
        // finalExtras [{ item, count }] (and finalN, default n - extras): the last load also brings these, as S07's last load brings T07-08's runes.
        const finalExtras = ((o.finalExtras ?? []) as { item: string; count: number }[]).map(e => ({ item: exactItem(String(e.item)), name: String(e.item), count: Number(e.count) }));
        if (asks && finalExtras.length) throw new Error('bone-receiver: finalExtras is for the standing loads (S07)');
        const finalN = Number(o.finalN ?? Number(o.n ?? 23) - finalExtras.length);
        const isLast = (load: number) => finalExtras.length > 0 && load === loads - 1;
        const sizeOf = (load: number) => (asks ? asks[load]! : isLast(load) ? finalN : Number(o.n ?? 23));
        const buryEvery = Number(o.buryEvery ?? 3);
        const site: Tile = (o.site as Tile) ?? S07_SITES[0]!.receiver;
        // A level-up page needs a staff command, so the demo raises none.
        const pageLoads = new Set((o.pageLoads as number[]) ?? (lab ? [2, 5] : []));
        if (!lab && pageLoads.size) throw new Error('bone-receiver: pageLoads need staff commands (local lab only)');
        const holdTicks = Number(o.holdTicks ?? 6);
        if (returnLoads && pageLoads.size && o.pageLoads !== undefined) throw new Error('bone-receiver: returnLoads raises no pages');
        if (returnLoads) pageLoads.clear();
        const paceTicks = Number(o.paceTicks ?? Number(o.n ?? 23) * buryEvery);
        const { sdk } = ctx;
        const s = () => sdk.getState() as BotWorldState;

        const frames = new FrameLog();
        /** The bones to ask for once the next trade opens (asks mode). */
        let pendingAsk: number | null = null;
        const unsub = sdk.onStateUpdate(st => {
            frames.add(st.tick);
            if (pendingAsk !== null && tradeOf(st).isOpen) {
                writeTopUpAsk(cueDir(), [{ item: BONES.source, count: pendingAsk }]);
                pendingAsk = null;
            }
        });
        const writer = new CueWriter(cueDir(), ctx.account, scope);
        const results: LoadResult[] = [];
        try {
            const biggest = Math.max(Number(o.n ?? 23), finalN + finalExtras.length);
            if (lab && !returnLoads) {
                await cheat(ctx, '~clearinv inv');
                await until(ctx, st => st.inventory.length === 0, 10);
                if (pos(s()).x !== site.x || pos(s()).z !== site.z) await labTele(ctx, site);
            } else if (returnLoads) {
                // It keeps nothing, so it banks nothing: its pack must already have a load's free slots.
                const free = 28 - s().inventory.length;
                if (free < biggest) throw new Error(`returnLoads: the pack has ${free} free slots, the biggest load needs ${biggest}; free them before the run (it banks nothing)`);
                const room = altarRoomOf(s());
                if (room) await leaveRoom(ctx, altarData(room));
                if (lab && (pos(s()).x !== site.x || pos(s()).z !== site.z)) await labTele(ctx, site);
                if (!lab && !(await walkNear(ctx, site.x, site.z, 2))) throw new Error(`could not reach the site ${site.x},${site.z}`);
                await standOn(ctx, site);
            } else {
                // Left in an altar room (the Runecraft stand-in uses these accounts too): out by its portal first.
                const room = altarRoomOf(s());
                if (room) {
                    ctx.log('leaving the altar room', { altar: room });
                    await leaveRoom(ctx, altarData(room));
                }
                // An empty pack has a load's free slots: bank what we carry at the givers' bank, then walk over.
                if (s().inventory.length) {
                    const bank = DEFAULT_BONE_BANK;
                    if (!(await walkNear(ctx, bank.x, bank.z, 3))) throw new Error('could not reach Falador west bank');
                    if (!(await openBank(ctx))) throw new Error('could not open the bank');
                    await depositAllExcept(sdk);
                    await closeBank(ctx);
                    if (s().inventory.length) throw new Error(`the pack still holds ${s().inventory.length} items after the deposit`);
                }
                if (!(await walkNear(ctx, site.x, site.z, 2))) throw new Error(`could not reach the site ${site.x},${site.z}`);
                await standOn(ctx, site);
            }
            await until(ctx, () => frames.recent().length >= 4, 10);
            writer.write({ beacons: frames.recent(), turns: [] });

            let lastBury = -1;
            let requestSince = s().tick;
            let lastReceive = -1;
            for (let load = 0; load < loads && !ctx.signal.aborted; load++) {
                const wantedAt = s().tick;
                // The trade, once the pack is empty (the first load starts empty) and the giver is beside us.
                if (givers) {
                    const { server } = await awaitBoneServer(sdk, cueDir(), givers);
                    if (!server) {
                        results.push({ load, ok: false, clickToBones: 0, standingAtClick: false, reason: 'no group giver ready' });
                        break;
                    }
                    giver = server;
                }
                const near = (st: BotWorldState) => st.nearbyPlayers.some(p => p.name.toLowerCase().replace(/\s+/g, '_') === giver.toLowerCase());
                if (!(await until(ctx, near, 400))) {
                    results.push({ load, ok: false, clickToBones: 0, standingAtClick: false, reason: 'giver never came into sight' });
                    break;
                }
                const standingAtClick = s().gameMessages.some(m => m.tick >= requestSince && isRequestFrom(giver)(m));
                const waitForGiver = s().tick - wantedAt;
                const n = sizeOf(load);
                if (asks) pendingAsk = n;
                const extras = isLast(load) ? finalExtras : [];
                const r = await receiveFrom(sdk, giver, { want: [{ item: BONES, amount: n }, ...extras.map(e => ({ item: e.item, amount: e.count }))], openMaxTicks: 200 });
                const extrasOk = extras.every(e => count(s(), e.item) >= e.count);
                const res: LoadResult = {
                    load,
                    giver,
                    ok: r.ok && count(s(), BONES) >= n && extrasOk,
                    clickToBones: r.ticks,
                    standingAtClick,
                    ...(extras.length ? { extras: extras.map(e => `${count(s(), e.item)} of ${e.count} ${e.name}`) } : {}),
                    ...(boneNames.length > 1 ? { bones: boneNames.map(b => `${count(s(), exactItem(b))} ${b}`) } : {}),
                    ...(returnLoads ? { waitForGiver, ...(lastReceive >= 0 ? { loadGap: s().tick - lastReceive } : {}) } : {}),
                    ...(r.reason ? { reason: r.reason } : {})
                };
                results.push(res);
                if (!res.ok) {
                    ctx.log('load', { ...res });
                    break;
                }
                if (returnLoads) {
                    // Straight back to the giver that served it: exactly what the trade brought, by exact name
                    // (anything the pack already held stays).
                    const received = s().tick;
                    lastReceive = received;
                    const back = new Map<string, number>();
                    for (const i of r.received) back.set(i.name, (back.get(i.name) ?? 0) + i.count);
                    const g = await give(sdk, giver, [...back].map(([name, c]) => ({ item: exactItem(name), n: c })), { openTimeoutMs: 60_000 });
                    res.returned = { ok: g.ok, ticks: g.ticks, ...(g.reason ? { reason: g.reason } : {}) };
                    ctx.log('load', { ...res });
                    if (!g.ok) break;
                    // The bury time the run would spend on this load, so the rotation keeps the run's pace.
                    await until(ctx, st => st.tick >= received + paceTicks, paceTicks + 20);
                    continue;
                }
                ctx.log('load', { ...res });

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
            if (returnLoads && givers) {
                // Each giver banks what it holds and goes off once the group has given its loads: wait for all of them.
                const off = () => {
                    const st = readBoneStatuses(cueDir()).filter(b => givers.map(canonName).includes(canonName(b.account)));
                    return st.length === givers.length && st.every(b => b.phase === 'off');
                };
                const allOff = await until(ctx, off, 900);
                ctx.log('givers', { allOff, statuses: readBoneStatuses(cueDir()).filter(b => givers.map(canonName).includes(canonName(b.account))).map(b => ({ account: b.account, phase: b.phase, trades: b.trades, detail: b.detail ?? null })) });
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
                givers: done.map(r => r.giver ?? null),
                ...(returnLoads
                    ? {
                          returned: done.filter(r => r.returned?.ok).length,
                          returnTicks: { mean: mean(done.flatMap(r => (r.returned ? [r.returned.ticks] : []))), all: done.map(r => r.returned?.ticks ?? null) },
                          waitForGiver: { max: Math.max(0, ...done.map(r => r.waitForGiver ?? 0)), all: done.map(r => r.waitForGiver ?? null) },
                          loadGap: { mean: mean(done.flatMap(r => (r.loadGap === undefined ? [] : [r.loadGap]))), max: Math.max(0, ...done.map(r => r.loadGap ?? 0)) }
                      }
                    : {}),
                buryGap: { mean: mean(done.flatMap(r => (r.buryGap === undefined ? [] : [r.buryGap]))), all: done.map(r => r.buryGap ?? null) },
                pages: results.flatMap(r => (r.page ? [{ load: r.load, ...r.page }] : []))
            })}`
        );
    }
};

if (import.meta.main) await runStandalone(role);
