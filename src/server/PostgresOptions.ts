import type { PoolConfig } from "pg";

/** Keep provider certificate verification enabled when Node needs an extra CA. */
export function postgresOptions(url: string, certificate = process.env.DATABASE_SSL_CA): PoolConfig {
  const options: PoolConfig = { connectionString: url, max: 3, connectionTimeoutMillis: 15_000 };
  if (!certificate?.trim()) return options;

  // node-postgres replaces `ssl` if SSL query parameters are present. Strip
  // those parameters only when the deployment explicitly supplies its CA.
  const connection = new URL(url);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) connection.searchParams.delete(key);
  options.connectionString = connection.toString();
  options.ssl = { ca: certificate.replace(/\\n/g, "\n"), rejectUnauthorized: true };
  return options;
}
