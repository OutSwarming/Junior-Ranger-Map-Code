#!/usr/bin/env python3
"""Build local badge images and a map lookup manifest from JR Rewards exports."""

from __future__ import annotations

import argparse
import csv
import difflib
import hashlib
import io
import json
import math
import os
import re
import shutil
import sys
import urllib.request
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_JR_REWARDS_DIR = Path("/Users/carterswarm/Downloads/JR_Rewards_Badges")
DEFAULT_LIVE_CATALOG_URL = "https://junior-ranger-map-auth.web.app/api/junior-ranger-catalog"
DEFAULT_MANIFEST_PATH = REPO_ROOT / "01-code/app/assets/data/badge-manifest.json"
DEFAULT_BADGE_ASSET_DIR = REPO_ROOT / "01-code/app/assets/badges/jr-rewards"
DEFAULT_REPORT_DIR = REPO_ROOT / "05-tools/reports"

STATE_NAMES = {
    "alabama",
    "alaska",
    "arizona",
    "arkansas",
    "california",
    "colorado",
    "connecticut",
    "delaware",
    "florida",
    "georgia",
    "hawaii",
    "idaho",
    "illinois",
    "indiana",
    "iowa",
    "kansas",
    "kentucky",
    "louisiana",
    "maine",
    "maryland",
    "massachusetts",
    "michigan",
    "minnesota",
    "mississippi",
    "missouri",
    "montana",
    "nebraska",
    "nevada",
    "new hampshire",
    "new jersey",
    "new mexico",
    "new york",
    "north carolina",
    "north dakota",
    "ohio",
    "oklahoma",
    "oregon",
    "pennsylvania",
    "rhode island",
    "south carolina",
    "south dakota",
    "tennessee",
    "texas",
    "utah",
    "vermont",
    "virginia",
    "washington",
    "west virginia",
    "wisconsin",
    "wyoming",
    "district of columbia",
    "washington dc",
    "puerto rico",
    "guam",
    "virgin islands",
    "american samoa",
    "northern mariana islands",
}

AGENCY_ALIASES = {
    "nps": "national park service",
    "national park service": "national park service",
    "national wildlife refuge": "national wildlife refuge",
    "nwr": "national wildlife refuge",
    "u s fish and wildlife service": "national wildlife refuge",
    "us fish and wildlife service": "national wildlife refuge",
    "us fish and wildlife": "national wildlife refuge",
    "usfws": "national wildlife refuge",
    "state": "state parks",
    "state park": "state parks",
    "state parks": "state parks",
    "u s forest service": "us forest service",
    "us forest service": "us forest service",
    "usfs": "us forest service",
    "forest service": "us forest service",
    "us forest service national forest": "us forest service",
    "bureau of land management": "bureau of land management",
    "blm": "bureau of land management",
    "army corps": "army corps",
    "us army corps of engineers": "army corps",
    "u s army corps of engineers": "army corps",
    "usace": "army corps",
}

DESIGNATION_PHRASES = [
    "national historical park",
    "national historic site",
    "national historic trail",
    "national scenic trail",
    "national military park",
    "national battlefield park",
    "national battlefield",
    "national memorial",
    "national monument",
    "national conservation area",
    "national heritage area",
    "national park and preserve",
    "national park",
    "national preserve",
    "national reserve",
    "national recreation area",
    "national seashore",
    "national lakeshore",
    "national river and recreation area",
    "national river",
    "national wild and scenic river",
    "national forest",
    "national grassland",
    "national wildlife refuge",
    "wildlife refuge",
    "state historic park",
    "state historic site",
    "state historical park",
    "state park and historic site",
    "state park",
    "state recreation area",
    "outstanding natural area",
    "natural area",
    "nature center",
    "regional park",
    "historic site",
    "historical park",
    "visitor center",
    "ranger station",
    "memorial",
    "monument",
    "preserve",
    "reserve",
    "recreation area",
    "seashore",
    "lakeshore",
    "battlefield",
    "military park",
    "forest",
    "grassland",
    "park",
]

DESIGNATION_ABBREVIATIONS = [
    "nhs",
    "nhp",
    "nht",
    "nst",
    "nmp",
    "nbp",
    "nb",
    "nmem",
    "nm",
    "np",
    "npr",
    "npres",
    "pres",
    "pr",
    "nr",
    "nra",
    "ns",
    "nl",
    "nwr",
    "nf",
    "ng",
    "nca",
    "nha",
    "ona",
    "nhl",
    "sp",
    "shs",
    "shp",
    "sra",
    "vc",
    "rs",
]

STOP_WORDS = {
    "the",
    "and",
    "of",
    "jr",
    "junior",
    "ranger",
    "badge",
    "badges",
    "patch",
    "plastic",
    "wooden",
    "wood",
    "medal",
    "token",
    "pin",
    "sticker",
    "certificate",
    "program",
    "book",
    "booklet",
    "activity",
    "guide",
    "explorer",
    "passport",
    "picture",
    "pix",
    "photo",
    "logo",
    "banner",
    "page",
    "header",
    "national",
    "park",
    "service",
    "state",
    "edition",
    "ed",
    "comes",
    "with",
    "attached",
    "ribbon",
    "unit",
    "units",
    "site",
}

