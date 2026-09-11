CREATE FUNCTION "public"."protect_connection_transition"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'provisioning' AND NEW.status IN ('active', 'cleanup_required', 'disconnected')) OR
    (OLD.status = 'cleanup_required' AND NEW.status = 'disconnected') OR
    (OLD.status = 'active' AND NEW.status = 'disconnected')
  ) THEN
    RAISE EXCEPTION 'invalid connection status transition' USING ERRCODE = '42501';
  END IF;

  IF (NEW.institution_id, NEW.institution_name)
      IS DISTINCT FROM (OLD.institution_id, OLD.institution_name)
    AND NOT (OLD.status = 'provisioning' AND NEW.status = 'active') THEN
    RAISE EXCEPTION 'connection institution identity is immutable' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER protect_connection_transition
BEFORE UPDATE OF "status", "institution_id", "institution_name" ON "connections"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_connection_transition"();--> statement-breakpoint
GRANT UPDATE ("institution_id", "institution_name") ON TABLE "connections" TO "cashlens_app";
