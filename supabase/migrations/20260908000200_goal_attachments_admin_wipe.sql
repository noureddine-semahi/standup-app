-- Lets admin_wipe_member_data's client-side caller (adminWipeMemberData in
-- db.ts) reach a target member's uploaded files. The RPC itself runs as
-- plain SQL and has no way to call the Storage API, so file cleanup has to
-- happen client-side before it runs — which needs the requesting admin to
-- see and delete another user's objects in this bucket, not just their own
-- (the existing goal_attachments_storage_* policies only cover your own
-- folder). Run this once in the Supabase SQL editor.

create policy "goal_attachments_storage_admin_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'goal-attachments' and public.is_admin());

create policy "goal_attachments_storage_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'goal-attachments' and public.is_admin());
