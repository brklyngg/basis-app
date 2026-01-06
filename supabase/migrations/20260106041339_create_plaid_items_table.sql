-- Migration: create_plaid_items_table
-- Description: Store Plaid connections per user with RLS policies
-- Date: 2026-01-06

-- Store Plaid connections per user
create table plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  access_token text not null,
  item_id text not null,
  institution_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, item_id)
);

-- RLS: Users can only see their own items
alter table plaid_items enable row level security;

create policy "Users can view own plaid_items"
  on plaid_items for select
  using (auth.uid() = user_id);

create policy "Users can insert own plaid_items"
  on plaid_items for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own plaid_items"
  on plaid_items for delete
  using (auth.uid() = user_id);
