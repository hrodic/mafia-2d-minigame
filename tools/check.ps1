# Static health check for the zero-build project. No npm/node required.
# Usage: powershell -ExecutionPolicy Bypass -File tools/check.ps1
# Verifies: required files, relative imports resolve, no bare static imports,
# every test suite is registered in the runner, and index.html has unique ids.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$errors = New-Object System.Collections.Generic.List[string]

$required = @(
  'index.html',
  'styles.css',
  'src/main.js',
  'tests/tests.html',
  'tests/runner.js',
  'tests/harness.js'
)
foreach ($rel in $required) {
  if (-not (Test-Path (Join-Path $root $rel) -PathType Leaf)) {
    $errors.Add("missing required file: $rel")
  }
}

$srcDir = Join-Path $root 'src'
$jsFiles = @(Get-ChildItem $srcDir -Recurse -Filter *.js)
foreach ($file in $jsFiles) {
  $text = [IO.File]::ReadAllText($file.FullName)

  foreach ($m in [regex]::Matches($text, "from\s+['""](\.\.?/[^'""]+\.js)['""]")) {
    $target = [IO.Path]::GetFullPath((Join-Path $file.DirectoryName $m.Groups[1].Value))
    if (-not (Test-Path $target -PathType Leaf)) {
      $errors.Add("missing relative import in $($file.FullName): $($m.Groups[1].Value)")
    }
  }

  foreach ($m in [regex]::Matches($text, "(?m)^\s*import\s+(?:[^'""]+?\s+from\s+)?['""](?!\.)([^'""]+)['""]")) {
    $errors.Add("bare static import in $($file.FullName): $($m.Groups[1].Value)")
  }
}

$testDir = Join-Path $root 'tests'
$testFiles = @(Get-ChildItem $testDir -Filter *.test.js)
$runner = [IO.File]::ReadAllText((Join-Path $testDir 'runner.js'))
foreach ($testFile in $testFiles) {
  if ($runner -notmatch [regex]::Escape("'./$($testFile.Name)'")) {
    $errors.Add("test suite not registered in tests/runner.js: $($testFile.Name)")
  }
}

$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'))
$ids = [regex]::Matches($html, 'id="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
$duplicates = $ids | Group-Object | Where-Object { $_.Count -gt 1 }
foreach ($duplicate in $duplicates) {
  $errors.Add("duplicate id in index.html: $($duplicate.Name)")
}

if ($errors.Count -eq 0) {
  Write-Output "OK: $($jsFiles.Count) modules, $($testFiles.Count) test suites; imports resolve; runner complete; no duplicate ids."
  exit 0
}

foreach ($errorMessage in $errors) {
  Write-Output "ERROR: $errorMessage"
}
exit 1
