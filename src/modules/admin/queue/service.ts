import { redis } from '../../../lib/redis';
import { db } from '../../../lib/db';
import { snakeKeys } from '../../../db/helpers';
import { appointments } from '../../../db/schema';
import { and, eq, inArray, asc } from 'drizzle-orm';

const BRANCH_QUEUE_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'];

export class QueueService {
  static async getBranchActiveQueueSnapshot(branchId: string) {
    const queue = snakeKeys(
      await db
        .select({
          id: appointments.id,
          barberId: appointments.barberId,
          status: appointments.status,
          customerId: appointments.customerId
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.branchId, branchId),
            inArray(appointments.status, BRANCH_QUEUE_STATUSES as any)
          )
        )
        .orderBy(asc(appointments.createdAt))
    ) as any[];

    return Promise.all(
      queue.map(async (apt) => {
        const etaRaw = await redis.get(`appointment:eta:${apt.id}`);
        let eta = null;

        if (etaRaw) {
          try {
            eta = JSON.parse(etaRaw);
          } catch {
            eta = null;
          }
        }

        return { ...apt, eta };
      })
    );
  }
}
