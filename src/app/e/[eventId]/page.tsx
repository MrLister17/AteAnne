import { EventApp } from "@/ui/event/EventApp";

export const metadata = { title: "Event" };

/** The page shell holds no private data; the event view is fetched client-side with no-store. */
export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EventApp eventId={eventId} />;
}
