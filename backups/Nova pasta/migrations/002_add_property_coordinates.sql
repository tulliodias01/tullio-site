alter table if exists properties
  add column if not exists latitude numeric(10, 7),
  add column if not exists longitude numeric(10, 7);
