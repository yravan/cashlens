CREATE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT id FROM public.users WHERE clerk_user_id = current_setting('app.clerk_user_id', true) $$;
