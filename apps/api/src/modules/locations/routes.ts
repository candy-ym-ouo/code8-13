import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, zodFields } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../../lib/auth.js';
import { isRestoreWindowOpen, normalizeText } from '../../lib/domain.js';
import { writeEvent } from '../../lib/events.js';
import { paginationFromQuery, parseId } from '../../lib/http.js';

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    z.string().trim().max(max).nullable().optional()
  );

const createLocationSchema = z.object({
  name: z.string().trim().min(1, '请输入位置名称').max(100),
  note: nullableText(500)
});

const updateLocationSchema = z
  .object({
    name: z.string().trim().min(1, '请输入位置名称').max(100).optional(),
    note: nullableText(500),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    version: z.number().int().positive().optional()
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), {
    message: '至少提供一个要更新的字段'
  });

const deleteSchema = z.object({ version: z.number().int().positive().optional() }).optional();

function serializeLocation(location: {
  id: string;
  name: string;
  note: string | null;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: location.id,
    name: location.name,
    note: location.note,
    sortOrder: location.sortOrder,
    version: location.version,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt
  };
}

function serializeCopyOnShelf(copy: {
  id: string;
  bookId: string;
  copyNo: number;
  label: string | null;
  status: 'ON_SHELF' | 'ARCHIVED';
  book: { title: string };
}) {
  return {
    id: copy.id,
    bookId: copy.bookId,
    bookTitle: copy.book.title,
    copyNo: copy.copyNo,
    label: copy.label,
    status: copy.status
  };
}

function assertVersion(current: number, requested?: number): void {
  if (requested && requested !== current) {
    throw new AppError(409, 'STALE_WRITE', '位置已在其他位置被修改，请刷新后重试');
  }
}

