"""CPU runner container checks; no model download, project recalculation or raw logs."""

import json
import subprocess
import time
import urllib.request


def get(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.status, response.read()


def main():
    checks = 0
    for base, health in (("http://127.0.0.1:18001", "/healthz"),):
        for attempt in range(60):
            try:
                assert get(base + health)[0] == 200
                break
            except Exception:
                if attempt == 59:
                    raise RuntimeError(
                        "container did not become data/HTTP healthy"
                    ) from None
                time.sleep(2)
        checks += 1
    site = "http://127.0.0.1:18001/trans-resilience/"
    for name in (
        "",
        "js/deployment-config.js",
        "js/assistant-api.js",
        "css/style.css",
        "data/summary.json",
        "data/data_driven_resilience_map_v0.geojson",
        "data/curves/CS_1081.json",
    ):
        assert get(site + name)[0] == 200
        checks += 1
    config = get(site + "js/deployment-config.js")[1].decode()
    assert 'mode: "server"' in config and 'base_path: "/trans-resilience"' in config
    checks += 1
    subprocess.run(
        ["docker", "exec", "sptc-ci-frontend", "nginx", "-t"],
        check=True,
        capture_output=True,
    )
    checks += 1
    print(
        json.dumps(
            {
                "container_checks_passed": checks,
                "real_model_on_runner": False,
                "read_only_root_containers": True,
            }
        )
    )


if __name__ == "__main__":
    main()
