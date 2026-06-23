-- =====================================================================
-- WC2026 Prediction League — Chat images + edit/delete support
-- Adds image_url column, storage bucket, and edit/delete policies.
-- Run in Supabase SQL editor.
-- =====================================================================

-- 1) Add image_url column to messages
ALTER TABLE wc26_messages
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2) Create storage bucket for chat images (public read, authenticated upload)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-images', 'chat-images', true)
ON CONFLICT (id) DO NOTHING;

-- 3) Storage policies: authenticated users can upload, everyone can read
DROP POLICY IF EXISTS "wc26 anyone reads chat images" ON storage.objects;
CREATE POLICY "wc26 anyone reads chat images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-images');

DROP POLICY IF EXISTS "wc26 authenticated uploads chat images" ON storage.objects;
CREATE POLICY "wc26 authenticated uploads chat images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-images');

-- 4) Allow users to edit their own messages within 30 minutes
DROP POLICY IF EXISTS "wc26 user updates own messages" ON wc26_messages;
CREATE POLICY "wc26 user updates own messages"
  ON wc26_messages FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND created_at > now() - interval '30 minutes'
  )
  WITH CHECK (auth.uid() = user_id);

-- 5) Allow users to delete their own messages within 30 minutes
DROP POLICY IF EXISTS "wc26 user deletes own messages" ON wc26_messages;
CREATE POLICY "wc26 user deletes own messages"
  ON wc26_messages FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    AND created_at > now() - interval '30 minutes'
  );
