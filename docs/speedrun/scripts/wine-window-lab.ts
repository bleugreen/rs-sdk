// Wine window lab (cairn://p/rs/107): booth work (gem cutting, potion mixing, bone burying) in the
// idle ticks of the two-relog wine sequence (docs/speedrun/helpers/wine.md on rs/41's branch,
// "Default sequence for the scored account"). Results: docs/speedrun/research/wine-window.md.
//
//   WEB_PORT=9630 WEB_MANAGEMENT_PORT=9631 HISCORES_WEB_PORT=9632 NODE_PORT=44630 AGENT_PORT=8630 \
//   NODE_TICKRATE=300 LAB_RUNNERS=0 LAB_BOTS=wwrecv LAB_LOG=$TMPDIR/wine-window \
//     bash speedrun/lab/lab.sh wwgive docs/speedrun/scripts/wine-window-lab.ts:--receiver=wwrecv:--variants=plain,gems:--reps=2
//
// The first bot (lab.sh's <bot>) is the helper that delivers the noted wines; --receiver plays
// the scored account (SCORED). The script launches and relogs both clients itself (LAB_RUNNERS=0).
//
// One rep of a variant, on SCORED's clock (each login's tick counter restarts at 1):
//   relog 0 (the run's planned relog at Varrock west bank; the helper waits beside it)
//   session 1: trade (the noted wines only) -> bank: deposit 29 (+ withdraw a work load) -> W1
//     (work until the login timer fires at login + 20) -> P1 (the level-up pages; the booth click
//     is pending and the bank opens in the tick the last page goes) -> deposit the rest -> relog 1
//   session 2: W2 (work while waiting for the new login's timer) -> firing 2 -> work on until
//     every quota is done.
// The plain variant does no work in the windows; after the final pages it runs each quota
// standalone, one segment per kind, so baseline(variant) = plain sequence + its quotas' segments
// and saved = baseline - variant (both endpoints are "last quota action seen").
//
// Options: --variants=plain,gems,potions,bones,mix  --reps=1  --craft=55 --herb=78 --prayer=50
//   --wines=520 --first=29  --q-gems=160 --q-potions=112 --q-bones=28
//   --p1work=0|1 (cut/mix during the first firing's pages)  --guard=1|0 (no bury lands on a due tick)
//   --mix=W1:gems,P1:-,W2:bones,after:gems+bones  --tag=x
import type { BotWorldState } from '../../../sdk/types';
import { classifyPage } from '../../../speedrun/lib/dialogue';
import { login, logoutClean, openSession, type Session } from '../../../speedrun/lib/session';
import { giveAll, receiveFrom, sameName } from '../../../speedrun/lib/trade';
import { sleep, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { tele, VARROCK_WEST_BANK } from '../../../speedrun/lab/setup';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const GIVER = argv.find(a => !a.startsWith('-'))!;
const RECEIVER = arg('receiver', 'wwrecv');
const VARIANTS = arg('variants', 'plain,gems,potions,bones').split(',');
const REPS = Number(arg('reps', '1'));
const LEVEL = { crafting: Number(arg('craft', '55')), herblore: Number(arg('herb', '78')), prayer: Number(arg('prayer', '50')) };
const WINES = Number(arg('wines', '520'));
const FIRST = Number(arg('first', '29'));
const QUOTA: Record<Kind, number> = { gems: Number(arg('q-gems', '160')), potions: Number(arg('q-potions', '112')), bones: Number(arg('q-bones', '28')) };
const P1WORK = arg('p1work', '0') === '1';
const GUARD = arg('guard', '1') === '1';
const TAG = arg('tag', '');
const FIRE = 20; // login.rs2 -> ~ferment_wines_login: settimer(fermenting_wine, 20)
const LOGDIR = process.env.LAB_LOG ?? join(process.env.TMPDIR ?? '/tmp', 'wine-window');
mkdirSync(LOGDIR, { recursive: true });

// ---------------------------------------------------------------- items and recipes

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OBJ: Record<string, number> = {};
for (const line of readFileSync(join(ROOT, 'server/content/pack/obj.pack'), 'utf8').split('\n')) {
    const m = line.match(/^(\d+)=(\S+)/);
    if (m) OBJ[m[2]!] = Number(m[1]);
}
const id = (n: string) => { const v = OBJ[n]; if (v === undefined) throw new Error(`unknown obj ${n}`); return v; };
const WINE_NOTE = id('cert_jug_unfermented_wine');
const UNF = id('jug_unfermented_wine');
const CHISEL = id('chisel');
const BONES = id('dragon_bones');

type Kind = 'gems' | 'potions' | 'bones';
const SKILL: Record<Kind, string> = { gems: 'Crafting', potions: 'Herblore', bones: 'Prayer' };
interface Recipe { level: number; xp: number; a: string; b?: string; product?: string }
// gem.dbrow and brew_potion.struct (base xp), as in delayfree-cycle.ts
const ROUTES: Record<Kind, Recipe[]> = {
    gems: [
        { level: 34, xp: 85, a: 'uncut_ruby', product: 'ruby' },
        { level: 43, xp: 107.5, a: 'uncut_diamond', product: 'diamond' },
        { level: 55, xp: 137.5, a: 'uncut_dragonstone', product: 'dragonstone' },
    ],
    potions: [
        { level: 30, xp: 75, a: 'ranarrvial', b: 'white_berries', product: '3dose1defense' },
        { level: 45, xp: 100, a: 'iritvial', b: 'eye_of_newt', product: '3dose2attack' },
        { level: 55, xp: 125, a: 'kwuarmvial', b: 'limpwurt_root', product: '3dose2strength' },
        { level: 66, xp: 150, a: 'cadantinevial', b: 'white_berries', product: '3dose2defense' },
        { level: 72, xp: 162.5, a: 'dwarfweedvial', b: 'wine_of_zamorak', product: '3doserangerspotion' },
        { level: 78, xp: 175, a: 'torstolvial', b: 'jangerberries', product: '3dosepotionofzamorak' },
    ],
    bones: [{ level: 1, xp: 72, a: 'dragon_bones' }],
};
const pick = (k: Kind, level: number) => [...ROUTES[k]].reverse().find(r => r.level <= level) ?? ROUTES[k][0]!;

// ---------------------------------------------------------------- state helpers

const xpOf = (s: BotWorldState, skill: string) => s.skills.find(k => k.name === skill)?.experience ?? 0;
const lvlOf = (s: BotWorldState, skill: string) => s.skills.find(k => k.name === skill)?.baseLevel ?? 1;
const cnt = (s: BotWorldState, oid: number) => s.inventory.filter(i => i.id === oid).reduce((n, i) => n + i.count, 0);
const slotsOf = (s: BotWorldState, oid: number) => s.inventory.filter(i => i.id === oid).map(i => i.slot).sort((a, b) => a - b);
const bankSlot = (s: BotWorldState, oid: number) => s.bank.items.find(i => i.id === oid && i.count > 0)?.slot;
const page = (s: BotWorldState) => classifyPage(s.dialog) === 'continue';
const RESERVED = new Set([CHISEL, WINE_NOTE]);

/** Deposit buttons for exactly n of a stack (wine-receive.ts depositButtons): 29 is 10,10,5,1,1,1,1. */
function depositButtons(n: number, stack: number): number[] {
    if (n >= stack) return [-1];
    const tens = Math.floor(n / 10), fives = Math.floor((n % 10) / 5), ones = n % 5;
    return [...Array(tens).fill(10), ...Array(fives).fill(5), ...Array(ones).fill(1)];
}
function buttons(n: number): number[] { return n <= 0 ? [] : depositButtons(n, Infinity); }

function findBooth(s: BotWorldState) {
    const b = s.nearbyLocs
        .filter(l => /bank booth/i.test(l.name))
        .map(l => ({ l, o: l.optionsWithIndex.find(o => /^bank$/i.test(o.text)) ?? l.optionsWithIndex.find(o => /use.quickly/i.test(o.text)) }))
        .filter(x => x.o)
        .sort((x, y) => x.l.distance - y.l.distance)[0];
    return b ? { x: b.l.x, z: b.l.z, id: b.l.id, op: b.o!.opIndex } : null;
}

// ---------------------------------------------------------------- sessions

const giver = await openSession(GIVER, { launch: true });
const recv = await openSession(RECEIVER, { launch: true });
const R = recv.sdk;
const f = (p: Promise<unknown>) => { p.catch(() => {}); };

async function relog(s: Session): Promise<{ clickTick: number; lastTick: number; firstTick: number; wallMs: number }> {
    const t0 = Date.now();
    const out = await logoutClean(s);
    if (!out.ok) throw new Error(`logout failed: ${out.reason}`);
    await sleep(3_000);
    let first = -1;
    const off = s.sdk.onStateUpdate(st => { if (first < 0 && st.inGame && (st.player?.worldX ?? 0) > 0) first = st.tick; });
    await login(s);
    off();
    if (first < 0) first = s.sdk.getState()!.tick;
    return { clickTick: out.clickTick, lastTick: out.lastInWorldTick, firstTick: first, wallMs: Date.now() - t0 };
}

/** Call `step` once per new tick label until it returns a value. */
function perTick<T>(sdk: Session['sdk'], maxTicks: number, step: (s: BotWorldState) => T | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
        let last = -1, n = 0, done = false;
        const wall = setTimeout(() => { if (!done) { done = true; off(); reject(new Error('perTick: wall timeout')); } }, (maxTicks + 30) * 300 * 2);
        const handle = (s: BotWorldState) => {
            if (done || !s?.inGame || s.tick === last) return;
            last = s.tick;
            if (++n > maxTicks) { done = true; off(); clearTimeout(wall); reject(new Error(`perTick: ${maxTicks} ticks without finishing`)); return; }
            let r: T | undefined;
            try { r = step(s); } catch (e) { done = true; off(); clearTimeout(wall); reject(e); return; }
            if (r !== undefined) { done = true; off(); clearTimeout(wall); resolve(r); }
        };
        const off = sdk.onStateUpdate(handle);
        const cur = sdk.getState();
        if (cur) handle(cur);
    });
}

