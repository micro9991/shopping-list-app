create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index shopping_items_created_at_idx on public.shopping_items (created_at);

alter table public.shopping_items enable row level security;

-- 로그인 없는 공개 앱이므로 anon 역할에 전체 권한을 명시적으로 부여한다.
create policy shopping_items_select_public
  on public.shopping_items for select
  to anon, authenticated
  using (true);

create policy shopping_items_insert_public
  on public.shopping_items for insert
  to anon, authenticated
  with check (true);

create policy shopping_items_update_public
  on public.shopping_items for update
  to anon, authenticated
  using (true)
  with check (true);

create policy shopping_items_delete_public
  on public.shopping_items for delete
  to anon, authenticated
  using (true);
