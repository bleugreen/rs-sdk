// Run-day carrier launcher entries from the run commit's ledger and production binding.
// Usage: CHECKOUT=<checkout> SCORED_NAME=<SCORED login> bun carriers-gen.ts <cueRoot> <outFile>
// Prints only the serve nameHash (it must equal the run's receiver hash); never the name.
const C = process.env.CHECKOUT!, [cueRoot, out] = process.argv.slice(2), serve = process.env.SCORED_NAME;
if (!C || !cueRoot || !out || !serve) { console.error('usage: CHECKOUT=<C> SCORED_NAME=… bun carriers-gen.ts <RC> <out>'); process.exit(2); }
const { readFileSync, writeFileSync } = await import('node:fs');
const { muleFromLedger, muleRunOptionsByAccount } = await import(`${C}/speedrun/helpers/mule-ledger.ts`);
const { nameHash } = await import(`${C}/speedrun/helpers/altar-cue.ts`);
const { MANIFEST } = await import(`${C}/speedrun/tools/slot-ledger.ts`);
const prod = JSON.parse(readFileSync(`${C}/docs/speedrun/research/mule-delivery-production.json`, 'utf8'));
const accounts: Record<string, string> = {};
for (const a of prod.accounts) for (const p of a.options.packages) if (p.scope?.family === 'mule') accounts[p.scope.step] = a.account;
const rows = prod.rows.filter((r: string) => accounts[r]);
const ledger = muleFromLedger(readFileSync(MANIFEST, 'utf8'), { form: 'ask', rows, onRequest: prod.onRequest });
const byAcc = muleRunOptionsByAccount(ledger, cueRoot, { deliveryRun: 'a1b-20261023', serve, accounts } as any) as any[];
writeFileSync(out, JSON.stringify({ accounts: byAcc.map(p => ({ account: p.account, role: 'mule', cueDir: p.options.cueDir, options: p.options })) }, null, 2) + '\n');
console.log('serve nameHash', nameHash(serve));
