/**
 * Extension-wide utilities — shared by multiple modules.
 * No external dependencies; stdlib only.
 */

/** One day expressed in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Drops the `new Promise` boilerplate around setTimeout. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decides whether a probe / collection fetch failed because the
 * shopping mall session expired.
 *
 * The extension uses `redirect: "manual"`, so when a login redirect
 * happens the response comes back as `opaqueredirect`. An explicit
 * 401/403 means the session may still exist but the request is
 * unauthorized.
 */
export function isAuthExpired(res: Response): boolean {
  return res.type === "opaqueredirect" || res.status === 401 || res.status === 403;
}
