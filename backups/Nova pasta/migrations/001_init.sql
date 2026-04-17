create extension if not exists "pgcrypto";

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  slug text not null unique,
  title text not null,
  type text not null,
  badge text not null default '⭐ DESTAQUE',
  location text not null,
  cep text,
  bedrooms integer not null default 0,
  bathrooms integer not null default 0,
  area numeric(12,2) not null,
  status text not null default 'Pronto',
  price numeric(14,2) not null,
  description text not null,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  image_url text not null,
  is_cover boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete set null,
  property_slug text,
  name text not null,
  phone text not null,
  email text,
  message text not null,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now()
);

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  page_url text,
  referrer text,
  payload jsonb not null default '{}'::jsonb,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);

create table if not exists property_versions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid,
  changed_by uuid references admin_users(id) on delete set null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists backups (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_path text not null,
  payload_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_properties_slug on properties(slug);
create index if not exists idx_properties_published on properties(is_published);
create index if not exists idx_property_images_property_id on property_images(property_id);
create index if not exists idx_leads_created_at on leads(created_at desc);
create index if not exists idx_events_created_at on analytics_events(created_at desc);
