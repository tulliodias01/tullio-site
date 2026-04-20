alter table properties
  add column if not exists home_featured boolean not null default false,
  add column if not exists home_featured_order smallint;

alter table properties
  drop constraint if exists properties_home_featured_order_check;

alter table properties
  add constraint properties_home_featured_order_check
  check (
    (home_featured = false and home_featured_order is null)
    or
    (home_featured = true and home_featured_order between 1 and 3)
  );

create unique index if not exists idx_properties_home_featured_order_unique
  on properties(home_featured_order)
  where home_featured = true and home_featured_order is not null;

create index if not exists idx_properties_home_featured
  on properties(home_featured, home_featured_order);
