# Job execution

Module: `atomscope.jobs`. `RunSpec` (argv, cwd, env additions, watched files) is produced by a
backend plugin; `JobManager` is the only component that spawns processes.

Flow:

1. `submit(spec)` validates argv[0] (absolute, executable, regular file) and cwd (exists), writes
   `job.json` into cwd, and schedules the run (bounded by `max_parallel`).
2. The process starts with `shell=False`, `start_new_session=True`, stdin closed, a minimal
   environment (PATH, HOME, LANG, LC_ALL, TMPDIR, USER) plus the spec's variables.
3. stdout/stderr are pumped line by line to `<cwd>/stdout.log`, `<cwd>/stderr.log` and to
   listeners as `LogEvent`s. Files the program writes itself (CP-PAW's `.prot`) are tailed and
   streamed the same way (`watch_files`), with a final read after exit so nothing is lost.
4. `StatusEvent`s mark running/completed/failed/cancelled; `job.json` is rewritten at each change
   with pid, timestamps and exit code so a crashed backend can be reconciled on restart.
5. `cancel(id)` sends SIGTERM to the process group, SIGKILL after a grace period.

The API layer forwards events over a WebSocket (`/api/jobs/ws`) and exposes status, logs and
cancellation. Remote schedulers would implement the same submit/cancel/status surface behind a
different runner class; nothing in the plugins depends on local execution.
