- source_spec: `docs/implementation/spec-1-1-nx-monorepo-setup.md`
  summary: Wire up Tailwind CSS + shadcn/ui in `apps/web` (currently plain CSS from the Nx generator default).
  evidence: `stack.md` names Tailwind CSS + shadcn/ui as the frontend styling stack, but Story 1.1's actual Acceptance Criteria never mentions styling and there's no real UI yet to style (the default Next.js scaffold page is untouched). Reasonable to defer to the first story that renders real UI (e.g. Story 1.3, Browse All Papers) rather than wire up styling infrastructure with nothing to apply it to.

- source_spec: `docs/implementation/spec-1-1-nx-monorepo-setup.md`
  summary: No automated (CI) check verifies Nx workspace-config target wiring, e.g. the `nx.json` `devTargetName: 'serve'` remap that makes `npm run dev` work for `apps/web`.
  evidence: This repo has no CI at all yet (no `.github` workflow, no other CI config). `nx run-many -t lint` / `-t test` don't exercise the `serve`/`dev` target mapping, so a future accidental removal of `devTargetName: 'serve'` would silently break `npm run dev` for `web` with no automated signal. Worth a lightweight check (e.g. `nx show project web --json` asserting a `serve` target exists) once CI is introduced — not this story's job to introduce CI itself.
