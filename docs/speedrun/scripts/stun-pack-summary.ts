// Condense stun-pack-thieve.ts summaries (the last line of each JSONL log) into one table row each.
//
//   bun docs/speedrun/scripts/stun-pack-summary.ts <log.jsonl>...
import { readFileSync } from 'fs';

const rows: string[] = [];
for (const path of process.argv.slice(2)) {
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
        `levels ${JSON.stringify(s.levels)} pages ${JSON.stringify(s.pages)} in/out ${s.pagesInStun}/${s.pagesOutside} unseen ${JSON.stringify(s.ticksUnseen)}`,
    ].join(' | '));
}
console.log(rows.join('\n\n'));
