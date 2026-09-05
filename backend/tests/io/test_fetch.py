"""The fetch module, never over the network: every test supplies the answer itself."""

from __future__ import annotations

import urllib.error
import urllib.request

import pytest

from atomscope.io import fetch
from atomscope.io.fetch import (
    FetchError,
    NotFoundError,
    UpstreamError,
    _AllowedHostsRedirect,
    fetch_structure,
    pdb_url,
    pubchem_url,
)

CRAMBIN = """HEADER    PLANT PROTEIN
ATOM      1  N   THR A   1      17.047  14.099   3.625  1.00 13.79           N
ATOM      2  CA  THR A   1      16.967  12.784   4.338  1.00 10.80           C
ATOM      3  C   THR A   1      15.685  12.755   5.133  1.00  9.19           C
ATOM      4  O   THR A   1      15.268  13.825   5.594  1.00  9.85           O
END
"""

# a 2D molfile: z is zero everywhere, which is what PubChem's 2d record looks like
METHANOL_2D = """methanol
  RDKit          2D

  2  1  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0
    1.4000    0.0000    0.0000 O   0  0
  1  2  1  0
M  END
"""


def test_a_pdb_id_is_checked_before_a_url_is_built() -> None:
    assert pdb_url("1crn") == "https://files.rcsb.org/download/1CRN.pdb"
    assert pdb_url("  4HHB ") == "https://files.rcsb.org/download/4HHB.pdb"
    # nothing that is not four characters of PDB id gets as far as a request
    # surrounding whitespace is trimmed, as it is from anything typed or pasted
    assert pdb_url("1ABC\n") == "https://files.rcsb.org/download/1ABC.pdb"
    for bad in ("ABCD", "1AB", "1ABCD", "../etc/passwd", "1ABC?x=1", "1A BC", "", "0ABC"):
        with pytest.raises(FetchError, match="not a PDB id"):
            pdb_url(bad)


def test_a_chemical_name_stays_inside_one_path_segment() -> None:
    assert "compound/name/caffeine/SDF?record_type=3d" in pubchem_url("caffeine")
    # a name carrying URL syntax is escaped, so it cannot reach another path or a query
    assert "a%2Fb%3Fc%23d" in pubchem_url("a/b?c#d")
    assert "?record_type=3d" in pubchem_url("a/b?c#d")
    for bad in ("", "   ", "caff\neine", "x" * 201):
        with pytest.raises(FetchError, match="not a chemical name"):
            pubchem_url(bad)


def test_a_redirect_may_not_leave_the_allowed_hosts() -> None:
    handler = _AllowedHostsRedirect()
    req = urllib.request.Request("https://files.rcsb.org/download/1CRN.pdb")
    # same host over https: followed
    assert handler.redirect_request(req, None, 302, "", {}, "https://files.rcsb.org/x/1CRN.pdb")
    for bad in (
        "http://files.rcsb.org/x",  # downgraded
        "https://169.254.169.254/latest/meta-data/",  # somewhere else entirely
        "https://localhost:8000/api/project",  # this machine
        "file:///etc/passwd",
    ):
        with pytest.raises(UpstreamError, match="refusing a redirect"):
            handler.redirect_request(req, None, 302, "", {}, bad)


def test_the_opener_replaced_urllibs_redirect_handler_rather_than_adding_to_it() -> None:
    # build_opener only drops the default when it is given a subclass; if that ever stopped being
    # true the allowlist above would be dead code and redirects would go anywhere
    assert not any(
        type(h) is urllib.request.HTTPRedirectHandler
        for h in fetch._opener.handlers  # noqa: SLF001
    )
    assert any(isinstance(h, _AllowedHostsRedirect) for h in fetch._opener.handlers)  # noqa: SLF001


class _Response:
    """Enough of an HTTPResponse for `_get`; `read(n)` always has more to give."""

    def __init__(self, body: bytes) -> None:
        self.body = body

    def read(self, n: int) -> bytes:
        return self.body[:n]

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *exc: object) -> None:
        return None


def test_an_answer_larger_than_the_cap_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    huge = _Response(b"x" * (fetch.MAX_BYTES + 10))
    monkeypatch.setattr(fetch, "HTTPResponse", _Response)
    monkeypatch.setattr(fetch._opener, "open", lambda *_a, **_k: huge)  # noqa: SLF001
    with pytest.raises(FetchError, match="larger than 32 MB"):
        fetch_structure("pdb", "1CRN")


def test_the_database_being_unreachable_is_not_the_users_fault(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def offline(*_a: object, **_k: object) -> None:
        raise urllib.error.URLError("Name or service not known")

    monkeypatch.setattr(fetch._opener, "open", offline)  # noqa: SLF001
    with pytest.raises(UpstreamError, match="could not reach the database"):
        fetch_structure("pdb", "1CRN")


def _answers(monkeypatch: pytest.MonkeyPatch, table: dict[str, str | Exception]) -> list[str]:
    """Replace the one function that touches the network; returns the URLs that were asked for."""
    asked: list[str] = []

    def get(url: str) -> str:
        asked.append(url)
        answer = table.get(url)
        if answer is None:
            raise NotFoundError("not in the database")
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(fetch, "_get", get)
    return asked


def test_a_pdb_entry_is_named_after_the_id_it_was_asked_for(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _answers(monkeypatch, {pdb_url("1CRN"): CRAMBIN})
    s = fetch_structure("pdb", "1crn")
    assert s.name == "1CRN"
    assert s.symbols() == ["N", "C", "C", "O"]
    assert s.provenance is not None and s.provenance.source == "rcsb"


def test_pubchem_without_a_3d_record_embeds_the_2d_one(monkeypatch: pytest.MonkeyPatch) -> None:
    asked = _answers(monkeypatch, {pubchem_url("methanol", record="2d"): METHANOL_2D})
    s = fetch_structure("pubchem", "methanol")
    # the 3D record was asked for first, and the 2D one only after it was not there
    assert asked == [pubchem_url("methanol"), pubchem_url("methanol", record="2d")]
    assert s.name == "methanol"
    assert s.provenance is not None and "2D record" in (s.provenance.notes or "")
    # embedded here, so it has real coordinates rather than a flat drawing
    assert any(abs(a.position[2]) > 1e-6 for a in s.atoms)


def test_a_name_that_is_in_no_database_is_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    _answers(monkeypatch, {})
    with pytest.raises(NotFoundError):
        fetch_structure("pdb", "9ZZZ")
