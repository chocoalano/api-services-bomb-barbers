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
