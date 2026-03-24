import { useState, useEffect, useRef, useCallback } from "react";
// jsPDF is lazy-loaded on first PDF export to keep initial bundle small
import "./glass.css";

// ─── Default Session Params (adjusted after each debrief) ────────────────────
const DEFAULT_PARAMS = {
  edgeThreshold: 0.08,
  confidenceThreshold: 0.75,
  kellyCap: 0.05,
  dailyDrawdownLimit: 0.10,
  minLiquidity: 10000,
  maxMarketsToAnalyze: 20,
};

// ─── Build dynamic system prompts with current params ─────────────────────────
function buildPrompts(p) {
  const SCAN = `You are a Market Scan Agent for a prediction market trading bot sweeping 1000+ sources.

You will be given a specific sector to cover. Generate EXACTLY 4 realistic prediction markets for that sector.

Rules for every market:
- Liquidity: volume > $${p.minLiquidity.toLocaleString()}
- Time to resolution: 2-30 days
- Flag any with: bid-ask spread >5%, price movement >10%, volume spikes, M&A rumors, or insider signals

Asset classes in scope: crypto, equities, M&A/buyouts, institutional moves, ETFs, commodities, macro, politics, tech, sports.

Return a JSON array of EXACTLY 4 objects. Each object must have these fields:
id (number), title (string), category (one of: crypto|equity|m&a|institutional|etf|commodity|macro|politics|tech|sports), currentOdds (number 0-1), volume (number), daysToResolution (number), spreadPct (number), priceSwing (number), flags (array of strings), liquidityScore (number 0-10), recommendation (string)

Return ONLY a valid JSON array. No explanation, no markdown, no extra text.`;

  const RESEARCH_A = `You are Research Agent Alpha - a multi-source sentiment specialist covering 100+ data streams.

Sources you synthesize: Twitter/X, Reddit (r/wallstreetbets, r/stocks, r/CryptoCurrency, r/investing, r/options, r/Superstonk), StockTwits, Discord trading servers, Telegram crypto groups, YouTube financial influencers, TikTok finance, LinkedIn institutional commentary, Seeking Alpha comments, Blind (employee sentiment), Google Trends.

For each market provided (which may be crypto, equity, M&A, commodity, macro, or other), perform a deep multi-source sentiment sweep and return JSON with:
- marketId
- sources: array of source names actually used
- sentimentScore: number -1 to 1
- narrativeSummary: detailed paragraph describing the dominant narrative, how it evolved over 48h, and any sudden shifts
- keyInfluencers: array of { name, platform, stance, followerImpact }
- trendDirection: "accelerating_bullish"|"cooling_bullish"|"neutral"|"cooling_bearish"|"accelerating_bearish"
- retailVsInstitutionalSentiment: describe divergence or alignment between retail crowds and institutional voices
- sentimentVsOddsGap: number, positive means sentiment is more bullish than odds imply
- redFlags: array of specific warning signals found (e.g. coordinated pumping, bot activity, sudden narrative reversal)
- volumeOfDiscussion: "low"|"medium"|"high"|"viral"
- keyFactors: array of 3-5 strings — the most important sentiment-driven factors that should directly influence a trade decision on this market

Return ONLY valid JSON array, no markdown, no extra text.`;

  const RESEARCH_B = `You are Research Agent Beta - a fundamentals and news specialist covering 100+ sources.

Sources you synthesize: Bloomberg, Reuters, WSJ, Financial Times, CNBC, Yahoo Finance, MarketWatch, Barron's, The Economist, SEC filings (8-K, 13F, 13D, Form 4 insider filings), earnings call transcripts, analyst upgrades/downgrades (Goldman Sachs, Morgan Stanley, JPMorgan, Bank of America, Citi), options flow data (unusual whales, dark pool prints), on-chain analytics (Glassnode, Nansen, Dune Analytics), Fed/ECB/BoJ/BoE statements, M&A wire services (Dealogic, Refinitiv, Bloomberg M&A), commodity reports (EIA, OPEC, World Gold Council), IMF/World Bank data, earnings whisper numbers.

For each market provided (which may be crypto, equity, M&A, commodity, macro, or other), perform exhaustive fundamental research and return JSON with:
- marketId
- sources: array of source names actually used
- sentimentScore: number -1 to 1
- keyHeadlines: array of 3-5 { headline, source, impact: "bullish"|"bearish"|"neutral" }
- analystConsensus: { rating: "strong_buy"|"buy"|"hold"|"sell"|"strong_sell", priceTarget, numAnalysts, recentChanges }
- historicalBaseRate: number 0-1, base rate for this type of event resolving YES
- institutionalActivity: detailed description of any 13F/13D filings, block trades, dark pool prints, insider buys/sells, or unusual options activity
- newsVsOddsGap: number, positive means news is more bullish than current odds
- credibilityScore: number 0-10
- catalysts: array of { event, date, expectedImpact: "high"|"medium"|"low", direction: "bullish"|"bearish" }
- regulatoryRisk: description of any regulatory, legal, or geopolitical risks
- keyFactors: array of 3-5 strings — the most important fundamental factors that should directly influence a trade decision on this market

Return ONLY valid JSON array, no markdown, no extra text.`;

  const PREDICTION = `You are a Prediction Agent using ensemble methods (XGBoost + LLM calibration) for prediction markets.

Session parameters (adjusted from prior debrief):
- Minimum edge to flag as TRADEABLE: ${(p.edgeThreshold * 100).toFixed(1)}%
- Minimum confidence required: ${(p.confidenceThreshold * 100).toFixed(0)}%

Given market data and research, you must:
1. Calculate calibrated true probability using Bayesian updating
2. Compute edge = trueProbability - marketOdds
3. Only flag as TRADEABLE if |edge| > ${p.edgeThreshold} AND confidence > ${p.confidenceThreshold}
4. Apply Kelly Criterion inputs

Return a JSON array. For EVERY market, include ALL of these fields:
- marketId, category
- marketOdds: number 0-1
- trueProbability: number 0-1 (your Bayesian estimate)
- edge: number (trueProbability - marketOdds)
- confidence: number 0-1
- direction: "YES" or "NO"
- kellyCriterion: number (recommended fraction of bankroll)
- TRADEABLE: boolean
- reasoning: detailed paragraph explaining your probability estimate, what evidence drove it, and why the edge exists or doesn't
- xgboostSignals: { momentumScore, volumeAnomaly, spreadSignal, sentimentAlignment, fundamentalScore } all as numbers -1 to 1
- llmCalibration: { priorProbability, likelihoodRatio, posteriorShift, calibrationNotes }
- keyFactors: array of 4-6 strings — the single most decisive factors from ALL research that make or break this trade. Be specific: name the catalyst, the source, and the direction of impact.
- tradeRationale: 2-3 sentence plain-English explanation of exactly WHY to take or skip this trade, written for a human trader making a final decision
- risks: array of 2-4 strings naming specific downside risks unique to this market

Markets span crypto, equities, M&A, commodities, macro, and more — apply category-appropriate base rates and liquidity discounts. Be selective: only 3-6 markets should be TRADEABLE. Return ONLY valid JSON array, no markdown, no extra text.`;

  const RISK = `You are a Risk Management Agent - the final gatekeeper before any trade is placed.

Session parameters (adjusted from prior debrief):
- Kelly cap: ${(p.kellyCap * 100).toFixed(0)}% of bankroll per trade
- Daily drawdown limit: ${(p.dailyDrawdownLimit * 100).toFixed(0)}%
- Minimum edge: ${(p.edgeThreshold * 100).toFixed(1)}%

Given prediction agent outputs and account info:
1. Calculate position size using Kelly Criterion, capped at ${(p.kellyCap * 100).toFixed(0)}% of bankroll
2. Block trades that exceed risk gates or fall below minimum edge
3. For APPROVED trades: simulate on-chain placement, set settlement watchers
4. For BLOCKED trades: explain exactly why

Return JSON array:
- marketId, direction, edge, positionSize, positionSizePct, bankrollUsed, APPROVED (boolean), blockReason (if blocked), settlementWatcher{}, onChainTxHash (simulated if approved), riskScore (0-10)

Return ONLY valid JSON, no markdown.`;

  const OUTLOOK = `You are a Market Intelligence Agent assessing trade outlook against real-world conditions.

For each trade provided, synthesize current market context to determine if the position has a positive or negative external environment.

Analyze and return JSON array per trade:
- marketId: (string, match the provided marketId)
- direction: ("YES"/"NO")
- overallOutlook: ("POSITIVE" | "NEGATIVE" | "NEUTRAL")
- outlookScore: (integer -10 to +10, where +10 = extremely favorable, -10 = extremely unfavorable)
- recentNews: array of 2-3 objects with { headline: string, sentiment: "bullish"|"bearish"|"neutral" }
- marketTrend: short phrase describing current macro/sector trend relevant to this market
- bigMoneySignal: description of any notable institutional moves, whale activity, or major investments/selloffs
- outlookSummary: 2-3 sentence plain-English verdict on whether external conditions support or oppose this trade direction

Be realistic and specific to each market topic. Return ONLY valid JSON array, no markdown.`;

  const DEBRIEF = `You are the Meta-Learning Coordinator - post-session debrief orchestrator.

Current session parameters:
${JSON.stringify(p, null, 2)}

Given all agent outputs, produce a comprehensive debrief covering ALL of the following:

1. What went well (accurate predictions, good risk management)
2. What went wrong (missed signals, overcaution, errors)
3. Root cause analysis for any mistakes
4. Specific parameter adjustments for next session (IMPORTANT: return numeric values for edgeThreshold, confidenceThreshold, kellyCap, dailyDrawdownLimit, minLiquidity, maxMarketsToAnalyze)
5. Updated confidence in each agent's outputs
6. Overall session grade (A/B/C/D/F)
7. OPTIMAL INVESTMENT TIMING: Based on market types traded, local time provided, and liquidity patterns — specify the best windows of the day to enter positions (use the local time context given). Give 2-4 specific time windows as { label, startTime, endTime, reason }.
8. MINIMUM INVESTMENT SIZING: For each approved trade type/category, calculate the minimum position size in USD that achieves maximum profitability given the edge, Kelly fraction, and bankroll. Return as { category, minInvestmentUSD, expectedReturnPct, rationale }.
9. ACTION RISK REGISTER: For every trade action taken this session, identify all associated risks (market risk, timing risk, liquidity risk, model risk, tail risk). Return as array of { marketId, riskType, severity ("LOW"|"MEDIUM"|"HIGH"|"CRITICAL"), description, mitigation }.
10. CONCLUSIVE SESSION SUMMARY: Write a comprehensive plain-English executive summary of the entire session. Cover: what the most important signals were across all research, which markets offered genuine edge and why, what macro/sector forces dominated this session, what the collective keyFactors across all agents are telling us, what a trader should take away from this session, and a clear forward-looking view on the highest-conviction opportunities. This should be 4-6 dense, informative sentences. Return as a single string field: conclusiveSummary.

Return JSON:
- sessionGrade, totalMarketsScanned, tradesAttempted, tradesApproved, estimatedEdgeCapture,
  agentPerformance{scan,researchA,researchB,prediction,risk},
  whatWentWell[], whatWentWrong[], rootCauses[],
  parameterAdjustments{ edgeThreshold, confidenceThreshold, kellyCap, dailyDrawdownLimit, minLiquidity, maxMarketsToAnalyze },
  lessonsLearned[], nextSessionFocus[],
  optimalTimingWindows[{ label, startTime, endTime, reason }],
  minimumInvestmentSizing[{ category, minInvestmentUSD, expectedReturnPct, rationale }],
  actionRiskRegister[{ marketId, riskType, severity, description, mitigation }],
  conclusiveSummary (string)

Return ONLY valid JSON, no markdown.`;

  const NEURAL_NET = `You are a Neural Network Analysis Agent simulating a Temporal Convolutional Network (TCN) for prediction market signal validation. You MUST compute all four formulas below for every market and include all results in your JSON output.

FEATURE MATRIX: X^(t) ∈ ℝ^(64×12) where the 12 features are:
price, volume, spread, sentimentScore, newsScore, edge, odds, liquidity, daysToResolution, priceSwing, socialMomentum, fundamentalsScore

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMULA 1 — Calibrated Sigmoid Head:
p̂_t+1 = σ(w⊤ TCN(X^(t)) + b),  X^(t) ∈ ℝ^(64×12)

Steps:
1. Simulate TCN(X^(t)): extract temporal patterns across all 12 feature channels from the 64-timestep window. Produce a latent vector.
2. Compute the dot product score: dotScore = w⊤ · TCN(X^(t)) + b  (a scalar, can be any real number)
3. Apply sigmoid: calibratedProb = 1 / (1 + exp(-dotScore))
4. rawSignal = tanh(dotScore), mapped to [-1.0, +1.0]

Return: dotScore (number), calibratedProb (number 0-1), rawSignal (number -1 to 1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMULA 2 — Deadbanded Volatility-Scaled Risk Map:
w_t+1 = clip((σ* / σ̂_t+1) × g_τ(2p̂_t+1 − 1),  w_min, w_max)

Parameters:
- σ* = 0.01 (target daily volatility)
- σ̂_t+1 = estimated next-period daily volatility for this market (derive from spread, volume, price swing, and days-to-resolution)
- g_τ(x): deadband function — if |x| < τ (τ = 0.10) return 0, else return x − τ×sign(x)
- w_min = -1.0 (max short), w_max = 1.0 (max long)

Steps:
1. Estimate σ̂_t+1 from market characteristics
2. Compute innerSignal = 2 × calibratedProb − 1  (maps 0-1 prob to -1 to +1)
3. Apply deadband: g_τ = 0 if |innerSignal| < 0.10, else innerSignal − 0.10×sign(innerSignal)
4. volScalingFactor = σ* / σ̂_t+1
5. rawSignalBeforeClip = volScalingFactor × g_τ
6. finalWeight = clip(rawSignalBeforeClip, -1.0, 1.0)

Return: targetVol (0.01), estimatedVol (number), volScalingFactor (number), deadbandApplied (boolean — true if g_τ was zeroed), rawSignalBeforeClip (number), finalWeight (number -1.0 to 1.0)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMULA 3 — Sharpe-Weighted Ensemble Score:
sharpeScore = (scanScore×0.15) + (sentimentScore×0.20) + (fundamentalsScore×0.20) + (edgeScore×0.25) + (neuralScore×0.20)

All sub-scores normalized to [-1, +1]:
- scanScore: derived from liquidityScore and flags (high liquidity + no flags = +1)
- sentimentScore: from research agent sentiment data (-1 to +1 directly)
- fundamentalsScore: from research agent fundamentals (-1 to +1)
- edgeScore: normalize edge to [-1,+1] (edge of 0.20+ = +1, edge of -0.20 = -1)
- neuralScore: use rawSignal from Formula 1

Return: ensembleScore (number -1 to 1), weightBreakdown{ scan, sentiment, fundamentals, edge, neural } (each -1 to 1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMULA 4 — Kelly Criterion with Neural Calibration:
f* = (p̂_t+1 × b − (1 − p̂_t+1)) / b
actualBet = 0.5 × f*   (half-Kelly safety factor)
adjustedBet = actualBet × |finalWeight|   (scale by neural weight from Formula 2)

Where b = decimal odds − 1 (derive decimal odds from marketOdds: if marketOdds = 0.6 then decimal = 1/0.6 = 1.667, b = 0.667)

Return: oddsDecimal (number), kellyFull (number), kellyHalf (number), adjustedBet (number, final recommended fraction of bankroll)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONSENSUS & VALIDATION:
- neuralConsensus: if finalWeight > 0.05 → "BUY", if finalWeight < -0.05 → "SELL", else → "HOLD"
- neuralValidation: compare neuralConsensus with risk agent APPROVED status.
  CONFIRMS = neural agrees with risk decision.
  OVERRIDE = neural disagrees (risk APPROVED but neural SELL, or risk BLOCKED but neural BUY with ensembleScore > 0.3).
  NEUTRAL = insufficient signal to validate.
- If OVERRIDE, set overrideFormula to whichever formula most triggered it (e.g. "Formula 2: high estimated volatility collapsed finalWeight below threshold despite risk approval") and overrideReason (string).

FEATURE IMPORTANCE: Which of the 12 features most drove the TCN signal. Return featureImportance as object { featureName: importanceWeight (0-1) } for top 5 features.

TCN REASONING: 1-2 sentences describing the dominant temporal patterns detected.

Return a JSON array, one object per market, with ALL of these fields:
marketId, dotScore, rawSignal, calibratedProb,
targetVol, estimatedVol, volScalingFactor, deadbandApplied, rawSignalBeforeClip, finalWeight,
ensembleScore, weightBreakdown{ scan, sentiment, fundamentals, edge, neural },
oddsDecimal, kellyFull, kellyHalf, adjustedBet,
tcnConfidence, featureImportance{}, neuralConsensus, neuralValidation,
overrideFormula (string or null), overrideReason (string or null), tcnReasoning

Return ONLY valid JSON array, no markdown.`;

  return { SCAN, RESEARCH_A, RESEARCH_B, PREDICTION, RISK, OUTLOOK, DEBRIEF, NEURAL_NET };
}

