
function persistGameSession() {
  if (typeof S !== 'undefined' && S.inGame && phase === 'trading') {
    try {
      var sessionData = {
        name: S.name,
        mode: S.mode,
        symbol: S.symbol,
        roundLabel: S.roundLabel,
        roundTimer: S.roundTimer,
        roundTime: S.roundTimer,
        myRoundStart: S.myRoundStart,
        candles: S.candles.slice(-120),
        part: S.part,
        positions: S.positions,
        orders: S.orders,
        tradeLog: S.tradeLog,
        stats: S.stats,
        mark: S.mark,
        volMax: S.volMax
      };
      localStorage.setItem('ff_active_session_v24', JSON.stringify(sessionData));
    } catch(e) {}
  }
}

/* =========================================================
   APP - UI, round manager, input. Depends on CORE.
========================================================= */
(function(){
'use strict';

/* 0.6 — only surface an on-screen error banner while developing locally */
var IS_DEV = /localhost|127\.0\.0\.1|vercel/.test(location.hostname||'');
window.onerror=function(m,sr,l,c){
  try{ console.error('[FF]',m,sr,l,c); }catch(_){}
  // 19.1 / 24.7 — ignore injected Web3 wallet-extension errors (ethereum redefine, inpage, etc.)
  try{
    var msgTxt = (typeof m==='string') ? m : (m && m.message ? m.message : String(m||''));
    if(/ethereum|inpage|extension|wallet|web3|nonce|cannot redefine/i.test(msgTxt)){
      return true; // silence wallet-extension noise — it is not a game bug
    }
  }catch(_){}
  if(!IS_DEV) return;
  try{
    var e=document.createElement('div');
    e.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#7a1f1f;color:#fff;padding:8px 10px;font:12px/1.3 monospace;white-space:pre-wrap';
    e.textContent='ERROR: '+m+' @ '+(l||'?')+':'+(c||0);
    document.body.appendChild(e);
  }catch(_){}
};

var C = window.CORE || {};
var S = C.state || {};
var $ = function(id){ return document.getElementById(id); };

var IDS = ['gameUI','hRound','timer','hBal','hUpnl','rankPill','roundPill','obSym','tSym','mkt',
 'bLong','bShort','lev','levVal','amount','buyBtn','posTableBody','posEmpty','posCountBadge','boardBody','obBody',
 'roundIntro','roundIntroBox','board','modalCard','menu','nameInput','playBtn','themeBtn',
 'loading','loadFill','flash','clrPct','overview','histList','roundsList','soundBtn','soundPop','volRange',
 'limitToggle','limitWrap','limitVal','menuStats','newsTicker','botAct','closeAll',
 'pnlShareModal','sharePnlPct','shareSub','shareSym','shareSide','sharePrices','shareAmt','shareTrader','copyShareBtn','closeShareModal','pendingList','pendingBox','tvStrip','tvSym','tvO','tvH','tvL','tvC','tvChg','rulesBtn','exitBtn','inGameExitBtn','rulesModal','closeRulesBtn','exitModal','cancelExitBtn','confirmExitBtn','chartZoomIn','chartZoomOut','chartReset','estLiqPrice','riskBadge','tpslToggle','tpslWrap','tpVal','slVal','histSum','histTableBody','histEmpty'];
var el={}; IDS.forEach(function(id){ el[id]=$(id); });

var cvs=$('chart'), ctx=cvs.getContext('2d');
var chartState = {
  zoom: 1.0,
  panOffset: 0,
  panY: 0,
  dragStartY: 0,
  isDragging: false,
  dragStartX: 0,
  isYDragging: false,
  yDragStart: 0,
  yScale: 1.0,
  yScaleBase: 1.0
};

var phase='idle', canTrade=false, interval=null, lastTick=0, tradeSide='long';
var audio=null, soundOn=true, soundVol=0.18;
/* 19.6 — persisted volume */
function loadVol(){ try{ var v=parseFloat(localStorage.getItem('ff_vol')); if(!isNaN(v)) soundVol=Math.max(0,Math.min(1,v)); }catch(_){ soundVol=0.18; } } loadVol();

function fmt(n){ n=Math.round(n); return (n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US'); }
function fmtK(n){ n=Math.round(n); if(Math.abs(n)>=1000)return (n<0?'-':'')+'$'+(Math.abs(n)/1000).toFixed(1)+'k'; return fmt(n); }
function fmtF(n){ /* 23.2 — decimal-aware price formatter per symbol */
  if(C.fmtCoin && typeof C.fmtCoin==='function'){ try{ return C.fmtCoin(n,S.symbol); }catch(_){} }
  return n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1}); }
function getCss(v){ try{return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}catch(_){return '';} }
function roe(p){ var m=p.notional/p.lev; return m>0?(C.pnl(p)/m)*100:0; }
function flash(msg,red){ el.flash.textContent=msg; el.flash.style.display='block';
  el.flash.style.background= red?'#ee5a52':'#16a35e'; clearTimeout(flash._t);
  flash._t=setTimeout(function(){ el.flash.style.display='none'; },3000); }
function initAudio(){ if(!audio) audio=new (window.AudioContext||window.webkitAudioContext)(); }
function beep(freq,dur,type,vol){ if(!soundOn||!audio) return; try{
  var o=audio.createOscillator(),g=audio.createGain(); o.type=type||'square'; o.frequency.value=freq;
  var v=(vol!=null?vol:soundVol); g.gain.setValueAtTime(v,audio.currentTime); g.gain.linearRampToValueAtTime(0.0001,audio.currentTime+dur);
  o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime+dur); }catch(_){} }
function me(){ return S.part.find(function(p){return p.isPlayer;}); }

/* 5.1 — localStorage progression */
var LS={ get:function(k,d){ try{ var v=JSON.parse(localStorage.getItem(k)); return v==null?d:v; }catch(_){ return d; } },
         set:function(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(_){} } };
function revealMenuStats(){ var m=$('menuStats'); if(!m) return;
  var his=LS.get('ff_hiscore',C.START), streak=LS.get('ff_winstreak',0),
      tr=LS.get('ff_trades',{n:0,w:0}), wr= tr.n? Math.round(100*tr.w/tr.n):0;
  m.textContent='Best '+fmt(his)+' · Streak '+streak+' · Trades '+tr.n+' ('+wr+'% win)'; }

S.xHover=-1; S.yHover=-1;
if(cvs){ cvs.addEventListener('mousemove',function(e){ if(chartState.isDragging||chartState.isYDragging) return; var r=cvs.getBoundingClientRect(); S.xHover=e.clientX-r.left; S.yHover=e.clientY-r.top; });
cvs.addEventListener('mouseleave',function(){ S.xHover=-1; }); }

// Interactive Zoom, Smooth Drag & Pan Engine
if(cvs){
  cvs.addEventListener('wheel', function(e){
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.15 : 0.87;
    chartState.zoom = Math.max(0.35, Math.min(4.0, (chartState.zoom || 1.0) * factor));
    drawChart();
  }, { passive: false });

  cvs.addEventListener('mousedown', function(e){
    var rect = cvs.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var W = cvs.clientWidth || 800;
    var padR = 68;
    if(mouseX > W - padR){
      chartState.isYDragging = true;
      chartState.yDragStart = e.clientY;
      chartState.yScaleBase = chartState.yScale || 1.0;
      cvs.style.cursor = 'ns-resize';
    } else {
      chartState.isDragging = true;
      chartState.dragStartX = e.clientX;
      chartState.dragStartY = e.clientY;
      cvs.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', function(e){
    if(chartState.isDragging && !chartState.isYDragging){
      var dx = e.clientX - chartState.dragStartX;
      var dy = e.clientY - chartState.dragStartY;
      var W = cvs ? cvs.clientWidth : 800;
      var basePer = Math.round(100 / (chartState.zoom || 1.0));
      var candleW = (W - 74) / Math.max(1, basePer);
      var n = (S.candles && S.candles.length) || 100;
      
      // Smooth horizontal pan with safety clamp
      chartState.panOffset = (chartState.panOffset || 0) + (dx / candleW);
      // Clamp panOffset: allow up to 25 candles future breathing room, and up to oldest candle
      var maxPan = Math.max(0, n - 15);
      chartState.panOffset = Math.max(-25, Math.min(maxPan, chartState.panOffset));

      // Vertical pan
      chartState.panY = (chartState.panY || 0) + dy;
      chartState.dragStartX = e.clientX;
      chartState.dragStartY = e.clientY;
      drawChart();
    } else if(chartState.isYDragging){
      var dy = e.clientY - chartState.yDragStart;
      chartState.yScale = Math.max(0.25, Math.min(6.0, chartState.yScaleBase * (1 - dy * 0.005)));
      drawChart();
    }
  });

  window.addEventListener('mouseup', function(){
    if(chartState.isDragging || chartState.isYDragging){
      chartState.isDragging = false;
      chartState.isYDragging = false;
      if(cvs) cvs.style.cursor = 'crosshair';
    }
  });

  // Touch support for mobile/touchpads
  cvs.addEventListener('touchstart', function(e){
    if(e.touches && e.touches.length === 1){
      chartState.isDragging = true;
      chartState.dragStartX = e.touches[0].clientX;
      chartState.dragStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  cvs.addEventListener('touchmove', function(e){
    if(chartState.isDragging && e.touches && e.touches.length === 1){
      var dx = e.touches[0].clientX - chartState.dragStartX;
      var dy = e.touches[0].clientY - chartState.dragStartY;
      var W2 = cvs ? cvs.clientWidth : 800;
      var basePer2 = Math.round(100 / (chartState.zoom || 1.0));
      var candleW2 = (W2 - 74) / Math.max(1, basePer2);
      var n = (S.candles && S.candles.length) || 100;

      chartState.panOffset = (chartState.panOffset || 0) + (dx / candleW2);
      chartState.panOffset = Math.max(-25, Math.min(Math.max(0, n - 15), chartState.panOffset));
      chartState.panY = (chartState.panY || 0) + dy;
      chartState.dragStartX = e.touches[0].clientX;
      chartState.dragStartY = e.touches[0].clientY;
      drawChart();
    }
  }, { passive: true });

  cvs.addEventListener('touchend', function(){
    chartState.isDragging = false;
  });

  // Double click resets view to latest
  cvs.addEventListener('dblclick', function(){
    chartState.zoom = 1.0;
    chartState.panOffset = 0;
    chartState.panY = 0;
    chartState.yScale = 1.0;
    drawChart();
  });
}

function drawChart(){
  if(!S.candles || !S.candles.length) return;
  var W = cvs.clientWidth || 640, H = cvs.clientHeight || 360, dpr = window.devicePixelRatio || 1;
  cvs.width = W * dpr; cvs.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  var padL = 8, padR = 68, padT = 16, padB = 22, volH = Math.min(50, H * 0.12), plotH = H - padT - padB - volH;
  var n = S.candles.length;
  var basePer = Math.round(90 / (chartState.zoom || 1.0));
  var per = Math.max(15, Math.min(n, basePer));

  // Breathing room on the right (6 candles padding like TradingView)
  var rightMarginCandles = 6;
  var pan = chartState.panOffset || 0;
  var rawStart = n - per + rightMarginCandles - Math.round(pan);
  var start = Math.max(0, Math.min(n - 5, rawStart));
  var end = Math.min(n, start + per);

  var i, cc, x;
  var lo = Infinity, hi = -Infinity;
  for(i = start; i < end; i++){
    cc = S.candles[i];
    if(cc.l < lo) lo = cc.l;
    if(cc.h > hi) hi = cc.h;
  }
  if(!isFinite(lo) || !isFinite(hi) || lo >= hi){
    lo = S.mark * 0.98;
    hi = S.mark * 1.02;
  }

  // Include open player positions in price range
  var mypos = S.positions.filter(function(p){ return p.owner && p.owner.isPlayer; });
  mypos.forEach(function(p){
    [p.entry, p.tp, p.sl].forEach(function(v){
      if(v == null) return;
      if(v < lo) lo = v;
      if(v > hi) hi = v;
    });
  });

  var pp = (hi - lo) * 0.12 || 1;
  hi += pp; lo -= pp;

  // Apply Y scale and panY
  var mid = (hi + lo) / 2, halfRange = (hi - lo) / 2;
  var ysc = chartState.yScale || 1.0;
  var yOffsetPrice = ((chartState.panY || 0) / (plotH || 1)) * (hi - lo);
  hi = mid + halfRange / ysc + yOffsetPrice;
  lo = mid - halfRange / ysc + yOffsetPrice;

  var chartWidth = W - padL - padR;
  function xOf(idx){ return padL + ((idx - start) / (per - 1)) * chartWidth; }
  function yOf(p){ return padT + ((hi - p) / (hi - lo)) * plotH; }

  var vMax = S.volMax || 1;
  var candleSlotW = chartWidth / per;
  var vw = Math.max(2, candleSlotW * 0.68);

  // Background
  ctx.fillStyle = getCss('--panel') || '#0d1117';
  ctx.fillRect(0, 0, W, H);

  // Grid lines and price labels on the right
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8b949e';
  ctx.font = '600 10.5px Quicksand, sans-serif';

  var gridSteps = 5;
  for(var g = 0; g <= gridSteps; g++){
    var pv = lo + ((hi - lo) * g) / gridSteps;
    var yy = Math.round(yOf(pv)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(W - padR, yy);
    ctx.stroke();

    ctx.textAlign = 'right';
    ctx.fillText(fmtF(pv), W - 6, yy + 3.5);
  }

  // Vertical separator for right price axis
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath();
  ctx.moveTo(W - padR, padT);
  ctx.lineTo(W - padR, H - padB);
  ctx.stroke();

  // Volume Bars
  if(S.volOn !== false){
    for(i = start; i < end; i++){
      cc = S.candles[i];
      var bh = Math.max(2, volH * (cc.v / vMax));
      ctx.fillStyle = cc.c >= cc.o ? 'rgba(16, 240, 128, 0.25)' : 'rgba(255, 51, 85, 0.25)';
      ctx.fillRect(xOf(i) - vw/2, H - padB - bh, vw, bh);
    }
  }

  // Candles (Wicks + Bodies)
  for(i = start; i < end; i++){
    cc = S.candles[i];
    x = xOf(i);
    var isUp = cc.c >= cc.o;
    var col = isUp ? '#10f080' : '#ff3355';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.2;

    // Wick
    ctx.beginPath();
    ctx.moveTo(x, yOf(cc.h));
    ctx.lineTo(x, yOf(cc.l));
    ctx.stroke();

    // Body
    var yOpen = yOf(cc.o);
    var yClose = yOf(cc.c);
    var topY = Math.min(yOpen, yClose);
    var bodyH = Math.max(1.5, Math.abs(yOpen - yClose));
    ctx.fillRect(x - vw/2, topY, vw, bodyH);
  }

  // Clean Single-Pass Position Lines (No duplicate drawing!)
  if(S.myLines !== false && mypos.length){
    mypos.forEach(function(p){
      var yEntry = yOf(p.entry);
      var pnlCur = C.pnl(p);
      var pnlPct = roe(p);
      var pnlCol = pnlCur >= 0 ? '#10f080' : '#ff3355';
      var pnlText = (pnlCur >= 0 ? '+' : '-') + fmt(Math.abs(pnlCur)) + ' (' + (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%)';

      // Entry line
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, yEntry);
      ctx.lineTo(W - padR, yEntry);
      ctx.stroke();
      ctx.setLineDash([]);

      // Entry label
      ctx.fillStyle = '#38bdf8';
      ctx.font = '700 11px Quicksand, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText((p.side === 'long' ? '▲ LONG' : '▼ SHORT') + ' ' + p.lev + 'x @ ' + fmtF(p.entry), padL + 4, yEntry - 4);

      // Floating live PnL badge on the entry line
      ctx.fillStyle = pnlCol;
      ctx.textAlign = 'right';
      ctx.fillText('PnL: ' + pnlText, W - padR - 8, yEntry - 4);

      // TP line
      if(p.tp){
        var yTp = yOf(p.tp);
        ctx.strokeStyle = '#10f080';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, yTp);
        ctx.lineTo(W - padR, yTp);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#10f080';
        ctx.font = '700 10.5px Quicksand, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('🎯 TP ' + fmtF(p.tp), padL + 4, yTp - 3);
      }

      // SL line
      if(p.sl){
        var ySl = yOf(p.sl);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, ySl);
        ctx.lineTo(W - padR, ySl);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ef4444';
        ctx.font = '700 10.5px Quicksand, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('🛡️ SL ' + fmtF(p.sl), padL + 4, ySl - 3);
      }

      // Liquidation warning line
      var liqPrice = (C.liqPriceOf) ? C.liqPriceOf(p) : 0;
      if(liqPrice > 0){
        var yLiq = yOf(liqPrice);
        var nearLiq = Math.abs(S.mark - liqPrice) / liqPrice < 0.15;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = nearLiq ? 2.2 : 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, yLiq);
        ctx.lineTo(W - padR, yLiq);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#f59e0b';
        ctx.font = '700 10.5px Quicksand, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('⚠️ LIQ ' + fmtF(liqPrice) + (nearLiq ? ' DANGER' : ''), W - padR - 8, yLiq - 3);
      }
    });
  }

  // SMAs
  var closes = S.candles.map(function(c){ return c.c; });
  function smaArr(k){
    var a = [], s = 0;
    for(var q = 0; q < n; q++){
      s += closes[q];
      if(q >= k) s -= closes[q - k];
      a[q] = q >= k - 1 ? s / k : null;
    }
    return a;
  }
  function drawLine(a, st){
    ctx.strokeStyle = st;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    var go = false;
    for(i = start; i < end; i++){
      if(a[i] == null){ go = false; continue; }
      x = xOf(i); var y = yOf(a[i]);
      if(go) ctx.lineTo(x, y);
      else { ctx.moveTo(x, y); go = true; }
    }
    ctx.stroke();
  }
  drawLine(smaArr(12), '#d8a81c');
  drawLine(smaArr(24), '#3f6fb5');

  // Live Price Line & Right Axis Pill (Neon Glowing)
  var my = Math.round(yOf(S.mark)) + 0.5;
  var isPriceUp = S.mark >= (S.prevMark || S.mark);
  var priceColor = isPriceUp ? '#10f080' : '#ff3355';

  ctx.strokeStyle = priceColor;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(padL, my);
  ctx.lineTo(W - padR, my);
  ctx.stroke();
  ctx.setLineDash([]);

  // Right Axis glowing price pill
  ctx.fillStyle = priceColor;
  ctx.fillRect(W - padR, my - 9, padR, 18);
  ctx.fillStyle = '#05080e';
  ctx.font = '800 11px Quicksand, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(fmtF(S.mark), W - padR/2, my + 3.5);

  // Market Regime Tag
  ctx.fillStyle = '#10f080';
  ctx.font = '700 10.5px Quicksand, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('● ' + (S.regimeLabel || 'MARKET ACTIVE'), padL + 4, padT - 3);

  // Crosshair + Tooltip
  if(S.xHover >= 0 && S.xHover <= W - padR){
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(S.xHover, padT); ctx.lineTo(S.xHover, H - padB);
    ctx.moveTo(padL, S.yHover); ctx.lineTo(W - padR, S.yHover);
    ctx.stroke();
    ctx.setLineDash([]);

    var hoverIdx = Math.round(start + ((S.xHover - padL) / chartWidth) * (per - 1));
    if(hoverIdx >= 0 && hoverIdx < n){
      var cc2 = S.candles[hoverIdx];
      var d = new Date(cc2.t);
      var ttxt = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
      ctx.fillStyle = 'rgba(13, 17, 23, 0.92)';
      ctx.fillRect(W - padR - 110, padT, 104, 52);
      ctx.strokeStyle = 'var(--line)';
      ctx.strokeRect(W - padR - 110, padT, 104, 52);

      ctx.fillStyle = '#f0f3f8';
      ctx.font = '9.5px Quicksand, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('O: ' + fmtF(cc2.o) + '  H: ' + fmtF(cc2.h), W - padR - 104, padT + 14);
      ctx.fillText('L: ' + fmtF(cc2.l) + '  C: ' + fmtF(cc2.c), W - padR - 104, padT + 26);
      ctx.fillText('Vol: ' + Math.round(cc2.v) + '  ' + ttxt, W - padR - 104, padT + 38);
    }
  }
}

function renderOB(){
  if(!S.book) return;
  var open=S.book.filter(function(b){return !b.pending;});
  var asks=open.filter(function(b){return b.side==='short';}).sort(function(a,b){return b.price-a.price;}).slice(0,9);
  var bids=open.filter(function(b){return b.side==='long';}).sort(function(a,b){return a.price-b.price;}).slice(0,9);
  var maxS=1; asks.concat(bids).forEach(function(b){maxS=Math.max(maxS,b.size);});
  function row(o,d){ var hl=o.isPlayer?' style="background:var(--amber);color:#3a2600;font-weight:800"':'';
    return '<div class="ob-row"><span style="color:var(--'+(d?'green':'red')+')">'+fmtF(o.price)+'</span>'+
      '<span'+hl+'>'+(o.isPlayer?'⭐ YOU':(o.name||'?'))+' '+fmtK(o.size)+'</span>'+
      '<div class="bg" style="background:var(--'+(d?'green':'red')+');width:'+Math.round((o.size/maxS)*100)+'%"></div></div>'; }
  var html='';
  for(var a=asks.length-1;a>=0;a--) html+=row(asks[a],0);
  var askP=asks.length?asks[asks.length-1].price:S.mark;
  var bidP=bids.length?bids[0].price:S.mark;
  var dirUp=S.mark>=(S.prevMark||S.mark);
  html+='<div class="ob-mid"><span class="'+(dirUp?'g':'r')+'">'+(dirUp?'▲':'▼')+'</span> <b>'+fmtF(S.mark)+'</b></div>'+
        '<div class="ob-count">spread '+fmtF(Math.abs(askP-bidP))+' · '+S.book.length+' open</div>';
  for(var b=0;b<bids.length;b++) html+=row(bids[b],1);
  var pend=S.book.filter(function(b){return b.pending&&b.isPlayer;});
  for(var q=0;q<pend.length;q++){ var o=pend[q];
    html+='<div class="ob-row" style="opacity:.7"><span style="color:var(--accent)">⏳ LIMIT '+(o.side==='long'?'BUY':'SELL')+'</span><span>'+fmtF(o.price)+' '+fmtK(o.notional)+' <button class="btn-mini" data-cx="'+q+'">✕</button></span></div>'; }
  el.obBody.innerHTML=html;
  var cx=el.obBody.querySelectorAll('[data-cx]');
  for(var w=0;w<cx.length;w++){ (function(k){ cx[w].onclick=function(){ cancelPending(k); }; })(parseInt(cx[w].getAttribute('data-cx'),10)); }
}
function cancelPending(k){ var p=S.book.filter(function(b){return b.pending&&b.isPlayer;})[k]; if(!p)return; S.book=S.book.filter(function(b){return b!==p;}); flash('Limit order cancelled'); renderAll(); }
function renderBoard(){
  var list=S.part.slice().sort(function(a,b){return (b.alive?1:0)-(a.alive?1:0)||b.equity-a.equity;});
  var html='';
  for(var i=0;i<list.length;i++){ var x=list[i], hl=x.isPlayer?' style="color:var(--amber);font-weight:800"':'';
    html+='<tr><td>'+(x.alive?i+1:'–')+'</td><td style="text-align:left"'+hl+'>'+(x.isPlayer?'⭐ '+x.name:x.name)+(x.alive?'':' 🔸')+'</td>'+
      '<td class="'+(x.alive?'':'mute')+'"'+hl+'>'+fmt(x.equity)+'</td>'+
      '<td class="mute">'+S.mode.slice(0,1)+'</td></tr>'; }
  el.boardBody.innerHTML=html;
  var alive=S.part.filter(function(p){return p.alive;}).sort(function(a,b){return b.equity-a.equity;});
  var r=-1; for(var k=0;k<alive.length;k++){ if(alive[k].isPlayer){r=k+1;break;} }
  el.rankPill.textContent='🏆 '+(r>0?(r===1?'1st':r===2?'2nd':r===3?'3rd':r+'th'):'OUT');
}

function posById(id){ return S.positions.find(function(p){return p.id===id;}); }
var posFP="";   // 16.1 fingerprint to skip rebuilds when nothing changed
function updatePosFP(){ var fp=""; S.positions.filter(function(p){return p.owner&&p.owner.isPlayer;}).forEach(function(p){ fp+=p.id+":"+Math.round(C.pnl(p))+";"; }); return fp; }
/* 19.3 / 23.1 — positions rendered as a wide table incl. Liq Price */
function renderPos(force){
  var mine=S.positions.filter(function(p){return p.owner&&p.owner.isPlayer;});
  if(el.posCountBadge) el.posCountBadge.textContent=mine.length;
  var tbody = el.posTableBody || $('posTableBody');
  var emptyEl = el.posEmpty || $('posEmpty');
  if(!mine.length){
    if(tbody) tbody.innerHTML='';
    if(emptyEl) emptyEl.style.display='block';
    posFP=""; return;
  }
  if(emptyEl) emptyEl.style.display='none';
  if(!tbody) return;

  // Check if position IDs matched existing rows to update in-place without destroying DOM buttons
  var existingRows = tbody.querySelectorAll('tr[data-pid]');
  var idsMatch = existingRows.length === mine.length;
  if(idsMatch){
    for(var k=0; k<mine.length; k++){
      if(existingRows[k].getAttribute('data-pid') !== String(mine[k].id)){ idsMatch = false; break; }
    }
  }

  if(idsMatch && !force){
    // In-place update: buttery smooth, never destroys button under mouse pointer
    for(var j=0; j<mine.length; j++){
      var row = existingRows[j];
      var pj = mine[j], pnj = C.pnl(pj), pcolj = pnj>=0 ? "g" : "r";
      var marginj = pj.notional / pj.lev, liqj = (C.liqPriceOf) ? C.liqPriceOf(pj) : 0;
      var cells = row.children;
      if(cells.length >= 9){
        cells[3].textContent = fmtF(S.mark);
        cells[4].textContent = fmtF(liqj);
        cells[5].textContent = fmtK(pj.notional);
        cells[6].textContent = fmtK(marginj);
        cells[7].className = pcolj + " font-mono";
        cells[7].style.fontWeight = "700";
        cells[7].textContent = (pnj>=0?'+':'-') + fmt(Math.abs(pnj)) + " (" + (pnj>=0?'+':"") + roe(pj).toFixed(1) + "%)";
      }
    }
    return;
  }

  // Position count or IDs changed: full rebuild
  var html="";
  for(var i=0;i<mine.length;i++){
    var p=mine[i], pn=C.pnl(p), pcol=pn>=0?"g":"r";
    var margin=p.notional/p.lev, liq=(C.liqPriceOf)?C.liqPriceOf(p):0;
    html+="<tr data-pid=\""+p.id+"\">"+
      "<td>"+(p.dir===1?"<span class=\"g\" style=\"font-weight:800\">▲ LONG</span>":"<span class=\"r\" style=\"font-weight:800\">▼ SHORT</span>")+"</td>"+
      "<td>"+p.lev+"x</td>"+
      "<td>"+fmtF(p.entry)+"</td>"+
      "<td>"+fmtF(S.mark)+"</td>"+
      "<td class=\"liq\">"+fmtF(liq)+"</td>"+
      "<td>"+fmtK(p.notional)+"</td>"+
      "<td>"+fmtK(margin)+"</td>"+
      "<td class=\""+pcol+"\" style=\"font-weight:700;font-variant-numeric:tabular-nums\">"+(pn>=0?'+':'-')+fmt(Math.abs(pn))+" ("+(pn>=0?'+':"")+roe(p).toFixed(1)+"%)</td>"+
      "<td style=\"text-align:right;white-space:nowrap\">"+
        "<button class=\"btn-mini\" data-c=\""+p.id+"\" style=\"cursor:pointer;font-weight:700\">Close</button> "+
        "<button class=\"btn-mini\" data-h=\""+p.id+"\" title=\"Close 50% of this position\" style=\"cursor:pointer;font-weight:700\">½ Close</button>"+
      "</td></tr>";
  }
  tbody.innerHTML=html;
}
/* Fast, instant position action handler with pointerdown + click prevention */
var posHolder = el.posTableBody || $('posTableBody');
function handlePosAction(ev){
  var t = ev.target.closest("[data-c],[data-h]");
  if(!t) return;
  ev.preventDefault();
  ev.stopPropagation();
  var id = +(t.getAttribute("data-c") || t.getAttribute("data-h"));
  if (t.hasAttribute("data-c")) closePos(id);
  else closeHalf(id);
}
if(posHolder){
  posHolder.addEventListener("click", handlePosAction);
  posHolder.addEventListener("pointerdown", function(ev){
    var t = ev.target.closest("[data-c],[data-h]");
    if(t){ ev.preventDefault(); handlePosAction(ev); }
  });
}

function closePos(id){
  var p = posById(id);
  if(!p){ renderPos(true); return; }
  var pn = C.pnl(p);
  C.closePosition(p, "manual");
  renderPos(true);
  renderOverview();
  renderHistory();
  if(pn > 0){ beep(1200, 0.12, 'sine'); } else if(pn < 0){ beep(180, 0.15, 'triangle'); }
  flash("Closed " + (pn >= 0 ? "+" : "-") + fmt(Math.abs(pn)));
  try{ updateClr(); }catch(e){}
  if(typeof persistGameSession === 'function') persistGameSession();
}

function closeHalf(id){
  var p = posById(id);
  if(!p){ renderPos(true); return; }
  var half = p.notional / 2;
  var pn = C.pnl(p) / 2;
  // Reduce position in place directly — instant, zero lag, no margin check failure, preserves entry price
  p.owner.cash = (p.owner.cash || 0) + pn;
  if(p.owner.isPlayer){
    S.tradeLog.push({
      t: Date.now(),
      side: p.side,
      notional: half,
      lev: p.lev,
      entry: p.entry,
      exit: S.mark,
      pnl: pn,
      reason: 'manual (50%)',
      round: S.roundIndex
    });
    if(pn !== 0){
      S.stats.trades++;
      if(pn > 0){ S.stats.wins++; S.stats.bestPnl = Math.max(S.stats.bestPnl, pn); }
      else S.stats.worstPnl = Math.min(S.stats.worstPnl, pn);
    }
  }
  p.notional = half;
  p.qty = p.entry > 0 ? (half / p.entry) : 0;
  // Update linked book order size
  var bookOrder = S.book.find(function(b){ return b.rid === p.id; });
  if(bookOrder){ bookOrder.size = half; bookOrder.qty = p.qty; }

  renderPos(true);
  renderOverview();
  renderHistory();
  beep(pn >= 0 ? 880 : 320, 0.1);
  flash("Closed ½ " + (pn >= 0 ? "+" : "-") + fmt(Math.abs(pn)));
  try{ updateClr(); }catch(e){}
  if(typeof persistGameSession === 'function') persistGameSession();
}

function renderHistory(){
  var log = S.tradeLog || [];
  var sumEl = el.histSum || $('histSum');
  var tbody = el.histTableBody || $('histTableBody');
  var emptyEl = el.histEmpty || $('histEmpty');
  // 34.1 — fingerprint: skip full table rewrite when tradeLog unchanged (fixes share button re-render every tick)
  var fp = log.length + ':' + (log[log.length-1] ? log[log.length-1].pnl + ':' + log[log.length-1].exit + ':' + (log[log.length-1].reason||'') : 'x');
  if(tbody && fp === renderHistory._fp){ return; }
  renderHistory._fp = fp;

  if (!log.length) {
    if (sumEl) sumEl.innerHTML = '<span class="mute">0 trades realised</span>';
    if (tbody) tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    if (el.histList) el.histList.innerHTML = '<p class="mute" style="font-size:12px">Your realised trades will appear here.</p>';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  var total = 0, wins = 0;
  log.forEach(function(t){ total += (t.pnl || 0); if((t.pnl || 0) > 0) wins++; });
  var winRate = log.length ? Math.round(100 * wins / log.length) : 0;
  var sumHtml = '<b>' + log.length + '</b> trades · <b class="' + (total >= 0 ? 'g' : 'r') + '">' + (total >= 0 ? '+' : '-') + fmt(Math.abs(total)) + '</b> · <b>' + winRate + '%</b> win rate';
  if (sumEl) sumEl.innerHTML = sumHtml;

  var html = '';
  for (var i = log.length - 1; i >= 0; i--) {
    var t = log[i];
    var pnl = t.pnl || 0;
    var col = pnl >= 0 ? 'g' : 'r';
    var isLong = t.side === 'long';
    var sideBadge = isLong ? '<span class="g" style="font-weight:800">▲ LONG</span>' : '<span class="r" style="font-weight:800">▼ SHORT</span>';
    var pct = (t.notional && t.lev) ? (pnl / (t.notional / t.lev) * 100) : 0;
    var pnlText = (pnl >= 0 ? '+' : '-') + fmt(Math.abs(pnl)) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)';
    var reasonBadge = '<span class="mute" style="font-size:11px;text-transform:uppercase;padding:2px 6px;background:var(--panel2);border-radius:4px;border:1px solid var(--line)">' + (t.reason || 'manual') + '</span>';

    html += '<tr data-trade-idx="' + i + '">' +
      '<td style="text-align:left;white-space:nowrap">' + sideBadge + ' <span class="mute" style="font-size:11px">' + (t.lev || 1) + 'x</span></td>' +
      '<td style="text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap">' + fmtF(t.entry) + ' <span class="mute">→</span> ' + fmtF(t.exit) + '</td>' +
      '<td class="' + col + '" style="text-align:right;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap">' + pnlText + '</td>' +
      '<td style="text-align:center">' + reasonBadge + '</td>' +
      '<td style="text-align:right;white-space:nowrap"><button class="btn-mini" data-share="' + i + '" style="font-size:11px;padding:3px 8px;cursor:pointer">📷 Share</button></td>' +
      '</tr>';
  }
  if (tbody) tbody.innerHTML = html;
  if (el.histList) el.histList.innerHTML = '<div class="hist-sum">' + sumHtml + '</div>' + html;
}
/* 19.4 — shareable PnL card modal */
window.shareTrade = function shareTrade(idx){
  var log = S.tradeLog || [];
  var t = log[idx];
  if(!t) return;
  var modal = document.getElementById('pnlShareModal');
  if(!modal) return;

  var pct = (t.notional && t.lev) ? (t.pnl / (t.notional / t.lev) * 100) : 0;
  var isWin = (t.pnl || 0) >= 0;

  var pnlPctEl = document.getElementById('sharePnlPct');
  if(pnlPctEl){
    pnlPctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    pnlPctEl.className = 'share-pct ' + (isWin ? 'g' : 'r');
  }
  var subEl = document.getElementById('shareSub');
  if(subEl) subEl.textContent = (isWin ? 'realised profit' : 'realised loss') + ' · ' + ((t.side || 'LONG').toUpperCase());
  var symEl = document.getElementById('shareSym');
  if(symEl) symEl.textContent = (S.symbol || 'FOMO') + '/USDT';
  var sideEl = document.getElementById('shareSide');
  if(sideEl) sideEl.textContent = (t.side === 'long' ? 'LONG' : 'SHORT') + ' ' + (t.lev || 1) + 'x';
  var pricesEl = document.getElementById('sharePrices');
  if(pricesEl) pricesEl.textContent = fmtF(t.entry) + ' → ' + fmtF(t.exit);
  var amtEl = document.getElementById('shareAmt');
  if(amtEl){
    amtEl.textContent = (isWin ? '+' : '-') + fmt(Math.abs(t.pnl || 0));
    amtEl.className = 'share-row b ' + (isWin ? 'g' : 'r');
  }
  var traderEl = document.getElementById('shareTrader');
  if(traderEl) traderEl.textContent = S.name || 'YOU';

  S._lastSharedTrade = t;
  modal.style.display = 'flex';
}
if(el.histList) el.histList.addEventListener('click',function(ev){ var b=ev.target.closest('[data-share]'); if(!b)return; shareTrade(+b.getAttribute('data-share')); }); // redundant with document-level delegation at L1268 but harmless (same action)
if(el.closeShareModal) el.closeShareModal.onclick=function(){ el.pnlShareModal.style.display='none'; };
if(el.pnlShareModal) el.pnlShareModal.onclick=function(ev){ if(ev.target===el.pnlShareModal) el.pnlShareModal.style.display='none'; }; // 24.1 close on backdrop click
if(el.copyShareBtn) el.copyShareBtn.onclick=function(){ var t=S._lastSharedTrade; if(!t){ flash('Nothing shared yet','r'); return; }
  var pct=t.pnl&&t.notional&&t.lev? t.pnl/(t.notional/t.lev)*100:0;
  var txt='⚡ FLASH FOMO\n'+(pct>=0?'+':'')+pct.toFixed(1)+'% ('+(t.pnl>=0?'+':'-')+fmt(Math.abs(t.pnl||0))+')\n'+(S.symbol||'FOMO')+'/USDT '+(t.side||'').toUpperCase()+' '+(t.notional?t.notional/t.lev:1)+'×\n'+(S.name||'YOU');
  var fb=function(){ var ta=document.createElement('textarea'); ta.value=txt; ta.style.cssText='position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); var ok=false; try{ ok=document.execCommand('copy'); }catch(_){ ok=false; } document.body.removeChild(ta); if(ok) flash('Copied to clipboard'); else flash('Copy failed','r'); };
  if(navigator.clipboard&&window.isSecureContext) navigator.clipboard.writeText(txt).then(function(){ flash('Copied to clipboard'); }).catch(fb);
  else fb(); };
function renderRounds(){
  if(!S.rounds.length){ el.roundsList.innerHTML='<p class="mute" style="font-size:12px">Round history appears as you advance.</p>'; return; }
  var html='';
  S.rounds.forEach(function(r){ var col=r.result==='ADVANCED'||r.result==='WON'?'g':'r';
    html+='<div class="round-row"><b>'+r.label+'</b><span class="mute">'+fmt(r.myStart)+' → '+fmt(r.myEnd)+' · '+r.trades+' tr</span><span class="'+col+'">'+r.result+'</span></div>'; });
  el.roundsList.innerHTML=html;
}
function renderOverview(){
  var st=S.stats;
  var real=S.tradeLog.reduce(function(s,t){return s+t.pnl;},0);
  var winRate=st.trades?Math.round(100*st.wins/st.trades)+'%':'—';
  el.overview.innerHTML=
    '<div class="ov-item"><span class="ov-label">Realised</span><span class="ov-val '+(real>=0?'g':'r')+'">'+(real>=0?'+':'-')+fmt(Math.abs(real))+'</span></div>'+
    '<div class="ov-item"><span class="ov-label">Win Rate</span><span class="ov-val">'+winRate+'</span></div>'+
    '<div class="ov-item"><span class="ov-label">Best PnL</span><span class="ov-val g">'+fmt(st.bestPnl)+'</span></div>';
}
function shortLabel(){ var l=S.roundLabel||''; if(l==='ROUND OF 16')return 'R16'; if(l==='QUARTERFINALS')return 'QF'; if(l==='SEMIFINALS')return 'SF'; if(l==='GRAND FINAL')return 'FINAL'; return l||'—'; }
function renderHeader(){
  el.hBal.textContent=fmt(C.myEquity());
  var u=S.pnlTicker||0;
  el.hUpnl.innerHTML=(u>=0?'<span class="g">':'<span class="r">')+fmt(u)+' unreal.</span>';
  el.mkt.textContent=fmtF(S.mark); el.tSym.textContent=S.symbol; el.obSym.textContent=S.symbol;
  if(phase==='trading'){
    var s=Math.max(0,Math.ceil(S.roundTimer/1000));
    el.timer.textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
    if(S.roundTimer<=5000 && S.roundTimer>0){
      el.timer.classList.add('urgent-timer');
      canTrade=false;
      if(el.buyBtn){ el.buyBtn.disabled=true; el.buyBtn.style.opacity='0.5'; el.buyBtn.textContent='⏳ ROUND ENDING...'; }
    } else if(S.roundTimer>5000){
      el.timer.classList.remove('urgent-timer');
      canTrade=true;
      if(el.buyBtn){ el.buyBtn.disabled=false; el.buyBtn.style.opacity='1'; buyColor(); }
    }
  }
  else { el.timer.textContent='—'; }
  el.hRound.textContent=shortLabel();
  el.roundPill.textContent= phase==='trading'?'LIVE': phase==='intro'?'READY':'';
  el.roundPill.className='pill'+(phase==='trading'?' warn':'');
}
/* 24.4 — TradingView style OHLC strip + last price tag */
function renderTV(){
  if(!el.tvC || !S.candles || !S.candles.length) return;
  var c=S.candles[S.candles.length-1], o=S.candles[0];
  if(el.tvSym) el.tvSym.textContent=(S.symbol||'FOMO')+'/USDT';
  if(el.tvO) el.tvO.textContent='O '+fmtF(c.o);
  if(el.tvH) el.tvH.textContent='H '+fmtF(c.h);
  if(el.tvL) el.tvL.textContent='L '+fmtF(c.l);
  if(el.tvC) el.tvC.textContent='C '+fmtF(c.c);
  var chg= o&&o.o ? (c.c/o.o-1)*100 : 0, gv=chg>=0;
  if(el.tvChg){ el.tvChg.textContent=(chg>=0?'+':'')+chg.toFixed(2)+'%'; el.tvChg.className='tv-chg '+(gv?'g':'r'); }
}
function renderNews(){ if(!el.newsTicker) return; if(S.newsLog){ el.newsTicker.textContent=S.newsLog; } 
  var newsEl=el.newsTicker; try{ newsEl.style.opacity='1'; clearTimeout(renderNews._t); renderNews._t=setTimeout(function(){ newsEl.style.opacity='0.35'; },9000); }catch(_){} }
function renderBotAct(){ if(!el.botAct) return;
  if(!S.actionLog || !S.actionLog.length){ el.botAct.innerHTML='<p class="mute" style="font-size:12px">Bot updates will stream here.</p>'; return; }
  var html='<div style="display:flex;flex-direction:column">'; var log=S.actionLog.slice(-20);
  for(var i=log.length-1;i>=0;i--){ var it=log[i], tm=it.time?new Date(it.time):null;
    var tstr= tm? ('0'+tm.getHours()).slice(-2)+':'+('0'+tm.getMinutes()).slice(-2)+':'+('0'+tm.getSeconds()).slice(-2)+'  ':'';
    html+='<div class="hist-row" style="border-bottom:1px solid var(--line);padding:2px 0;font-size:11.5px"><span style="color:var(--muted)">'+tstr+'</span><span>'+it.msg+'</span></div>'; }
  el.botAct.innerHTML=html+'</div>';
}
function closeAll(){ var mine=S.positions.filter(function(p){return p.owner&&p.owner.isPlayer;});
  if(!mine.length){ flash('No open position'); return; }
  var tot=0; mine.slice().forEach(function(p){ var pn=C.pnl(p); tot+=pn; C.closePosition(p,'manual'); });
  // 16.1 optimistic clear
  if(el.posTableBody) el.posTableBody.innerHTML='';
  if(el.posEmpty){ el.posEmpty.style.display='block';}
  if(el.posCountBadge) el.posCountBadge.textContent=0;
  beep(700,.1); flash('Closed all — '+(tot>=0?'+':'-')+fmt(Math.abs(tot))); renderAll(); }
function renderAll(){
  try{
    renderHeader();
    renderPos();
    renderOB();
    renderTV();
    // Only re-render tab lists when that specific tab is active
    var curTab = document.querySelector('[data-btab].on');
    var activeTabId = curTab ? curTab.getAttribute('data-btab') : 'pos';
    if(activeTabId === 'history') renderHistory();
    else if(activeTabId === 'leaderboard') renderBoard();
    else if(activeTabId === 'botact') renderBotAct();
    else if(activeTabId === 'rounds') renderRounds();
    renderOverview();
  }catch(_){}
  scheduleChart();
}
/* 16.10 — draw chart on animation frame, not every 110ms tick */
var chartRAF=false;
function scheduleChart(){ if(chartRAF) return; chartRAF=true;
  requestAnimationFrame(function(){ chartRAF=false; try{ drawChart(); if(typeof updateLastPrice==='function') updateLastPrice(); }catch(_){} }); }
function setTradeSide(side){ tradeSide=side; if(el.bLong)el.bLong.classList.toggle('on',side==='long'); if(el.bShort)el.bShort.classList.toggle('on',side==='short'); buyColor(); }
function buyColor(){ el.buyBtn.className='btn-cta '+(tradeSide==='long'?'btn-long':'btn-short'); el.buyBtn.textContent='Open '+(tradeSide==='long'?'Long':'Short'); }
if(el.bLong)el.bLong.onclick=function(){ setTradeSide('long'); };
if(el.bShort)el.bShort.onclick=function(){ setTradeSide('short'); };
if(el.limitToggle)el.limitToggle.onclick=function(){ el.limitToggle.classList.toggle('on'); if(el.limitWrap)el.limitWrap.classList.toggle('hidden'); }; // 34.2 — limit UI removed, keep wiring safe if elements reappear

// 30.1 & 32.1 — Floating Chart Controls
if(el.chartZoomIn) el.chartZoomIn.onclick = function(){ chartState.zoom = Math.min(3.5, chartState.zoom * 1.25); drawChart(); };
if(el.chartZoomOut) el.chartZoomOut.onclick = function(){ chartState.zoom = Math.max(0.35, chartState.zoom * 0.8); drawChart(); };
if(el.chartReset) el.chartReset.onclick = function(){ chartState.zoom = 1.0; chartState.panOffset = 0; drawChart(); flash('Chart view reset'); };

// 32.3 — Exit to Menu & Rules Modals
if(el.rulesBtn) el.rulesBtn.onclick = function(){ if(el.rulesModal) el.rulesModal.style.display = 'flex'; };
if(el.closeRulesBtn) el.closeRulesBtn.onclick = function(){ if(el.rulesModal) el.rulesModal.style.display = 'none'; };
if(el.rulesModal) el.rulesModal.onclick = function(e){ if(e.target === el.rulesModal) el.rulesModal.style.display = 'none'; };

if(el.exitBtn) el.exitBtn.onclick = function(){ if(el.exitModal) el.exitModal.style.display = 'flex'; };
if(el.inGameExitBtn) el.inGameExitBtn.onclick = function(){ if(el.exitModal) el.exitModal.style.display = 'flex'; };
if(el.cancelExitBtn) el.cancelExitBtn.onclick = function(){ if(el.exitModal) el.exitModal.style.display = 'none'; };
if(el.confirmExitBtn) el.confirmExitBtn.onclick = function(){
  if(el.exitModal) el.exitModal.style.display = 'none';
  try {
    localStorage.removeItem('ff_active_session_v24');
    clearInterval(interval);
    phase = 'idle';
    canTrade = false;
    S.inGame = false;
    var mine = S.positions.filter(function(p){ return p.owner && p.owner.isPlayer; });
    mine.forEach(function(p){ try{ C.closePosition(p, 'exit'); }catch(_){} });
    el.gameUI.style.display = 'none';
    el.menu.classList.remove('hidden');
    revealMenuStats();
    flash('Tournament session ended');
  } catch(err) {
    location.href = location.pathname;
  }
};

// TP/SL Toggle
if(el.tpslToggle) el.tpslToggle.onclick = function(){
  el.tpslToggle.classList.toggle('on');
  if(el.tpslWrap) el.tpslWrap.classList.toggle('hidden');
};

// 33.3 — Pre-Trade Liquidation Estimator & UpdateClr
function updateEstLiq(){
  var amt = +el.amount.value || 0, lev = +el.lev.value || 1;
  var entry = S.mark || 60000;
  var mmr = lev >= 20 ? 0.035 : (lev >= 10 ? 0.02 : 0.015);
  var liq = tradeSide === 'long' 
    ? Math.max(0, entry * (1 - (1 / lev) + mmr))
    : Math.max(0, entry * (1 + (1 / lev) - mmr));
  
  if(el.estLiqPrice) el.estLiqPrice.textContent = fmtF(liq);
  if(el.riskBadge){
    if(lev >= 20){
      el.riskBadge.textContent = 'DEGEN RISK (25x)';
      el.riskBadge.style.background = 'rgba(238,90,82,0.25)';
      el.riskBadge.style.color = 'var(--red)';
    } else if(lev >= 10){
      el.riskBadge.textContent = 'MEDIUM RISK';
      el.riskBadge.style.background = 'rgba(243,156,18,0.25)';
      el.riskBadge.style.color = '#f39c12';
    } else {
      el.riskBadge.textContent = 'LOW RISK';
      el.riskBadge.style.background = 'rgba(22,163,94,0.25)';
      el.riskBadge.style.color = 'var(--green)';
    }
  }
}

function updateClr(){
  try{ updateEstLiq(); }catch(_){}
  try{ updateEstLiq(); }catch(_){} var amt=+el.amount.value||0,lev=+el.lev.value;
  var avail= C.freeMargin? C.freeMargin(me()) : C.myEquity();
  el.clrPct.innerHTML='Notional <b>'+fmtK(amt*lev)+'</b> · Margin <b>'+fmtK(amt*lev/lev)+'</b> · avail <b>'+fmtK(avail)+'</b>'; }
if(el.amount){ el.amount.oninput=updateClr; }
if(el.lev){ el.lev.oninput=function(){ el.levVal.textContent=el.lev.value+'x'; updateClr(); }; }
if(el.themeBtn)el.themeBtn.onclick=function(){ setTheme(S.theme==='dark'?'light':'dark'); };
if(el.playBtn)el.playBtn.onclick=function(){ startGame(); };
if(el.soundBtn)el.soundBtn.onclick=function(){ soundOn=!soundOn; el.soundBtn.textContent=soundOn?'🔊':'🔇'; };
/* 19.2 — bottom data-panel tabs (Positions / History / Leaderboard / Bot Activity / Rounds) */
document.querySelectorAll('[data-btab]').forEach(function(b){ b.onclick=function(){
  var tab=b.getAttribute('data-btab');
  document.querySelectorAll('[data-btab]').forEach(function(x){ x.classList.remove('on'); });
  b.classList.add('on');
  document.querySelectorAll('.tab-content').forEach(function(p){ p.style.display = (p.id==='btab-'+tab)?'block':'none'; });
  if(tab === 'pos') renderPos(true);
  else if(tab === 'history') renderHistory();
  else if(tab === 'leaderboard') renderBoard();
  else if(tab === 'botact') renderBotAct();
  else if(tab === 'rounds') renderRounds();
}; });
/* 19.6 — sound toggle + popover volume */
if(el.soundBtn) el.soundBtn.onclick=function(){ soundOn=!soundOn; el.soundBtn.textContent=soundOn?'🔊':'🔇';
  el.soundPop.style.display = (el.soundPop.style.display==='block'?'none':'block'); };
if(el.volRange) el.volRange.oninput=function(){ soundVol=parseFloat(el.volRange.value);
  try{ localStorage.setItem('ff_vol',JSON.stringify(soundVol)); }catch(_){} };
if(el.volRange) el.volRange.value=soundVol;
document.addEventListener('click',function(ev){ if(el.soundPop && !ev.target.closest('#soundBtn') && !ev.target.closest('#soundPop')) el.soundPop.style.display='none'; });
/* 16.4 — chart 'My lines' toggle (dedupe entry lines / hide overlays) */
S.myLines=true; S.volOn=true;
var linesBtn=$('linesToggle');
if(linesBtn) linesBtn.onclick=function(){ S.myLines=!S.myLines; linesBtn.textContent=S.myLines?'MyLines:ON':'MyLines:OFF';
  linesBtn.classList.toggle('t-on',S.myLines); scheduleChart(); };
var volBtn=$('volToggle');
if(volBtn) volBtn.onclick=function(){ S.volOn=!S.volOn; volBtn.textContent=S.volOn?'VOL:ON':'VOL:OFF';
  volBtn.classList.toggle('t-on',S.volOn); scheduleChart(); };
/* 24.4 — timeframe chips (visual selection; candles stay synthetic-speed) */
S.tf=15;
document.querySelectorAll('[data-tf]').forEach(function(b){
  b.onclick=function(){
    document.querySelectorAll('[data-tf]').forEach(function(x){ x.classList.remove('t-on'); });
    b.classList.add('t-on'); S.tf=+b.getAttribute('data-tf');
  };
});
/* 24.4 — last price tag (pill) on right axis, bound to mark */
var lastPrice=null;
function updateLastPrice(){
  if(!cvs) return;
  if(!lastPrice){ lastPrice=document.createElement('div'); lastPrice.className='last-price'; cvs.parentNode.appendChild(lastPrice); }
  lastPrice.textContent=fmtF(S.mark);
  lastPrice.className='last-price '+(S.mark>=(S.prevMark||S.mark)?'g':'r');
  // position near the current mark on the chart
  var H=(cvs.clientHeight||360), padT=14, padB=20, volH=Math.min(60,H*0.13), plotH=H-padT-padB-volH;
  var lo=0,hi=0; if(S.candles && S.candles.length){ var per=Math.min(S.candles.length,150),st=S.candles.length-per; lo=Infinity;hi=-Infinity;
    for(var i=st;i<S.candles.length;i++){ var cc=S.candles[i]; if(cc.l<lo)lo=cc.l; if(cc.h>hi)hi=cc.h; } }
  if(hi>lo){ var y=padT+(hi-S.mark)/(hi-lo)*plotH; lastPrice.style.top=Math.max(14,Math.min(H-padB-14,y-9))+'px'; }
  else { lastPrice.style.top='40%'; }
}

/* 16.4 — same-highest agg toggle via S.myLines logic inside drawChart */
document.querySelectorAll('[data-preset-amt]').forEach(function(b){ b.onclick=function(){
  var f=+b.getAttribute('data-preset-amt'), eq=C.myEquity();
  var val= f===99? Math.max(10,Math.floor(C.freeMargin?C.freeMargin(me()):eq)) : Math.max(10,Math.floor(eq*f));
  el.amount.value=val; updateClr(); flash((f===99?'Max margin':'Amount')+': '+fmt(val)); }; });
document.querySelectorAll('[data-preset-lev]').forEach(function(b){ b.onclick=function(){ el.lev.value=b.getAttribute('data-preset-lev'); el.levVal.textContent=el.lev.value+'x'; }; });
if(el.buyBtn)el.buyBtn.onclick=function(){
  if(!canTrade){ flash('Wait for the round to start','r'); beep(160,.18); return; }
  initAudio();
  var lev=+el.lev.value, amount=+el.amount.value||0;
  if(amount<10){ flash('Amount min $10','r'); return; }
  var player=me();
  var res;
  var tp_v=(el.tpVal&&el.tpVal.value)?parseFloat(el.tpVal.value):null;
  var sl_v=(el.slVal&&el.slVal.value)?parseFloat(el.slVal.value):null;
  res=C.openPosition(player,tradeSide,amount*lev,lev,tp_v,sl_v);
  if(res.ok){ flash((tradeSide==='long'?'LONG':'SHORT')+' '+fmtK(amount*lev)+' @ '+fmtF(S.mark)); beep(880,.07); }
  else { flash(res.msg,'r'); beep(200,.16); }
  renderAll();
};
if(el.closeAll)el.closeAll.onclick=function(){ closeAll(); };
/* 24.2 — keyboard shortcuts: X = Close All, C = Close first position */
document.addEventListener('keydown',function(ev){
  if(!phase || phase==='idle') return;
  if(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  var k=(ev.key||'').toLowerCase();
  if(k==='x'){ ev.preventDefault(); closeAll(); }
  else if(k==='c'){ var mine=S.positions.filter(function(p){return p.owner&&p.owner.isPlayer;}); if(mine.length) closePos(mine[0].id); }
});
/* menu mode + pair selectors (9.1 / 8.8) */
document.querySelectorAll('[data-mode]').forEach(function(b){ b.onclick=function(){
  document.querySelectorAll('[data-mode]').forEach(function(x){ x.classList.remove('on'); });
  b.classList.add('on'); S.mode=b.getAttribute('data-mode'); }; });
document.querySelectorAll('[data-sym]').forEach(function(b){ b.onclick=function(){
  document.querySelectorAll('[data-sym]').forEach(function(x){ x.classList.remove('on'); });
  b.classList.add('on'); S.symbol=b.getAttribute('data-sym'); }; });
function RND(n){ return n>=16?'ROUND OF 16': n>=8?'QUARTERFINALS': n>=4?'SEMIFINALS': n>=2?'GRAND FINAL':'CHAMPION'; }
function startGame(){
  var name=(el.nameInput.value.trim()||'YOU');
  S.name=name; C.buildParts(); C.resetGame(); C.seedHistory(150);
  me().name=name;
  S.inGame = true;
  var P=(C.MODES&&C.MODES[S.mode])||C.MODES.NORMAL;
  S.part.forEach(function(p){ if(!p.isPlayer && p.alive){ try{ C.openPosition(p, Math.random()<.5?'long':'short', C.R(1000,4000), Math.round(C.R(3,10))); }catch(_){} } });
  el.gameUI.style.display='flex'; el.menu.classList.add('hidden'); revealMenuStats();
  if(el.lev){ el.lev.max=P.levMax||25; }
  try{ updateClr(); }catch(_){}
  beginRound();
  if(typeof persistGameSession === 'function') persistGameSession();
}
/* 24.8 — Play Again without reload: reset state, keep name + theme + mode */
function restart(){
  try{ clearInterval(interval); }catch(_){}
  phase='idle'; canTrade=false;
  C.buildParts();
  C.resetGame(); C.seedHistory(150);
  S.part.forEach(function(p){ if(!p.isPlayer && p.alive){ try{ C.openPosition(p, Math.random()<.5?'long':'short', C.R(1000,4000), Math.round(C.R(3,10))); }catch(_){} } });
  el.board.style.display='none';
  try{ renderAll(); updateClr(); }catch(_){}
  beginRound();
}
function mm(t){ var s=Math.max(0,Math.round(t/1000)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function modeMS(){ var P=(C.MODES&&C.MODES[S.mode])||C.MODES.NORMAL; return P.roundMS||C.ROUND_MS; }
function beginRound(){
  // Close any open share modal when a new round begins
  try{ var sm=document.getElementById('pnlShareModal'); if(sm) sm.style.display='none'; }catch(_){}
  var aliveCount=S.part.filter(function(p){return p.alive;}).length;
  S.roundLabel=RND(aliveCount); S.myRoundStart=C.myEquity();
  phase='intro'; canTrade=false; S.roundTimer=modeMS(); C.pickRegime();
  var g= aliveCount>=16?'🏟️': aliveCount>=8?'🔥': aliveCount>=4?'⚔️':'🏆';
  el.roundIntroBox.innerHTML='<div class="btn">'+S.roundLabel+'</div><div style="font-size:15px;opacity:.9;margin-top:6px">'+aliveCount+' left · '+mm(S.roundTimer)+' · '+S.regimeLabel+'</div><div style="font-size:60px;margin-top:12px">'+g+'</div>';
  el.roundIntro.style.display='flex';
  renderAll();
  setTimeout(function(){ el.roundIntro.style.display='none'; startTrading(); },1800);
}
function startTrading(){
  phase='trading'; S.phase='trading'; canTrade=true; S.roundTimer=modeMS();
  clearInterval(interval);
  interval=setInterval(function(){
    C.marketTick(); C.stepParticipants();
    if(S.playerLiquidated){ S.playerLiquidated=false; flash('⚠️ MARGIN CALL','r'); beep(120,.3); shake(); }
    if(S.liqLog){ flash(S.liqLog, /liquidated/.test(S.liqLog)); S.liqLog=''; }
    if(S.newsLog){ flash(S.newsLog, true); S.newsLog=''; }
    S.roundTimer-=C.TICK; renderAll();
    if(Math.round(S.roundTimer) % 1000 < C.TICK && typeof persistGameSession === 'function'){
      persistGameSession();
    }
    if(S.roundTimer<=0){ clearInterval(interval); endRound(); }
  },C.TICK);
}
function shake(){ try{ document.body.style.transform='translateX(4px)'; setTimeout(function(){ document.body.style.transform=''; },120); }catch(_){} }
function endRound(){
  phase='resolved'; canTrade=false; clearInterval(interval);
  var myStart=Math.round(S.myRoundStart);
  var res=C.resolveRound();
  var you=me(), cnt=S.part.filter(function(p){return p.alive;}).length;
  var result= res.final ? (you.alive?'WON':'LOST') : (you.alive?'ADVANCED':'ELIMINATED');
  C.recordRound(myStart, result);
  renderAll();
  addRunStats(result);
  if(res.final){ var champ=S.part.find(function(p){return p.alive;}); if(champ) finish(champ); return; }
  if(!you.alive){ elim(); return; }
  var names=''; res.adv.forEach(function(a,i){ names+=(i>0?', ':'')+(a.isPlayer?'⭐ '+a.name:a.name); });
  el.roundIntroBox.innerHTML='<div class="btn">'+result+' ✅</div><div style="font-size:15px;margin-top:6px">Next: '+RND(cnt)+' · '+cnt+' left</div><div style="font-size:14px;opacity:.9;margin-top:8px">'+names+'</div>';
  el.roundIntro.style.display='flex';
  setTimeout(function(){ el.roundIntro.style.display='none'; beginRound(); },2200);
}
function addRunStats(result){
  var tr=LS.get('ff_trades',{n:0,w:0});
  tr.n+=S.tradeLog.length; S.tradeLog.forEach(function(t){ if(t.pnl>0)tr.w++; });
  LS.set('ff_trades',tr);
  var his=LS.get('ff_hiscore',C.START), eq=C.myEquity(), streak=LS.get('ff_winstreak',0);
  if(eq>his) LS.set('ff_hiscore',eq);
  if(result==='WON'){ LS.set('ff_winstreak',streak+1); } else if(result==='LOST'||result==='ELIMINATED'){ LS.set('ff_winstreak',0); }
}
function elim(){
  S.inGame = false; try{ localStorage.removeItem('ff_active_session_v24'); }catch(_){}
  el.modalCard.innerHTML='<h2>😞 ELIMINATED</h2><p>You didn\'t qualify for the next stage.</p>'+
    '<div class="hist-sum" style="margin-top:10px">'+roundRecap()+'</div>'+
    '<button class="btn-lg" id="re2">Play again</button>';
  el.board.style.display='flex'; $('re2').onclick=function(){ restart(); };
}
function finish(c){
  var w=c.isPlayer;
  el.modalCard.innerHTML='<h2>'+(w?'🏆 YOU ARE THE CHAMPION!':'🏆 '+c.name+' wins')+'</h2>'+
    '<p>'+(w?'You out-traded every bot through the bracket. Legend!':'The bots claimed the crown this run. Study the regime and battle again.')+'</p>'+
    '<div class="hist-sum" style="margin-top:10px">'+roundRecap()+'</div>'+
    (w?'<p style="font-size:13px;color:var(--accent)">Final equity: '+fmt(c.equity)+'</p>':'')+
    '<button class="btn-lg" id="re3">⚡ Play again</button>';
  el.board.style.display='flex'; $('re3').onclick=function(){ restart(); };
}
function roundRecap(){
  var r=S.rounds.map(function(x){ return x.label+' '+fmt(x.myStart)+'→'+fmt(x.myEnd)+' ('+x.result+')'; }).join('<br>');
  return 'Trades '+S.tradeLog.length+' · Realised '+fmt(S.tradeLog.reduce(function(s,t){return s+t.pnl;},0))+'<br>'+r;
}
function setTheme(t){ document.documentElement.setAttribute('data-theme',t); S.theme=t; }

/* boot: always reach the menu */
(function(){
  try{
    if(C.buildParts) C.buildParts();
    if(C.seedHistory) C.seedHistory(150);
    var p0=S.part.find(function(p){return p.isPlayer;}); if(p0)p0.name='YOU';
    try{ renderAll(); }catch(_){}
    revealMenuStats();
  }catch(e){ }
  var t=setInterval(function(){
    var currentW = parseFloat(el.loadFill ? el.loadFill.style.width : 0) || 0;
    var v = Math.min(100, currentW + Math.random() * 26 + 10);
    if(el.loadFill) el.loadFill.style.width = v + '%';
    if(v >= 100){
      clearInterval(t);
      // Once loaded, permanently hide loading screen
      if(el.loading) el.loading.classList.add('hidden');
      if(!tryRestoreSession()){
        if(el.menu) el.menu.classList.remove('hidden');
      }
    }
  }, 110);
  // expose IIFE-scoped symbols for top-level delegation handlers
  window._ffRevealMenuStats = revealMenuStats;
  window._ffFlash = flash;
  window._ffInternals = { get interval(){ return interval; }, set interval(v){ interval = v; }, get phase(){ return phase; }, set phase(v){ phase = v; } };
})();

// Modern Boxy Seg buttons click handlers (inside IIFE so S is in scope)
document.querySelectorAll('.seg-btn[data-sym]').forEach(function(b){
  b.onclick = function(){
    document.querySelectorAll('.seg-btn[data-sym]').forEach(function(x){ x.classList.remove('on'); });
    b.classList.add('on');
    S.symbol = b.getAttribute('data-sym');
    if(el.tvSym) el.tvSym.textContent = S.symbol + '/USDT';
    if(el.obSym) el.obSym.textContent = S.symbol;
  };
});
document.querySelectorAll('.seg-btn[data-mode]').forEach(function(b){
  b.onclick = function(){
    document.querySelectorAll('.seg-btn[data-mode]').forEach(function(x){ x.classList.remove('on'); });
    b.classList.add('on');
    S.mode = b.getAttribute('data-mode');
  };
});

// Exit Modal button handlers (inside IIFE)
document.addEventListener('click', function(e){
  var btn = e.target.closest('#inGameExitBtn');
  if(btn){
    if(el.exitModal) el.exitModal.style.display = 'flex';
    var em = $('exitModal');
    if(em) em.style.display = 'flex';
  }
});

// Session Restore inside IIFE
function tryRestoreSession() {
  try {
    var raw = localStorage.getItem('ff_active_session_v24');
    if (!raw) return false;
    var data = JSON.parse(raw);
    if (!data || !data.part || !data.candles) return false;
    S.name = data.name || 'YOU';
    S.mode = data.mode || 'NORMAL';
    S.symbol = data.symbol || 'FOMO';
    S.roundLabel = data.roundLabel || 'ROUND OF 16';
    S.roundTimer = data.roundTimer || 60000;
    S.myRoundStart = data.myRoundStart || 10000;
    S.candles = data.candles;
    S.part = data.part;
    S.positions = data.positions;
    S.orders = data.orders || [];
    S.tradeLog = data.tradeLog || [];
    S.stats = data.stats || S.stats;
    S.mark = data.mark || 62000;
    S.volMax = data.volMax || 1;
    S.inGame = true;
    
    if(el.menu) el.menu.classList.add('hidden');
    if(el.loading) el.loading.classList.add('hidden');
    if(el.gameUI) el.gameUI.style.display = 'flex';
    var P = (C.MODES && C.MODES[S.mode]) || C.MODES.NORMAL;
    if (el.lev) el.lev.max = P.levMax || 25;
    phase = 'trading'; canTrade = true;
    renderAll();
    startTrading();
    return true;
  } catch(e) { return false; }
}

// 2-way vertical chart drag: panY and yScale in chartState
})();

// Window beforeunload refresh protection
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", function(e) {
    try {
      var raw = localStorage.getItem('ff_active_session_v24');
      if (raw) {
        e.preventDefault();
        e.returnValue = "Tournament round is in progress! Are you sure you want to exit?";
        return e.returnValue;
      }
    } catch(err) {}
  });
}




// Unified, instant event delegation for Share, Exit Modal, and Popups
document.addEventListener('click', function(ev){
  // 1. Share Button (📷 Share in Trade History)
  var shareBtn = ev.target.closest('[data-share]');
  if(shareBtn){
    ev.preventDefault();
    ev.stopPropagation();
    var idx = parseInt(shareBtn.getAttribute('data-share'), 10);
    if(!isNaN(idx) && typeof window.shareTrade === 'function') window.shareTrade(idx);
    return;
  }

  // 2. Close Share Modal button
  var closeShare = ev.target.closest('#closeShareModal');
  if(closeShare){
    ev.preventDefault();
    ev.stopPropagation();
    var sm = document.getElementById('pnlShareModal');
    if(sm) sm.style.display = 'none';
    return;
  }

  // 3. Backdrop click for Share Modal
  var pnlModal = document.getElementById('pnlShareModal');
  if(pnlModal && ev.target === pnlModal){
    pnlModal.style.display = 'none';
    return;
  }

  // 4. In-Game Exit Button
  var exitTrigger = ev.target.closest('#inGameExitBtn, #exitBtn');
  if(exitTrigger){
    ev.preventDefault();
    ev.stopPropagation();
    var em = document.getElementById('exitModal');
    if(em) em.style.display = 'flex';
    return;
  }

  // 5. Cancel Exit
  var cancelExit = ev.target.closest('#cancelExitBtn');
  if(cancelExit){
    ev.preventDefault();
    ev.stopPropagation();
    var em2 = document.getElementById('exitModal');
    if(em2) em2.style.display = 'none';
    return;
  }

  // 6. Confirm Exit (Clean UI Transition without reloading or glitching to loading bar)
  var confirmExit = ev.target.closest('#confirmExitBtn');
  if(confirmExit){
    ev.preventDefault();
    ev.stopPropagation();
    var em3 = document.getElementById('exitModal');
    if(em3) em3.style.display = 'none';

    // Disarm session and interval — all via global refs; IIFE-scoped vars not in scope here
    try { localStorage.removeItem('ff_active_session_v24'); } catch(_){}
    try { var _fi = window._ffInternals; if(_fi){ if(_fi.interval) clearInterval(_fi.interval); _fi.phase = 'idle'; } } catch(_){}
    var gS = window.CORE && window.CORE.state;
    if(gS){
      gS.phase = 'idle';
      gS.inGame = false;
      var gC = window.CORE;
      var mine = (gS.positions || []).filter(function(p){ return p.owner && p.owner.isPlayer; });
      mine.forEach(function(p){ try{ gC.closePosition(p, 'exit'); }catch(_){} });
    }

    // Switch view to Menu instantly — NEVER show loading screen
    var gUI = document.getElementById('gameUI');
    var mUI = document.getElementById('menu');
    var loadUI = document.getElementById('loading');
    if(gUI) gUI.style.display = 'none';
    if(loadUI) loadUI.classList.add('hidden');
    if(mUI) mUI.classList.remove('hidden');

    try { if(typeof window._ffRevealMenuStats === 'function') window._ffRevealMenuStats(); }catch(_){}
    try { if(typeof window._ffFlash === 'function') window._ffFlash('Tournament session ended'); }catch(_){}
    return;
  }

  // 7. Backdrop click for Exit Modal
  var exitModalEl = document.getElementById('exitModal');
  if(exitModalEl && ev.target === exitModalEl){
    exitModalEl.style.display = 'none';
    return;
  }
});
