"""Copy and verify a consistent lab SQLite snapshot without replacing an existing file."""
from argparse import ArgumentParser
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile

from services.simulation.auction import digest


def copy_database(source: Path, destination: Path) -> int:
    source = source.resolve(strict=True)
    destination = destination.absolute()
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=destination.parent, prefix=".lab-backup-", delete=False) as temp:
        temporary = Path(temp.name)
    try:
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as origin, \
                closing(sqlite3.connect(temporary)) as target:
            origin.backup(target)
            if target.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError("SQLite integrity check failed")
            count = target.execute("SELECT count(*) FROM runs").fetchone()[0]
            target.execute("SELECT id, request, status, result FROM runs LIMIT 0")
            for (encoded,) in target.execute("SELECT result FROM runs WHERE result IS NOT NULL"):
                record = json.loads(encoded)
                if digest(record["result"]) != record["result_hash"]:
                    raise ValueError("Stored run digest failed verification")
        # An existing destination stays intact even if another process creates it during copying.
        os.link(temporary, destination)
        return count
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        count = copy_database(args.source, args.destination)
    except (OSError, ValueError, sqlite3.DatabaseError, KeyError) as error:
        parser.exit(1, f"Backup failed: {type(error).__name__}\n")
    print(f"Verified database copy: {args.destination} ({count} runs)")