BAD_SITE_NAMES = {
    "miscellaneous",
    "unknown",
    "_page header",
    "page header",
    "agency header",
    "header",
    "banner",
    "logo",
    "pix",
    "picture",
    "pictures",
    "photo",
    "photos",
    "sticker",
    "stickers",
}

FUZZY_TOKEN_STOP_WORDS = STOP_WORDS | {
    "agency",
    "agent",
    "arch",
    "army",
    "bad",
    "badge1",
    "badge2",
    "br",
    "bryan",
    "button",
    "caribbeanisland",
    "casey",
    "center",
    "complex",
    "corps",
    "department",
    "discovery",
    "duck",
    "ed",
    "engineer",
    "engineers",
    "fws",
    "gen",
    "generic",
    "gov",
    "green",
    "has",
    "hat",
    "jr",
    "jun",
    "mv2",
    "office",
    "officer",
    "outdoor",
    "pat",
    "pl",
    "police",
    "plastic",
    "project",
    "ref",
    "refuge",
    "research",
    "programs",
    "sam",
    "silver",
    "sp",
    "shp",
    "sra",
    "stic",
    "stick",
    "stamps",
    "swag",
    "training",
    "us",
    "visitor",
    "visitors",
    "vc",
    "wildlife",
    "wooden",
}
FUZZY_TOKEN_ALIASES = {
    "chincotteague": "chincoteague",
    "louisanna": "louisiana",
    "lou": "louisiana",
    "neil": "neal",
    "ohn": "john",
    "roman": "romain",
    "rvier": "river",
    "se": "southeast",
}
FUZZY_SINGLE_MATCH_ALLOWED_EXTRAS = {
    "ed",
    "jn",
    "mt",
    "outdoor",
    "pat",
    "st",
}
NWR_MANUAL_PIN_OVERRIDES = [
    (("wertheim",), "jr_new_york_wertheim_nwr"),
    (("patuxent",), "jr__patuxent_research_refuge"),
    (("caddo", "lake"), "jr_texas_caddo_lake_nwr"),
    (("desoto",), "jr_iowa_desoto_nwr"),
    (("neal", "smith"), "jr_iowa_neal_smith_nwr"),
    (("ash", "meadows"), "jr_nevada_southern_nevada_s_nwr_ash_meadows_nwr"),
    (("moapa",), "jr_nevada_southern_nevada_s_nwr_moapa_valley_nwr"),
    (("bitter", "lake"), "jr_new_mexico_bitter_lake_nwr"),
    (("bos",), "jr_new_mexico_bosque_del_apache_nwr"),
    (("valle", "oro"), "jr_new_mexico_valle_de_oro_nwr"),
    (("valley", "oro"), "jr_new_mexico_valle_de_oro_nwr"),
    (("cape", "romain"), "jr_south_carolina_cape_romain_nwr"),
    (("willapa",), "jr_washington_willapa_national_wildlife_refuge_headquarters"),
    (("bear", "river"), "jr_utah_bear_river_migratory_bird_refuge"),
    (("chincoteague",), "jr_virginia_chincoteague_nwr"),
    (("southeast", "louisiana"), "jr_louisiana_southeast_louisiana_nwr"),
    (("trempealeau",), "jr_wisconsin_whittlesey_creel_nwr"),
    (("nec",), "jr_wisconsin_necedah_nwr"),
]
BLOCKED_SOURCE_IMAGE_HASHES = {
    "12913e7f86": "Visitor-center sign/header image, not a badge",
}
SOURCE_IMAGE_TITLE_OVERRIDES = {
    "450db6ba39": "Whittlesey Creek National Wildlife Refuge",
}
GENERIC_IMAGE_TITLES = {
    "agency header",
    "generic",
    "green badge",
    "page header",
    "silver badge",
    "silver badge with hat",
    "wooden hat",
}
OFFSITE_FILTER_MIN_IMAGES = 4
OFFSITE_FILTER_MIN_MATCHES = 2

