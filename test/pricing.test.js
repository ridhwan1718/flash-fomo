// 34.3 — pricing smoothness test: run marketTick() many ticks, measure
// single-tick percent moves. Sharp jumps (turun/naik tajam) = > 2% in one tick.
// Pre-fix the band clamp hard-snapped mark across a 28% band; this catches that.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../js/core.js', 'utf8');

// run the IIFE body, expose state + marketTick by intercepting window.CORE return
const ctx = {};
ctx.window = ctx;
ctx.performance = { now: () => 0 };
ctx.window.CORE = null; // set below after eval captures the return
// core.js is: window.CORE = (function(){ ... return {...}; })();
new vm.Script(src, { filename: 'core.js' }).runInContext(vm.createContext(ctx));

const C = ctx.window.CORE;
if (!C || !C.state) throw new Error('CORE export missing');
C.state.mode = 'NORMAL';
C.buildParts();
C.seedHistory(150);
C.pickRegime();

const S = C.state;
// baseline mark
let prev = S.mark;
let maxTickPct = 0, totalTicks = 0;
const moves = [];
let roundHi = S.mark, roundLo = S.mark;
const N = 900; // ~one round (90s at 100ms tick)
for (let i = 0; i < N; i++) {
  C.marketTick();
  C.stepParticipants();
  const pct = ((S.mark - prev) / prev) * 100;
  totalTicks++;
  if (Math.abs(pct) > maxTickPct) maxTickPct = Math.abs(pct);
  moves.push(pct);
  if (S.mark > roundHi) roundHi = S.mark;
  if (S.mark < roundLo) roundLo = S.mark;
  prev = S.mark;
}
const excursionPct = ((roundHi - roundLo) / roundLo) * 100;
const meanMove = moves.reduce((a, b) => a + Math.abs(b), 0) / moves.length;

console.log(`ticks: ${N} | round excursion (hi-lo): ${excursionPct.toFixed(2)}% | mean |tick|: ${meanMove.toFixed(4)}% | max single-tick: ${maxTickPct.toFixed(3)}%`);

// Assertions: healthy curve = visible waves AND no sharp snap
if (excursionPct < 3) {
  console.error(`FAIL: price too flat (excursion ${excursionPct.toFixed(2)}%) — no visible pump/dump wave`);
  process.exit(1);
}
if (maxTickPct > 2) {
  console.error(`FAIL: single tick jumped ${maxTickPct.toFixed(2)}% — sharp snap, not a flowing price`);
  process.exit(1);
}
console.log('PASS: healthy price curve (visible waves, no single-tick sharp snap)');

// Every coin/mode, using the app's real start flow (resetGame → seedHistory → ticks).
// LUNAR's base ($1.1–2.8) sits below the old fixed $2 floor, which snapped it up to $2 in one tick.
for (const mode of Object.keys(C.MODES)) {
  for (const sym of Object.keys(C.COINS)) {
    for (let run = 0; run < 10; run++) {
      const c2 = { performance: { now: () => 0 } };
      c2.window = c2;
      new vm.Script(src, { filename: 'core.js' }).runInContext(vm.createContext(c2));
      const K = c2.window.CORE, KS = K.state;
      KS.mode = mode; KS.symbol = sym;
      K.buildParts(); K.resetGame(); K.seedHistory(150);
      let p = KS.mark, worst = 0;
      for (let i = 0; i < 300; i++) {
        K.marketTick(); K.stepParticipants();
        worst = Math.max(worst, Math.abs((KS.mark - p) / p) * 100);
        p = KS.mark;
      }
      if (worst > 2) {
        console.error(`FAIL: ${mode} ${sym} single tick jumped ${worst.toFixed(2)}%`);
        process.exit(1);
      }
    }
  }
}
console.log('PASS: no single-tick snap on any coin/mode');
