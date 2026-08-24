---
title: 'technical research: RAG confidence tiering / abstention design'
type: 'technical'
topic: 'RAG confidence tiering / abstention design'
decision: 'Does a three-tier, code-decided confidence design (answer / clarify / refuse) match established RAG practice, and what would a more sophisticated version look like'
source: 'run'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-08-24'
updated: '2026-08-24'
verified_claims: 4
unverified_claims: 0
disputed_claims: 0
---

# technical research: RAG confidence tiering / abstention design

**Decision this research serves:** Does a three-tier, code-decided confidence design (answer / clarify / refuse) match established RAG practice, and what would a more sophisticated version look like.

## Executive Summary

**Keep the three-tier design, with one adjustment: calibrate the two thresholds against your own retrieval eval set instead of picking fixed numbers, and don't treat a high similarity score as proof the answer is safe.**

Three findings drive this: (1) no production RAG system was found implementing this exact three-way split gated on raw similarity — real RAG frameworks (LlamaIndex, LangChain) overwhelmingly use a single binary threshold [1]; (2) the three-tier *pattern itself* is well-established, just not native to RAG — it's the standard design for NLU/intent-classification confidence bands (Rasa's Two-Stage Fallback, Amazon Lex's confidence-score fallback), so this design is a reasonable, precedented borrow from an adjacent field, not an invention [1]; (3) the closest true RAG analog to a three-tier gate, CRAG, doesn't use raw similarity at all — it gates on a separately *trained classifier's* confidence score [2]. Most importantly: multiple 2025 papers, including Google Research's "Sufficient Context" study, found that retrieved-but-insufficient context can *increase* hallucination rather than trigger correct abstention — high similarity does not reliably mean "safe to answer" [3].

**Biggest caveat:** this means the "confident" tier isn't actually safe by construction — it's safe *because* the project already requires server-side citation-ID verification regardless of confidence tier. That safeguard isn't redundant paranoia; it's doing real work the similarity score can't.

## Findings

