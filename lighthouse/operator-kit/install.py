#!/usr/bin/env python3
"""Stamp one machine's config into the operator kit and write the runnable copies into that machine's operator home.

Usage:  python install.py --config <config.json> --out <operator home>

The kit's scripts carry __PLACEHOLDERS__ (see config.example.json for every key). This installer replaces each with
the config value, refuses to write if any placeholder is left unfilled, and never touches the kit itself. Run it
again after changing the config; it overwrites only the scripts it owns. Nothing here starts a process.
"""
import argparse, hashlib, json, os, re, shlex, shutil, subprocess, sys
from render import render, validate
from profile import DEFAULTS, configure, select_source

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "scripts")
# these read firstmate's home, so they run inside WSL; the rest run on Windows
WSL_SIDE = {"lh-probe.sh", "lh-pending.py", "record-check.py", "record-check.sh", "fm-send.sh"}
MCP_DEPS = ("shift-session.cjs", "session-identity.cjs", "activation-client.cjs", "handoff.cjs", "dispatch-client.cjs",
            "dispatch-storage.cjs", "dispatch-transfer.cjs", "mcp-setup.cjs", "target-binding.cjs",
            "helper-cursors.cjs", "helper-generation.cjs")

def warn_windows_node():
    if os.name != "nt": return
    executable = shutil.which("node")
    if not executable: return
    try:
        result = subprocess.run([executable, "--version"], capture_output=True, text=True,
                                errors="replace", timeout=10)
        version = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", result.stdout.strip())
        if result.returncode == 0 and version and tuple(map(int, version.groups())) < (24, 16, 0):
            print("WARNING: Windows Node.js " + version[0] + " is below the supported minimum 24.16.0. "
                  "Upgrade Node separately; installation will continue without changing your runtime.", file=sys.stderr)
    except (OSError, subprocess.TimeoutExpired):
        pass

def write_json(path, value):
    with open(path + ".tmp", "w", encoding="utf-8", newline="\n") as target:
        json.dump(value, target, indent=2)
        target.write("\n")
    os.replace(path + ".tmp", path)

