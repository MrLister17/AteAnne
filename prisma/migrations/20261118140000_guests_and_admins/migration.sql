-- Guests (people without a phone, managed by the organizer or an admin) and
-- organizer-appointed admins. Both default to false, so existing rows keep
-- their current behaviour.
ALTER TABLE "Member" ADD COLUMN "managed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Member" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- A guest never has a browser of its own while managed.
ALTER TABLE "Member" ADD CONSTRAINT member_managed_has_no_actor CHECK (NOT "managed" OR "actorId" IS NULL);
-- Guests can't be admins (an admin must be a real, signed-in person).
ALTER TABLE "Member" ADD CONSTRAINT member_guest_not_admin CHECK (NOT ("managed" AND "isAdmin"));
