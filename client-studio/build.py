#!/usr/bin/env python3
"""Build Charné's Client Studio into one double-clickable HTML file.

    python3 client-studio/build.py

Reads src/studio.html, src/studio.css, src/app.js and the fonts and logos in
assets/, and writes Charne-Client-Studio.html next to this script. The output
has no outside dependencies: fonts, logos and code are all inside it, so it
works offline and can be sent on WhatsApp or e-mail as a single file.
"""

import base64
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "src"
ASSETS = HERE / "assets"
OUT = HERE / "Charne-Client-Studio.html"


def data_url(path: pathlib.Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def font_face(family: str, file: str, weight: str, style: str = "normal") -> str:
    url = data_url(ASSETS / file, "font/woff2")
    return (
        "@font-face{font-family:'%s';font-style:%s;font-weight:%s;font-display:swap;"
        "src:url(%s) format('woff2')}" % (family, style, weight, url)
    )


def main() -> None:
    fonts = "\n".join([
        font_face("Cormorant Garamond", "cormorant-garamond.woff2", "300 700"),
        font_face("Cormorant Garamond", "cormorant-garamond-italic.woff2", "300 700", "italic"),
        font_face("Noto Sans", "noto-sans.woff2", "100 900"),
    ])
    assets = {
        "crest": data_url(ASSETS / "rb-crest.png", "image/png"),
        "lockupNavy": data_url(ASSETS / "rb-lockup-navy.png", "image/png"),
        "lockupWhite": data_url(ASSETS / "rb-lockup-white.png", "image/png"),
    }
    html = (SRC / "studio.html").read_text(encoding="utf-8")
    css = (SRC / "studio.css").read_text(encoding="utf-8")
    js = (SRC / "app.js").read_text(encoding="utf-8")
    if "</script" in js.lower():
        raise SystemExit("app.js must not contain a literal closing script tag; write <\\/script>")
    html = html.replace("/*@FONTS@*/", fonts)
    html = html.replace("/*@CSS@*/", css)
    html = html.replace('"@ASSETS@"', json.dumps(assets))
    prompt = (HERE / "AI-INSTRUCTIONS.md").read_text(encoding="utf-8")
    js = js.replace('"@AI_PROMPT@"', json.dumps(prompt).replace("</", "<\\/"))
    html = html.replace("/*@APP@*/", js)
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.relative_to(HERE.parent)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
