import "dotenv/config";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
process.env.RATE_LIMIT_DISABLED = "1";
process.env.NODE_ENV = "test";
