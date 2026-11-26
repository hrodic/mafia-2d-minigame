# Build the GitHub Pages artifact in docs/ from the zero-build source.
# - Minifies each src/**/*.js in place; does not bundle modules.
# - Copies index.html, styles.css and .nojekyll.
# - Never copies tests or test pages.
# Usage: powershell -ExecutionPolicy Bypass -File tools/build-pages.ps1

param(
  [string]$EsbuildVersion = '0.28.2'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'src'
$docs = Join-Path $root 'docs'
$docsTmp = Join-Path $root 'docs.tmp'
$esbuild = Join-Path $PSScriptRoot 'esbuild.exe'

if (-not (Test-Path $esbuild -PathType Leaf)) {
  Write-Output "esbuild not found; downloading @esbuild/win32-x64@$EsbuildVersion ..."
  $tmp = Join-Path $env:TEMP "mafia-esbuild-$EsbuildVersion"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $tgz = Join-Path $tmp "win32-x64-$EsbuildVersion.tgz"
  Invoke-WebRequest -UseBasicParsing `
    "https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-$EsbuildVersion.tgz" `
    -OutFile $tgz
  tar -xzf $tgz -C $tmp
  Copy-Item (Join-Path $tmp 'package/esbuild.exe') $esbuild -Force
  Remove-Item -Recurse -Force $tmp
}

if (Test-Path $docsTmp) { Remove-Item -Recurse -Force $docsTmp }
New-Item -ItemType Directory -Path $docsTmp | Out-Null
$docsSrc = Join-Path $docsTmp 'src'
New-Item -ItemType Directory -Path $docsSrc | Out-Null

Copy-Item (Join-Path $root 'index.html') (Join-Path $docsTmp 'index.html')
Copy-Item (Join-Path $root 'styles.css') (Join-Path $docsTmp 'styles.css')
Copy-Item (Join-Path $root '.nojekyll') (Join-Path $docsTmp '.nojekyll')

$entries = @(Get-ChildItem $src -Recurse -Filter *.js | ForEach-Object { $_.FullName })
if ($entries.Count -eq 0) { throw 'No source modules found under src/' }

& $esbuild @entries '--minify' '--format=esm' '--target=es2020' `
  "--outdir=$docsSrc" "--outbase=$src" '--log-level=warning'
if ($LASTEXITCODE -ne 0) { throw "esbuild failed with exit code $LASTEXITCODE" }

$required = @(
  'index.html',
  'styles.css',
  '.nojekyll',
  'src/main.js',
  'src/net/mpNet.js'
)
foreach ($rel in $required) {
  if (-not (Test-Path (Join-Path $docsTmp $rel) -PathType Leaf)) {
    throw "docs build is missing $rel"
  }
}
if (Test-Path (Join-Path $docsTmp 'src/tests')) { throw 'tests must not be copied into docs/' }
if (Get-ChildItem $docsTmp -Recurse -Filter *.test.js) { throw 'test files must not be copied into docs/' }

if (Test-Path $docs) { Remove-Item -Recurse -Force $docs }
Move-Item $docsTmp $docs

$jsCount = @(Get-ChildItem (Join-Path $docs 'src') -Recurse -Filter *.js).Count
Write-Output "Built docs/: $jsCount minified modules + index.html + styles.css + .nojekyll"
