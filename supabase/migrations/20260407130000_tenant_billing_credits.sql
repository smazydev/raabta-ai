-- Tenant credit wallet, ledger, and atomic consume for high-volume metering (pool role `postgres`).

CREATE TABLE public.tenant_billing (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  credit_balance numeric(24, 6) NOT NULL DEFAULT 100000,
  included_credits_monthly numeric(24, 6) NOT NULL DEFAULT 100000,
  billing_period_months integer NOT NULL DEFAULT 1
    CHECK (billing_period_months >= 1 AND billing_period_months <= 12),
  billing_period_start timestamptz NOT NULL DEFAULT (date_trunc('month', timezone('utc', now())))::timestamptz,
  billing_period_end timestamptz NOT NULL DEFAULT ((date_trunc('month', timezone('utc', now())) + interval '1 month')::timestamptz),
  payg_enabled boolean NOT NULL DEFAULT true,
  payg_max_debt_credits numeric(24, 6),
  base_platform_fee_usd numeric(14, 4) NOT NULL DEFAULT 299,
  credits_per_usd_payg numeric(14, 6) NOT NULL DEFAULT 5000,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_billing IS
  'Per-tenant AI credit balance, monthly included allowance, PAYG flags. Row lock on consume scales to very high request rates per tenant.';

CREATE TABLE public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  delta numeric(24, 6) NOT NULL,
  balance_after numeric(24, 6) NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX credit_ledger_tenant_created_idx ON public.credit_ledger (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.billing_consume_credits(
  p_tenant_id uuid,
  p_credits numeric,
  p_reason text,
  p_metadata jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  r public.tenant_billing%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
  v_ledger_id uuid;
  v_bal numeric;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN
    INSERT INTO public.tenant_billing (tenant_id) VALUES (p_tenant_id)
    ON CONFLICT (tenant_id) DO NOTHING;
    SELECT credit_balance INTO v_bal FROM public.tenant_billing WHERE tenant_id = p_tenant_id;
    RETURN jsonb_build_object('ok', true, 'new_balance', COALESCE(v_bal, 0), 'skipped', true);
  END IF;

  INSERT INTO public.tenant_billing (tenant_id) VALUES (p_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO r FROM public.tenant_billing WHERE tenant_id = p_tenant_id FOR UPDATE;

  WHILE v_now >= r.billing_period_end LOOP
    r.credit_balance := r.credit_balance + r.included_credits_monthly;
    r.billing_period_start := r.billing_period_end;
    r.billing_period_end := r.billing_period_end + (r.billing_period_months * interval '1 month');
  END LOOP;

  IF r.credit_balance < p_credits THEN
    IF NOT r.payg_enabled THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'insufficient_credits',
        'balance', r.credit_balance,
        'required', p_credits
      );
    END IF;
    IF r.payg_max_debt_credits IS NOT NULL
       AND (r.credit_balance - p_credits) < -r.payg_max_debt_credits THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'payg_debt_cap',
        'balance', r.credit_balance,
        'required', p_credits
      );
    END IF;
  END IF;

  r.credit_balance := r.credit_balance - p_credits;

  UPDATE public.tenant_billing SET
    credit_balance = r.credit_balance,
    billing_period_start = r.billing_period_start,
    billing_period_end = r.billing_period_end,
    updated_at = v_now
  WHERE tenant_id = p_tenant_id;

  INSERT INTO public.credit_ledger (tenant_id, delta, balance_after, reason, metadata)
  VALUES (p_tenant_id, -p_credits, r.credit_balance, COALESCE(NULLIF(trim(p_reason), ''), 'consume'), COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'ok', true,
    'new_balance', r.credit_balance,
    'ledger_id', v_ledger_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_add_credits(
  p_tenant_id uuid,
  p_credits numeric,
  p_reason text,
  p_metadata jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  r public.tenant_billing%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
  v_ledger_id uuid;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  INSERT INTO public.tenant_billing (tenant_id) VALUES (p_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO r FROM public.tenant_billing WHERE tenant_id = p_tenant_id FOR UPDATE;

  WHILE v_now >= r.billing_period_end LOOP
    r.credit_balance := r.credit_balance + r.included_credits_monthly;
    r.billing_period_start := r.billing_period_end;
    r.billing_period_end := r.billing_period_end + (r.billing_period_months * interval '1 month');
  END LOOP;

  r.credit_balance := r.credit_balance + p_credits;

  UPDATE public.tenant_billing SET
    credit_balance = r.credit_balance,
    billing_period_start = r.billing_period_start,
    billing_period_end = r.billing_period_end,
    updated_at = v_now
  WHERE tenant_id = p_tenant_id;

  INSERT INTO public.credit_ledger (tenant_id, delta, balance_after, reason, metadata)
  VALUES (p_tenant_id, p_credits, r.credit_balance, COALESCE(NULLIF(trim(p_reason), ''), 'credit_purchase'), COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object('ok', true, 'new_balance', r.credit_balance, 'ledger_id', v_ledger_id);
END;
$$;

ALTER TABLE public.tenant_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_billing_postgres_all ON public.tenant_billing
  FOR ALL TO postgres
  USING (true)
  WITH CHECK (true);

CREATE POLICY credit_ledger_postgres_all ON public.credit_ledger
  FOR ALL TO postgres
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_billing_select_admin ON public.tenant_billing
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin());

CREATE POLICY credit_ledger_select_admin ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin());
