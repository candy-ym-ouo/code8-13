-- Shelf locations, physical book copies (multiple copies per book),
-- and the append-only location migration history.

-- CreateEnum
CREATE TYPE "ShelfLocationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BookCopyStatus" AS ENUM ('SHELVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CopyMoveAction" AS ENUM ('PLACED', 'MOVED', 'REMOVED', 'ARCHIVED', 'UNARCHIVED');

-- CreateTable
CREATE TABLE "shelf_locations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "status" "ShelfLocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "shelf_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_copies" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "copy_number" INTEGER NOT NULL,
    "label" VARCHAR(300),
    "condition" VARCHAR(100),
    "acquired_at" TIMESTAMPTZ(3),
    "notes" VARCHAR(5000),
    "current_location_id" UUID,
    "status" "BookCopyStatus" NOT NULL DEFAULT 'SHELVED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "book_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copy_location_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "copy_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "action" "CopyMoveAction" NOT NULL,
    "from_location_id" UUID,
    "to_location_id"   UUID,
    "from_snapshot" VARCHAR(200),
    "to_snapshot"   VARCHAR(200),
    "note" VARCHAR(1000),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copy_location_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_book_id_copy_number_key" ON "book_copies"("book_id", "copy_number");

-- CreateIndex
CREATE INDEX "shelf_locations_user_id_status_name_idx" ON "shelf_locations"("user_id", "status", "name");

-- CreateIndex
CREATE INDEX "book_copies_user_id_deleted_at_updated_at_idx" ON "book_copies"("user_id", "deleted_at", "updated_at");

-- CreateIndex
CREATE INDEX "book_copies_book_id_deleted_at_idx" ON "book_copies"("book_id", "deleted_at");

-- CreateIndex
CREATE INDEX "book_copies_current_location_id_status_deleted_at_idx" ON "book_copies"("current_location_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "copy_location_events_copy_id_occurred_at_idx" ON "copy_location_events"("copy_id", "occurred_at");

-- CreateIndex
CREATE INDEX "copy_location_events_user_id_occurred_at_idx" ON "copy_location_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "copy_location_events_book_id_occurred_at_idx" ON "copy_location_events"("book_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "shelf_locations" ADD CONSTRAINT "shelf_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_current_location_id_fkey" FOREIGN KEY ("current_location_id") REFERENCES "shelf_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_location_events" ADD CONSTRAINT "copy_location_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_location_events" ADD CONSTRAINT "copy_location_events_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "book_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_location_events" ADD CONSTRAINT "copy_location_events_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_location_events" ADD CONSTRAINT "copy_location_events_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "shelf_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_location_events" ADD CONSTRAINT "copy_location_events_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "shelf_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Location names are unique per user (archived names included, so history
-- stays identifiable); enforce it at the database level as well as in code.
CREATE UNIQUE INDEX "shelf_locations_user_id_name_key" ON "shelf_locations"("user_id", "name");
