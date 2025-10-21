#!/usr/bin/env python3
"""
Add error logging to catch blocks in JavaScript files.
Safely inserts 'await logRouteError(error, req).catch(() => {});' after console.error calls.
"""

import re
import sys

def add_error_logging_to_file(filepath):
    """Add error logging to catch blocks in a JavaScript file."""
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original_content = content
    modifications = 0
    
    # Pattern: Match catch blocks with console.error followed by res.status
    # that don't already have logRouteError or logCriticalError
    pattern = r'(  } catch \([^)]+\) \{\s*\n)(    console\.error\([^\n]+\n)(    res\.status\()'
    
    def replacement(match):
        nonlocal modifications
        catch_line = match.group(1)
        console_line = match.group(2)
        res_line = match.group(3)
        
        # Check if logging already exists
        full_match = match.group(0)
        if 'logRouteError' in full_match or 'logCriticalError' in full_match:
            return match.group(0)
        
        modifications += 1
        return f'{catch_line}{console_line}    await logRouteError(error, req).catch(() => {{}});\n{res_line}'
    
    content = re.sub(pattern, replacement, content)
    
    if content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'✅ Added error logging to {modifications} catch blocks in {filepath}')
        return modifications
    else:
        print(f'⏭️  No changes needed for {filepath}')
        return 0

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 add-error-logging.py <filepath>')
        sys.exit(1)
    
    filepath = sys.argv[1]
    count = add_error_logging_to_file(filepath)
    print(f'\nTotal modifications: {count}')
