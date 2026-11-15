/** Daily housekeeping (cron): `npm run data:cleanup`. Same job as POST /api/maintenance/cleanup. */
import "dotenv/config";
import { AppContainer } from "../src/server/container";
import { createPrisma } from "../src/server/db";
import { LocalDiskStorage } from "../src/server/storage/PrivateStorage";

const db = createPrisma(process.env.DATABASE_URL!);
const app = new AppContainer(db, new LocalDiskStorage(process.env.PRIVATE_UPLOAD_DIR ?? "./storage/uploads"), process.env.JOIN_CODE_HASH_KEY!);
app.cleanup
  .run()
  .then((r) => console.log(JSON.stringify({ at: new Date().toISOString(), ...r })))
  .finally(() => db.$disconnect());
