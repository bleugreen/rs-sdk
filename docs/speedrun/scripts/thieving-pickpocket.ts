#!/usr/bin/env bun
/**
 * Pickpocket cadence lab: clicks the target once per server tick and logs the
 * server tick of every roll (xp drop = success, "You fail to pick" = failure),
 * every server-side rejection (UNSET_MAP_FLAG while standing still), HP and
 * food use.
 *
 *   bun docs/speedrun/scripts/thieving-pickpocket.ts <bot> [flags]
 *
 * Flags:
 *   --npc=REGEX       target name (default ^Knight of Ardougne$)
 *   --level=N         ::setstat thieving N first (and again on every level-up,
 *                     so the whole sample is at level N; --hold=0 lets it climb)
 *   --attempts=N      rolls to record (default 300)
 *   --tele=l,mx,mz,lx,lz  ::tele first (default: Ardougne market knight)
 *   --hp=N            ::setstat hitpoints N first (default 99)
 *   --eat=MODE        none | stun (eat the tick a failure is seen, inside the
 *                     stun) | flow (eat on every 5th success, >= 4 ticks after
 *                     the last stun ended). Uses lobsters (::give lobster 28).
 *   --stunprobe=K     after a failure, stop clicking; send ONE click K ticks
 *                     after the failed roll, then resume at roll+14. Shows
 *                     whether a click inside the stun is queued or dropped.
 *   --every=N         click every N ticks instead of every tick (default 1)
 *   --out=PATH        JSONL per-tick log (default $TMPDIR/thieving-<npc>-<level>.jsonl)
 *
 * Ticks are the lite client's count of server ticks (one per PLAYER_INFO), so
 * gaps are server-tick gaps. Base xp = game xp / 25.
 */
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, NearbyNpc } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const NPC = new RegExp(flag('npc', '^Knight of Ardougne$')!, 'i');
const LEVEL = Number(flag('level', '0'));
const HOLD = flag('hold', '1') !== '0';
const ATTEMPTS = Number(flag('attempts', '300'));
const TELE = flag('tele', '0,41,51,29,37');
const HP = Number(flag('hp', '99'));
const EAT = flag('eat', 'none')!;
const STUNPROBE = Number(flag('stunprobe', '0'));
const EVERY = Number(flag('every', '1'));
const OUT = flag('out', `${process.env.TMPDIR ?? '/tmp'}/thieving-${NPC.source.replace(/\W+/g, '')}-${LEVEL}-${EAT}-${STUNPROBE}.jsonl`)!;

