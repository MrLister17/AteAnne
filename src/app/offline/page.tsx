import { Brand, PageShell } from "@/ui/components/Shell";

export const dynamic = "force-static";

export default function Offline() {
  return (
    <PageShell>
      <div className="pt-16">
        <Brand />
        <h1 className="mt-8 text-[22px] font-bold">You’re offline</h1>
        <p className="mt-2 text-[16px] text-muted">Hatian needs a connection to show live balances — money figures are never shown from an old copy. Reconnect and pull to refresh.</p>
      </div>
    </PageShell>
  );
}
