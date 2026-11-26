"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScannedDraft } from "@/server/services/ReceiptScanService";
import { api, ApiError } from "../api";
import { haptic, useToast } from "../components/ui";
import { MAX_CLIENT_UPLOAD_BYTES, prepareImage, uploadName } from "../image";

export interface ScanResult {
  draft: ScannedDraft;
  photo: Blob;
}

/** What the person sees while waiting: shrinking the photo on the phone, then the reader working on it. */
export type ScanStage = "preparing" | "reading";

/** Give up a little before the server's own 60-second limit so the person gets a clear message. */
const SCAN_TIMEOUT_MS = 55_000;
const READABLE = ["image/jpeg", "image/png", "image/webp"];

/**
 * Shrinks the photo on the phone, sends it to the scan endpoint and returns a
 * draft (nothing is saved). Exposes progress, a cancel action and a
 * persistent error message so the screen can always show what is happening.
 */
export function useReceiptScanner(eventId: string) {
  const [stage, setStage] = useState<ScanStage | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);
  const toast = useToast();

  useEffect(() => () => running.current?.abort("left"), []);

  const scan = useCallback(
    async (file: File, currency?: string): Promise<ScanResult | null> => {
      if (running.current) return null; // one scan at a time
      const ctl = new AbortController();
      running.current = ctl;
      setError(null);
      setSeconds(0);
      setStage("preparing");
      const started = Date.now();
      const tick = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
      const timeout = setTimeout(() => ctl.abort("timeout"), SCAN_TIMEOUT_MS);
      let url: string | null = null;
      try {
        if (file.type && !file.type.startsWith("image/")) throw new ApiError(415, "not_an_image", "That file isn’t a photo, so choose a picture of the receipt");
        const photo = await prepareImage(file, "RECEIPT");
        if (!READABLE.includes(photo.type)) throw new ApiError(415, "bad_format", "This kind of photo can’t be read here, so take a screenshot of it and choose that instead");
        if (photo.size > MAX_CLIENT_UPLOAD_BYTES) throw new ApiError(413, "too_large", "That photo is too large, so try again with a smaller photo or a screenshot of it");
        url = URL.createObjectURL(photo);
        setPreview(url);
        setStage("reading");
        const fd = new FormData();
        fd.set("file", photo, uploadName(photo));
        // Used only when the receipt doesn't show its currency.
        if (currency) fd.set("currency", currency);
        const draft = await api.post<ScannedDraft>(`/api/events/${eventId}/receipts/scan`, fd, { signal: ctl.signal });
        haptic("ok");
        toast(draft.lines.length ? `Read ${draft.lines.length} item${draft.lines.length === 1 ? "" : "s"}, now check them before saving` : "Photo read, now check everything before saving");
        return { draft, photo };
      } catch (e) {
        if (ctl.signal.aborted && ctl.signal.reason !== "timeout") return null; // the person tapped Cancel or left the screen
        haptic("error");
        setError(
          ctl.signal.aborted
            ? "Reading took too long, so check your connection and try again, or type the receipt in"
            : e instanceof ApiError
              ? e.message
              : "Couldn’t scan that photo, so try again or type the receipt in",
        );
        return null;
      } finally {
        clearInterval(tick);
        clearTimeout(timeout);
        if (url) URL.revokeObjectURL(url);
        running.current = null;
        setPreview(null);
        setStage(null);
      }
    },
    [eventId, toast],
  );

  const cancel = useCallback(() => running.current?.abort("cancelled"), []);
  const clearError = useCallback(() => setError(null), []);

  return { scanning: stage !== null, stage, preview, seconds, error, clearError, scan, cancel };
}

export type ReceiptScanner = ReturnType<typeof useReceiptScanner>;