PATH_RE = re.compile(
    r"/Users/carterswarm/Downloads/JR_Rewards_Badges/.*?\s-\s[0-9a-f]{10}\.(?:jpg|jpeg|png|webp)",
    re.IGNORECASE,
)
HASH_RE = re.compile(r"-\s*([0-9a-f]{10})\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def clean(value: object) -> str:
    return str(value or "").strip()


def normalize_text(value: object) -> str:
    text = clean(value).lower().replace("&", " and ")
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"[,;:/|]+", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def canonical_agency(value: object) -> str:
    normalized = normalize_text(value)
    return AGENCY_ALIASES.get(normalized, normalized)


def canonical_site(value: object) -> str:
    text = normalize_text(value)
    text = re.sub(r"\b\d{2,}\b", " ", text)
    for phrase in DESIGNATION_PHRASES:
        text = re.sub(r"\b" + re.escape(phrase) + r"\b", " ", text)
    for abbreviation in DESIGNATION_ABBREVIATIONS:
        text = re.sub(r"\b" + re.escape(abbreviation) + r"\b", " ", text)
    tokens = [token for token in text.split() if token not in STOP_WORDS and len(token) > 1]
    return " ".join(tokens).strip()


def matchable_tokens(value: object) -> list[str]:
    tokens = []
    for token in canonical_site(value).split():
        normalized = FUZZY_TOKEN_ALIASES.get(re.sub(r"\d+$", "", token), re.sub(r"\d+$", "", token))
        if normalized and normalized not in FUZZY_TOKEN_STOP_WORDS and len(normalized) > 1:
            tokens.append(normalized)
    return tokens


def tokens_match(left: str, right: str) -> bool:
    if left == right:
        return True
    if min(len(left), len(right)) >= 3 and (left.startswith(right) or right.startswith(left)):
        return True
    if min(len(left), len(right)) >= 5:
        return difflib.SequenceMatcher(None, left, right).ratio() >= 0.80
    return False


def token_match_counts(source_tokens: list[str], target_tokens: list[str]) -> tuple[int, int]:
    used_target_indexes: set[int] = set()
    source_matches = 0
    for source_token in source_tokens:
        for target_index, target_token in enumerate(target_tokens):
            if target_index in used_target_indexes:
                continue
            if tokens_match(source_token, target_token):
                used_target_indexes.add(target_index)
                source_matches += 1
                break
    return source_matches, len(used_target_indexes)


def unmatched_source_tokens(source_tokens: list[str], target_tokens: list[str]) -> list[str]:
    return [
        source_token
        for source_token in source_tokens
        if not any(tokens_match(source_token, target_token) for target_token in target_tokens)
    ]


def image_title_matches_site(title: object, site_names: list[str]) -> bool:
    normalized_title = normalize_text(title)
    if normalized_title in GENERIC_IMAGE_TITLES:
        return False

    title_tokens = matchable_tokens(title)
    if not title_tokens:
        return True

    joined_title = "".join(title_tokens)
    for site_name in site_names:
        site_tokens = matchable_tokens(site_name)
        if not site_tokens:
            continue
        source_matches, _target_matches = token_match_counts(title_tokens, site_tokens)
        if source_matches > 0:
            return True

        initials = "".join(token[0] for token in site_tokens if token)
        if 1 < len(joined_title) <= 4 and initials.startswith(joined_title):
            return True

        short_prefix_matches = 0
        for title_token in title_tokens:
            if 2 <= len(title_token) <= 3 and any(site_token.startswith(title_token) for site_token in site_tokens):
                short_prefix_matches += 1
        if short_prefix_matches >= 2:
            return True

    return False


def image_title_filter_decisions(titles: list[str], site_names: list[str]) -> list[bool]:
    if len(titles) < OFFSITE_FILTER_MIN_IMAGES:
        return [True] * len(titles)

    decisions = [image_title_matches_site(title, site_names) for title in titles]
    if sum(1 for decision in decisions if decision) < OFFSITE_FILTER_MIN_MATCHES:
        return [True] * len(titles)
    return decisions


def state_name_key(state: object, name: object) -> str:
    normalized_state = normalize_text(state)
    normalized_name = normalize_text(name)
    return f"{normalized_state}|{normalized_name}" if normalized_state and normalized_name else ""


def state_canonical_key(state: object, name: object) -> str:
    normalized_state = normalize_text(state)
    normalized_name = canonical_site(name)
    return f"{normalized_state}|{normalized_name}" if normalized_state and normalized_name else ""


def agency_compatible(source_agency: object, pin_agency: object) -> bool:
    source = canonical_agency(source_agency)
    pin = canonical_agency(pin_agency)
    if not source or not pin:
        return True
    if source == pin:
        return True
    if source == "state parks" and pin.startswith("state"):
        return True
    if pin == "state parks" and source.startswith("state"):
        return True
    return False


def is_wildlife_refuge_source(row: dict[str, str]) -> bool:
    return canonical_agency(row.get("Agency")) == "national wildlife refuge"


def is_wildlife_refuge_pin(pin: dict[str, str]) -> bool:
    agency = canonical_agency(pin.get("agency"))
    normalized_name = normalize_text(pin.get("name"))
    has_refuge_name = (
        "national wildlife refuge" in normalized_name
        or "wildlife refuge" in normalized_name
        or re.search(r"\bnwr\b", normalized_name) is not None
        or "migratory bird refuge" in normalized_name
        or "national elk refuge" in normalized_name
        or "research refuge" in normalized_name
    )
    if agency == "national wildlife refuge":
        return has_refuge_name
    return has_refuge_name


def pin_compatible(row: dict[str, str], pin: dict[str, str]) -> bool:
    if agency_compatible(row.get("Agency"), pin.get("agency")):
        return True
    return is_wildlife_refuge_source(row) and is_wildlife_refuge_pin(pin)


def is_state_park_pin(pin: dict[str, str]) -> bool:
    agency = canonical_agency(pin.get("agency"))
    if agency != "state parks" and not agency.startswith("state"):
        return False

    normalized_name = normalize_text(pin.get("name"))
    raw_tokens = set(normalized_name.split())
    state_park_phrases = [
        "state historical park",
        "state historic park",
        "state historic site",
        "state memorial",
        "state natural area",
        "state park",
        "state parks",
        "state recreation area",
        "state resort park",
    ]
    if any(phrase in normalized_name for phrase in state_park_phrases):
        return True
    return bool(raw_tokens & {"sp", "shp", "shs", "sra", "snr"})


def is_statewide_state_park_pin(pin: dict[str, str], state: str) -> bool:
    normalized_name = normalize_text(pin.get("name"))
    tokens = [token for token in normalized_name.split() if token != "s"]
    if not state or state not in normalized_name:
        return False
    if "state parks" in normalized_name or "state park" in normalized_name:
        return True
    return len(tokens) <= 3 and bool(set(tokens) & {"parks", "sp"})


def is_broad_state_program_row(row: dict[str, str]) -> bool:
    if canonical_agency(row.get("Agency")) != "state parks":
        return False
    state = normalize_text(row.get("State/Region"))
    site_name = normalize_text(row.get("Site Name"))
    if not state or state not in site_name:
        return False
    broad_markers = [
        "state parks",
        "state park",
        "state junior naturalist",
        "state parks junior naturalist",
        "state parks joint program",
        "junior naturalist",
    ]
    return any(marker in site_name for marker in broad_markers)


def find_broad_state_program_pins(
    row: dict[str, str],
    indexes: dict[str, defaultdict],
) -> list[dict[str, str]]:
    if not is_broad_state_program_row(row):
        return []

    state = normalize_text(row.get("State/Region"))
    source_name = normalize_text(row.get("Site Name"))
    candidates = [
        pin
        for pin in indexes["by_state"].get(state, [])
        if canonical_agency(pin.get("agency")) == "state parks" or is_state_park_pin(pin)
    ]
    if not candidates:
        return []

    if "naturalist" in source_name:
        naturalist_pins = [
            pin
            for pin in candidates
            if "naturalist" in pin["normalized_name"] or "association of naturalists" in pin["normalized_name"]
        ]
        if naturalist_pins:
            return sorted(naturalist_pins, key=lambda pin: pin["name"].lower())

    statewide_pins = [pin for pin in candidates if is_statewide_state_park_pin(pin, state)]
    if statewide_pins:
        return sorted(statewide_pins, key=lambda pin: pin["name"].lower())

    park_pins = [pin for pin in candidates if is_state_park_pin(pin)]
    return sorted(park_pins, key=lambda pin: pin["name"].lower())


def is_bad_site_name(value: object) -> bool:
    normalized = normalize_text(value)
    canonical = canonical_site(value)
    return (
        not normalized
        or normalized in BAD_SITE_NAMES
        or canonical in BAD_SITE_NAMES
        or normalized in STATE_NAMES
        or canonical in STATE_NAMES
        or len(canonical) < 3
    )


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def fetch_live_catalog(url: str) -> list[dict[str, str]]:
    separator = "&" if "?" in url else "?"
    cache_busted_url = f"{url}{separator}cache_bypass=jr-rewards-badge-build"
    with urllib.request.urlopen(cache_busted_url, timeout=45) as response:
        csv_text = response.read().decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(csv_text)))


