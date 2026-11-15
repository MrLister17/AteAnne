-- CreateTable
CREATE TABLE "AssetBlob" (
    "key" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetBlob_pkey" PRIMARY KEY ("key")
);
