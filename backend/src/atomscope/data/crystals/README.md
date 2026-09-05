# Crystal library

CIF files copied unchanged from the Avogadro 1 source tree
(`avogadro-master/crystals/`, https://github.com/cryos/avogadro), which distributes them
under the GNU General Public License version 2 or later (see `LICENSE-avogadro.txt`).
Atomscope is GPL-3.0-or-later, which is compatible with GPL-2.0-or-later.

Most entries originate from the Crystallography Open Database (COD) and the American
Mineralogist Crystal Structure Database; their headers state that the data were placed in the
public domain by the contributors and ask for attribution of the original journal article.

Layout: one directory per category (`elements/`, `halides/`, `oxides/`, ...), one CIF per
entry. `atomscope.crystal.library` indexes this tree at runtime; a few files are not parseable
by ASE and are listed as `readable: false`.
