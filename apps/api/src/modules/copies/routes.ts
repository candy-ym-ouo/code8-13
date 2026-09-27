import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, zodFields } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../../lib/auth.js';
import { isRestoreWindowOpen, nextCopyNumber, normalizeText } from '../../lib/domain.js';
import { writeEvent } from '../../lib/events.js';
import { paginationFromQuery, parseId } from '../../lib/http.js';

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    z.string().trim().max(max).nullable().optional()
  );

const createCopySchema = z.object({
  label: optionalText(300),
  condition: optionalText(100),
  acquiredAt: z.string().datetime({ offset: true }).optional(),
  notes: optionalText(5000),
  locationId: z.string().uuid().nullable().optional(),
  note: optionalText(1000)
});

const updateCopySchema = z
  .object({
    label: optionalText(300),
    condition: optionalText(100),
    acquiredAt: z.string().datetime({ offset: true }).nullable().optional(),
    notes: optionalText(5000),
    version: z.number().int().positive()
  })
  .refine(
    (value) =>
      value.label !== undefined ||
      value.condition !== undefined ||
      value.acquiredAt !== undefined ||
      value.notes !== undefined,
    { message: '至少提供一个要更新的字段' }
  );

const moveCopySchema = z.object({
  locationId: z.string().uuid().nullable(),
  note: optionalText(1000),
  version: z.number().int().positive().optional()
});

const archiveCopySchema = z.object({
  note: optionalText(1000),
  version: z.number().int().positive().optional()
});

const unarchiveCopySchema = z.object({
  locationId: z.string().uuid().nullable().optional(),
  note: optionalText(1000),
  version: z.number().int().positive().optional()
});

const deleteCopySchema = z.object({ version: z.number().int().positive().optional() }).optional();

type LocationSummary = {
  id: string;
  name: string;
  status: string;
};

function serializeLocationSummary(location: LocationSummary | null | undefined) {
  if (!location) return null;
  return { id: location.id, name: location.name, status: location.status };
}

function serializeCopy(
  copy: {
    id: string;
    bookId: string;
    copyNumber: number;
    label: string | null;
    condition: string | null;
    acquiredAt: Date | null;
    notes: string | null;
    status: string;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  },
  location: LocationSummary | null = null
) {
  return {
    id: copy.id,
    bookId: copy.bookId,
    copyNumber: copy.copyNumber,
    label: copy.label,
    condition: copy.condition,
    acquiredAt: copy.acquiredAt,
    notes: copy.notes,
    status: copy.status,
    location: serializeLocationSummary(location),
    version: copy.version,
    createdAt: copy.createdAt,
    updatedAt: copy.updatedAt
  };
}

function serializeHistoryEvent(event: {
  id: string;
  copyId: string;
  bookId: string;
  action: string;
  fromSnapshot: string | null;
  toSnapshot: string | null;
  note: string | null;
  occurredAt: Date;
  fromLocation: LocationSummary | null;
  toLocation: LocationSummary | null;
}) {
  return {
    id: event.id,
    copyId: event.copyId,
    bookId: event.bookId,
    action: event.action,
    fromLocation: serializeLocationSummary(event.fromLocation),
    toLocation: serializeLocationSummary(event.toLocation),
    // Snapshot names are kept because the history must stay legible even if a
    // location is renamed or its record deleted.
    fromName: event.fromSnapshot,
    toName: event.toSnapshot,
    note: event.note,
    occurredAt: event.occurredAt
  };
}

function assertVersion(current: number, requested?: number): void {
  if (requested && requested !== current) {
    throw new AppError(409, 'STALE_WRITE', '副本已在其他位置被修改，请刷新后重试');
  }
}

async function requireBook(userId: string, bookId: string) {
  const book = await prisma.book.findFirst({ where: { id: bookId, userId, deletedAt: null } });
  if (!book) throw new AppError(404, 'NOT_FOUND', '书目不存在');
  return book;
}

async function requireOwnedCopy(userId: string, copyId: string, includeDeleted = false) {
  const copy = await prisma.bookCopy.findFirst({
    where: { id: copyId, userId, ...(includeDeleted ? {} : { deletedAt: null }) },
    include: { book: true, currentLocation: true }
  });
  if (!copy || copy.book.deletedAt) throw new AppError(404, 'NOT_FOUND', '实体副本不存在');
  return copy;
}