// ---------------------------------------------------------------- the booth worker

interface Load { kind: Kind; recipe: Recipe; pairs: Array<[number, number]>; next: number }

class Worker {
    sub: 'idle' | 'opening' | 'closing' | 'working' | 'empty' = 'idle';
    kind: Kind | null = null;
    load: Load | null = null;
    allowRefill = false;
    boothAt = -99;
    closeAt = -99;
    refillKind: Kind | null = null;

    constructor(private log: (t: number, m: string) => void) {}

    /** Set the kind of work for the window. */
    set(kind: Kind | null, allowRefill: boolean): void {
        this.kind = kind;
        this.allowRefill = allowRefill;
        if (this.sub === 'empty' || this.sub === 'idle') this.sub = 'idle';
    }

    /** Append the withdraw/deposit events that load `kind` (no close) to `burst`; the bank is open. */
    refill(s: BotWorldState, kind: Kind, burst: string[]): void {
        const level = lvlOf(s, SKILL[kind]);
        const r = pick(kind, level);
        const A = id(r.a), B = r.b ? id(r.b) : -1;
        const nonRes = s.inventory.filter(i => !RESERVED.has(i.id));
        const reservedSlots = s.inventory.filter(i => RESERVED.has(i.id)).length + (kind === 'gems' && cnt(s, CHISEL) === 0 ? 1 : 0);
        const depositIds = (keep: Set<number>) => {
            const seen = new Set<number>();
            for (const it of nonRes) if (!keep.has(it.id) && !seen.has(it.id)) { seen.add(it.id); f(R.sendBankDeposit(it.slot, -1)); burst.push(`dep ${it.name}`); }
        };
        const aBank = bankSlot(s, A), bBank = B >= 0 ? bankSlot(s, B) : undefined;
        if (aBank === undefined || (B >= 0 && bBank === undefined)) throw new Error(`out of ${r.a}/${r.b} in the bank`);
        if (kind === 'gems') {
            depositIds(new Set([A]));
            if (cnt(s, CHISEL) === 0) { const c = bankSlot(s, CHISEL); if (c === undefined) throw new Error('no chisel'); f(R.sendBankWithdraw(c, 1)); burst.push('wd chisel'); }
            f(R.sendBankWithdraw(aBank, -1)); burst.push(`wd ${r.a} all`);
        } else if (kind === 'bones') {
            depositIds(new Set([A]));
            f(R.sendBankWithdraw(aBank, -1)); burst.push('wd bones all');
        } else {
            const nA = Math.floor((28 - reservedSlots) / 2);
            const P = id(r.product!);
            const canonical = cnt(s, A) === 0 && nonRes.every(i => i.id === P || i.id === B) && nonRes.filter(i => i.id === P).length === nA;
            if (canonical) {
                // herblore.md section 4: B fills the free slots, the potions go, A fills their slots.
                f(R.sendBankWithdraw(bBank!, -1)); burst.push(`wd ${r.b} all`);
                f(R.sendBankDeposit(nonRes.find(i => i.id === P)!.slot, -1)); burst.push('dep potions');
                f(R.sendBankWithdraw(aBank, -1)); burst.push(`wd ${r.a} all`);
            } else {
                depositIds(new Set());
                for (const b of buttons(nA)) { f(R.sendBankWithdraw(aBank, b)); burst.push(`wd ${r.a} ${b}`); }
                f(R.sendBankWithdraw(bBank!, -1)); burst.push(`wd ${r.b} all`);
            }
        }
        this.refillKind = kind;
    }

