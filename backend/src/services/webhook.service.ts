import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type WebhookEventType =
  | 'payment.settled'
  | 'payment.failed'
  | 'reversal.requested'
  | 'reversal.declined'
  | 'reversal.completed'
  | 'reversal.failed'
  | 'reversal.expired';

/**
 * PDF Section 3.8: Idempotent webhook event persistence and optional HTTP delivery.
 *
 * Each logical transition carries a deterministic `idempotencyKey` inside `payload`.
 * If an event for the same `(merchantId, eventType, idempotencyKey)` already exists,
 * it is returned as-is instead of creating or delivering a duplicate.
 */
export class WebhookService {
  static async record(
    merchantId: string,
    eventType: WebhookEventType,
    idempotencyKey: string,
    data: Record<string, unknown>,
    tx: Prisma.TransactionClient = prisma,
  ) {
    const existing = await tx.webhookEvent.findFirst({
      where: {
        merchantId,
        eventType,
        payload: { path: ['idempotencyKey'], equals: idempotencyKey },
      },
    });
    if (existing) return existing;

    const payload: Prisma.InputJsonObject = {
      idempotencyKey,
      eventType,
      occurredAt: new Date().toISOString(),
      data: data as Prisma.InputJsonValue,
    };

    const event = await tx.webhookEvent.create({
      data: {
        merchantId,
        eventType,
        payload,
        status: 'PENDING',
        attempts: 0,
      },
    });

    // Fire-and-forget delivery if WEBHOOK_URL is configured
    const targetUrl = process.env.WEBHOOK_URL;
    if (targetUrl && tx === prisma) {
      void WebhookService.deliver(event.id, targetUrl, payload);
    }

    return event;
  }

  static async deliver(eventId: string, targetUrl: string, payload: Prisma.InputJsonObject) {
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-id': eventId,
        },
        body: JSON.stringify(payload),
      });
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          status: res.ok ? 'DELIVERED' : 'FAILED',
          attempts: { increment: 1 },
          deliveredAt: res.ok ? new Date() : null,
        },
      });
    } catch {
      await prisma.webhookEvent
        .update({
          where: { id: eventId },
          data: { status: 'FAILED', attempts: { increment: 1 } },
        })
        .catch(() => undefined);
    }
  }

  static async listForMerchant(merchantId: string) {
    return prisma.webhookEvent.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

