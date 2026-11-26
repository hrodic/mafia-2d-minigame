# Static health check for the zero-build project. No npm/node required.
# Usage: powershell -ExecutionPolicy Bypass -File tools/check.ps1
# Verifies: required files, relative imports resolve, no bare static imports,
# every test suite is registered in the runner, index.html has unique ids,
# each .opencode/skills/<id>/SKILL.md has valid frontmatter + existing references,
# and the sim/ layering ratchet + singleton imports (canvas) are respected.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$errors = New-Object System.Collections.Generic.List[string]

$required = @(
  'index.html',
  'styles.css',
  'src/main.js',
  'tests/tests.html',
  'tests/runner.js',
  'tests/harness.js',
  'AGENTS.md'
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

  # Catch missing singleton imports introduced by module extraction (e.g. canvas in mpNet).
  if ($file.Name -ne 'canvas.js' -and
      $text -match '\bcanvas\.(?:width|height|getBoundingClientRect|parentElement|addEventListener|style|classList)' -and
      $text -notmatch "import\s*\{[^}]*\bcanvas\b[^}]*\}\s*from\s*['""][^'""]*canvas\.js['""]") {
    $errors.Add("missing canvas import in $($file.FullName): uses canvas.* without importing it")
  }
}

# Layering ratchet: sim/ must not import presentation/net layers. The remaining Phase 2
# debt is allowlisted; remove entries as each module migrates and never add new ones.
$simDir = Join-Path $root 'src/sim'
$simPresentationDebt = @('match.js', 'simulation.js', 'territory.js')
$simDebtFound = New-Object System.Collections.Generic.List[string]
foreach ($file in (Get-ChildItem $simDir -Filter *.js)) {
  $text = [IO.File]::ReadAllText($file.FullName)
  if ($text -match "from\s+['""]\.\./(render|audio|ui|net)/") {
    if ($simPresentationDebt -contains $file.Name) {
      $simDebtFound.Add($file.Name)
    } else {
      $errors.Add("layering: src/sim/$($file.Name) imports render/audio/ui/net")
    }
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

# Skills: .opencode/skills/<id>/SKILL.md with YAML frontmatter (name + description).
$skillsDir = Join-Path $root '.opencode/skills'
$skillCount = 0
if (Test-Path $skillsDir -PathType Container) {
  foreach ($skillDirItem in (Get-ChildItem $skillsDir -Directory)) {
    $skillId = $skillDirItem.Name
    $skillCount++
    if ($skillId -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
      $errors.Add("invalid skill id (use lowercase kebab-case): $skillId")
    }
    $skillFile = Join-Path $skillDirItem.FullName 'SKILL.md'
    if (-not (Test-Path $skillFile -PathType Leaf)) {
      $errors.Add("missing SKILL.md in skill: $skillId")
      continue
    }
    $skillText = [IO.File]::ReadAllText($skillFile)
    $frontMatter = [regex]::Match($skillText, '(?s)\A---\r?\n(.*?)\r?\n---')
    if (-not $frontMatter.Success) {
      $errors.Add("missing YAML frontmatter in skill: $skillId")
      continue
    }
    $front = $frontMatter.Groups[1].Value
    if ($front -notmatch '(?m)^name:\s*\S') {
      $errors.Add("missing name in skill frontmatter: $skillId")
    }
    $descriptionMatch = [regex]::Match($front, '(?m)^description:\s*(.+)$')
    if (-not $descriptionMatch.Success) {
      $errors.Add("missing description in skill frontmatter: $skillId")
    } elseif ($descriptionMatch.Groups[1].Value.Trim().Length -gt 1024) {
      $errors.Add("description exceeds 1024 chars: $skillId")
    }
    foreach ($ref in [regex]::Matches($skillText, '`(references/[^`]+\.md)`')) {
      $refPath = Join-Path $skillDirItem.FullName $ref.Groups[1].Value
      if (-not (Test-Path $refPath -PathType Leaf)) {
        $errors.Add("missing referenced file in ${skillId}: $($ref.Groups[1].Value)")
      }
    }
  }
}

if ($errors.Count -eq 0) {
  $debt = if ($simDebtFound.Count -eq 0) {
    'sim headless'
  } else {
    "sim presentation debt: $(($simDebtFound | Sort-Object) -join ', ')"
  }
  Write-Output "OK: $($jsFiles.Count) modules, $($testFiles.Count) test suites, $skillCount skills; imports resolve; runner complete; no duplicate ids; $debt."
  exit 0
}

foreach ($errorMessage in $errors) {
  Write-Output "ERROR: $errorMessage"
}
exit 1
