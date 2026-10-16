"""Independent full-key/source-value comparison and public bundle exclusion check."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def numeric(value):
    return float(value) if value else None


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(root, public):
    preview = HERE / ".local-preview"
    manifest = json.loads((preview / "manifest.json").read_text())
    accepted = root / "data/event_runs/coldwave_2026_01" / manifest["run_id"]
    source_geometry = json.loads((root / "data/front-end/sptc-demo/coldwave-demo-v3/data/data_driven_resilience_map_v0.geojson").read_text())
    geometry = json.loads((preview / "geometry.json").read_text())
    exported = json.loads((preview / "sections.json").read_text())
    original = {r["CTRL_SECT_"]: r for r in rows(accepted / "tier3/event_cs_resilience_database_v0.csv")}
    economics = {r["CTRL_SECT_"]: r for r in rows(accepted / "publish/control_section_metrics.csv")}
    temperature = {(r["CTRL_SECT_"], r["window_id"]): r for r in rows(root / "data/wether/temperature_exploration_2026_01/temperature_exposure_by_section.csv")}
    exported_by_id = {r["id"]: r for r in exported}
    assert len(exported_by_id) == len(exported) == len(original) == 10029
    old_by_id = {str(f["properties"]["CTRL_SECT_NORM"]): f for f in source_geometry["features"]}
    assert len(geometry["features"]) == len(old_by_id) == 10029
    for feature in geometry["features"]:
        key = feature["properties"]["id"]
        assert feature["geometry"] == old_by_id[key]["geometry"]
        assert set(feature["properties"]) == {"id"}
    values_checked = 0
    for key, row in exported_by_id.items():
        original_row = original[key]
        assert row["county_name"] == original_row["county_name"]
        assert row["county_fips"] == str(int(float(original_row["county_fips"])))
        for field in ["WEATHER_REI", "NETRISK_LITE", "Potential_Resilience_Score", "AADT_CS", "q_min", "resilience_loss_area", "observed_curve_resilience_score_v0", "recovery_duration_hours"]:
            assert row[field] == numeric(original_row[field]), (key, field)
            values_checked += 1
        for field in ["total_vehicle_delay_hours", "expected_demand_mobility_delay_cost_2024usd"]:
            assert row[field] == numeric(economics[key][field]), (key, field)
            values_checked += 1
        assert not any("passenger" in field or "commercial" in field for field in row)
        for window, fields in row["temperature"].items():
            for field, value in fields.items():
                assert value == numeric(temperature[(key, window)][field]), (key, window, field)
                values_checked += 1
    curves = list((preview / "curves").glob("CS_*.json"))
    assert len(curves) == 3842
    for curve in curves:
        assert sha(curve) == sha(root / "data/front-end/sptc-demo/coldwave-demo-v3/data/curves" / curve.name)
    summaries = json.loads((preview / "summaries.json").read_text())
    source_event = rows(accepted / "publish/event_summary.csv")[0]
    source_counties = {str(int(float(r["county_fips"]))): r for r in rows(accepted / "publish/county_summary.csv")}
    for field, value in summaries["event"].items():
        assert value == numeric(source_event[field]), field
    for county, fields in summaries["counties"].items():
        for field, value in fields.items():
            assert value == numeric(source_counties[county][field]), (county, field)
    policy = json.loads((public / "data/public-manifest.json").read_text())
    assert policy["public_only"] and policy["events"] == [] and policy["redistribution_approved"]
    public_files = [p for p in public.rglob("*") if p.is_file()]
    assert len(public_files) == 21
    forbidden_values = [str(summaries["event"]["expected_demand_mobility_delay_cost_2024usd"]),
                        str(summaries["event"]["total_vehicle_delay_hours"]), manifest["run_id"]]
    for path in public_files:
        relative = path.relative_to(public).as_posix()
        assert not any(term in relative for term in [".local-preview", "curves/", ".csv", ".zip", "sections.json", "summaries.json"])
        if path.suffix in {".js", ".css", ".html", ".json"}:
            text = path.read_text(encoding="utf-8")
            assert not any(value in text for value in forbidden_values), relative
    print(json.dumps({"status": "PASS", "exact_geometry_joins": len(exported), "exact_numeric_values_checked": values_checked,
                      "unchanged_local_curve_copies": len(curves), "accepted_county_impact_summaries": len(source_counties),
                      "public_files_checked": len(public_files), "public_analytical_data_files": 0}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--public-dir", type=Path, required=True)
    args = parser.parse_args()
    main(args.project_root.resolve(), args.public_dir.resolve())
