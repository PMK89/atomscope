"""Evaluation of contracted Gaussian basis functions on a grid.

A Cartesian primitive with exponent a and powers (i, j, k), l = i+j+k, centred at R is

    chi(r) = N(a, i, j, k) * x^i y^j z^k * exp(-a |r-R|^2)
    N = (2a/pi)^(3/4) * (4a)^(l/2) / sqrt((2i-1)!! (2j-1)!! (2k-1)!!)

which is the normalization convention Gaussian, Molden and most quantum-chemistry programs
assume for the contraction coefficients they publish (Helgaker, Jorgensen, Olsen, *Molecular
Electronic-Structure Theory*, Ch. 6). The contracted function is additionally normalized so that
its self-overlap is one; for shells with l >= 2 that normalization is defined for the solid
harmonic (pure) component, which is why the Cartesian x^2/y^2/z^2 functions of a 6D shell are
*not* individually normalized. We follow the same convention so that published coefficients can
be used unchanged.

Real solid harmonics for the pure (5D/7F/9G) shells are formed from the Cartesian monomials with
the standard transformation coefficients (Schlegel & Frisch, Int. J. Quantum Chem. 54, 83 (1995)).
"""

from __future__ import annotations

import numpy as np

from atomscope.wavefunction.model import Shell, shell_size

# ---- Cartesian component orders as written by Gaussian / Molden --------------------------------
# (Gaussian fchk and Molden agree for s and p; for d and higher they use these orders.)
CARTESIAN_ORDER: dict[int, list[tuple[int, int, int]]] = {
    0: [(0, 0, 0)],
    1: [(1, 0, 0), (0, 1, 0), (0, 0, 1)],
    2: [(2, 0, 0), (0, 2, 0), (0, 0, 2), (1, 1, 0), (1, 0, 1), (0, 1, 1)],
    3: [
        (3, 0, 0),
        (0, 3, 0),
        (0, 0, 3),
        (1, 2, 0),
        (2, 1, 0),
        (2, 0, 1),
        (1, 0, 2),
        (0, 1, 2),
        (0, 2, 1),
        (1, 1, 1),
    ],
    4: [
        (4, 0, 0),
        (0, 4, 0),
        (0, 0, 4),
        (3, 1, 0),
        (3, 0, 1),
        (1, 3, 0),
        (0, 3, 1),
        (1, 0, 3),
        (0, 1, 3),
        (2, 2, 0),
        (2, 0, 2),
        (0, 2, 2),
        (2, 1, 1),
        (1, 2, 1),
        (1, 1, 2),
    ],
}

# Real solid harmonics as linear combinations of the Cartesian monomials above.
# Each entry maps m -> {(i, j, k): coefficient}; ordering of m follows the quantum-chemistry
# convention 0, +1, -1, +2, -2, ... used by Gaussian and Molden.
_S3 = np.sqrt(3.0)
_S5 = np.sqrt(5.0)
_S15 = np.sqrt(15.0)
_S6 = np.sqrt(6.0)
_S10 = np.sqrt(10.0)

SOLID_HARMONICS: dict[int, list[dict[tuple[int, int, int], float]]] = {
    0: [{(0, 0, 0): 1.0}],
    1: [{(1, 0, 0): 1.0}, {(0, 1, 0): 1.0}, {(0, 0, 1): 1.0}],
    2: [
        # d0 = (2z^2 - x^2 - y^2)/2
        {(0, 0, 2): 1.0, (2, 0, 0): -0.5, (0, 2, 0): -0.5},
        {(1, 0, 1): _S3},  # d+1 = sqrt(3) xz
        {(0, 1, 1): _S3},  # d-1 = sqrt(3) yz
        {(2, 0, 0): _S3 / 2.0, (0, 2, 0): -_S3 / 2.0},  # d+2
        {(1, 1, 0): _S3},  # d-2
    ],
    3: [
        # f0 = z(5z^2 - 3r^2)/2 -> z^3 - 3/2 (x^2 z + y^2 z) ... in monomials:
        {(0, 0, 3): 1.0, (2, 0, 1): -1.5, (0, 2, 1): -1.5},
        {(1, 0, 2): _S6, (3, 0, 0): -_S6 / 4.0, (1, 2, 0): -_S6 / 4.0},
        {(0, 1, 2): _S6, (2, 1, 0): -_S6 / 4.0, (0, 3, 0): -_S6 / 4.0},
        {(2, 0, 1): _S15 / 2.0, (0, 2, 1): -_S15 / 2.0},
        {(1, 1, 1): _S15},
        {(3, 0, 0): _S10 / 4.0, (1, 2, 0): -3.0 * _S10 / 4.0},
        {(2, 1, 0): 3.0 * _S10 / 4.0, (0, 3, 0): -_S10 / 4.0},
    ],
}