    /** Build the load from the observed inventory (after a refill, or leftovers). */
    build(s: BotWorldState, kind: Kind): Load | null {
        const r = pick(kind, lvlOf(s, SKILL[kind]));
        // Leftovers may be of the previous recipe: use whatever A the inventory holds.
        const route = ROUTES[kind].filter(x => cnt(s, id(x.a)) > 0 && (!x.b || cnt(s, id(x.b)) > 0));
        const rr = route.find(x => x === r) ?? route[route.length - 1];
        if (!rr) return null;
        const A = slotsOf(s, id(rr.a));
        if (kind === 'bones') return { kind, recipe: rr, pairs: [], next: 0 };
        if (kind === 'gems') {
            const c = slotsOf(s, CHISEL)[0];
            if (c === undefined) return null;
            return { kind, recipe: rr, pairs: A.map(a => [c, a] as [number, number]), next: 0 };
        }
        const B = slotsOf(s, id(rr.b!));
        const n = Math.min(A.length, B.length);
        return n ? { kind, recipe: rr, pairs: A.slice(0, n).map((a, i) => [B[i]!, a] as [number, number]), next: 0 } : null;
    }

    /** Send up to `max` work actions from the current load; returns how many were sent. */
    act(s: BotWorldState, t: number, burst: string[], max: number, guardTick: number): number {
        const L = this.load;
        if (!L) return 0;
        if (L.kind === 'bones') {
            const bone = s.inventory.filter(i => i.id === BONES).sort((a, b) => a.slot - b.slot)[0];
            if (!bone) return 0;
            if (GUARD && t === guardTick) { burst.push('bury skipped (guard)'); return -1; }
            const op = bone.optionsWithIndex.find(o => /bury/i.test(o.text))?.opIndex ?? 1;
            if (page(s)) { f(R.sendClickDialog(0, { blind: true })); burst.push('continue'); }
            f(R.sendUseItem(bone.slot, op)); burst.push(`bury ${bone.slot}`);
            return 1;
        }
        let n = 0;
        while (n < max && L.next < L.pairs.length) {
            const [a, b] = L.pairs[L.next++]!;
            f(R.sendUseItemOnItem(a, b)); burst.push(`use ${a}->${b}`);
            n++;
        }
        return n;
    }

