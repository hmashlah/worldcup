-- =====================================================================
-- WC2026 Prediction League — Push notification trigger
-- Fires on INSERT to wc26_notifications and sends a web push to the
-- target user via the /send-push Cloudflare Pages Function.
-- Run in Supabase SQL editor AFTER migration-push-subscriptions.sql.
-- =====================================================================

-- Trigger function: sends push notification on new mention/reaction
CREATE OR REPLACE FUNCTION wc26_notify_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Only send if the user has at least one push subscription
  IF EXISTS (SELECT 1 FROM wc26_push_subscriptions WHERE user_id = NEW.user_id) THEN
    PERFORM net.http_post(
      url := 'https://worldcup-1jo.pages.dev/send-push',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-wc26-secret', 'REDACTED_SECRET'
      ),
      body := jsonb_build_object(
        'userIds', jsonb_build_array(NEW.user_id::text),
        'title', CASE NEW.type
          WHEN 'mention' THEN 'You were mentioned'
          WHEN 'reaction' THEN 'New reaction'
          ELSE 'WC2026'
        END,
        'body', NEW.text,
        'url', '/chat'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Attach trigger to notifications table
DROP TRIGGER IF EXISTS trg_wc26_notify_push ON wc26_notifications;
CREATE TRIGGER trg_wc26_notify_push
  AFTER INSERT ON wc26_notifications
  FOR EACH ROW
  EXECUTE FUNCTION wc26_notify_push();
