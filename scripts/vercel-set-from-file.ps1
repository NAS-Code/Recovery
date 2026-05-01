param(
  [Parameter(Mandatory = $true)]
  [string]$CredsFile
)

$ErrorActionPreference = "Continue"
$env:Path = "C:\Program Files\nodejs;$env:Path"
Set-Location "C:\Users\n1sar\VDX"

if (-not (Test-Path $CredsFile)) {
  Write-Output "ERROR: $CredsFile not found"
  exit 1
}

$lines = [System.IO.File]::ReadAllLines($CredsFile)
$tmp = Join-Path $env:TEMP "vercel-env-value.txt"
$envs = @("production", "preview", "development")
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

$updated = @()
foreach ($line in $lines) {
  if ($line -match "^\s*$") { continue }
  if ($line -match "^\s*#") { continue }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { continue }
  $name = $line.Substring(0, $idx).Trim()
  $value = $line.Substring($idx + 1)
  $value = $value.TrimEnd("`r", "`n")

  foreach ($e in $envs) {
    "y" | & "C:\Program Files\nodejs\npx.cmd" vercel env rm $name $e --yes 2>&1 | Out-Null
  }

  [System.IO.File]::WriteAllText($tmp, $value, $utf8NoBom)
  foreach ($e in $envs) {
    cmd /c "`"C:\Program Files\nodejs\npx.cmd`" vercel env add $name $e --force --sensitive < `"$tmp`"" 2>&1 | Out-Null
  }
  $updated += $name
}

if (Test-Path $tmp) { Remove-Item $tmp -Force }

Write-Output "Updated: $($updated -join ', ')"