    exhausted(s: BotWorldState): boolean {
        const L = this.load;
        if (!L) return true;
        if (L.kind === 'bones') return cnt(s, BONES) === 0;
        return L.next >= L.pairs.length;
    }

    booth(s: BotWorldState, t: number, burst: string[]): void {
        const b = findBooth(s);
        if (!b) throw new Error('no bank booth in sight');
        f(R.sendInteractLoc(b.x, b.z, b.id, b.op));
        burst.push('booth');
        this.boothAt = t;
    }

    /** One tick of standalone booth work (W1/W2/after). */
    tick(s: BotWorldState, t: number, burst: string[], guardTick = -99): void {
        if (this.sub === 'closing') {
            if (s.bank.isOpen) return;
            const L = this.build(s, this.refillKind!);
            if (!L) {
                if (t - this.closeAt > 4) this.sub = 'idle';
                if (page(s)) { f(R.sendClickDialog(0, { blind: true })); f(R.sendClickDialog(0, { blind: true })); burst.push('continue x2'); }
                return;
            }
            this.load = L;
            this.sub = 'working';
        }
        if (this.sub === 'idle' && this.kind) {
            const L = this.build(s, this.kind);
            if (L && !(this.kind === 'bones' ? cnt(s, BONES) === 0 : L.pairs.length === 0)) { this.load = L; this.sub = 'working'; }
            else if (this.allowRefill) this.sub = 'opening';
            else this.sub = 'empty';
        }
        if (this.sub === 'working') {
            if (this.load && this.kind && this.load.kind !== this.kind && this.allowRefill) {
                this.sub = 'opening'; // switch kinds at the next bank visit
            } else {
                const n = this.act(s, t, burst, 5, guardTick);
                if (n === 0 && page(s)) { f(R.sendClickDialog(0, { blind: true })); f(R.sendClickDialog(0, { blind: true })); burst.push('continue x2'); }
                if (this.exhausted(s) && n <= 0) {
                    this.sub = this.allowRefill && this.kind ? 'opening' : 'empty';
                } else if (this.load?.kind !== 'bones' && this.exhausted(s) && this.allowRefill && this.kind && burst.length < 5) {
                    this.booth(s, t, burst);
                    this.sub = 'opening';
                    return;
                } else return;
            }
        }
        if (this.sub === 'opening') {
            if (s.bank.isOpen) {
                this.refill(s, this.kind!, burst);
                f(R.sendCloseModal()); burst.push('close');
                this.sub = 'closing';
                this.closeAt = t;
                return;
            }
            if (page(s)) { f(R.sendClickDialog(0, { blind: true })); f(R.sendClickDialog(0, { blind: true })); burst.push('continue x2'); }
            if (t - this.boothAt >= 1) this.booth(s, t, burst); // a duplicate booth click is harmless
            return;
        }
        if ((this.sub === 'empty' || this.sub === 'idle') && page(s)) { f(R.sendClickDialog(0, { blind: true })); f(R.sendClickDialog(0, { blind: true })); burst.push('continue x2'); }
    }
}

// ---------------------------------------------------------------- plans

