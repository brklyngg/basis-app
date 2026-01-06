-- Migration: add_plaid_items_update_policy
-- Description: Add UPDATE policy to plaid_items table for token refresh support
-- Date: 2026-01-05

-- Users need to update their own plaid_items when:
-- 1. Access token is refreshed by Plaid
-- 2. Institution name changes
-- 3. Item metadata is updated

create policy "Users can update own plaid_items"
  on plaid_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Add updated_at trigger for automatic timestamp updates
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger plaid_items_updated_at
  before update on plaid_items
  for each row
  execute function update_updated_at_column();
