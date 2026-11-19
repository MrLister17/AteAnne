/**
 * S9.4b: Row Level Security regression check. AteAnne never uses Supabase's
 * Data API; every table has RLS on with no policies, and the API roles have
 * no privileges, so a table added later without RLS fails CI here.
 */
import { afterAll, describe, expect, it } from "vitest";
import { makeApp } from "./helpers";

const { db } = makeApp();
afterAll(async () => db.$disconnect());

describe("database lockdown", () => {
  it("every table in the app schema has Row Level Security turned on", async () => {
    const tables = await db.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r'
      ORDER BY c.relname`;
    expect(tables.length).toBeGreaterThan(20);
    expect(tables.filter((t) => !t.relrowsecurity).map((t) => t.relname)).toEqual([]);
  });

  it("Supabase's anon/authenticated roles, where they exist, can't touch any table or sequence", async () => {
    const roles = (await db.$queryRaw<{ rolname: string }[]>`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`).map((r) => r.rolname);
    for (const role of roles) {
      const tables = await db.$queryRaw<{ relname: string }[]>`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind = 'r'
          AND (has_table_privilege(${role}, c.oid, 'SELECT') OR has_table_privilege(${role}, c.oid, 'INSERT')
               OR has_table_privilege(${role}, c.oid, 'UPDATE') OR has_table_privilege(${role}, c.oid, 'DELETE'))`;
      expect(tables.map((t) => t.relname), role).toEqual([]);
      const sequences = await db.$queryRaw<{ relname: string }[]>`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind = 'S' AND has_sequence_privilege(${role}, c.oid, 'USAGE')`;
      expect(sequences.map((t) => t.relname), role).toEqual([]);
    }
  });
});
