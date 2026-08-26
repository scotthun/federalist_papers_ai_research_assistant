// Shared fetch-failure error-state markup for apps/web pages that read from apps/api -- the
// Browse Papers page (Story 1.3) and the Paper Reader page (Story 1.4) both render this exact
// message when apps/api is down or unreachable (I/O matrix, "API unreachable"); centralized so
// the two can't drift into hand-duplicated copies of the same text/markup.
export function ApiUnreachableNotice() {
  return (
    <p role="alert" className="text-sm text-destructive">
      We couldn&apos;t reach the Federalist Research server. Please try again shortly.
    </p>
  );
}
