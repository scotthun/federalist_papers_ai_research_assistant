## Digest: Threshold calibration and signal combination
### Claims
- No universal cosine cutoff exists; must calibrate per embedding model and dataset against an eval set — source: Raghuveer Yellapantula, Medium, 2026-05-22, confidence: high
- pgvector practitioner guidance: 0.5 = "broad," 0.7-0.8 = "strict," explicitly told to try different values against your own use case — source: sarahglasmacher.com, 2025-03-04, confidence: high
- pgvector's own docs give zero guidance on picking a cutoff value or calibration methodology — source: Instaclustr pgvector tutorial, confidence: medium
- Cross-encoder rerankers are more calibrated than bi-encoder similarity but add ~50ms latency; recommended when result quality directly affects output (RAG/agents), skippable under tight latency budgets or when first-stage retrieval is already strong — source: ZeroEntropy, "Bi-Encoders vs Cross-Encoders," 2026-03-18, confidence: high
- Reranker scores are equally non-portable across models — same recalibration burden as raw similarity — source: dev.to (neurolink), 2026-04-04, confidence: medium
- Six legitimate scenarios to skip reranking: strong modern embedding models, redundant/duplicate passages in the corpus, generator synthesizes across multiple chunks, real-time latency constraints, sparse eval data — several plausibly apply to a small project — source: Sindhuja A, Medium, 2025-11-11, confidence: high
- Groundedness/faithfulness checking is a distinct, complementary evaluation layer from retrieval-side similarity ("RAG triad": context relevance + groundedness + answer relevance) — source: Openlayer, 2026-02-11, confidence: medium

### Leads
- Two specific "we used threshold X because Y" examples surfaced in search but PDF extraction failed to confirm (0.7 cutoff from an out-of-domain-query study; 0.8 from a 0.6-0.9 empirical sweep) — treat as unconfirmed anecdotes, not claims.

### Could not find / open questions
- No industry-wide agreed threshold; 0.7-0.8 repeatedly appears only as an illustrative starting point, never validated as a standard.
- No source directly addresses whether stacking similarity + reranker + LLM self-critique + groundedness is overkill specifically at small/solo-project scale — closest is the six-scenario skip-reranking list.
