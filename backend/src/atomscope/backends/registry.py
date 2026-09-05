"""Plugin discovery: built-ins plus ``atomscope.backends`` entry points."""

from __future__ import annotations

from importlib.metadata import entry_points

from atomscope.backends.base import BackendPlugin


class BackendRegistry:
    def __init__(self) -> None:
        self._plugins: dict[str, BackendPlugin] = {}
        self.load_errors: dict[str, str] = {}

    def register(self, plugin: BackendPlugin) -> None:
        if plugin.id in self._plugins:
            msg = f"backend {plugin.id!r} already registered"
            raise ValueError(msg)
        self._plugins[plugin.id] = plugin

    def get(self, backend_id: str) -> BackendPlugin:
        try:
            return self._plugins[backend_id]
        except KeyError as exc:
            msg = f"unknown backend {backend_id!r}"
            raise KeyError(msg) from exc

    def all(self) -> list[BackendPlugin]:
        return list(self._plugins.values())

    def load_entry_points(self) -> list[str]:
        loaded: list[str] = []
        for ep in entry_points(group="atomscope.backends"):
            try:
                plugin = ep.load()
            except Exception as exc:  # noqa: BLE001 - a broken plugin must not break the app
                self.load_errors[ep.name] = f"{type(exc).__name__}: {exc}"
                continue
            if plugin.id not in self._plugins:
                self.register(plugin)
                loaded.append(plugin.id)
        return loaded


def default_registry() -> BackendRegistry:
    from atomscope.backends.ase_builtin import plugin as ase_plugin  # noqa: PLC0415
    from atomscope.backends.openbabel_ff import plugin as openbabel_plugin  # noqa: PLC0415
    from atomscope.backends.qc_inputs import plugin as qc_plugin  # noqa: PLC0415

    reg = BackendRegistry()
    reg.register(ase_plugin)
    reg.register(openbabel_plugin)
    reg.register(qc_plugin)
    reg.load_entry_points()
    return reg
