// URL y Clave Anónima de tu proyecto Supabase
const SUPABASE_URL = 'https://fmqpudvuzimvoiyjbuyr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtcXB1ZHZ1emltdm9peWpidXlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDIxMjUsImV4cCI6MjA4Nzc3ODEyNX0._bNeZ3ad3mVlfa_L_2mHMKN-KyxYZdc8BwfeIGlkX6w';

// Inicializar el cliente de Supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
