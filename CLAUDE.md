# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start development server (Vite HMR)
npm run build     # Production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

## Architecture

This is a React + Vite single-page app that simulates a multi-agent prediction market trading system. All agent logic lives in one large component.

**Entry point:** `src/App.jsx` → renders `src/prediction-market-bot (1).jsx` (the main component, ~663 lines)

### Agent Pipeline

Six agents run sequentially (with one parallel stage), each making a direct call to the Anthropic API:

1. **Scan Agent** — filters 300+ simulated markets, returns 8-12 opportunities
2. **Research Agent Alpha** (parallel) — social media sentiment (Twitter/Reddit)
3. **Research Agent Beta** (parallel) — news, fundamentals, on-chain data
4. **Prediction Agent** — Bayesian synthesis; flags trades only if edge > 8% AND confidence > 75%
5. **Risk Agent** — Kelly Criterion sizing; blocks trades exceeding 5% bankroll or 10% daily drawdown
6. **Debrief Agent** — post-session meta-learning, grades the session A–F

**Orchestration:** `runFullCycle()` in the main component manages phase state and calls each agent's system prompt against `claude-sonnet-4-5` (max 2000 tokens each).

### API Calls

The app calls the Anthropic API **directly from the browser** using `fetch` with `dangerouslyAllowBrowser: true`. The API key is read from `import.meta.env.VITE_ANTHROPIC_API_KEY` (set in `.env`). JSON responses are parsed with a markdown code-block fallback extractor.

### UI Structure

Dark-themed layout with:
- Left sidebar: agent pipeline status with live pulse indicators
- Right pane: 4 tabs (Dashboard, Markets, Trades, Debrief)
- Bottom: live log console with color-coded message types
