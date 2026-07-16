$Connections = Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue
foreach ($Connection in $Connections) {
  Stop-Process -Id $Connection.OwningProcess -Force -ErrorAction SilentlyContinue
}
Write-Host "Workbench stopped."

