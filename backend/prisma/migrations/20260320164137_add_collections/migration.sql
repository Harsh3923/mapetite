-- AlterTable
ALTER TABLE "saved_places" ADD COLUMN     "collection_id" TEXT;

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#FF8C00',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collections_user_id_idx" ON "collections"("user_id");

-- CreateIndex
CREATE INDEX "saved_places_collection_id_idx" ON "saved_places"("collection_id");

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
