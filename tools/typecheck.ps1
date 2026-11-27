# Static type check for the zero-build source.
# Downloads the native TypeScript compiler (tsc.exe) into tools/typescript/ if
# missing; that directory is ignored by git. Usage:
#   powershell -ExecutionPolicy Bypass -File tools/typecheck.ps1

param(
  [string]$TypeScriptVersion = '7.0.2'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$toolDir = Join-Path $PSScriptRoot 'typescript'
$tsc = Join-Path $toolDir 'package/lib/tsc.exe'

if (-not (Test-Path $tsc -PathType Leaf)) {
  Write-Output "TypeScript not found; downloading @typescript/typescript-win32-x64@$TypeScriptVersion ..."
  if (Test-Path $toolDir) { Remove-Item -Recurse -Force $toolDir }
  New-Item -ItemType Directory -Path $toolDir | Out-Null
  $tgz = Join-Path $env:TEMP "typescript-win32-x64-$TypeScriptVersion.tgz"
  Invoke-WebRequest -UseBasicParsing `
    "https://registry.npmjs.org/@typescript/typescript-win32-x64/-/typescript-win32-x64-$TypeScriptVersion.tgz" `
    -OutFile $tgz
  tar -xzf $tgz -C $toolDir
}

& $tsc -p (Join-Path $root 'jsconfig.json') --pretty false
if ($LASTEXITCODE -ne 0) {
  throw "Type check failed with exit code $LASTEXITCODE"
}
Write-Output 'Type check OK'
