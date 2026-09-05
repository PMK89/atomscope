"""
Fetch a structure from a public database (Avogadro's File ▸ Import ▸ Fetch from PDB / by name).

Two fixed sources, and only two: RCSB for a PDB entry and PubChem for a chemical name. The user
supplies an *identifier*, never a URL -- it is validated, then placed in one path segment of a
hard-coded https address. Avogadro's third command, Fetch from URL, is deliberately not offered:
an arbitrary URL is a request this process makes on someone else's behalf, which is a different
feature with a different threat model (AV-FILE-015).

Redirects are followed only within the allowed hosts, so an upstream redirect cannot turn a fetch
into a request to something on this machine or this network.
"""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from http import HTTPStatus
from http.client import HTTPResponse
from typing import Literal
from urllib.parse import quote, urlsplit

from atomscope.io.registry import structure_from_string
from atomscope.model import Provenance, Structure

Source = Literal["pdb", "pubchem"]

ALLOWED_HOSTS = frozenset({"files.rcsb.org", "pubchem.ncbi.nlm.nih.gov"})
"""Every host this module is allowed to talk to, redirects included."""

# a PDB id is four characters: a digit 1-9 then three alphanumerics (1CRN, 4HHB, 2GTL)
# `\Z`, not `$`: `$` also matches before a trailing newline, which would let one through
PDB_ID = re.compile(r"\A[1-9][A-Za-z0-9]{3}\Z")
# an InChIKey is 14 letters, a dash, 10 letters, a dash and one letter: LFQSCWFLJHTTHZ-UHFFFAOYSA-N
INCHIKEY = re.compile(r"\A[A-Z]{14}-[A-Z]{10}-[A-Z]\Z")
MAX_NAME = 200
# a large entry is a few tens of MB; beyond that the caller wanted a file, not a paste
MAX_BYTES = 32 * 1024 * 1024
TIMEOUT = 15.0
USER_AGENT = "Atomscope/0.1 (molecular modelling)"


class FetchError(ValueError):
    """The fetch could not be made or the answer was not a structure."""


class NotFoundError(FetchError):
    """The database does not have this identifier."""


class UpstreamError(FetchError):
    """The database could not be reached, or answered with an error of its own."""


class _AllowedHostsRedirect(urllib.request.HTTPRedirectHandler):
    """Follows a redirect only when it stays on an allowed host, and only over https."""

    def redirect_request(  # noqa: PLR0917 (the signature is urllib's)
        self,
        req: urllib.request.Request,
        fp: object,
        code: int,
        msg: str,
        headers: object,
        newurl: str,
    ) -> urllib.request.Request | None:
        parts = urlsplit(newurl)
        if parts.scheme != "https" or parts.hostname not in ALLOWED_HOSTS:
            raise UpstreamError(f"refusing a redirect to {newurl!r}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)  # type: ignore[arg-type]


_opener = urllib.request.build_opener(_AllowedHostsRedirect())


def _get(url: str) -> str:
    """GET `url`, which must already be one this module built. Text, capped and decoded."""
    if urlsplit(url).hostname not in ALLOWED_HOSTS:  # pragma: no cover - belt and braces
        msg = f"not a host this fetches from: {url!r}"
        raise FetchError(msg)
    # both databases ask callers to identify themselves; the default urllib agent is what their
    # rate limiters are least kind to
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})  # noqa: S310
    try:
        with _opener.open(request, timeout=TIMEOUT) as response:
            assert isinstance(response, HTTPResponse)
            # read one byte past the cap, so a body exactly at the limit is not called too big
            body = response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        if exc.code == HTTPStatus.NOT_FOUND:
            msg = "not in the database"
            raise NotFoundError(msg) from exc
        if HTTPStatus.BAD_REQUEST <= exc.code < HTTPStatus.INTERNAL_SERVER_ERROR:
            # the database understood and refused: that is about the query, not the service
            msg = f"the database rejected the request ({exc.code} {exc.reason})"
            raise FetchError(msg) from exc
        msg = f"the database answered {exc.code} {exc.reason}"
        raise UpstreamError(msg) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        msg = f"could not reach the database ({exc})"
        raise UpstreamError(msg) from exc
    if len(body) > MAX_BYTES:
        msg = f"the answer is larger than {MAX_BYTES // (1024 * 1024)} MB"
        raise FetchError(msg)
    return body.decode("utf-8", errors="replace")


