import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TickLog } from './lib/ticks';
import { aliasAccount, type GateIO, LOG_ACCOUNT, loadRunConfig, parseArgs, startGates, TARGET_TOTAL, totalLevel, UsageError } from './run';
import { buildChain, PLACEMENT, sliceUntil } from './runner/chain';

const cues = { open: async () => {}, stop: () => {} };
const partners = Object.fromEntries([...Object.keys(PLACEMENT), 'H6', 'H7', 'H8', 'H16', 'H22'].map(id => [id, `p_${id}`]));
const cfg = { partners, firemakingTiles: '3240,3296', rings: { giver: 'r' }, bones: { giver: 'b' }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/x' };
const full = buildChain(cfg, { cues });

describe('parseArgs', () => {
    test('defaults: browser, the run dir, no slice', () => {
        const a = parseArgs(['--bot=scored', '--config=run.json']);
        expect(a).toMatchObject({ bot: 'scored', config: 'run.json', client: 'browser', dryRun: false });
        expect(a.until).toBeUndefined();
    });
    test('every flag', () => {
        expect(parseArgs(['--bot=s', '--config=c', '--client=lite', '--from=S07', '--until=S14', '--dry-run', '--log=l', '--run-commit=abc', '--run-dir=/r', '--host-reservation=/h', '--claim-owner=rs/393']))
            .toEqual({ bot: 's', config: 'c', client: 'lite', from: 'S07', until: 'S14', dryRun: true, log: 'l', runCommit: 'abc', runDir: '/r', hostReservation: '/h', claimOwner: 'rs/393' });
    });
    test('refusals', () => {
        expect(() => parseArgs(['--config=c'])).toThrow(UsageError);
        expect(() => parseArgs(['--bot=s'])).toThrow('--config');
        expect(() => parseArgs(['--bot=s', '--config=c', '--client=tab'])).toThrow('browser or lite');
        expect(() => parseArgs(['--bot=s', '--config=c', '--force'])).toThrow('unknown flag');
        expect(() => parseArgs(['--bot=s', '--config=c', '--dry-run=1'])).toThrow('takes no value');
    });
});

describe('loadRunConfig', () => {
    test('the cue dir is the run dir\'s rc-cue unless RC_CUE_DIR says otherwise, and RC_CUE_DIR is set to it', () => {
        const dir = mkdtempSync(join(tmpdir(), 'run-cfg-'));
        const path = join(dir, 'run.json');
        const { cueDir: _c, ...file } = cfg;
        writeFileSync(path, JSON.stringify(file));
        const env: Record<string, string | undefined> = {};
        expect(loadRunConfig(path, '/runs/m', env).cueDir).toBe('/runs/m/rc-cue');
        expect(env.RC_CUE_DIR).toBe('/runs/m/rc-cue');
        expect(loadRunConfig(path, '/runs/m', { RC_CUE_DIR: '/elsewhere' }).cueDir).toBe('/elsewhere');
        writeFileSync(path, JSON.stringify({ partners: {} }));
        expect(() => loadRunConfig(path, '/r', {})).toThrow('lacks firemakingTiles, rings, bones, courier, anvil');
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('startGates', () => {
    const live = (owner: string) => ({ state: 'live' as const, reservation: { owner, until: '2026-10-23T00:00:00Z', reason: 'run' } });
    const io = (o: Partial<GateIO> = {}): GateIO => ({
        floor: async () => ({ ok: true, floor: 'df332771', runCommit: 'a'.repeat(40), line: 397 }),
        reservation: () => ({ owner: 'rs/393', state: live('rs/393'), path: '/h' }),
        slotLedger: async () => ({ code: 0, out: '' }),
        helpersReady: () => true,
        ...o,
    });
    const s04 = sliceUntil(full, 'S04');

    test('all five pass on a clean --until=S04 slice', async () => {
        const g = await startGates(s04, io());
        expect(g.map(x => [x.gate, x.ok])).toEqual([['run-commit floor', true], ['host reservation', true], ['slot ledger', true], ['no refusing step on the path', true], ['helpers ready', true]]);
    });

    test('each refuses on its own, and every gate is still evaluated', async () => {
        const g = await startGates(full, io({
            floor: async () => ({ ok: false, reason: 'RUN_COMMIT abc does not include the run-commit floor df332771' }),
            reservation: () => ({ owner: 'rs/393', state: live('host'), path: '/h' }),
            slotLedger: async () => ({ code: 1, out: 'H12: 29 slots\n' }),
            helpersReady: () => null,
        }));
        expect(g.every(x => !x.ok)).toBe(true);
        expect(g.map(x => x.detail).join('\n')).toContain("live, but host's, not ours");
        expect(g[3]!.detail).toContain('S05 Doric');
        expect(g[4]!.detail).toContain('no launcher.json');
    });

    test('the scored run needs its own claim: none named, or none live, refuses', async () => {
        expect((await startGates(s04, io({ reservation: () => ({ owner: undefined, state: live('rs/393'), path: '/h' }) })))[1]!.ok).toBe(false);
        expect((await startGates(s04, io({ reservation: () => ({ owner: 'rs/393', state: { state: 'none' }, path: '/h' }) })))[1]!.detail).toContain('no live claim');
    });
});

describe('the log and the end', () => {
    test("rows for the login carry SCORED; a helper's name is left alone", () => {
        const log = TickLog.memory('t');
        const off = aliasAccount(log, 'real_name');
        const row = { v: 1, runId: 't', account: 'real_name', sessionId: 1, step: 'x', startTick: 0, endTick: 0, ticks: 0, wallMs: 0, ok: true, tickMs: 600, at: '' } as const;
        log.append({ ...row });
        log.append({ ...row, account: 'cairn_h92' });
        off();
        log.append({ ...row });
        expect(log.rows.map(r => r.account)).toEqual([LOG_ACCOUNT, 'cairn_h92', 'real_name']);
    });

    test("the total is the 19 real skills' base levels summed (the client's Stat18/Stat19 slots are not skills): 1,881 at 99", () => {
        const skills = Array.from({ length: 19 }, (_, i) => ({ name: `s${i}`, level: 99, baseLevel: 99, experience: 0 }));
        const slots = [{ name: 'Stat18', level: 1, baseLevel: 1, experience: 0 }, { name: 'Stat19', level: 1, baseLevel: 1, experience: 0 }];
        expect(totalLevel({ skills: [...skills, ...slots] })).toBe(TARGET_TOTAL);
        expect(totalLevel({ skills: [...skills.slice(1), { name: 'x', level: 99, baseLevel: 98, experience: 0 }, ...slots] })).toBe(1880);
    });
});
