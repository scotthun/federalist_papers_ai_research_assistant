/**
 * Response shape for `GET /api/papers` (CAP-1, Browse Papers). Single source of truth imported
 * by both `apps/api` (produces it) and `apps/web` (consumes it) so the two can never drift on
 * this shape independently (architecture-diagrams.md's `web -> shared` dependency edge).
 *
 * A plain TypeScript type, not a Zod-validated schema -- AD-9's shared-schema rule is scoped to
 * the `Answer`/`Citation` contract and the ingestion chunk DTOs, both of which carry genuinely
 * uncertain data (LLM output, parsed source text). This endpoint returns backend-controlled data
 * only (never user input, never LLM output), so a shared type gives the "no drift between apps"
 * benefit without paying for runtime validation that has nothing uncertain to guard against.
 * Revisit if this endpoint ever takes user-supplied filters.
 */
export interface PaperSummary {
  paperNumber: number;
  title: string;
  authors: string[];
}
