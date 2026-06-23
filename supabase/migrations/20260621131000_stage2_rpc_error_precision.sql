-- Koreksi kode error time-off agar tidak tertangkap sebagai exclusion overlap.
-- Migration dinamis ini menjaga satu sumber fungsi utama tetap berada pada
-- migration 20260621130000_stage2_booking_integrity.sql.

DO $$
DECLARE
  function_signature regprocedure :=
    'public.create_appointment_atomic(uuid,uuid,uuid,uuid[],timestamp with time zone,text,character varying,character varying,uuid,jsonb,character varying,text,numeric,numeric,text,integer)'::regprocedure;
  old_definition text;
  new_definition text;
  old_fragment text :=
    'RAISE EXCEPTION ''Barber sedang tidak tersedia pada jadwal tersebut''
      USING ERRCODE = ''23P01'';';
  new_fragment text :=
    'RAISE EXCEPTION ''Barber sedang tidak tersedia pada jadwal tersebut''
      USING ERRCODE = ''P0001'';';
BEGIN
  SELECT pg_get_functiondef(function_signature)
  INTO old_definition;

  new_definition := replace(old_definition, old_fragment, new_fragment);

  IF new_definition = old_definition THEN
    IF old_definition LIKE '%Barber sedang tidak tersedia pada jadwal tersebut%'
      AND old_definition LIKE '%USING ERRCODE = ''P0001'';%'
    THEN
      RETURN;
    END IF;

    RAISE EXCEPTION 'Definisi create_appointment_atomic tidak sesuai versi yang diharapkan';
  END IF;

  EXECUTE new_definition;
END $$;
