-- Named live-stream tips: lock display name + message, unique USDC deposit per intent.

alter table public.tips
  add column if not exists guest_display_name text,
  add column if not exists message_sha256 text,
  add column if not exists quote_expires_at timestamptz,
  add column if not exists deposit_address text;

create unique index if not exists tips_deposit_address_idx
  on public.tips (deposit_address)
  where deposit_address is not null;

create unique index if not exists payment_records_crypto_tx_idx
  on public.payment_records (provider, crypto_transaction_id)
  where crypto_transaction_id is not null;
