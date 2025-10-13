#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const RENDER_STAGING_URL = 'pb-webhook-server-staging.onrender.com';
const ENV_FILE = path.join(__dirname, '.env');
const GITIGNORE_FILE = path.join(__dirname, '.gitignore');
const MAX_ENV_AGE_HOURS = 24;

const args = process.argv.slice(2);
const forceRefresh = args.includes('--force');
const scriptToRun = args.find(arg => !arg.startsWith('--') && arg.endsWith('.js'));

async function main() {
    console.log('\n=== Local Environment Bootstrap ===\n');
    
    try {
        ensureGitignoreProtection();
        const needsFetch = forceRefresh || shouldFetchEnvVars();
        
        if (needsFetch) {
            const secret = await getBootstrapSecret();
            console.log('Fetching latest env vars from Render staging...');
            const envVars = await fetchEnvVars(secret);
            saveEnvFile(envVars, secret);
            console.log('Saved env vars to .env\n');
        } else {
            console.log('Using existing .env file (use --force to refresh)\n');
        }
        
        require('dotenv').config({ path: ENV_FILE });
        console.log('Loaded env vars into memory\n');
        
        if (scriptToRun) {
            console.log('Running ' + scriptToRun + '\n');
            await runScript(scriptToRun);
        } else {
            console.log('No script specified. Usage: npm run local <script.js>\n');
        }
        
    } catch (error) {
        console.error('\nError: ' + error.message + '\n');
        process.exit(1);
    }
}

function ensureGitignoreProtection() {
    const patterns = ['.env', '.env.*', '*.env'];
    
    if (!fs.existsSync(GITIGNORE_FILE)) {
        fs.writeFileSync(GITIGNORE_FILE, patterns.join('\n') + '\n', 'utf8');
        return;
    }
    
    const gitignoreContent = fs.readFileSync(GITIGNORE_FILE, 'utf8');
    const missing = patterns.filter(p => !gitignoreContent.includes(p));
    
    if (missing.length > 0) {
        fs.appendFileSync(GITIGNORE_FILE, '\n' + missing.join('\n') + '\n', 'utf8');
    }
}

function shouldFetchEnvVars() {
    if (!fs.existsSync(ENV_FILE)) {
        console.log('No .env file found. Will fetch from Render.');
        return true;
    }
    
    const stats = fs.statSync(ENV_FILE);
    const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    
    if (ageHours > MAX_ENV_AGE_HOURS) {
        console.log('.env file is ' + Math.round(ageHours) + ' hours old');
        console.log('Consider refreshing with: npm run local -- --force');
    }
    
    return false;
}

async function getBootstrapSecret() {
    if (fs.existsSync(ENV_FILE)) {
        require('dotenv').config({ path: ENV_FILE });
        if (process.env.BOOTSTRAP_SECRET) {
            return process.env.BOOTSTRAP_SECRET;
        }
    }
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question('Enter BOOTSTRAP_SECRET: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function fetchEnvVars(secret) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: RENDER_STAGING_URL,
            path: '/api/export-env-vars',
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + secret },
            timeout: 30000
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(data);
                } else if (res.statusCode === 401) {
                    reject(new Error('Authentication failed. Check BOOTSTRAP_SECRET.'));
                } else if (res.statusCode === 503) {
                    reject(new Error('BOOTSTRAP_SECRET not configured on Render.'));
                } else {
                    reject(new Error('Server returned ' + res.statusCode));
                }
            });
        });
        
        req.on('error', (e) => reject(new Error('Failed to connect: ' + e.message)));
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}

function saveEnvFile(envVars, secret) {
    let content = envVars;
    if (!content.includes('BOOTSTRAP_SECRET=')) {
        content = 'BOOTSTRAP_SECRET=' + secret + '\n' + content;
    }
    fs.writeFileSync(ENV_FILE, content, 'utf8');
}

function runScript(scriptPath) {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [scriptPath], {
            stdio: 'inherit',
            env: process.env
        });
        
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error('Script exited with code ' + code));
        });
        
        child.on('error', reject);
    });
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { main };
