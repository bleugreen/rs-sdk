#!/usr/bin/env bun
/**
 * Bone-burying lab: puts N bones in the bank (as a noted stack, the way a helper
 * trade delivers them), then banks and buries them at a bank booth, logging the
 * server tick of every Prayer xp change, every bank open and every level-up
 * dialog.
 *
 *   bun docs/speedrun/scripts/prayer-bury.ts <bot> [--mode=fast|stock] [--bones=dragon_bones]
 *       [--count=N] [--start=LEVEL] [--target=LEVEL] [--tele=l,mx,mz,lx,lz]
 *
 * --mode=stock  the plain SDK way: bot.openBank / bot.withdrawItem / bot.closeBank,
 *               then one awaited sdk.sendUseItem per bone, waiting for it to go.
 * --mode=fast   the floor: one state update per tick drives fire-and-forget
 *               packets. Each tick it clicks Bury on the lowest bone slot the
 *               client sees (a click landing in the tick after an accepted bury
 *               is dropped by the server, so this costs nothing); when no bones
 *               are left it clicks the booth; once the bank is open it sends
 *               withdraw-all and close in the same tick. Level-up dialogs are
 *               dismissed in the same tick, ahead of the next Bury click.
 *
 * Defaults: dragon bones, Varrock west bank, from level 1 until level 99.
 */
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const MODE = flag('mode', 'fast');
const BONES = flag('bones', 'dragon_bones');
const START = Number(flag('start', '1'));
const TARGET = Number(flag('target', '99'));
const COUNT = Number(flag('count', '600'));
const TELE = flag('tele', '0,49,53,49,44'); // Varrock west bank (3185,3436)

