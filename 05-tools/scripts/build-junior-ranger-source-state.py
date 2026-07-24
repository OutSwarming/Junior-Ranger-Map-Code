#!/usr/bin/env python3
"""Build a state-level Junior Ranger import preview from the master sheet.

This intentionally reads the public Google Sheets HTML view because the plain
GViz feed drops the column-B color signal that identifies the agency.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
import urllib.request
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


SPREADSHEET_ID = "1Twoq7MNwqGn49d9t2phdDThB5ufT1H2PqY9fmcZrs_8"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPORT_DIR = REPO_ROOT / "05-tools" / "reports" / "source-import"

IGNORED_SHEETS = {
    "canada",
    "color coding as your agency reference",
}

IGNORED_COLORS = {
    "#9900ff": "trail/across-program",
}

AGENCY_BY_COLOR = {
    "#0000ff": "NPS",
    "#00ff00": "US Fish & Wildlife Service",
    "#5b0f00": "US Forest Service - National Forest",
    "#000000": "State",
    "#ffff00": "Other",
    "#ff9900": "BLM",
    "#ff0000": "US Army Corps of Engineers",
}

JURISDICTION_NAMES = {
    "alabama", "alaska", "american samoa", "arizona", "arkansas", "california",
    "colorado", "connecticut", "delaware", "district of columbia", "florida",
    "georgia", "guam", "hawaii", "idaho", "illinois", "indiana", "iowa",
    "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts",
    "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska",
    "nevada", "new hampshire", "new jersey", "new mexico", "new york",
    "north carolina", "north dakota", "northern mariana islands", "ohio",
    "oklahoma", "oregon", "pennsylvania", "puerto rico", "rhode island",
    "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
    "virgin islands", "virginia", "washington", "washington dc",
    "west virginia", "wisconsin", "wyoming",
}


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\xa0", " ")).strip()


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).strip()


def is_jurisdiction_name(value: str) -> bool:
    return normalize_name(value).replace(" d c ", " dc ") in JURISDICTION_NAMES


def looks_like_state_list(value: str) -> bool:
    text = clean(value)
    if is_jurisdiction_name(text):
        return True
    if "," not in text:
        return False
    parts = [part.strip() for part in text.split(",") if part.strip()]
    return len(parts) > 1 and all(is_jurisdiction_name(part) for part in parts)


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", clean(value).lower()).strip("_")
    return f"jr_{slug or 'new_place'}"


def clean_coordinate(value: str, minimum: float, maximum: float) -> str:
    text = clean(value)
    if not text:
        return ""
    try:
        number = float(text)
    except ValueError:
        return ""
    if number < minimum or number > maximum:
        return ""
    return text


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_gid_map(index_html: str) -> dict[str, str]:
    pattern = re.compile(
        r"\[\d+,0,\\\"(?P<gid>\d+)\\\",\[\{\\\"1\\\":\[\[0,0,\\\"(?P<name>[^\\\"]+)\\\""
    )
    return {
        html.unescape(match.group("name")): match.group("gid")
        for match in pattern.finditer(index_html)
    }


def parse_style_colors(sheet_html: str) -> dict[str, str]:
    styles: dict[str, str] = {}
    for match in re.finditer(r"\.ritz \.waffle \.(s\d+)\{([^}]*)\}", sheet_html):
        color_match = re.search(r"background-color:([^;]+)", match.group(2))
        if color_match:
            styles[match.group(1)] = color_match.group(1).strip().lower()
    return styles


@dataclass
class ParsedCell:
    text: str = ""
    css_class: str = ""
    links: list[str] = field(default_factory=list)
    tag: str = ""


class WaffleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_waffle_table = 0
        self.in_row = False
        self.in_cell = False
        self.rows: list[list[ParsedCell]] = []
        self.current_row: list[ParsedCell] = []
        self.current_cell: ParsedCell | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key: value or "" for key, value in attrs}
        if tag == "table" and "waffle" in attr_map.get("class", ""):
            self.in_waffle_table += 1
        elif self.in_waffle_table and tag == "tr":
            self.in_row = True
            self.current_row = []
        elif self.in_row and tag in ("td", "th"):
            self.in_cell = True
            self.current_cell = ParsedCell(css_class=attr_map.get("class", ""), tag=tag)
        elif self.in_cell and tag == "a" and self.current_cell is not None:
            href = attr_map.get("href", "")
            if href:
                self.current_cell.links.append(href)

    def handle_data(self, data: str) -> None:
        if self.in_cell and self.current_cell is not None:
            self.current_cell.text += data

    def handle_endtag(self, tag: str) -> None:
        if self.in_cell and tag in ("td", "th"):
            assert self.current_cell is not None
            self.current_cell.text = clean(self.current_cell.text)
            self.current_row.append(self.current_cell)
            self.current_cell = None
            self.in_cell = False
        elif self.in_row and tag == "tr":
            self.rows.append(self.current_row)
            self.current_row = []
            self.in_row = False
        elif tag == "table" and self.in_waffle_table:
            self.in_waffle_table -= 1


def first_style_class(css_class: str) -> str:
    for part in css_class.split():
        if re.fullmatch(r"s\d+", part):
            return part
    return ""


def cell_color(cell: ParsedCell, styles: dict[str, str]) -> str:
    return styles.get(first_style_class(cell.css_class), "").lower()


def tag_from_cell(cell: ParsedCell) -> dict[str, str]:
    return {
        "label": clean(cell.text),
        "url": cell.links[0] if cell.links else "",
    }


def is_parenthesized_location(value: str) -> bool:
    return bool(re.fullmatch(r"\([^()]+\)", clean(value)))


def strip_location_parens(value: str) -> str:
    text = clean(value)
    if is_parenthesized_location(text):
        return text[1:-1].strip()
    return text


def row_status(entry: dict[str, Any]) -> str:
    missing = []
    if not entry["latitude"] or not entry["longitude"]:
        missing.append("coordinates")
    if not entry["siteID"]:
        missing.append("siteID")
    return "ready" if not missing else f"needs_{'_and_'.join(missing)}"


def markdown_cell(value: str) -> str:
    return clean(value).replace("|", "\\|")


def parse_state_sheet(state: str, sheet_html: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    styles = parse_style_colors(sheet_html)
    parser = WaffleParser()
    parser.feed(sheet_html)

    entries: list[dict[str, Any]] = []
    ignored_rows: list[dict[str, Any]] = []
    current_state = state
    current_entry: dict[str, Any] | None = None
    current_parent_title = ""

    for sheet_row_number, row in enumerate(parser.rows[1:], start=1):
        cells = [cell for cell in row if cell.tag == "td"]
        if len(cells) < 8:
            continue

        state_cell, color_cell, name_cell, tag_cell = cells[0], cells[1], cells[2], cells[3]
        latitude_cell, longitude_cell, site_id_cell = cells[5], cells[6], cells[7]
        state_text = clean(state_cell.text)
        name = clean(name_cell.text)
        tag = clean(tag_cell.text)
        latitude = clean_coordinate(latitude_cell.text, -90, 90)
        longitude = clean_coordinate(longitude_cell.text, -180, 180)
        site_id = clean(site_id_cell.text)
        color = cell_color(color_cell, styles)

        if state_text and is_jurisdiction_name(state_text):
            current_state = state_text

        if sheet_row_number == 1 or "master map" in state_text.lower() or "track trails" in tag.lower():
            continue
        if not any([name, tag, latitude, longitude, site_id]):
            continue

        if color in IGNORED_COLORS:
            ignored_rows.append({
                "row": sheet_row_number,
                "state": current_state,
                "color": color,
                "reason": IGNORED_COLORS[color],
                "name": name,
                "tag": tag,
            })
            current_entry = None
            continue

        if name and looks_like_state_list(name):
            current_entry = None
            continue

        if name:
            is_child_location = is_parenthesized_location(name) and bool(current_parent_title)
            display_name = strip_location_parens(name)
            title = f"{current_parent_title} - {display_name}" if is_child_location else display_name
            agency = AGENCY_BY_COLOR.get(color, "")
            entry = {
                "state": current_state,
                "siteName": title,
                "parentSiteName": current_parent_title if is_child_location else "",
                "sourceName": name,
                "agency": agency,
                "sourceColor": color,
                "latitude": latitude,
                "longitude": longitude,
                "siteID": site_id,
                "proposedSiteID": site_id or slugify(f"{current_state} {title}"),
                "sourceSheet": state,
                "sourceRowNumber": sheet_row_number,
                "tags": [],
            }
            entries.append(entry)
            current_entry = entry
            if not is_child_location:
                current_parent_title = title

        if tag and current_entry is not None:
            current_entry["tags"].append(tag_from_cell(tag_cell))

    for entry in entries:
        entry["status"] = row_status(entry)
        labels = [tag["label"] for tag in entry["tags"] if tag["label"]]
        links = [f"{tag['label']}: {tag['url']}" for tag in entry["tags"] if tag["label"] and tag["url"]]
        entry["specialPrograms"] = " | ".join(dict.fromkeys(labels))
        entry["jrBooks"] = "\n".join(dict.fromkeys(links))

    return entries, ignored_rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = [
        "status", "state", "siteName", "parentSiteName", "agency", "sourceColor",
        "latitude", "longitude", "siteID", "proposedSiteID", "specialPrograms",
        "jrBooks", "sourceSheet", "sourceRowNumber",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fieldnames})


def write_markdown(path: Path, state: str, rows: list[dict[str, Any]], ignored: list[dict[str, Any]]) -> None:
    ready = [row for row in rows if row["status"] == "ready"]
    needs = [row for row in rows if row["status"] != "ready"]
    with path.open("w", encoding="utf-8") as handle:
        handle.write(f"# Junior Ranger Source Import Preview - {state}\n\n")
        handle.write("## Summary\n\n")
        handle.write(f"- Candidate non-purple pins: {len(rows)}\n")
        handle.write(f"- Ready for map: {len(ready)}\n")
        handle.write(f"- Needs coordinates and/or site ID: {len(needs)}\n")
        handle.write(f"- Ignored purple trail/across rows: {len(ignored)}\n\n")

        handle.write("## Candidate Pins\n\n")
        handle.write("| Status | Row | Name | Agency | Color | Lat | Lng | Site ID | Tags |\n")
        handle.write("| --- | ---: | --- | --- | --- | --- | --- | --- | --- |\n")
        for row in rows:
            tag_text = "; ".join(tag["label"] for tag in row["tags"])
            handle.write(
                "| {status} | {sourceRowNumber} | {siteName} | {agency} | {sourceColor} | "
                "{latitude} | {longitude} | {siteID} | {tags} |\n".format(
                    status=row["status"],
                    sourceRowNumber=row["sourceRowNumber"],
                    siteName=clean(row["siteName"]).replace("|", "\\|"),
                    agency=clean(row["agency"]).replace("|", "\\|"),
                    sourceColor=row["sourceColor"],
                    latitude=row["latitude"],
                    longitude=row["longitude"],
                    siteID=row["siteID"],
                    tags=clean(tag_text).replace("|", "\\|"),
                )
            )

        handle.write("\n## Ignored Purple Rows\n\n")
        handle.write("| Row | Name | Tag/Location | Reason |\n")
        handle.write("| ---: | --- | --- | --- |\n")
        for row in ignored:
            handle.write(
                f"| {row['row']} | {markdown_cell(row['name'])} | "
                f"{markdown_cell(row['tag'])} | {row['reason']} |\n"
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Junior Ranger source-sheet import preview for one state.")
    parser.add_argument("--state", required=True, help="State tab to import, e.g. Alabama")
    parser.add_argument("--spreadsheet-id", default=SPREADSHEET_ID)
    parser.add_argument("--report-dir", default=str(DEFAULT_REPORT_DIR))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    state = clean(args.state)
    if normalize_name(state) in IGNORED_SHEETS:
        raise SystemExit(f"Refusing to import ignored sheet: {state}")

    index_url = f"https://docs.google.com/spreadsheets/d/{args.spreadsheet_id}/edit"
    gid_map = parse_gid_map(fetch_text(index_url))
    gid = gid_map.get(state)
    if not gid:
        available = ", ".join(sorted(gid_map))
        raise SystemExit(f"Could not find state tab {state!r}. Available tabs: {available}")

    sheet_url = f"https://docs.google.com/spreadsheets/d/{args.spreadsheet_id}/edit?gid={gid}"
    rows, ignored = parse_state_sheet(state, fetch_text(sheet_url))

    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", state.lower()).strip("-")
    csv_path = report_dir / f"{slug}-source-import-preview.csv"
    json_path = report_dir / f"{slug}-source-import-preview.json"
    md_path = report_dir / f"{slug}-source-import-preview.md"

    write_csv(csv_path, rows)
    json_path.write_text(json.dumps({"state": state, "rows": rows, "ignoredRows": ignored}, indent=2), encoding="utf-8")
    write_markdown(md_path, state, rows, ignored)

    summary = {
        "state": state,
        "gid": gid,
        "candidatePins": len(rows),
        "readyPins": sum(1 for row in rows if row["status"] == "ready"),
        "needsWork": sum(1 for row in rows if row["status"] != "ready"),
        "ignoredPurpleRows": len(ignored),
        "markdown": str(md_path),
        "csv": str(csv_path),
        "json": str(json_path),
    }
    print(json.dumps(summary, indent=2) if args.json else "\n".join(f"{k}: {v}" for k, v in summary.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
