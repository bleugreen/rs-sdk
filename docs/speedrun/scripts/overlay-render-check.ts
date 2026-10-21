// Eyes-on render check for the browser client: drive the lab character through chat, a
// dialogue open and close, a walk, a melee fight with hitsplats, and a Wind Strike projectile
// in a visible tab, screenshot the canvas at each step, and compose one contact sheet per
// scene, so two builds can be compared frame by frame (rs/113's decode-on-arrival against main).
//
//   bun docs/speedrun/scripts/overlay-render-check.ts <bot> --origin=http://localhost:9110
//       --gateway=ws://localhost:8010 [--out=DIR]
//
// Run it through overlay-trace-lab.sh with LAB_TAB_SCRIPT=overlay-render-check.ts. Writes
// <out>/frames/*.jpg, <out>/sheet-<scene>.jpg and <out>/frames.jsonl (per frame: wall time,
// Client.loopCycle, drawCycle, fps, local player tile). Lab only: it teleports and uses ::give.
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';
import { runScript } from '../../../sdk/runner';
import { loadBotEnv } from '../../../speedrun/lib/session';

const bot = process.argv[2];
if (!bot) throw new Error('usage: overlay-render-check.ts <bot> --origin=... --gateway=... [--out=DIR]');
const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const env = loadBotEnv(bot);
const origin = flag('origin') ?? `http://${env.SERVER ?? 'localhost:8888'}`;
const gateway = flag('gateway') ?? env.GATEWAY_URL;
const out = flag('out') ?? join(process.env.TMPDIR ?? '/tmp', `overlay-render-${bot}`);
const framesDir = join(out, 'frames');
mkdirSync(framesDir, { recursive: true });
const WIND_STRIKE = 1152;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const headless = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
const browser = await puppeteer.launch({
    headless,
    defaultViewport: null,
    args: ['--no-sandbox', '--window-size=800,660', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
});
const page = (await browser.pages())[0] ?? (await browser.newPage());
page.on('pageerror', e => console.log(`[render] page error: ${e}`));
const q = new URLSearchParams({ bot: env.BOT_USERNAME, password: env.PASSWORD });
if (gateway) q.set('gateway', gateway);
await page.goto(`${origin}/bot?${q}`, { waitUntil: 'domcontentloaded' });
for (let i = 0; !(await page.evaluate(() => (window as any).gameClient?.ingame)); i++) {
    if (i > 600) throw new Error('page never reached the game');
    await sleep(200);
}
await sleep(3000);
const box = (await (await page.$('canvas'))!.boundingBox())!;

const scenes = new Map<string, string[]>();
const meta: string[] = [];
async function shot(scene: string, name: string): Promise<void> {
    const file = join(framesDir, `${name}.jpg`);
    const info = await page.evaluate(() => {
        const c = (window as any).gameClient;
        const C = c?.constructor;
        const p = c?.localPlayer;
        return { loop: C?.loopCycle, draw: C?.drawCycle, fps: c?.fps, x: p ? (p.x >> 7) + c.mapBuildBaseX : -1, z: p ? (p.z >> 7) + c.mapBuildBaseZ : -1 };
    });
    await page.screenshot({ path: file, type: 'jpeg', quality: 75, clip: box });
    meta.push(JSON.stringify({ name, t: Date.now(), ...info }));
    scenes.set(scene, [...(scenes.get(scene) ?? []), file]);
}
async function sequence(scene: string, frames: number, gapMs: number): Promise<void> {
    for (let i = 0; i < frames; i++) {
        await shot(scene, `${scene}-${i}`);
        await sleep(gapMs);
    }
}

await runScript(async ({ bot: b, sdk }) => {
    await b.skipTutorial();
    await sdk.waitForTicks(2);
    await sdk.sendSay('::tele 0,50,50,22,18');
    await sdk.waitForTicks(6);
    await sdk.sendSay('::give airrune 100');
    await sdk.sendSay('::give mindrune 100');
    await sdk.waitForTicks(3);

    // Chat: the chatbox line and the overhead text.
    await sdk.sendSay('render check');
    await sdk.waitForTicks(1);
    await shot('stills', 'chat');

    // An interface opening and closing: a dialogue with Hans, in the courtyard.
    const hans = sdk.findNearbyNpc(/^hans$/i);
    if (hans) {
        await b.talkTo(hans).catch(() => undefined);
        await sdk.waitForTicks(2);
        await shot('stills', 'dialogue-open');
        await sdk.sendCloseModal();
        await sdk.waitForTicks(2);
        await shot('stills', 'dialogue-closed');
    } else {
        console.log('[render] Hans is not in view; no dialogue frames');
    }

    // A walk, east across the bridge toward the goblins, frames 150 ms apart.
    const walking = b.walkTo(3247, 3236, 2, { timeout: 30_000 });
    await sleep(300);
    await sequence('walk', 8, 150);
    await walking.catch(() => undefined);
    await sdk.waitForTicks(2);

    // Melee with hitsplats both ways, frames 300 ms apart.
    const foe = () => sdk.findNearbyNpc(/^goblin$/i) ?? sdk.findNearbyNpc(/^(man|woman|cow|chicken)$/i);
    const target = foe();
    if (target) {
        void b.attack(target).catch(() => undefined);
        await sleep(1200);
        await sequence('fight', 8, 300);
    } else {
        console.log('[render] no attackable NPC in view; no fight frames');
    }
    await sdk.sendWalk(sdk.getState()!.player!.worldX, sdk.getState()!.player!.worldZ, false);
    await sdk.waitForTicks(4);

    // A Wind Strike projectile, frames 100 ms apart from the cast.
    const mark = foe();
    if (mark) {
        await sdk.sendSpellOnNpc(mark.index, WIND_STRIKE);
        await sleep(400);
        await sequence('spell', 8, 100);
    } else {
        console.log('[render] no NPC to cast at; no spell frames');
    }

    writeFileSync(join(out, 'frames.jsonl'), meta.join('\n') + '\n');
    // One contact sheet per scene, four frames across at half size.
    const sheet = await browser.newPage();
    await sheet.setViewport({ width: Math.ceil(box.width / 2) * 4 + 40, height: 400 });
    for (const [scene, files] of scenes) {
        const cells = files.map(f => {
            const name = f.split('/').pop()!.replace('.jpg', '');
            const src = `data:image/jpeg;base64,${readFileSync(f).toString('base64')}`;
            return `<figure><img src="${src}" width="${Math.ceil(box.width / 2)}"><figcaption>${name}</figcaption></figure>`;
        }).join('');
        await sheet.setContent(`<style>body{margin:4px;background:#222;color:#ddd;font:11px sans-serif;display:flex;flex-wrap:wrap;gap:6px}figure{margin:0}</style>${cells}`);
        await sheet.screenshot({ path: join(out, `sheet-${scene}.jpg`), type: 'jpeg', quality: 80, fullPage: true });
    }
    console.log(`[render] ${meta.length} frames; sheets ${[...scenes.keys()].join(', ')} in ${out}`);
    await browser.close();
}, { timeout: 5 * 60_000, printState: false });
