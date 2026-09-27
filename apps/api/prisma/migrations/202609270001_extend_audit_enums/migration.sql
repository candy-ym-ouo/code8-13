-- Extend audit enums for shelf locations and physical copies.
-- Kept in its own migration so the ALTER TYPE ... ADD VALUE statements
-- commit before later migrations reference the new values.

ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'SHELF_LOCATION';
ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'BOOK_COPY';

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'MOVED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ARCHIVED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'UNARCHIVED';
