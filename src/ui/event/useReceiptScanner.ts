"use client";

import { useCallback, useState } from "react";
import type { ScannedDraft } from "@/server/services/ReceiptScanService";
import { api, ApiError } from "../api";
import { useToast } from "../components/ui";
import { MAX_CLIENT_UPLOAD_BYTES, prepareImage, uploadName } from "../image";

export interface ScanResult {
  draft: ScannedDraft;
  photo: Blob;
}

/** Shrinks the photo on the phone, sends it to the scan endpoint, returns a draft (nothing is saved). */
export function useReceiptScanner(eventId: string) {
  const [scanning, setScanning] = useState(false);
  const toast = useToast();
  const scan = useCallback(
    async (file: File): Promise<ScanResult | null> => {
      setScanning(true);
      try {
        const photo = await prepareImage(file, "RECEIPT");
        if (photo.size > MAX_CLIENT_UPLOAD_BYTES) throw new ApiError(413, "too_large", "That photo is too large. Try again with a smaller photo.");
        const fd = new FormData();
        fd.set("file", photo, uploadName(photo));
        const draft = await api.post<ScannedDraft>(`/api/events/${eventId}/receipts/scan`, fd);
        return { draft, photo };
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Couldn’t scan that photo. Enter the receipt by hand.", "error");
        return null;
      } finally {
        setScanning(false);
      }
    },
    [eventId, toast],
  );
  return { scanning, scan };
}
