# Story 0.1 Spike — Prove the RAG Pipeline End-to-End

**This directory is explicitly throwaway.** It exists to answer one question — does grounded retrieval + LLM answer generation + citation verification actually work on real Federalist Papers data — before any real ingestion pipeline, UI, or polish gets built in Epics 1–3. It gets deleted or fully rebuilt against the real `libs/` boundaries once it's answered that question, not gradually polished into the real thing.

Branch: `spike/story-0-1-rag-pipeline` — never merged into `main`. Delete the branch when done.

## What this proves

- A handful of real papers (not all 85) fetched from the Avalon Project, chunked, embedded, and queryable.
- A bare `retrieveRelevantChunks`-equivalent call returning chunks + similarity scores via pgvector.
- A bare LLM call (Gemini) that answers only from the retrieved passages.
- Citation-ID verification: every citation the model returns actually maps to a retrieved chunk.
- The retrieval evaluation script (question → expected paper) passes against this small dataset.

## What this explicitly does NOT build

- Confidence tiers (answer/clarify/refuse) — that's Story 3.2, not here.
- Any production UI, styling, or the two-column layout.
- The real Nx monorepo lib boundaries (`libs/ai`, `libs/database`, `libs/retrieval`) — those get built properly in Epic 1–3; this spike can cut corners those stories can't.

## Prerequisites

- `GEMINI_API_KEY` in `spike/.env` (gitignored) — see conversation for how this was set up.
- Docker running locally, for a throwaway Postgres+pgvector container (separate from the real Epic 1 setup).

## Status: DONE — verdict WORKS, see `docs/implementation/0-1-derisk-spike-rag-pipeline.md`

All 8 tasks complete, 17/17 tests passing, live end-to-end proof run against real Avalon data and Gemini. Full detail (Debug Log, Completion Notes, File List) lives in the dev-story file above — this file is kept only as the original scope note.
