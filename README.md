# NEXUS PRED — Multi-Agent Prediction Market Trading System

A production-grade multi-agent AI system for prediction market analysis, built with React and the Anthropic API. Eight specialised AI agents run sequentially and in parallel to scan markets, synthesise research, calculate edge, manage risk, and generate exportable session reports.

## Overview

Nexus Pred orchestrates a full trading intelligence pipeline — from market discovery through to risk-gated trade approval — using a chain of purpose-built AI agents, each with carefully engineered system prompts and a specific analytical role. The system learns from each session, automatically adjusting its parameters based on debrief analysis to improve performance over time.

## Agent Pipeline

```
┌─────────────────────────────────────────────────────┐
│  SCAN AGENT — 5 parallel sector batches             │
│  Crypto · Equity · M&A · Macro · Institutional      │
└────────────────────┬────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌───────────────┐       ┌─────────────────┐
│ RESEARCH α    │       │ RESEARCH β      │
│ Sentiment NLP │       │ Fundamentals    │
│ Twitter/Reddit│       │ Bloomberg/SEC   │
│ Discord/TG    │       │ Analyst data    │
└───────┬───────┘       └────────┬────────┘
        └────────────┬───────────┘
                     ▼
        ┌────────────────────────┐
        │  PREDICTION AGENT      │
        │  Bayesian synthesis    │
        │  XGBoost + LLM calib.  │
        │  Edge & confidence     │
        └────────────┬───────────┘
                     ▼
        ┌────────────────────────┐
        │  RISK AGENT            │
        │  Kelly Criterion sizing│
        │  Drawdown limits       │
        │  Trade approval gate   │
        └────────────┬───────────┘
                     ▼
        ┌────────────────────────┐
        │  OUTLOOK AGENT         │
        │  News & trend signals  │
        │  Institutional flow    │
        │  Big money detection   │
        └────────────┬───────────┘
                     ▼
        ┌────────────────────────┐
        │  NEURAL NET AGENT      │
        │  TCN 64×12 feature win │
        │  4 mathematical models │
        │  Trade validation      │
        └────────────┬───────────┘
                     ▼
        ┌────────────────────────┐
        │  DEBRIEF AGENT         │
        │  Meta-learning         │
        │  Parameter adjustment  │
        │  Session grading A–F   │
        └────────────────────────┘
```

## Neural Network — 4 Mathematical Models

The Neural Net Agent simulates a Temporal Convolutional Network (TCN) running four quantitative formulas per market:

**Formula 1 — Calibrated Sigmoid Head**
```
p̂_t+1 = σ(w⊤ TCN(X^(t)) + b),  X^(t) ∈ ℝ^(64×12)
```
Extracts temporal patterns across 12 feature channels and applies sigmoid calibration.

**Formula 2 — Deadbanded Volatility-Scaled Risk Map**
```
w_t+1 = clip((σ* / σ̂_t+1) × g_τ(2p̂_t+1 − 1), w_min, w_max)
```
Scales position weight by estimated volatility with a deadband to suppress noise.

**Formula 3 — Sharpe-Weighted Ensemble Score**
```
sharpeScore = (scan×0.15) + (sentiment×0.20) + (fundamentals×0.20) + (edge×0.25) + (neural×0.20)
```
Combines all agent signals into a single calibrated score.

**Formula 4 — Kelly Criterion with Neural Calibration**
```
f* = (p̂×b − (1−p̂)) / b
adjustedBet = 0.5 × f* × |finalWeight|
```
Computes risk-adjusted position sizing incorporating neural network confidence.

## Features

- **8-agent orchestration** — sequential and parallel execution with phase state management
- **Resilient API calls** — automatic retry with exponential backoff, JSON fallback parsing
- **Session memory** — parameters auto-adjusted after each debrief for continuous improvement
- **Live canvas visualisation** — animated TCN neural network with particle flow, pulse rings, and real-time node rendering
- **PDF report generation** — full session export with cover page, trade analysis, risk register, and timing windows
- **Responsive UI** — tabbed dashboard, mobile sidebar, live log console, cursor tooltips
- **5-tab interface** — Dashboard, Markets, Trades, Neural Net, Debrief

## Tech Stack

- React 19 + Vite
- Anthropic API (claude-sonnet-4-5)
- jsPDF (report generation)
- HTML5 Canvas (neural net visualisation)
- CSS custom properties (glass morphism design system)

## Architecture

All agent logic is orchestrated through `runFullCycle()` in the main component. Each agent receives a dynamically built system prompt incorporating current session parameters, allowing the debrief agent's parameter adjustments to cascade forward into the next cycle.

```
src/
├── prediction-market-bot.jsx   # Main component — all 8 agents + UI (~700 lines)
├── glass.css                   # Design system
├── App.jsx                     # Root component
└── main.jsx                    # Entry point
```

## Getting Started

### Prerequisites
```bash
node >= 18.x
```

### Installation
```bash
git clone https://github.com/DanilBV04/Market-Prediction-AI---6-Agents.git
cd Market-Prediction-AI---6-Agents
npm install
```

### Configuration
Create a `.env` file in the root:
```
VITE_ANTHROPIC_API_KEY=your_api_key_here
```

### Run
```bash
npm run dev
```

## Session Workflow

1. Set your bankroll in the header
2. Click **RUN FULL CYCLE** in the agent pipeline sidebar
3. Watch agents execute in real time via the live log console
4. Review approved trades, neural validation, and market outlook
5. Read the debrief — session grade, lessons learned, parameter adjustments
6. Export a full PDF report
7. Run again — parameters auto-adjust based on prior session learning

## Disclaimer

This system is built for research and educational purposes. It does not constitute financial advice. Prediction markets involve significant risk.

## Future Work

- WebSocket streaming for real-time agent output
- Historical session database with performance tracking
- Live market data integration via prediction market APIs
- Applying multi-agent architecture to medical diagnostic pipelines