async function requireActiveLocation(userId: string, locationId: string | null | undefined) {
  if (locationId === null || locationId === undefined) return null;
  const location = await prisma.shelfLocation.findFirst({ where: { id: locationId, userId } });
  if (!location) throw new AppError(404, 'NOT_FOUND', '书架位置不存在');
  if (location.status !== 'ACTIVE') {
    throw new AppError(409, 'LOCATION_ARCHIVED', '书架位置已归档，不能放入副本');
  }
  return location;
}

export const copyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/books/:bookId/copies', async (request) => {
    const bookId = parseId((request.params as { bookId: string }).bookId, 'bookId');
    const userId = currentUser(request).id;
    const { page, pageSize, skip } = paginationFromQuery(request);
    await requireBook(userId, bookId);

    const where = { bookId, userId, deletedAt: null };
    const [total, copies] = await Promise.all([
      prisma.bookCopy.count({ where }),
      prisma.bookCopy.findMany({
        where,
        orderBy: [{ copyNumber: 'asc' }],
        skip,
        take: pageSize,
        include: { currentLocation: true }
      })
    ]);

    return {
      items: copies.map((copy) => serializeCopy(copy, copy.currentLocation)),
      pagination: { page, pageSize, total }
    };
  });

  app.post('/books/:bookId/copies', async (request, reply) => {
    const bookId = parseId((request.params as { bookId: string }).bookId, 'bookId');
    const parsed = createCopySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '副本信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    await requireBook(userId, bookId);
    const location = await requireActiveLocation(userId, parsed.data.locationId);
    const acquiredAt = parsed.data.acquiredAt ? new Date(parsed.data.acquiredAt) : null;
    if (acquiredAt && acquiredAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new AppError(422, 'VALIDATION_ERROR', '入藏时间不能晚于当前时间', {
        acquiredAt: '入藏时间不能晚于当前时间'
      });
    }
    const note = parsed.data.note ? normalizeText(parsed.data.note) : null;

    let copy;
    try {
      copy = await prisma.$transaction(async (tx) => {
        const aggregate = await tx.bookCopy.aggregate({
          where: { bookId },
          _max: { copyNumber: true }
        });
        // nextCopyNumber takes the max over ALL rows (including soft-deleted),
        // so a deleted number is never reused and restore cannot collide.
        const copyNumber = nextCopyNumber(
          aggregate._max.copyNumber ? [aggregate._max.copyNumber] : []
        );
        const created = await tx.bookCopy.create({
          data: {
            userId,
            bookId,
            copyNumber,
            label: parsed.data.label ? normalizeText(parsed.data.label) : null,
            condition: parsed.data.condition ? normalizeText(parsed.data.condition) : null,
            acquiredAt,
            notes: parsed.data.notes ? normalizeText(parsed.data.notes) : null,
            currentLocationId: location ? location.id : null
          }
        });
        await tx.copyLocationEvent.create({
          data: {
            userId,
            copyId: created.id,
            bookId,
            action: location ? 'PLACED' : 'REMOVED',
            fromLocationId: null,
            toLocationId: location ? location.id : null,
            fromSnapshot: null,
            toSnapshot: location ? location.name : null,
            note
          }
        });
        await writeEvent(tx, {
          userId,
          bookId,
          entityType: 'BOOK_COPY',
          entityId: created.id,
          action: 'CREATED',
          payload: {
            copyNumber,
            locationName: location ? location.name : null
          }
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'COPY_NUMBER_CONFLICT', '副本编号冲突，请重试');
      }
      throw error;
    }
    return reply.status(201).send({ copy: serializeCopy(copy, location) });
  });

  app.get('/copies/:copyId', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const userId = currentUser(request).id;
    const copy = await requireOwnedCopy(userId, copyId);
    return { copy: serializeCopy(copy, copy.currentLocation) };
  });

  app.get('/copies/:copyId/history', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const userId = currentUser(request).id;
    await requireOwnedCopy(userId, copyId, true);
    const events = await prisma.copyLocationEvent.findMany({
      where: { copyId, userId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      include: {
        fromLocation: { select: { id: true, name: true, status: true } },
        toLocation: { select: { id: true, name: true, status: true } }
      }
    });
    return { items: events.map(serializeHistoryEvent) };
  });

  app.patch('/copies/:copyId', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const parsed = updateCopySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '副本信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const existing = await requireOwnedCopy(userId, copyId);
    assertVersion(existing.version, parsed.data.version);

    const data: Record<string, string | Date | null> = {};
    if (parsed.data.label !== undefined) {
      data.label = parsed.data.label ? normalizeText(parsed.data.label) : null;
    }
    if (parsed.data.condition !== undefined) {
      data.condition = parsed.data.condition ? normalizeText(parsed.data.condition) : null;
    }
    if (parsed.data.acquiredAt !== undefined) {
      data.acquiredAt = parsed.data.acquiredAt ? new Date(parsed.data.acquiredAt) : null;
    }
    if (parsed.data.notes !== undefined) {
      data.notes = parsed.data.notes ? normalizeText(parsed.data.notes) : null;
    }

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
        payload: { copyNumber: existing.copyNumber }
      });
      return tx.bookCopy.findUniqueOrThrow({
        where: { id: copyId },
        include: { currentLocation: true }
      });
    });
    return { copy: serializeCopy(updated, updated.currentLocation) };
  });

  app.post('/copies/:copyId/move', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const parsed = moveCopySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '移动信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const existing = await requireOwnedCopy(userId, copyId);
    assertVersion(existing.version, parsed.data.version);
    if (existing.status !== 'SHELVED') {
      throw new AppError(409, 'COPY_ARCHIVED', '副本已归档，请先取消归档再移动');
    }

    const target = await requireActiveLocation(userId, parsed.data.locationId);
    const fromLocation = existing.currentLocationId
      ? await prisma.shelfLocation.findUnique({ where: { id: existing.currentLocationId } })
      : null;

    // Moving to the exact same shelf is a no-op, but "no shelf" -> "no shelf"
    // is also reported as unchanged rather than writing noise into the audit log.
    const fromId = fromLocation ? fromLocation.id : null;
    const toId = target ? target.id : null;
    if (fromId === toId) {
      return { copy: serializeCopy(existing, existing.currentLocation), unchanged: true };
    }

    const note = parsed.data.note ? normalizeText(parsed.data.note) : null;
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.bookCopy.updateMany({
        where: { id: copyId, userId, deletedAt: null, version: existing.version },
        data: { currentLocationId: toId, version: { increment: 1 } }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '副本已在其他位置被修改');
      await tx.copyLocationEvent.create({
        data: {
          userId,
          copyId,
          bookId: existing.bookId,
          // Shelf -> shelf is a move; onto a shelf from nowhere is a placement;
          // off a shelf into nowhere is a removal.
          action: toId === null ? 'REMOVED' : fromId === null ? 'PLACED' : 'MOVED',
          fromLocationId: fromId,
          toLocationId: toId,
          fromSnapshot: fromLocation ? fromLocation.name : null,
          toSnapshot: target ? target.name : null,
          note
        }
      });
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'MOVED',
        payload: {
          copyNumber: existing.copyNumber,
          fromLocationName: fromLocation ? fromLocation.name : null,
          toLocationName: target ? target.name : null,
          removed: toId === null
        }
      });
      return tx.bookCopy.findUniqueOrThrow({
        where: { id: copyId },
        include: { currentLocation: true }
      });
    });
    return { copy: serializeCopy(updated, updated.currentLocation) };
  });

  app.post('/copies/:copyId/archive', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const parsed = archiveCopySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '归档信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const existing = await requireOwnedCopy(userId, copyId);
    assertVersion(existing.version, parsed.data.version);
    if (existing.status === 'ARCHIVED') {
      throw new AppError(409, 'COPY_ALREADY_ARCHIVED', '副本已经归档');
    }
    const fromLocation = existing.currentLocationId
      ? await prisma.shelfLocation.findUnique({ where: { id: existing.currentLocationId } })
      : null;
    const note = parsed.data.note ? normalizeText(parsed.data.note) : null;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.bookCopy.updateMany({
        where: { id: copyId, userId, deletedAt: null, version: existing.version },
        data: { status: 'ARCHIVED', currentLocationId: null, version: { increment: 1 } }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '副本已在其他位置被修改');
      await tx.copyLocationEvent.create({
        data: {
          userId,
          copyId,
          bookId: existing.bookId,
          action: 'ARCHIVED',
          fromLocationId: fromLocation ? fromLocation.id : null,
          toLocationId: null,
          fromSnapshot: fromLocation ? fromLocation.name : null,
          toSnapshot: null,
          note
        }
      });
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'ARCHIVED',
        payload: {
          copyNumber: existing.copyNumber,
          fromLocationName: fromLocation ? fromLocation.name : null
        }
      });
      return tx.bookCopy.findUniqueOrThrow({
        where: { id: copyId },
        include: { currentLocation: true }
      });
    });
    return { copy: serializeCopy(updated, updated.currentLocation) };
  });

  app.post('/copies/:copyId/unarchive', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const parsed = unarchiveCopySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '取消归档信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const existing = await requireOwnedCopy(userId, copyId);
    assertVersion(existing.version, parsed.data.version);
    if (existing.status !== 'ARCHIVED') {
      throw new AppError(409, 'COPY_NOT_ARCHIVED', '副本未归档');
    }
    const target =
      parsed.data.locationId === undefined
        ? null
        : await requireActiveLocation(userId, parsed.data.locationId);
    const note = parsed.data.note ? normalizeText(parsed.data.note) : null;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.bookCopy.updateMany({
        where: { id: copyId, userId, deletedAt: null, version: existing.version },
        data: {
          status: 'SHELVED',
          currentLocationId: target ? target.id : null,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '副本已在其他位置被修改');
      await tx.copyLocationEvent.create({
        data: {
          userId,
          copyId,
          bookId: existing.bookId,
          action: 'UNARCHIVED',
          fromLocationId: null,
          toLocationId: target ? target.id : null,
          fromSnapshot: null,
          toSnapshot: target ? target.name : null,
          note
        }
      });
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'UNARCHIVED',
        payload: {
          copyNumber: existing.copyNumber,
          toLocationName: target ? target.name : null
        }
      });
      return tx.bookCopy.findUniqueOrThrow({
        where: { id: copyId },
        include: { currentLocation: true }
      });
    });
    return { copy: serializeCopy(updated, updated.currentLocation) };
  });

  app.delete('/copies/:copyId', async (request, reply) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const parsed = deleteCopySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '删除参数无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const existing = await requireOwnedCopy(userId, copyId);
    assertVersion(existing.version, parsed.data?.version);

    const fromLocation = existing.currentLocationId
      ? await prisma.shelfLocation.findUnique({ where: { id: existing.currentLocationId } })
      : null;

    // Soft delete of one copy only. Other copies of the same book are never
    // touched: the row stays (with copy_number retained), location history and
    // audit events remain intact for the 24h restore window and beyond.
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const result = await tx.bookCopy.updateMany({
        where: { id: copyId, userId, deletedAt: null, version: existing.version },
        data: {
          deletedAt: now,
          currentLocationId: null,
          status: 'ARCHIVED',
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) throw new AppError(409, 'STALE_WRITE', '副本已在其他位置被修改');
      if (fromLocation) {
        await tx.copyLocationEvent.create({
          data: {
            userId,
            copyId,
            bookId: existing.bookId,
            action: 'REMOVED',
            fromLocationId: fromLocation.id,
            toLocationId: null,
            fromSnapshot: fromLocation.name,
            toSnapshot: null,
            note: '删除副本时自动移出书架'
          }
        });
      }
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'DELETED',
        payload: {
          copyNumber: existing.copyNumber,
          fromLocationName: fromLocation ? fromLocation.name : null
        }
      });
    });
    return reply.status(204).send();
  });

  app.post('/copies/:copyId/restore', async (request) => {
    const copyId = parseId((request.params as { copyId: string }).copyId, 'copyId');
    const userId = currentUser(request).id;
    const existing = await requireOwnedCopy(userId, copyId, true);
    if (!existing.deletedAt) throw new AppError(404, 'NOT_FOUND', '已删除副本不存在');
    if (!isRestoreWindowOpen(existing.deletedAt)) {
      throw new AppError(409, 'RESTORE_WINDOW_EXPIRED', '已超过 24 小时恢复窗口');
    }

    // Restored copies come back unassigned: their previous shelf may have moved
    // on while they were deleted, so the user must place them explicitly.
    const restored = await prisma.$transaction(async (tx) => {
      const value = await tx.bookCopy.update({
        where: { id: copyId },
        data: {
          deletedAt: null,
          status: 'SHELVED',
          currentLocationId: null,
          version: { increment: 1 }
        }
      });
      await writeEvent(tx, {
        userId,
        bookId: existing.bookId,
        entityType: 'BOOK_COPY',
        entityId: copyId,
        action: 'RESTORED',
        payload: { copyNumber: existing.copyNumber }
      });
      return value;
    });
    return { copy: serializeCopy(restored, null) };
  });
};
