-- Combined Migrations for Bomb Barbershop API
-- Generated: 2026-06-15T06:19:39.671Z
-- 
-- Instructions:
-- 1. Go to: https://app.supabase.com/project/fbvdazkwvueewghjysqa/sql/new
-- 2. Copy paste this entire SQL below the comment markers
-- 3. Click "Run" button
-- 4. Wait for success message
--
-- ============================================
-- START PASTE FROM HERE:
-- ============================================

-- Migration: 20260609152000_final_schema.sql
-- ----------------------------------------
CREATE TYPE "public"."appointment_status" AS ENUM('pending', 'confirmed', 'in_queue', 'in_service', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."commission_scope" AS ENUM('global', 'region', 'branch', 'barber', 'service');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'qris', 'card', 'bank_transfer', 'ewallet');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."appointment_source" AS ENUM('online_booking', 'walk_in');--> statement-breakpoint
CREATE TABLE "appointment_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"price_amount" bigint NOT NULL,
	"duration_min" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"barber_id" uuid,
	"customer_id" uuid,
	"source" "appointment_source" NOT NULL,
	"status" "appointment_status" NOT NULL,
	"scheduled_at" timestamp with time zone,
	"queue_position" integer,
	"checked_in_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" varchar(50) NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "barber_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barber_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"summary_date" date NOT NULL,
	"heads_count" integer DEFAULT 0,
	"revenue" bigint DEFAULT 0,
	"commission_earned" bigint DEFAULT 0,
	"avg_rating" numeric(3, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "barber_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barber_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"total_amount" bigint NOT NULL,
	"status" varchar(50) NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "barber_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barber_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "barbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"bio" text,
	"rating_avg" numeric(3, 2) DEFAULT '0',
	"rating_count" integer DEFAULT 0,
	"live_status" varchar(50) DEFAULT 'offline',
	"default_commission_rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "branch_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity_on_hand" integer DEFAULT 0,
	"reorder_level" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_operating_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"open_time" time NOT NULL,
	"close_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"url" text NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid,
	"name" varchar(255) NOT NULL,
	"address" text,
	"phone" varchar(50),
	"latitude" numeric,
	"longitude" numeric,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "commission_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"commission_rule_id" uuid NOT NULL,
	"base_amount" bigint NOT NULL,
	"barber_share" bigint NOT NULL,
	"branch_share" bigint NOT NULL,
	"hq_share" bigint NOT NULL,
	"tip_amount" bigint DEFAULT 0,
	"calculated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_entries_appointment_id_unique" UNIQUE("appointment_id")
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "commission_scope" NOT NULL,
	"scope_ref_id" uuid,
	"barber_pct" numeric(5, 2) NOT NULL,
	"branch_pct" numeric(5, 2) NOT NULL,
	"hq_pct" numeric(5, 2) NOT NULL,
	"tip_to_barber" boolean DEFAULT true,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"email" varchar(255),
	"points_balance" bigint DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_phone_unique" UNIQUE("phone"),
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "daily_branch_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"summary_date" date NOT NULL,
	"total_revenue" bigint DEFAULT 0,
	"total_appointments" integer DEFAULT 0,
	"walk_in_count" integer DEFAULT 0,
	"booking_count" integer DEFAULT 0,
	"no_show_count" integer DEFAULT 0,
	"hq_share_total" bigint DEFAULT 0,
	"branch_share_total" bigint DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"quantity" integer NOT NULL,
	"reference_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_number" varchar(100) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"pdf_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"total_amount" bigint NOT NULL,
	"service_amount" bigint NOT NULL,
	"product_amount" bigint NOT NULL,
	"discount_amount" bigint DEFAULT 0,
	"tip_amount" bigint DEFAULT 0,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" NOT NULL,
	"gateway_reference" varchar(255),
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_appointment_id_unique" UNIQUE("appointment_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"sku" varchar(100) NOT NULL,
	"description" text,
	"base_price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"processed_by" uuid,
	"processed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "regions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "service_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"branch_id" uuid,
	"region_id" uuid,
	"price_amount" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"default_duration_min" integer NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(50),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "staff_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "appointment_products" ADD CONSTRAINT "appointment_products_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_products" ADD CONSTRAINT "appointment_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_daily_stats" ADD CONSTRAINT "barber_daily_stats_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_daily_stats" ADD CONSTRAINT "barber_daily_stats_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_payouts" ADD CONSTRAINT "barber_payouts_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_portfolios" ADD CONSTRAINT "barber_portfolios_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barbers" ADD CONSTRAINT "barbers_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barbers" ADD CONSTRAINT "barbers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_operating_hours" ADD CONSTRAINT "branch_operating_hours_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_photos" ADD CONSTRAINT "branch_photos_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_branch_summaries" ADD CONSTRAINT "daily_branch_summaries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_processed_by_staff_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_user_roles" ADD CONSTRAINT "staff_user_roles_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_user_roles" ADD CONSTRAINT "staff_user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_user_roles" ADD CONSTRAINT "staff_user_roles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_appointments_branch_status_date" ON "appointments" USING btree ("branch_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_appointments_barber_status" ON "appointments" USING btree ("barber_id","status");--> statement-breakpoint
CREATE INDEX "idx_commission_entries_appointment" ON "commission_entries" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_payments_branch_paid_at" ON "payments" USING btree ("branch_id","paid_at");--> statement-breakpoint
CREATE INDEX "idx_service_prices_resolver" ON "service_prices" USING btree ("service_id","branch_id","effective_from");--> statement-breakpoint
CREATE INDEX "idx_staff_user_roles_staff_branch" ON "staff_user_roles" USING btree ("staff_user_id","branch_id");ALTER TABLE "customers" ADD COLUMN "auth_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "auth_id" uuid;

-- Migration: 20260609160000_add_password_hash.sql
-- ----------------------------------------
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "password_hash" VARCHAR(255);
ALTER TABLE "staff_users" ADD COLUMN IF NOT EXISTS "password_hash" VARCHAR(255);

-- Migration: 20260610062000_growth_features.sql
-- ----------------------------------------
-- Migrasi Fase 2: Fitur Pertumbuhan

CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"barber_id" uuid NOT NULL,
	"rating" numeric(3, 2) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_appointment_id_unique" UNIQUE("appointment_id")
);

