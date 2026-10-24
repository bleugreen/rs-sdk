// Lab check of the bones role's blue_dragon spot (speedrun/helpers/bones.ts): a staffed account at
// 99 melee in the adamant set runs the real role from Falador west bank: down Taverley dungeon,
// through the dusty-key door, adult blue dragons in melee, dragon bones looted and banked.
//
//   NODE_TICKRATE=400 LAB_TIMEOUT=3300 speedrun/lab/lab.sh srbd1 'speedrun/lab/measure-blue-dragon.ts:--trips=2:--food=16'
//
// It starts with no anti-dragon shield anywhere, so the role must stay out of the dungeon; after
// --refuse ticks the shield is given into the inventory (not worn) and the role must wear it and
// go. Per tick it watches hitpoints, deaths, the position and the dragonfire messages
// (dragon.rs2: "Your shield absorbs most of the dragon fire!" with the shield, "horribly burnt" or
// "resist some" without). RESULT lines: the refusal, one per completed trip (from the role's
// 'banked' log), then a summary with kills and bones per hour over the bank-to-bank trips.
import { role } from '../helpers/bones';
import { memoryRoleState, type RoleContext } from '../helpers/role';
import { closeSession, openSession } from '../lib/session';
import { waitTicks } from '../lib/wait';
import { arg, botArg, result } from './common';
import { give, leaveTutorial, setStats, tele } from './setup';

const wantTrips = Number(arg('trips', '2'));
const foodPerTrip = Number(arg('food', '16'));
const refuseTicks = Number(arg('refuse', '60'));
const maxMins = Number(arg('mins', '50'));
const FALADOR_WEST_BANK = { x: 2946, z: 3368 };
const DOOR_X = 2924;

const session = await openSession(botArg());
const { sdk, bot } = session;
await leaveTutorial(session);

// ---- fixture: 99 melee, adamant set, dusty key, sharks; no shield yet ----
await setStats(sdk, { attack: 99, strength: 99, defence: 99, hitpoints: 99 });
for (const i of sdk.getState()?.inventory ?? []) await sdk.sendDropItem(i.slot);
await waitTicks(sdk, 2);
await give(sdk, ['adamant_scimitar', 'adamant_full_helm', 'adamant_platebody', 'adamant_platelegs', 'dusty_key']);
for (const re of [/^adamant scimitar$/i, /^adamant full helm$/i, /^adamant platebody$/i, /^adamant platelegs$/i]) {
    await bot.equipItem(re);
    await waitTicks(sdk, 1);
}
await give(sdk, 'shark', foodPerTrip);
await give(sdk, 'cert_shark', 300);
if (!(await tele(sdk, FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z))) throw new Error('tele to Falador west bank failed');
const s0 = sdk.getState()!;
result('fixture', {
    at: [s0.player!.worldX, s0.player!.worldZ],
    worn: s0.equipment.map(e => `${e.name} (${e.id})`),
    inventory: s0.inventory.map(i => `${i.name} x${i.count}`),
    skills: s0.skills.filter(s => s.baseLevel > 1).map(s => `${s.name} ${s.baseLevel}`)
});

// ---- monitor ----
const startTick = s0.tick;
let minHp = 99;
let deaths = 0;
let lastRespawn = s0.player!.respawnCount ?? 0;
let wentUnderground = false;
let passedDoorUnshielded = false;
const fire = { absorbed: 0, burnt: 0, resisted: 0 };
const seenMsg = new Set<string>();
const wearingShield = (s = sdk.getState()) => !!s?.equipment.some(e => e.id === 1540);
sdk.onStateUpdate(s => {
    const p = s.player;
    if (!p) return;
    const hp = s.skills.find(k => k.name === 'Hitpoints')?.level ?? p.hp;
    minHp = Math.min(minHp, hp);
    if ((p.respawnCount ?? 0) > lastRespawn) { deaths += p.respawnCount - lastRespawn; lastRespawn = p.respawnCount; console.log(`[t${s.tick}] DIED at ${p.worldX},${p.worldZ}`); }
    if (p.worldZ > 6400) wentUnderground = true;
    if (p.worldZ > 6400 && p.worldX < DOOR_X && p.worldZ > 9786 && !wearingShield(s)) passedDoorUnshielded = true;
    for (const m of s.gameMessages ?? []) {
        const key = `${m.observationId ?? m.tick}:${m.text}`;
        if (seenMsg.has(key)) continue;
        seenMsg.add(key);
        if (/shield absorbs most of the dragon fire/i.test(m.text)) fire.absorbed++;
        else if (/horribly burnt/i.test(m.text)) fire.burnt++;
        else if (/resist some of the dragon fire/i.test(m.text)) fire.resisted++;
    }
});