await runScript(async ({ bot, sdk }) => {
    const nextTick = (after: number) => new Promise<BotWorldState>(resolve => {
        const now = sdk.getState();
        if (now && now.tick > after) return resolve(now);
        const off = sdk.onStateUpdate(st => { if (st.tick > after) { off(); resolve(st); } });
    });
    const ticks = async (n: number) => { let st = sdk.getState()!; for (let i = 0; i < n; i++) st = await nextTick(st.tick); return st; };
    const fire = (p: Promise<unknown>) => { p.catch(() => {}); };
    const prayer = (st: BotWorldState) => st.skills.find(k => k.name === 'Prayer')!;

    await sdk.waitForCondition(st => (st.player?.worldX ?? 0) > 0, 15000);
    await bot.skipTutorial().catch(() => {});
    await sdk.sendSay(`::tele ${TELE}`); await ticks(3);
    await sdk.sendSay('::setstat hitpoints 99'); await ticks(2);
    await sdk.sendSay(`::setstat prayer ${START}`); await ticks(2);

    // Empty the inventory into the bank, then bank COUNT noted bones.
    let r = await bot.openBank();
    if (!r.success) throw new Error(`openBank: ${r.message}`);
    for (const item of [...sdk.getState()!.inventory]) await bot.depositItem(item.name, -1);
    await bot.closeBank();
    await sdk.sendSay(`::give cert_${BONES} ${COUNT}`); await ticks(3);
    r = await bot.openBank();
    if (!r.success) throw new Error(`openBank: ${r.message}`);
    const cert = sdk.getState()!.inventory[0];
    await bot.depositItem(cert.name, -1);
    if (sdk.getState()!.bank.noteMode) await sdk.sendClickComponent(5387); // bank_main:com_94, withdraw as item
    await bot.closeBank();
    await ticks(2);

    let s = sdk.getState()!;
    const boneName = cert.name;
    const bankItem = () => sdk.getState()!.bank.items.find(i => i.name === boneName);
    const boneSlots = (st: BotWorldState) => st.inventory.filter(i => i.name === boneName && i.optionsWithIndex.some(o => /bury/i.test(o.text)));
    const buryOp = (st: BotWorldState) => boneSlots(st)[0]?.optionsWithIndex.find(o => /bury/i.test(o.text))!.opIndex ?? 1;
    const booth = () => sdk.getState()!.nearbyLocs
        .filter(l => /bank booth/i.test(l.name) && l.optionsWithIndex.some(o => /use|bank/i.test(o.text)))
        .sort((a, b) => a.distance - b.distance)[0];

    const xpTicks: number[] = [];
    const xpGains: number[] = [];
    const bankOpenTicks: number[] = [];
    const dialogTicks: number[] = [];
    const afterDialog: boolean[] = []; // per xp drop: was a level-up dialog open since the previous drop
    let dialogSince = false;
    let lastXp = prayer(s).experience;
    let buried = 0;
    let clicks = 0;
    let bankWasOpen = false;
    let dialogWasOpen = false;
    const t0 = s.tick;
    console.log(`setup done at tick ${t0}: bank ${bankItem()?.count ?? '?'} ${boneName}`);
    let lastXpTick = t0;
    let lastReport = t0;
    const report = (st: BotWorldState, why: string) => console.log(`[${why}] tick +${st.tick - t0} level ${prayer(st).baseLevel} buried ${buried} invBones ${boneSlots(st).length} bankLeft ${bankLeft} bankOpen ${st.bank.isOpen}/${st.interface.isOpen} dialog ${st.dialog.isOpen} msgs ${st.gameMessages.slice(-2).map(m => m.text).join(' | ')}`);
    const observe = (st: BotWorldState) => {
        if (st.tick - lastReport >= 200) { lastReport = st.tick; report(st, 'progress'); }
        if (st.tick - lastXpTick === 20) report(st, 'stall');
        const xp = prayer(st).experience;
        if (xp > lastXp) { lastXpTick = st.tick; xpTicks.push(st.tick); xpGains.push(xp - lastXp); afterDialog.push(dialogSince); dialogSince = false; buried++; }
        lastXp = xp;
        if (st.dialog.isOpen) dialogSince = true;
        const bankOpen = st.bank.isOpen || st.interface.isOpen;
        if (bankOpen && !bankWasOpen) bankOpenTicks.push(st.tick);
        bankWasOpen = bankOpen;
        if (st.dialog.isOpen && !dialogWasOpen) dialogTicks.push(st.tick);
        dialogWasOpen = st.dialog.isOpen;
    };
    // bank.items is only fresh while the bank is open, so carry the last count seen.
    let bankLeft = COUNT;
    const trackBank = (st: BotWorldState) => { if (st.bank.isOpen) bankLeft = st.bank.items.find(i => i.name === boneName)?.count ?? 0; };
    const done = (st: BotWorldState) => prayer(st).baseLevel >= TARGET;
    const outOfBones = (st: BotWorldState) => { trackBank(st); return boneSlots(st).length === 0 && bankLeft === 0 && !st.bank.isOpen; };

    if (MODE === 'fast') {
        let withdrawSentAt = -10;
        let boothSentAt = -10;
        while (!done(s) && !(outOfBones(s) && s.tick - t0 > 5)) {
            s = await nextTick(s.tick);
            observe(s);
            if (done(s)) break;
            if (s.dialog.isOpen) fire(sdk.sendClickDialog(0));
            const bones = boneSlots(s);
            const bankOpen = s.bank.isOpen || s.interface.isOpen;
            if (bankOpen) {
                if (bones.length === 0 && s.tick - withdrawSentAt > 2) {
                    const b = bankItem();
                    if (b) { fire(sdk.sendBankWithdraw(b.slot, -1)); withdrawSentAt = s.tick; }
                }
                fire(sdk.sendCloseModal());
            } else if (bones.length > 0) {
                fire(sdk.sendUseItem(bones[0].slot, buryOp(s))); clicks++;
            } else if (s.tick - boothSentAt > 1) {
                const bt = booth();
                const op = bt?.optionsWithIndex.find(o => /use.quickly/i.test(o.text)) ?? bt?.optionsWithIndex.find(o => /^bank$|use/i.test(o.text));
                if (bt && op) { fire(sdk.sendInteractLoc(bt.x, bt.z, bt.id, op.opIndex)); boothSentAt = s.tick; }
            }
        }
    } else {
        const stopObserving = sdk.onStateUpdate(st => observe(st));
        while (!done(sdk.getState()!)) {
            if (sdk.getState()!.dialog.isOpen) await sdk.sendClickDialog(0);
            if (boneSlots(sdk.getState()!).length === 0) {
                if (!(await bot.openBank()).success) break;
                if (!bankItem()?.count) break;
                // withdraw-all of a bigger stack reports success=false (partial); only an empty result is a failure
                const w = await bot.withdrawItem(boneName, -1);
                if (!w.amountWithdrawn) throw new Error(`withdraw: ${w.message}`);
                await bot.closeBank();
            }
            const snapshot = boneSlots(sdk.getState()!);
            for (const [idx, bone] of snapshot.entries()) {
                if (done(sdk.getState()!)) break;
                if (sdk.getState()!.dialog.isOpen) await sdk.sendClickDialog(0);
                const sentTick = sdk.getState()!.tick;
                const res = await sdk.sendUseItem(bone.slot, buryOp(sdk.getState()!)); clicks++;
                // Wait for the bone itself. Waking on "dialog open" as well races the previous
                // level-up dialog: the wait returns at once, the next click lands while the
                // player is still delayed, the server drops it, and the loop waits out the timeout.
                await sdk.waitForCondition(st => !st.inventory.some(i => i.slot === bone.slot && i.name === boneName), 5000)
                    .catch(() => report(sdk.getState()!, `stock timeout: bone #${idx} slot ${bone.slot} sent at +${sentTick - t0} result ${res.success}/${res.message} slots ${snapshot.map(b => b.slot).join(',')}`));
            }
        }
        stopObserving();
        s = sdk.getState()!;
    }

    const tEnd = xpTicks.at(-1) ?? s.tick;
    // Gaps between consecutive xp drops, split by whether a level-up dialog came between them
    // and whether a bank visit did.
    const gaps: Record<string, Record<number, number>> = { plain: {}, afterDialog: {}, bankVisit: {} };
    for (let i = 1; i < xpTicks.length; i++) {
        const g = xpTicks[i] - xpTicks[i - 1];
        const banked = bankOpenTicks.some(t => t > xpTicks[i - 1] && t <= xpTicks[i]);
        const key = banked ? 'bankVisit' : afterDialog[i] ? 'afterDialog' : 'plain';
        gaps[key][g] = (gaps[key][g] ?? 0) + 1;
    }
    // A bank cycle runs from one bank open to the next.
    const cycles = bankOpenTicks.slice(1).map((t, i) => t - bankOpenTicks[i]);
    const gainedBase = xpGains.reduce((a, b) => a + b, 0) / 25;
    console.log(JSON.stringify({
        mode: MODE, bones: boneName, start: START, target: TARGET, finalLevel: prayer(s).baseLevel,
        buried, clicks, baseXpGained: gainedBase,
        ticksFirstActionToLastXp: tEnd - t0,
        firstXpTick: (xpTicks[0] ?? t0) - t0,
        baseXpPerTick: +(gainedBase / (tEnd - t0)).toFixed(3),
        gaps, bankOpens: bankOpenTicks.length, cycleTicks: cycles,
        levelUpDialogs: dialogTicks.length,
    }, null, 1));
}, { timeout: 0, printState: false });