CREATE TABLE "branch_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"description" text NOT NULL,
	"expense_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "cash_drawer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"starting_cash" bigint NOT NULL,
	"ending_cash" bigint,
	"expected_cash" bigint,
	"difference" bigint,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "branch_expenses" ADD CONSTRAINT "branch_expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cash_drawer_sessions" ADD CONSTRAINT "cash_drawer_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;

-- Migration: 20260610064000_hq_analytics_tracking.sql
-- ----------------------------------------
-- Fase 3: Scale & Analytics HQ
-- Migrasi tabel tracking dan check_ins

CREATE TABLE "tracking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"consent_given_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"method" varchar(50) NOT NULL, -- e.g. 'qr', 'manual', 'geofence'
	"location_lat" numeric(10, 8),
	"location_lng" numeric(11, 8),
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;

-- Tambahkan fungsi trigger updated_at opsional jika dibutuhkan

-- Migration: 20260613090000_align_customer_auth_columns.sql
-- ----------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "public"."customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE "public"."customers"
  ADD COLUMN IF NOT EXISTS "id" uuid;

UPDATE "public"."customers"
SET "id" = gen_random_uuid()
WHERE "id" IS NULL;

ALTER TABLE "public"."customers"
  ADD COLUMN IF NOT EXISTS "full_name" varchar(255),
  ADD COLUMN IF NOT EXISTS "phone" varchar(50),
  ADD COLUMN IF NOT EXISTS "email" varchar(255),
  ADD COLUMN IF NOT EXISTS "password_hash" varchar(255),
  ADD COLUMN IF NOT EXISTS "points_balance" bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

ALTER TABLE "public"."customers"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "points_balance" SET DEFAULT 0,
  ALTER COLUMN "is_active" SET DEFAULT true,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "updated_at" SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "public"."customers" WHERE "id" IS NULL
  ) THEN
    ALTER TABLE "public"."customers" ALTER COLUMN "id" SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "pg_constraint"
    WHERE "conrelid" = to_regclass('public.customers')
      AND "contype" = 'p'
  ) AND NOT EXISTS (
    SELECT 1
    FROM "public"."customers"
    GROUP BY "id"
    HAVING count(*) > 1
  ) THEN
    ALTER TABLE "public"."customers" ADD PRIMARY KEY ("id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "public"."customers" WHERE "full_name" IS NULL
  ) THEN
    ALTER TABLE "public"."customers" ALTER COLUMN "full_name" SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "public"."customers" WHERE "phone" IS NULL
  ) THEN
    ALTER TABLE "public"."customers" ALTER COLUMN "phone" SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "public"."customers" WHERE "created_at" IS NULL
  ) THEN
    ALTER TABLE "public"."customers" ALTER COLUMN "created_at" SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "public"."customers" WHERE "updated_at" IS NULL
  ) THEN
    ALTER TABLE "public"."customers" ALTER COLUMN "updated_at" SET NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "customers_phone_unique"
  ON "public"."customers" ("phone")
  WHERE "phone" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "customers_email_unique"
  ON "public"."customers" ("email")
  WHERE "email" IS NOT NULL;

-- Migration: 20260615090000_add_content_endpoints.sql
-- ----------------------------------------
-- Konten aplikasi pelanggan: banners, gallery hasil layanan, dan notifikasi.

