#!/usr/bin/env python3
"""Regenerate site/data.json from the 2026/ source files.

Run this whenever 2026/worldcup.json or 2026/worldcup.groups.json changes
(e.g. after pulling fresh data from openfootball/worldcup.json upstream).

    python3 site/build-data.py

Writes site/data.json in place.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_MATCHES = ROOT / "2026" / "worldcup.json"
SRC_GROUPS = ROOT / "2026" / "worldcup.groups.json"
OUT = ROOT / "site" / "data.json"

# ISO 3166-1 alpha-2 codes (with a few flag-icons specials for sub-nations).
FLAG_MAP = {
    "Mexico": "mx", "South Africa": "za", "South Korea": "kr", "Czech Republic": "cz",
    "Canada": "ca", "Bosnia & Herzegovina": "ba", "Qatar": "qa", "Switzerland": "ch",
    "Brazil": "br", "Morocco": "ma", "Haiti": "ht", "Scotland": "gb-sct",
    "USA": "us", "Paraguay": "py", "Australia": "au", "Turkey": "tr",
    "Germany": "de", "Curaçao": "cw", "Ivory Coast": "ci", "Ecuador": "ec",
    "Netherlands": "nl", "Japan": "jp", "Sweden": "se", "Tunisia": "tn",
    "Belgium": "be", "Egypt": "eg", "Iran": "ir", "New Zealand": "nz",
    "Spain": "es", "Cape Verde": "cv", "Saudi Arabia": "sa", "Uruguay": "uy",
    "France": "fr", "Senegal": "sn", "Iraq": "iq", "Norway": "no",
    "Argentina": "ar", "Algeria": "dz", "Austria": "at", "Jordan": "jo",
    "Portugal": "pt", "DR Congo": "cd", "Uzbekistan": "uz", "Colombia": "co",
    "England": "gb-eng", "Croatia": "hr", "Ghana": "gh", "Panama": "pa",
}


def main() -> int:
    matches_in = json.loads(SRC_MATCHES.read_text())["matches"]
    groups = json.loads(SRC_GROUPS.read_text())["groups"]

    # Group matches: stable id G-<letter>-<index 1..6>
    group_buckets: dict[str, list] = {}
    for m in matches_in:
        if m.get("group"):
            group_buckets.setdefault(m["group"], []).append(m)

    group_out = {}
    for gname, lst in group_buckets.items():
        lst.sort(key=lambda m: (m["date"], m["time"]))
        letter = gname.split()[-1]
        group_out[gname] = [
            {
                "id": f"G-{letter}-{i}",
                "date": m["date"],
                "time": m["time"],
                "team1": m["team1"],
                "team2": m["team2"],
                "ground": m["ground"],
                "matchday": m["round"],
            }
            for i, m in enumerate(lst, 1)
        ]

    ko_in = [m for m in matches_in if not m.get("group")]
    ko_in.sort(key=lambda m: m.get("num", 0))
    ko_out = []
    for m in ko_in:
        entry = {
            "id": f"M{m['num']}" if m.get("num") else m["round"].replace(" ", "_"),
            "num": m.get("num"),
            "round": m["round"],
            "date": m["date"],
            "time": m["time"],
            "team1": m["team1"],
            "team2": m["team2"],
            "ground": m["ground"],
        }
        if not entry["num"]:
            if m["round"] == "Match for third place":
                entry["id"] = "M-3rd"
            elif m["round"] == "Final":
                entry["id"] = "M-Final"
        ko_out.append(entry)

    out = {
        "groups": groups,
        "group_matches": group_out,
        "ko_matches": ko_out,
        "flag_map": FLAG_MAP,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"wrote {OUT.relative_to(ROOT)} · {sum(len(v) for v in group_out.values())} group + {len(ko_out)} KO matches")
    return 0


if __name__ == "__main__":
    sys.exit(main())
