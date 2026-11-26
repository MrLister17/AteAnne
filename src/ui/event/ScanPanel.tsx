"use client";

import { useRef } from "react";
import { Icon } from "../components/Icon";
import { Button, Notice, Spinner } from "../components/ui";
import type { ReceiptScanner } from "./useReceiptScanner";

/**
 * The one place a receipt photo is picked. Two plain choices (camera or photo
 * library), a visible progress state with Cancel, and errors that stay on
 * screen with a way forward. "hero" is the big block on the Receipts tab;
 * "form" is the compact block at the top of the Add-receipt form.
 */
export function ScanPanel({
  scanner,
  onFile,
  variant,
  rescan = false,
  onType,
}: {
  scanner: ReceiptScanner;
  onFile: (file: File) => void;
  variant: "hero" | "form";
  rescan?: boolean;
  /** Hero only: jump to typing the receipt by hand. */
  onType?: () => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // choosing the same photo again must still fire
    if (f) onFile(f);
  };
  const suffix = variant === "hero" ? "to scan" : "to fill in this form";

  return (
    <section aria-label="Scan a receipt photo" className={variant === "hero" ? "rounded-3xl bg-violet-soft p-4" : "rounded-2xl border-2 border-dashed border-violet/40 bg-violet-soft p-3.5"}>
      {/* JPEG/PNG/WebP only, so iPhones convert HEIC photos themselves. `capture` opens the back camera directly. */}
      <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" tabIndex={-1} aria-label={`Take a receipt photo ${suffix}`} onChange={pick} />
      <input ref={library} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label={`Choose a receipt photo ${suffix}`} onChange={pick} />

      {scanner.scanning ? (
        <div className="flex items-center gap-3" role="status" aria-live="polite">
          <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl border border-line bg-surface">
            {scanner.preview ? <img src={scanner.preview} alt="" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-violet"><Spinner /></span>}
            <span className="animate-scanline pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-violet/45 to-transparent" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[16px] font-semibold text-ink">
              <span className="text-violet"><Spinner /></span>
              {scanner.stage === "preparing" ? "Getting your photo ready…" : "Reading your receipt…"}
            </p>
            <p className="mt-0.5 text-[13px] text-muted">
              {scanner.seconds < 8 ? "Usually a few seconds" : scanner.seconds < 25 ? "Still reading, long receipts take a little longer" : "Almost there, this can take up to a minute"}
              {scanner.seconds >= 3 && <span className="tnum"> {scanner.seconds}s</span>}
            </p>
          </div>
          <Button variant="secondary" className="shrink-0 px-4" onClick={scanner.cancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          {rescan && !scanner.error ? (
            // After a scan the form matters most: keep this block small.
            <h3 className="text-[15px] font-bold text-ink">Scan a different photo</h3>
          ) : (
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-violet text-violet-ink">
                <Icon name="spark" size={20} />
              </span>
              <div className="min-w-0">
                <h3 className={`font-bold text-ink ${variant === "hero" ? "text-[17px]" : "text-[16px]"}`}>{rescan ? "Scan a different photo" : variant === "hero" ? "Scan a receipt" : "Fill in from a photo"}</h3>
                <p className="text-[14px] text-muted">We read the photo, you check the details, and the photo isn’t saved</p>
              </div>
            </div>
          )}
          {scanner.error && (
            <div className="mt-3">
              <Notice tone="pay" title="That didn’t work">
                <p>{scanner.error}</p>
                <p className="text-muted">Tip: lay the receipt flat, fit the whole receipt in the frame, and use good light</p>
              </Notice>
            </div>
          )}
          <div className={`grid grid-cols-2 gap-2 ${rescan && !scanner.error ? "mt-2" : "mt-3"}`}>
            <Button icon="camera" className="!px-2 !text-[15px] whitespace-nowrap" onClick={() => camera.current?.click()}>
              {scanner.error ? "Retake" : "Take photo"}
            </Button>
            <Button variant="secondary" icon="image" className="!px-2 !text-[15px] whitespace-nowrap" onClick={() => library.current?.click()}>
              Upload photo
            </Button>
          </div>
          {onType && (
            <Button variant="add" icon="edit" full className="mt-2" onClick={onType}>
              Add receipt by typing
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/** Shown instead of the scan block when the site has no receipt reader configured, so the option never silently vanishes. */
export function ScanOffNote() {
  return (
    <details className="rounded-2xl bg-surface-2 px-4 text-[14px] text-muted">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold">
        <Icon name="camera" size={18} />
        <span className="flex-1">Photo scanning is off on this site</span>
        <span className="text-violet">Why?</span>
      </summary>
      <div className="space-y-1.5 pb-3">
        <p>Receipts can still be typed in, but scanning from a photo needs a free Groq key set up by whoever runs this site:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>In Vercel, open the project → Settings → Environment Variables</li>
          <li>
            Add <b className="text-ink">GROQ_API_KEY</b> with <b className="text-ink">Production</b> ticked
          </li>
          <li>Deployments → open the newest one → Redeploy</li>
        </ol>
        <p>
          <a className="inline-flex min-h-11 items-center font-semibold text-violet underline" href="/api/health" target="_blank" rel="noreferrer">
            Open the setup check
          </a>{" "}
          It says exactly what is missing
        </p>
      </div>
    </details>
  );
}
