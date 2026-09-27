import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, zodFields } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../../lib/auth.js';
import { normalizeText } from '../../lib/domain.js';
import { writeEvent } from '../../lib/events.js';
import { paginationFromQuery, parseId } from '../../lib/http.js';

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    z.string().trim().max(max).nullable().optional()
  );

const createLocationSchema = z.object({
  name: z.string().trim().min(1, '请输入位置名称').max(200),
  description: optionalText(1000)
});

const updateLocationSchema = createLocationSchema.partial().refine(
  (value) => value.name !== undefined || value.description !== undefined,
  { message: '至少提供一个要更新的字段' }
);

function serializeLocation(location: {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  activeCopyCount?: number;
}) {
  return {
    id: location.id,
    name: location.name,
    description: location.description,
    status: location.status,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
    archivedAt: location.archivedAt,
    activeCopyCount: location.activeCopyCount ?? 0
  };
}

async function findOwnedLocation(userId: string, id: string) {
  return prisma.shelfLocation.findFirst({ where: { id, userId } });
}

export const locationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/locations', async (request) => {
    const { page, pageSize, skip } = paginationFromQuery(request);
    const query = request.query as Record<string, unknown>;
    const userId = currentUser(request).id;
    const status = typeof query.status === 'string' && query.status !== 'ALL' ? query.status : undefined;
    if (status && status !== 'ACTIVE' && status !== 'ARCHIVED') {
      throw new AppError(422, 'VALIDATION_ERROR', '位置状态无效');
    }

    const where: Prisma.ShelfLocationWhereInput = {
      userId,
      ...(status ? { status: status as 'ACTIVE' | 'ARCHIVED' } : {})
    };

    const [total, locations] = await Promise.all([
      prisma.shelfLocation.count({ where }),
      prisma.shelfLocation.findMany({
        where,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip,
        take: pageSize,
        include: {
          _count: {
            select: { copies: { where: { deletedAt: null, status: 'SHELVED' } } }
          }
        }
      })
    ]);

    return {
      items: locations.map((location) => ({
        ...serializeLocation(location),
        activeCopyCount: location._count.copies
      })),
      pagination: { page, pageSize, total }
    };
  });

  app.post('/locations', async (request, reply) => {
    const parsed = createLocationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '书架位置信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const name = normalizeText(parsed.data.name);

    try {
      const location = await prisma.$transaction(async (tx) => {
        const created = await tx.shelfLocation.create({
          data: {
            userId,
            name,
            description: parsed.data.description ? normalizeText(parsed.data.description) : null
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
      return reply.status(201).send({ location: serializeLocation(location) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'LOCATION_NAME_EXISTS', '已存在同名书架位置');
      }
      throw error;
    }
  });

  app.patch('/locations/:locationId', async (request) => {
    const id = parseId((request.params as { locationId: string }).locationId, 'locationId');
    const parsed = updateLocationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', '书架位置信息无效', zodFields(parsed.error));
    }
    const userId = currentUser(request).id;
    const existing = await findOwnedLocation(userId, id);
    if (!existing) throw new AppError(404, 'NOT_FOUND', '书架位置不存在');

    const name = parsed.data.name !== undefined ? normalizeText(parsed.data.name) : existing.name;
    const description =
      parsed.data.description === undefined
        ? existing.description
        : parsed.data.description
          ? normalizeText(parsed.data.description)
          : null;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.shelfLocation.update({
          where: { id },
          data: { name, description }
        });
        await writeEvent(tx, {
          userId,
          entityType: 'SHELF_LOCATION',
          entityId: id,
          action: 'UPDATED',
          payload: {
            previousName: existing.name,
            locationName: name
          }
        });
        return updated;
      });
      return { location: serializeLocation(result) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'LOCATION_NAME_EXISTS', '已存在同名书架位置');
      }
      throw error;
    }
  });

  app.post('/locations/:locationId/archive', async (request) => {
    const id = parseId((request.params as { locationId: string }).locationId, 'locationId');
    const userId = currentUser(request).id;
    const existing = await findOwnedLocation(userId, id);
    if (!existing) throw new AppError(404, 'NOT_FOUND', '书架位置不存在');
    if (existing.status === 'ARCHIVED') {
      throw new AppError(409, 'LOCATION_ALREADY_ARCHIVED', '该位置已经归档');
    }

    const activeCopies = await prisma.bookCopy.count({
      where: { userId, currentLocationId: id, status: 'SHELVED', deletedAt: null }
    });
    if (activeCopies > 0) {
      throw new AppError(409, 'LOCATION_IN_USE', `该位置上还有 ${activeCopies} 册副本，请先移动或归档这些副本`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const archived = await tx.shelfLocation.update({
        where: { id },
        data: { status: 'ARCHIVED', archivedAt: new Date() }
      });
      await writeEvent(tx, {
        userId,
        entityType: 'SHELF_LOCATION',
        entityId: id,
        action: 'ARCHIVED',
        payload: { locationName: existing.name }
      });
      return archived;
    });
    return { location: serializeLocation(result) };
  });

  app.post('/locations/:locationId/unarchive', async (request) => {
    const id = parseId((request.params as { locationId: string }).locationId, 'locationId');
    const userId = currentUser(request).id;
    const existing = await findOwnedLocation(userId, id);
    if (!existing) throw new AppError(404, 'NOT_FOUND', '书架位置不存在');
    if (existing.status === 'ACTIVE') {
      throw new AppError(409, 'LOCATION_ACTIVE', '该位置未归档');
    }

    const result = await prisma.$transaction(async (tx) => {
      const restored = await tx.shelfLocation.update({
        where: { id },
        data: { status: 'ACTIVE', archivedAt: null }
      });
      await writeEvent(tx, {
        userId,
        entityType: 'SHELF_LOCATION',
        entityId: id,
        action: 'UNARCHIVED',
        payload: { locationName: existing.name }
      });
      return restored;
    });
    return { location: serializeLocation(result) };
  });

  app.delete('/locations/:locationId', async (request, reply) => {
    const id = parseId((request.params as { locationId: string }).locationId, 'locationId');
    const userId = currentUser(request).id;
    const existing = await findOwnedLocation(userId, id);
    if (!existing) throw new AppError(404, 'NOT_FOUND', '书架位置不存在');

    // A location that has ever held a copy is part of the migration history;
    // it must be archived rather than deleted, so audit records keep meaning.
    const [copyCount, eventCount] = await Promise.all([
      prisma.bookCopy.count({ where: { currentLocationId: id } }),
      prisma.copyLocationEvent.count({
        where: { OR: [{ fromLocationId: id }, { toLocationId: id }] }
      })
    ]);
    if (copyCount > 0) {
      throw new AppError(409, 'LOCATION_IN_USE', '该位置仍有副本引用，不能删除，可改为归档');
    }
    if (eventCount > 0) {
      throw new AppError(409, 'LOCATION_HAS_HISTORY', '该位置已出现在迁移历史中，只能归档不能删除');
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.shelfLocation.delete({ where: { id } });
        await writeEvent(tx, {
          userId,
          entityType: 'SHELF_LOCATION',
          entityId: id,
          action: 'DELETED',
          payload: { locationName: existing.name }
        });
      });
    } catch (error) {
      // Race backstop: a copy or history row referencing this location may have
      // been committed between the count checks and the delete. The RESTRICT
      // foreign keys reject it (Prisma P2003/P2014).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2014')
      ) {
        throw new AppError(409, 'LOCATION_HAS_HISTORY', '该位置已与副本或迁移历史关联，只能归档不能删除');
      }
      throw error;
    }
    return reply.status(204).send();
  });
};
