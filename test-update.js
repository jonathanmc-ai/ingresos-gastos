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
    const adminLogEmail = "tito@tito.com"; // Some existing company admin email that we can change the password for
    let res = await fetch(`${supabaseUrl}/rest/v1/rpc/update_company_admin`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
            // Need superadmin credentials to call this RPC normally?
            // Actually update_company_admin is SECURITY DEFINER, but checks `auth_user_is_superadmin()`!
            // So we need to fetch a superadmin token first!
        })
    });
}
