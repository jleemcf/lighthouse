#!/usr/bin/env python3
"""Verify the installed scripts without reading or reporting operator secrets."""
import argparse
import hashlib
import json
import os
import sys


def verify(home, manifest_path, side):
    with open(manifest_path, encoding="utf-8") as source:
        manifest = json.load(source)
    if manifest.get("schema") != 1 or not manifest.get("files"):
        raise ValueError("missing installation manifest")
    for relative, expected in manifest["files"].items():
        if side == "wsl" and not relative.startswith("wsl/"):
            continue
        name = relative[4:] if side == "wsl" else relative
        target = os.path.join(home, name)
        if side == "windows" and os.path.exists(target + ".new"):
            raise ValueError("activation pending")
        with open(target, "rb") as source:
            actual = hashlib.sha256(source.read()).hexdigest()
        if actual != expected:
            raise ValueError("installed scripts do not match the target manifest")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("home")
    parser.add_argument("manifest")
    parser.add_argument("--side", choices=("windows", "wsl"), default="windows")
    parser.add_argument("--describe", action="store_true")
    args = parser.parse_args()
    try:
        verify(args.home, args.manifest, args.side)
        if args.describe:
            with open(args.manifest, encoding="utf-8") as source:
                manifest = json.load(source)
            print(json.dumps({"release": manifest.get("release")}))
    except (OSError, ValueError, TypeError, KeyError):
        sys.exit("Kit verification failed: missing, pending or mismatched scripts; rerun the update.")


if __name__ == "__main__":
    main()
