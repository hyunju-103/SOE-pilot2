"""
SOE Fiscal Risk Tool — main entry point.

    streamlit run Home.py

Shows the interactive tool full-window, exactly as the HTML version looks:
Home, How it works, KPI Dashboard, Distress Indicator, Expected Fiscal Cost,
Shock Scenarios, Early Warning and Report (Government Support and Technical
notes are built but kept off the tab bar), with the demo portfolio loaded and
an upload box for your own CSV/Excel file.

The currently published UI is the reviewed standalone
SOE-Fiscal-Risk-Final.html (preferred when present); report.py/templates
remain the fallback generator. Browser-side calculations run in the
embedded HTML and uploads are not sent to the server.

The Python-rendered multipage version is still available:
    streamlit run classic.py
"""

from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

import config
import data_loader
import report

st.set_page_config(page_title=config.REPORT_TITLE, page_icon="🏛️", layout="wide", initial_sidebar_state="collapsed")

# Hide Streamlit's own chrome and let the tool fill the window; it scrolls inside its frame.
st.markdown(
    """
    <style>
      header[data-testid="stHeader"], [data-testid="stToolbar"], [data-testid="stDecoration"],
      [data-testid="stStatusWidget"], #MainMenu, footer { display: none !important; }
      html, body, [data-testid="stAppViewContainer"], [data-testid="stMain"] { overflow: hidden !important; }
      .block-container, [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: 100% !important; }
      [data-testid="stVerticalBlock"] { gap: 0 !important; }
      [data-testid="stElementContainer"]:has(iframe), .element-container:has(iframe) { height: 100vh !important; }
      iframe { display: block; border: 0; width: 100% !important; height: 100vh !important; }
    </style>
    """,
    unsafe_allow_html=True,
)


def tool_page() -> str:
    # Publish the reviewed, self-contained dashboard as the actual pilot UI.
    # Keep report.py as the fallback for source-based rebuilding.
    # Read on each Streamlit rerun so HTML-only deployments never serve a stale cache.
    release_html = Path(__file__).with_name("SOE-Fiscal-Risk-Final.html")
    if release_html.is_file():
        return release_html.read_text(encoding="utf-8")

    app = report.build_app_data(
        data_loader.demo_portfolio(),
        data_label="Illustrative demo portfolio: 8 invented SOEs",
        is_example=True,
        allow_download=True,  # the Streamlit frame permits downloads and printing
    )
    return report.render_html(app, standalone=True)


components.html(tool_page(), height=900, scrolling=True)
