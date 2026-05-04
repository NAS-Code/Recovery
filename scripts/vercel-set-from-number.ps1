param(
  [Parameter(Mandatory = $true)]
  [string]$FromNumber
)
$ErrorActionPreference = "Continue"
$env:Path = "C:\Program Files\nodejs;$env:Path"
Set-Location "C:\Users\n1sar\VDX"

$tmp = Join-Path $env:TEMP "vercel-fromnum.txt"
[System.IO.File]::WriteAllText($tmp, $FromNumber, (New-Object System.Text.UTF8Encoding $false))

foreach ($e in @("production", "preview", "development")) {
  "y" | & "C:\Program Files\nodejs\npx.cmd" vercel env rm CLICKSEND_FROM_NUMBER $e --yes 2>&1 | Out-Null
  cmd /c "`"C:\Program Files\nodejs\npx.cmd`" vercel env add CLICKSEND_FROM_NUMBER $e --force < `"$tmp`"" 2>&1 | Out-Null
}

Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Output "CLICKSEND_FROM_NUMBER updated across prod/preview/dev"
