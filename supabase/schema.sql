create table if not exists public.members (
    id uuid primary key,
    account_email text not null unique,
    password_hash text not null,
    full_name text not null,
    course text not null,
    year text not null,
    teams jsonb not null,
    linkedin text,
    avatar_data_url text not null,
    created_at timestamptz not null default now()
);

alter table public.members enable row level security;