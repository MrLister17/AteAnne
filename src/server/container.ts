import { config } from "./config";
import { RetentionPolicy } from "@/domain/event/RetentionPolicy";
import { Db, prisma } from "./db";
import { SessionManager } from "./auth/SessionManager";
import { EventViewBuilder } from "./readmodels/EventViewBuilder";
import { JoinCodeCodec } from "./security/Crypto";
import { RateLimiter } from "./security/RateLimiter";
import { AssetService } from "./services/AssetService";
import { CleanupService } from "./services/CleanupService";
import { EventService } from "./services/EventService";
import { PaymentService } from "./services/PaymentService";
import { QueryService } from "./services/QueryService";
import { ReceiptService } from "./services/ReceiptService";
import { RecoveryService } from "./services/RecoveryService";
import { ReceiptScanService } from "./services/ReceiptScanService";
import { ClaudeReceiptReader, FakeReceiptReader, type ReceiptReader } from "./scan/ReceiptReader";
import { GroqReceiptReader } from "./scan/GroqReceiptReader";
import { DatabaseStorage, LocalDiskStorage, PrivateStorage } from "./storage/PrivateStorage";

/**
 * Composition root: wires services with their dependencies once per process.
 * Tests build their own container against the test database.
 */
export class AppContainer {
  readonly limiter: RateLimiter;
  readonly sessions: SessionManager;
  readonly events: EventService;
  readonly receipts: ReceiptService;
  readonly payments: PaymentService;
  readonly recovery: RecoveryService;
  readonly assets: AssetService;
  readonly queries: QueryService;
  readonly cleanup: CleanupService;
  readonly scans: ReceiptScanService;

  constructor(
    readonly db: Db,
    readonly storage: PrivateStorage,
    joinCodeKey: string,
    readonly retention = new RetentionPolicy(),
    receiptReader: ReceiptReader | null = null,
  ) {
    const codes = new JoinCodeCodec(joinCodeKey);
    this.limiter = new RateLimiter(db);
    this.sessions = new SessionManager(db);
    this.events = new EventService(db, codes, this.limiter);
    this.receipts = new ReceiptService(db, this.limiter);
    this.payments = new PaymentService(db, this.limiter);
    this.recovery = new RecoveryService(db, this.limiter);
    this.assets = new AssetService(db, storage, this.limiter);
    this.cleanup = new CleanupService(db, storage, this.events, retention);
    this.scans = new ReceiptScanService(db, this.assets, this.limiter, receiptReader);
    this.queries = new QueryService(db, new EventViewBuilder(db, this.events, retention, { receiptScan: this.scans.enabled }));
  }
}

const g = globalThis as unknown as { __ateanneContainer?: AppContainer };

export function container(): AppContainer {
  if (!g.__ateanneContainer) {
    const cfg = config();
    const db = prisma();
    const storage = cfg.STORAGE_DRIVER === "disk" ? new LocalDiskStorage(cfg.PRIVATE_UPLOAD_DIR) : new DatabaseStorage(db);
    g.__ateanneContainer = new AppContainer(db, storage, cfg.JOIN_CODE_HASH_KEY, new RetentionPolicy(cfg.EVENT_RETENTION_DAYS), chooseReceiptReader(cfg));
  }
  return g.__ateanneContainer;
}

/** Fake (tests, never Vercel production) → explicit provider → Groq (free tier) → Claude → none (Scan hidden). */
export function chooseReceiptReader(cfg: Pick<ReturnType<typeof config>, "RECEIPT_SCAN_FAKE" | "RECEIPT_SCAN_PROVIDER" | "GROQ_API_KEY" | "GROQ_VISION_MODEL" | "ANTHROPIC_API_KEY" | "RECEIPT_SCAN_MODEL">): ReceiptReader | null {
  if (cfg.RECEIPT_SCAN_FAKE === "1" && process.env.VERCEL_ENV !== "production") return new FakeReceiptReader();
  const groq = cfg.GROQ_API_KEY ? () => new GroqReceiptReader(cfg.GROQ_API_KEY!, cfg.GROQ_VISION_MODEL) : null;
  const claude = cfg.ANTHROPIC_API_KEY ? () => new ClaudeReceiptReader(cfg.ANTHROPIC_API_KEY!, cfg.RECEIPT_SCAN_MODEL) : null;
  if (cfg.RECEIPT_SCAN_PROVIDER === "groq") return groq?.() ?? null;
  if (cfg.RECEIPT_SCAN_PROVIDER === "claude") return claude?.() ?? null;
  return groq?.() ?? claude?.() ?? null;
}