CREATE TABLE IF NOT EXISTS "promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" varchar(255) NOT NULL,
  "subtitle" text,
  "image_url" text,
  "target_url" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "subtitle" text;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "image_url" text;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "target_url" text;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "starts_at" timestamp with time zone;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "idx_promotions_active_window"
  ON "promotions" ("is_active", "starts_at", "ends_at", "sort_order")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_barber_portfolios_barber_created_at"
  ON "barber_portfolios" ("barber_id", "created_at");

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_id" uuid NOT NULL,
  "recipient_type" varchar(50) DEFAULT 'customer' NOT NULL,
  "type" varchar(50) DEFAULT 'general' NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now(),
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipient_id" uuid;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipient_type" varchar(50) DEFAULT 'customer';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "type" varchar(50) DEFAULT 'general';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "title" varchar(255);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "body" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "sent_at" timestamp with time zone DEFAULT now();
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read_at" timestamp with time zone;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'user_id'
  ) THEN
    UPDATE "notifications"
    SET "recipient_id" = "user_id"
    WHERE "recipient_id" IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'message'
  ) THEN
    UPDATE "notifications"
    SET "body" = "message"
    WHERE "body" IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'is_read'
  ) THEN
    UPDATE "notifications"
    SET "read_at" = COALESCE("read_at", "created_at")
    WHERE "is_read" = true AND "read_at" IS NULL;
  END IF;
END $$;

UPDATE "notifications" SET "recipient_type" = 'customer' WHERE "recipient_type" IS NULL;
UPDATE "notifications" SET "type" = 'general' WHERE "type" IS NULL;
UPDATE "notifications" SET "title" = 'Notifikasi' WHERE "title" IS NULL;
UPDATE "notifications" SET "body" = '' WHERE "body" IS NULL;
UPDATE "notifications" SET "sent_at" = COALESCE("sent_at", "created_at") WHERE "sent_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_notifications_recipient_unread"
  ON "notifications" ("recipient_type", "recipient_id", "read_at", "created_at")
  WHERE "deleted_at" IS NULL;

-- Migration: 20260615100000_add_media_upload_and_available_slots_support.sql
-- ----------------------------------------
-- Dukungan upload media pemesanan dan penyimpanan URL foto referensi pelanggan.

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "customer_media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_appointments_customer_media_urls"
  ON "appointments" USING gin ("customer_media_urls");

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) VALUES (
  'appointment-media',
  'appointment-media',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Migration: 20260615110000_add_service_image_url.sql
-- ----------------------------------------
-- Dukungan gambar layanan untuk kartu service di aplikasi pelanggan.

ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "image_url" text;

UPDATE "services"
SET "image_url" = 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a'
WHERE "name" = 'Premium Haircut'
  AND ("image_url" IS NULL OR "image_url" = '');

UPDATE "services"
SET "image_url" = 'https://images.unsplash.com/photo-1621605815971-fbc98d665033'
WHERE "name" = 'Beard Trim'
  AND ("image_url" IS NULL OR "image_url" = '');

-- Migration: 20260615150000_add_chat_messages_table.sql
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "appointment_id" uuid NOT NULL,
  "sender_id" uuid NOT NULL,
  "sender_role" varchar(20) NOT NULL,
  "text" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_sender_role_check"
  CHECK (sender_role IN ('customer', 'barber'));

-- Migration: 20260615170000_add_barber_dashboard_radius.sql
-- ----------------------------------------
ALTER TABLE "barbers"
  ADD COLUMN IF NOT EXISTS "service_radius_km" integer DEFAULT 5 NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'barbers_service_radius_km_check'
  ) THEN
    ALTER TABLE "barbers"
      ADD CONSTRAINT "barbers_service_radius_km_check"
      CHECK ("service_radius_km" > 0);
  END IF;
END $$;

-- Migration: 20260623090000_add_admin_notification_settings.sql
-- ----------------------------------------
-- Tabel pengaturan notifikasi per-admin untuk menyimpan preferensi
-- notifikasi masing-masing staff/admin.

CREATE TABLE IF NOT EXISTS "admin_notification_settings" (
  "staff_user_id" uuid PRIMARY KEY REFERENCES "public"."staff_users"("id") ON DELETE CASCADE,
  "new_appointment" boolean DEFAULT true NOT NULL,
  "appointment_reminder" boolean DEFAULT true NOT NULL,
  "appointment_cancelled" boolean DEFAULT true NOT NULL,
  "whatsapp" boolean DEFAULT false NOT NULL,
  "email" boolean DEFAULT true NOT NULL,
  "daily_summary" boolean DEFAULT true NOT NULL,
  "weekly_report" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================
-- END PASTE HERE
-- ============================================
