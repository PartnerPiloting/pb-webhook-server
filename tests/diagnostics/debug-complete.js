#!/usr/bin/env node

// COMPLETE DEBUGGING SCRIPT - Everything we need to know

console.log('🔍 COMPLETE_DEBUG: Starting comprehensive debugging');

// 1. Environment Check
console.log('🔍 ENV_CHECK: PB_WEBHOOK_SECRET =', process.env.PB_WEBHOOK_SECRET ? `SET (${process.env.PB_WEBHOOK_SECRET.length} chars)` : 'MISSING');
console.log('🔍 ENV_CHECK: NODE_ENV =', process.env.NODE_ENV || 'undefined');
console.log('🔍 ENV_CHECK: Working directory =', process.cwd());

// 2. Script Path Check
const path = require('path');
const fs = require('fs');
const scriptPath = path.join(__dirname, 'scripts/smart-resume-client-by-client.js');
console.log('🔍 PATH_CHECK: Script path =', scriptPath);
console.log('🔍 PATH_CHECK: Script exists =', fs.existsSync(scriptPath));

if (fs.existsSync(scriptPath)) {
    const stats = fs.statSync(scriptPath);
    console.log('🔍 PATH_CHECK: Script size =', stats.size, 'bytes');
    console.log('🔍 PATH_CHECK: Script modified =', stats.mtime);
}

// 3. Node.js Syntax Check
console.log('🔍 SYNTAX_CHECK: Testing Node.js syntax...');
const { execSync } = require('child_process');

try {
    const syntaxResult = execSync(`node -c "${scriptPath}"`, { encoding: 'utf8' });
    console.log('🔍 SYNTAX_CHECK: ✅ Syntax is valid');
} catch (syntaxError) {
    console.error('🔍 SYNTAX_CHECK: ❌ Syntax error:', syntaxError.message);
    console.error('🔍 SYNTAX_CHECK: STDERR:', syntaxError.stderr?.toString());
    process.exit(1);
}

// 4. Direct Execution Test
console.log('🔍 EXEC_TEST: Testing direct script execution...');
try {
    const execResult = execSync(`node "${scriptPath}"`, {
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024, // 1MB
        stdio: 'pipe'
    });
    
    console.log('🔍 EXEC_TEST: ✅ Script executed successfully');
    console.log('🔍 EXEC_TEST: Output length:', execResult.length);
    console.log('🔍 EXEC_TEST: First 500 chars:', execResult.substring(0, 500));
    
} catch (execError) {
    console.error('🔍 EXEC_TEST: ❌ Script execution failed');
    console.error('🔍 EXEC_TEST: Exit code:', execError.status);
    console.error('🔍 EXEC_TEST: Signal:', execError.signal);
    console.error('🔍 EXEC_TEST: Error message:', execError.message);
    console.error('🔍 EXEC_TEST: STDOUT:', execError.stdout?.toString() || 'none');
    console.error('🔍 EXEC_TEST: STDERR:', execError.stderr?.toString() || 'none');
}

console.log('🔍 COMPLETE_DEBUG: Debugging complete');