import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_SPECIAL_REQUEST_BUY_FEE,
  DEFAULT_SPECIAL_REQUEST_NOW_MAX_MINUTES,
  DEFAULT_SPECIAL_REQUEST_NOW_MIN_MINUTES,
  DEFAULT_SPECIAL_REQUEST_TIMEZONE,
} from './special-request.constants';

const log = new Logger('SpecialRequestSchema');

export function isMissingRelationError(err: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number): boolean => {
    if (!value || depth > 6 || seen.has(value)) {
      return false;
    }
    seen.add(value);
    if (typeof value === 'object') {
      const o = value as Record<string, unknown>;
      if (
        o.code === 'P2021' ||
        o.code === '42P01' ||
        o.originalCode === '42P01' ||
        o.kind === 'TableDoesNotExist'
      ) {
        return true;
      }
      const message = `${o.message ?? ''} ${o.originalMessage ?? ''}`;
      if (
        /does not exist/i.test(message) &&
        /special_request/i.test(message)
      ) {
        return true;
      }
      if (walk(o.cause, depth + 1)) {
        return true;
      }
    }
    if (value instanceof Error) {
      if (
        /does not exist/i.test(value.message) &&
        /special_request/i.test(value.message)
      ) {
        return true;
      }
      return walk((value as Error & { cause?: unknown }).cause, depth + 1);
    }
    return false;
  };
  return walk(err);
}

/**
 * Idempotent schema for Special Request. Covers VPS deploys that ship code
 * before `prisma migrate deploy` (or when that command cannot CREATE a table
 * that already exists from a partial apply).
 */
export async function ensureSpecialRequestSchema(
  prisma: PrismaService,
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "special_request_settings" (
      "id" INTEGER NOT NULL,
      "is_enabled" BOOLEAN NOT NULL DEFAULT true,
      "timezone" VARCHAR(64) NOT NULL DEFAULT '${DEFAULT_SPECIAL_REQUEST_TIMEZONE}',
      "now_min_minutes" INTEGER NOT NULL DEFAULT ${DEFAULT_SPECIAL_REQUEST_NOW_MIN_MINUTES},
      "now_max_minutes" INTEGER NOT NULL DEFAULT ${DEFAULT_SPECIAL_REQUEST_NOW_MAX_MINUTES},
      "buy_fee" DECIMAL(10,2) NOT NULL DEFAULT ${DEFAULT_SPECIAL_REQUEST_BUY_FEE},
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "special_request_settings_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "special_request_settings" (
      "id",
      "is_enabled",
      "timezone",
      "now_min_minutes",
      "now_max_minutes",
      "buy_fee",
      "created_at",
      "updated_at"
    )
    VALUES (
      1,
      true,
      '${DEFAULT_SPECIAL_REQUEST_TIMEZONE}',
      ${DEFAULT_SPECIAL_REQUEST_NOW_MIN_MINUTES},
      ${DEFAULT_SPECIAL_REQUEST_NOW_MAX_MINUTES},
      ${DEFAULT_SPECIAL_REQUEST_BUY_FEE},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "special_requests" (
      "id" UUID NOT NULL,
      "user_id" UUID NOT NULL,
      "driver_id" UUID,
      "status" VARCHAR(50) NOT NULL,
      "store_name" VARCHAR(191) NOT NULL,
      "item_name" VARCHAR(191) NOT NULL,
      "product_image_url" VARCHAR(500) NOT NULL,
      "request_ref" VARCHAR(191),
      "service_fee" DECIMAL(10,2) NOT NULL,
      "delivery_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "total" DECIMAL(10,2) NOT NULL,
      "from_address_line" VARCHAR(500) NOT NULL,
      "from_latitude" DECIMAL(10,7) NOT NULL,
      "from_longitude" DECIMAL(10,7) NOT NULL,
      "from_address_id" UUID,
      "to_address_line" VARCHAR(500) NOT NULL,
      "to_latitude" DECIMAL(10,7) NOT NULL,
      "to_longitude" DECIMAL(10,7) NOT NULL,
      "to_address_id" UUID,
      "eta_min_minutes" INTEGER,
      "eta_max_minutes" INTEGER,
      "snapshot" JSONB,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "special_requests_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "special_requests" DROP COLUMN IF EXISTS "distance_km"`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "special_requests" ALTER COLUMN "delivery_fee" SET DEFAULT 0`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "special_requests_user_id_created_at_idx"
    ON "special_requests"("user_id", "created_at" DESC)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "special_requests_driver_id_status_idx"
    ON "special_requests"("driver_id", "status")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "special_requests_status_driver_id_idx"
    ON "special_requests"("status", "driver_id")
  `);

  log.debug('Special request tables are present');
}