interface Plan { W1: Kind | null; P1: boolean; W2: Kind | null; after: Kind[] }
function parsePlan(spec: string): Plan {
    const m = Object.fromEntries(spec.split(',').map(p => p.split(':') as [string, string]));
    const k = (v?: string) => (v && v !== '-' ? (v as Kind) : null);
    return { W1: k(m.W1), P1: m.P1 === '1' || (m.P1 !== undefined && m.P1 !== '-' && m.P1 !== '0'), W2: k(m.W2), after: (m.after ?? '').split('+').filter(x => x && x !== '-') as Kind[] };
}
const PLANS: Record<string, Plan> = {
    plain: { W1: null, P1: false, W2: null, after: ['potions', 'bones', 'gems'] },
    gems: { W1: 'gems', P1: P1WORK, W2: 'gems', after: ['gems'] },
    potions: { W1: 'potions', P1: P1WORK, W2: 'potions', after: ['potions'] },
    bones: { W1: 'bones', P1: false, W2: 'bones', after: ['bones'] },
    mix: parsePlan(arg('mix', 'W1:gems,P1:-,W2:bones,after:gems+bones')),
};

// ---------------------------------------------------------------- fixture (not timed)

async function clearDialogs(s: Session): Promise<void> {
    for (let i = 0; i < 10 && s.sdk.getState()?.dialog?.isOpen; i++) { await s.sdk.sendClickDialog(0); await waitTicks(s.sdk, 1); }
}

async function fixture(plan: Plan, rep: number): Promise<void> {
    for (const s of [giver, recv]) { await s.bot.skipTutorial?.().catch?.(() => {}); await clearDialogs(s); }
    if (!(await tele(R, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z))) throw new Error('receiver tele failed');
    if (!(await tele(giver.sdk, VARROCK_WEST_BANK.x - 2, VARROCK_WEST_BANK.z))) throw new Error('giver tele failed');
    const usesGems = plan.W1 === 'gems' || plan.W2 === 'gems' || plan.after[0] === 'gems';
    const kinds = new Set<Kind>([...(plan.W1 ? [plan.W1] : []), ...(plan.W2 ? [plan.W2] : []), ...plan.after]);
    // Stocks: what every recipe the quotas can reach needs, plus spares.
    const need = new Map<number, number>();
    for (const k of kinds) for (const r of ROUTES[k]) if (r.level <= 99 && pick(k, LEVEL[SKILL[k].toLowerCase() as keyof typeof LEVEL]).level <= r.level) {
        need.set(id(r.a), QUOTA[k] + 60);
        if (r.b) need.set(id(r.b), QUOTA[k] + 60);
    }
    const opened = await recv.bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
    if (R.getState()!.bank.noteMode) { await R.sendClickComponent(5387); await waitTicks(R, 1); }
    const depositAllBut = async (keep: Set<number>) => {
        const seen = new Set<number>();
        for (const it of R.getState()!.inventory) if (!keep.has(it.id) && !seen.has(it.id)) { seen.add(it.id); f(R.sendBankDeposit(it.slot, -1)); }
        await waitUntil(R, st => st.inventory.every(i => keep.has(i.id)), { maxTicks: 10 });
    };
    await depositAllBut(new Set(usesGems ? [CHISEL] : []));
    const bank = () => R.getState()!.bank.items;
    const bankCount = (oid: number) => bank().filter(i => i.id === oid).reduce((n, i) => n + i.count, 0);
    if (bankCount(UNF) > 0) throw new Error(`bank holds ${bankCount(UNF)} unfermented wines before the rep`);
    const gives: string[] = [];
    for (const [oid, n] of need) {
        const have = bankCount(oid);
        if (have < n) gives.push(`::give cert_${Object.keys(OBJ).find(k => OBJ[k] === oid)} ${n - have + 100}`);
    }
    if (bankCount(CHISEL) + cnt(R.getState()!, CHISEL) === 0) gives.push('::give chisel 1');
    if (gives.length) {
        await recv.bot.closeBank();
        for (const g of gives) { await R.sendSay(g); await waitTicks(R, 1); }
        await waitTicks(R, 2);
        await recv.bot.openBank();
        await depositAllBut(new Set(usesGems ? [CHISEL] : []));
    }
    if (usesGems && cnt(R.getState()!, CHISEL) === 0) {
        const c = bankSlot(R.getState()!, CHISEL)!;
        await R.sendBankWithdraw(c, 1);
        await waitUntil(R, st => cnt(st, CHISEL) > 0, { maxTicks: 6 });
    }
    await recv.bot.closeBank();
    for (const [sk, lv] of [['cooking', 1], ['crafting', LEVEL.crafting], ['herblore', LEVEL.herblore], ['prayer', LEVEL.prayer]] as const) {
        await R.sendSay(`::setstat ${sk} ${lv}`);
        await waitTicks(R, 1);
    }
    // The helper holds exactly the noted wines.
    const g = giver.sdk;
    const held = cnt(g.getState()!, WINE_NOTE);
    if (held < WINES) { await g.sendSay(`::give cert_jug_unfermented_wine ${WINES - held}`); await waitUntil(g, st => cnt(st, WINE_NOTE) >= WINES, { maxTicks: 10 }); }
    await waitTicks(R, 2);
    await clearDialogs(recv);
    console.log(`fixture rep ${rep}: receiver inventory [${R.getState()!.inventory.map(i => `${i.name}@${i.slot}`).join(', ')}]; giver notes ${cnt(g.getState()!, WINE_NOTE)}`);
}