def double_factorial_odd(n: int) -> float:
    """(2n-1)!! with (−1)!! = 1."""
    out = 1.0
    k = 2 * n - 1
    while k > 1:
        out *= k
        k -= 2
    return out


def primitive_norm(exponent: float, powers: tuple[int, int, int]) -> float:
    """Normalization of a Cartesian Gaussian primitive."""
    i, j, k = powers
    total = i + j + k
    numerator = (2.0 * exponent / np.pi) ** 0.75 * (4.0 * exponent) ** (total / 2.0)
    denominator = np.sqrt(
        double_factorial_odd(i) * double_factorial_odd(j) * double_factorial_odd(k)
    )
    return float(numerator / denominator)


def contraction_norm(shell: Shell) -> float:
    """Normalize the contracted shell using its l0-component self-overlap.

    Programs publish coefficients for normalized primitives, but the contracted function is only
    normalized when the primitives are not orthogonal; the residual factor is computed here from
    the analytic overlap of two Cartesian Gaussians with powers (l,0,0).
    """
    l = shell.angular_momentum  # noqa: E741 - conventional symbol
    a = shell.exponents[:, None]
    b = shell.exponents[None, :]
    ca = shell.coefficients[:, None]
    cb = shell.coefficients[None, :]
    powers = (l, 0, 0)
    na = np.array([primitive_norm(float(e), powers) for e in shell.exponents])
    overlap = (
        (na[:, None] * na[None, :])
        * ca
        * cb
        * (np.pi / (a + b)) ** 1.5
        * double_factorial_odd(l)
        / (2.0 * (a + b)) ** l
    )
    total = float(overlap.sum())
    return 1.0 / np.sqrt(total) if total > 0 else 1.0