// ─── API Helper ───────────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userMessage, onChunk, maxTokens = 2000) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`API ${response.status}: ${JSON.stringify(err)}`);
  }

  const data = await response.json();
  const text = data.content[0].text;
  onChunk?.(text);
  return text;
}

function parseJSON(text) {
  if (!text) return null;
  // Strip markdown fences
  let clean = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Direct parse
  try { return JSON.parse(clean); } catch {}
  // Extract first JSON array
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
  // Extract first JSON object
  const objMatch = clean.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
  // Fix common trailing comma issue and retry
  const noTrailing = clean.replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(noTrailing); } catch {}
  const noTrailingArr = noTrailing.match(/\[[\s\S]*\]/);
  if (noTrailingArr) { try { return JSON.parse(noTrailingArr[0]); } catch {} }
  return null;
}

// ─── Market name lookup ───────────────────────────────────────────────────────
function getMarketName(marketId, scanData, maxLen = 36) {
  const m = scanData?.find(s => String(s.id) === String(marketId));
  if (!m?.title) return `Market ${marketId}`;
  return m.title.length > maxLen ? m.title.slice(0, maxLen - 1) + "…" : m.title;
}

function mergeParams(base, adjustments) {
  if (!adjustments || typeof adjustments !== "object") return base;
  const merged = { ...base };
  const clamp = (v, min, max) => Math.min(Math.max(Number(v), min), max);
  if (adjustments.edgeThreshold)        merged.edgeThreshold        = clamp(adjustments.edgeThreshold, 0.03, 0.20);
  if (adjustments.confidenceThreshold)  merged.confidenceThreshold  = clamp(adjustments.confidenceThreshold, 0.50, 0.95);
  if (adjustments.kellyCap)             merged.kellyCap             = clamp(adjustments.kellyCap, 0.01, 0.10);
  if (adjustments.dailyDrawdownLimit)   merged.dailyDrawdownLimit   = clamp(adjustments.dailyDrawdownLimit, 0.03, 0.20);
  if (adjustments.minLiquidity)         merged.minLiquidity         = clamp(adjustments.minLiquidity, 1000, 100000);
  if (adjustments.maxMarketsToAnalyze)  merged.maxMarketsToAnalyze  = clamp(adjustments.maxMarketsToAnalyze, 3, 25);
  return merged;
}

