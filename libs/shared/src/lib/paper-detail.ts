import { PaperSummary } from './paper-summary';

/**
 * Response shape for `GET /api/papers/:paperNumber` (Paper Reader, Story 1.4). Composes
 * `PaperSummary` rather than redeclaring `paperNumber`/`title`/`authors` -- the list endpoint
 * (Story 1.3) and this detail endpoint must never drift on what those three fields mean.
 *
 * A plain TypeScript type, not a Zod-validated schema, for the same reason as `PaperSummary`:
 * AD-9's shared-schema rule is scoped to the `Answer`/`Citation` contract and the ingestion chunk
 * DTOs (genuinely uncertain data), while this endpoint returns backend-controlled data only.
 */
export type PaperDetail = PaperSummary & {
  fullText: string;
  sourceUrl: string;
};
