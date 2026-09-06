/**
 * Truncates a citation's `quotedPassage` for display under the citation link in the Quill panel's
 * citation list (spec-citation-display-differentiation.md). This is a pure string helper --
 * independently testable -- so the truncation rule (bounded length + ellipsis) doesn't hide inside
 * JSX.
 */
export const CITATION_SNIPPET_MAX_LENGTH = 100;

/**
 * Truncates at the last word boundary at or before `maxLength` (spec-chat-nice-to-haves.md) --
 * cutting mid-word (e.g. "...factio…") reads as sloppy, especially in a screenshot/demo, even
 * though it's functionally harmless. Falls back to the previous hard cut when there's no space
 * anywhere in the cut region at all (one long unbroken "word" longer than `maxLength`), so this
 * never truncates down to nothing just to avoid a mid-word cut.
 */
export function truncateCitationSnippet(
  quotedPassage: string,
  maxLength: number = CITATION_SNIPPET_MAX_LENGTH,
): string {
  if (quotedPassage.length <= maxLength) {
    return quotedPassage;
  }

  const hardCut = quotedPassage.slice(0, maxLength);
  const lastSpaceIndex = hardCut.lastIndexOf(' ');
  const truncated = lastSpaceIndex === -1 ? hardCut : hardCut.slice(0, lastSpaceIndex);

  return `${truncated.trimEnd()}…`;
}