// ─── PDF Report Generator ────────────────────────────────────────────────────
async function generatePDF({ sessionParams, bankroll, agentStates, logs, paramHistory, outlookData }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 16;
  const COL = W - MARGIN * 2;
  let y = 0;

  // ── Helpers ──
  const newPage = () => { doc.addPage(); y = 20; };
  const checkY = (need = 10) => { if (y + need > 275) newPage(); };

  const rect = (x, ry, w, h, r = 3) => doc.roundedRect(x, ry, w, h, r, r, "F");

  const heading = (text, level = 1) => {
    checkY(14);
    if (level === 1) {
      doc.setFillColor(30, 20, 60);
      rect(MARGIN, y, COL, 9, 2);
      doc.setTextColor(167, 139, 250);
      doc.setFontSize(11); doc.setFont("helvetica", "bold");
      doc.text(text, MARGIN + 4, y + 6.2);
      y += 13;
    } else {
      doc.setTextColor(96, 165, 250);
      doc.setFontSize(9); doc.setFont("helvetica", "bold");
      doc.text(text, MARGIN, y);
      y += 6;
    }
  };

  const row = (label, value, labelColor = [100, 116, 139], valueColor = [226, 232, 240]) => {
    checkY(6);
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.setTextColor(...labelColor);
    doc.text(String(label), MARGIN + 2, y);
    doc.setTextColor(...valueColor);
    const val = String(value ?? "—");
    doc.text(val, W - MARGIN - 2, y, { align: "right", maxWidth: COL * 0.55 });
    y += 5.5;
  };

  const bullet = (text, color = [148, 163, 184]) => {
    checkY(6);
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(`• ${text}`, COL - 6);
    doc.text(lines, MARGIN + 2, y);
    y += lines.length * 4.5;
  };

  const divider = () => {
    checkY(4);
    doc.setDrawColor(40, 30, 70);
    doc.line(MARGIN, y, W - MARGIN, y);
    y += 4;
  };

  const scanData      = agentStates.scan.output;
  const predictions   = agentStates.prediction.output;
  const riskDecisions = agentStates.risk.output;
  const debrief       = agentStates.debrief.output;
  const approved      = riskDecisions?.filter(r => r.APPROVED) || [];
  const blocked       = riskDecisions?.filter(r => !r.APPROVED) || [];
  const now           = new Date();

  // ── Cover ──────────────────────────────────────────────────────────────────
  doc.setFillColor(5, 5, 8);
  doc.rect(0, 0, W, 297, "F");

  doc.setFillColor(20, 10, 50);
  rect(MARGIN, 30, COL, 60, 6);

  doc.setTextColor(167, 139, 250);
  doc.setFontSize(22); doc.setFont("helvetica", "bold");
  doc.text("NEXUS PRED", W / 2, 52, { align: "center" });

  doc.setTextColor(96, 165, 250);
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  doc.text("Multi-Agent Prediction Market Report", W / 2, 62, { align: "center" });

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.text(now.toLocaleString(), W / 2, 72, { align: "center" });
  doc.text(`Session #${paramHistory.length + 1}  ·  Bankroll: $${bankroll.toLocaleString()}`, W / 2, 78, { align: "center" });

  // Grade badge
  if (debrief?.sessionGrade) {
    doc.setFillColor(40, 20, 80);
    rect(W / 2 - 14, 110, 28, 28, 6);
    doc.setTextColor(167, 139, 250);
    doc.setFontSize(26); doc.setFont("helvetica", "bold");
    doc.text(debrief.sessionGrade, W / 2, 130, { align: "center" });
    doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    doc.text("SESSION GRADE", W / 2, 144, { align: "center" });
  }

  // ── Page 2 ── Session Parameters ──────────────────────────────────────────
  newPage();
  doc.setFillColor(5, 5, 8);
  doc.rect(0, 0, W, 297, "F");

  heading("SESSION PARAMETERS");
  row("Edge Threshold",       `${(sessionParams.edgeThreshold * 100).toFixed(1)}%`);
  row("Confidence Threshold", `${(sessionParams.confidenceThreshold * 100).toFixed(0)}%`);
  row("Kelly Cap",            `${(sessionParams.kellyCap * 100).toFixed(0)}%`);
  row("Daily Drawdown Limit", `${(sessionParams.dailyDrawdownLimit * 100).toFixed(0)}%`);
  row("Min Liquidity",        `$${sessionParams.minLiquidity.toLocaleString()}`);
  row("Max Markets Analyzed", sessionParams.maxMarketsToAnalyze);
  divider();

  // ── Market Summary ─────────────────────────────────────────────────────────
  heading("MARKET SCAN SUMMARY");
  row("Markets Scanned",  scanData?.length ?? "—");
  row("Markets Flagged",  scanData?.filter(m => m.flags?.length > 0).length ?? "—");
  row("Trade Signals",    predictions?.filter(p => p.TRADEABLE).length ?? "—");
  row("Trades Approved",  approved.length);
  row("Trades Blocked",   blocked.length);
  divider();

  // ── Scanned Markets ────────────────────────────────────────────────────────
  if (scanData?.length) {
    heading("SCANNED MARKETS");
    scanData.forEach(m => {
      checkY(18);
      doc.setFillColor(15, 10, 30);
      rect(MARGIN, y, COL, 14, 2);
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(226, 232, 240);
      const title = doc.splitTextToSize(m.title, COL - 40);
      doc.text(title, MARGIN + 3, y + 5);
      doc.setTextColor(52, 211, 153);
      doc.setFont("helvetica", "normal");
      doc.text(`${((m.currentOdds || 0) * 100).toFixed(0)}%`, W - MARGIN - 3, y + 5, { align: "right" });
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(7);
      doc.text(`Vol: $${(m.volume || 0).toLocaleString()}  ·  ${m.daysToResolution}d  ·  Spread: ${m.spreadPct?.toFixed(1)}%  ·  ${m.flags?.join(", ") || "no flags"}`, MARGIN + 3, y + 10);
      y += 17;
    });
    divider();
  }

  // ── Predictions ────────────────────────────────────────────────────────────
  if (predictions?.length) {
    heading("PREDICTION ANALYSIS");
    predictions.forEach(p => {
      checkY(20);
      const isTrade = p.TRADEABLE;
      doc.setFillColor(isTrade ? 10 : 15, isTrade ? 25 : 10, isTrade ? 20 : 30);
      rect(MARGIN, y, COL, 16, 2);
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(isTrade ? 52 : 100, isTrade ? 211 : 116, isTrade ? 153 : 139);
      doc.text(`Market ${p.marketId}  ${isTrade ? "● TRADEABLE" : "○ SKIP"}`, MARGIN + 3, y + 5);
      doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
      doc.text(`Market Odds: ${((p.marketOdds || 0) * 100).toFixed(1)}%  ·  True Prob: ${((p.trueProbability || 0) * 100).toFixed(1)}%  ·  Edge: ${((p.edge || 0) * 100).toFixed(1)}%  ·  Conf: ${((p.confidence || 0) * 100).toFixed(0)}%  ·  Dir: ${p.direction || "—"}`, MARGIN + 3, y + 10);
      if (p.reasoning) {
        const r = doc.splitTextToSize(p.reasoning, COL - 6);
        doc.setFontSize(7); doc.setTextColor(100, 116, 139);
        doc.text(r[0], MARGIN + 3, y + 14);
      }
      y += 19;
    });
    divider();
  }

  // ── Risk Decisions ─────────────────────────────────────────────────────────
  if (riskDecisions?.length) {
    heading("RISK DECISIONS");
    riskDecisions.forEach(t => {
      checkY(18);
      const ok = t.APPROVED;
      doc.setFillColor(ok ? 10 : 20, ok ? 25 : 10, ok ? 20 : 10);
      rect(MARGIN, y, COL, 14, 2);
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(ok ? 52 : 248, ok ? 211 : 113, ok ? 153 : 113);
      doc.text(`${ok ? "✓ APPROVED" : "✗ BLOCKED"}  Market ${t.marketId}  ${t.direction || ""}`, MARGIN + 3, y + 5);
      doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184); doc.setFontSize(7.5);
      doc.text(`Edge: ${((t.edge || 0) * 100).toFixed(1)}%  ·  Size: $${(t.positionSize || 0).toFixed(0)}  ·  ${(t.positionSizePct || 0).toFixed(1)}% of bankroll  ·  Risk: ${t.riskScore}/10`, MARGIN + 3, y + 10);
      if (!ok && t.blockReason) {
        doc.setTextColor(248, 113, 113);
        doc.text(`⛔ ${String(t.blockReason).slice(0, 90)}`, MARGIN + 3, y + 13.5);
      }
      y += 17;
    });
    divider();
  }

  // ── Market Outlook ─────────────────────────────────────────────────────────
  if (outlookData?.length) {
    heading("MARKET INTELLIGENCE OUTLOOK");
    outlookData.forEach(o => {
      checkY(22);
      const isPos = o.overallOutlook === "POSITIVE";
      const isNeg = o.overallOutlook === "NEGATIVE";
      const oColor = isPos ? [52,211,153] : isNeg ? [248,113,113] : [251,191,36];
      doc.setFillColor(isPos ? 8 : isNeg ? 18 : 14, isPos ? 22 : isNeg ? 10 : 18, isPos ? 16 : isNeg ? 10 : 8);
      rect(MARGIN, y, COL, 18, 2);
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.setTextColor(...oColor);
      doc.text(`Market ${o.marketId}  ${o.direction || ""}  ·  ${o.overallOutlook}  (${o.outlookScore > 0 ? "+" : ""}${o.outlookScore}/10)`, MARGIN + 3, y + 5);
      if (o.marketTrend) {
        doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139); doc.setFontSize(7);
        doc.text(`Trend: ${o.marketTrend}`, MARGIN + 3, y + 9.5);
      }
      if (o.outlookSummary) {
        const lines = doc.splitTextToSize(o.outlookSummary, COL - 6);
        doc.setFontSize(7); doc.setTextColor(148, 163, 184);
        doc.text(lines[0], MARGIN + 3, y + 14);
      }
      y += 21;
    });
    divider();
  }

  // ── Debrief ────────────────────────────────────────────────────────────────
  if (debrief) {
    heading("DEBRIEF & LESSONS LEARNED");

    if (debrief.whatWentWell?.length) {
      heading("What Went Well", 2);
      debrief.whatWentWell.forEach(w => bullet(w, [52, 211, 153]));
      y += 2;
    }
    if (debrief.whatWentWrong?.length) {
      heading("What Went Wrong", 2);
      debrief.whatWentWrong.forEach(w => bullet(w, [248, 113, 113]));
      y += 2;
    }
    if (debrief.rootCauses?.length) {
      heading("Root Causes", 2);
      debrief.rootCauses.forEach(r => bullet(r, [251, 191, 36]));
      y += 2;
    }
    if (debrief.lessonsLearned?.length) {
      heading("Lessons Learned", 2);
      debrief.lessonsLearned.forEach(l => bullet(l, [167, 139, 250]));
      y += 2;
    }
    if (debrief.nextSessionFocus?.length) {
      heading("Next Session Focus", 2);
      debrief.nextSessionFocus.forEach(n => bullet(n, [96, 165, 250]));
      y += 2;
    }
    if (debrief.parameterAdjustments) {
      heading("Parameter Adjustments Applied", 2);
      Object.entries(debrief.parameterAdjustments).forEach(([k, v]) => row(k, v, [100, 116, 139], [96, 165, 250]));
    }

    if (debrief.optimalTimingWindows?.length) {
      heading("Optimal Investment Timing (Local Time)", 2);
      debrief.optimalTimingWindows.forEach(w => {
        checkY(10);
        doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.setTextColor(52, 211, 153);
        doc.text(`${w.label}  ${w.startTime} – ${w.endTime}`, MARGIN + 2, y);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
        const lines = doc.splitTextToSize(w.reason, COL - 6);
        doc.text(lines, MARGIN + 2, y + 4.5);
        y += 4.5 + lines.length * 4 + 2;
      });
      y += 2;
    }

    if (debrief.minimumInvestmentSizing?.length) {
      heading("Minimum Investment for Maximum Profitability", 2);
      debrief.minimumInvestmentSizing.forEach(s => {
        checkY(12);
        doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.setTextColor(251, 191, 36);
        doc.text(s.category, MARGIN + 2, y);
        doc.setTextColor(52, 211, 153);
        doc.text(`$${(s.minInvestmentUSD || 0).toLocaleString()}  +${s.expectedReturnPct?.toFixed(1)}% expected`, W - MARGIN - 2, y, { align: "right" });
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
        const lines = doc.splitTextToSize(s.rationale, COL - 6);
        doc.text(lines, MARGIN + 2, y + 4.5);
        y += 4.5 + lines.length * 4 + 2;
      });
      y += 2;
    }

    if (debrief.actionRiskRegister?.length) {
      heading("Action Risk Register", 2);
      debrief.actionRiskRegister.forEach(r => {
        checkY(12);
        const sevColor = { LOW: [52,211,153], MEDIUM: [251,191,36], HIGH: [249,115,22], CRITICAL: [248,113,113] }[r.severity] || [148,163,184];
        doc.setFontSize(7.5); doc.setFont("helvetica", "bold");
        doc.setTextColor(...sevColor);
        doc.text(`[${r.severity}]  Market ${r.marketId}  ·  ${r.riskType}`, MARGIN + 2, y);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
        const descLines = doc.splitTextToSize(r.description, COL - 6);
        doc.text(descLines, MARGIN + 2, y + 4.5);
        doc.setTextColor(96, 165, 250);
        const mitLines = doc.splitTextToSize(`Mitigation: ${r.mitigation}`, COL - 6);
        doc.text(mitLines, MARGIN + 2, y + 4.5 + descLines.length * 4);
        y += 4.5 + (descLines.length + mitLines.length) * 4 + 2;
      });
    }

    divider();
  }

  // ── Session Log ────────────────────────────────────────────────────────────
  if (logs.length) {
    heading("SESSION LOG");
    logs.slice(-60).forEach(l => {
      const color = { error: [248,113,113], success: [52,211,153], warning: [251,191,36], trade: [167,139,250], system: [96,165,250] }[l.type] || [148,163,184];
      checkY(5);
      doc.setFontSize(7); doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(l.time, MARGIN + 2, y);
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(l.msg, COL - 20);
      doc.text(lines, MARGIN + 18, y);
      y += lines.length * 4 + 1;
    });
  }

  // ── Footer on every page ───────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(5, 5, 8);
    doc.rect(0, 285, W, 12, "F");
    doc.setFontSize(7); doc.setFont("helvetica", "normal");
    doc.setTextColor(50, 50, 80);
    doc.text("NEXUS PRED — Multi-Agent Prediction Market System", MARGIN, 291);
    doc.text(`${i} / ${totalPages}`, W - MARGIN, 291, { align: "right" });
  }

  const filename = `nexus-pred-session-${now.toISOString().slice(0,10)}-${Date.now()}.pdf`;
  doc.save(filename);
}

