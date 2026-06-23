-- Tahap 1: hardening autentikasi, privasi media, dan akses invoice.

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_type" varchar(20) NOT NULL,
  "user_id" uuid NOT NULL,
  "refresh_jti_hash" varchar(64) NOT NULL,
  "user_agent" text,
  "ip_hash" varchar(64),
  "expires_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoke_reason" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_sessions_user_type_check"
    CHECK ("user_type" IN ('customer', 'staff'))
);

CREATE INDEX IF NOT EXISTS "auth_sessions_user_active_idx"
  ON "auth_sessions" ("user_type", "user_id", "expires_at")
  WHERE "revoked_at" IS NULL;

CREATE TABLE IF NOT EXISTS "auth_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_type" varchar(20) NOT NULL,
  "user_id" uuid,
  "event_type" varchar(50) NOT NULL,
  "success" boolean NOT NULL,
  "identifier_hash" varchar(64),
  "ip_hash" varchar(64),
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_events_user_type_check"
    CHECK ("user_type" IN ('customer', 'staff'))
);

CREATE INDEX IF NOT EXISTS "auth_events_created_at_idx"
  ON "auth_events" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "auth_events_identifier_idx"
  ON "auth_events" ("identifier_hash", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "media_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_type" varchar(20) NOT NULL,
  "owner_id" uuid NOT NULL,
  "bucket" varchar(100) NOT NULL,
  "object_path" text NOT NULL,
  "visibility" varchar(20) NOT NULL DEFAULT 'private',
  "purpose" varchar(100) NOT NULL,
  "content_type" varchar(100) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "width" integer,
  "height" integer,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "media_assets_owner_type_check"
    CHECK ("owner_type" IN ('customer', 'staff')),
  CONSTRAINT "media_assets_visibility_check"
    CHECK ("visibility" IN ('private', 'public')),
  CONSTRAINT "media_assets_object_unique"
    UNIQUE ("bucket", "object_path")
);

CREATE INDEX IF NOT EXISTS "media_assets_owner_idx"
  ON "media_assets" ("owner_type", "owner_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "public_access_token_hash" varchar(64),
  ADD COLUMN IF NOT EXISTS "public_access_expires_at" timestamp with time zone;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES
  (
    'bomb-private-media',
    'bomb-private-media',
    false,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'bomb-public-media',
    'bomb-public-media',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  )
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP TRIGGER IF EXISTS auth_sessions_set_updated_at ON auth_sessions;
CREATE TRIGGER auth_sessions_set_updated_at
BEFORE UPDATE ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS media_assets_set_updated_at ON media_assets;
CREATE TRIGGER media_assets_set_updated_at
BEFORE UPDATE ON media_assets
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
