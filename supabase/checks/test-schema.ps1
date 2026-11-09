# Requires PostgreSQL 17+ command-line tools on PATH. Creates no remote connections.
$ErrorActionPreference = 'Stop'
$taskRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskTempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$taskRunRoot = [System.IO.Path]::GetFullPath((Join-Path $taskTempBase ('mathmate-db-check-' + [Guid]::NewGuid().ToString('N'))))
if (-not $taskRunRoot.StartsWith($taskTempBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid test directory.' }
$taskDataPath = Join-Path $taskRunRoot 'pgdata'
$taskPasswordPath = Join-Path $taskRunRoot 'password.txt'
$taskClusterStarted = $false
$taskPreviousPgPassword = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
foreach ($toolName in @('initdb', 'pg_ctl', 'psql')) { Get-Command $toolName -ErrorAction Stop | Out-Null }
try {
  New-Item -ItemType Directory -Path $taskRunRoot | Out-Null
  $taskPassword = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  [System.IO.File]::WriteAllText($taskPasswordPath, $taskPassword, [System.Text.UTF8Encoding]::new($false))
  $taskPortProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $taskPortProbe.Start()
  $taskPort = $taskPortProbe.LocalEndpoint.Port
  $taskPortProbe.Stop()
  & initdb -D $taskDataPath --encoding=UTF8 --locale=C --auth=scram-sha-256 --username=postgres --pwfile=$taskPasswordPath --no-instructions | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create the disposable PostgreSQL cluster.' }
  # Start-Process isolates the daemon's inherited console handles. WaitForExit waits
  # for pg_ctl itself; Start-Process -Wait would also wait for the database daemon.
  $taskPgCtlArguments = @('start', '-D', ('"' + $taskDataPath + '"'), '-l', ('"' + (Join-Path $taskRunRoot 'postgres.log') + '"'), '-o', ('"-h 127.0.0.1 -p ' + $taskPort + '"'), '-w', '-t', '20')
  $taskControlProcess = Start-Process -FilePath (Get-Command pg_ctl).Source -ArgumentList $taskPgCtlArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRunRoot 'pg-ctl.stdout') -RedirectStandardError (Join-Path $taskRunRoot 'pg-ctl.stderr')
  if (-not $taskControlProcess.WaitForExit(30000)) { throw 'Timed out waiting for pg_ctl.' }
  & pg_ctl status -D $taskDataPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to start the disposable PostgreSQL cluster.' }
  $taskClusterStarted = $true
  [Environment]::SetEnvironmentVariable('PGPASSWORD', $taskPassword, 'Process')
  $taskPsqlArgs = @('-X', '--no-password', '-h', '127.0.0.1', '-p', "$taskPort", '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q')
  & psql @taskPsqlArgs -f (Join-Path $PSScriptRoot 'bootstrap-test-roles.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create the test roles.' }
  foreach ($migration in (Get-ChildItem -LiteralPath (Join-Path $taskRepoRoot 'supabase/migrations') -Filter '*.sql' | Sort-Object Name)) {
    if ($migration.Name -eq '20261110000000_add_user_numbers.sql') {
      & psql @taskPsqlArgs -f (Join-Path $PSScriptRoot 'prepare-user-number-backfill.sql')
      if ($LASTEXITCODE -ne 0) { throw 'Failed to prepare user-number migration fixtures.' }
    }
    & psql @taskPsqlArgs -f $migration.FullName
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($migration.Name)" }
  }
  foreach ($check in (Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.test.sql' | Sort-Object Name)) {
    & psql @taskPsqlArgs -f $check.FullName
    if ($LASTEXITCODE -ne 0) { throw "Schema checks failed: $($check.Name)" }
  }
} finally {
  [Environment]::SetEnvironmentVariable('PGPASSWORD', $taskPreviousPgPassword, 'Process')
  if ($taskClusterStarted -or (Test-Path -LiteralPath (Join-Path $taskDataPath 'postmaster.pid'))) { & pg_ctl stop -D $taskDataPath -m fast -w | Out-Null }
  # Verify the final absolute target before removing the disposable cluster recursively.
  $taskCleanupPath = [System.IO.Path]::GetFullPath($taskRunRoot)
  $taskExpectedPrefix = Join-Path $taskTempBase 'mathmate-db-check-'
  if ($taskCleanupPath.StartsWith($taskExpectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $taskCleanupPath)) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskDataPath 'postmaster.pid'))) {
      Remove-Item -LiteralPath $taskCleanupPath -Recurse -Force
    }
  }
}
