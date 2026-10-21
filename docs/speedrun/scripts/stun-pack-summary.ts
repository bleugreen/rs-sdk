// Condense stun-pack-thieve.ts summaries (the last line of each JSONL log) into one table row each,
// then a fail-normalised comparison: span = successes x mean success gap + fails x mean
// failure-to-next-roll, re-evaluated at a common fail count (--fails=N, default the mean over the
// logs given) so runs that drew different numbers of failures compare on their per-roll costs.
//
//   bun docs/speedrun/scripts/stun-pack-summary.ts [--fails=N] <log.jsonl>...
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const failsFlag = args.find(a => a.startsWith('--fails='));
const paths = args.filter(a => !a.startsWith('--'));
const mean = (h: Record<string, number>) => {
    let n = 0, t = 0;
    for (const [k, v] of Object.entries(h)) { n += v; t += Number(k) * v; }
    return { n, mean: n ? t / n : 0 };
};

const rows: string[] = [];
const norm: Array<{ tag: string; span: number; S: number; F: number; gS: number; gF: number; bones: number; casts: number; arrows: number; topups: string }> = [];
for (const path of paths) {
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const s = JSON.parse(lines[lines.length - 1]!).summary;
    if (!s) { rows.push(`${path}: no summary`); continue; }
    const n = s.normalStuns;
    const succ2 = s.gapAfterSuccess['2'] ?? 0;
    const succN = Object.values(s.gapAfterSuccess as Record<string, number>).reduce((a, b) => a + b, 0);
    rows.push([
        s.tag, `span ${s.span}`, `99 at ${s.reached99At ?? '-'}`, `rolls ${s.rolls} (${s.successes}/${s.fails})`,
        `base/tick ${(s.thievingBase / s.span).toFixed(2)}`, `succ gap2 ${succ2}/${succN}`,
        `stun next ${n.meanNext} ${JSON.stringify(n.next)}`, `per stun bones ${n.bones} casts ${n.casts} arrows ${n.arrows} pages ${n.pages}`,
        `page/no ${s.nextByPages.withPage}/${s.nextByPages.withoutPage} (n ${s.nextByPages.nWith})`,
        `totals ${JSON.stringify(s.totals)} outside ${JSON.stringify(s.outside)} cOut ${s.chargeOutSent}`,
        `topups ${s.topups.ok}/${s.topups.n} recv ${JSON.stringify(s.topups.recvTicks)} sgaps ${JSON.stringify(s.topups.successGaps)} tuStun ${JSON.stringify(s.topupStuns)} fail ${JSON.stringify(s.topups.failures)} give ${s.topups.giveRefills}`,
        `eats ${s.eats} forced ${s.forcedEats} inStun ${s.stunEats} hpLost ${s.hpLost} dmg ${JSON.stringify(s.damage)} deaths ${s.deaths}`,
        `dismissed ${s.dismissedInStuns} pageOpens ${JSON.stringify(s.pageOpens ?? null)} stalls ${JSON.stringify(s.stalls)} aborted ${s.aborted ?? '-'}`,
        `levels ${JSON.stringify(s.levels)} pages ${JSON.stringify(s.pages)} in/out ${s.pagesInStun}/${s.pagesOutside} unseen ${JSON.stringify(s.ticksUnseen)}`,
    ].join(' | '));
    const gs = mean(s.gapAfterSuccess), gf = mean(s.gapAfterFail);
    norm.push({ tag: s.tag, span: s.span, S: s.successes, F: s.fails, gS: gs.mean, gF: gf.mean, bones: s.totals.bones, casts: s.totals.casts, arrows: s.totals.arrows, topups: `${s.topups.ok}/${s.topups.n}` });
}
console.log(rows.join('\n\n'));
if (norm.length) {
    const F0 = failsFlag ? Number(failsFlag.slice(8)) : norm.reduce((a, r) => a + r.F, 0) / norm.length;
    console.log(`\nfail-normalised at ${F0.toFixed(1)} fails (successes as measured):`);
    console.log('tag | span | S/F | mean success gap | mean fail-to-next | normalised span | bones/casts/arrows | top-ups');
    for (const r of norm) console.log([r.tag, r.span, `${r.S}/${r.F}`, r.gS.toFixed(3), r.gF.toFixed(2), Math.round(r.S * r.gS + F0 * r.gF), `${r.bones}/${r.casts}/${r.arrows}`, r.topups].join(' | '));
}
