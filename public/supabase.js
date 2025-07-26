import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// Your Supabase project URL and anon key
const SUPABASE_URL = 'https://vojzjbpjcuvdweumyjqm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvanpqYnBqY3V2ZHdldW15anFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI3NjE3MjcsImV4cCI6MjA2ODMzNzcyN30.katOqB2I6JcSlLnuKKiyd0qbJuk0VPsZ66f8Sb9dFhY';
 
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); 