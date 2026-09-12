/* A photograph you can send to somebody who is not on the trip.
 *
 * Everything here is private by design: media is served behind a signed link
 * that expires, and a signed link is minted for a reader the server has
 * already decided may read that trip. There is no way to show one picture to
 * a grandparent without an account, which is the thing people actually want to
 * do with a photograph.
 *
 * So: a token per photograph, unguessable, that stands in for the reader the
 * signed link would otherwise require. It is not a weakening of the rule — the
 * rule is "the link is the authorisation", and this is a link somebody on the
 * trip deliberately made and can take back.
 *
 * Rows rather than a column on photos, for two reasons. A share is an event
 * with an author and a time, which is what makes "who put this on the
 * internet" answerable. And revoking has to be permanent rather than a reset:
 * the old token stays in the table, revoked, so a link already sent cannot be
 * brought back to life by sharing the same picture again.
 */
create table if not exists photo_shares (
  token text primary key,
  trip_id uuid not null references trips(id) on delete cascade,
  photo_id uuid not null references photos(id) on delete cascade,
  created_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

/* The two questions asked of this table: "is this token good" (the primary
   key, on every public hit) and "does this photograph have a live link"
   (every time the viewer opens one). The second is partial because a revoked
   row is history, never an answer. */
create index if not exists photo_shares_live
  on photo_shares (photo_id)
  where revoked_at is null;