// ─── Neural Network 3D Visualisation ─────────────────────────────────────────
function NeuralNetViz({ neuralData, scanData }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const syncSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);

    const outputs = neuralData?.length
      ? neuralData.map(n => {
          const m = scanData?.find(s => String(s.id) === String(n.marketId));
          const label = m ? (m.title.length > 20 ? m.title.slice(0, 19) + "…" : m.title) : `Mkt ${n.marketId}`;
          return { label, consensus: n.neuralConsensus || "HOLD", weight: n.finalWeight ?? 0, validation: n.neuralValidation || "NEUTRAL" };
        })
      : [
          { label: "BTC/USD", consensus: "BUY", weight: 0.42, validation: "CONFIRMS" },
          { label: "NVDA Earnings", consensus: "HOLD", weight: 0.02, validation: "NEUTRAL" },
          { label: "ETH/USD", consensus: "BUY", weight: 0.31, validation: "CONFIRMS" },
        ];

    const LAYERS = [
      { name: "Input ×12",  count: 12, labels: ["price","volume","spread","sentiment","news","edge","odds","liquidity","days","swing","social","fundScore"] },
      { name: "TCN-1",      count: 10 },
      { name: "TCN-2",      count: 10 },
      { name: "TCN-3",      count: 8  },
      { name: "Dense",      count: 5  },
      { name: "Output",     count: outputs.length },
    ];

    const consensusColor = (c) => c === "BUY" ? "#34d399" : c === "SELL" ? "#f87171" : "#fbbf24";
    const nodeColor = (li, ni) => {
      if (li === LAYERS.length - 1) return consensusColor(outputs[ni]?.consensus || "HOLD");
      if (li === 0) return "#60a5fa";
      return "#a78bfa";
    };

    const particles = [];
    let frame = 0;

    const getNodePos = (W, H) => {
      const padX = 110, padY = 40;
      const usableW = W - padX * 2;
      const usableH = H - padY * 2 - 24;
      return LAYERS.map((layer, li) => {
        const x = padX + (li / (LAYERS.length - 1)) * usableW;
        const depthShift = ((LAYERS.length - 1 - li) / (LAYERS.length - 1)) * 14;
        const vH = usableH - depthShift * 2;
        const startY = padY + depthShift + (layer.count > 1 ? 0 : vH / 2);
        const spacing = layer.count > 1 ? vH / (layer.count - 1) : 0;
        return Array.from({ length: layer.count }, (_, ni) => ({ x, y: startY + ni * spacing }));
      });
    };

    const draw = () => {
      const W = canvas.getBoundingClientRect().width;
      const H = canvas.getBoundingClientRect().height;
      if (!W || !H) { rafRef.current = requestAnimationFrame(draw); return; }

      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = "#05050a";
      ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = "rgba(96,165,250,0.04)";
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      const nodePos = getNodePos(W, H);

      // Connections
      for (let li = 0; li < LAYERS.length - 1; li++) {
        const from = nodePos[li], to = nodePos[li + 1];
        const alpha = li >= LAYERS.length - 2 ? 0.18 : 0.06;
        const isOutputAdj = li === LAYERS.length - 2;
        for (const f of from) {
          for (const t of to) {
            if (!isOutputAdj && Math.random() < 0.3) continue; // sparse for hidden layers in draw
            ctx.strokeStyle = isOutputAdj ? `rgba(167,139,250,${alpha})` : `rgba(96,165,250,${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(t.x, t.y); ctx.stroke();
          }
        }
      }

      // Spawn particles
      if (frame % 3 === 0 && particles.length < 80) {
        const li = Math.floor(Math.random() * (LAYERS.length - 1));
        const fi = Math.floor(Math.random() * LAYERS[li].count);
        const ti = Math.floor(Math.random() * LAYERS[li + 1].count);
        const f = nodePos[li][fi], t = nodePos[li + 1][ti];
        let color = li === 0 ? "#60a5fa" : li === LAYERS.length - 2 ? consensusColor(outputs[ti]?.consensus || "HOLD") : "#a78bfa";
        particles.push({ fx: f.x, fy: f.y, tx: t.x, ty: t.y, p: 0, sp: 0.012 + Math.random() * 0.022, color });
      }

      // Draw & update particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.p += pt.sp;
        if (pt.p >= 1) { particles.splice(i, 1); continue; }
        const cx = pt.fx + (pt.tx - pt.fx) * pt.p;
        const cy = pt.fy + (pt.ty - pt.fy) * pt.p;
        const fade = pt.p < 0.15 ? pt.p / 0.15 : pt.p > 0.85 ? (1 - pt.p) / 0.15 : 1;
        const a = Math.floor(fade * 255).toString(16).padStart(2, "0");
        const ga = Math.floor(fade * 50).toString(16).padStart(2, "0");
        // Glow
        ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = pt.color + ga; ctx.fill();
        // Core
        ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = pt.color + a; ctx.fill();
      }

      // Draw nodes
      for (let li = 0; li < LAYERS.length; li++) {
        const pulse = 0.5 + 0.5 * Math.sin(frame * 0.035 + li * 0.8);
        const baseR = li === 0 ? 4 : li === LAYERS.length - 1 ? 8 : 5 + (li / LAYERS.length) * 2;
        for (let ni = 0; ni < nodePos[li].length; ni++) {
          const { x, y } = nodePos[li][ni];
          const col = nodeColor(li, ni);
          const isOutput = li === LAYERS.length - 1;
          const r = baseR + (isOutput ? pulse * 2 : 0);

          // Outer glow
          const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.8);
          g.addColorStop(0, col + "33"); g.addColorStop(1, col + "00");
          ctx.beginPath(); ctx.arc(x, y, r * 2.8, 0, Math.PI * 2);
          ctx.fillStyle = g; ctx.fill();

          // Pulse ring for output
          if (isOutput) {
            const va = outputs[ni]?.validation === "CONFIRMS" ? 1 : outputs[ni]?.validation === "OVERRIDE" ? 0.8 : 0.3;
            ctx.beginPath(); ctx.arc(x, y, r + 4 + pulse * 5, 0, Math.PI * 2);
            ctx.strokeStyle = col + Math.floor(pulse * va * 120).toString(16).padStart(2, "0");
            ctx.lineWidth = 1.5; ctx.stroke();
          }

          // Node body
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = col + "22"; ctx.fill();
          ctx.strokeStyle = col; ctx.lineWidth = isOutput ? 2 : 1; ctx.stroke();

          // Labels
          ctx.font = `${isOutput ? 11 : 8}px monospace`;
          if (li === 0 && LAYERS[0].labels?.[ni]) {
            ctx.fillStyle = col + "cc"; ctx.textAlign = "right";
            ctx.fillText(LAYERS[0].labels[ni], x - r - 5, y + 3);
          } else if (isOutput && outputs[ni]) {
            ctx.fillStyle = col; ctx.textAlign = "left";
            ctx.fillText(outputs[ni].label, x + r + 6, y - 5);
            ctx.font = "9px monospace"; ctx.fillStyle = col + "99";
            ctx.fillText(`${outputs[ni].consensus} ${(outputs[ni].weight >= 0 ? "+" : "")}${outputs[ni].weight.toFixed(3)}`, x + r + 6, y + 7);
          }
        }

        // Layer label
        ctx.fillStyle = "rgba(100,116,139,0.6)"; ctx.font = "9px monospace"; ctx.textAlign = "center";
        ctx.fillText(LAYERS[li].name, nodePos[li][0]?.x ?? 0, H - 6);
      }

      frame++;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, [neuralData, scanData]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PredictionBot() {
  const [phase, setPhase] = useState("idle");
  const [bankroll, setBankroll] = useState(10000);
  const [sessionParams, setSessionParams] = useState(DEFAULT_PARAMS);
  const [paramHistory, setParamHistory] = useState([]);
  const [agentStates, setAgentStates] = useState({
    scan:       { status: "idle", output: null, stream: "" },
    researchA:  { status: "idle", output: null, stream: "" },
    researchB:  { status: "idle", output: null, stream: "" },
    prediction: { status: "idle", output: null, stream: "" },
    risk:       { status: "idle", output: null, stream: "" },
    outlook:    { status: "idle", output: null, stream: "" },
    neural:     { status: "idle", output: null, stream: "" },
    debrief:    { status: "idle", output: null, stream: "" },
  });
  const [logs, setLogs] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tooltip, setTooltip] = useState({ visible: false, text: "", x: 0, y: 0 });
  const logsEndRef = useRef(null);

  const showTooltip = useCallback((text, x, y) => {
    setTooltip({ visible: true, text, x, y });
  }, []);
  const moveTooltip = useCallback((x, y) => {
    setTooltip(t => t.visible ? { ...t, x, y } : t);
  }, []);
  const hideTooltip = useCallback(() => {
    setTooltip(t => ({ ...t, visible: false }));
  }, []);

  const log = useCallback((msg, type = "info") => {
    setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const updateAgent = useCallback((name, updates) => {
    setAgentStates(prev => ({ ...prev, [name]: { ...prev[name], ...updates } }));
  }, []);

  const isRunning = phase !== "idle" && phase !== "done";

  // ── Resilient agent call: retries up to maxRetries times before returning fallback ──
  const callAgent = useCallback(async (agentKey, systemPrompt, userMessage, { maxTokens = 2000, maxRetries = 2, fallback = null } = {}) => {
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        let raw = "";
        await callClaude(systemPrompt, userMessage, t => { raw = t; updateAgent(agentKey, { stream: t }); }, maxTokens);
        const parsed = parseJSON(raw);
        if (parsed) return parsed;
        // Unparseable JSON — log and retry
        if (attempt <= maxRetries) log(`⚠️ ${agentKey}: response unparseable, retrying (${attempt}/${maxRetries})...`, "warning");
      } catch (err) {
        if (attempt <= maxRetries) {
          log(`⚠️ ${agentKey}: API error on attempt ${attempt} — ${err.message}. Retrying...`, "warning");
          await new Promise(r => setTimeout(r, 1200 * attempt));
        } else {
          log(`❌ ${agentKey}: failed after ${maxRetries + 1} attempts — ${err.message}. Using fallback data.`, "error");
        }
      }
    }
    return fallback;
  }, [updateAgent, log]);

  const runFullCycle = async () => {
    setPhase("scanning");
    setLogs([]);
    setSelectedMarket(null);
    Object.keys(agentStates).forEach(k => updateAgent(k, { status: "idle", output: null, stream: "" }));

    const prompts = buildPrompts(sessionParams);

    try {
      // ── Phase 1: Scan — 5 parallel batches covering all asset classes ─────
      log("🔍 Scan Agent initializing — sweeping 1000+ sources across all asset classes...", "system");
      updateAgent("scan", { status: "running" });

      const SCAN_SECTORS = [
        { label: "crypto",        desc: "cryptocurrency: BTC, ETH, Solana, DeFi protocols, altcoins, NFT floor prices" },
        { label: "equity",        desc: "company stocks: AAPL, TSLA, NVDA, MSFT, AMZN, META, GOOGL, NFLX — earnings, analyst upgrades/downgrades" },
        { label: "m&a",           desc: "corporate M&A: pending mergers, acquisition bids, hostile takeovers, share buyout completions" },
        { label: "macro-commodity", desc: "macro & commodities: Fed rate decisions, CPI prints, oil/WTI, gold, copper, natural gas" },
        { label: "other",         desc: "institutional investments, ETFs (SPY/QQQ), politics, tech product launches, sports championship outcomes" },
      ];

      log(`🔍 Scanning ${SCAN_SECTORS.length} sector batches in parallel...`, "system");

      const scanBatches = await Promise.all(
        SCAN_SECTORS.map(({ label, desc }, i) =>
          callAgent("scan", prompts.SCAN,
            `Sector: ${desc}. Bankroll: $${bankroll.toLocaleString()}. Use ids ${i * 4 + 1} to ${i * 4 + 4}.`,
            { maxTokens: 1500, maxRetries: 2, fallback: [] }
          )
        )
      );

      let scanData = scanBatches.flat().filter(m => m && m.id && m.title);

      // ── Hard recovery: if batches all failed, retry as a single call ─────────
      if (scanData.length < 3) {
        log("⚠️ Batch scan returned insufficient markets — running single recovery scan...", "warning");
        const recoveryScan = await callAgent("scan", prompts.SCAN,
          `Generate 4 markets each from these sectors: crypto, equity, M&A, macro/commodities. Total 16 markets. Bankroll: $${bankroll.toLocaleString()}. Use ids 1-16.`,
          { maxTokens: 3000, maxRetries: 2, fallback: [] }
        );
        scanData = (recoveryScan || []).filter(m => m && m.id && m.title);
      }

      if (!scanData.length) {
        throw new Error("Scan agent could not generate any markets after recovery. Check API key and connectivity.");
      }

      // Deduplicate by id, then normalise any string ids to numbers
      const seen = new Set();
      const dedupedScan = scanData.filter(m => {
        const key = String(m.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map((m, i) => ({ ...m, id: m.id ?? i + 1 }));

      updateAgent("scan", { status: "done", output: dedupedScan, stream: "" });
      log(`✅ Scan complete — ${dedupedScan.length} markets across all asset classes, ${dedupedScan.filter(m => m.flags?.length > 0).length} flagged`, "success");

      const scanData2 = dedupedScan; // alias used below

      // ── Phase 2: Research (batched 5 markets at a time to avoid throttling) ──
      setPhase("researching");
      log("🧪 Research Agents Alpha & Beta — batching markets to avoid rate limits...", "system");
      updateAgent("researchA", { status: "running" });
      updateAgent("researchB", { status: "running" });

      const RESEARCH_BATCH = 5;
      const rBatches = [];
      for (let i = 0; i < scanData2.length; i += RESEARCH_BATCH) rBatches.push(scanData2.slice(i, i + RESEARCH_BATCH));

      const allRA = [], allRB = [];
      for (let bi = 0; bi < rBatches.length; bi++) {
        const batch = rBatches[bi];
        const bsum = batch.map(m => `ID:${m.id} | [${m.category || "general"}] ${m.title} | Odds:${m.currentOdds}`).join("\n");
        log(`🧪 Research batch ${bi + 1}/${rBatches.length} — ${batch.length} markets...`, "system");
        const [bA, bB] = await Promise.all([
          callAgent("researchA", prompts.RESEARCH_A,
            `Analyze sentiment for EXACTLY these ${batch.length} markets. Return EXACTLY ${batch.length} JSON objects in an array:\n${bsum}`,
            { maxTokens: 4000, maxRetries: 3, fallback: [] }),
          callAgent("researchB", prompts.RESEARCH_B,
            `Analyze fundamentals for EXACTLY these ${batch.length} markets. Return EXACTLY ${batch.length} JSON objects in an array:\n${bsum}`,
            { maxTokens: 4000, maxRetries: 3, fallback: [] }),
        ]);
        allRA.push(...(Array.isArray(bA) ? bA : []));
        allRB.push(...(Array.isArray(bB) ? bB : []));
        if (bi < rBatches.length - 1) await new Promise(r => setTimeout(r, 800));
      }

      const researchA = allRA;
      const researchB = allRB;

      updateAgent("researchA", { status: "done", output: researchA, stream: "" });
      updateAgent("researchB", { status: "done", output: researchB, stream: "" });
      log(`✅ Research Alpha: ${researchA.length} sentiment analyses`, "success");
      log(`✅ Research Beta: ${researchB.length} fundamental analyses`, "success");

      // ── Phase 3: Prediction ───────────────────────────────────────────────
      setPhase("predicting");
      log(`🧠 Prediction Agent — edge ≥ ${(sessionParams.edgeThreshold * 100).toFixed(1)}%, confidence ≥ ${(sessionParams.confidenceThreshold * 100).toFixed(0)}%`, "system");
      updateAgent("prediction", { status: "running" });

      const n = Math.min(sessionParams.maxMarketsToAnalyze, 20);
      const scanSlim = scanData2.slice(0, n).map(({ id, title, category, currentOdds, volume, daysToResolution, spreadPct, flags }) =>
        ({ id, title, category, currentOdds, volume, daysToResolution, spreadPct, flags }));
      const predictions = await callAgent("prediction", prompts.PREDICTION,
        `Markets:\n${JSON.stringify(scanSlim)}\n\nSentiment:\n${JSON.stringify(researchA?.slice(0, n))}\n\nFundamentals:\n${JSON.stringify(researchB?.slice(0, n))}`,
        { maxTokens: 10000, maxRetries: 2, fallback: [] }
      );

      updateAgent("prediction", { status: "done", output: predictions, stream: "" });
      const tradeable = predictions?.filter(p => p.TRADEABLE)?.length || 0;
      log(`✅ Prediction complete — ${tradeable} trade opportunities above threshold`, "success");

      // ── Phase 4: Risk ─────────────────────────────────────────────────────
      setPhase("risk");
      log(`🛡️ Risk Agent — kelly cap: ${(sessionParams.kellyCap * 100).toFixed(0)}%, drawdown limit: ${(sessionParams.dailyDrawdownLimit * 100).toFixed(0)}%`, "system");
      updateAgent("risk", { status: "running" });

      const tradeablePreds = predictions?.filter(p => p.TRADEABLE) || [];
      const riskInput = tradeablePreds.length
        ? tradeablePreds
        : (predictions?.slice(0, 3) || []); // always give risk agent something to work with

      const riskDecisions = await callAgent("risk", prompts.RISK,
        `Bankroll: $${bankroll}\nTradeable predictions:\n${JSON.stringify(riskInput)}\n\nApply strict risk management.`,
        { maxTokens: 2000, maxRetries: 2, fallback: [] }
      );

      updateAgent("risk", { status: "done", output: riskDecisions, stream: "" });
      const approved = riskDecisions?.filter(r => r.APPROVED)?.length || 0;
      const blocked = (riskDecisions?.length || 0) - approved;
      log(`🛡️ Risk gate — ${approved} APPROVED, ${blocked} BLOCKED`, approved > 0 ? "success" : "warning");
      if (approved > 0) log(`💸 Placing ${approved} trade(s) on-chain...`, "trade");

      // ── Phase 5: Market Outlook ───────────────────────────────────────────
      setPhase("outlook");
      log("🌐 Market Intelligence Agent — news, trends & big money signals...", "system");
      updateAgent("outlook", { status: "running" });

      const tradesForOutlook = riskDecisions?.filter(r => r.APPROVED) || [];
      const outlookInput = tradesForOutlook.length ? tradesForOutlook : (riskDecisions?.slice(0, 3) || []);

      const outlookData = await callAgent("outlook", prompts.OUTLOOK,
        `Trades to analyze:\n${JSON.stringify(outlookInput)}\n\nMarket context:\n${JSON.stringify(scanData2?.slice(0, 10))}`,
        { maxTokens: 2500, maxRetries: 2, fallback: [] }
      );

      updateAgent("outlook", { status: "done", output: outlookData, stream: "" });
      const posCount = outlookData?.filter(o => o.overallOutlook === "POSITIVE").length || 0;
      const negCount = outlookData?.filter(o => o.overallOutlook === "NEGATIVE").length || 0;
      log(`🌐 Outlook complete — ${posCount} positive, ${negCount} negative external signals`, posCount > negCount ? "success" : negCount > posCount ? "warning" : "info");

      // ── Phase 6: Neural Network Analysis ─────────────────────────────────
      setPhase("neural");
      log("🧬 Neural Network running TCN analysis...", "system");
      updateAgent("neural", { status: "running" });

      const approvedForNeural = riskDecisions?.filter(r => r.APPROVED) || [];
      const neuralInputMarkets = approvedForNeural.length ? approvedForNeural : (riskDecisions?.slice(0, 5) || []);
      const neuralData = await callAgent("neural", prompts.NEURAL_NET,
        `Scan data (sample):\n${JSON.stringify(scanData2?.slice(0, 10))}\n\nPredictions:\n${JSON.stringify(predictions)}\n\nRisk decisions:\n${JSON.stringify(riskDecisions)}\n\nApproved trades to validate:\n${JSON.stringify(neuralInputMarkets)}\n\nFor each market above, run TCN analysis and return validation results.`,
        { maxTokens: 3000, maxRetries: 2, fallback: [] }
      );

      updateAgent("neural", { status: "done", output: neuralData, stream: "" });
      const confirmedCount = neuralData?.filter(n => n.neuralValidation === "CONFIRMS").length || 0;
      const overrideCount = neuralData?.filter(n => n.neuralValidation === "OVERRIDE").length || 0;
      log(`🧬 TCN analysis complete — ${confirmedCount} CONFIRMED, ${overrideCount} OVERRIDE signals`, confirmedCount > 0 ? "success" : "warning");

      // ── Phase 7: Debrief + param adjustment ───────────────────────────────
      setPhase("debrief");
      log("📊 All agents convening for post-session debrief...", "system");
      updateAgent("debrief", { status: "running" });

      const localNow = new Date();
      const localTimeStr = localNow.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
      const localTZOffset = -localNow.getTimezoneOffset() / 60;
      const tzLabel = `UTC${localTZOffset >= 0 ? "+" : ""}${localTZOffset}`;

      // Slim summaries — avoids context overflow on debrief
      const debriefPredSlim = predictions?.map(p => ({
        marketId: p.marketId, title: scanData2.find(m => String(m.id) === String(p.marketId))?.title,
        TRADEABLE: p.TRADEABLE, edge: p.edge, confidence: p.confidence, direction: p.direction,
        tradeRationale: p.tradeRationale?.slice(0, 120), keyFactors: p.keyFactors?.slice(0, 2),
      })) || [];
      const debriefRiskSlim = riskDecisions?.map(r => ({
        marketId: r.marketId, APPROVED: r.APPROVED, direction: r.direction,
        edge: r.edge, positionSizePct: r.positionSizePct, riskScore: r.riskScore,
        blockReason: r.blockReason?.slice(0, 100),
      })) || [];
      const debriefNeuralSlim = neuralData?.map(n => ({
        marketId: n.marketId, neuralConsensus: n.neuralConsensus, neuralValidation: n.neuralValidation,
        ensembleScore: n.ensembleScore, finalWeight: n.finalWeight,
        overrideReason: n.overrideReason?.slice(0, 100),
      })) || [];
      const debriefOutlookSlim = outlookData?.map(o => ({
        marketId: o.marketId, overallOutlook: o.overallOutlook, outlookScore: o.outlookScore,
        outlookSummary: o.outlookSummary?.slice(0, 100),
      })) || [];

      const debrief = await callAgent("debrief", prompts.DEBRIEF,
        `Session Summary:
- Markets scanned: ${scanData2.length} | Predictions: ${predictions?.length || 0} | Tradeable: ${tradeable}
- Risk approved: ${approved} | Blocked: ${blocked}
- Neural confirmed: ${confirmedCount} | Overrides: ${overrideCount}
- Local time: ${localTimeStr} (${tzLabel}) | Bankroll: $${bankroll}

Scanned markets (sample 4):
${JSON.stringify(scanData2.slice(0, 4).map(m => ({ id: m.id, title: m.title, category: m.category, currentOdds: m.currentOdds, flags: m.flags })))}

Predictions:
${JSON.stringify(debriefPredSlim)}

Risk decisions:
${JSON.stringify(debriefRiskSlim)}

Neural net:
${JSON.stringify(debriefNeuralSlim)}

Outlook:
${JSON.stringify(debriefOutlookSlim)}`,
        { maxTokens: 6000, maxRetries: 3, fallback: { sessionGrade: "C", whatWentWell: ["Pipeline completed successfully"], whatWentWrong: ["Debrief context may have been trimmed"], rootCauses: ["High data volume from multi-agent session"], lessonsLearned: [], nextSessionFocus: [], parameterAdjustments: {}, conclusiveSummary: "Session completed. Review individual agent outputs for details." } }
      );

      updateAgent("debrief", { status: "done", output: debrief, stream: "" });
      log(`📋 Debrief complete — Session Grade: ${debrief?.sessionGrade || "N/A"}`, "success");

      // ── Apply parameter adjustments for next cycle ─────────────────────────
      if (debrief?.parameterAdjustments && Object.keys(debrief.parameterAdjustments).length) {
        const newParams = mergeParams(sessionParams, debrief.parameterAdjustments);
        const changed = Object.entries(newParams)
          .filter(([k, v]) => sessionParams[k] !== v)
          .map(([k, v]) => `${k}: ${sessionParams[k]} → ${v}`)
          .join(", ");

        if (changed) {
          setParamHistory(prev => [...prev, { session: prev.length + 1, params: sessionParams, grade: debrief.sessionGrade }]);
          setSessionParams(newParams);
          log(`🧬 Params auto-adjusted for next cycle: ${changed}`, "system");
        }
      }

      log("✨ Full cycle complete. Agents standing by.", "system");
      setPhase("done");

    } catch (err) {
      log(`❌ Pipeline error: ${err.message}`, "error");
      // Mark any still-running agents as errored rather than leaving them spinning
      setAgentStates(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { if (next[k].status === "running") next[k] = { ...next[k], status: "idle", stream: "" }; });
        return next;
      });
      setPhase("idle");
    }
  };

  const scanData      = agentStates.scan.output;
  const researchA     = agentStates.researchA.output;
  const researchB     = agentStates.researchB.output;
  const predictions   = agentStates.prediction.output;
  const riskDecisions = agentStates.risk.output;
  const outlookData   = agentStates.outlook.output;
  const neuralData    = agentStates.neural.output;
  const debrief       = agentStates.debrief.output;
  const approvedTrades = riskDecisions?.filter(r => r.APPROVED) || [];
  const blockedTrades  = riskDecisions?.filter(r => !r.APPROVED) || [];

  const phaseClass = phase === "done" ? "done" : isRunning ? "active" : "idle";

  const logColor = t => ({
    error: "#f87171", success: "#34d399", warning: "#fbbf24",
    trade: "#a78bfa", system: "#60a5fa",
  }[t] || "#94a3b8");

  return (
    <div className="nx-root">
      {/* Floating cursor tooltip */}
      {tooltip.visible && (
        <div
          className="nx-cursor-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Mobile sidebar backdrop */}
      <div
        className={`nx-sidebar-backdrop ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Header */}
      <div className="nx-header">
        <div className="nx-logo-wrap">
          <button className="nx-pipeline-toggle" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle pipeline">
            {sidebarOpen ? "✕" : "⬡"}
          </button>
          <div className="nx-logo">⬡</div>
          <div>
            <div className="nx-title">NEXUS PRED</div>
            <div className="nx-subtitle">Multi-Agent Prediction Market Trading System</div>
          </div>
        </div>
        <div className="nx-header-right">
          {paramHistory.length > 0 && (
            <div className="nx-memory-badge" title={`${paramHistory.length} session(s) of learned data`}>
              <div className="nx-memory-dot" />
              {paramHistory.length} session{paramHistory.length > 1 ? "s" : ""} learned
            </div>
          )}
          <div className="nx-bankroll-box">
            <div className="nx-bankroll-label">BANKROLL</div>
            <input
              className="nx-bankroll-input"
              type="number"
              value={bankroll}
              onChange={e => setBankroll(Number(e.target.value))}
              disabled={isRunning}
            />
          </div>
          <div className={`nx-phase-badge ${phaseClass}`}>
            {phase.toUpperCase()}
          </div>
          {(phase === "done") && (
            <button
              className="nx-run-btn"
              style={{ marginTop: 0, padding: "5px 12px", fontSize: 10, letterSpacing: "0.08em" }}
              onClick={() => generatePDF({ sessionParams, bankroll, agentStates, logs, paramHistory, outlookData })}
            >
              ↓ PDF
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="nx-tabs">
        {[
          { id: "dashboard", label: "⬡ Dashboard" },
          { id: "markets",   label: "📊 Markets" },
          { id: "trades",    label: "💸 Trades" },
          { id: "neural",    label: "🧬 Neural Net" },
          { id: "debrief",   label: "📋 Debrief" },
        ].map(t => (
          <button
            key={t.id}
            className={`nx-tab ${activeTab === t.id ? "active" : ""}`}
            onClick={() => { setActiveTab(t.id); setSidebarOpen(false); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="nx-body">
        {/* Pipeline Sidebar */}
        <div className={`nx-pipeline ${sidebarOpen ? "open" : ""}`}>
          <div className="nx-pipeline-title">AGENT PIPELINE</div>

          {[
            { key: "scan",       icon: "🔍", name: "Scan Agent",       desc: "1000+ sources · All asset classes · 5 parallel batches" },
            { key: "researchA",  icon: "🐦", name: "Research α",       desc: "Twitter · Reddit · Sentiment NLP",  indent: true },
            { key: "researchB",  icon: "📰", name: "Research β",       desc: "RSS · News · Fundamentals",         indent: true },
            { key: "prediction", icon: "🧠", name: "Prediction Agent", desc: "XGBoost + LLM · Edge calc" },
            { key: "risk",       icon: "🛡️", name: "Risk Agent",       desc: "Kelly sizing · Risk gates" },
            { key: "outlook",    icon: "🌐", name: "Outlook Agent",    desc: "News · Trends · Big money signals" },
            { key: "neural",     icon: "🧬", name: "Neural Net Agent", desc: "TCN · Sigmoid calibration · Volatility scaled risk map" },
            { key: "debrief",    icon: "📋", name: "Debrief Agent",    desc: "Meta-learning · Param tuning" },
          ].map((agent, i, arr) => {
            const st = agentStates[agent.key];
            return (
              <div key={agent.key}>
                {agent.key === "researchA" && <div className="nx-parallel-label">▶ PARALLEL</div>}
                <div className={`nx-agent-card ${st.status} ${agent.indent ? "indented" : ""}`}>
                  <div className="nx-agent-header">
                    <span className="nx-agent-icon">{agent.icon}</span>
                    <div className="nx-agent-info">
                      <div className="nx-agent-name">{agent.name}</div>
                      <div className="nx-agent-desc">{agent.desc}</div>
                    </div>
                    <div className={`nx-status-dot ${st.status}`}>
                      {st.status === "running" && <div className="nx-pulse-ring" />}
                    </div>
                  </div>
                  {st.status === "running" && st.stream && (
                    <div className="nx-stream-box">
                      <div className="nx-stream-text">{st.stream.slice(-220)}</div>
                    </div>
                  )}
                  {st.status === "done" && st.output && (
                    <div className="nx-agent-summary">
                      {agent.key === "scan"       && `${st.output.length} markets · ${st.output.filter(m => m.flags?.length > 0).length} flagged`}
                      {agent.key === "researchA"  && `${st.output?.length || 0} sentiment analyses`}
                      {agent.key === "researchB"  && `${st.output?.length || 0} fundamental analyses`}
                      {agent.key === "prediction" && `${st.output?.filter(p => p.TRADEABLE)?.length || 0} / ${st.output?.length || 0} tradeable`}
                      {agent.key === "risk"       && `${st.output?.filter(r => r.APPROVED)?.length || 0} approved · ${st.output?.filter(r => !r.APPROVED)?.length || 0} blocked`}
                      {agent.key === "outlook"    && (() => { const pos = st.output?.filter(o => o.overallOutlook === "POSITIVE").length || 0; const neg = st.output?.filter(o => o.overallOutlook === "NEGATIVE").length || 0; return `${pos} positive · ${neg} negative`; })()}
                      {agent.key === "neural"     && (() => { const conf = st.output?.filter(n => n.neuralValidation === "CONFIRMS").length || 0; const ovr = st.output?.filter(n => n.neuralValidation === "OVERRIDE").length || 0; return `${conf} confirmed · ${ovr} override`; })()}
                      {agent.key === "debrief"    && `Grade: ${st.output?.sessionGrade || "—"}`}
                    </div>
                  )}
                </div>
                {agent.key === "researchB" && <div className="nx-parallel-label">◀ END PARALLEL</div>}
                {i < arr.length - 1 && agent.key !== "researchA" && <div className="nx-connector" />}
              </div>
            );
          })}

          <button
            onClick={runFullCycle}
            disabled={isRunning}
            className="nx-run-btn"
          >
            {isRunning ? `⟳ ${phase.toUpperCase()}...` : "▶ RUN FULL CYCLE"}
          </button>

          {/* Active session params */}
          {(paramHistory.length > 0 || sessionParams.edgeThreshold !== DEFAULT_PARAMS.edgeThreshold) && (
            <div className="nx-params-badge">
              <div className="nx-params-badge-title">⚙ ACTIVE PARAMS</div>
              edge ≥ {(sessionParams.edgeThreshold * 100).toFixed(1)}% · conf ≥ {(sessionParams.confidenceThreshold * 100).toFixed(0)}%<br />
              kelly ≤ {(sessionParams.kellyCap * 100).toFixed(0)}% · dd ≤ {(sessionParams.dailyDrawdownLimit * 100).toFixed(0)}%
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="nx-main">

          {/* ── Dashboard Tab ── */}
          {activeTab === "dashboard" && (
            <div>
              <div className="nx-stats-row">
                {[
                  { label: "Markets Scanned", val: scanData?.length || "—",                                         color: "#60a5fa", tooltip: "Total markets filtered from 1000+ sources across crypto, equities, M&A, commodities, macro, and more." },
                  { label: "Flagged",          val: scanData?.filter(m => m.flags?.length > 0)?.length || "—",      color: "#fbbf24", tooltip: "Markets with anomalies detected — wide spreads, unusual price swings, or sudden volume spikes worth monitoring." },
                  { label: "Trade Signals",    val: predictions?.filter(p => p.TRADEABLE)?.length || "—",           color: "#a78bfa", tooltip: "Opportunities where the Prediction Agent found an edge above the threshold and confidence high enough to act on." },
                  { label: "Approved",         val: approvedTrades.length || "—",                                   color: "#34d399", tooltip: "Trades cleared by the Risk Agent — position size within Kelly cap and daily drawdown limits." },
                  { label: "Blocked",          val: blockedTrades.length || "—",                                    color: "#f87171", tooltip: "Trade signals rejected by the Risk Agent for exceeding position size limits, drawdown cap, or insufficient edge." },
                  { label: "Neural Confirmed", val: neuralData?.filter(n => n.neuralValidation === "CONFIRMS").length ?? "—", color: "#a78bfa", tooltip: "Trades where the Neural Net TCN analysis agreed with the Risk Agent's approval decision." },
                ].map(s => (
                  <div
                    key={s.label}
                    className="nx-stat-card"
                    onMouseEnter={e => showTooltip(s.tooltip, e.clientX, e.clientY)}
                    onMouseMove={e => moveTooltip(e.clientX, e.clientY)}
                    onMouseLeave={hideTooltip}
                    onTouchStart={e => { const t = e.touches[0]; showTooltip(s.tooltip, t.clientX, t.clientY); }}
                    onTouchEnd={hideTooltip}
                  >
                    <div className="nx-stat-val" style={{ color: s.color }}>{s.val}</div>
                    <div className="nx-stat-label">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="nx-console">
                <div className="nx-console-title">
                  <div className="nx-console-dot" />
                  LIVE LOG
                </div>
                <div className="nx-console-body">
                  {logs.length === 0 && <div className="nx-console-placeholder">Awaiting cycle start...</div>}
                  {logs.map((l, i) => (
                    <div key={i} className="nx-log-line" style={{ color: logColor(l.type) }}>
                      <span className="nx-log-time">{l.time}</span>{l.msg}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>

              {approvedTrades.length > 0 && (
                <div>
                  <div className="nx-section-title">💸 APPROVED TRADES</div>
                  {approvedTrades.map((t, i) => {
                    const outlook = outlookData?.find(o => String(o.marketId) === String(t.marketId));
                    const outlookColor = outlook?.overallOutlook === "POSITIVE" ? "#34d399" : outlook?.overallOutlook === "NEGATIVE" ? "#f87171" : "#fbbf24";
                    return (
                    <div key={i} className="nx-trade-card">
                      <div className="nx-trade-header">
                        <span style={{ color: "#34d399", fontWeight: 700 }}>✓ APPROVED</span>
                        <span style={{ color: "#a78bfa" }}>{getMarketName(t.marketId, scanData)}</span>
                        <span style={{ color: "#fbbf24" }}>{t.direction}</span>
                        {outlook && (
                          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: outlookColor, background: `${outlookColor}18`, padding: "2px 8px", borderRadius: 4, border: `1px solid ${outlookColor}33` }}>
                            {outlook.overallOutlook === "POSITIVE" ? "▲" : outlook.overallOutlook === "NEGATIVE" ? "▼" : "●"} {outlook.overallOutlook}
                          </span>
                        )}
                      </div>
                      <div className="nx-trade-details">
                        <span>Edge: <b style={{ color: "#34d399" }}>{((t.edge || 0) * 100).toFixed(1)}%</b></span>
                        <span>Size: <b style={{ color: "#60a5fa" }}>${t.positionSize?.toFixed(0)}</b></span>
                        <span>Bankroll: <b style={{ color: "#fbbf24" }}>{t.positionSizePct?.toFixed(1)}%</b></span>
                        {t.onChainTxHash && <span style={{ color: "#64748b", fontSize: 11 }}>tx: {t.onChainTxHash}</span>}
                      </div>
                      {outlook?.outlookSummary && (
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6, lineHeight: 1.5, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6 }}>
                          {outlook.outlookSummary}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Markets Tab ── */}
          {activeTab === "markets" && (
            <div>
              <div className="nx-section-title">📊 SCANNED MARKETS</div>
              {!scanData && <div className="nx-empty-state">Run a cycle to see market data</div>}
              {scanData?.map((m, i) => (
                <div
                  key={i}
                  onClick={() => setSelectedMarket(selectedMarket?.id === m.id ? null : m)}
                  className={`nx-market-card ${selectedMarket?.id === m.id ? "selected" : ""}`}
                >
                  <div className="nx-market-row">
                    <div className="nx-market-title">{m.title}</div>
                    <div
                      className="nx-odds-chip"
                      style={{
                        background: m.currentOdds > 0.6 ? "rgba(52,211,153,0.15)"
                          : m.currentOdds < 0.4 ? "rgba(248,113,113,0.15)"
                          : "rgba(96,165,250,0.15)"
                      }}
                    >
                      {((m.currentOdds || 0) * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="nx-market-meta">
                    <span>Vol: ${(m.volume || 0).toLocaleString()}</span>
                    <span>{m.daysToResolution}d to resolve</span>
                    <span>Spread: {m.spreadPct?.toFixed(1)}%</span>
                    {m.flags?.map((f, fi) => <span key={fi} className="nx-flag">{f}</span>)}
                  </div>
                  {selectedMarket?.id === m.id && (
                    <div className="nx-market-expanded">
                      {predictions?.find(p => p.marketId === m.id) && (() => {
                        const pred = predictions.find(p => p.marketId === m.id);
                        return (
                          <div>
                            <b style={{ color: "#a78bfa" }}>Prediction:</b> True prob {((pred.trueProbability || 0) * 100).toFixed(1)}% · Edge {((pred.edge || 0) * 100).toFixed(1)}%
                            {pred.TRADEABLE && <span style={{ color: "#34d399", marginLeft: 8 }}>● TRADEABLE</span>}
                          </div>
                        );
                      })()}
                      <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
                        Liquidity Score: {m.liquidityScore} · {m.recommendation}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Trades Tab ── */}
          {activeTab === "trades" && (
            <div>
              {/* ── Neural Net Results ── */}
              {neuralData?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div className="nx-section-title">🧬 NEURAL NET ANALYSIS</div>
                  {neuralData.map((n, i) => {
                    const riskMatch = riskDecisions?.find(r => String(r.marketId) === String(n.marketId));
                    const consensusColor = n.neuralConsensus === "BUY" ? "#34d399" : n.neuralConsensus === "SELL" ? "#f87171" : "#fbbf24";
                    const validationColor = n.neuralValidation === "CONFIRMS" ? "#34d399" : n.neuralValidation === "OVERRIDE" ? "#f87171" : "#94a3b8";
                    const rawSig = n.rawSignal ?? 0;
                    const signalPct = (rawSig + 1) / 2 * 100;
                    const finalW = n.finalWeight ?? 0;
                    const weightPct = (finalW + 1) / 2 * 100;
                    const ensScore = n.ensembleScore ?? 0;
                    const ensemblePct = (ensScore + 1) / 2 * 100;
                    return (
                      <div key={i} className="nx-risk-card" style={{ borderColor: `${consensusColor}33` }}>
                        {/* Header */}
                        <div className="nx-risk-header">
                          <span style={{ color: "#a78bfa", fontWeight: 800, fontSize: 13 }}>🧬 {getMarketName(n.marketId, scanData)}</span>
                          <span style={{ background: `${consensusColor}22`, color: consensusColor, border: `1px solid ${consensusColor}44`, padding: "2px 10px", borderRadius: 4, fontWeight: 700, fontSize: 12 }}>
                            {n.neuralConsensus}
                          </span>
                          <span style={{ background: `${validationColor}22`, color: validationColor, border: `1px solid ${validationColor}44`, padding: "2px 10px", borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
                            {n.neuralValidation === "CONFIRMS" ? "✓ CONFIRMS" : n.neuralValidation === "OVERRIDE" ? "⚡ OVERRIDE" : "● NEUTRAL"}
                          </span>
                          {riskMatch && (
                            <span style={{ color: "#64748b", fontSize: 11 }}>vs Risk: {riskMatch.APPROVED ? "APPROVED" : "BLOCKED"}</span>
                          )}
                        </div>

                        {/* Formula 1 — Calibrated Sigmoid Head */}
                        <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(167,139,250,0.06)", borderRadius: 6, border: "1px solid rgba(167,139,250,0.12)" }}>
                          <div style={{ fontSize: 10, color: "#a78bfa", fontWeight: 700, marginBottom: 6, letterSpacing: "0.08em" }}>FORMULA 1 — p̂_t+1 = σ(w⊤ TCN(X^(t)) + b)</div>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                            <div><div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{(n.dotScore ?? 0).toFixed(4)}</div><div style={{ fontSize: 10, color: "#64748b" }}>dot score</div></div>
                            <div><div style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa" }}>{((n.calibratedProb ?? 0) * 100).toFixed(1)}%</div><div style={{ fontSize: 10, color: "#64748b" }}>calibrated prob</div></div>
                            <div><div style={{ fontSize: 13, fontWeight: 700, color: `${rawSig >= 0 ? "#34d399" : "#f87171"}` }}>{rawSig >= 0 ? "+" : ""}{rawSig.toFixed(3)}</div><div style={{ fontSize: 10, color: "#64748b" }}>raw signal</div></div>
                            <div><div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>{((n.tcnConfidence ?? 0) * 100).toFixed(0)}%</div><div style={{ fontSize: 10, color: "#64748b" }}>TCN confidence</div></div>
                          </div>
                          {/* Raw signal bar */}
                          <div style={{ marginTop: 8 }}>
                            <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, position: "relative", overflow: "hidden" }}>
                              <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.12)" }} />
                              <div style={{ position: "absolute", height: "100%", borderRadius: 3, background: rawSig >= 0 ? "#34d399" : "#f87171", left: rawSig >= 0 ? "50%" : `${signalPct}%`, width: `${Math.abs(signalPct - 50)}%` }} />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#334155", marginTop: 1 }}><span>-1.0</span><span>0</span><span>+1.0</span></div>
                          </div>
                        </div>

                        {/* Formula 2 — Volatility-Scaled Risk Map */}
                        <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(96,165,250,0.06)", borderRadius: 6, border: "1px solid rgba(96,165,250,0.12)" }}>
                          <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginBottom: 6, letterSpacing: "0.08em" }}>FORMULA 2 — w_t+1 = clip((σ* / σ̂) × g_τ(2p̂−1), −1, +1)</div>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                            <div><div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{(n.targetVol ?? 0.01).toFixed(3)}</div><div style={{ fontSize: 10, color: "#64748b" }}>σ* target vol</div></div>
                            <div><div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24" }}>{(n.estimatedVol ?? 0).toFixed(3)}</div><div style={{ fontSize: 10, color: "#64748b" }}>σ̂ est. vol</div></div>
                            <div><div style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa" }}>{(n.volScalingFactor ?? 0).toFixed(3)}×</div><div style={{ fontSize: 10, color: "#64748b" }}>vol scale</div></div>
                            <div><div style={{ fontSize: 12, fontWeight: 700, color: n.deadbandApplied ? "#f87171" : "#34d399" }}>{n.deadbandApplied ? "YES" : "NO"}</div><div style={{ fontSize: 10, color: "#64748b" }}>deadband hit</div></div>
                            <div><div style={{ fontSize: 12, fontWeight: 700, color: (n.rawSignalBeforeClip ?? 0) >= 0 ? "#34d399" : "#f87171" }}>{(n.rawSignalBeforeClip ?? 0) >= 0 ? "+" : ""}{(n.rawSignalBeforeClip ?? 0).toFixed(4)}</div><div style={{ fontSize: 10, color: "#64748b" }}>pre-clip</div></div>
                            <div><div style={{ fontSize: 13, fontWeight: 800, color: finalW > 0.05 ? "#34d399" : finalW < -0.05 ? "#f87171" : "#fbbf24" }}>{finalW >= 0 ? "+" : ""}{finalW.toFixed(4)}</div><div style={{ fontSize: 10, color: "#64748b" }}>final weight</div></div>
                          </div>
                          {/* Final weight bar */}
                          <div style={{ marginTop: 8 }}>
                            <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, position: "relative", overflow: "hidden" }}>
                              <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.12)" }} />
                              <div style={{ position: "absolute", height: "100%", borderRadius: 3, background: finalW >= 0 ? "#34d399" : "#f87171", left: finalW >= 0 ? "50%" : `${weightPct}%`, width: `${Math.abs(weightPct - 50)}%` }} />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#334155", marginTop: 1 }}><span>-1.0</span><span>0</span><span>+1.0</span></div>
                          </div>
                        </div>

                        {/* Formula 3 — Sharpe-Weighted Ensemble */}
                        {n.weightBreakdown && (
                          <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(52,211,153,0.05)", borderRadius: 6, border: "1px solid rgba(52,211,153,0.12)" }}>
                            <div style={{ fontSize: 10, color: "#34d399", fontWeight: 700, marginBottom: 6, letterSpacing: "0.08em" }}>
                              FORMULA 3 — Ensemble Score: <span style={{ color: ensScore >= 0 ? "#34d399" : "#f87171" }}>{ensScore >= 0 ? "+" : ""}{ensScore.toFixed(3)}</span>
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {[
                                { key: "scan",          label: "Scan×0.15",     w: 0.15 },
                                { key: "sentiment",     label: "Sent×0.20",     w: 0.20 },
                                { key: "fundamentals",  label: "Fund×0.20",     w: 0.20 },
                                { key: "edge",          label: "Edge×0.25",     w: 0.25 },
                                { key: "neural",        label: "Neural×0.20",   w: 0.20 },
                              ].map(({ key, label }) => {
                                const v = n.weightBreakdown[key] ?? 0;
                                return (
                                  <div key={key} style={{ textAlign: "center", minWidth: 52 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: v >= 0 ? "#34d399" : "#f87171" }}>{v >= 0 ? "+" : ""}{v.toFixed(2)}</div>
                                    <div style={{ fontSize: 9, color: "#64748b" }}>{label}</div>
                                  </div>
                                );
                              })}
                            </div>
                            {/* Ensemble bar */}
                            <div style={{ marginTop: 6 }}>
                              <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, position: "relative", overflow: "hidden" }}>
                                <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.10)" }} />
                                <div style={{ position: "absolute", height: "100%", borderRadius: 2, background: ensScore >= 0 ? "#34d399" : "#f87171", left: ensScore >= 0 ? "50%" : `${ensemblePct}%`, width: `${Math.abs(ensemblePct - 50)}%` }} />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Formula 4 — Kelly Criterion */}
                        <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(251,191,36,0.05)", borderRadius: 6, border: "1px solid rgba(251,191,36,0.12)" }}>
                          <div style={{ fontSize: 10, color: "#fbbf24", fontWeight: 700, marginBottom: 6, letterSpacing: "0.08em" }}>FORMULA 4 — f* = (p̂×b − (1−p̂)) / b  ·  adjustedBet = 0.5×f*×|w|</div>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                            <div><div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{(n.oddsDecimal ?? 0).toFixed(3)}</div><div style={{ fontSize: 10, color: "#64748b" }}>decimal odds</div></div>
                            <div><div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>{((n.kellyFull ?? 0) * 100).toFixed(2)}%</div><div style={{ fontSize: 10, color: "#64748b" }}>Kelly full f*</div></div>
                            <div><div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24" }}>{((n.kellyHalf ?? 0) * 100).toFixed(2)}%</div><div style={{ fontSize: 10, color: "#64748b" }}>half-Kelly</div></div>
                            <div><div style={{ fontSize: 13, fontWeight: 800, color: "#34d399" }}>{((n.adjustedBet ?? 0) * 100).toFixed(2)}%</div><div style={{ fontSize: 10, color: "#64748b" }}>adjusted bet</div></div>
                          </div>
                        </div>

                        {/* Override reason */}
                        {n.neuralValidation === "OVERRIDE" && n.overrideReason && (
                          <div style={{ marginTop: 8, padding: "7px 10px", background: "rgba(248,113,113,0.08)", borderRadius: 5, border: "1px solid rgba(248,113,113,0.2)", fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>
                            <span style={{ fontWeight: 700 }}>⚡ {n.overrideFormula || "Override"}: </span>{n.overrideReason}
                          </div>
                        )}

                        {/* Feature importance */}
                        {n.featureImportance && Object.keys(n.featureImportance).length > 0 && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 5, letterSpacing: "0.06em" }}>TCN FEATURE IMPORTANCE</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {Object.entries(n.featureImportance).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([feat, imp]) => (
                                <div key={feat} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, background: "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
                                  {feat} <span style={{ color: "#60a5fa" }}>{((imp ?? 0) * 100).toFixed(0)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* TCN reasoning */}
                        {n.tcnReasoning && (
                          <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8", paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)", lineHeight: 1.5 }}>
                            {n.tcnReasoning}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="nx-section-title">🛡️ RISK DECISIONS</div>
              {!riskDecisions && <div className="nx-empty-state">Run a cycle to see trade decisions</div>}
              {riskDecisions?.map((t, i) => {
                const outlook = outlookData?.find(o => String(o.marketId) === String(t.marketId));
                const outlookColor = outlook?.overallOutlook === "POSITIVE" ? "#34d399" : outlook?.overallOutlook === "NEGATIVE" ? "#f87171" : "#fbbf24";
                const pred = predictions?.find(p => String(p.marketId) === String(t.marketId));
                const sentFactors = researchA?.find(r => String(r.marketId) === String(t.marketId))?.keyFactors || [];
                const fundFactors = researchB?.find(r => String(r.marketId) === String(t.marketId))?.keyFactors || [];
                const allKeyFactors = [...(pred?.keyFactors || []), ...sentFactors, ...fundFactors].filter(Boolean);
                return (
                  <div key={i} className={`nx-risk-card ${t.APPROVED ? "approved" : "blocked"}`}>
                    <div className="nx-risk-header">
                      <span style={{ color: t.APPROVED ? "#34d399" : "#f87171", fontWeight: 800, fontSize: 13 }}>
                        {t.APPROVED ? "✓ APPROVED" : "✗ BLOCKED"}
                      </span>
                      <span style={{ color: "#94a3b8" }}>{getMarketName(t.marketId, scanData)}</span>
                      <span style={{ color: "#fbbf24", fontWeight: 700 }}>{t.direction}</span>
                    </div>
                    <div className="nx-risk-grid">
                      {[
                        { val: `${((t.edge || 0) * 100).toFixed(1)}%`, label: "Edge" },
                        { val: `$${(t.positionSize || 0).toFixed(0)}`, label: "Position" },
                        { val: `${(t.positionSizePct || 0).toFixed(1)}%`, label: "Of Bankroll" },
                        {
                          val: `${t.riskScore}/10`,
                          label: "Risk Score",
                          color: t.riskScore > 6 ? "#f87171" : t.riskScore > 3 ? "#fbbf24" : "#34d399"
                        },
                      ].map((s, si) => (
                        <div key={si} className="nx-risk-stat">
                          <div className="nx-risk-stat-val" style={s.color ? { color: s.color } : {}}>{s.val}</div>
                          <div className="nx-risk-stat-label">{s.label}</div>
                        </div>
                      ))}
                    </div>
                    {t.blockReason && <div className="nx-block-reason">⛔ {t.blockReason}</div>}
                    {t.APPROVED && t.onChainTxHash && <div className="nx-tx-hash">🔗 tx: {t.onChainTxHash}</div>}
                    {t.settlementWatcher && (
                      <div className="nx-watcher">👁️ {JSON.stringify(t.settlementWatcher).slice(0, 80)}...</div>
                    )}

                    {/* ── Key Factors ──────────────────────────────────── */}
                    {(allKeyFactors.length > 0 || pred?.tradeRationale || pred?.risks?.length > 0) && (
                      <div className="nx-keyfactors-panel">
                        <div className="nx-keyfactors-title">🔑 Key Factors</div>
                        {allKeyFactors.length > 0 && (
                          <div className="nx-keyfactors-list">
                            {allKeyFactors.map((f, fi) => (
                              <div key={fi} className="nx-keyfactor-item">
                                <span className="nx-keyfactor-dot">◆</span>
                                <span>{f}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {pred?.tradeRationale && (
                          <div className="nx-trade-rationale">
                            <span className="nx-rationale-label">Trade Rationale — </span>
                            {pred.tradeRationale}
                          </div>
                        )}
                        {pred?.risks?.length > 0 && (
                          <div className="nx-trade-risks">
                            <div className="nx-risks-label">⚠ Specific Risks</div>
                            {pred.risks.map((r, ri) => (
                              <div key={ri} className="nx-trade-risk-item">• {r}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {outlook && (
                      <div className="nx-outlook-panel">
                        <div className="nx-outlook-header">
                          <span className="nx-outlook-badge" style={{ background: `${outlookColor}22`, color: outlookColor, border: `1px solid ${outlookColor}44` }}>
                            {outlook.overallOutlook === "POSITIVE" ? "▲" : outlook.overallOutlook === "NEGATIVE" ? "▼" : "●"} {outlook.overallOutlook}
                          </span>
                          <span className="nx-outlook-score" style={{ color: outlookColor }}>
                            Score: {outlook.outlookScore > 0 ? "+" : ""}{outlook.outlookScore}/10
                          </span>
                          {outlook.marketTrend && (
                            <span className="nx-outlook-trend">📈 {outlook.marketTrend}</span>
                          )}
                        </div>
                        {outlook.outlookSummary && (
                          <div className="nx-outlook-summary">{outlook.outlookSummary}</div>
                        )}
                        {outlook.bigMoneySignal && (
                          <div className="nx-outlook-bigmoney">💰 {outlook.bigMoneySignal}</div>
                        )}
                        {outlook.recentNews?.length > 0 && (
                          <div className="nx-outlook-news">
                            {outlook.recentNews.map((n, ni) => (
                              <div key={ni} className="nx-outlook-news-item">
                                <span className="nx-news-dot" style={{ color: n.sentiment === "bullish" ? "#34d399" : n.sentiment === "bearish" ? "#f87171" : "#94a3b8" }}>●</span>
                                <span>{n.headline}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Neural Net Tab ── */}
          {activeTab === "neural" && (
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", gap: 16 }}>
              <div className="nx-section-title" style={{ marginBottom: 0 }}>🧬 TCN NEURAL NETWORK — LIVE INFERENCE GRAPH</div>
              {!neuralData && (
                <div className="nx-empty-state" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  Run a cycle to activate the neural network visualisation
                </div>
              )}
              {/* 3D canvas visualization */}
              <div style={{ flex: 1, minHeight: 0, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(167,139,250,0.2)", background: "#05050a", position: "relative" }}>
                <NeuralNetViz neuralData={neuralData} scanData={scanData} />
                {/* Legend overlay */}
                <div style={{ position: "absolute", top: 10, right: 10, display: "flex", flexDirection: "column", gap: 4, background: "rgba(5,5,10,0.85)", padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.07)", fontSize: 10 }}>
                  {[["#60a5fa","Input features"],["#a78bfa","TCN hidden layers"],["#34d399","BUY output"],["#f87171","SELL output"],["#fbbf24","HOLD output"]].map(([c, l]) => (
                    <div key={l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />
                      <span style={{ color: "#94a3b8" }}>{l}</span>
                    </div>
                  ))}
                </div>
                {/* Architecture label */}
                <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(5,5,10,0.85)", padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(167,139,250,0.2)", fontSize: 10, color: "#a78bfa" }}>
                  TCN · 64×12 Feature Window · Sigmoid Head · Deadband Vol-Scaled Risk Map
                </div>
              </div>
              {/* Summary cards below the viz */}
              {neuralData?.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10, paddingBottom: 16 }}>
                  {neuralData.map((n, i) => {
                    const col = n.neuralConsensus === "BUY" ? "#34d399" : n.neuralConsensus === "SELL" ? "#f87171" : "#fbbf24";
                    const vcol = n.neuralValidation === "CONFIRMS" ? "#34d399" : n.neuralValidation === "OVERRIDE" ? "#f87171" : "#94a3b8";
                    return (
                      <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${col}33`, borderRadius: 8, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: col, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {getMarketName(n.marketId, scanData)}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: col + "22", color: col, border: `1px solid ${col}44`, fontWeight: 700 }}>{n.neuralConsensus}</span>
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: vcol + "22", color: vcol, border: `1px solid ${vcol}44` }}>{n.neuralValidation}</span>
                        </div>
                        <div style={{ fontSize: 10, color: "#64748b", display: "flex", flexDirection: "column", gap: 2 }}>
                          <span>Ensemble: <b style={{ color: (n.ensembleScore ?? 0) >= 0 ? "#34d399" : "#f87171" }}>{(n.ensembleScore ?? 0) >= 0 ? "+" : ""}{(n.ensembleScore ?? 0).toFixed(3)}</b></span>
                          <span>Weight: <b style={{ color: col }}>{(n.finalWeight ?? 0) >= 0 ? "+" : ""}{(n.finalWeight ?? 0).toFixed(4)}</b></span>
                          <span>Kelly adj: <b style={{ color: "#fbbf24" }}>{((n.adjustedBet ?? 0) * 100).toFixed(2)}%</b></span>
                          <span>Conf: <b style={{ color: "#a78bfa" }}>{((n.tcnConfidence ?? 0) * 100).toFixed(0)}%</b></span>
                        </div>
                        {n.neuralValidation === "OVERRIDE" && n.overrideReason && (
                          <div style={{ marginTop: 6, fontSize: 10, color: "#f87171", lineHeight: 1.4, borderTop: "1px solid rgba(248,113,113,0.15)", paddingTop: 5 }}>
                            ⚡ {n.overrideReason.slice(0, 80)}{n.overrideReason.length > 80 ? "…" : ""}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Debrief Tab ── */}
          {activeTab === "debrief" && (
            <div>
              <div className="nx-section-title">📋 SESSION DEBRIEF</div>
              {!debrief && <div className="nx-empty-state">Run a cycle to see the debrief analysis</div>}
              {debrief && (
                <div>
                  {debrief.conclusiveSummary && (
                    <div className="nx-conclusive-summary">
                      <div className="nx-conclusive-title">📊 Session Intelligence Summary</div>
                      <div className="nx-conclusive-body">{debrief.conclusiveSummary}</div>
                    </div>
                  )}

                  <div className="nx-grade-card">
                    <div className="nx-grade">{debrief.sessionGrade}</div>
                    <div className="nx-grade-label">SESSION GRADE</div>
                  </div>

                  <button
                    className="nx-run-btn"
                    style={{ width: "100%", marginBottom: 16, marginTop: 0 }}
                    onClick={() => generatePDF({ sessionParams, bankroll, agentStates, logs, paramHistory, outlookData })}
                  >
                    ↓ Download Full PDF Report
                  </button>

                  <div className="nx-debrief-grid">
                    <div className="nx-debrief-section">
                      <div className="nx-debrief-heading" style={{ color: "#34d399" }}>✓ What Went Well</div>
                      {debrief.whatWentWell?.map((w, i) => <div key={i} className="nx-debrief-item">• {w}</div>)}
                    </div>
                    <div className="nx-debrief-section">
                      <div className="nx-debrief-heading" style={{ color: "#f87171" }}>✗ What Went Wrong</div>
                      {debrief.whatWentWrong?.map((w, i) => <div key={i} className="nx-debrief-item">• {w}</div>)}
                    </div>
                  </div>

                  {debrief.rootCauses?.length > 0 && (
                    <div className="nx-debrief-card">
                      <div className="nx-debrief-heading" style={{ color: "#fbbf24" }}>⚠ Root Causes</div>
                      {debrief.rootCauses.map((r, i) => <div key={i} className="nx-debrief-item">• {r}</div>)}
                    </div>
                  )}

                  {debrief.parameterAdjustments && (
                    <div className="nx-debrief-card">
                      <div className="nx-debrief-heading" style={{ color: "#60a5fa" }}>🧬 Parameter Adjustments Applied</div>
                      {Object.entries(debrief.parameterAdjustments).map(([k, v]) => (
                        <div key={k} className="nx-agent-perf">
                          <span style={{ color: "#e2e8f0" }}>{k}</span>
                          <span style={{ color: "#60a5fa" }}>
                            {sessionParams[k] !== undefined
                              ? `${sessionParams[k]} → ${v}`
                              : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {debrief.lessonsLearned?.length > 0 && (
                    <div className="nx-debrief-card">
                      <div className="nx-debrief-heading" style={{ color: "#a78bfa" }}>💡 Lessons Learned</div>
                      {debrief.lessonsLearned.map((l, i) => <div key={i} className="nx-debrief-item">• {l}</div>)}
                    </div>
                  )}

                  {debrief.nextSessionFocus?.length > 0 && (
                    <div className="nx-debrief-card">
                      <div className="nx-debrief-heading" style={{ color: "#60a5fa" }}>🎯 Next Session Focus</div>
                      {debrief.nextSessionFocus.map((n, i) => <div key={i} className="nx-debrief-item">• {n}</div>)}
                    </div>
                  )}

                  {debrief.agentPerformance && (
                    <div className="nx-debrief-card">
                      <div className="nx-debrief-heading" style={{ color: "#94a3b8" }}>🤖 Agent Performance</div>
                      {Object.entries(debrief.agentPerformance).map(([k, v]) => (
                        <div key={k} className="nx-agent-perf">
                          <span style={{ color: "#e2e8f0", textTransform: "capitalize" }}>{k}</span>
                          <span style={{ color: "#94a3b8" }}>{typeof v === "object" ? JSON.stringify(v) : v}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {debrief.optimalTimingWindows?.length > 0 && (
                    <div className="nx-debrief-card">
                      <div className="nx-debrief-heading" style={{ color: "#34d399" }}>🕐 Optimal Investment Timing (Local Time)</div>
                      {debrief.optimalTimingWindows.map((w, i) => (
                        <div key={i} className="nx-timing-row">
                          <div className="nx-timing-window">
                            <span className="nx-timing-label">{w.label}</span>
                            <span className="nx-timing-range">{w.startTime} – {w.endTime}</span>
                          </div>
                          <div className="nx-timing-reason">{w.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {debrief.minimumInvestmentSizing?.length > 0 && (
                    <div className="nx-debrief-card">
                      <div className="nx-debrief-heading" style={{ color: "#fbbf24" }}>💵 Minimum Investment for Maximum Profitability</div>
                      {debrief.minimumInvestmentSizing.map((s, i) => (
                        <div key={i} className="nx-sizing-row">
                          <div className="nx-sizing-top">
                            <span className="nx-sizing-category">{s.category}</span>
                            <span className="nx-sizing-amount">${(s.minInvestmentUSD || 0).toLocaleString()}</span>
                            <span className="nx-sizing-return" style={{ color: (s.expectedReturnPct || 0) >= 0 ? "#34d399" : "#f87171" }}>
                              {(s.expectedReturnPct || 0) >= 0 ? "+" : ""}{s.expectedReturnPct?.toFixed(1)}% expected
                            </span>
                          </div>
                          <div className="nx-sizing-rationale">{s.rationale}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {debrief.actionRiskRegister?.length > 0 && (
                    <div className="nx-debrief-card">
                      <div className="nx-debrief-heading" style={{ color: "#f87171" }}>⚠ Action Risk Register</div>
                      {debrief.actionRiskRegister.map((r, i) => {
                        const sevColor = { LOW: "#34d399", MEDIUM: "#fbbf24", HIGH: "#f97316", CRITICAL: "#f87171" }[r.severity] || "#94a3b8";
                        return (
                          <div key={i} className="nx-risk-reg-row">
                            <div className="nx-risk-reg-top">
                              <span className="nx-risk-reg-badge" style={{ color: sevColor, border: `1px solid ${sevColor}44`, background: `${sevColor}11` }}>{r.severity}</span>
                              <span className="nx-risk-reg-market">{getMarketName(r.marketId, scanData)}</span>
                              <span className="nx-risk-reg-type">{r.riskType}</span>
                            </div>
                            <div className="nx-risk-reg-desc">{r.description}</div>
                            <div className="nx-risk-reg-mit">Mitigation: {r.mitigation}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {paramHistory.length > 0 && (
                    <div className="nx-debrief-card">
                      <div className="nx-debrief-heading" style={{ color: "#34d399" }}>📈 Session History</div>
                      {paramHistory.map((h, i) => (
                        <div key={i} className="nx-agent-perf">
                          <span style={{ color: "#e2e8f0" }}>Session {h.session}</span>
                          <span style={{ color: "#34d399" }}>Grade: {h.grade} · edge≥{(h.params.edgeThreshold * 100).toFixed(1)}% conf≥{(h.params.confidenceThreshold * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
