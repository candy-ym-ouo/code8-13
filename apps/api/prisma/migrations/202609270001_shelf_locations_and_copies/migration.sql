-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('ON_SHELF', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEntityType" ADD VALUE 'SHELF_LOCATION';
ALTER TYPE "ActivityEntityType" ADD VALUE 'BOOK_COPY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE 'MOVED';
ALTER TYPE "ActivityAction" ADD VALUE 'ARCHIVED';
ALTER TYPE "ActivityAction" ADD VALUE 'UNARCHIVED';

-- CreateTable
CREATE TABLE "shelf_locations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(100) NOT NULL,
    "note" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "shelf_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_copies" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "location_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "copy_no" INTEGER NOT NULL,
    "label" VARCHAR(100),
    "note" VARCHAR(500),
    "status" "CopyStatus" NOT NULL DEFAULT 'ON_SHELF',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "book_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copy_movements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "copy_id" UUID NOT NULL,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "reason" VARCHAR(500),
    "moved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copy_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shelf_locations_user_id_deleted_at_sort_order_idx" ON "shelf_locations"("user_id", "deleted_at", "sort_order");

-- CreateIndex
CREATE INDEX "book_copies_user_id_deleted_at_created_at_idx" ON "book_copies"("user_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "book_copies_book_id_deleted_at_copy_no_idx" ON "book_copies"("book_id", "deleted_at", "copy_no");

-- CreateIndex
CREATE INDEX "book_copies_location_id_deleted_at_idx" ON "book_copies"("location_id", "deleted_at");

-- CreateIndex
CREATE INDEX "copy_movements_user_id_moved_at_idx" ON "copy_movements"("user_id", "moved_at");

-- CreateIndex
CREATE INDEX "copy_movements_copy_id_moved_at_idx" ON "copy_movements"("copy_id", "moved_at");

-- AddForeignKey
ALTER TABLE "shelf_locations" ADD CONSTRAINT "shelf_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "shelf_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_movements" ADD CONSTRAINT "copy_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_movements" ADD CONSTRAINT "copy_movements_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "book_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_movements" ADD CONSTRAINT "copy_movements_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "shelf_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_movements" ADD CONSTRAINT "copy_movements_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "shelf_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

