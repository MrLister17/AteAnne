import type { Db } from "../db";
import { SecretGenerator } from "../security/Crypto";

export const SESSION_COOKIE = "aa_sid";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssuedSession {
  actorId: string;
  token: string;
  expiresAt: Date;
}

/**
 * Opaque browser sessions. The raw token lives only in an HttpOnly cookie;
 * the database stores its SHA-256 hash with a fixed 30-day expiry.
 */
export class SessionManager {
  constructor(
    private readonly db: Db,
    private readonly secrets = new SecretGenerator(),
  ) {}

  async resolve(token: string | undefined | null): Promise<string | null> {
    if (!token || token.length > 100) return null;
    const session = await this.db.session.findUnique({ where: { tokenHash: this.secrets.sha256(token) } });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    return session.actorId;
  }

  /** New browser identity plus its first session. */
  async issueForNewActor(): Promise<IssuedSession> {
    const actor = await this.db.actor.create({ data: {} });
    return this.issue(actor.id);
  }

  async issue(actorId: string): Promise<IssuedSession> {
    const token = this.secrets.token();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.session.create({ data: { actorId, tokenHash: this.secrets.sha256(token), expiresAt } });
    return { actorId, token, expiresAt };
  }

  async revoke(token: string): Promise<void> {
    await this.db.session.updateMany({ where: { tokenHash: this.secrets.sha256(token) }, data: { revokedAt: new Date() } });
  }
}
