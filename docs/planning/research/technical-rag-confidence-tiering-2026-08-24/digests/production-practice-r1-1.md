## Digest: Production RAG confidence/abstention practice
### Claims
- Dominant real-world pattern is a single binary similarity threshold (keep/drop), not a three-way split — LlamaIndex's `SimilarityPostprocessor(similarity_cutoff=...)` simply filters below cutoff — source: LlamaIndex docs, accessed 2026-08-24, confidence: high
- Practitioner walkthroughs confirm binary-gate norm (e.g. `similarity_cutoff=0.75`) — source: Meisin Lee, Medium, 2025-03-24, accessed 2026-08-24, confidence: medium
- No RAG-specific production source found implementing three-way answer/clarify/refuse gated on raw similarity — source: aggregate of LlamaIndex/LangChain/engineering blog search, accessed 2026-08-24, confidence: medium
- Rasa's docs describe exactly this three-way band for intent classification (not RAG): high confidence → act; medium → Two-Stage Fallback (confirm with user); low → nlu_fallback — source: Rasa docs, "Fallback and Human Handoff," accessed 2026-08-24, confidence: high
- Amazon Lex: scores below threshold → AMAZON.FallbackIntent; close scores between top intents → docs describe this as "ambiguity" needing domain-knowledge disambiguation — a documented middle band — source: AWS Lex Developer Guide, accessed 2026-08-24, confidence: high
- Amazon Lex explicitly warns: "confidence scores...are comparative values. You should not rely on them as an absolute score" — source: same, confidence: high
- Cosine similarity measures topical proximity, not answer-bearing relevance; documented failure modes include negation queries, numeric comparisons, signal dilution in long chunks — source: Angela Shi, Towards Data Science, 2026-05-30, confidence: medium
- Academic calibration paper: raw retrieval signal typically needs ~0.80 AUC before a single global cutoff is reliable; calibration reduced Expected Calibration Error from 0.275 to 0.062 on TriviaQA — source: arXiv:2606.29959, 2026-06-29, confidence: medium

### Leads
- Vectara's HHEM/Factual Consistency Score as a groundedness-based alternative, not fully explored.
- Azure AI Search / AWS Bedrock Knowledge Bases first-party threshold guidance not directly fetched.
- WeKnow-RAG paper reportedly uses LLM self-reported >97% confidence bar instead of similarity — contrasting design.

### Could not find / open questions
- No production RAG-specific three-tier (not binary) example found; the three-tier pattern's real precedent is NLU/intent classification, not RAG.
- No company engineering blog (Notion AI, Intercom, Glean, etc.) confirmed describing this exact pattern for RAG.
