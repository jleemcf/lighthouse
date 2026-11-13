#!/usr/bin/env python3
"""Version-one handoff: snapshot the fetched kit, then run its newly rendered updater."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

PROTOCOL = 1
FLOOR = "b4942b98fa438c4a2b9bfd99801532d30fa35a0d"
REPO = Path(__file__).resolve().parents[2]


class BootstrapFailure(ValueError):
    pass


def git(repo, *args):
    phase = "repository refresh" if args[0] == "pull" else "supported-version history"
    try:
        result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8")
    except OSError:
        raise BootstrapFailure(phase + " unavailable; check Git and complete repository history") from None
    if result.returncode:
        raise BootstrapFailure(phase + " failed; check Git and complete repository history")
    return result.stdout.strip()


def supported(home, repo):
    for name in ("KIT-MANIFEST.json", "KIT-BOOTSTRAP.json"):
        try:
            if json.loads((home / name).read_text(encoding="utf-8")).get("bootstrap") == PROTOCOL:
                return
        except (OSError, ValueError):
            pass
    config = json.loads((home / "config.json").read_text(encoding="utf-8"))
    names = ("shift.sh", "lighthouse-mcp.cjs", "toolcalls-spec.json")
    active = [(home / name).read_text(encoding="utf-8").strip() for name in names]
    paths = ["lighthouse/operator-kit/scripts/" + name for name in names]
    revisions = git(repo, "rev-list", "--ancestry-path", FLOOR + "..HEAD", "--", *paths).splitlines()
    for revision in (*revisions, FLOOR):
        templates = []
        for name in names:
            template = git(repo, "show", revision + ":lighthouse/operator-kit/scripts/" + name)
            for key, value in config.items():
                template = template.replace(key, str(value))
            templates.append(template.strip())
        if templates == active:
            return
    raise BootstrapFailure("unsupported kit: requires b4942b9 or later; use the one-time install or fresh install")


def run(home, bash):
    git(REPO, "pull", "--ff-only")
    supported(home, REPO)
    revision = git(REPO, "rev-parse", "HEAD")
    with tempfile.TemporaryDirectory(prefix="lighthouse-updater-v1-", ignore_cleanup_errors=True) as temporary:
        snapshot = Path(temporary) / "source" / "lighthouse" / "operator-kit"
        try:
            shutil.copytree(Path(__file__).parent, snapshot, ignore=shutil.ignore_patterns("__pycache__"))
        except OSError:
            raise BootstrapFailure("snapshot staging failed; check scratch space and source access") from None
        protocol = json.loads((snapshot / "update-protocol.json").read_text(encoding="utf-8"))
        if protocol.get("bootstrap") != PROTOCOL:
            raise BootstrapFailure("updater protocol changed; use the documented one-time migration")
        config = json.loads((home / "config.json").read_text(encoding="utf-8"))
        machine = str(config.get("__MACHINE_NAME__", "")).lower()
        candidate = REPO / "private" / "machines" / machine / "operator-config.json"
        stage = Path(temporary) / "driver"
        command = [sys.executable, str(snapshot / "install.py"), "--config",
                   str(candidate if candidate.is_file() else home / "config.json"),
                   "--keep-from", str(home / "config.json"), "--out", str(stage),
                   "--repository", str(REPO), "--release", revision]
        result = subprocess.run(command, capture_output=True)
        if result.returncode:
            raise BootstrapFailure("updater staging failed; check required configuration and source files")
        environment = dict(os.environ, SHIFT_HOME=home.as_posix(), KIT_UPDATE_DRIVER=str(PROTOCOL),
                           KIT_UPDATE_SOURCE=snapshot.parents[1].as_posix(), KIT_UPDATE_RELEASE=revision,
                           KIT_UPDATE_CONFIG=(stage / "config.json").as_posix(),
                           KIT_UPDATE_REPOSITORY=REPO.as_posix())
        environment.pop("SHIFT_UPDATE_TEMP", None)
        receipt = home / "KIT-BOOTSTRAP.json"
        receipt.with_suffix(".tmp").write_text(json.dumps({"bootstrap": PROTOCOL}), encoding="utf-8")
        os.replace(receipt.with_suffix(".tmp"), receipt)
        print("Updater bootstrap v1: running the fetched release " + revision[:12], flush=True)
        return subprocess.run([bash, (stage / "shift.sh").as_posix(), "update"], env=environment).returncode


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--bash", required=True, help="Windows Git Bash executable, not WSL bash")
    args = parser.parse_args()
    try:
        return run(args.home.resolve(), args.bash)
    except BootstrapFailure as error:
        print("Update incomplete: bootstrap " + str(error) + ". Windows and WSL unchanged.", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError):
        print("Update incomplete: bootstrap input read failed; check installed config and repository protocol. "
              "Windows and WSL unchanged.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
