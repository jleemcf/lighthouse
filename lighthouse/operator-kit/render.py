"""Render data in the kit's language contexts and preflight every generated executable before installation."""
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile

TOKEN = re.compile(r"__[A-Z_]+__")
QUOTED = re.compile(r"'(?:\\.|[^'\\])*'" + r'|"(?:\\.|[^"\\])*"')


def string_content(value, quote):
    content = json.dumps(value, ensure_ascii=False)[1:-1]
    content = content.replace("\u2028", r"\u2028").replace("\u2029", r"\u2029")
    if quote == "'":
        content = content.replace("'", r"\'")
    return content


def shell_double(value):
    return re.sub(r'([\\"$' + chr(96) + r'])', r'\\\1', value)


def shell_single(value):
    return value.replace("'", "'\"'\"'")


def render(name, content, config):
    def fill(text, encode=lambda value: value):
        return TOKEN.sub(lambda match: encode(str(config[match[0]])), text)

    suffix = Path(name).suffix
    lines = []
    for line in content.splitlines(keepends=True):
        if not TOKEN.search(line):
            lines.append(line)
            continue
        if line.lstrip().startswith(("#", "//", "/*", "*")):
            lines.append(fill(line, lambda value: value.replace("\r", r"\r").replace("\n", r"\n")))
            continue
        if suffix == ".sh":
            if name == "lh-probe.sh" and 'a.get("cwd") == "__FM_HOME__"' in line:
                lines.append(fill(line, lambda value: shell_single(string_content(value, '"'))))
                continue
            fragments = {
                "lh-probe.sh": [
                    "__FM_HOME__", "/home/__WSL_USER__/.claude/projects/__FM_CONV_DIR__",
                    "/home/__WSL_USER__/.local/bin/herdr", "__OPERATOR_WSL_DIR__/lh-pending.py",
                ],
                "lighthouse-sweep.sh": ["__WSL_DISTRO__"],
                "route.sh": ["__BOARD_SERVER__", "__BOARD_ID__"],
                "watch.sh": ["__BOARD_SERVER__"],
            }
            if name == "lighthouse-sweep.sh":
                for script in ("lh-probe.sh", "record-check.sh"):
                    fragment = "'bash __OPERATOR_WSL_DIR__/" + script + "'"
                    command = "bash " + shlex.quote(fill("__OPERATOR_WSL_DIR__/" + script))
                    line = line.replace(fragment, "'" + shell_single(command) + "'")
            for fragment in fragments.get(name, []):
                if fragment in line:
                    line = line.replace(fragment, shlex.quote(fill(fragment)))

        def quoted(match):
            text = match[0]
            quote = text[0]
            if suffix == ".ps1":
                if quote != "'" and TOKEN.search(text):
                    raise ValueError(name + ": unsupported PowerShell template context")
                encode = lambda value: value.replace("'", "''")
            elif suffix == ".sh":
                if quote == "'":
                    encode = shell_single
                else:
                    encode = shell_double
                    if "$" + "{SW_THREAD:-" in text:
                        encode = lambda value: shell_double(value).replace("}", r"\}")
            else:
                encode = lambda value: string_content(value, quote)
            return fill(text, encode)

        line = QUOTED.sub(quoted, line)
        if TOKEN.search(line) and suffix in (".js", ".cjs") and chr(96) in line:
            line = fill(line, lambda value: string_content(value, '"')
                        .replace(chr(96), "\\" + chr(96)).replace("$" + "{", "\\$" + "{"))
        if TOKEN.search(line):
            if suffix in (".js", ".cjs", ".ps1", ".py", ".sh", ".json"):
                raise ValueError(name + ": unsupported template context")
            line = fill(line)
        lines.append(line)
    return "".join(lines)


def validate(rendered):
    bash = shutil.which("bash")
    if os.name == "nt":
        git = shutil.which("git")
        if git:
            candidate = Path(git).parent.parent / "bin" / "bash.exe"
            if candidate.is_file():
                bash = str(candidate)
    node = shutil.which("node")
    powershell = shutil.which("pwsh") or shutil.which("powershell")
    with tempfile.TemporaryDirectory(prefix="lh-kit-validation-") as temporary:
        for name, content in rendered.items():
            file = Path(temporary) / name
            file.write_text(content, encoding="utf-8", newline="\n")
            suffix = file.suffix
            command = None
            try:
                if suffix in (".js", ".cjs"):
                    command = [node, "--check", str(file)]
                elif suffix == ".sh":
                    command = [bash, "-n", str(file)]
                elif suffix == ".ps1" and powershell:
                    check = ("$parseErrors = $null; "
                             "[void][System.Management.Automation.Language.Parser]::ParseFile("
                             "$env:LH_SCRIPT_CHECK, [ref]$null, [ref]$parseErrors); "
                             "if ($parseErrors.Count) { exit 1 }")
                    command = [powershell, "-NoProfile", "-NonInteractive", "-Command", check]
                elif suffix == ".json":
                    json.loads(content)
                elif suffix == ".py":
                    compile(content, name, "exec")
                if command:
                    if not command[0]:
                        raise ValueError("required syntax checker is unavailable")
                    environment = dict(os.environ, LH_SCRIPT_CHECK=str(file))
                    result = subprocess.run(command, capture_output=True, env=environment, timeout=30)
                    if result.returncode:
                        raise ValueError("syntax check rejected generated content")
            except (ValueError, SyntaxError, OSError, subprocess.TimeoutExpired) as error:
                raise ValueError("validation failed for " + name + "; no scripts were installed") from error
