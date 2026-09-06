/**
 * Truncates a citation's `quotedPassage` for display under the citation link in the Quill panel's
 * citation list (spec-citation-display-differentiation.md). This is a pure string helper --
 * independently testable -- so the truncation rule (bounded length + ellipsis) doesn't hide inside
 * JSX.
 */
export const CITATION_SNIPPET_MAX_LENGTH = 100;

export function truncateCitationSnippet(
  quotedPassage: string,
  maxLength: number = CITATION_SNIPPET_MAX_LENGTH,
): string {
  if (quotedPassage.length <= maxLength) {
    return quotedPassage;
  }

  return `${quotedPassage.slice(0, maxLength).trimEnd()}…`;
}
