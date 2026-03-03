const SUPABASE_URL = 'https://fmqpudvuzimvoiyjbuyr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtcXB1ZHZ1emltdm9peWpidXlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDIxMjUsImV4cCI6MjA4Nzc3ODEyNX0._bNeZ3ad3mVlfa_L_2mHMKN-KyxYZdc8BwfeIGlkX6w';

async function testAuth() {
    console.log("Testing Supabase raw auth token generation...");
    // Intentaremos usar la contraseña problemática que sabemos que falla
    // Asumiremos que es admin2@empresa.com con Prueba_1234

    // Primero, si no sabemos el correo exacto, pediremos al usuario que ponga el que le falla, pero probemos uno genérico
    const email = 'jmcabeo@gmail.com';
    const password = 'Voxera_2026'; // la de la prueba inicial que fallaba

    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
    });

    console.log(`HTTP Status: ${response.status}`);
    const text = await response.text();
    console.log(`Response body: ${text}`);
}

testAuth();
