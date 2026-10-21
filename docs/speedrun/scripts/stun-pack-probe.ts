// Probe for stun-pack-thieve.ts (rs/106): do bury, Charge and an arrow action land when SCORED is
// standing still, and at which offsets after an observed pickpocket failure?
//
//   bun docs/speedrun/scripts/stun-pack-probe.ts <bot>
//
// Prints, per probe, the action, the tick sent, and the ticks on which prayer / magic / fletching
// xp and game messages were observed, with opFeedback's rejection counter.
import { openSession, closeSession } from '../../../speedrun/lib/session';
import type { BotWorldState } from '../../../sdk/types';

const BOT = process.argv.slice(2).find(a => !a.startsWith('--'))!;
const ses = await openSession(BOT);
const sdk = ses.sdk;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const waitTicks = async (n: number) => { const t0 = sdk.getState()!.tick; while (sdk.getState()!.tick < t0 + n) await sleep(15); };
const xp = (s: BotWorldState, n: string) => s.skills.find(k => k.name.toLowerCase() === n)!.experience;
const seen = new Set<number>();
for (const m of sdk.getState()!.gameMessages) if (m.observationId !== undefined) seen.add(m.observationId);
let last = { p: 0, m: 0, f: 0, rej: 0 };
const trace: string[] = [];
sdk.onStateUpdate(s => {
    if (!s.inGame) return;
    const fresh = s.gameMessages.filter(m => m.observationId !== undefined && !seen.has(m.observationId));
    for (const m of fresh) seen.add(m.observationId!);
    const p = xp(s, 'prayer'), mg = xp(s, 'magic'), fl = xp(s, 'fletching'), rej = s.opFeedback?.opRejectedCount ?? 0;
    const ev = [p > last.p && last.p ? 'PRAYER' : '', mg > last.m && last.m ? 'MAGIC' : '', fl > last.f && last.f ? 'FLETCH' : '', rej > last.rej ? `rej+${rej - last.rej}` : '', ...fresh.map(m => JSON.stringify(m.text))].filter(Boolean);
    if (ev.length) trace.push(`T${s.tick} ${ev.join(' ')}`);
    last = { p, m: mg, f: fl, rej };
});
const say = (c: string) => sdk.sendSay('::' + c);
await ses.bot.skipTutorial().catch(() => {});
await say('tele 0,41,51,29,37');
await waitTicks(3);
for (const it of [...sdk.getState()!.inventory]) void sdk.sendDropItem(it.slot);
await waitTicks(6);
for (const c of ['setstat magic 80', 'setstat fletching 75', 'setstat prayer 43', 'setstat thieving 80', 'setstat hitpoints 97', 'setvar magearena 8', 'give staff_of_fire 1', 'give bloodrune 300', 'give airrune 300', 'give headless_arrow 3000', 'give rune_arrowheads 3000', 'give dragon_bones 10']) await say(c);
await waitTicks(4);
const inv = () => sdk.getState()!.inventory;
console.log('inventory:', inv().map(i => `${i.slot}:${i.name}x${i.count}[${i.optionsWithIndex.map(o => o.opIndex + '=' + o.text).join('|')}]`).join(' '));
const staff = inv().find(i => /staff of fire/i.test(i.name));
if (staff) { await sdk.sendUseItem(staff.slot, staff.optionsWithIndex.find(o => /wield/i.test(o.text))?.opIndex ?? 2); await waitTicks(3); }
console.log('equipment:', JSON.stringify((sdk.getState() as any).equipment?.map((e: any) => e.name)));

const mark = (l: string) => trace.push(`T${sdk.getState()!.tick} >>> ${l}`);
const bone = () => inv().find(i => /^dragon bones$/i.test(i.name))!;
const slotOf = (re: RegExp) => inv().find(i => re.test(i.name))!;
// 1. Standing still.
mark('bury (standing)'); await sdk.sendUseItem(bone().slot, bone().optionsWithIndex.find(o => /bury/i.test(o.text))?.opIndex ?? 1); await waitTicks(4);
mark('charge (standing)'); await sdk.sendClickComponent(1193); await waitTicks(4);
mark('arrows (standing)'); await sdk.sendUseItemOnItem(slotOf(/^rune arrow(head|tip)s$/i).slot, slotOf(/^headless arrow$/i).slot); await waitTicks(4);
mark('3 charge + bury burst (fire-and-forget)');
for (let i = 0; i < 3; i++) void sdk.sendClickComponent(1193);
void sdk.sendUseItem(bone().slot, 1);
await waitTicks(5);
// 2. In stuns: one probe per stun at offset K (sent on observing f+K).
const probeSeen = new Set<number>();
for (const m of sdk.getState()!.gameMessages) if (m.observationId !== undefined) probeSeen.add(m.observationId);
for (const K of [2, 3, 4, 5, 6]) {
    let f = -1;
    const knight = () => sdk.getState()!.nearbyNpcs.filter(n => /^knight of ardougne$/i.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
    for (let i = 0; i < 400 && f < 0; i++) {
        const s = sdk.getState()!;
        if (s.gameMessages.some(m => /fail to pick/.test(m.text) && m.tick >= s.tick - 0 && m.observationId !== undefined && !probeSeen.has(m.observationId))) f = s.tick;
        for (const m of s.gameMessages) if (m.observationId !== undefined) probeSeen.add(m.observationId);
        if (f >= 0) break;
        const kn = knight(); if (kn) void sdk.sendInteractNpc(kn.index, kn.optionsWithIndex.find(o => /pickpocket/i.test(o.text))?.opIndex ?? 3);
        await waitTicks(1);
    }
    mark(`fail observed (f), probe at k=${K}`);
    while (sdk.getState()!.tick < f + K) await sleep(10);
    mark(`send bury+charge at k=${K}`);
    void sdk.sendClickComponent(1193);
    void sdk.sendUseItem(bone().slot, 1);
    await waitTicks(12 - K);
}
await waitTicks(3);
console.log(trace.join('\n'));
await closeSession(ses);
process.exit(0);