// ---------------------------------------------------------------- one rep

async function runRep(name: string, plan: Plan, rep: number) {
    const logFile = join(LOGDIR, `wine-window-${name}${TAG ? '-' + TAG : ''}-${rep}.log`);
    writeFileSync(logFile, `# ${name} rep ${rep} plan ${JSON.stringify(plan)} levels ${JSON.stringify(LEVEL)} NODE_TICKRATE=${process.env.NODE_TICKRATE}\n`);
    let session = 0;
    const log = (t: number, m: string) => appendFileSync(logFile, `S${session} t${t} ${m}\n`);
    const worker = new Worker(log);

    // Work accounting: actions by kind and window, from xp.
    const windows = ['W1', 'P1', 'W2', 'P2'] as const;
    type Win = (typeof windows)[number] | 'after' | 'seg';
    let win: Win = 'W1';
    const acts: Record<string, number> = {};
    const ups: Record<string, number> = {};
    const done: Partial<Record<Kind, { session: number; t: number }>> = {};
    const quotaKinds = new Set<Kind>([...(plan.W1 ? [plan.W1] : []), ...(plan.W2 ? [plan.W2] : []), ...plan.after]);
    const total: Record<Kind, number> = { gems: 0, potions: 0, bones: 0 };
    let prev: BotWorldState | null = null;
    const observe = (s: BotWorldState, t: number) => {
        if (prev) for (const k of ['gems', 'potions', 'bones'] as Kind[]) {
            const d = xpOf(s, SKILL[k]) - xpOf(prev, SKILL[k]);
            if (d > 0) {
                const r = worker.load?.kind === k ? worker.load.recipe : pick(k, lvlOf(prev, SKILL[k]));
                const a = d / 25 / r.xp;
                acts[`${win}.${k}`] = (acts[`${win}.${k}`] ?? 0) + a;
                total[k] += a;
                if (!done[k] && total[k] >= QUOTA[k] - 0.01) done[k] = { session, t };
            }
            const lu = lvlOf(s, SKILL[k]) - lvlOf(prev, SKILL[k]);
            if (lu > 0) ups[`${win}.${k}`] = (ups[`${win}.${k}`] ?? 0) + lu;
        }
        prev = s;
    };
    const line = (s: BotWorldState, t: number, burst: string[], extra = '') =>
        log(t, `${win} dlg=${page(s) ? 1 : 0} bank=${s.bank.isOpen ? 1 : 0} cook=${lvlOf(s, 'Cooking')} cr=${lvlOf(s, 'Crafting')} he=${lvlOf(s, 'Herblore')} pr=${lvlOf(s, 'Prayer')} notes=${cnt(s, WINE_NOTE)} [${burst.join(', ')}]${extra}`);

    // ---- relog 0: the run's planned relog at the bank; the helper waits for SCORED to come back
    const giving = (async () => {
        const gone = await waitUntil(giver.sdk, s => !s.nearbyPlayers.some(p => sameName(p.name, RECEIVER)), { maxTicks: 300 });
        if (!gone.ok) throw new Error('giver: receiver never left');
        const back = await waitUntil(giver.sdk, s => s.nearbyPlayers.some(p => sameName(p.name, RECEIVER)), { maxTicks: 600 });
        if (!back.ok) throw new Error('giver: receiver never came back');
        return giveAll(giver.sdk, RECEIVER, { openTimeoutMs: 60_000 });
    })();
    const r0 = await relog(recv);
    session = 1;
    const L1 = r0.firstTick;
    const D1 = L1 + FIRE;

    // ---- trade
    const tr = await receiveFrom(R, GIVER, { want: [{ item: /unfermented wine/i, amount: WINES }], openTimeoutMs: 60_000 });
    const gv = await giving;
    const s0 = R.getState()!;
    if (cnt(s0, WINE_NOTE) < WINES) throw new Error(`trade: ${cnt(s0, WINE_NOTE)} notes arrived (${tr.reason ?? ''} / ${gv.reason ?? ''})`);
    const tradeEnd = s0.tick;
    const notes0 = cnt(s0, WINE_NOTE);
    const cook0 = xpOf(s0, 'Cooking');
    prev = s0;

    // ---- session 1: deposit 29, W1, firing 1, P1, deposit the rest
    const S1 = { bankOpen: -1, depDone: -1, F1: -1, cook1: 0, p1BankOpen: -1, p1Pages: 0, restDone: -1 };
    let phase: 'dep1' | 'w1' | 'p1' | 'rest' = 'dep1';
    let dep1Sent = false;
    let boothAt = -99;
    let lastPage = -99;
    const booth = (s: BotWorldState, t: number, burst: string[]) => { worker.booth(s, t, burst); boothAt = t; };
    worker.set(plan.W1, false);
    await perTick(R, 200, s => {
        const t = s.tick;
        observe(s, t);
        const burst: string[] = [];
        if (phase === 'dep1') {
            if (!dep1Sent) {
                if (s.bank.isOpen) {
                    S1.bankOpen = t;
                    dep1Sent = true;
                    const note = s.inventory.find(i => i.id === WINE_NOTE)!;
                    for (const b of depositButtons(FIRST, cnt(s, WINE_NOTE))) { f(R.sendBankDeposit(note.slot, b)); burst.push(`dep wine ${b}`); }
                    if (plan.W1) worker.refill(s, plan.W1, burst);
                    f(R.sendCloseModal()); burst.push('close');
                    worker.sub = plan.W1 ? 'closing' : 'idle';
                    worker.closeAt = t;
                } else {
                    if (page(s)) { f(R.sendClickDialog(0, { blind: true })); burst.push('continue'); }
                    if (t - boothAt >= 3) booth(s, t, burst);
                }
            } else if (!s.bank.isOpen && cnt(s, WINE_NOTE) === notes0 - FIRST) {
                S1.depDone = t;
                phase = 'w1';
            }
            if (phase === 'dep1') { line(s, t, burst); return undefined; }
        }
        if (phase === 'w1') {
            if (xpOf(s, 'Cooking') > cook0) {
                S1.F1 = t;
                S1.cook1 = lvlOf(s, 'Cooking');
                phase = 'p1';
                win = 'P1';
            } else {
                worker.tick(s, t, burst, D1 - 1);
                line(s, t, burst);
                return undefined;
            }
        }
        if (phase === 'p1') {
            if (page(s)) { S1.p1Pages++; lastPage = t; }
            if (s.bank.isOpen) {
                S1.p1BankOpen = t;
                const note = s.inventory.find(i => i.id === WINE_NOTE);
                if (note) { f(R.sendBankDeposit(note.slot, -1)); burst.push('dep wine all'); }
                // Products go; unused load items stay in the inventory for session 2.
                const keep = new Set<number>([CHISEL, WINE_NOTE, BONES]);
                if (worker.load) { keep.add(id(worker.load.recipe.a)); if (worker.load.recipe.b) keep.add(id(worker.load.recipe.b)); }
                const seen = new Set<number>();
                for (const it of s.inventory) if (!keep.has(it.id) && !seen.has(it.id)) { seen.add(it.id); f(R.sendBankDeposit(it.slot, -1)); burst.push(`dep ${it.name}`); }
                f(R.sendCloseModal()); burst.push('close');
                phase = 'rest';
            } else {
                const k = worker.load?.kind;
                const n = plan.P1 && k && k !== 'bones' ? worker.act(s, t, burst, 4, -99) : 0;
                if (n > 0) booth(s, t, burst); // each use clears the pending booth click; re-send it last
                else {
                    if (page(s)) { f(R.sendClickDialog(0, { blind: true })); f(R.sendClickDialog(0, { blind: true })); burst.push('continue x2'); }
                    if (t === S1.F1 || (t - Math.max(boothAt, lastPage) >= 4)) booth(s, t, burst);
                }
            }
            line(s, t, burst);
            return undefined;
        }
        // rest
        line(s, t, burst);
        if (!s.bank.isOpen && cnt(s, WINE_NOTE) === 0) { S1.restDone = t; return true; }
        return undefined;
    });

    // ---- relog 1: arms the second firing
    const r1 = await relog(recv);
    session = 2;
    win = 'W2';
    const L2 = r1.firstTick;
    const D2 = L2 + FIRE;
    prev = R.getState()!;
    const cookB = xpOf(prev, 'Cooking');
    const S2 = { F2: -1, cook2: 0, E: -1, end: -1, segs: [] as Array<{ kind: Kind; start: number; end: number }> };
    let segStart = -1;
    worker.set(plan.W2, true);
    let quiet = -1;
    await perTick(R, 900, s => {
        const t = s.tick;
        observe(s, t);
        const burst: string[] = [];
        if (S2.F2 < 0 && xpOf(s, 'Cooking') > cookB) { S2.F2 = t; S2.cook2 = lvlOf(s, 'Cooking'); win = 'P2'; }
        // E: the final Cooking pages are gone (plain: chat closed for a tick; work: the bank opened).
        if (S2.F2 >= 0 && S2.E < 0) {
            if (plan.W2 || plan.after.length && win !== 'P2') { if (s.bank.isOpen && t > S2.F2) S2.E = t; }
            else if (!page(s)) { if (quiet < 0) quiet = t; else if (t - quiet >= 1) S2.E = quiet; } else quiet = -1;
        }
        const pending = [...quotaKinds].filter(k => !done[k]);
        if (S2.F2 >= 0 && S2.E >= 0 && pending.length === 0) { S2.end = Math.max(...[...quotaKinds].map(k => done[k]!.t), S2.E); line(s, t, burst, ' END'); return true; }
        if (!plan.W2 && S2.E < 0) {
            // plain: idle, then the final pages
            worker.tick(s, t, burst);
        } else {
            if (!plan.W2 && win === 'P2') { win = 'seg'; segStart = t; }
            // pick the kind: the window's, then the after-list in order
            const next = (win === 'W2' || win === 'P2') && plan.W2 && !done[plan.W2] ? plan.W2 : pending.find(k => plan.after.includes(k)) ?? pending[0] ?? null;
            if (win === 'P2' && S2.E >= 0) win = 'after';
            if (win === 'seg' && worker.kind && worker.kind !== next && done[worker.kind]) { S2.segs.push({ kind: worker.kind, start: segStart, end: done[worker.kind]!.t }); segStart = t; }
            if (next !== worker.kind) worker.set(next, true);
            worker.tick(s, t, burst, S2.F2 < 0 ? D2 - 1 : -99);
        }
        line(s, t, burst);
        return undefined;
    });
    if (win === 'seg' && worker.kind && done[worker.kind]) S2.segs.push({ kind: worker.kind, start: segStart, end: done[worker.kind]!.t });

    const relog0 = r0.lastTick - r0.clickTick;
    const sess1 = r1.lastTick - L1 + 1;
    const seqEnd = plan.W2 || plan.W1 ? S2.end : S2.E;
    const out = {
        variant: name, rep, levels: LEVEL, p1work: plan.P1, guard: GUARD,
        relog0: { clickToOut: relog0, firstTick: L1, wallMs: r0.wallMs },
        trade: { receiverTicks: tr.ticks, endAfterLogin: tradeEnd - L1, giverTicks: gv.ticks },
        s1: {
            bankOpenAfterLogin: S1.bankOpen - L1, deadlineMarginTicks: L1 + 19 - S1.bankOpen, depositDoneAfterLogin: S1.depDone - L1,
            firing1AfterLogin: S1.F1 - L1, cookingAfter1: S1.cook1, p1Ticks: S1.p1BankOpen - S1.F1, p1PageTicks: S1.p1Pages,
            restDoneAfterLogin: S1.restDone - L1, ticks: sess1,
        },
        relog1: { clickToOut: r1.lastTick - r1.clickTick, firstTick: L2, wallMs: r1.wallMs },
        s2: { firing2AfterLogin: S2.F2 - L2, cookingAfter2: S2.cook2, finalPagesClearedAfterLogin: S2.E - L2, endAfterLogin: S2.end - L2, segs: S2.segs.map(x => ({ ...x, ticks: x.end - x.start })) },
        scored: { wineSequence: relog0 + sess1 + (S2.E - L2 + 1), toEnd: relog0 + sess1 + ((plan.W1 || plan.W2 ? S2.end : S2.E) - L2 + 1) },
        actions: Object.fromEntries(Object.entries(acts).map(([k, v]) => [k, Math.round(v * 10) / 10])),
        levelUps: ups,
        log: logFile,
    };
    void seqEnd;
    console.log(`RESULT ${JSON.stringify(out)}`);
    return out;
}