// ---- the role ----
const controller = new AbortController();
const trips: Record<string, unknown>[] = [];
const bankBones: { tick: number; bones: number }[] = [];
let refusalLogged = false;
let kills = 0;
const tick = () => sdk.getState()?.tick ?? 0;
const ctx: RoleContext = {
    bot, sdk, account: session.name,
    options: { spot: 'blue_dragon', foodPerTrip, trace: true },
    signal: controller.signal, state: memoryRoleState(),
    log: (message, data) => {
        if (/staying out of the spot|not entering without/.test(message)) refusalLogged = true;
        if (message === 'fight' && data?.out === 'killed') kills++;
        if (message === 'banked') {
            const t = data?.trip as Record<string, unknown> | null;
            if (t && Number(t.kills) > 0) {
                trips.push({ tick: tick(), why: data?.why, ...t });
                result(`trip ${trips.length}`, { tick: tick(), why: data?.why, ...t, stock: data?.stock });
            }
        }
        if (message !== 'fight') console.log(`[t${tick()}] ${message} ${JSON.stringify(data ?? {}).slice(0, 400)}`);
    },
    reportBank: snap => {
        const bones = snap.items.filter(i => i.id === 536).reduce((a, i) => a + i.count, 0);
        bankBones.push({ tick: tick(), bones });
    }
};
const running = role.run(ctx).catch(e => console.log(`role threw: ${String(e)}`));

// Phase 1: no shield owned. The role must not go underground.
await waitTicks(sdk, refuseTicks);
result('refusal', { ticks: refuseTicks, wentUnderground, refusalLogged, at: [sdk.getState()!.player!.worldX, sdk.getState()!.player!.worldZ] });
if (wentUnderground) throw new Error('the role went underground with no anti-dragon shield owned');

// Phase 2: the shield handed over into the inventory, not worn.
await give(sdk, 'antidragonbreathshield');
const phase2Tick = tick();
const deadline = Date.now() + maxMins * 60_000;
while (trips.length < wantTrips && Date.now() < deadline) await waitTicks(sdk, 10);
controller.abort();
await Promise.race([running, waitTicks(sdk, 40)]);

// Trips are measured bank to bank: from the first trip's bank close (the shield equipped, kit out) to the last trip's bank.
const firstTripStart = trips.length ? Number((trips[0] as { tick: number }).tick) - Number((trips[0] as { min: number }).min) * 60_000 / 400 : phase2Tick;
const spanTicks = trips.length ? Number((trips.at(-1) as { tick: number }).tick) - firstTripStart : 0;
const tripKills = trips.reduce((a, t) => a + Number(t.kills), 0);
const tripEats = trips.reduce((a, t) => a + Number(t.eats), 0);
const banked = bankBones.at(-1)?.bones ?? 0;
const perHour = (n: number) => (spanTicks > 0 ? Math.round((n * 9000) / spanTicks) : 0);
result('summary', {
    trips: trips.length, spanTicks, tickMs: Number(process.env.NODE_TICKRATE ?? 400),
    kills: tripKills, fightsKilled: kills, eats: tripEats, eatsPerKill: tripKills ? Number((tripEats / tripKills).toFixed(2)) : null,
    dragonBonesBanked: banked, killsPerHour: perHour(tripKills), bonesPerHour: perHour(banked),
    dragonfire: fire, minHp, deaths, passedDoorUnshielded, wornAtEnd: wearingShield(),
    totalTicks: tick() - startTick
});
await closeSession(session);
process.exit(0);
