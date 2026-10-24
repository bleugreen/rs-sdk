// Run several rate.ts jobs at once against one lab engine, one bot each.
//
//   LAB_HELPERS="b2 b3" speedrun/lab/lab.sh b1 'markets/methods/lab/parallel.ts:b1=knight,--ticks=6000:b2=essence,--ticks=6000:b3=shark'
//
// lab.sh passes its own bot first, then every ':'-separated spec: `<bot>=<method>[,<arg>...]`.
// Every bot in a spec needs a lite runner (lab.sh starts one for its bot and for LAB_HELPERS).
// Output lines are passed through unchanged; rate.ts already tags each with its bot and method.

const specs = process.argv.slice(3);
if (!specs.length) {
    console.error('usage: parallel.ts <labbot> <bot>=<method>[,--k=v...] ...');
    process.exit(2);
}
const env = { ...process.env };
delete env.BOT_USERNAME;
delete env.PASSWORD;
const jobs = specs.map(spec => {
    // split at the first '=' only: the args after it carry their own (`--ticks=6000`)
    const eq = spec.indexOf('=');
    const bot = spec.slice(0, eq);
    const [method, ...args] = spec.slice(eq + 1).split(',');
    const child = Bun.spawn(['bun', 'markets/methods/lab/rate.ts', bot, `--method=${method}`, ...args], { env, stdout: 'inherit', stderr: 'inherit' });
    return child.exited.then(code => console.log(`JOB ${bot} ${method} exited ${code}`));
});
await Promise.all(jobs);
