import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, zodFields } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../../lib/auth.js';
import { isRestoreWindowOpen, normalizeText, validateCopyStatusTransition } from '../../lib/domain.js';
import { writeEvent } from '../../lib/events.js';
import { parseId } from '../../lib/http.js';

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    z.string().trim().max(max).nullable().optional()
  );

const createCopySchema = z.object({
  locationId: z.string().uuid().nullable().optional(),
  label: nullableText(100),
  note: nullableText(500)
});

const updateCopySchema = z
  .object({
    label: nullableText(100),
    note: nullableText(500),
    version: z.number().int().positive().optional()
  })
  .refine((value) => value.label !== undefined || value.note !== undefined, {
    message: '至少提供一个要更新的字段'
  });

const moveCopySchema = z.object({
  toLocationId: z.string().uuid().nullable(),
  reason: nullableText(500),
  version: z.number().int().positive().optional()
});

const versionedSchema = z.object({ version: z.number().int().positive().optional() }).optional();

type CopyWithLocation = {
  id: string;
  bookId: string;
  locationId: string | null;
  copyNo: number;
  label: string | null;
  note: string | null;
  status: 'ON_SHELF' | 'ARCHIVED';
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  location: { name: string } | null;
};

function serializeCopy(copy: CopyWithLocation) {
  return {
    id: copy.id,
    bookId: copy.bookId,
    copyNo: copy.copyNo,
    label: copy.label,
    note: copy.note,
    status: copy.status,
    locationId: copy.locationId,
    locationName: copy.location?.name ?? null,
    archivedAt: copy.archivedAt,
    version: copy.version,
    createdAt: copy.createdAt,
    updatedAt: copy.updatedAt
  };
}

function serializeMovement(movement: {
  id: string;
  copyId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  reason: string | null;
  movedAt: Date;
  fromLocation: { name: string } | null;
  toLocation: { name: string } | null;
}) {
  return {
    id: movement.id,
    copyId: movement.copyId,
    fromLocationId: movement.fromLocationId,
    fromLocationName: movement.fromLocation?.name ?? null,
    toLocationId: movement.toLocationId,
    toLocationName: movement.toLocation?.name ?? null,
    reason: movement.reason,
    movedAt: movement.movedAt
  };
}

function assertVersion(current: number, requested?: number): void {
  if (requested && requested !== current) {
    throw new AppError(409, 'STALE_WRITE', '副本已在其他位置被修改，请刷新后重试');
  }
}

async function assertLocationUsable(userId: string, locationId: string): Promise<{ id: string; name: string }> {
  const location = await prisma.shelfLocation.findFirst({
    where: { id: locationId, userId, deletedAt: null },
    select: { id: true, name: true }
  });
  if (!location) throw new AppError(404, 'NOT_FOUND', '目标位置不存在');
  return location;
}