export const locationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/locations', async (request) => {
    const userId = currentUser(request).id;
    const locations = await prisma.shelfLocation.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        _count: {
          select: {
            copies: { where: { deletedAt: null } }
          }
        }
      }
    });
    return {
      items: locations.map((location) => ({
        ...serializeLocation(location),
        copyCount: location._count.copies
      }))
    };
  });

  app.post('/locations', async (request, reply) => {
    const parsed = createLocationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '位置信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const location = await prisma.$transaction(async (tx) => {
      const latest = await tx.shelfLocation.aggregate({
        where: { userId },
        _max: { sortOrder: true }
      });
      const created = await tx.shelfLocation.create({
        data: {
          userId,
          name: normalizeText(parsed.data.name),
          note: parsed.data.note ? normalizeText(parsed.data.note) : null,
          sortOrder: (latest._max.sortOrder ?? 0) + 1
        }
      });
      await writeEvent(tx, {
        userId,
        entityType: 'SHELF_LOCATION',
        entityId: created.id,
        action: 'CREATED',
        payload: { locationName: created.name }
      });
      return created;
    });
    return reply.status(201).send({ location: { ...serializeLocation(location), copyCount: 0 } });
  });

  app.get('/locations/:locationId', async (request) => {
    const locationId = parseId((request.params as { locationId: string }).locationId, 'locationId');
    const { page, pageSize, skip } = paginationFromQuery(request);
    const userId = currentUser(request).id;
    const location = await prisma.shelfLocation.findFirst({
      where: { id: locationId, userId, deletedAt: null }
    });
    if (!location) throw new AppError(404, 'NOT_FOUND', '位置不存在');

    const where = { locationId, userId, deletedAt: null };
    const [total, copies] = await Promise.all([
      prisma.bookCopy.count({ where }),
      prisma.bookCopy.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }],
        skip,
        take: pageSize,
        include: { book: { select: { title: true } } }
      })
    ]);
    return {
      location: { ...serializeLocation(location), copyCount: total },
      items: copies.map(serializeCopyOnShelf),
      pagination: { page, pageSize, total }
    };
  });

  app.patch('/locations/:locationId', async (request) => {
    const locationId = parseId((request.params as { locationId: string }).locationId, 'locationId');
    const parsed = updateLocationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '位置信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const existing = await prisma.shelfLocation.findFirst({
      where: { id: locationId, userId, deletedAt: null }
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '位置不存在');
    assertVersion(existing.version, parsed.data.version);

    const data: { name?: string; note?: string | null; sortOrder?: number } = {};
    if (parsed.data.name !== undefined) data.name = normalizeText(parsed.data.name);
    if (parsed.data.note !== undefined) data.note = parsed.data.note ? normalizeText(parsed.data.note) : null;
    if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.shelfLocation.updateMany({
        where: { id: locationId, userId, deletedAt: null, version: existing.version },
        data: { ...data, version: { increment: 1 } }
      });
      if (result.count !== 1) {
        throw new AppError(409, 'STALE_WRITE', '位置已在其他位置被修改，请刷新后重试');
      }
      await writeEvent(tx, {
        userId,
        entityType: 'SHELF_LOCATION',
        entityId: locationId,
        action: 'UPDATED',
        payload: { locationName: data.name ?? existing.name }
      });
      return tx.shelfLocation.findUniqueOrThrow({ where: { id: locationId } });
    });
    const copyCount = await prisma.bookCopy.count({
      where: { locationId, userId, deletedAt: null }
    });
    return { location: { ...serializeLocation(updated), copyCount } };
  });

  app.delete('/locations/:locationId', async (request, reply) => {
    const locationId = parseId((request.params as { locationId: string }).locationId, 'locationId');
    const parsed = deleteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '删除参数无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.shelfLocation.findFirst({
        where: { id: locationId, userId, deletedAt: null }
      });
      if (!existing) throw new AppError(404, 'NOT_FOUND', '位置不存在');
      assertVersion(existing.version, parsed.data?.version);
      const activeCopies = await tx.bookCopy.count({
        where: { locationId, deletedAt: null }
      });
      if (activeCopies > 0) {
        throw new AppError(409, 'LOCATION_NOT_EMPTY', '该位置仍有副本，请先将这些副本移动到其他位置');
      }
      const result = await tx.shelfLocation.updateMany({
        where: { id: locationId, userId, deletedAt: null, version: existing.version },
        data: { deletedAt: new Date(), version: { increment: 1 } }
      });
      if (result.count !== 1) {
        throw new AppError(409, 'STALE_WRITE', '位置已在其他位置被修改，请刷新后重试');
      }
      await writeEvent(tx, {
        userId,
        entityType: 'SHELF_LOCATION',
        entityId: locationId,
        action: 'DELETED',
        payload: { locationName: existing.name }
      });
    });
    return reply.status(204).send();
  });

  app.post('/locations/:locationId/restore', async (request) => {
    const locationId = parseId((request.params as { locationId: string }).locationId, 'locationId');
    const userId = currentUser(request).id;
    const existing = await prisma.shelfLocation.findFirst({
      where: { id: locationId, userId }
    });
    if (!existing || !existing.deletedAt) throw new AppError(404, 'NOT_FOUND', '已删除位置不存在');
    if (!isRestoreWindowOpen(existing.deletedAt)) {
      throw new AppError(409, 'RESTORE_WINDOW_EXPIRED', '已超过 24 小时恢复窗口');
    }
    const restored = await prisma.$transaction(async (tx) => {
      const value = await tx.shelfLocation.update({
        where: { id: locationId },
        data: { deletedAt: null, version: { increment: 1 } }
      });
      await writeEvent(tx, {
        userId,
        entityType: 'SHELF_LOCATION',
        entityId: locationId,
        action: 'RESTORED',
        payload: { locationName: value.name }
      });
      return value;
    });
    const copyCount = await prisma.bookCopy.count({
      where: { locationId, userId, deletedAt: null }
    });
    return { location: { ...serializeLocation(restored), copyCount } };
  });
};
