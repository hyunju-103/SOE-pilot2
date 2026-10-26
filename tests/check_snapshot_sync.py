"""The tracked SOE-Fiscal-Risk-Final.html must equal what report.py builds from templates/ and config.py
with the release settings (docs/PILOT_HTML_RELEASE.md); only meta.generated (the build date) may differ."""
import re, sys, pathlib
R = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(R))
import config, data_loader, report

GEN = re.compile(r'("generated":")\d{4}-\d{2}-\d{2}(")')
norm = lambda s: GEN.sub(r"\1DATE\2", s)

# release settings: same as `python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html`
built = norm(report.build_html(
    data_loader.demo_portfolio(), data_label="Illustrative demo portfolio: 8 invented SOEs",
    is_example=True, allow_download=True))
tracked = norm((R / "SOE-Fiscal-Risk-Final.html").read_text(encoding="utf-8"))
assert GEN.search((R / "SOE-Fiscal-Risk-Final.html").read_text(encoding="utf-8")), "tracked snapshot has no meta.generated date"

if built != tracked:
    i = next((k for k, (x, y) in enumerate(zip(built, tracked)) if x != y), min(len(built), len(tracked)))
    lo = max(0, i - 120)
    print(f"FAIL: built HTML differs from SOE-Fiscal-Risk-Final.html at char {i} (built {len(built)} chars, tracked {len(tracked)})")
    print("  built  :", repr(built[lo:i + 200]))
    print("  tracked:", repr(tracked[lo:i + 200]))
    print("Edit templates/ or config.py, then rebuild: python report.py --demo --allow-download --out SOE-Fiscal-Risk-Final.html")
    sys.exit(1)
print(f"OK: tracked snapshot equals the release build ({len(built)} chars, meta.generated ignored)")
print("OK: snapshot logistic coefficients", config.DEFAULT_CASH_SETTINGS["pd_logit_a"], config.DEFAULT_CASH_SETTINGS["pd_logit_b"])
