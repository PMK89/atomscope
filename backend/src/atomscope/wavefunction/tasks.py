"""Surface evaluations that run beside the request that asked for them.

A field over a fine grid is the slowest thing this backend does on its own (seconds to minutes),
and Avogadro put it behind a modal progress dialog with an Abort button (AV-UI-022). The web
equivalent is not a modal: the request returns a *token* at once, the evaluation runs in a worker
thread, and the caller asks how far it has got or tells it to stop.

Cancellation is explicit rather than inferred from a dropped connection: a client that goes away
without saying so is indistinguishable from a slow one, and `is_disconnected()` on a POST whose
body has been read is not something to hang a compute budget on.
"""

from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Literal

from atomscope.model import VolumetricGrid, new_uid

TaskStatus = Literal["running", "done", "failed", "cancelled"]

#: How many finished tasks to remember. A client that never collects its result must not be able
#: to grow this without bound; the oldest finished one goes first.
MAX_TASKS = 32


@dataclass
class SurfaceTask:
    """One evaluation: what it is doing, how far it has got, and what came out."""

    id: str = field(default_factory=new_uid)
    status: TaskStatus = "running"
    progress: float = 0.0
    grid: VolumetricGrid | None = None
    error: str | None = None
    #: the coroutine doing the work; held so nothing collects it while it runs
    task: asyncio.Task[None] | None = None
    _stop: threading.Event = field(default_factory=threading.Event)

    @property
    def finished(self) -> bool:
        return self.status != "running"

    def should_stop(self) -> bool:
        return self._stop.is_set()

    def cancel(self) -> None:
        """Ask the evaluation to stop. It notices at the end of the chunk it is in."""
        self._stop.set()

    def report(self, fraction: float) -> None:
        self.progress = min(1.0, max(0.0, fraction))


class SurfaceTasks:
    """The tasks of one backend process, oldest finished ones dropped."""

    def __init__(self, limit: int = MAX_TASKS) -> None:
        self._tasks: OrderedDict[str, SurfaceTask] = OrderedDict()
        self._limit = limit

    def start(self) -> SurfaceTask:
        task = SurfaceTask()
        self._tasks[task.id] = task
        self._prune()
        return task

    def get(self, task_id: str) -> SurfaceTask | None:
        return self._tasks.get(task_id)

    def _prune(self) -> None:
        while len(self._tasks) > self._limit:
            for tid, task in self._tasks.items():
                if task.finished:
                    del self._tasks[tid]
                    break
            else:
                return  # every one is still running: nothing to drop