def shell_values(shell: Shell, centre: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Values of every function of ``shell`` at ``points`` (shape (n_points, 3), Bohr).

    Returns an array of shape (shell.size, n_points).
    """
    delta = points - centre
    r2 = np.einsum("ij,ij->i", delta, delta)
    x, y, z = delta[:, 0], delta[:, 1], delta[:, 2]
    l = shell.angular_momentum  # noqa: E741
    scale = contraction_norm(shell)

    # radial part per Cartesian component (the primitive normalization depends on the powers)
    cart = CARTESIAN_ORDER[l]
    monomials = np.empty((len(cart), points.shape[0]))
    for idx, (i, j, k) in enumerate(cart):
        monomials[idx] = (x**i) * (y**j) * (z**k)

    # Cartesian shells: every component carries its own normalization (Gaussian's 6D/10F
    # convention). Pure shells: all components share the (l,0,0) normalization, which is what
    # makes the solid-harmonic combinations below orthonormal.
    radial = np.zeros((len(cart), points.shape[0]))
    for exponent, coefficient in zip(shell.exponents, shell.coefficients, strict=True):
        envelope = np.exp(-exponent * r2)
        if shell.pure:
            common = coefficient * primitive_norm(float(exponent), (l, 0, 0)) * envelope
            radial += common
        else:
            for idx, powers in enumerate(cart):
                radial[idx] += coefficient * primitive_norm(float(exponent), powers) * envelope

    cartesian_values = monomials * radial * scale
    if not shell.pure:
        return cartesian_values

    index = {powers: i for i, powers in enumerate(cart)}
    out = np.zeros((shell_size(l, True), points.shape[0]))
    for m, terms in enumerate(SOLID_HARMONICS[l]):
        for powers, coefficient in terms.items():
            out[m] += coefficient * cartesian_values[index[powers]]
    return out


def primitive_convention(shells: list[Shell]) -> str | None:
    """Which convention the single-primitive s and p shells are written in, if they agree.

    An uncontracted shell has nothing to contract, so a program that publishes coefficients for
    normalized primitives writes exactly 1; one that publishes them for unnormalized primitives
    writes the primitive's own normalization N(alpha). Shells with l >= 2 are left out: ORCA
    folds a further constant into them (sqrt(3) for d, so that the xy component comes out
    normalized), which is a per-shell factor the self-overlap absorbs but this test would not.

    Returns "normalized", "unnormalized", or None when the shells disagree, say neither, or
    there are no uncontracted s or p shells to ask.
    """
    votes: set[str] = set()
    for shell in shells:
        if len(shell.exponents) != 1 or shell.angular_momentum > 1:
            continue
        c = abs(float(shell.coefficients[0]))
        n = primitive_norm(float(shell.exponents[0]), (shell.angular_momentum, 0, 0))
        if abs(c - 1.0) < 0.01:
            votes.add("normalized")
        elif abs(c / n - 1.0) < 0.01:
            votes.add("unnormalized")
        else:
            return None
    return votes.pop() if len(votes) == 1 else None


def with_normalized_primitives(shells: list[Shell]) -> tuple[list[Shell], str]:
    """Put the contraction coefficients into the convention the evaluator expects.

    Molden's specification says the coefficients are for *normalized* primitives, and the
    conforming files here -- from Molden, Gaussian and GAMESS -- follow it: every contracted
    shell then has a self-overlap of one, to the last digit, and a single-primitive shell is
    written with a coefficient of exactly 1.

    ORCA's `orca_2mkl` does not: it writes the coefficients for unnormalized primitives, so the
    primitive's own normalization is folded into them (a single-primitive s shell comes out as
    0.36, a d shell as 1.93 = sqrt(3) N). Read as the specification says, the *shapes* of the
    contracted functions are wrong -- each is still normalized afterwards, so nothing looks amiss
    until the orbitals are integrated and come back with norms around 0.82 instead of 1.

    The convention is measured rather than guessed from which program wrote the file, and two
    independent measurements have to agree before anything is divided out:

    * every shell's self-overlap is 1.000 under the specification (0.11 to 7.35 for the ORCA
      file here), and
    * an uncontracted s or p shell is written as 1 under the specification, as N(alpha) by ORCA.

    The first test alone would also fire on a conforming file whose *contractions* are not
    normalized -- coefficients copied out of a basis-set library, which Molden itself renormalizes
    on read. No such file is in the corpus here, but the second test tells that case apart, and
    when the two disagree the coefficients are left exactly as written.

    Returns the shells and a short note naming the convention they were read in.
    """
    factors = np.array([contraction_norm(shell) for shell in shells])
    if float(np.abs(factors - 1.0).max()) < 0.01:
        return shells, "normalized primitives"
    convention = primitive_convention(shells)
    if convention == "normalized":
        return shells, "normalized primitives, unnormalized contractions"
    note = "unnormalized primitives"
    if convention is None:
        note += " (self-overlaps only)"
    fixed: list[Shell] = []
    for shell in shells:
        powers = (shell.angular_momentum, 0, 0)
        norms = np.array([primitive_norm(float(e), powers) for e in shell.exponents])
        fixed.append(
            Shell(
                shell.atom_index,
                shell.angular_momentum,
                shell.pure,
                shell.exponents,
                shell.coefficients / norms,
            )
        )
    return fixed, note


def basis_values(shells: list[Shell], centres: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Evaluate the whole basis: array of shape (n_basis, n_points)."""
    blocks = [shell_values(s, centres[s.atom_index], points) for s in shells]
    return np.vstack(blocks) if blocks else np.zeros((0, points.shape[0]))
