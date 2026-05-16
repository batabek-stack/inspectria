$ErrorActionPreference = "Stop"

$testRoot = $PSScriptRoot
$mainRoot = "C:\Projects\MOD-Check-List-V1.10.4"

if (-not (Test-Path $mainRoot)) {
  throw "Main project not found: $mainRoot"
}

$itemsToCopy = @(
  "README.md",
  "backend\db.js",
  "backend\server.js",
  "backend\middleware",
  "backend\routes",
  "backend\package.json",
  "backend\package-lock.json",
  "frontend\src\App.tsx",
  "frontend\src\main.tsx",
  "frontend\src\components",
  "frontend\src\pages",
  "frontend\src\styles",
  "frontend\src\types",
  "frontend\src\utils",
  "frontend\src\services\assignmentService.ts",
  "frontend\src\services\authService.ts",
  "frontend\src\services\checklistService.ts",
  "frontend\src\services\draftService.ts",
  "frontend\src\services\exportService.ts",
  "frontend\src\services\reportService.ts",
  "frontend\src\services\userService.ts",
  "frontend\package.json",
  "frontend\package-lock.json",
  "frontend\tsconfig.json",
  "frontend\vite.config.ts"
)

foreach ($relativePath in $itemsToCopy) {
  $sourcePath = Join-Path $testRoot $relativePath
  $targetPath = Join-Path $mainRoot $relativePath

  if (-not (Test-Path $sourcePath)) {
    continue
  }

  if (Test-Path $sourcePath -PathType Container) {
    New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
    robocopy $sourcePath $targetPath /E /NFL /NDL /NJH /NJS /NP | Out-Null
    continue
  }

  $targetDir = Split-Path -Parent $targetPath
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
}

Write-Host "TEST changes copied to main project:"
Write-Host $mainRoot
