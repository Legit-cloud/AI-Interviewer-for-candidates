-- Supabase Row-Level Security (RLS) policy script (PRD §17.3).
-- Apply after migrating tables to Supabase PostgreSQL and switching users.id -> auth.users(id).

DO $$
DECLARE
  tbl text;
  user_tables text[] := ARRAY[
    'profiles',
    'candidate_documents',
    'candidate_experiences',
    'candidate_skills',
    'job_descriptions',
    'interview_preferences',
    'interview_sessions',
    'transcript_segments',
    'generated_suggestions',
    'session_notes',
    'user_consents',
    'extension_connections'
  ];
BEGIN
  FOREACH tbl IN ARRAY user_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, public;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_select_own', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id);', tbl || '_select_own', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_insert_own', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);', tbl || '_insert_own', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_update_own', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);', tbl || '_update_own', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_delete_own', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id);', tbl || '_delete_own', tbl);
  END LOOP;
END $$;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_events FROM anon, authenticated, public;

