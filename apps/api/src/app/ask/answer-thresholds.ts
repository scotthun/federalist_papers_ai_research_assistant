/**
 * The three-tier decision at the heart of Story 3.1/3.2: gated purely on the top retrieved
 * chunk's similarity score, in code, never on the LLM's self-report (`decisions.md`, "Confidence
 * tiering"). `libs/retrieval` stays domain-naive -- it returns scores only; this is the one place
 * in the codebase that interprets what a score means.
 */
export type AnswerTier = 'confident' | 'clarify' | 'refuse';

/**
 * Calibrated empirically (this story's Boundaries: "not given anywhere in the planning docs --
 * must be calibrated empirically") by actually running `npm run calibrate:thresholds`
 * (`apps/api/src/calibrate-thresholds.ts`) against the live embedding model and the real
 * 85-paper corpus, comparing `retrieval-eval-dataset.json`'s 8 on-topic questions against
 * `retrieval-eval-dataset-offtopic.json`'s 7 genuinely-unrelated control questions.
 *
 * Observed top-chunk scores (2026-08-26): on-topic min 0.7068 / max 0.7788 / avg 0.7336;
 * off-topic min 0.4756 / max 0.5187 / avg 0.4928 -- a clean ~0.19 gap between the two groups with
 * zero overlap. `CONFIDENT_THRESHOLD` (0.65) sits below every observed on-topic score (a 0.057
 * margin under the on-topic min, so a real question phrased less crisply than the curated eval
 * set still lands confident) while staying well clear of the off-topic max (a 0.131 margin).
 * `CLARIFY_THRESHOLD` (0.55) sits above every observed off-topic score (a 0.031 margin over the
 * off-topic max) without crowding `CONFIDENT_THRESHOLD`, leaving a real 0.10-wide clarify band for
 * genuinely marginal/partially-relevant questions that neither eval dataset's deliberately
 * clear-cut extremes represents. Full observed-score log: this story's spec, "Design Notes".
 */
export const CONFIDENT_THRESHOLD = 0.65;
export const CLARIFY_THRESHOLD = 0.55;

/**
 * Decides the tier for a request from its top retrieved chunk's similarity score.
 * `topScore === undefined` (no chunks retrieved at all -- e.g. an empty corpus) is treated the
 * same as "no evidence found," i.e. `refuse`, never a crash or a confident/clarify tier with
 * nothing behind it.
 */
export function decideAnswerTier(topScore: number | undefined): AnswerTier {
  if (topScore === undefined) {
    return 'refuse';
  }
  if (topScore >= CONFIDENT_THRESHOLD) {
    return 'confident';
  }
  if (topScore >= CLARIFY_THRESHOLD) {
    return 'clarify';
  }
  return 'refuse';
}
