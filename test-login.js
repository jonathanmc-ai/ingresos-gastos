const { createClient } = require('@supabase/supabase-js');
const config = require('./config.js');

// We need to extract the config somehow, but since config.js is meant for browser:
const fs = require('fs');
const content = fs.readFileSync('./config.js', 'utf8');

// parse out supabaseUrl and supabaseAnonKey
const urlMatch = content.match(/const supabaseUrl = ['"]([^'"]+)['"]/);
const keyMatch = content.match(/const supabaseAnonKey = ['"]([^'"]+)['"]/);

if (!urlMatch || !keyMatch) {
    console.error("Config not match");
    process.exit(1);
}

const supabase = createClient(urlMatch[1], keyMatch[1]);

async function run() {
    const email = process.argv[2] || "admin@empresa.com";
    const pass = process.argv[3] || "123456";

    console.log(`Testing login for ${email} / ${pass}`);

    const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: pass
    });

    if (error) {
        console.error("ERROR:", error.status, error.message, error.name);
        console.error(error);
    } else {
        console.log("SUCCESS:", data.user.id);
    }
}

run();
