const BASELINE_PROBES: Record<string, string> = {
  '20260609152000_final_schema.sql': `
    WITH expected_tables(name) AS (
      VALUES
        ('appointment_products'), ('appointment_services'), ('appointments'),
        ('audit_logs'), ('barber_daily_stats'), ('barber_payouts'),
        ('barber_portfolios'), ('barbers'), ('branch_inventory'),
        ('branch_operating_hours'), ('branch_photos'), ('branches'),
        ('commission_entries'), ('commission_rules'), ('customers'),
        ('daily_branch_summaries'), ('inventory_movements'), ('invoices'),
        ('payments'), ('permissions'), ('products'), ('refunds'), ('regions'),
        ('role_permissions'), ('roles'), ('service_prices'), ('services'),
        ('staff_user_roles'), ('staff_users')
    ),
    expected_types(name) AS (
      VALUES
        ('appointment_status'), ('commission_scope'), ('payment_method'),
        ('payment_status'), ('appointment_source')
    ),
    expected_indexes(name) AS (
      VALUES
        ('idx_appointments_branch_status_date'),
        ('idx_appointments_barber_status'),
        ('idx_commission_entries_appointment'),
        ('idx_payments_branch_paid_at'),
        ('idx_service_prices_resolver'),
        ('idx_staff_user_roles_staff_branch')
    )
    SELECT
      NOT EXISTS (
        SELECT 1
        FROM expected_tables expected
        LEFT JOIN information_schema.tables actual
          ON actual.table_schema = 'public'
          AND actual.table_name = expected.name
        WHERE actual.table_name IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM expected_types expected
        LEFT JOIN pg_type actual ON actual.typname = expected.name
        LEFT JOIN pg_namespace namespace ON namespace.oid = actual.typnamespace
        WHERE actual.typname IS NULL OR namespace.nspname <> 'public'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM expected_indexes expected
        LEFT JOIN pg_indexes actual
          ON actual.schemaname = 'public'
          AND actual.indexname = expected.name
        WHERE actual.indexname IS NULL
      )
      AND (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('customers', 'auth_id'),
            ('staff_users', 'auth_id')
          )
      ) = 2
      AS represented
  `,
  '20260609160000_add_password_hash.sql': `
    SELECT (
      SELECT count(*)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'password_hash'
        AND table_name IN ('customers', 'staff_users')
    ) = 2 AS represented
  `,
  '20260610062000_growth_features.sql': `
    SELECT (
      SELECT count(*)
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'reviews', 'branch_expenses', 'cash_drawer_sessions', 'notifications'
        )
    ) = 4 AS represented
  `,
  '20260610064000_hq_analytics_tracking.sql': `
    SELECT (
      SELECT count(*)
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('tracking_sessions', 'check_ins')
    ) = 2 AS represented
  `,
  '20260613090000_align_customer_auth_columns.sql': `
    SELECT
      to_regclass('public.customers') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'
      )
      AND (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'customers'
          AND column_name IN (
            'id', 'full_name', 'phone', 'email', 'password_hash',
            'points_balance', 'is_active', 'created_at', 'updated_at', 'deleted_at'
          )
      ) = 10
      AND (
        SELECT count(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN ('customers_phone_unique', 'customers_email_unique')
      ) = 2
      AS represented
  `,
  '20260615090000_add_content_endpoints.sql': `
    SELECT
      to_regclass('public.promotions') IS NOT NULL
      AND (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notifications'
          AND column_name IN (
            'recipient_id', 'recipient_type', 'type', 'title', 'body',
            'sent_at', 'read_at', 'updated_at', 'deleted_at'
          )
      ) = 9
      AND (
        SELECT count(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'idx_promotions_active_window',
            'idx_barber_portfolios_barber_created_at',
            'idx_notifications_recipient_unread'
          )
      ) = 3
      AS represented
  `,
  '20260615100000_add_media_upload_and_available_slots_support.sql': `
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'appointments'
          AND column_name = 'customer_media_urls'
      )
      AND to_regclass('public.idx_appointments_customer_media_urls') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = 'appointment-media'
      )
      AS represented
  `,
  '20260615110000_add_service_image_url.sql': `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'services'
        AND column_name = 'image_url'
    ) AS represented
  `,
  '20260615150000_add_chat_messages_table.sql': `
    SELECT
      to_regclass('public.chat_messages') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.chat_messages'::regclass
          AND conname = 'chat_messages_sender_role_check'
      )
      AS represented
  `,
  '20260615170000_add_barber_dashboard_radius.sql': `
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'barbers'
          AND column_name = 'service_radius_km'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.barbers'::regclass
          AND conname = 'barbers_service_radius_km_check'
      )
      AS represented
  `,
  '20260620190000_home_service_realtime_hardening.sql': `
    SELECT
      (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'appointments'
          AND column_name IN (
            'fulfillment_type', 'service_address', 'destination_latitude',
            'destination_longitude', 'location_notes', 'journey_status', 'version'
          )
      ) = 7
      AND (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tracking_sessions'
          AND column_name IN ('ended_at', 'ended_reason', 'last_activity_at')
      ) = 3
      AND (
        SELECT count(*)
        FROM pg_constraint
        WHERE conname IN (
          'appointments_fulfillment_type_check',
          'appointments_journey_status_check',
          'appointments_destination_latitude_check',
          'appointments_destination_longitude_check',
          'appointments_home_service_destination_check',
          'appointments_version_positive_check',
          'tracking_sessions_status_check'
        )
      ) = 7
      AND (
        SELECT count(*)
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'tracking_sessions_one_active_per_appointment',
            'tracking_sessions_appointment_status_expires',
            'check_ins_appointment_unique',
            'appointments_customer_status_schedule',
            'appointments_fulfillment_status'
          )
      ) = 5
      AND (
        SELECT count(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'appointments_set_updated_at',
            'tracking_sessions_set_updated_at'
          )
      ) = 2
      AND (
        SELECT count(*)
        FROM pg_class
        WHERE oid IN (
          'public.appointments'::regclass,
          'public.tracking_sessions'::regclass,
          'public.check_ins'::regclass,
          'public.chat_messages'::regclass
        )
          AND relrowsecurity
      ) = 4
      AS represented
  `,
  '20260621100000_auth_privacy_hardening.sql': `
    SELECT
      (
        SELECT count(*)
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('auth_sessions', 'auth_events', 'media_assets')
      ) = 3
      AND (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'invoices'
          AND column_name IN (
            'public_access_token_hash',
            'public_access_expires_at'
          )
      ) = 2
      AND (
        SELECT count(*)
        FROM storage.buckets
        WHERE id IN ('bomb-private-media', 'bomb-public-media')
      ) = 2
      AND (
        SELECT count(*)
        FROM pg_class
        WHERE oid IN (
          'public.auth_sessions'::regclass,
          'public.auth_events'::regclass,
          'public.media_assets'::regclass
        )
          AND relrowsecurity
      ) = 3
      AS represented
  `,
  '20260621130000_stage2_booking_integrity.sql': `
    SELECT
      to_regclass('public.appointment_events') IS NOT NULL
      AND (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'appointments'
          AND column_name IN (
            'scheduled_end_at', 'idempotency_key', 'travel_buffer_min',
            'schedule_block_start_at', 'schedule_block_end_at'
          )
      ) = 5
      AND EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.appointments'::regclass
          AND conname = 'appointments_barber_schedule_excl'
      )
      AND to_regprocedure(
        'public.create_appointment_atomic(uuid,uuid,uuid,uuid[],timestamp with time zone,text,character varying,character varying,uuid,jsonb,character varying,text,numeric,numeric,text,integer)'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.transition_appointment_status_atomic(uuid,text,integer,character varying,uuid,character varying,text,character varying,jsonb)'
      ) IS NOT NULL
      AS represented
  `,
  '20260621131000_stage2_rpc_error_precision.sql': `
    SELECT
      position(
        'Barber sedang tidak tersedia pada jadwal tersebut'
        IN pg_get_functiondef(
          'public.create_appointment_atomic(uuid,uuid,uuid,uuid[],timestamp with time zone,text,character varying,character varying,uuid,jsonb,character varying,text,numeric,numeric,text,integer)'::regprocedure
        )
      ) > 0
      AND position(
        'USING ERRCODE = ''P0001'''
        IN pg_get_functiondef(
          'public.create_appointment_atomic(uuid,uuid,uuid,uuid[],timestamp with time zone,text,character varying,character varying,uuid,jsonb,character varying,text,numeric,numeric,text,integer)'::regprocedure
        )
      ) > 0
      AS represented
  `
};

export const isMigrationRepresented = async (
  sql: any,
  migrationName: string
): Promise<boolean> => {
  const probe = BASELINE_PROBES[migrationName];
  if (!probe) return false;

  try {
    const rows = await sql.unsafe(probe);
    return rows[0]?.represented === true;
  } catch {
    // A missing table/column in a strict probe means the migration is not yet
    // represented and must be executed normally.
    return false;
  }
};
