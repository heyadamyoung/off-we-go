-- A failed cell waits its turn again, rather than being abandoned.
--
-- The drain retried a cell five times and then left it alone for ever, with
-- its error on the row "for somebody to read". Nobody reads rows. Paris —
-- N48E002 — was found `failed` in production with a whole capital behind it
-- and no mechanism on earth that would ever try it again: a traveller
-- standing in the 4th arrondissement would have been told "still loading
-- places here" until a human noticed and typed something.
--
-- The reason for the cap was real: a permanently broken cell sorts to the
-- front of the queue on its old requested_at and starves everything behind
-- it. The answer to that is to make it wait, not to make it stop. A cell
-- that has failed is not eligible until its backoff has passed, so it cannot
-- starve anything, and the backoff grows with each failure to a ceiling of
-- six hours. Attempts are no longer a budget; they are how far down the
-- schedule a cell has got.
--
-- Existing failed rows come back into the queue at once: they have already
-- waited longer than any backoff, and the whole point is that they get
-- another go.
alter table place_coverage add column if not exists next_attempt_at timestamptz;

create index if not exists place_coverage_retry_idx
  on place_coverage (next_attempt_at nulls first, requested_at)
  where status = 'failed';
