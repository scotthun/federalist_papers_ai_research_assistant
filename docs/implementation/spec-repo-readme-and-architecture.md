---
title: 'Repo presentability: README with a BMAD development narrative and an architecture diagram'
type: 'docs'
created: '2026-09-06'
status: 'done'
context: []
baseline_revision: 'b543d71'
followup_review_recommended: false
---

## Intent

Prompted by a UX/product pulse-check (2026-09-06): the app itself is in a demo-ready state, but
the repo has no README at all -- only `AGENTS.md` (agent-facing) and `LICENSE`. Someone landing on
GitHub (a recruiter, a hiring manager) currently sees an Nx monorepo with no explanation of what it
is, how it was built, or how it works.

**Deliverable:** a root `README.md` covering, in order:
1. What the project is and does (one paragraph, human-facing, not agent-facing).
2. How it was built -- a short, honest narrative of the BMAD (spec-first, multi-agent-reviewed)
   development process actually used this project, not marketing copy.
3. An architecture diagram (Mermaid, per this repo's own `docs/planning/` convention -- renders
   natively on GitHub, stays version-controlled as text, never goes stale silently the way an
   exported image would) covering every real component: apps/web, apps/api, the three libs that
   matter to the request path (ai, retrieval, database), Postgres+pgvector, and the external AI
   provider(s).
4. Tech stack, quickstart (`npm install` / `docker-compose up` / `npm run dev`), and a placeholder
   section for a demo video the user will add once recorded separately (out of this story's scope
   -- the recording itself is a separate, non-code task).

## Boundaries & Constraints

**Always:**
- Every claim about the architecture (component names, providers, data flow) must be verified
  directly against the current codebase (`libs/ai/src/lib/providers`, `apps/api`'s module wiring,
  `libs/database`'s migrations), not written from memory of earlier session discussion --
  `story/groq-provider` is still an unmerged, un-reviewed-into-main branch, so the diagram
  describes `main`'s actual two-provider state (Gemini + OpenRouter), not Groq.
- The BMAD narrative section describes the actual process used (spec-first stories, a 4-layer
  parallel review pipeline: blind-hunter/edge-case-hunter/verification-gap/intent-alignment,
  triage into patch/defer/reject) -- it must read as a genuine account of what happened in this
  repo's own git history, not generic praise for the methodology.
- The Mermaid diagram must actually render -- verified by rendering it (GitHub's own Mermaid
  renderer, or a local render) before calling this done, not just assumed correct from the syntax.

**Never:**
- No fabricated metrics, screenshots, or claims that can't be verified against the repo as it
  exists on `main` right now.
- No live demo URL/deployment claim -- this story explicitly does not include standing up hosting
  (product decision, 2026-09-06: local screen-recording + a public GitHub repo first, live hosting
  is a later, separately-scoped stretch goal).

## Code Map

- `README.md` (new, repo root).
- No application code changes -- documentation only.

## Tasks & Acceptance

- [x] Verify current tech stack/providers/schema directly against the codebase before writing.
- [x] Write `README.md`: overview, BMAD development narrative, Mermaid architecture diagram, tech
      stack, quickstart, placeholder video section.
- [x] Render-check the Mermaid diagram.

**Acceptance:** a first-time visitor to the repo can read `README.md` and understand what the app
does, how it was built, and how its major components fit together, without needing to read any
other file first.

## Verification

Mermaid diagram syntax validated (renders cleanly). No test/build/lint impact -- documentation-only
change.
