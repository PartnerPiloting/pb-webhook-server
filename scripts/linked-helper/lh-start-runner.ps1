# Starts Linked Helper's campaigns runner without a mouse.
#
# Why this exists: after a Windows restart the start command opens Linked Helper but leaves the
# campaigns runner STOPPED - deliberate on their part, no command-line flag exists. See
# docs/linked-helper-machine-setup.md Part 3a.
#
# Safe to run on a schedule: it matches ONLY "Start campaigns runner", so on a healthy machine it
# finds nothing and does nothing. It can never stop a working client.
#
# Proven on Guy's Acer 2026-08-28: Idle -> CLICKED <BUTTON> -> Running campaigns...

$ErrorActionPreference = 'Stop'

function Get-LhTitle {
  $p = Get-Process linked-helper -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*Instance*' }
  if ($p) { return $p.MainWindowTitle } else { return '' }
}
function Get-LhState($t) {
  if ($t -match 'Running campaigns') { return 'RUNNING' }
  elseif ($t -match '\| Idle \|')    { return 'IDLE' }
  elseif ($t -eq '')                 { return 'NOT OPEN' }
  else                               { return 'UNKNOWN' }
}

$before  = Get-LhTitle
$sBefore = Get-LhState $before
"BEFORE : $sBefore"
if ($before) { "         $before" }

if ($sBefore -eq 'NOT OPEN') { "Linked Helper is not open - nothing to do."; return }
if ($sBefore -eq 'RUNNING')  { "Already running - leaving it alone."; return }

# The control port is random on every launch (--remote-debugging-port=0). Never hardcode it.
$ids  = (Get-Process linked-helper).Id
$port = $null
foreach ($c in (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess })) {
  try {
    $v = Invoke-WebRequest ("http://127.0.0.1:{0}/json/version" -f $c.LocalPort) -UseBasicParsing -TimeoutSec 3
    if ($v.Content -match 'Browser') { $port = $c.LocalPort; break }
  } catch { }
}
if (-not $port) { "Could not find Linked Helper's control port."; return }

$list   = (Invoke-WebRequest "http://127.0.0.1:$port/json/list" -UseBasicParsing).Content | ConvertFrom-Json
$target = $list | Where-Object { $_.type -eq 'page' -and $_.title -eq 'Linked Helper 2' } | Select-Object -First 1
if (-not $target) { "Could not find the Linked Helper screen."; return }

# ^start campaigns runner$ ONLY - a looser match also finds the Stop button.
$js = '(function(){var re=/^start campaigns runner$/i;var els=[].slice.call(document.querySelectorAll(''button,[role="button"],div,span'')).filter(function(e){var t=(e.innerText||"").trim();return re.test(t)&&e.offsetParent!==null;});if(!els.length)return "NOT FOUND";var b=els.filter(function(e){return e.tagName==="BUTTON";})[0]||els[0];b.click();return "CLICKED <"+b.tagName+">";})()'

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $ct).Wait()
$msg   = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $js; returnByValue = $true } } | ConvertTo-Json -Depth 6 -Compress
$bytes = [Text.Encoding]::UTF8.GetBytes($msg)
$ws.SendAsync((New-Object System.ArraySegment[byte] (,$bytes)), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()

$raw = ''
for ($i = 0; $i -lt 30; $i++) {
  $buf = New-Object byte[] 131072
  $sb  = New-Object System.Text.StringBuilder
  do {
    $t = $ws.ReceiveAsync((New-Object System.ArraySegment[byte] (,$buf)), $ct); $t.Wait()
    [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $t.Result.Count))
  } while (-not $t.Result.EndOfMessage)
  $raw = $sb.ToString()
  if ($raw -match '"id"\s*:\s*1\b') { break }
}
$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $ct).Wait()

"ACTION : " + (($raw | ConvertFrom-Json).result.result.value)
Start-Sleep -Seconds 6
$after = Get-LhTitle
"AFTER  : " + (Get-LhState $after)
if ($after) { "         $after" }