def pdb_url(ident: str) -> str:
    """The RCSB address of a PDB entry. Raises when `ident` is not a PDB id."""
    if not PDB_ID.match(ident.strip()):
        msg = f"{ident!r} is not a PDB id (four characters, e.g. 1CRN)"
        raise FetchError(msg)
    return f"https://files.rcsb.org/download/{ident.strip().upper()}.pdb"


def pubchem_url(name: str, *, record: str = "3d") -> str:
    """The PubChem address of a compound by name. Raises when `name` cannot be one."""
    trimmed = name.strip()
    if not trimmed or len(trimmed) > MAX_NAME or any(c < " " for c in trimmed):
        msg = f"{name!r} is not a chemical name"
        raise FetchError(msg)
    # quoted with an empty safe set: a name with a slash or a question mark in it stays inside
    # the one path segment it belongs to
    escaped = quote(trimmed, safe="")
    return (
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{escaped}"
        f"/SDF?record_type={record}"
    )


def pubchem_name_url(inchikey: str) -> str:
    """The PubChem address of a compound's IUPAC name. Raises when `inchikey` is not one."""
    key = inchikey.strip().upper()
    if not INCHIKEY.match(key):
        msg = f"{inchikey!r} is not an InChIKey"
        raise FetchError(msg)
    return (
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/{key}/property/IUPACName/TXT"
    )


def compound_name(inchikey: str) -> str:
    """The IUPAC name PubChem has for this compound.

    Avogadro's Molecule Properties dialog fetched a name too, from a service that is gone
    (molecularpropextension.cpp). This asks the database Atomscope already fetches structures
    from, with an identifier the caller computed locally -- the structure itself never leaves.
    """
    answer = _get(pubchem_name_url(inchikey)).strip()
    if not answer:
        msg = "not in the database"
        raise NotFoundError(msg)
    # TXT gives one line per record; a key identifies one compound, so take the first
    return answer.splitlines()[0].strip()


def fetch_structure(source: Source, query: str) -> Structure:
    """Download one structure. `query` is a PDB id or a chemical name, never a URL."""
    if source == "pdb":
        ident = query.strip().upper()
        structure = structure_from_string(_get(pdb_url(query)), "pdb")
        structure.name = ident
        structure.provenance = Provenance(source="rcsb", notes=f"PDB entry {ident}")
        return structure
    if source == "pubchem":
        name = query.strip()
        try:
            structure = structure_from_string(_get(pubchem_url(name)), "sdf")
            note = "PubChem 3D record"
        except NotFoundError:
            # no 3D conformer: take the connectivity and embed it here, as a SMILES import does
            structure = _embedded(_get(pubchem_url(name, record="2d")))
            note = "PubChem 2D record, embedded in 3D here"
        structure.name = name
        structure.provenance = Provenance(source="pubchem", notes=f"{note} for {name!r}")
        return structure
    msg = f"unknown source {source!r}"  # pragma: no cover - the model constrains it
    raise FetchError(msg)


def _embedded(molblock: str) -> Structure:
    """A 2D molfile as a 3D structure, through the same ETKDG path a SMILES import uses."""
    from rdkit import Chem  # noqa: PLC0415 (heavy import, only this branch needs it)

    from atomscope.io.rdkit_io import from_smiles  # noqa: PLC0415

    mol = Chem.MolFromMolBlock(molblock, removeHs=False, sanitize=True)
    if mol is None:
        msg = "the database answered with something that is not a molfile"
        raise FetchError(msg)
    return from_smiles(Chem.MolToSmiles(mol))
