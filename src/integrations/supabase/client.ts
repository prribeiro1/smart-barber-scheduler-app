// This file is automatically generated. Do not edit it directly.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://lwdiadresmxwmebmfpig.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3ZGlhZHJlc214d21lYm1mcGlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwMDE2MzYsImV4cCI6MjA2MzU3NzYzNn0.r5aTXehzpRZfQtA6qhLwq4Z8nDUjk06fMR-ByoCsDmk";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);