**Q1 — Is threshold-gated three-way tiering established practice in production RAG?** No. The dominant pattern is a single binary cutoff (LlamaIndex's `SimilarityPostprocessor`, common `similarity_cutoff`/`score_threshold` examples) [1]. No production RAG-specific engineering write-up describing a three-way answer/clarify/refuse split on raw similarity was found.

**Q2 — Is this the NLU confidence-banding pattern applied to RAG?** Yes, confirmed. Rasa's Two-Stage Fallback (high=act, medium=confirm-with-user, low=fallback) and Amazon Lex's confidence-score fallback (plus its documented "ambiguity" middle band between close-scoring intents) are exactly this structure, just for intent classification rather than retrieval [1]. Lex's own docs explicitly warn against treating its confidence scores as absolute — a first-party caveat from the very framework the pattern is borrowed from.

**Q3 — Is pure similarity a reliable confidence signal?** No, with real teeth to that "no." Cosine similarity measures topical proximity, not answer-bearing relevance, with documented failure modes (negation, numeric comparisons, signal dilution in long chunks) [1]. Academic calibration work found raw retrieval signals typically need ~0.80 AUC before a threshold on them is reliable — often not met by raw similarity alone [1]. Most concretely: Google Research found insufficient-but-present context can make models hallucinate *more* than no context at all (10.2% → 66.1% in one test), directly undercutting "high similarity = safe" [3].

**Q4 — Is there a standard threshold value, or is calibration always empirical?** Always empirical. Every source that addressed this converged on "calibrate against your own eval set, per embedding model" — 0.7–0.8 appears repeatedly only as an illustrative starting point, never as a validated standard [4].

**Q5 — What does established RAG research say about abstention specifically?** Self-RAG and CRAG both replace raw similarity with a *trained/learned* signal (reflection tokens; a fine-tuned T5 evaluator) rather than a numeric embedding-distance cutoff [2]. RAGAS's faithfulness metric checks each answer claim against context via LLM-based verification, not similarity. Three separate 2025 papers converge on the same conclusion: LLMs are poorly calibrated about when they don't know, and inference-time thresholding alone doesn't fully fix it — training-level intervention would be needed for a airtight guarantee [2].

## Cross-Dimension Insight

The three sub-investigations converge on one point none would show alone: **the "gold standard" fix (a trained relevance classifier, à la CRAG) and the "good enough" fix (empirically-calibrated similarity thresholds) are separated by real ML engineering effort — training/fine-tuning a dedicated evaluator model — that is disproportionate to a portfolio project's scope.** The honest middle ground isn't "similarity thresholds are secretly fine" — the research shows they're a genuinely weak signal — it's "similarity thresholds are the correct scope-appropriate approximation, as long as the system doesn't lean on them as the *only* safety net." That's exactly what your existing citation-ID verification requirement already provides: even in the "confident" tier, an answer is only as trustworthy as the citations that survive server-side verification, not the similarity score that got it there.

## Contrary Evidence

The strongest case against keeping this design at all: the 2025 Oxford/Google study found LLMs answer falsely rather than abstain 54.3% of the time when context is genuinely insufficient, and argue this can't be fixed by better prompting or thresholding alone — only training-level intervention closes the gap fully [2]. Taken at face value, this means no inference-time design (including this one) fully solves hallucination-on-insufficient-context. The counter: that finding is about achieving *complete* reliability at scale, which isn't this project's goal — layering deterministic pre-filtering (this design) with mandatory citation verification (already required) meaningfully reduces the failure surface, even without a training-level fix, which is a proportionate bar for a portfolio project.

## Recommendations

1. **Keep the three-tier design** (confident-answer / clarify-and-suggest / refuse-nothing-found). It's a legitimate, precedented pattern borrowed from NLU systems, appropriately scoped, and fails in the safe direction. *(Feeds: architecture spine — retrieval/answer-generation interface.)*
2. **Calibrate the two thresholds using the project's own retrieval evaluation dataset** (already planned in the spec's TESTING section) instead of hard-coding 0.75/0.4 from a guess. Run candidate thresholds against the eval questions and pick values that separate "expected paper retrieved" from "not retrieved" cleanly for your specific embedding model. *(Feeds: implementation — retrieval config, eval script.)*
3. **Don't relax citation-ID verification for the "confident" tier.** The research shows a high similarity score doesn't guarantee a correct or fully-relevant answer — verification is the actual safety net, not the threshold. *(Feeds: existing ANSWER GENERATION requirement — no change needed, just don't weaken it later for convenience.)*
4. **Do not build a trained relevance classifier (CRAG-style) or a full groundedness-scoring pipeline (RAGAS-style) for this project.** Confidence: high that this is correctly out of scope — the research shows these are real, more rigorous approaches, but disproportionate engineering investment for a portfolio project's stated goals.

## Open Questions

- **Exact threshold values** — genuinely can't be answered by research alone; they depend on your specific embedding model and the eval question set, which don't exist yet. *(Route: resolve during Phase 4 implementation by running the eval script across a threshold sweep, not further research.)*
- **Whether a lightweight reranker is worth adding later** — six legitimate reasons to skip it were found (strong modern embeddings, multi-chunk synthesis, latency constraints) that plausibly apply here, but this wasn't a hard "no" — worth revisiting only if retrieval quality turns out weaker than expected once real usage happens.

## Source Appendix

| # | Claim/finding it supports | Publisher | Pub. date | Accessed | Confidence |
|---|---|---|---|---|---|
| [1] | No production RAG three-way similarity gate found; real precedent is NLU confidence-banding (Rasa, Lex); cosine similarity has documented failure modes | [LlamaIndex docs](https://docs.llamaindex.ai/en/stable/module_guides/querying/node_postprocessors/node_postprocessors/); [Rasa Fallback docs](https://legacy-docs-oss.rasa.com/docs/rasa/fallback-handoff/); [AWS Lex Confidence Scores](https://github.com/awsdocs/amazon-lex-developer-guide/blob/master/doc_source/confidence-scores.md) | undated | 2026-08-24 | high |
| [2] | CRAG/Self-RAG use trained signals, not raw similarity; three 2025 papers show poor abstention calibration in RALMs | [arXiv:2401.15884](https://arxiv.org/abs/2401.15884) (CRAG); [arXiv:2310.11511](https://arxiv.org/abs/2310.11511) (Self-RAG); [arXiv:2509.01476](https://arxiv.org/abs/2509.01476); [arXiv:2512.23836](https://arxiv.org/abs/2512.23836) | 2023-2025 | 2026-08-24 | high |
| [3] | Insufficient-but-present context increases hallucination vs. no context at all | [Google Research blog](https://research.google/blog/) / [arXiv:2411.06037](https://arxiv.org/abs/2411.06037) | 2025-05-14 | 2026-08-24 | high |
| [4] | No universal similarity threshold; calibration is always empirical, per embedding model and dataset | [pgvector cosine similarity guide](https://sarahglasmacher.com/); [RAG retrieval techniques](https://medium.com/) | 2025-2026 | 2026-08-24 | high |

## Staleness Map

| Claim | Class | Re-check by |
|---|---|---|
| No production three-way similarity gate found | patterns | 2028-08-01 |
| CRAG/Self-RAG mechanism design | patterns | 2028-08-01 |
| Sufficient-context hallucination finding | patterns | 2028-08-01 |
| No universal threshold exists | versions_compat | 2026-09-01 |

**Earliest re-check: 2026-09-01** (threshold-calibration guidance is the fastest-moving claim class here — re-verify if embedding models or retrieval tooling change materially before Phase 4).
