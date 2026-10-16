"""Export allowlisted, LOCAL-ONLY static evidence; never publish or recalculate.

All exports are ignored by Git. Original research inputs are read-only.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import shutil
from uuid import uuid4


HERE = Path(__file__).resolve().parents[1]
RUN_ID = "20260925T053735083951Z_fff7abce"
SECTION_FIELDS = ["WEATHER_REI", "NETRISK_LITE", "Potential_Resilience_Score", "AADT_CS", "q0", "q_min",
                  "resilience_loss_area", "normalized_loss_area", "observed_curve_resilience_score_v0",
                  "recovery_duration_hours", "matched_tmc_count"]
SUMMARY_FIELDS = ["total_vehicle_delay_hours", "expected_demand_mobility_delay_cost_2024usd", "passenger_person_delay_hours",
                  "commercial_vehicle_delay_hours", "passenger_delay_cost_2024usd", "commercial_operator_delay_cost_2024usd",
                  "represented_profile_exposure", "contributing_tmc_hours", "unique_contributing_tmcs"]
TEMPERATURE_FIELDS = ["minimum_daily_buffer_mean_tmin_c", "tmin_below_zero_days", "tmax_below_zero_days"]


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def number(value: str | None) -> float | None:
    if value is None or not value.strip():
        return None
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("Nonfinite source value")
    return parsed


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write(path: Path, data) -> None:
    path.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False), encoding="utf-8")


def build(root: Path) -> dict:
    destination = HERE / ".local-preview"
    if destination.exists():
        raise FileExistsError("Local preview already exists; choose a fresh V4 checkout for another export")
    accepted = root / "data/event_runs/coldwave_2026_01" / RUN_ID
    source_frontend = root / "data/front-end/sptc-demo/coldwave-demo-v3/data"
    temperature = root / "data/wether/temperature_exploration_2026_01"
    package_path = accepted / "publish/package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    if package["status"] != "REVIEW_READY" or package["approval_status"] != "NOT_APPROVED":
        raise ValueError("This exporter is only for the explicitly authorized local review package")
    data_paths = {
        "geometry": source_frontend / "data_driven_resilience_map_v0.geojson",
        "tier3": accepted / "tier3/event_cs_resilience_database_v0.csv",
        "tier1": accepted / "tier1/tier1_control_sections.csv",
        "sections": accepted / "publish/control_section_metrics.csv",
        "event": accepted / "publish/event_summary.csv",
        "counties": accepted / "publish/county_summary.csv",
        "temperature": temperature / "temperature_exposure_by_section.csv",
        "package": package_path,
    }
    before = {key: sha(path) for key, path in data_paths.items()}
    if before["tier3"] != package["stage_outputs"]["tier3"]["event_cs_resilience_database_v0.csv"]["sha256"]:
        raise ValueError("Accepted Tier 3 stage hash mismatch")
    if before["tier1"] != package["stage_outputs"]["tier1"]["tier1_control_sections"]["sha256"]:
        raise ValueError("Accepted Tier 1 stage hash mismatch")
    exploration = json.loads((temperature / "exploration_manifest.json").read_text(encoding="utf-8"))
    if before["temperature"] != exploration["outputs"]["temperature_exposure_by_section.csv"]["sha256"]:
        raise ValueError("Reviewed temperature product hash mismatch")
    geometry = json.loads(data_paths["geometry"].read_text(encoding="utf-8"))
    context = {r["CTRL_SECT_"]: r for r in read_csv(data_paths["tier3"])}
    planning = {r["CTRL_SECT_"]: r for r in read_csv(data_paths["tier1"])}
    impact = {r["CTRL_SECT_"]: r for r in read_csv(data_paths["sections"])}
    temperatures: dict[str, dict] = {}
    for r in read_csv(data_paths["temperature"]):
        windows = temperatures.setdefault(r["CTRL_SECT_"], {})
        if r["window_id"] in windows:
            raise ValueError("Duplicate temperature key")
        windows[r["window_id"]] = {field: number(r[field]) for field in TEMPERATURE_FIELDS}
    if len(geometry["features"]) != 10029 or set(context) != set(planning) or set(context) != set(impact) or set(context) != set(temperatures):
        raise ValueError("Accepted section key domains do not match")
    work = HERE / (".preview-build-" + uuid4().hex)
    work.mkdir()
    curve_count = 0
    try:
        (work / "curves").mkdir()
        rows, features, ids = [], [], set()
        for feature in geometry["features"]:
            key = str(feature["properties"]["CTRL_SECT_NORM"])
            if key in ids or key not in context:
                raise ValueError("Invalid geometry join")
            ids.add(key)
            src = context[key]
            status = feature["properties"]["detection_status"]
            has_curve = src["npmrds_support_flag"] == "True"
            row = {"id": key, "route": src["ROUTE_KEY"], "county_name": src["county_name"],
                   "county_fips": str(int(float(src["county_fips"]))), "status": status, "has_curve": has_curve,
                   **{field: number(src[field]) for field in SECTION_FIELDS},
                   "P_SUM6": number(planning[key]["P_SUM6"]),
                   "total_vehicle_delay_hours": number(impact[key]["total_vehicle_delay_hours"]),
                   "expected_demand_mobility_delay_cost_2024usd": number(impact[key]["expected_demand_mobility_delay_cost_2024usd"]),
                   "temperature": temperatures[key]}
            if set(temperatures[key]) != {"legacy_labels", "temporal_overlap_labels"}:
                raise ValueError("Temperature windows incomplete")
            for field in SECTION_FIELDS:
                old = feature["properties"].get(field)
                if old is not None and row[field] is not None and abs(old - row[field]) > 5.1e-7:
                    raise ValueError("V3/frozen-run evidence disagreement: " + key + " / " + field)
            if has_curve:
                source = source_frontend / "curves" / f"CS_{key}.json"
                payload = json.loads(source.read_text(encoding="utf-8"))
                if str(payload["metadata"]["CTRL_SECT_"]) != key:
                    raise ValueError("Curve key mismatch")
                if row["q_min"] is not None and abs(payload["metadata"]["q_min"] - row["q_min"]) > 5.1e-7:
                    raise ValueError("Accepted curve/metric mismatch")
                shutil.copyfile(source, work / "curves" / source.name)
                curve_count += 1
            rows.append(row)
            features.append({"type": "Feature", "properties": {"id": key}, "geometry": feature["geometry"]})
        if len(ids) != 10029 or curve_count != 3842:
            raise ValueError("Coverage not equal to accepted baseline")
        event_rows = read_csv(data_paths["event"])
        if len(event_rows) != 1:
            raise ValueError("Expected a single accepted event summary")
        event = {field: number(event_rows[0][field]) for field in SUMMARY_FIELDS}
        counties = {str(int(float(r["county_fips"]))): {field: number(r[field]) for field in SUMMARY_FIELDS}
                    for r in read_csv(data_paths["counties"])}
        write(work / "geometry.json", {"type": "FeatureCollection", "features": features})
        write(work / "sections.json", rows)
        write(work / "summaries.json", {"event": event, "counties": counties})
        manifest = {"schema_version": 1, "mode": "LOCAL_RESEARCH_PREVIEW", "redistribution_approved": False,
                    "event_id": "coldwave_2026_01", "run_id": RUN_ID, "status": "REVIEW_READY", "approval_status": "NOT_APPROVED",
                    "section_count": len(rows), "curve_count": curve_count, "county_count": len(counties),
                    "windows": package["windows"], "method_versions": package["method_versions"],
                    "temperature_windows": {"legacy_labels": ["2026-01-22", "2026-01-27"], "temporal_overlap_labels": ["2026-01-22", "2026-01-28"]},
                    "temperature_release": "D2 release 8", "prism_day": "24 hours ending at 12:00 UTC on labeled date",
                    "source_hashes": before, "sources_unchanged": before == {key: sha(path) for key, path in data_paths.items()}}
        if not manifest["sources_unchanged"]:
            raise ValueError("Input bytes changed during export")
        write(work / "manifest.json", manifest)
        work.rename(destination)
        print(json.dumps({"status": "LOCAL_ONLY_EXPORT_READY", "sections": len(rows), "curves": curve_count,
                          "counties": len(counties), "sources_unchanged": True}))
        return manifest
    finally:
        if work.exists():
            if work.resolve().parent != HERE.resolve() or not work.name.startswith(".preview-build-"):
                raise RuntimeError("Unsafe temporary cleanup path")
            shutil.rmtree(work)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, required=True)
    build(parser.parse_args().project_root.resolve())
