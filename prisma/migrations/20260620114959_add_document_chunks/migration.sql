-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_chunks_category_idx" ON "document_chunks"("category");

-- CreateIndex
CREATE INDEX "document_chunks_source_idx" ON "document_chunks"("source");
