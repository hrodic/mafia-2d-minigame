# Scripted extraction (PowerShell)

Use line surgery for large blocks; hand-editing hundreds of lines invites silent corruption.

```powershell
$lines = [IO.File]::ReadAllLines('src/main.js')
if ($lines[190] -ne '    function foo() {') { throw 'source moved' }
$block = $lines[190..320] | ForEach-Object { if ($_ -match '^    ') { $_.Substring(4) } else { $_ } }
$block[0] = 'export function foo() {'
# remove ranges bottom-up so earlier indices stay valid
```

## Pitfalls

- Remove ranges bottom-up (highest index first); edits shift everything after them.
- Dedenting changes indentation: replacement strings written for 6 spaces may not match
  after dedent; verify with `Select-String`.
- PowerShell escapes backticks; `${n}` avoids `$n:` drive syntax; use single-quoted
  here-strings (`@' ... '@`) for JS containing `$`, backticks or quotes.
- Write UTF-8 without BOM (`[Text.UTF8Encoding]::new($false)`); avoid emoji in script
  literals. Console rendering may show wrong glyphs; trust the file bytes.
- Create target directories before `WriteAllText`.
- Bulk token renames are dangerous: exclude property access (`.name`), object keys
  (`name:`), shorthand (`{ name }`), spreads (`...name`) and quoted strings. A rename once
  corrupted the DOM id `mp-host-player-count` and broke the lobby.
- After extraction, load the game in a browser. Some modules (e.g. `mpNet.js`) are not
  imported by tests, so missing imports only fail at runtime. Exercise the guest flow too:
  a missing `canvas` import in `mpNet.js` broke only guest input while single-player worked.
  `tools/check.ps1` now guards `canvas.*` usage.

## ESM rules

- Relative imports must include `.js`; no bare specifiers.
- In a cycle, never read an imported binding at module top level. Pass parameters or use a
  bridge (`core/state.js`).
- Export `function`/`const`; for values importers must reassign, use a shared object field.
