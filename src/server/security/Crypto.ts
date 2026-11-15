import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** 32 symbols, no 0/O/1/I ambiguity → 10 chars ≈ 50 bits. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 10;

/** Opaque high-entropy secrets; only their hashes are persisted. */
export class SecretGenerator {
  /** 32 random bytes, base64url. */
  token(): string {
    return randomBytes(32).toString("base64url");
  }

  sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}

/**
 * Event join codes: generation, normalisation, HMAC-SHA256 indexing under the
 * stable JOIN_CODE_HASH_KEY, and AES-256-GCM encryption so an owner can see
 * a still-valid code again without the database holding it in plain text.
 */
export class JoinCodeCodec {
  private readonly hmacKey: Buffer;
  private readonly encKey: Buffer;

  constructor(secret: string) {
    this.hmacKey = createHash("sha256").update(`hmac:${secret}`).digest();
    this.encKey = createHash("sha256").update(`enc:${secret}`).digest();
  }

  generate(): string {
    let code = "";
    for (let i = 0; i < JOIN_CODE_LENGTH; i++) code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
    return code;
  }

  /** Uppercase, strip spaces/dashes, map look-alikes (O→0 is not in alphabet so O stays invalid). */
  normalize(input: string): string | null {
    const code = input.toUpperCase().replace(/[\s-]/g, "");
    if (code.length !== JOIN_CODE_LENGTH) return null;
    for (const ch of code) if (!JOIN_CODE_ALPHABET.includes(ch)) return null;
    return code;
  }

  hash(normalized: string): string {
    return createHmac("sha256", this.hmacKey).update(normalized).digest("hex");
  }

  encrypt(code: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encKey, iv);
    const data = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
  }

  decrypt(payload: string): string | null {
    try {
      const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
      const decipher = createDecipheriv("aes-256-gcm", this.encKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }

  /** Display as XXXXX-XXXXX. */
  static format(code: string): string {
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  }
}