def tool_version(rendered):
    mcp = re.sub(r"const KIT_SOURCE = '[a-f0-9]{64}'", "const KIT_SOURCE = 'kit-mcp-source-v1'",
                 rendered["lighthouse-mcp.cjs"])
    helper = re.sub(r"const HELPER_SOURCE = '[a-f0-9]{64}'", "const HELPER_SOURCE = 'kit-helper-source-v1'",
                    rendered["kit-version.cjs"])
    hashes = [hashlib.sha256(value.encode("utf-8")).hexdigest()
              for value in (mcp + "".join(rendered[name] for name in MCP_DEPS),
                            rendered["toolcalls-spec.json"], helper)]
    return hashlib.sha256("".join(hashes).encode("utf-8")).hexdigest()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", required=True, help="the operator home on Windows (created if missing)")
    ap.add_argument("--repository", help="original repository when installing a staged snapshot")
    ap.add_argument("--release", help="repository revision of a staged snapshot")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                    help="fill or override a config value at install time, e.g. --set __BOARD_SERVER__=http://... "
                         "(the board's address on the tailnet is typed here and never committed)")
    ap.add_argument("--keep-from", metavar="CONFIG.JSON",
                    help="an earlier installed config: all filled values are retained while new keys arrive "
                         "from the selected machine/profile configuration")
    a = ap.parse_args()
    source = select_source(a.config, a.repository if a.keep_from else None)
    cfg = json.loads(source.read_text(encoding="utf-8"))
    if a.keep_from and os.path.exists(a.keep_from):
        kept = json.load(open(a.keep_from, encoding="utf-8"))
        for k, v in kept.items():
            if k in ("profile", "roleContent", "documentContent"): continue
            if cfg.get("profile") and not kept.get("profile") and DEFAULTS.get(k) == v: continue
            if v != k: cfg[k] = v
    for kv in a.set:
        if "=" not in kv: sys.exit("--set wants KEY=VALUE, got " + kv)
        k, v = kv.split("=", 1); cfg[k] = v
    cfg = configure(cfg, source)
    warn_windows_node()
    # a config may leave a value as its own placeholder, to be given with --set
    unfilled = sorted(k for k, v in cfg.items() if v == k)
    if unfilled:
        sys.exit("give these at install time with --set KEY=VALUE: " + ", ".join(unfilled))
    needed = set()
    names = sorted(n for n in os.listdir(SCRIPTS) if os.path.isfile(os.path.join(SCRIPTS, n)))
    for n in names:
        needed |= set(re.findall(r"__[A-Z_]+__", open(os.path.join(SCRIPTS, n), encoding="utf-8").read()))
    missing = sorted(k for k in needed if k not in cfg)
    if missing:
        sys.exit("config is missing values for: " + ", ".join(missing))
    rendered = {}
    for n in names:
        content = open(os.path.join(SCRIPTS, n), encoding="utf-8").read()
        try:
            content = render(n, content, cfg)
        except ValueError as error:
            sys.exit(str(error) + "; no scripts were installed")
        if re.findall(r"__[A-Z_]+__", content):
            sys.exit("unfilled placeholders remain; no scripts were installed")
        rendered[n] = content
    mcp_version = tool_version(rendered)
    for name, sentinel in (("lighthouse-mcp.cjs", "kit-mcp-source-v1"), ("kit-version.cjs", "kit-helper-source-v1")):
        source = rendered[name] + ("".join(rendered[dependency] for dependency in MCP_DEPS)
                                   if name == "lighthouse-mcp.cjs" else "")
        digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
        rendered[name] = rendered[name].replace("'" + sentinel + "'", "'" + digest + "'", 1)
    repo_root = a.repository or os.path.abspath(os.path.join(HERE, "..", ".."))
    revision = a.release
    if not revision:
        result = subprocess.run(["git", "-C", repo_root, "rev-parse", "HEAD"], capture_output=True, text=True)
        revision = result.stdout.strip() if result.returncode == 0 else "unversioned"
    if not re.fullmatch(r"[a-f0-9]{40}|unversioned", revision):
        sys.exit("invalid repository revision")
    try:
        validate(rendered)
    except ValueError as error:
        sys.exit(str(error))
    os.makedirs(a.out, exist_ok=True)
    os.makedirs(os.path.join(a.out, "wsl"), exist_ok=True)
    prior_mcp = os.path.join(a.out, "lighthouse-mcp.cjs")
    if os.path.exists(prior_mcp):
        try:
            prior = {name: open(os.path.join(a.out, name), encoding="utf-8").read()
                     for name in ("lighthouse-mcp.cjs", "toolcalls-spec.json", "kit-version.cjs", *MCP_DEPS)}
            changed = tool_version(prior) != mcp_version
        except OSError:
            changed = True
        if changed:
            write_json(os.path.join(a.out, "MCP-RECONNECT.json"), {"target": mcp_version})
    written = []; pending = []
    for n in names:   # a pending .new from an earlier update goes in first, if the file is free now
        for sub in ("", "wsl"):
            q = os.path.join(a.out, sub, n)
            if os.path.exists(q + ".new"):
                try: os.replace(q + ".new", q)
                except PermissionError: pass
    for n in names:
        s = rendered[n]
        sub = "wsl" if n in WSL_SIDE else ""
        p = os.path.join(a.out, sub, n)
        # a new file is swapped in, never the old one rewritten in place: shift.sh runs this while bash is still
        # reading shift.sh, and a script overwritten under a running bash ends in "unexpected EOF"
        open(p + ".tmp", "w", encoding="utf-8", newline="\n").write(s)
        # on Windows an open file (a running Monitor, or shift.sh itself) cannot be replaced: it is left as .new
        # for shift.sh to swap in
        try: os.replace(p + ".tmp", p)
        except PermissionError:
            os.replace(p + ".tmp", p + ".new"); pending.append(os.path.join(sub, n) if sub else n)
        written.append(p)
    # the filled config, --set values included, so a re-run from this copy needs nothing typed again
    with open(os.path.join(a.out, "config.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(cfg, f, indent=2); f.write("\n")
    # the test rig's page goes only to the test rig; the watch brief only to a home that watches
    docs = (["OPERATOR-BRIEF.md", "OPERATOR-BRIEF-TOOLS.md", "SETUP.md", "README.md",
             "RELAY-RECOVERY.md", "HANDOFF-RECOVERY.md"]
            + cfg.get("roleContent", [])
            + (["WATCH-BRIEF.md"] if str(cfg.get("__WATCH_BOARDS__", "none")) not in ("none", "") else []))
    for doc in docs:
        src = cfg.get("documentContent", {}).get(doc, os.path.join(HERE, doc))
        if os.path.exists(src):
            destination = os.path.join(a.out, os.path.basename(doc))
            content = open(src, encoding="utf-8").read()
            if os.path.basename(doc) in ("OPERATOR-BRIEF.md", "OPERATOR-BRIEF-TOOLS.md", "WATCH-BRIEF.md"):
                for key in ("__OWNER_NAME__", "__TIME_ZONE_LABEL__"):
                    content = content.replace(key, str(cfg[key]))
            with open(destination, "w", encoding="utf-8", newline="\n") as output:
                output.write(content)
            written.append(destination)
    # skills the kit carries (the steward's diagram-design): replaced whole on every install, so no one edits them
    # in place
    skills_src, skills_out = os.path.join(HERE, "skills"), os.path.join(a.out, "skills")
    if os.path.isdir(skills_src):
        for name in os.listdir(skills_src):
            dst = os.path.join(skills_out, name)
            if os.path.isdir(dst): shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(os.path.join(skills_src, name), dst); written.append(dst)
    with open(os.path.join(a.out, "REPO.txt"), "w", encoding="utf-8") as f:
        f.write("This operator home was installed from the Lighthouse repository at:\n" + repo_root + "\n"
                "Read OPERATOR-BRIEF.md here first. "
                "SETUP.md is the machine-side page for Owner and the chief developer.\n")
    written.append(os.path.join(a.out, "REPO.txt"))
    content_version = hashlib.sha256("".join(rendered.values()).encode("utf-8")).hexdigest()[:12]
    manifest = {"schema": 1, "bootstrap": 1, "release": revision + "+" + content_version,
                "mcpVersion": mcp_version, "files": {
        ("wsl/" if name in WSL_SIDE else "") + name:
        hashlib.sha256(content.encode("utf-8")).hexdigest() for name, content in rendered.items()
    }}
    manifest_path = os.path.join(a.out, "KIT-MANIFEST.json")
    write_json(manifest_path, manifest)
    if pending:
        print(f"{len(pending)} file(s) are open on this machine and could not be replaced: " + ", ".join(pending)
              + "; each was written as <name>.new and is swapped in by the next `bash shift.sh start` or `update` "
              "once the Monitor holding it is stopped")
    print("installed:"); [print("  " + p) for p in written]
    mounted = os.path.abspath(a.out).replace("\\", "/")
    mounted = re.sub(r"^([a-zA-Z]):/", lambda match: "/mnt/" + match[1].lower() + "/", mounted)
    copy_script = ('set -e; mkdir -p "$2"; cp -r "$1/wsl/." "$2/"; chmod +x "$2"/*.sh; '
                   'python3 "$1/kit-state.py" "$2" "$1/KIT-MANIFEST.json" --side wsl; '
                   'cp "$1/KIT-MANIFEST.json" "$2/KIT-MANIFEST.json"')
    command = ["wsl", "-d", cfg["__WSL_DISTRO__"], "-e", "bash", "-c", copy_script,
               "kit-install", mounted, cfg["__OPERATOR_WSL_DIR__"]]
    print("Finish the fresh install from Windows Git Bash with this command (starts no helpers):")
    print("  MSYS_NO_PATHCONV=1 " + shlex.join(command))
    print("It copies and verifies the WSL scripts before publishing their version receipt; stop if it fails.")

if __name__ == "__main__":
    main()
