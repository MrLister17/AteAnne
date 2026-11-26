"use client";

import { useEffect, useState } from "react";

/**
 * Shown only while the deployment has no database configured ("preview mode"),
 * so the owner can explore screens and buttons before setup is finished.
 */
export function SetupBanner() {
  const [state, setState] = useState<"ok" | "not_configured" | "database_unreachable">("ok");
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { ok: boolean; reason?: "not_configured" | "database_unreachable" }) => {
        if (!b.ok && b.reason) setState(b.reason);
      })
      .catch(() => undefined);
  }, []);
  if (state === "ok") return null;
  return (
    <div role="status" className="safe-top bg-warn-soft text-ink">
      <p className="mx-auto max-w-[520px] px-4 py-2 text-center text-[14px] font-medium">
        {state === "not_configured" ? "Preview mode: the database isn’t connected yet, so tap around freely but nothing will be saved" : "Can’t reach the database right now, so nothing will be saved until it’s back"}
      </p>
    </div>
  );
}
