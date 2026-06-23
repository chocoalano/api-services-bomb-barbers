-- Rollback koreksi kode error time-off.

DO $$
DECLARE
  function_signature regprocedure :=
    'public.create_appointment_atomic(uuid,uuid,uuid,uuid[],timestamp with time zone,text,character varying,character varying,uuid,jsonb,character varying,text,numeric,numeric,text,integer)'::regprocedure;
  old_definition text;
BEGIN
  SELECT pg_get_functiondef(function_signature)
  INTO old_definition;

  EXECUTE replace(
    old_definition,
    'RAISE EXCEPTION ''Barber sedang tidak tersedia pada jadwal tersebut''
      USING ERRCODE = ''P0001'';',
    'RAISE EXCEPTION ''Barber sedang tidak tersedia pada jadwal tersebut''
      USING ERRCODE = ''23P01'';'
  );
END $$;
