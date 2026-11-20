import Link from "next/link";
import { Icon } from "./Icon";

/** Simple page frame for entry screens: safe areas, narrow column, back link. */
export function PageShell({ title, back = "/", children }: { title?: string; back?: string | null; children: React.ReactNode }) {
  return (
    <main className="safe-top safe-bottom mx-auto min-h-[100dvh] w-full max-w-[520px] px-4 pb-10">
      {title && (
        <header className="flex min-h-14 items-center gap-1">
          {back && (
            <Link href={back} className="-ml-2 inline-flex size-11 items-center justify-center rounded-full text-violet active:bg-violet-soft" aria-label="Back">
              <Icon name="back" />
            </Link>
          )}
          <h1 className="text-[20px] font-bold">{title}</h1>
        </header>
      )}
      {children}
    </main>
  );
}

export function Brand({ size = "lg" }: { size?: "lg" | "sm" }) {
  return (
    <div className="flex items-center gap-3">
      <img src="/icons/icon-192.png" alt="" width={size === "lg" ? 56 : 36} height={size === "lg" ? 56 : 36} className={size === "lg" ? "size-14 rounded-2xl" : "size-9 rounded-xl"} />
      <div>
        <p className={`${size === "lg" ? "text-[28px]" : "text-[20px]"} leading-tight font-extrabold tracking-tight`}>
          <span className="text-violet">Hatian</span>
        </p>
        {size === "lg" && <p className="text-[15px] text-muted">Hatian na malinaw. Bayaran na tama.</p>}
      </div>
    </div>
  );
}