export const copyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/books/:bookId/copies', async (request) => {
    const bookId = parseId((request.params as { bookId: string }).bookId, 'bookId');
    const userId = currentUser(request).id;
    const book = await prisma.book.findFirst({ where: { id: bookId, userId, deletedAt: null } });
    if (!book) throw new AppError(404, 'NOT_FOUND', '书目不存在');
    const copies = await prisma.bookCopy.findMany({
      where: { bookId, userId, deletedAt: null },
      orderBy: [{ copyNo: 'asc' }],
      include: { location: { select: { name: true } } }
    });
    return { items: copies.map(serializeCopy) };
  });

  app.post('/books/:bookId/copies', async (request, reply) => {
    const bookId = parseId((request.params as { bookId: string }).bookId, 'bookId');
    const parsed = createCopySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '副本信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const book = await prisma.book.findFirst({ where: { id: bookId, userId, deletedAt: null } });
    if (!book) throw new AppError(404, 'NOT_FOUND', '书目不存在');
    const locationId = parsed.data.locationId ?? null;
    const location = locationId ? await assertLocationUsable(userId, locationId) : null;

    const copy = await prisma.$transaction(async (tx) => {
      const latest = await tx.bookCopy.aggregate({
        where: { bookId },
        _max: { copyNo: true }
      });
      const created = await tx.bookCopy.create({
        data: {
          userId,
          bookId,
          locationId: location?.id ?? null,
          copyNo: (latest._max.copyNo ?? 0) + 1,
          label: parsed.data.label ? normalizeText(parsed.data.label) : null,
          note: parsed.data.note ? normalizeText(parsed.data.note) : null
        },
        include: { location: { select: { name: true } } }
      });
      if (location) {
        await tx.copyMovement.create({
          data: { userId, copyId: created.id, fromLocationId: null, toLocationId: location.id }
        });
      }
      await writeEvent(tx, {
        userId,
        bookId,
        entityType: 'BOOK_COPY',
        entityId: created.id,
        action: 'CREATED',
        payload: { copyNo: created.copyNo, label: created.label, locationName: location?.name ?? null }
      });
      return created;
    });
    return reply.status(201).send({ copy: serializeCopy(copy) });
  });

  app.patch('/copies/:copyId', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const parsed = updateCopySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '副本信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const existing = await prisma.bookCopy.findFirst({
      where: { id: copyId, userId, deletedAt: null },
      include: { book: true }
    });
    if (!existing || existing.book.deletedAt) throw new AppError(404, 'NOT_FOUND', '副本不存在');
    assertVersion(existing.version, parsed.data.version);

    const data: { label?: string | null; note?: string | null } = {};
    if (parsed.data.label !== undefined) data.label = parsed.data.label ? normalizeText(parsed.data.label) : null;
    if (parsed.data.note !== undefined) data.note = parsed.data.note ? normalizeText(parsed.data.note) : null;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.bookCopy.updateMany({
        where: { id: copyId, userId, deletedAt: null, version: existing.version },
        data: { ...data, version: { increment: 1 } }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '副本已在其他位置被修改');
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'UPDATED',
        payload: { copyNo: existing.copyNo, label: data.label !== undefined ? data.label : existing.label }
      });
      return tx.bookCopy.findUniqueOrThrow({
        where: { id: copyId },
        include: { location: { select: { name: true } } }
      });
    });
    return { copy: serializeCopy(updated) };
  });

  app.post('/copies/:copyId/move', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const parsed = moveCopySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '移动信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const target = parsed.data.toLocationId
      ? await assertLocationUsable(userId, parsed.data.toLocationId)
      : null;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM book_copies WHERE id = ${copyId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
      const copy = await tx.bookCopy.findFirst({
        where: { id: copyId, userId, deletedAt: null },
        include: { book: true, location: { select: { name: true } } }
      });
      if (!copy || copy.book.deletedAt) throw new AppError(404, 'NOT_FOUND', '副本不存在');
      assertVersion(copy.version, parsed.data.version);
      const toLocationId = target?.id ?? null;
      if (copy.locationId === toLocationId) {
        throw new AppError(409, 'COPY_LOCATION_UNCHANGED', '副本已在该位置');
      }
      const reason = parsed.data.reason ? normalizeText(parsed.data.reason) : null;
      const movedAt = new Date();
      const movement = await tx.copyMovement.create({
        data: {
          userId,
          copyId,
          fromLocationId: copy.locationId,
          toLocationId,
          reason,
          movedAt
        }
      });
      const updated = await tx.bookCopy.update({
        where: { id: copyId },
        data: { locationId: toLocationId, version: { increment: 1 } },
        include: { location: { select: { name: true } } }
      });
      await writeEvent(tx, {
        userId,
        bookId: copy.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'MOVED',
        payload: {
          copyNo: copy.copyNo,
          fromLocationName: copy.location?.name ?? null,
          toLocationName: target?.name ?? null,
          reason
        }
      });
      return { copy: updated, movementId: movement.id };
    });
    return { copy: serializeCopy(result.copy), movementId: result.movementId };
  });

  app.post('/copies/:copyId/archive', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const parsed = versionedSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '归档参数无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM book_copies WHERE id = ${copyId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
      const copy = await tx.bookCopy.findFirst({
        where: { id: copyId, userId, deletedAt: null },
        include: { book: true, location: { select: { name: true } } }
      });
      if (!copy || copy.book.deletedAt) throw new AppError(404, 'NOT_FOUND', '副本不存在');
      assertVersion(copy.version, parsed.data?.version);
      validateCopyStatusTransition(copy.status, 'ARCHIVED');
      const value = await tx.bookCopy.update({
        where: { id: copyId },
        data: { status: 'ARCHIVED', archivedAt: new Date(), version: { increment: 1 } },
        include: { location: { select: { name: true } } }
      });
      await writeEvent(tx, {
        userId,
        bookId: copy.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'ARCHIVED',
        payload: { copyNo: copy.copyNo, locationName: copy.location?.name ?? null }
      });
      return value;
    });
    return { copy: serializeCopy(updated) };
  });

  app.post('/copies/:copyId/unarchive', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const parsed = versionedSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '参数无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM book_copies WHERE id = ${copyId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
      const copy = await tx.bookCopy.findFirst({
        where: { id: copyId, userId, deletedAt: null },
        include: { book: true, location: { select: { name: true } } }
      });
      if (!copy || copy.book.deletedAt) throw new AppError(404, 'NOT_FOUND', '副本不存在');
      assertVersion(copy.version, parsed.data?.version);
      validateCopyStatusTransition(copy.status, 'ON_SHELF');
      const value = await tx.bookCopy.update({
        where: { id: copyId },
        data: { status: 'ON_SHELF', archivedAt: null, version: { increment: 1 } },
        include: { location: { select: { name: true } } }
      });
      await writeEvent(tx, {
        userId,
        bookId: copy.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'UNARCHIVED',
        payload: { copyNo: copy.copyNo, locationName: copy.location?.name ?? null }
      });
      return value;
    });
    return { copy: serializeCopy(updated) };
  });

  app.delete('/copies/:copyId', async (request, reply) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const parsed = versionedSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '删除参数无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    await prisma.$transaction(async (tx) => {
      const copy = await tx.bookCopy.findFirst({
        where: { id: copyId, userId, deletedAt: null },
        include: { book: true }
      });
      if (!copy || copy.book.deletedAt) throw new AppError(404, 'NOT_FOUND', '副本不存在');
      assertVersion(copy.version, parsed.data?.version);
      // 只软删除当前这一册；同书的其他副本与其位置归属保持不变。
      const result = await tx.bookCopy.updateMany({
        where: { id: copyId, userId, deletedAt: null, version: copy.version },
        data: { deletedAt: new Date(), version: { increment: 1 } }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '副本已在其他位置被修改');
      await writeEvent(tx, {
        userId,
        bookId: copy.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'DELETED',
        payload: { copyNo: copy.copyNo, label: copy.label }
      });
    });
    return reply.status(204).send();
  });

  app.post('/copies/:copyId/restore', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const userId = currentUser(request).id;
    const existing = await prisma.bookCopy.findFirst({
      where: { id: copyId, userId },
      include: { book: true, location: { select: { name: true, deletedAt: true } } }
    });
    if (!existing || !existing.deletedAt) throw new AppError(404, 'NOT_FOUND', '已删除副本不存在');
    if (!isRestoreWindowOpen(existing.deletedAt)) {
      throw new AppError(409, 'RESTORE_WINDOW_EXPIRED', '已超过 24 小时恢复窗口');
    }
    if (existing.book.deletedAt) throw new AppError(409, 'BOOK_DELETED', '所属书目已删除');
    if (existing.location?.deletedAt) {
      throw new AppError(409, 'LOCATION_DELETED', '副本原位置已删除，请先恢复该位置');
    }
    const restored = await prisma.$transaction(async (tx) => {
      const value = await tx.bookCopy.update({
        where: { id: copyId },
        data: { deletedAt: null, version: { increment: 1 } },
        include: { location: { select: { name: true } } }
      });
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'RESTORED',
        payload: { copyNo: existing.copyNo, locationName: value.location?.name ?? null }
      });
      return value;
    });
    return { copy: serializeCopy(restored) };
  });

  app.get('/copies/:copyId/movements', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const userId = currentUser(request).id;
    const copy = await prisma.bookCopy.findFirst({
      where: { id: copyId, userId, deletedAt: null }
    });
    if (!copy) throw new AppError(404, 'NOT_FOUND', '副本不存在');
    const movements = await prisma.copyMovement.findMany({
      where: { copyId, userId },
      orderBy: [{ movedAt: 'asc' }, { id: 'asc' }],
      include: {
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } }
      }
    });
    return { items: movements.map(serializeMovement) };
  });
};
