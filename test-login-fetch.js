const fs = require('fs');
const content = fs.readFileSync('./config.js', 'utf8');

const urlMatch = content.match(/const SUPABASE_URL = ['"]([^'"]+)['"]/);
const keyMatch = content.match(/const SUPABASE_ANON_KEY = ['"]([^'"]+)['"]/);

if (!urlMatch || !keyMatch) {
    console.error("Config not match");
    process.exit(1);
}

const supabaseUrl = urlMatch[1];
const supabaseAnonKey = keyMatch[1];

async function run() {
    const email = process.argv[2] || "admin@empresa.com";
    const pass = process.argv[3] || "123456";

    console.log(`Testing login for ${email} / ${pass}`);

    try {
        const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseAnonKey,
            },
            body: JSON.stringify({ email: email, password: pass })
        });
        const data = await res.json();
        console.log("STATUS:", res.status);
        console.log("RESPONSE:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(e);
    }
}

run();
