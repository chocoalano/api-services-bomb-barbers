CREATE TABLE IF NOT EXISTS "public"."barber_wallets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "barber_id" uuid NOT NULL REFERENCES "public"."barbers"("id") ON DELETE CASCADE UNIQUE,
    "balance" numeric(12,2) NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."wallet_transactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "wallet_id" uuid NOT NULL REFERENCES "public"."barber_wallets"("id") ON DELETE CASCADE,
    "amount" numeric(12,2) NOT NULL,
    "type" varchar(50) NOT NULL, -- 'commission', 'withdrawal_pending', 'withdrawal_rejected', 'withdrawal_completed'
    "reference_id" uuid,
    "description" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."withdrawals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "barber_id" uuid NOT NULL REFERENCES "public"."barbers"("id") ON DELETE CASCADE,
    "amount" numeric(12,2) NOT NULL,
    "status" varchar(50) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'completed'
    "bank_name" varchar(100) NOT NULL,
    "account_number" varchar(100) NOT NULL,
    "account_name" varchar(150) NOT NULL,
    "rejection_reason" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Wallet creation trigger when a barber is created
CREATE OR REPLACE FUNCTION public.create_wallet_for_new_barber()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.barber_wallets (barber_id, balance)
    VALUES (NEW.id, 0);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_wallet_after_barber_insert
AFTER INSERT ON public.barbers
FOR EACH ROW
EXECUTE FUNCTION public.create_wallet_for_new_barber();

-- Existing barbers get a wallet
INSERT INTO public.barber_wallets (barber_id, balance)
SELECT id, 0 FROM public.barbers WHERE id NOT IN (SELECT barber_id FROM public.barber_wallets);

-- Helper RPC to safely process withdrawal request and deduct balance
CREATE OR REPLACE FUNCTION public.request_withdrawal(
    p_barber_id uuid,
    p_amount numeric,
    p_bank_name varchar,
    p_account_number varchar,
    p_account_name varchar
) RETURNS json AS $$
DECLARE
    v_wallet public.barber_wallets%ROWTYPE;
    v_withdrawal_id uuid;
    v_transaction_id uuid;
BEGIN
    -- 1. Lock wallet row
    SELECT * INTO v_wallet
    FROM public.barber_wallets
    WHERE barber_id = p_barber_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet not found for barber_id %', p_barber_id;
    END IF;

    -- 2. Check balance
    IF v_wallet.balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance. Requested: %, Available: %', p_amount, v_wallet.balance;
    END IF;

    -- 3. Create withdrawal record
    INSERT INTO public.withdrawals (barber_id, amount, bank_name, account_number, account_name, status)
    VALUES (p_barber_id, p_amount, p_bank_name, p_account_number, p_account_name, 'pending')
    RETURNING id INTO v_withdrawal_id;

    -- 4. Create wallet transaction
    INSERT INTO public.wallet_transactions (wallet_id, amount, type, reference_id, description)
    VALUES (v_wallet.id, -p_amount, 'withdrawal_pending', v_withdrawal_id, 'Penarikan Dana (Pending)')
    RETURNING id INTO v_transaction_id;

    -- 5. Deduct balance
    UPDATE public.barber_wallets
    SET balance = balance - p_amount,
        updated_at = now()
    WHERE id = v_wallet.id;

    RETURN json_build_object(
        'success', true,
        'withdrawal_id', v_withdrawal_id,
        'transaction_id', v_transaction_id,
        'new_balance', v_wallet.balance - p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper RPC to safely deposit commission
CREATE OR REPLACE FUNCTION public.deposit_commission(
    p_barber_id uuid,
    p_amount numeric,
    p_commission_id uuid,
    p_description text
) RETURNS json AS $$
DECLARE
    v_wallet_id uuid;
    v_new_balance numeric;
BEGIN
    -- Update balance and get wallet_id in one statement for concurrency safety
    UPDATE public.barber_wallets
    SET balance = balance + p_amount,
        updated_at = now()
    WHERE barber_id = p_barber_id
    RETURNING id, balance INTO v_wallet_id, v_new_balance;

    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Wallet not found for barber_id %', p_barber_id;
    END IF;

    -- Create transaction log
    INSERT INTO public.wallet_transactions (wallet_id, amount, type, reference_id, description)
    VALUES (v_wallet_id, p_amount, 'commission', p_commission_id, p_description);

    RETURN json_build_object(
        'success', true,
        'wallet_id', v_wallet_id,
        'new_balance', v_new_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
