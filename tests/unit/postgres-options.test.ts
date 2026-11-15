import { describe, expect, it } from "vitest";
import { postgresOptions } from "@/server/PostgresOptions";

describe("PostgreSQL TLS configuration", () => {
  const url = "postgresql://app:fake@pooler.example:6543/postgres?sslmode=verify-full&schema=public";

  it("preserves the connection string for local/default trust settings", () => {
    expect(postgresOptions(url, "").connectionString).toBe(url);
    expect(postgresOptions(url, "").ssl).toBeUndefined();
  });

  it("preserves CA validation when SSL URL parameters would replace ssl options", () => {
    const result = postgresOptions(url + "&sslrootcert=old.pem", "provider-ca");
    expect(result.ssl).toEqual({ ca: "provider-ca", rejectUnauthorized: true });
    expect(new URL(result.connectionString!).searchParams.has("sslmode")).toBe(false);
    expect(new URL(result.connectionString!).searchParams.has("sslrootcert")).toBe(false);
    expect(new URL(result.connectionString!).searchParams.get("schema")).toBe("public");
  });

  it("accepts escaped PEM line breaks from deployment configuration", () => {
    expect(postgresOptions(url, "first\\nsecond").ssl).toEqual({ ca: "first\nsecond", rejectUnauthorized: true });
  });

  it("bounds serverless connections while allowing transaction bookkeeping", () => {
    expect(postgresOptions(url, "").max).toBe(3);
    expect(postgresOptions(url, "").connectionTimeoutMillis).toBe(15_000);
  });
});
