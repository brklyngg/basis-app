-- Create google_tokens table for storing Google OAuth tokens
create table if not exists public.google_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- Enable RLS
alter table public.google_tokens enable row level security;

-- Policy: Users can only read their own tokens
create policy "Users can read own google tokens"
  on public.google_tokens for select
  using (auth.uid() = user_id);

-- Policy: Users can insert their own tokens
create policy "Users can insert own google tokens"
  on public.google_tokens for insert
  with check (auth.uid() = user_id);

-- Policy: Users can update their own tokens
create policy "Users can update own google tokens"
  on public.google_tokens for update
  using (auth.uid() = user_id);

-- Policy: Users can delete their own tokens
create policy "Users can delete own google tokens"
  on public.google_tokens for delete
  using (auth.uid() = user_id);
