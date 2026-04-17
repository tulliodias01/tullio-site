create table if not exists property_private (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references properties(id) on delete cascade,
  owner_name text,
  owner_phone text,
  owner_email text,
  owner_document text,
  owner_type text,
  internal_notes text,
  commission_sale numeric(8,2),
  commission_rent numeric(8,2),
  contract_status text,
  keys_location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_private_property_id on property_private(property_id);
