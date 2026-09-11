CREATE FUNCTION "app_lock_category_taxonomy"() RETURNS void
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT public.app_current_user_id() INTO owner_id;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'taxonomy lock requires an owner request scope' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('cashlens.category-taxonomy:' || owner_id::text, 0)
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app_lock_category_taxonomy"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app_lock_category_taxonomy"() TO "cashlens_app";--> statement-breakpoint
CREATE FUNCTION "app_lock_category_taxonomy_write"() RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  first_owner uuid;
  second_owner uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    first_owner := NEW.user_id;
  ELSIF TG_OP = 'DELETE' THEN
    first_owner := OLD.user_id;
  ELSIF OLD.user_id = NEW.user_id THEN
    first_owner := NEW.user_id;
  ELSIF OLD.user_id < NEW.user_id THEN
    first_owner := OLD.user_id;
    second_owner := NEW.user_id;
  ELSE
    first_owner := NEW.user_id;
    second_owner := OLD.user_id;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('cashlens.category-taxonomy:' || first_owner::text, 0)
  );
  IF second_owner IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('cashlens.category-taxonomy:' || second_owner::text, 0)
    );
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app_lock_category_taxonomy_write"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "categories_taxonomy_write_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "categories"
FOR EACH ROW EXECUTE FUNCTION "app_lock_category_taxonomy_write"();
