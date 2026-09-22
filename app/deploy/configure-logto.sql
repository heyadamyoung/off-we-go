do $configure_logto$
begin
  update sign_in_experiences
  set sign_in = jsonb_set(
        sign_in,
        '{methods}',
        '[{"identifier":"email","password":true,"verificationCode":true,"isPasswordPrimary":true}]'::jsonb,
        true
      ),
      sign_up = sign_up || '{"identifiers":["email"],"password":true,"verify":true}'::jsonb
  where tenant_id = 'default' and id = 'default';

  if not found then
    raise exception 'Default Logto sign-in experience was not found';
  end if;
end
$configure_logto$;

-- Account locking, off, and whoever it caught, let out.
--
-- Logto ships a "sentinel": a target that fails to sign in too many times in
-- an hour is blocked, and the block is a row in `sentinel_activities` with a
-- decision of `Blocked` and an expiry in the future (packages/core/src/
-- sentinel/basic-sentinel.ts, v1.41.0). `isBlocked` is a straight read of
-- those rows; `decide` counts the failures of the last hour against
-- `maxAttempts` and, on the way past it, writes a new block that lasts
-- `lockoutDuration` minutes. Both numbers come from `sentinel_policy` on the
-- default sign-in experience, merged over Logto's own defaults — five
-- attempts an hour, out of the box.
--
-- Asked for: locking off, and the people it has already caught back in. That
-- is two changes, not one, and doing either alone does nothing.
--
--   * Expiring the live blocks alone is undone by the next wrong password:
--     `decide` counts the *non-blocked* failures of the last hour, which the
--     unlock deliberately leaves standing, so the block comes straight back.
--   * Turning the policy off alone leaves every live block exactly where it
--     is: `isBlocked` never looks at the policy, only at the rows.
--
-- So: the policy first, then the rows. A billion attempts is not five, and a
-- lockout of zero minutes expires at the instant it is written — `isBlocked`
-- wants an expiry strictly in the future, so a block decided under this
-- policy is already over by the time anybody reads it. Belt and braces, and
-- either one alone would do.
--
-- The rows are expired, never deleted. They are the record of who was locked
-- out and when, the deploy reports them for a day afterwards, and throwing
-- away the evidence of a brute-force attempt to unlock its victim would be a
-- poor trade. Expiring is the smallest change that ends a block: the row
-- keeps its `Blocked` decision, so it still does not count towards the next
-- one either.
--
-- This turns off Logto's brute-force protection for this deployment. It is
-- deliberate and it is reversible: delete this block and a release puts the
-- default policy back.
--
-- A statement of its own rather than more of the block above, because psql
-- commits each one: if the sentinel table is ever renamed out from under us,
-- this fails loudly and sign-in configuration is already committed and safe.
do $unlock_accounts$
declare
  blocked_now bigint;
  blocked_today bigint;
  let_in bigint;
begin
  if to_regclass('sentinel_activities') is null then
    raise exception
      'Logto has no sentinel_activities table, so account locking cannot be turned off here';
  end if;

  select count(*) filter (where decision_expires_at > now()),
         count(*) filter (where created_at > now() - interval '24 hours')
    into blocked_now, blocked_today
    from sentinel_activities
   where decision = 'Blocked';

  update sign_in_experiences
     set sentinel_policy = coalesce(sentinel_policy, '{}'::jsonb)
           || '{"maxAttempts":1000000000,"lockoutDuration":0}'::jsonb
   where tenant_id = 'default' and id = 'default';

  if not found then
    raise exception 'Default Logto sign-in experience was not found';
  end if;

  update sentinel_activities
     set decision_expires_at = now()
   where decision = 'Blocked'
     and decision_expires_at > now();
  get diagnostics let_in = row_count;

  raise notice
    'sentinel: locking off; % of % live blocks let in, % blocks issued in the last day',
    let_in, blocked_now, blocked_today;
end
$unlock_accounts$;
