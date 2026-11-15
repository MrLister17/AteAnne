import { config } from "./config";
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
import { LocalDiskStorage, PrivateStorage } from "./storage/PrivateStorage";

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

  constructor(
    readonly db: Db,
    readonly storage: PrivateStorage,
    joinCodeKey: string,
  ) {
    const codes = new JoinCodeCodec(joinCodeKey);
    this.limiter = new RateLimiter(db);
    this.sessions = new SessionManager(db);
    this.events = new EventService(db, codes, this.limiter);
    this.receipts = new ReceiptService(db, this.limiter);
    this.payments = new PaymentService(db, this.limiter);
    this.recovery = new RecoveryService(db, this.limiter);
    this.assets = new AssetService(db, storage, this.limiter);
    this.queries = new QueryService(db, new EventViewBuilder(db, this.events));
    this.cleanup = new CleanupService(db, storage, this.events);
  }
}

const g = globalThis as unknown as { __ateanneContainer?: AppContainer };

export function container(): AppContainer {
  if (!g.__ateanneContainer) {
    const cfg = config();
    g.__ateanneContainer = new AppContainer(prisma(), new LocalDiskStorage(cfg.PRIVATE_UPLOAD_DIR), cfg.JOIN_CODE_HASH_KEY);
  }
  return g.__ateanneContainer;
}
