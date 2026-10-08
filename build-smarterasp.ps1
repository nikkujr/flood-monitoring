$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = Join-Path $projectRoot "frontend"
$backendRoot = Join-Path $projectRoot "backend"
$outputRoot = Join-Path $projectRoot "deploy\smarterasp"
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

Push-Location $frontendRoot
try {
  & $npm run build
  if ($LASTEXITCODE -ne 0) { throw "Angular production build failed." }
} finally { Pop-Location }

Push-Location $backendRoot
try {
  & $npm run build
  if ($LASTEXITCODE -ne 0) { throw "Backend production build failed." }
} finally { Pop-Location }

if (Test-Path $outputRoot) { Remove-Item -LiteralPath $outputRoot -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $outputRoot "public") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot "storage\uploads") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot "logs") -Force | Out-Null

$browserRoot = Get-ChildItem (Join-Path $frontendRoot "dist") -Recurse -File -Filter "index.html" | Select-Object -First 1 -ExpandProperty DirectoryName
if (-not $browserRoot) { throw "Angular browser output was not found." }

Copy-Item -Path (Join-Path $browserRoot "*") -Destination (Join-Path $outputRoot "public") -Recurse -Force
Copy-Item -Path (Join-Path $backendRoot "dist") -Destination $outputRoot -Recurse -Force
Copy-Item -Path (Join-Path $backendRoot "data") -Destination $outputRoot -Recurse -Force
Copy-Item -Path (Join-Path $backendRoot "sql") -Destination $outputRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $backendRoot "package.json") -Destination $outputRoot
Copy-Item -LiteralPath (Join-Path $backendRoot "package-lock.json") -Destination $outputRoot
Copy-Item -LiteralPath (Join-Path $backendRoot "web.config") -Destination $outputRoot
Copy-Item -LiteralPath (Join-Path $backendRoot "smarterasp.env.example") -Destination (Join-Path $outputRoot ".env.example")

Push-Location $outputRoot
try {
  & $npm ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "Production dependency installation failed." }
} finally { Pop-Location }

Write-Host "SMARTERASP.NET package prepared at: $outputRoot"
Write-Host "Create .env from .env.example only after entering production secrets."
Write-Host "Import the database dump separately; it is intentionally excluded from the web package."
