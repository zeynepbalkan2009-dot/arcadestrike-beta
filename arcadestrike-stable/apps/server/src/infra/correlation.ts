import { randomUUID } from 'crypto';
import { FastifyRequest } from 'fastify';

export function getCorrelationId(req?: FastifyRequest): string {
  return (req?.headers?.['x-correlation-id'] as string) ?? randomUUID();
}

export function generateCorrelationId(): string {
  return randomUUID();
}
