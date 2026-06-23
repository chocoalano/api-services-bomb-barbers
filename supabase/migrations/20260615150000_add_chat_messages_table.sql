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
