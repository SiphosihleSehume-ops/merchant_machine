import { PrismaClient } from '@prisma/client';

// We export a single instance of Prisma to be used across the entire application.
// In development, this prevents "too many connections" errors when hot-reloading.
export const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'], // Logs SQL queries to the console for debugging
});