// ---------------------------------------------------------------- main

const rows: Awaited<ReturnType<typeof runRep>>[] = [];
for (let rep = 0; rep < REPS; rep++) {
    for (const v of VARIANTS) {
        const plan = PLANS[v];
        if (!plan) throw new Error(`unknown variant ${v}`);
        await fixture(plan, rep);
        try {
            rows.push(await runRep(v, plan, rep));
        } catch (e) {
            console.log(`RESULT ${JSON.stringify({ variant: v, rep, error: String(e) })}`);
            // Recover: make sure the receiver is in the world and the giver holds no half trade.
            if (!R.getState()?.inGame) await login(recv).catch(() => {});
            await sleep(2_000);
        }
    }
}
console.log('== summary (scored ticks: planned relog click -> end) ==');
for (const r of rows) {
    console.log(`${r.variant} rep ${r.rep}: wine ${r.scored.wineSequence}, to end ${r.scored.toEnd}; deadline margin ${r.s1.deadlineMarginTicks}; firing1 +${r.s1.firing1AfterLogin} (Cooking ${r.s1.cookingAfter1}), P1 ${r.s1.p1Ticks}; logout ${r.relog1.clickToOut}; firing2 +${r.s2.firing2AfterLogin} (Cooking ${r.s2.cookingAfter2}); segs ${r.s2.segs.map(x => `${x.kind}:${x.ticks}`).join(' ')}; actions ${JSON.stringify(r.actions)}`);
}
process.exit(0);
