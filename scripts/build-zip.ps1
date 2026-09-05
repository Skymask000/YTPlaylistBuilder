# Builds the ship-ready ZIP for the current manifest.json version.
# Run: pwsh -File scripts/build-zip.ps1
# Output: dist/YT-Playlist-Builder-v<VERSION>.zip

$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $PSScriptRoot

$manifest = Get-Content "$src\manifest.json" -Raw | ConvertFrom-Json
$version = $manifest.version
$out = "$src\dist\YT-Playlist-Builder-v$version.zip"

New-Item -ItemType Directory -Force -Path "$src\dist" | Out-Null
if (Test-Path $out) { Remove-Item $out -Force }

$staging = "$env:TEMP\ytpb-build-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $staging | Out-Null

# Files shipped in the extension
Copy-Item -Path @(
  "$src\manifest.json",
  "$src\background.js",
  "$src\popup.html",
  "$src\popup.js",
  "$src\popup.css"
) -Destination $staging
Copy-Item -Path "$src\icons" -Destination $staging -Recurse
Copy-Item -Path "$src\src" -Destination $staging -Recurse

Compress-Archive -Path "$staging\*" -DestinationPath $out -Force
Remove-Item -Recurse -Force $staging

$size = (Get-Item $out).Length
Write-Host "Built: $out ($size bytes)"
