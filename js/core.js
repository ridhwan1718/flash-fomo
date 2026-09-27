/* =========================================================
   CORE — pure game logic (no DOM). Loaded before app.js
   Model: participants trade a synthetic regime-based market.
   Equity = START + realized cash + unrealized PnL of open pos.
   Margin call per position: unrealized loss >= margin.
   Orderbook = resting limit orders from participants' open pos.
   TP/SL auto-close per position. Trade history logged.
========================================================= */
window.CORE = (function(){
'use strict';

const START    = 10000;
const ROUND_MS = 90*1000;       // 1:30 per round
const CANDLE_SEC = 1.8;
const TICK = 100;               // engine tick ms
const SMALL = 1e-9;

/* ------------------------------------------------------------------
   0.4 / 6.1 — pure helpers
------------------------------------------------------------------ */
const R = (a,b)=> a+Math.random()*(b-a);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sum=(arr,fn)=> arr.reduce((s,x)=>s+fn(x),0);

/* ------------------------------------------------------------------
   BOT PERSONAS (3.1)
   persona: {openP, closeP, addP, lev:[min,max], notionalR:[min,max], sideFn, setSL:false, setTP:false}
------------------------------------------------------------------ */
const PERSONAS = {
  whale:    { name:'WHALE',    openP:.020, closeP:.008, addP:.006, lev:[2,4],   not:[.4,.9],  macd:false, sl:false, tp:false },
  momentum: { name:'MOMENTUM', openP:.035, closeP:.014, addP:.012, lev:[4,8],   not:[.25,.5], macd:true,  sl:true,  tp:true  },
  reversal: { name:'REVERSAL', openP:.028, closeP:.018, addP:.008, lev:[9,15],  not:[.12,.3], macd:false, sl:true,  tp:true  },
  chaos:    { name:'CHAOS',    openP:.040, closeP:.024, addP:.016, lev:[8,20],  not:[.3,.7],  macd:false, sl:false, tp:false },
};
const personaOf = {
  WhaleMama:'whale', WhaleWes:'whale', LamboLisa:'whale', BullBerry:'whale',
  FomoFrank:'momentum', NeonNate:'momentum', CandleKai:'momentum',
  ShortSue:'reversal', DipDana:'reversal', RugRita:'reversal',
  PaperPete:'chaos', CryptoCarl:'chaos', DiamondDog:'chaos', LeverLeo:'chaos', NearNia:'chaos',
};

/* ------------------------------------------------------------------
   DIFFICULTY MODES (9.1)
------------------------------------------------------------------ */
const MODES = {
  // pumpMax: max single-news-event move %; velMax: max velocity per tick; burstVol: burst regime vol multiplier
  EASY:   { bots:8,  levMax:10, roundMS:120000, vol:0.6,  openMul:0.4,  newsP:0.0001,  revP:0.0002, sharks:0, noise:0.00009, candleSec:3.0, pumpMax:0.008, velMax:0.0012, burstVol:1.5 },
  NORMAL: { bots:15, levMax:25, roundMS:90000,  vol:0.9,  openMul:0.85, newsP:0.00025, revP:0.0005, sharks:0, noise:0.00013, candleSec:2.8, pumpMax:0.014, velMax:0.0018, burstVol:1.9 },
  HARD:   { bots:15, levMax:25, roundMS:75000,  vol:1.2,  openMul:1.6,  newsP:0.0006,  revP:0.0012, sharks:3, noise:0.00018, candleSec:2.5, pumpMax:0.022, velMax:0.0025, burstVol:2.4 },
};
const SHARKS = ['SharkByte','TideLord','MakoMax'];

/* ------------------------------------------------------------------
   23.2 — COIN PERSONAS & BASE PRICES (each pair has its own market feel)
------------------------------------------------------------------ */
const COINS = {
  FOMO:  { base:62000,    dec:1, vol:1.0, minBase:56000, maxBase:70000, accent:'#f0a63a', tag:'BLUECHIP KING'   },
  MINT:  { base:184,      dec:2, vol:1.4, minBase:150,   maxBase:250,   accent:'#00e676', tag:'HIGH-BETA L1'    },
  LUNAR: { base:1.85,     dec:4, vol:0.9, minBase:1.1,   maxBase:2.8,   accent:'#ab47bc', tag:'MEME CHAOS'      },
};
// decimal formatter for a symbol (default FOMO → 1 decimal)
function fmtCoin(n, sym){
  sym = sym || state.symbol;
  const dec = (COINS[sym]&&COINS[sym].dec!=null) ? COINS[sym].dec : 1;
  return n.toLocaleString('en-US',{ minimumFractionDigits:dec, maximumFractionDigits:dec });
}
function basePriceOf(sym){ sym=sym||state.symbol; const c=COINS[sym]||COINS.FOMO; return R(c.minBase, c.maxBase); }
const symbolVolOf = (sym)=> (COINS[sym]&&COINS[sym].vol)!=null ? COINS[sym].vol : (state.symbolVol[sym]||1);

/* ------------------------------------------------------------------
   STATE
------------------------------------------------------------------ */
const state = {
  name:'YOU', theme:'dark', mode:'NORMAL',
  phase:'idle', roundLabel:'', roundIndex:0,
  roundTimer:0,
  symbol:'FOMO', symbols:['FOMO','MINT','LUNAR'],
  symbolVol:{FOMO:1.0, MINT:1.4, LUNAR:0.7},
  mark:62400, prevMark:62400, velocity:0, targetVelocity:0, candles:[], volMax:1,
  book:[], part:[], positions:[],
  pnlTicker:0, liqLog:'', newsLog:'', regimeLabel:'RANGE',
  tradeLog:[], rounds:[], actionLog:[],
  idSeq:0, playerLiquidated:false,
  regime:{ kind:'range', drift:0, vol:1, center:62400, dir:1, burstUntil:0, refMark:62400 },
  stats:{ trades:0, wins:0, maxEquity:START, bestPnl:0, worstPnl:0 },
};

/* ------------------------------------------------------------------
   PARTICIPANTS
------------------------------------------------------------------ */
const mkPart = (name,isPlayer)=>({ name,isPlayer, cash:0, equity:START, alive:true,
  positions:[], persona: isPlayer?null:(PERSONAS[personaOf[name]]||PERSONAS.chaos) });

function buildParts(){
  const P = MODES[state.mode]||MODES.NORMAL;
  state.part=[]; state.part.push(mkPart(state.name||'YOU', true));
  const names=['CryptoCarl','WhaleMama','DiamondDog','NeonNate','BullBerry','PaperPete',
   'LamboLisa','RugRita','CandleKai','WhaleWes','FomoFrank','ShortSue','LeverLeo','DipDana','NearNia'];
  const n = P.bots;
  names.slice(0,n).forEach(nm=> state.part.push(mkPart(nm,false)));
  for(let i=0;i<P.sharks;i++){
    const s={ name:SHARKS[i], isPlayer:false, cash:0, equity:START, alive:true, positions:[],
      persona:Object.assign({},PERSONAS.chaos,{lev:[15,25],openP:.07,sl:true,tp:true}) };
    state.part.push(s);
  }
}

function me_(){ return state.part.find(p=>p.isPlayer); }

/* ------------------------------------------------------------------
   PnL / EQUITY
------------------------------------------------------------------ */
function pnl(p){ const c=state.mark; return (c-p.entry)*p.qty*(p.dir===1?1:-1); }
function margin(p){ return p.notional / p.lev; }
/* 23.1 — isolated-margin liquidation price */
function liqPriceOf(p){ const mmr=0.015; return p.dir===1
    ? Math.max(0, p.entry*(1-(1/p.lev)+mmr))
    : Math.max(0, p.entry*(1+(1/p.lev)-mmr)); }
function unrealized(o){ return sum(o.positions, pnl); }
function equityOf(o){ return START + (o.cash||0) + unrealized(o); }
function myEquity(){ const m=me_(); return m? equityOf(m):START; }
function freeMargin(o){ return equityOf(o) - sum(o.positions, margin); }

/* ------------------------------------------------------------------
   MARKET — regime based (4.1)
------------------------------------------------------------------ */
function pickRegime(){
  const P = MODES[state.mode]||MODES.NORMAL;
  const r=Math.random();
  let kind='range', drift=0, vol=1, dir=1, center=state.mark, burstUntil=0;
  if(r<0.55){ kind='trend'; dir=Math.random()<0.6?1:-1; drift=dir*R(0.0006,0.0016)*P.vol; vol=P.vol; }
  else if(r<0.75){ kind='burst'; burstUntil=performance.now()+22000; const bVol=P.burstVol!=null?P.burstVol:1.9; vol=bVol; }
  else { kind='range'; center=state.mark; vol=P.vol; }
  state.regime={ kind, drift, vol, dir, center, burstUntil, refMark:state.mark };
  state.regimeLabel = kind==='trend' ? (dir>0?'TRENDING UP':'TRENDING DOWN') : (kind==='burst'?'VOLATILITY BURST':'RANGING');
  news(kind==='trend' ? (dir>0?'📰 breakout zone — shorts squeezed':'📰 consolidation — longs trapped')
       : kind==='burst'?'📰 whale order flooding the tape · 3× volatility'
       : '📊 liquidity stacking — tight range');
}
function news(msg){ state.newsLog = msg; }

function marketTick(){
  const reg = state.regime;
  const now = performance.now();
  const P = MODES[state.mode] || MODES.NORMAL;

  // Range center tracks mark price smoothly
  reg.center = state.mark * 0.998 + (reg.center || state.mark) * 0.002;
  const coinVol = symbolVolOf(state.symbol);
  const noiseBase = P.noise != null ? P.noise : 0.00015;
  const vol = (reg.vol || 1) * (P.vol || 1) * coinVol;

  let impulse = 0;
  if(reg.kind === 'range'){
    const diff = state.mark - reg.center;
    // Mean reversion + micro jitter
    impulse = -diff * 0.0035 + R(-noiseBase, noiseBase);
  } else {
    impulse = (reg.drift * P.vol) * vol + R(-noiseBase, noiseBase) * vol;
    if(now < reg.burstUntil){ impulse *= 1.5; }
    if(Math.random() < P.revP){
      reg.dir *= -1; reg.drift = -reg.drift;
      news(reg.dir > 0 ? '📰 momentum flip — buyers in control' : '📰 momentum flip — sellers in control');
    }
  }

  // Active micro-jitter ensuring price never stops / freezes
  const microStep = (Math.random() - 0.495) * noiseBase * 0.8;
  impulse += microStep;

  // Auto-regressive smoothing with live response
  state.velocity = (state.velocity * 0.84) + (impulse * 0.16);

  // Guarantee minimum tick movement so price never stays completely flat
  if(Math.abs(state.velocity) < 0.00002){
    state.velocity += (Math.random() < 0.5 ? 1 : -1) * 0.00003;
  }

  // Clamp velocity � difficulty-aware (EASY: gentle, HARD: wilder but still realistic)
  const velMax = P.velMax != null ? P.velMax : 0.0018;
  state.velocity = Math.max(-velMax, Math.min(velMax, state.velocity));
  state.prevMark = state.mark;
  state.mark = Math.max(2, state.mark * (1 + state.velocity));

  // Dynamic band clamp centered on regime reference
  const ref = reg.refMark || state.mark;
  if(state.mark > ref * 1.14){
    state.velocity = -Math.abs(state.velocity) * 0.8;
    state.mark = ref * 1.14;
    reg.refMark = state.mark; // shift ref so it never gets stuck at ceiling
  } else if(state.mark < ref * 0.86){
    state.velocity = Math.abs(state.velocity) * 0.8;
    state.mark = ref * 0.86;
    reg.refMark = state.mark; // shift ref so it never gets stuck at floor
  }

  // News impulses (smooth 1.4s progression)
  if(state.newsImpulse && state.newsImpulse.ticks > 0){
    state.newsImpulse.ticks--;
    state.mark = Math.max(2, state.mark * (1 + state.newsImpulse.per / 14));
    state.prevMark = state.mark;
  } else if(Math.random() < P.newsP && !state.newsImpulse){
    const dir = Math.random() < 0.5 ? 1 : -1;
      // Difficulty-scaled pump: EASY small, HARD bigger but still realistic
      const maxPump = P.pumpMax != null ? P.pumpMax : 0.014;
      const minPump = maxPump * 0.35;
      const total = R(minPump, maxPump) * dir;
    state.newsImpulse = { per: total, ticks: 14 };
    news(dir > 0 ? '📰 ' + state.symbol + ' ETF approved +' + (total * 100).toFixed(1) + '%' : '📉 ' + state.symbol + ' exchange hack ' + (total * 100).toFixed(1) + '%');
  }
  if(state.newsImpulse && state.newsImpulse.ticks <= 0) state.newsImpulse = null;

  // Candle creation and updates
  const candleSec = P.candleSec != null ? P.candleSec : CANDLE_SEC;
  const c = state.candles[state.candles.length - 1];
  if(!c || (now - c.t) / 1000 > candleSec){
    state.candles.push({ t: now, o: state.mark, h: state.mark, l: state.mark, c: state.mark, v: Math.min(100, R(8, 70)), vMax: state.volMax });
    if(state.candles.length > 420) state.candles.shift();
  } else {
    c.h = Math.max(c.h, state.mark);
    c.l = Math.min(c.l, state.mark);
    c.c = state.mark;
    c.v = Math.min(100, c.v + R(0, 4));
  }
  state.volMax = Math.max(state.volMax, ...state.candles.map(x => x.v));
}
function sma(k){ const c=state.candles; if(c.length<k) return state.mark;
  let s=0; for(let i=c.length-k;i<c.length;i++) s+=c[i].c; return s/k; }

/* ------------------------------------------------------------------
   OPEN / CLOSE (incl. TP/SL)
------------------------------------------------------------------ */
function openPosition(owner, side, notional, lev, tp, sl, isLimit, limitPrice, entryOverride){
  const dir = side==='long'?1:-1;
  // 8.2 — cap notional to avoid runaway positions (max 2x equity)
  const eq = equityOf(owner);
  notional = Math.min(notional, Math.max(eq, START)*2);
  const mg = notional/lev;
  if(freeMargin(owner) - mg < 0)
    return {ok:false, msg:(owner.isPlayer?'Insufficient margin — lower leverage or amount.':'maxed')};
  const entry = (entryOverride!=null)?entryOverride : (isLimit && limitPrice!=null ? limitPrice : state.mark);
  // limit order is NOT immediately fillable (rests in the book) when:
  //   buy  (long)  limitPrice is BELOW market
  //   sell (short) limitPrice is ABOVE market
  if(isLimit && limitPrice!=null && ((side==='long'&&limitPrice<state.mark)||(side==='short'&&limitPrice>state.mark))){
    state.book.push({type:'limit', pending:true, side, price:limitPrice, notional, lev, name:owner.name, isPlayer:owner.isPlayer, owner});
    return {ok:true, pending:true};
  }
  const qty = entry>0 ? notional/entry : 0;   // 8.2 guard NaN
  const pos={ id:++state.idSeq, owner, side, dir, entry, notional, lev, qty, tp, sl, reason:'open' };
  (owner.positions=owner.positions||[]).push(pos); state.positions.push(pos);
  addBookOrder(pos);
  return {ok:true, pending:false};
}
function addBookOrder(pos){
  const spread = R(-8,8)*state.mark*0.0006;
  const price = pos.entry + spread;
  state.book.push({ type:'pos', price, size:pos.notional, qty:pos.qty, name:pos.owner.name, side:pos.side, isPlayer:pos.owner.isPlayer, rid:pos.id, lev:pos.lev });
}
function closePosition(pos, reason, exitPriceOverride){
  // 33.1 isolated margin liquidation: loss is capped to exactly -margin(pos)
  let exitPr = (exitPriceOverride != null && !isNaN(exitPriceOverride)) ? exitPriceOverride : state.mark;
  let realized = pnl(pos, exitPr);
  if(reason === "liq"){ realized = -margin(pos); }
  pos.owner.cash = (pos.owner.cash||0) + realized;
  logTrade(pos.owner, pos, realized, reason, exitPr);
  pos.owner.positions = (pos.owner.positions||[]).filter(x=>x!==pos);
  state.positions = state.positions.filter(x=>x!==pos);
  state.book = state.book.filter(b=> b.rid!==pos.id);
  if(reason==='SL'||reason==='TP'){
    state.liqLog = (pos.owner.isPlayer?'You ':(pos.owner.name+' '))+'hit '+(reason==='TP'?'TP':'SL')+' '+(realized>=0?'+':'-')+fmtAbs(realized);
    if(!pos.owner.isPlayer) pushAct(pos.owner.name+' hit '+(reason==='TP'?'TP':'SL')+' '+(realized>=0?'+':'-')+fmtAbs(realized));
  } else if(reason==='liq'){
    if(!pos.owner.isPlayer){ state.liqLog = pos.owner.name+' liquidated -'+fmtAbs(realized); pushAct('⚠️ '+pos.owner.name+' liquidated'); }
  } else if(reason==='manual'){
    if(!pos.owner.isPlayer) pushAct(pos.owner.name+' closed '+(pos.side==='long'?'LONG':'SHORT')+' '+(realized>=0?'+':'-')+fmtAbs(realized));
  }
  // update global realized stats for player
  if(pos.owner.isPlayer && realized!==0){
    state.stats.trades++;
    if(realized>0){ state.stats.wins++; state.stats.bestPnl=Math.max(state.stats.bestPnl,realized); }
    else state.stats.worstPnl=Math.min(state.stats.worstPnl,realized);
  }
}
function fmtAbs(n){ n=Math.abs(Math.round(n)); return n>=1000?('$'+(n/1000).toFixed(1)+'k'):('$'+n); }
function fmtK(n){ n=Math.abs(Math.round(n)); return n>=1000?('$'+(n/1000).toFixed(1)+'k'):('$'+n); }
function pushAct(msg){ state.actionLog.push({ time:Date.now(), msg }); if(state.actionLog.length>20) state.actionLog.shift(); }

function logTrade(owner, pos, realized, reason, exitPr){
  if(!owner.isPlayer) return;
  let actualExit = (exitPr != null && !isNaN(exitPr)) ? exitPr : state.mark;
  state.tradeLog.push({ t:Date.now(), side:pos.side, notional:pos.notional, lev:pos.lev,
    entry:pos.entry, exit:actualExit, pnl:realized, reason,
    round: state.roundIndex });
}
function setTP(pos, tp, sl){ if(tp!=null)pos.tp=tp; if(sl!=null)pos.sl=sl; }

function checkTPsl(){
  state.positions.slice().forEach(p=>{
    const m=state.mark;
    if(p.dir===1){ if(p.tp!=null && m>=p.tp) closePosition(p,'TP');
      else if(p.sl!=null && m<=p.sl) closePosition(p,'SL'); }
    else { if(p.tp!=null && m<=p.tp) closePosition(p,'TP');
      else if(p.sl!=null && m>=p.sl) closePosition(p,'SL'); }
  });
}

/* ------------------------------------------------------------------
   ENGINE (per tick)
------------------------------------------------------------------ */
function stepParticipants(){
  const P = MODES[state.mode]||MODES.NORMAL;
  // fill pending limit orders (8.7 — entry = limit price)
  state.book.filter(b=>b.pending).slice().forEach(b=>{
    const touch = b.side==='long' ? state.mark<=b.price : state.mark>=b.price;
    if(touch){ state.book=state.book.filter(x=>x!==b);
      const r=openPosition(b.owner, b.side, b.notional, b.lev, null, null, false, null, b.price); // 8.7 entry = limit price
      if(b.isPlayer) news('✅ Your limit '+ (b.side==='long'?'buy':'sell')+' filled @ '+fmtF2(b.price));
    }
  });

  // bots act based on persona
  state.part.forEach(o=>{
    if(o.isPlayer||!o.alive) return;
    const per=o.persona||PERSONAS.chaos;
    (o.positions||[]).slice().forEach(p=>{ if(pnl(p)<=-margin(p)*0.98) closePosition(p,'liq'); });
    const np=(o.positions||[]).length;
    if(np===0 && Math.random()<per.openP*P.openMul){
      let side, lev=Math.round(R(per.lev[0],per.lev[1]));
      if(per.macd){ side = state.mark>=sma(20)?'long':'short'; }
      else if(Math.random()<0.5){ side= state.mark>=state.regime.center ? 'short':'long'; }
      else side= R(0,1)<.5?'long':'short';
      const ntl=Math.max(150, equityOf(o)*R(per.not[0],per.not[1]));
      const sl= per.sl && Math.random()<0.7 ? state.mark*(1-(R(0.004,0.02)*lev/6)) : null;
      const tp= per.tp && Math.random()<0.7 ? state.mark*(1+(R(0.004,0.02)*lev/6)) : null;
      const r=openPosition(o, side, ntl, lev, side==='long'?tp:null, side==='long'?sl: (sl!=null? state.mark*(1+(state.mark-sl)/state.mark):null) );
      if(r.ok && !o.isPlayer) pushAct(o.name+' '+(side==='long'?'opened LONG':'opened SHORT')+' '+lev+'x '+fmtK(ntl));
    } else if(np>0 && Math.random()<per.closeP){ closePosition(o.positions[0],'manual'); }
    else if(np>0 && Math.random()<per.addP){ const p=o.positions[0]; if(pnl(p)>0) openPosition(o,p.side,p.notional*0.4,p.lev); }
  });
  checkTPsl();

  // player margin-call
  state.positions.filter(p=>p.owner.isPlayer && pnl(p)<=-margin(p)).slice().forEach(p=>{ closePosition(p,'liq'); state.playerLiquidated=true; });

  // sync equities + ticker
  state.part.forEach(o=>{ o.equity=equityOf(o); });
  state.stats.maxEquity=Math.max(state.stats.maxEquity, myEquity());
  state.pnlTicker = sum(state.positions.filter(p=>p.owner.isPlayer), pnl);
}

/* ------------------------------------------------------------------
   ROUND LIFE-CYCLE
------------------------------------------------------------------ */
/* close everything idempotently (0.4) — banks realized cash, clears book */
function closeAllAndClear(reason){
  state.positions.slice().forEach(p=> closePosition(p, reason||'round-end'));
  state.book = state.book.filter(b=>!b.pending); // drop unfilled limit orders
  state.positions = state.positions.filter(p=> false);
  state.part.forEach(o=>{ (o.positions||[]).length=0; (o.positions=[]); });
}

/* 0.2: returns the winner if the round ends in a final; else eliminates bottom half.
   Pass isFinal=true when exactly 2 remain → returns sole survivor (champion). */
function resolveRound(){
  closeAllAndClear('round-end');
  const alive=state.part.filter(p=>p.alive).sort((a,b)=> b.equity-a.equity);
  state.roundIndex++;   // 8.3 — increment on each resolved round
  if(alive.length<=2){
    // grand final → champion is highest equity
    alive.slice(1).forEach(p=> p.alive=false);
    return { adv: alive.slice(0,1), final:true };
  }
  const keep=Math.ceil(alive.length/2);
  alive.slice(keep).forEach(p=> p.alive=false);
  return { adv: alive.slice(0,keep), final:false };
}

function recordRound(myStart, result){
  const m=me_();
  state.rounds.push({ index:state.roundIndex, label:state.roundLabel, myStart, myEnd:Math.round(m.equity),
                      result, trades:state.tradeLog.filter(t=>t.round===state.roundIndex).length });
}
function roundLabelOf(){
  const n=state.part.filter(p=>p.alive).length;
  if(n>=16)return 'ROUND OF 16'; if(n>=8)return 'QUARTERFINALS'; if(n>=4)return 'SEMIFINALS';
  if(n>=2)return 'GRAND FINAL'; return 'CHAMPION';
}

/* ------------------------------------------------------------------
   HISTORY / SEED / RESET
------------------------------------------------------------------ */
function seedHistory(count){
  let p=state.mark; state.candles=[];
  const now=performance.now();
  for(let i=0;i<count;i++){
    const o=p, c=o*(1+R(-0.004,0.004));
    state.candles.push({t:now-(count-i)*CANDLE_SEC*1000,o,h:Math.max(o,c),l:Math.min(o,c),c,v:R(8,60)});
    p=c;
  }
  state.volMax=Math.max(...state.candles.map(x=>x.v),1);
  state.mark=state.candles[state.candles.length-1].c;
}
function resetGame(){
  state.positions=[]; state.book=[]; state.candles=[];
  state.velocity=0; state.newsImpulse=null;
  state.mark = basePriceOf(state.symbol); state.prevMark=state.mark;
  state.pnlTicker=0; state.liqLog=''; state.playerLiquidated=false;
  state.tradeLog=[]; state.rounds=[]; state.actionLog=[];
  state.roundIndex=0; state.myStart=START;
  state.stats={ trades:0,wins:0,maxEquity:START,bestPnl:0,worstPnl:0 };
  state.part.forEach(p=>{ p.positions=[]; p.cash=0; p.equity=START; p.alive=true; });
  pickRegime();
}

function fmtF2(n){ return n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1}); }

/* ------------------------------------------------------------------
   EXPORT
------------------------------------------------------------------ */
return {
  state, START, ROUND_MS, TICK, MODES, BOT_NAMES:Object.keys(personaOf),
  COINS, fmtCoin, basePriceOf, symbolVolOf,
  pnl, margin, myEquity, equityOf, freeMargin, unrealized, sma, clamp, pushAct, liqPriceOf,
  buildParts, marketTick, openPosition, closePosition, setTP, stepParticipants,
  resolveRound, recordRound, closeAllAndClear, roundLabelOf, resetGame, seedHistory,
  R, pickRegime, news,
};

})();
