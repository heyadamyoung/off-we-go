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
