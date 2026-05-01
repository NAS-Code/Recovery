$ErrorActionPreference = "Continue"

function Try-Request {
  param([scriptblock]$Block)
  try { & $Block } catch {
    if ($_.Exception.Response) {
      $resp = $_.Exception.Response
      $loc = $resp.Headers["Location"]
      "STATUS=$([int]$resp.StatusCode) LOCATION=$loc"
    } else { "ERR=$($_.Exception.Message)" }
  }
}

Write-Output "=== 1. unauth /dashboard should redirect to /sign-in ==="
Try-Request { $r = Invoke-WebRequest -Uri "http://localhost:3000/dashboard" -UseBasicParsing -MaximumRedirection 0; "STATUS=$($r.StatusCode)" }

Write-Output "`n=== 2. resolve client + lead ids from DB ==="
$rows = wsl -d Ubuntu --user root -- bash /mnt/c/Users/n1sar/VDX/scripts/dump-ids.sh
$ids = @{}
foreach ($line in $rows) {
  $parts = $line -split "="
  if ($parts.Count -eq 2) { $ids[$parts[0].Trim()] = $parts[1].Trim() }
}
$acme = $ids["acme"]; $globex = $ids["globex"]; $frankId = $ids["frank"]; $acmeScheduled = $ids["acme_scheduled"]
"acme=$acme"; "globex=$globex"; "frank=$frankId"; "acmeScheduled=$acmeScheduled"

Write-Output "`n=== 3. sign in as Acme ==="
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Try-Request {
  $r = Invoke-WebRequest -Uri "http://localhost:3000/api/auth/sign-in" -Method POST -Body "clientId=$acme" -ContentType "application/x-www-form-urlencoded" -WebSession $session -MaximumRedirection 0 -UseBasicParsing
  "STATUS=$($r.StatusCode) LOCATION=$($r.Headers.Location)"
}
$cookies = $session.Cookies.GetCookies("http://localhost:3000")
"cookies set: $($cookies.Count)"

Write-Output "`n=== 4. authed /dashboard should be 200, only Acme leads ==="
$dash = Invoke-WebRequest -Uri "http://localhost:3000/dashboard" -WebSession $session -UseBasicParsing
"status=$($dash.StatusCode)"
$leadLinks = ([regex]::Matches($dash.Content, 'href="/dashboard/[^"/]+"')).Count
"lead links visible: $leadLinks (expect 5 for Acme)"
"contains Frank Reynolds (globex lead)? $([bool]($dash.Content -match 'Frank Reynolds'))"
"shows Acme Corp signed-in? $([bool]($dash.Content -match 'Signed in as.*Acme Corp'))"
"shows SaaStr event? $([bool]($dash.Content -match 'SaaStr'))"

Write-Output "`n=== 5. POST noshow on Globex lead with Acme cookie should 403 ==="
Try-Request {
  $r = Invoke-WebRequest -Method POST -Uri "http://localhost:3000/api/leads/$frankId/noshow" -WebSession $session -UseBasicParsing
  "STATUS=$($r.StatusCode) BODY=$($r.Content)"
}

Write-Output "`n=== 6. unauth POST to noshow should 401 ==="
Try-Request {
  $r = Invoke-WebRequest -Method POST -Uri "http://localhost:3000/api/leads/$frankId/noshow" -UseBasicParsing
  "STATUS=$($r.StatusCode) BODY=$($r.Content)"
}

Write-Output "`n=== 7. POST noshow on Acme's own scheduled lead should 502 (auth passes, sms fails) ==="
Try-Request {
  $r = Invoke-WebRequest -Method POST -Uri "http://localhost:3000/api/leads/$acmeScheduled/noshow" -WebSession $session -UseBasicParsing
  "STATUS=$($r.StatusCode) BODY=$($r.Content)"
}

Write-Output "`n=== 8. sign-out, then /dashboard should redirect again ==="
Try-Request {
  $r = Invoke-WebRequest -Uri "http://localhost:3000/api/auth/sign-out" -Method POST -WebSession $session -MaximumRedirection 0 -UseBasicParsing
  "sign-out STATUS=$($r.StatusCode) LOCATION=$($r.Headers.Location)"
}
Try-Request {
  $r = Invoke-WebRequest -Uri "http://localhost:3000/dashboard" -WebSession $session -UseBasicParsing -MaximumRedirection 0
  "after-signout STATUS=$($r.StatusCode) LOCATION=$($r.Headers.Location)"
}
