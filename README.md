# Flash FOMO — fast synthetic futures battle ⚡

A quick, arcade-style **paper trading game** (edu-demo, fake money). You race **AI bots** on a fast **regime-based synthetic market** across a **16→8→4→2→1 single-elimination bracket** to end up with the highest equity.

## The new trading-terminal layout
- **3 columns on top** like a real futures terminal: a wide **Chart** (left) · a ramping **Orderbook** ladder (middle) · a focused **Trade box** (right).
- **Bottom data panel** with tabs: **My Positions / Trade History / Leaderboard / Bot Activity / Rounds Recap** — wide, legible tables, so the **Close** button is always visible without scrolling.
- Positions table shows **Side · Lev · Entry · Mark · Liq Price · Size · Margin · PnL(ROE%) · Action**.

## Market & coins
- **Symbols with real "personas":**
  - `FOMO` (bluechip BTC-style, ~$60k, 1 decimal, stable, amber accent)
  - `MINT` (high-beta L1, ~$184, 2 decimals, volatile, mint-green accent)
  - `LUNAR` (meme low-cap, ~$1.85, 4 decimals, pump & dump, purple accent)
- **Realistic price physics** — an auto-regressive (AR-1) momentum model with 80% inertia + tiny micro-noise per tick. No more violent 0.24% teleports: price **flows** with proper candle bodies/wicks, news spikes **glide** over ~1.4s instead of jumping. Candle time lengthened ~3s so patterns are readable.
- **Regime-based** market: `TRENDING`, `RANGING`, or `VOLATILITY BURST` per round, with momentum flips and news events. Price is clamped to a sane band so it can never run away.
- **Liquidation Price (Liq Price)** shown for every position (isolated-margin formula) and drawn as an orange dashed `LIQ` line on the chart that pulses when you're within 20% of it.

## Bots
Each bot has a **persona** — Whale (big, low leverage), Momentum (follows trend), Reversal (fades the move, high leverage), Chaos (aggressive, frequent liquidation). HARD mode adds 3 "shark" bots.

## Features
- **Market order** (instant) and **Limit order** (queued, fills at limit price).
- **Leverage** slider 1–25× + chips (2×/5×/10×/25×); **amount presets** 25% / 50% / Max.
- **Per-position TP/SL** engine (used by bots; also keeps player positions safe).
- **Close** and **Close ½**, plus a red **✕ Close All** panic button.
- **Orderbook** built from real participants' open positions (never random) — your orders highlighted ⭐ YOU, depth bars, a mark/spread separator with a ▲/▼ direction arrow, and cancellable pending limit orders.
- **Chart** with your entry lines, TP/SL, **LIQ line**, 12/24 SMA, regime label, crosshair OHLCV tooltip, exit markers, and **MyLines / VOL** toggles.
- **Shareable PnL card** (📷) for any realised trade — a screenshot-style modal with % / symbol / side / entry→exit / profit.
- **Trade history** (win-rate, realised PnL) + **Round recap** timeline.
- **Margin call** liquidation with screen shake + themed sound (profit chime / loss thud); **sound toggle + volume slider** (persisted).
- **Progression** saved to `localStorage`: best equity, win-streak, total trades / win-rate, volume.
- **Light / dark theme**, professional trading-terminal palette, responsive layout.

## How to play
1. On the menu pick **pair** (FOMO/MINT/LUNAR), **difficulty** (EASY/NORMAL/HARD), enter a name, press **Start**.
2. Trade Long/Short with leverage + amount (or a preset), optionally send a **Limit** order.
3. Open positions stream into the bottom **My Positions** table — hit **Close** / **½ Close** / **Close All**.
4. Watch the chart + orderbook; Liq Price shows where you get wiped out.
5. Round timer → 0:00 → positions auto-close (PnL banked) → bottom half eliminated.
6. Survive to the **Grand Final** and end with the highest equity to be crowned **champion** 🏆.

> This is a simplified **simulation with fake money** — not real trading and not financial advice.

## Run locally
```bash
cd flash-fomo
npx serve .
```

## Tests (pure core logic, no DOM)
```bash
npm test
```
Covers open/close, PnL banking, TP/SL, limit-fill pricing, grand-final resolution, difficulty modes, market-band stability, equity caps.

## Deploy to Vercel
- Push the folder to GitHub → import in Vercel (static, no build). No external API needed since the market is synthetic.