/** stat_random from PlayerOps.ts STAT_RANDOM: chance out of 256. */
function statRandom(level: number, lo: number, hi: number): number {
    const l = Math.min(level, 99);
    return (Math.floor((lo * (99 - l)) / 98) + Math.floor((hi * (l - 1)) / 98) + 1) / 256;
}
const CHANCES: Record<string, [number, number]> = {
    'knight of ardougne': [50, 240], man: [180, 240], woman: [180, 240], farmer: [150, 240],
    'warrior woman': [100, 240], 'al-kharid warrior': [100, 240], rogue: [74, 240], guard: [50, 240],
    watchman: [15, 160], paladin: [50, 150], gnome: [8, 120], hero: [6, 100],
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

await runScript(async ({ bot, sdk }) => {
    const log = Bun.file(OUT).writer();
    const thieving = (s: BotWorldState | null) => s?.skills.find(k => k.name === 'Thieving');
    const nextTick = (after: number) => new Promise<BotWorldState>(resolve => {
        const now = sdk.getState();
        if (now && now.tick > after) return resolve(now);
        const off = sdk.onStateUpdate(s => { if (s.tick > after) { off(); resolve(s); } });
    });
    const waitTicks = async (n: number) => { let t = sdk.getState()!.tick; for (let i = 0; i < n; i++) t = (await nextTick(t)).tick; };

    await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 15000);
    await bot.skipTutorial().catch(() => {});
    if (TELE && TELE !== 'none') { await sdk.sendSay(`::tele ${TELE}`); await waitTicks(3); }
    if (HP) { await sdk.sendSay(`::setstat hitpoints ${HP}`); }
    if (LEVEL) { await sdk.sendSay(`::setstat thieving ${LEVEL}`); }
    if (EAT !== 'none') { await sdk.sendSay('::give lobster 27'); }
    await waitTicks(3);
    while (sdk.getState()?.dialog.isOpen) { await sdk.sendClickDialog(0); await waitTicks(1); }

    let state = sdk.getState()!;
    let lastXp = thieving(state)!.experience;
    let lastHp = state.player!.hitpoints;
    let lastRej = state.opFeedback?.opRejectedCount ?? 0;
    const seen = new Set<number>();
    for (const m of state.gameMessages) if (m.observationId !== undefined) seen.add(m.observationId);
    const seenText = new Map<string, number>();
    for (const m of state.gameMessages) seenText.set(`${m.tick}|${m.text}`, (seenText.get(`${m.tick}|${m.text}`) ?? 0) + 1);

    type Roll = { tick: number; ok: boolean; dmg?: number; level: number; ateBefore?: number };
    const rolls: Roll[] = [];
    let clicks = 0, rejections = 0, eats = 0, combatBlocks = 0, setstats = 0, noTarget = 0;
    let target: NearbyNpc | undefined;
    let suppressUntil = -1, probeAt = -1, probeSent = 0;
    let lastStunEnd = -100, successesSinceEat = 0, lastEatTick = -100;
    const startTick = state.tick;

    while (rolls.length < ATTEMPTS) {
        state = await nextTick(state.tick);
        const t = state.tick;
        const skill = thieving(state)!;
        const hp = state.player!.hitpoints;
        const rej = state.opFeedback?.opRejectedCount ?? 0;
        const events: string[] = [];

        // New messages this tick.
        const fresh: string[] = [];
        for (const m of state.gameMessages) {
            if (m.observationId !== undefined) {
                if (seen.has(m.observationId)) continue;
                seen.add(m.observationId);
            } else {
                const k = `${m.tick}|${m.text}`;
                const n = state.gameMessages.filter(x => `${x.tick}|${x.text}` === k).length;
                if ((seenText.get(k) ?? 0) >= n) continue;
                seenText.set(k, n);
            }
            fresh.push(m.text);
        }
        if (fresh.some(x => /during combat/.test(x))) combatBlocks++;

        const dxp = skill.experience - lastXp;
        if (dxp > 0) {
            rolls.push({ tick: t, ok: true, level: skill.baseLevel - (skill.baseLevel > (LEVEL || 999) ? 1 : 0), ateBefore: t - lastEatTick });
            events.push(`xp+${dxp}`);
            successesSinceEat++;
        }
        const failed = fresh.filter(x => /You fail to pick/.test(x)).length;
        for (let i = 0; i < failed; i++) {
            rolls.push({ tick: t, ok: false, level: skill.baseLevel, ateBefore: t - lastEatTick });
            events.push('fail');
            if (STUNPROBE) { suppressUntil = t + 14; probeAt = t + STUNPROBE; }
        }
        if (fresh.some(x => /You've been stunned/.test(x))) { lastStunEnd = t + 8; events.push('stunned'); }
        if (hp < lastHp) {
            const lastFail = [...rolls].reverse().find(r => !r.ok);
            if (lastFail && lastFail.dmg === undefined) lastFail.dmg = lastHp - hp;
            events.push(`hp-${lastHp - hp}`);
        }
        if (hp > lastHp) events.push(`hp+${hp - lastHp}`);
        if (rej > lastRej) { rejections += rej - lastRej; events.push(`rej+${rej - lastRej}`); }
        lastXp = skill.experience; lastHp = hp; lastRej = rej;

        // Dismiss level-up dialogs, then hold the level.
        if (state.dialog.isOpen) { await sdk.sendClickDialog(0); events.push('dialog'); }
        if (LEVEL && HOLD && skill.baseLevel !== LEVEL) {
            await sdk.sendSay(`::setstat thieving ${LEVEL}`); setstats++;
            lastXp = -1; // next tick's xp drop from the setstat is not a roll
            events.push('setstat');
        }

        // Eating.
        const food = state.inventory.find(i => /lobster/i.test(i.name));
        if (EAT !== 'none' && !food) { await sdk.sendSay('::give lobster 27'); }
        if (food && EAT === 'stun' && failed > 0) {
            await sdk.sendUseItem(food.slot, 1); eats++; lastEatTick = t; events.push('eat');
        }
        if (food && EAT === 'flow' && dxp > 0 && successesSinceEat >= 5 && t - lastStunEnd >= 4) {
            await sdk.sendUseItem(food.slot, 1); eats++; lastEatTick = t; successesSinceEat = 0; events.push('eat');
        }

        // Target.
        if (!target || !state.nearbyNpcs.some(n => n.index === target!.index)) {
            target = state.nearbyNpcs.filter(n => NPC.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
        } else {
            target = state.nearbyNpcs.find(n => n.index === target!.index);
        }
        const op = target?.optionsWithIndex.find(o => /pickpocket/i.test(o.text));

        // Click.
        let click = (t - startTick) % EVERY === 0;
        if (t < suppressUntil) click = t === probeAt;
        if (click && target && op) {
            await sdk.sendInteractNpc(target.index, op.opIndex);
            clicks++; events.push('click');
            if (t === probeAt) { probeSent++; events.push('probe'); }
        } else if (click) { noTarget++; events.push('notarget'); }

        log.write(JSON.stringify({ t, xp: skill.experience, lvl: skill.baseLevel, hp, rej, npc: target ? [target.tileX ?? target.x, target.tileZ ?? target.z] : null, me: [state.player!.worldX, state.player!.worldZ], ev: events, msg: fresh }) + '\n');
    }
    await log.end();

    // ---- summary ----
    const gaps: Record<string, Record<number, number>> = { afterSuccess: {}, afterFail: {} };
    for (let i = 1; i < rolls.length; i++) {
        const g = rolls[i].tick - rolls[i - 1].tick;
        const bucket = rolls[i - 1].ok ? gaps.afterSuccess : gaps.afterFail;
        bucket[g] = (bucket[g] ?? 0) + 1;
    }
    const ok = rolls.filter(r => r.ok).length;
    const fails = rolls.length - ok;
    const span = rolls[rolls.length - 1].tick - rolls[0].tick;
    const name = target?.name.toLowerCase() ?? '';
    const ch = CHANCES[name] ?? CHANCES[Object.keys(CHANCES).find(k => name.includes(k)) ?? ''];
    const dmg: Record<number, number> = {};
    for (const r of rolls) if (!r.ok && r.dmg !== undefined) dmg[r.dmg] = (dmg[r.dmg] ?? 0) + 1;
    const xpPer = (thieving(state)!.experience, null);
    console.log(JSON.stringify({
        npc: target?.name, level: LEVEL, eat: EAT, stunprobe: STUNPROBE, every: EVERY,
        rolls: rolls.length, successes: ok, fails,
        successRate: +(ok / rolls.length).toFixed(4),
        predicted: ch && LEVEL ? +statRandom(LEVEL, ch[0], ch[1]).toFixed(4) : null,
        ticksFirstToLastRoll: span, rollsPerTick: +((rolls.length - 1) / span).toFixed(4),
        gapAfterSuccess: gaps.afterSuccess, gapAfterFail: gaps.afterFail,
        clicks, rejections, rejectionsPerSuccess: +(rejections / Math.max(ok, 1)).toFixed(3),
        damagePerFail: dmg, eats, setstats, combatBlocks, noTarget, probeSent, log: OUT, xpPer,
    }, null, 1));
}, { timeout: 0, printState: false });
