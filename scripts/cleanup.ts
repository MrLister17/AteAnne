/** Daily housekeeping (cron): `npm run data:cleanup`. Same job as POST /api/maintenance/cleanup. */
import "dotenv/config";
import { AppContainer } from "../src/server/container";
import { RetentionPolicy } from "../src/domain/event/RetentionPolicy";
import { createPrisma } from "../src/server/db";
import { DatabaseStorage, LocalDiskStorage } from "../src/server/storage/PrivateStorage";

const db = createPrisma(process.env.DATABASE_URL!);
const storage = process.env.STORAGE_DRIVER === "disk" ? new LocalDiskStorage(process.env.PRIVATE_UPLOAD_DIR ?? "./storage/uploads") : new DatabaseStorage(db);
const app = new AppContainer(db, storage, process.env.JOIN_CODE_HASH_KEY!, new RetentionPolicy(Number(process.env.EVENT_RETENTION_DAYS ?? 30)));
app.cleanup
  .run()
  .then((r) => console.log(JSON.stringify({ at: new Date().toISOString(), ...r })))
  .finally(() => db.$disconnect());
