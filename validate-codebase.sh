#!/bin/bash
# Comprehensive Codebase Bug Detection Script
# Finds common bugs across the entire codebase

echo "=========================================="
echo "COMPREHENSIVE CODEBASE BUG DETECTION"
echo "=========================================="
echo ""

ERRORS_FOUND=0

# Find ALL JavaScript files in the codebase (excluding node_modules, .git, etc.)
ALL_JS_FILES=$(find . -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/linkedin-messaging-followup-next/*" -not -path "*/LinkedIn-Messaging-FollowUp/*" -type f)

# Convert to array for route files (main focus)
ROUTE_FILES=(
  "routes/apiAndJobRoutes.js"
  "routes/apifyWebhookRoutes.js"
  "routes/apifyControlRoutes.js"
  "routes/apifyProcessRoutes.js"
  "routes/apifyRunsRoutes.js"
  "routes/diagnosticRoutes.js"
  "routes/debugRoutes.js"
  "routes/authTestRoutes.js"
  "routes/topScoringLeadsRoutes.js"
  "routes/webhookHandlers.js"
)

# High-priority files to check thoroughly
CRITICAL_FILES=(
  "index.js"
  "batchScorer.js"
  "singleScorer.js"
  "postBatchScorer.js"
  "postGeminiScorer.js"
  "actionExtractor.js"
  "services/leadService.js"
  "services/clientService.js"
  "services/jobOrchestrationService.js"
  "services/productionIssueService.js"
  "utils/contextLogger.js"
  "utils/errorHandler.js"
)

# Service and utility files
SERVICE_FILES=$(find services -name "*.js" -type f 2>/dev/null)
UTIL_FILES=$(find utils -name "*.js" -type f 2>/dev/null)

echo "======================================"
echo "CHECK 1: Logger Variable Name Mismatches (ALL FILES)"
echo "======================================"
echo "Looking for 'logger.' calls where variable is named differently..."
echo ""

# Check route files first
echo "--- ROUTE FILES ---"
for file in "${ROUTE_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Checking: $file"
    awk '
      /^router\.(get|post|put|delete)/ {ep_start=NR; logger_var=""} 
      /const (.*Logger|logger) = createLogger/ {
        match($0, /const ([^ ]+) =/, arr); 
        logger_var=arr[1]
      } 
      logger_var && logger_var!="logger" && /[^a-zA-Z]logger\./ {
        print "  ❌ Line", NR": Using '\''logger'\'' but variable is '\''" logger_var "'\'' (endpoint at line " ep_start ")"
        errors++
      }
      END {
        if (errors > 0) exit 1
      }
    ' "$file"
    
    if [ $? -eq 1 ]; then
      ((ERRORS_FOUND++))
    fi
    echo ""
  fi
done

# Check critical files
echo "--- CRITICAL FILES (scorers, services, index) ---"
for file in "${CRITICAL_FILES[@]}"; do
  if [ -f "$file" ]; then
    # Check for logger variable mismatches
    ISSUES=$(awk '
      /const (.*Logger|logger) = createLogger/ {
        match($0, /const ([^ ]+) =/, arr); 
        logger_var=arr[1]
        logger_line=NR
      }
      logger_var && logger_var!="logger" && /[^a-zA-Z]logger\./ && NR > logger_line {
        print "  ⚠️  Line " NR ": Using '\''logger'\'' but variable is '\''" logger_var "'\''"
      }
    ' "$file")
    
    if [ -n "$ISSUES" ]; then
      echo "Found in: $file"
      echo "$ISSUES"
      echo ""
    fi
  fi
done

# Check all service files
echo "--- ALL SERVICE FILES ---"
for file in $SERVICE_FILES; do
  if [ -f "$file" ]; then
    ISSUES=$(awk '
      /const (.*Logger|logger) = createLogger/ {
        match($0, /const ([^ ]+) =/, arr); 
        logger_var=arr[1]
        logger_line=NR
      }
      logger_var && logger_var!="logger" && /[^a-zA-Z]logger\./ && NR > logger_line {
        print "  ⚠️  Line " NR ": Using '\''logger'\'' but variable is '\''" logger_var "'\''"
      }
    ' "$file")
    
    if [ -n "$ISSUES" ]; then
      echo "Found in: $file"
      echo "$ISSUES"
      echo ""
    fi
  fi
done

echo "======================================"
echo "CHECK 2: Unreplaced moduleLogger in Endpoints"
echo "======================================"
echo "Looking for moduleLogger usage in route handlers (should use scoped logger)..."
echo ""

for file in "${ROUTE_FILES[@]}"; do
  if [ -f "$file" ]; then
    # Skip module-level usage (lines 1-100)
    INSTANCES=$(awk 'NR > 100 && /^\s+moduleLogger\./ {print NR": " $0}' "$file")
    if [ -n "$INSTANCES" ]; then
      echo "  ❌ Found moduleLogger in: $file"
      echo "$INSTANCES"
      ((ERRORS_FOUND++))
      echo ""
    fi
  fi
done

echo "======================================"
echo "CHECK 3: Logger Typos (ALL FILES)"
echo "======================================"
echo "Looking for common typos: loger, loggers, joblogger..."
echo ""

echo "$ALL_JS_FILES" | while read file; do
  if [ -f "$file" ]; then
    TYPOS=$(grep -niE '\bloger\b|\bloggers\b|\bjoblogger\.' "$file" 2>/dev/null)
    if [ -n "$TYPOS" ]; then
      echo "  ❌ Found typos in: $file"
      echo "$TYPOS" | head -5
      ((ERRORS_FOUND++))
      echo ""
    fi
  fi
done

echo "======================================"
echo "CHECK 4: Missing createLogger Import"
echo "======================================"
echo "Looking for files using createLogger without importing it..."
echo ""

for file in "${ROUTE_FILES[@]}"; do
  if [ -f "$file" ]; then
    USES_CREATE=$(grep -c "createLogger" "$file")
    HAS_IMPORT=$(grep -c "require.*contextLogger\|import.*contextLogger" "$file")
    
    if [ "$USES_CREATE" -gt 0 ] && [ "$HAS_IMPORT" -eq 0 ]; then
      echo "  ❌ $file uses createLogger but doesn't import it"
      ((ERRORS_FOUND++))
    fi
  fi
done
echo ""

echo "======================================"
echo "CHECK 5: Async Functions Without try-catch"
echo "======================================"
echo "Looking for async route handlers without error handling..."
echo ""

for file in "${ROUTE_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Checking: $file"
    awk '
      /router\.(get|post|put|delete)\(.*async/ {
        async_line=NR
        has_try=0
      }
      async_line && /try\s*{/ {
        has_try=1
      }
      async_line && /^\}\);/ {
        if (!has_try) {
          print "  ⚠️  Line " async_line ": Async handler without try-catch"
          warnings++
        }
        async_line=0
      }
      END {
        if (warnings > 0) print "  Found " warnings " async handlers without try-catch"
      }
    ' "$file"
    echo ""
  fi
done

echo "======================================"
echo "CHECK 6: Logger Usage Before Declaration"
echo "======================================"
echo "Looking for logger calls before createLogger..."
echo ""

for file in "${ROUTE_FILES[@]}"; do
  if [ -f "$file" ]; then
    ISSUES=$(awk '
      /^router\.(get|post)/ {endpoint=1; hasLogger=0; line=NR} 
      endpoint && /const .*logger.*= createLogger/ {hasLogger=1} 
      endpoint && /[^a-zA-Z](logger|webhookLogger|debugLogger|endpointLogger|jobLogger)\.(info|error|warn|debug)/ && !hasLogger {
        print "  ⚠️  Line " NR ": logger used before createLogger (endpoint at line " line ")"
      } 
      endpoint && /^}\);/ {endpoint=0}
    ' "$file")
    
    if [ -n "$ISSUES" ]; then
      echo "Found in: $file"
      echo "$ISSUES"
      echo ""
    fi
  fi
done

echo "======================================"
echo "CHECK 7: Inconsistent Error Logging"
echo "======================================"
echo "Looking for catch blocks without logger.error..."
echo ""

for file in "${ROUTE_FILES[@]}"; do
  if [ -f "$file" ]; then
    ISSUES=$(awk '
      /catch\s*\(/ {catch_line=NR; in_catch=1; has_log=0}
      in_catch && /(logger|webhookLogger|debugLogger|endpointLogger|jobLogger)\.error/ {has_log=1}
      in_catch && /^\s*}/ {
        if (!has_log) {
          print "  ⚠️  Line " catch_line ": catch block without logger.error"
        }
        in_catch=0
      }
    ' "$file")
    
    if [ -n "$ISSUES" ]; then
      echo "Found in: $file"
      echo "$ISSUES"
      echo ""
    fi
  fi
done

echo "======================================"
echo "CHECK 8: Duplicate Route Definitions"
echo "======================================"
echo "Looking for routes defined multiple times..."
echo ""

for file in "${ROUTE_FILES[@]}"; do
  if [ -f "$file" ]; then
    DUPES=$(grep -oP 'router\.(get|post|put|delete)\("([^"]+)"' "$file" 2>/dev/null | sort | uniq -d)
    if [ -n "$DUPES" ]; then
      echo "  ❌ Found duplicate routes in: $file"
      echo "$DUPES"
      ((ERRORS_FOUND++))
      echo ""
    fi
  fi
done

echo "======================================"
echo "CHECK 9: Missing await on Async Calls"
echo "======================================"
echo "Looking for async function calls without await..."
echo ""

for file in "${ROUTE_FILES[@]}"; do
  if [ -f "$file" ]; then
    # Look for common async patterns without await
    ISSUES=$(grep -n "logRouteError\|saveToAirtable\|processLead" "$file" | grep -v "await" | head -5)
    if [ -n "$ISSUES" ]; then
      echo "⚠️  Possible missing await in: $file"
      echo "$ISSUES"
      echo ""
    fi
  fi
done

echo "======================================"
echo "CHECK 10: Console.log Still in Code (ALL FILES)"
echo "======================================"
echo "Looking for debug console.log statements..."
echo ""

echo "$ALL_JS_FILES" | while read file; do
  if [ -f "$file" ]; then
    LOGS=$(grep -n "console\.log\|console\.error\|console\.warn" "$file" 2>/dev/null | grep -v "//.*console")
    if [ -n "$LOGS" ]; then
      echo "⚠️  Found console statements in: $file"
      echo "$LOGS" | head -10
      echo ""
    fi
  fi
done

echo "======================================"
echo "CHECK 11: Scorer & Service Logger Issues"
echo "======================================"
echo "Looking for logger issues in scorer modules and critical services..."
echo ""

for file in "${CRITICAL_FILES[@]}"; do
  if [ -f "$file" ]; then
    # Check if file uses createLogger
    HAS_CREATE=$(grep -c "createLogger" "$file" 2>/dev/null || echo "0")
    HAS_IMPORT=$(grep -c "require.*contextLogger\|import.*contextLogger" "$file" 2>/dev/null || echo "0")
    
    if [ "$HAS_CREATE" -gt 0 ] && [ "$HAS_IMPORT" -eq 0 ]; then
      echo "  ❌ $file uses createLogger but doesn't import it"
      ((ERRORS_FOUND++))
    fi
    
    # Check for moduleLogger in async functions (should use scoped logger)
    ASYNC_MODULE_LOGGER=$(grep -n "async function\|async (" "$file" -A 50 | grep "moduleLogger\." | head -5)
    if [ -n "$ASYNC_MODULE_LOGGER" ]; then
      echo "  ⚠️  $file: Async functions using moduleLogger (should use scoped logger)"
      echo "$ASYNC_MODULE_LOGGER"
      echo ""
    fi
  fi
done
echo ""

echo "=========================================="
echo "SUMMARY"
echo "=========================================="
if [ $ERRORS_FOUND -eq 0 ]; then
  echo "✅ No critical errors found!"
else
  echo "❌ Found $ERRORS_FOUND critical error(s)"
  echo "Review output above and fix before deploying"
fi
echo ""
echo "Note: Warnings (⚠️) are suggestions, not blockers"
echo "=========================================="

exit $ERRORS_FOUND
