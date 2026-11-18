/**
 * Recovery keys look like "AA-" followed by ~43 letters, digits, "-" and "_".
 * People paste them in the wrong box (the join code field) or with stray
 * spaces and line breaks from Notes or a chat; recognise them anyway. The
 * server does the real check.
 */
export function looksLikeRecoveryKey(input: string): boolean {
  const k = input.replace(/[\s​-‍﻿]+/g, "");
  return /^aa-[A-Za-z0-9_-]{20,}$/i.test(k);
}

/** iPhone/iPad: a Home Screen app keeps its own sign-in, separate from Safari. */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