def load_pins(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    pins = []
    for row in rows:
        if not clean(row.get("latitude")) or not clean(row.get("longitude")):
            continue
        pins.append(
            {
                "id": clean(row.get("siteID")),
                "name": clean(row.get("siteName")),
                "state": clean(row.get("state")),
                "agency": clean(row.get("agency")),
                "normalized_name": normalize_text(row.get("siteName")),
                "canonical_name": canonical_site(row.get("siteName")),
            }
        )
    return pins


def build_pin_indexes(pins: list[dict[str, str]]) -> dict[str, defaultdict]:
    indexes = {
        "all": [],
        "by_id": {},
        "by_state_name": defaultdict(list),
        "by_state_canonical": defaultdict(list),
        "by_name": defaultdict(list),
        "by_canonical": defaultdict(list),
        "by_state": defaultdict(list),
    }
    for pin in pins:
        state = normalize_text(pin["state"])
        indexes["all"].append(pin)
        indexes["by_id"][pin["id"]] = pin
        indexes["by_state_name"][(state, pin["normalized_name"])].append(pin)
        indexes["by_state_canonical"][(state, pin["canonical_name"])].append(pin)
        indexes["by_name"][pin["normalized_name"]].append(pin)
        indexes["by_canonical"][pin["canonical_name"]].append(pin)
        indexes["by_state"][state].append(pin)
    return indexes


def candidate_names(row: dict[str, str]) -> list[str]:
    site_name = clean(row.get("Site Name"))
    names = [site_name]
    if ";" in site_name:
        names.append(site_name.split(";", 1)[0].strip())

    aliases = clean(row.get("Merged Aliases / Badge Labels"))
    for part in aliases.split(";"):
        left = part.split("|", 1)[0].strip()
        left = re.sub(r"^Tracking row:\s*", "", left, flags=re.IGNORECASE).strip()
        if left:
            names.append(left)

    unique_names = []
    for name in names:
        if not name or is_bad_site_name(name):
            continue
        if name not in unique_names:
            unique_names.append(name)
    return unique_names


def find_contains_match(
    row: dict[str, str],
    name: str,
    indexes: dict[str, defaultdict],
) -> dict[str, str] | None:
    state = normalize_text(row.get("State/Region"))
    row_tokens = matchable_tokens(name)
    if not state or not row_tokens:
        return None

    candidates = []
    for pin in indexes["by_state"].get(state, []):
        if not pin_compatible(row, pin):
            continue
        pin_tokens = matchable_tokens(pin["name"])
        if not pin_tokens:
            continue
        row_matches, pin_matches = token_match_counts(row_tokens, pin_tokens)
        if not row_matches:
            continue

        row_coverage = row_matches / len(row_tokens)
        pin_coverage = pin_matches / len(pin_tokens)
        confident = False
        if len(row_tokens) == 1 and len(row_tokens[0]) >= 3:
            confident = row_matches == 1 and pin_coverage >= 0.22
        elif row_coverage >= 0.67 and pin_coverage >= 0.45:
            confident = True
        elif row_matches >= 2 and row_coverage >= 0.5 and pin_coverage >= 0.5:
            confident = True
        elif row_matches == 1 and len(row_tokens) == 2 and pin_coverage >= 0.45:
            unmatched_tokens = unmatched_source_tokens(row_tokens, pin_tokens)
            confident = all(
                len(token) <= 3 or token in FUZZY_SINGLE_MATCH_ALLOWED_EXTRAS
                for token in unmatched_tokens
            )

        if confident:
            score = (row_coverage * 2) + pin_coverage + (row_matches * 0.1)
            candidates.append((score, pin))

    if not candidates:
        return None

    candidates.sort(key=lambda item: (-item[0], item[1]["name"].lower()))
    if len(candidates) == 1 or candidates[0][0] - candidates[1][0] >= 0.08:
        return candidates[0][1]
    return None


def find_manual_nwr_match(
    row: dict[str, str],
    names: list[str],
    indexes: dict[str, defaultdict],
) -> tuple[dict[str, str] | None, str]:
    if not is_wildlife_refuge_source(row):
        return None, ""

    search_tokens = set()
    for name in names:
        search_tokens.update(matchable_tokens(name))

    for required_tokens, pin_id in NWR_MANUAL_PIN_OVERRIDES:
        if all(token in search_tokens for token in required_tokens):
            pin = indexes["by_id"].get(pin_id)
            if pin:
                return pin, " ".join(required_tokens)
    return None, ""


def find_cross_state_nwr_match(
    row: dict[str, str],
    name: str,
    indexes: dict[str, defaultdict],
) -> dict[str, str] | None:
    if not is_wildlife_refuge_source(row):
        return None

    row_tokens = matchable_tokens(name)
    if not row_tokens:
        return None

    candidates = []
    for pin in indexes["all"]:
        if not is_wildlife_refuge_pin(pin):
            continue
        pin_tokens = matchable_tokens(pin["name"])
        if not pin_tokens:
            continue
        row_matches, pin_matches = token_match_counts(row_tokens, pin_tokens)
        if not row_matches:
            continue

        row_coverage = row_matches / len(row_tokens)
        pin_coverage = pin_matches / len(pin_tokens)
        confident = False
        if row_matches >= 2 and row_coverage >= 0.8 and pin_coverage >= 0.6:
            confident = True

        if confident:
            same_state_bonus = 0.25 if normalize_text(row.get("State/Region")) == normalize_text(pin["state"]) else 0
            score = (row_coverage * 2) + pin_coverage + (row_matches * 0.1) + same_state_bonus
            candidates.append((score, pin))

    if not candidates:
        return None

    candidates.sort(key=lambda item: (-item[0], item[1]["state"].lower(), item[1]["name"].lower()))
    if len(candidates) == 1 or candidates[0][0] - candidates[1][0] >= 0.35:
        return candidates[0][1]
    return None


def map_row_to_pin(
    row: dict[str, str],
    indexes: dict[str, defaultdict],
) -> tuple[dict[str, str] | None, str, str]:
    state = normalize_text(row.get("State/Region"))
    names = candidate_names(row)

    manual_match, manual_label = find_manual_nwr_match(row, names, indexes)
    if manual_match:
        return manual_match, "nwr_manual_override", manual_label

    for name in names:
        normalized_name = normalize_text(name)
        canonical_name = canonical_site(name)
        exact_matches = indexes["by_state_name"].get((state, normalized_name), [])
        if len(exact_matches) == 1:
            return exact_matches[0], "state_name_exact", name

        core_matches = indexes["by_state_canonical"].get((state, canonical_name), [])
        if len(core_matches) == 1 and pin_compatible(row, core_matches[0]):
            return core_matches[0], "state_core_exact", name

    for name in names:
        normalized_name = normalize_text(name)
        canonical_name = canonical_site(name)
        exact_matches = indexes["by_name"].get(normalized_name, [])
        if len(exact_matches) == 1:
            return exact_matches[0], "unique_name_exact", name

        core_matches = indexes["by_canonical"].get(canonical_name, [])
        if len(core_matches) == 1 and pin_compatible(row, core_matches[0]):
            return core_matches[0], "unique_core_exact", name

    for name in names:
        match = find_contains_match(row, name, indexes)
        if match:
            return match, "state_core_fuzzy", name

    for name in names:
        match = find_cross_state_nwr_match(row, name, indexes)
        if match:
            return match, "nwr_cross_state_fuzzy", name

    return None, "", names[0] if names else ""


def find_actual_images(jr_rewards_dir: Path) -> dict[str, Path]:
    images_by_hash = {}
    for root, _dirs, files in os.walk(jr_rewards_dir):
        for filename in files:
            path = Path(root) / filename
            if path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            match = HASH_RE.search(str(path))
            if match:
                images_by_hash.setdefault(match.group(1).lower(), path)
    return images_by_hash


def source_image_hash(path: Path) -> str:
    match = HASH_RE.search(str(path))
    if match:
        return match.group(1).lower()
    digest = hashlib.sha1(str(path).encode("utf-8")).hexdigest()
    return digest[:10]


def resolve_example_paths(row: dict[str, str], actual_images: dict[str, Path]) -> list[Path]:
    resolved = []
    seen = set()
    for raw_path in PATH_RE.findall(clean(row.get("Example Image Files"))):
        match = HASH_RE.search(raw_path)
        path = Path(raw_path)
        if path.exists():
            actual_path = path
        elif match and match.group(1).lower() in actual_images:
            actual_path = actual_images[match.group(1).lower()]
        else:
            continue

        key = str(actual_path)
        if key in seen:
            continue
        seen.add(key)
        resolved.append(actual_path)
    return resolved


def display_title(row: dict[str, str], image_path: Path, image_number: int) -> str:
    site_name = clean(row.get("Site Name"))
    filename = re.sub(r"^\d+\s*-\s*", "", image_path.name)
    filename = re.sub(r"\s-\s[0-9a-f]{10}\.(?:jpg|jpeg|png|webp)$", "", filename, flags=re.IGNORECASE)
    filename = re.sub(r"\.(?:jpg|jpeg|png|webp)$", "", filename, flags=re.IGNORECASE).strip()
    if filename and normalize_text(filename) not in {"page header", "agency header"}:
        return filename
    if site_name:
        return site_name
    return f"Badge {image_number}"


def likely_background_color(image: Image.Image) -> tuple[int, int, int]:
    width, height = image.size
    pixels = image.load()
    edge = max(2, min(width, height) // 18)
    samples = []
    for y in range(height):
        for x in range(width):
            if x >= edge and x < width - edge and y >= edge and y < height - edge:
                continue
            red, green, blue, alpha = pixels[x, y]
            if alpha > 0:
                samples.append((red // 8 * 8, green // 8 * 8, blue // 8 * 8))
    if not samples:
        return (0, 0, 0)
    return Counter(samples).most_common(1)[0][0]


def replace_edge_background(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    background = likely_background_color(image)
    threshold = 54
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def close_to_background(x: int, y: int) -> bool:
        red, green, blue, alpha = pixels[x, y]
        if alpha < 16:
            return True
        distance = math.sqrt(
            (red - background[0]) ** 2
            + (green - background[1]) ** 2
            + (blue - background[2]) ** 2
        )
        brightness = (red + green + blue) / 3
        return distance <= threshold and (blue >= red - 8 or brightness > 218)

    for x in range(width):
        if close_to_background(x, 0):
            queue.append((x, 0))
        if close_to_background(x, height - 1):
            queue.append((x, height - 1))
    for y in range(height):
        if close_to_background(0, y):
            queue.append((0, y))
        if close_to_background(width - 1, y):
            queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if visited[index] or not close_to_background(x, y):
            continue
        visited[index] = 1
        for next_x, next_y in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= next_x < width and 0 <= next_y < height and not visited[next_y * width + next_x]:
                queue.append((next_x, next_y))

    for y in range(height):
        for x in range(width):
            if visited[y * width + x]:
                pixels[x, y] = (0, 0, 0, 255)

    return image


def write_black_webp(source_path: Path, output_path: Path, min_side: int, max_side: int, quality: int) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image = replace_edge_background(Image.open(source_path))
    width, height = image.size
    side = max(width, height)
    scale = 1.0
    if side < min_side:
        scale = min_side / side
    elif side > max_side:
        scale = max_side / side
    if scale != 1.0:
        image = image.resize((round(width * scale), round(height * scale)), Image.Resampling.LANCZOS)
        width, height = image.size
        side = max(width, height)

    canvas = Image.new("RGB", (side, side), (0, 0, 0))
    canvas.paste(image.convert("RGB"), ((side - width) // 2, (side - height) // 2))
    canvas.save(output_path, "WEBP", quality=quality, method=6)


def add_badges(target: dict[str, list[dict[str, str]]], key: str, badges: list[dict[str, str]]) -> None:
    if not key:
        return
    existing = target.setdefault(key, [])
    seen = {badge["id"] for badge in existing}
    for badge in badges:
        if badge["id"] not in seen:
            existing.append(badge)
            seen.add(badge["id"])


def csv_escape(value: object) -> str:
    text = str(value or "")
    if any(char in text for char in [",", "\"", "\n", "\r"]):
        return '"' + text.replace('"', '""') + '"'
    return text


def write_csv(path: Path, headers: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(",".join(headers) + "\n")
        for row in rows:
            handle.write(",".join(csv_escape(row.get(header, "")) for header in headers) + "\n")


def build_manifest(args: argparse.Namespace) -> dict[str, object]:
    jr_rewards_dir = Path(args.jr_rewards_dir).expanduser().resolve()
    master_path = jr_rewards_dir / "compiled_tracking_data/folder_image_master_corrected/Folder_Image_JR_Program_Master_Corrected.csv"
    if not master_path.exists():
        raise FileNotFoundError(f"Corrected JR Rewards master not found: {master_path}")

    catalog_rows = fetch_live_catalog(args.catalog_url)
    pins = load_pins(catalog_rows)
    indexes = build_pin_indexes(pins)
    actual_images = find_actual_images(jr_rewards_dir)
    master_rows = read_csv(master_path)

    badge_asset_dir = Path(args.badge_asset_dir).resolve()
    if args.clean and badge_asset_dir.exists():
        shutil.rmtree(badge_asset_dir)
    badge_asset_dir.mkdir(parents=True, exist_ok=True)

    badges_by_pin_id: dict[str, list[dict[str, str]]] = {}
    badges_by_state_name: dict[str, list[dict[str, str]]] = {}
    badges_by_state_canonical_name: dict[str, list[dict[str, str]]] = {}
    asset_cache: dict[str, str] = {}
    matched_rows = []
    unmatched_rows = []
    filtered_rows = []
    match_counts: Counter[str] = Counter()
    matched_source_rows = 0
    total_source_images = 0
    total_resolved_images = 0
    total_written_images = 0

    for row in master_rows:
        image_paths = resolve_example_paths(row, actual_images)
        if not image_paths:
            continue
        total_source_images += int(clean(row.get("Image Count")) or len(image_paths))
        total_resolved_images += len(image_paths)

        candidate_site_names = candidate_names(row)
        broad_pins = find_broad_state_program_pins(row, indexes)
        if broad_pins:
            pins_for_row = broad_pins
            match_type = "state_program_broad"
            matched_label = clean(row.get("Site Name"))
            is_broad_program = True
        else:
            pin, match_type, matched_label = map_row_to_pin(row, indexes)
            if not pin:
                unmatched_rows.append(
                    {
                        "state": clean(row.get("State/Region")),
                        "agency": clean(row.get("Agency")),
                        "siteName": clean(row.get("Site Name")),
                        "imageCount": clean(row.get("Image Count")),
                        "resolvedImageCount": len(image_paths),
                        "candidateName": matched_label,
                        "reason": "No confident pin match",
                    }
                )
                continue
            pins_for_row = [pin]
            is_broad_program = False

        titles = [display_title(row, image_path, image_number) for image_number, image_path in enumerate(image_paths, start=1)]
        base_site_names_for_filter = [clean(row.get("Site Name")), matched_label] + [pin["name"] for pin in pins_for_row]
        compatible_candidate_names = [
            site_name
            for site_name in candidate_site_names
            if image_title_matches_site(site_name, base_site_names_for_filter)
        ]
        site_names_for_filter = base_site_names_for_filter + compatible_candidate_names
        keep_decisions = (
            [True] * len(image_paths)
            if is_broad_program
            else image_title_filter_decisions(titles, site_names_for_filter)
        )

        row_badges = []
        for image_number, (image_path, title, keep_image) in enumerate(zip(image_paths, titles, keep_decisions), start=1):
            image_hash = source_image_hash(image_path)
            badge_title = SOURCE_IMAGE_TITLE_OVERRIDES.get(image_hash, title)
            blocked_reason = BLOCKED_SOURCE_IMAGE_HASHES.get(image_hash)
            if blocked_reason:
                keep_image = False

            if not keep_image:
                filtered_rows.append(
                    {
                        "pinIds": "; ".join(pin["id"] for pin in pins_for_row),
                        "sourceState": clean(row.get("State/Region")),
                        "sourceAgency": clean(row.get("Agency")),
                        "sourceSiteName": clean(row.get("Site Name")),
                        "imageTitle": badge_title,
                        "imagePath": str(image_path),
                        "reason": blocked_reason or "Image title did not match mapped site tokens",
                    }
                )
                continue

            output_relative = asset_cache.get(image_hash)
            if not output_relative:
                output_path = badge_asset_dir / f"{image_hash}.webp"
                write_black_webp(
                    image_path,
                    output_path,
                    min_side=args.min_side,
                    max_side=args.max_side,
                    quality=args.quality,
                )
                output_relative = output_path.relative_to(REPO_ROOT / "01-code/app").as_posix()
                asset_cache[image_hash] = output_relative
                total_written_images += 1

            badge_id = f"jr-reward-{image_hash}"
            row_badges.append(
                {
                    "id": badge_id,
                    "title": badge_title,
                    "type": "Badge",
                    "imageUrl": output_relative,
                    "thumbnailUrl": output_relative,
                    "source": "jr-rewards-master",
                }
            )

        if not row_badges:
            unmatched_rows.append(
                {
                    "state": clean(row.get("State/Region")),
                    "agency": clean(row.get("Agency")),
                    "siteName": clean(row.get("Site Name")),
                    "imageCount": clean(row.get("Image Count")),
                    "resolvedImageCount": len(image_paths),
                    "candidateName": matched_label,
                    "reason": "All resolved images filtered as likely off-site",
                }
            )
            continue

        match_counts[match_type] += 1
        matched_source_rows += 1
        for pin in pins_for_row:
            add_badges(badges_by_pin_id, pin["id"], row_badges)
            add_badges(badges_by_state_name, state_name_key(pin["state"], pin["name"]), row_badges)
            add_badges(badges_by_state_canonical_name, state_canonical_key(pin["state"], pin["name"]), row_badges)
            for site_name in candidate_site_names:
                add_badges(badges_by_state_name, state_name_key(row.get("State/Region"), site_name), row_badges)
                add_badges(
                    badges_by_state_canonical_name,
                    state_canonical_key(row.get("State/Region"), site_name),
                    row_badges,
                )

            matched_rows.append(
                {
                    "pinId": pin["id"],
                    "pinState": pin["state"],
                    "pinName": pin["name"],
                    "pinAgency": pin["agency"],
                    "sourceState": clean(row.get("State/Region")),
                    "sourceAgency": clean(row.get("Agency")),
                    "sourceSiteName": clean(row.get("Site Name")),
                    "matchedLabel": matched_label,
                    "matchType": match_type,
                    "badgeCount": len(row_badges),
                }
            )

    for mapping in (badges_by_pin_id, badges_by_state_name, badges_by_state_canonical_name):
        for key in list(mapping.keys()):
            mapping[key] = sorted(mapping[key], key=lambda badge: (badge["title"].lower(), badge["id"]))

    manifest = {
        "version": 3,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "name": "JR Rewards image master",
            "folder": str(jr_rewards_dir),
            "catalogUrl": args.catalog_url,
        },
        "summary": {
            "livePinsWithCoordinates": len(pins),
            "jrRewardRowsWithResolvedImages": matched_source_rows + len(unmatched_rows),
            "matchedRows": matched_source_rows,
            "matchedPinMappings": len(matched_rows),
            "unmatchedRows": len(unmatched_rows),
            "filteredImages": len(filtered_rows),
            "pinsWithBadges": len(badges_by_pin_id),
            "badgesMappedToPins": sum(len(values) for values in badges_by_pin_id.values()),
            "uniqueBadgeAssets": len(asset_cache),
            "sourceImageCountFromRows": total_source_images,
            "resolvedSourceImages": total_resolved_images,
            "writtenBadgeAssets": total_written_images,
            "matchTypes": dict(sorted(match_counts.items())),
        },
        "badgesByPinId": dict(sorted(badges_by_pin_id.items())),
        "badgesByStateName": dict(sorted(badges_by_state_name.items())),
        "badgesByStateCanonicalName": dict(sorted(badges_by_state_canonical_name.items())),
    }

    manifest_path = Path(args.manifest_path).resolve()
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8")

    report_dir = Path(args.report_dir).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    summary_path = report_dir / "jr-rewards-badge-map-summary.json"
    summary_path.write_text(json.dumps(manifest["summary"], indent=2, sort_keys=True) + "\n", encoding="utf-8")
    write_csv(
        report_dir / "jr-rewards-badge-map-matches.csv",
        [
            "pinId",
            "pinState",
            "pinName",
            "pinAgency",
            "sourceState",
            "sourceAgency",
            "sourceSiteName",
            "matchedLabel",
            "matchType",
            "badgeCount",
        ],
        matched_rows,
    )
    write_csv(
        report_dir / "jr-rewards-badge-map-unmatched.csv",
        ["state", "agency", "siteName", "imageCount", "resolvedImageCount", "candidateName", "reason"],
        unmatched_rows,
    )
    write_csv(
        report_dir / "jr-rewards-badge-map-filtered.csv",
        ["pinIds", "sourceState", "sourceAgency", "sourceSiteName", "imageTitle", "imagePath", "reason"],
        filtered_rows,
    )

    return manifest["summary"]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jr-rewards-dir", default=str(DEFAULT_JR_REWARDS_DIR))
    parser.add_argument("--catalog-url", default=DEFAULT_LIVE_CATALOG_URL)
    parser.add_argument("--manifest-path", default=str(DEFAULT_MANIFEST_PATH))
    parser.add_argument("--badge-asset-dir", default=str(DEFAULT_BADGE_ASSET_DIR))
    parser.add_argument("--report-dir", default=str(DEFAULT_REPORT_DIR))
    parser.add_argument("--min-side", type=int, default=512)
    parser.add_argument("--max-side", type=int, default=900)
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--clean", action="store_true", help="Remove generated badge assets before rebuilding.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    summary = build_manifest(args)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
