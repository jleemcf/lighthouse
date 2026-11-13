"""Resolve explicit local profile settings without changing installed values."""
import json
from pathlib import Path

DEFAULTS = {"__OWNER_ID__": "owner", "__OWNER_NAME__": "the captain",
            "__TIME_ZONE_LABEL__": "UTC", "__TIME_ZONE__": "UTC", "__WINDOWS_TIME_ZONE__": "UTC"}

def select_source(source, repository):
    config = json.loads(Path(source).read_text(encoding="utf-8"))
    if repository and not config.get("profile"):
        machine = str(config.get("__MACHINE_NAME__", "")).lower()
        if machine and Path(machine).name == machine:
            candidate = Path(repository) / "private" / "machines" / machine / "operator-config.json"
            if candidate.is_file():
                return candidate
    return Path(source)

def configure(config, source):
    config = dict(config)
    selected = config.get("profile")
    if selected:
        profile_path = (Path(source).parent / selected).resolve()
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        config = dict(profile.get("kit", {}), **config)
        if "ownerAliases" in profile.get("server", {}):
            config.setdefault("ownerAliases", profile["server"]["ownerAliases"])
        config["documentContent"] = {name: str((profile_path.parent / value).resolve())
                                     for name, value in config.get("documentContent", {}).items()}
        config["profile"] = str(profile_path)
    for key, value in DEFAULTS.items():
        config.setdefault(key, value)
    config["ownerId"] = config["__OWNER_ID__"]
    config["ownerName"] = config["__OWNER_NAME__"]
    config["timeZone"] = config["__TIME_ZONE__"]
    config["timeZoneLabel"] = config["__TIME_ZONE_LABEL__"]
    if config.get("roleContent"):
        config["roleContent"] = [str((Path(source).parent / item).resolve())
                                 for item in config["roleContent"]]
    return config
