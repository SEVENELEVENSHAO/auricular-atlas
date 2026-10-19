$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$atlasUrl = 'http://127.0.0.1:4327/'
try { $atlasResponse = Invoke-WebRequest $atlasUrl -TimeoutSec 2 } catch { $atlasResponse = $null }
if (-not $atlasResponse) {
  $atlasNode = (Get-Command node.exe).Source
  Start-Process -FilePath $atlasNode -ArgumentList 'node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4327' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
  for ($atlasTry=0; $atlasTry -lt 20; $atlasTry++) {
    Start-Sleep -Milliseconds 500
    try { $atlasResponse=Invoke-WebRequest $atlasUrl -TimeoutSec 1; break } catch {}
  }
}
if (-not $atlasResponse) { throw 'Atlas server could not start. Run npm install, then npm run dev.' }
Start-Process $atlasUrl
