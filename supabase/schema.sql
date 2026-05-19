-- Player accounts
create table profiles (
  id uuid references auth.users primary key,
  username text,
  created_at timestamp default now()
);

-- Cards owned by player
create table collection (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id),
  card_id text,           -- matches id field in cards.json
  obtained_at timestamp default now()
);

-- Pack state
create table packs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id),
  count integer default 0
);
