-- =====================================================================
-- WC2026 Prediction League — Push notification for new chat messages
-- Sends a push to all users (except the sender) who have push subs.
-- Run in Supabase SQL editor AFTER migration-push-subscriptions.sql.
-- =====================================================================

CREATE OR REPLACE FUNCTION wc26_notify_chat_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  sender_name TEXT;
  msg_preview TEXT;
  sub_user_ids UUID[];
BEGIN
  -- Get sender's display name
  SELECT display_name INTO sender_name
    FROM wc26_profiles WHERE user_id = NEW.user_id;
  IF sender_name IS NULL THEN
    sender_name := 'Someone';
  END IF;

  -- Build message preview (truncate to 80 chars)
  IF NEW.text IS NOT NULL AND NEW.text != '' THEN
    msg_preview := left(NEW.text, 80);
  ELSIF NEW.image_url IS NOT NULL THEN
    msg_preview := '📷 sent a photo';
  ELSE
    RETURN NEW; -- empty message, skip
  END IF;

  -- Get all users with push subs EXCEPT the sender
  SELECT ARRAY(
    SELECT DISTINCT user_id FROM wc26_push_subscriptions
    WHERE user_id != NEW.user_id
  ) INTO sub_user_ids;

  -- Only send if there are recipients
  IF array_length(sub_user_ids, 1) IS NOT NULL AND array_length(sub_user_ids, 1) > 0 THEN
    PERFORM net.http_post(
      url := 'https://worldcup-1jo.pages.dev/send-push',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-wc26-secret', 'REDACTED_SECRET'
      ),
      body := jsonb_build_object(
        'userIds', to_jsonb(sub_user_ids),
        'title', sender_name,
        'body', msg_preview,
        'url', '/chat'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to chat messages table
DROP TRIGGER IF EXISTS trg_wc26_chat_push ON wc26_messages;
CREATE TRIGGER trg_wc26_chat_push
  AFTER INSERT ON wc26_messages
  FOR EACH ROW
  EXECUTE FUNCTION wc26_notify_chat_push();
