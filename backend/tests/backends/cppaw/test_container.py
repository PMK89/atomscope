"""Container mode: the wrapper it generates, and what it refuses to promise.

None of this needs docker -- it is the argv and the advertised capabilities, which are exactly
the parts that must be right before a container is ever started. The measured claim that the
container produces the same numbers as the host installation lives in the ``cppaw``-marked suite,
which runs the real thing.
"""

import os
import stat
from pathlib import Path

import pytest

from atomscope.backends.cppaw.settings import (
    MAIN_EXE,
    PARALLEL_EXE,
    ContainerRuntime,
    CppawSettings,
    discover,
)


def test_the_wrapper_mounts_only_the_working_directory() -> None:
    text = ContainerRuntime(image="cp-paw-backend:latest").wrapper(MAIN_EXE).read_text()
    # the work directory is the one path the container is given, and it comes from the caller's
    # cwd -- not from anything interpolated at generation time
    assert '-v "$PWD:/work"' in text
    assert "-w /work" in text
    # no network, and the caller's own uid so the files it writes are not root's
    assert "--network none" in text
    assert '--user "$(id -u):$(id -g)"' in text
    assert "--rm" in text
    # arguments reach the tool through "$@", so no argument is re-parsed by a shell
    assert text.rstrip().endswith('"$@"')
    assert f"--entrypoint /app/bin/fast/{MAIN_EXE}" in text


def test_the_wrapper_is_executable_and_stable() -> None:
    rt = ContainerRuntime(image="cp-paw-backend:latest")
    first = rt.wrapper(MAIN_EXE)
    assert os.access(first, os.X_OK)
    assert stat.S_IMODE(first.stat().st_mode) == 0o755
    # asking twice is the same file, not a second copy
    assert rt.wrapper(MAIN_EXE) == first


@pytest.mark.parametrize(
    "image",
    [
        "cp-paw-backend:latest",
        "cp-paw-backend",
        "ghcr.io/cp-paw/cp-paw:2026-09",
        "cp-paw@sha256:" + "a" * 64,
    ],
)
def test_usable_image_references_are_accepted(image: str) -> None:
    assert ContainerRuntime(image=image).image == image


@pytest.mark.parametrize(
    "image",
    [
        "",
        "image; rm -rf /",
        "image$(whoami)",
        "image `id`",
        'image"',
        "image\nsecond",
        "-image",
    ],
)
def test_anything_that_is_not_an_image_reference_is_refused(image: str) -> None:
    """The reference is interpolated into a generated shell script, so the gate is the charset."""
    with pytest.raises(ValueError, match="container image reference"):
        ContainerRuntime(image=image)


def test_container_mode_does_not_promise_parallel_execution() -> None:
    """The parallel binary needs mpirun *inside* the container, which this does not set up."""
    s = CppawSettings(container=ContainerRuntime(image="cp-paw-backend:latest"))
    assert s.find(PARALLEL_EXE) is None
    assert s.find(MAIN_EXE) is not None
    report = discover(s)
    assert report.available
    assert "ppaw_fast" not in report.executables
    assert "mpirun" not in report.executables
    assert any("container cp-paw-backend:latest" in m for m in report.messages)


def test_a_configured_container_is_not_silently_replaced_by_the_host_install(
    tmp_path: Path,
) -> None:
    """Falling back would run a different CP-PAW than was asked for.

    That difference surfaces as an unexplained energy, which is the worst way to find out.
    """
    host = tmp_path / "bin" / "fast"
    host.mkdir(parents=True)
    (host / MAIN_EXE).write_text("#!/bin/sh\nexit 0\n")
    (host / MAIN_EXE).chmod(0o755)

    plain = CppawSettings(paw_dir=tmp_path)
    assert plain.find(MAIN_EXE) == host / MAIN_EXE

    containerised = CppawSettings(
        paw_dir=tmp_path, container=ContainerRuntime(image="cp-paw-backend:latest")
    )
    found = containerised.find(MAIN_EXE)
    assert found is not None
    assert found != host / MAIN_EXE
    assert "container" in str(found)


def test_the_image_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ATOMSCOPE_CPPAW_IMAGE", "cp-paw-backend:latest")
    s = CppawSettings.from_env()
    assert s.container is not None
    assert s.container.image == "cp-paw-backend:latest"
    # and a host mpirun is not offered, because it cannot drive ranks inside the container
    assert s.mpirun is None

    monkeypatch.delenv("ATOMSCOPE_CPPAW_IMAGE")
    assert CppawSettings.from_env().container is None
