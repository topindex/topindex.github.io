#!/usr/bin/env python3
"""
Build script for topindex.github.io

Syncs sub-sites from source repositories, patches title bars with
topindex navigation links, injects CSS, and generates the root index page.

Usage:
    python3 build.py
"""

import os
import re
import subprocess
import sys

# --- Configuration ---

SITE_DIR = os.path.dirname(os.path.abspath(__file__))

GOOGLE_ANALYTICS = """\
<script async src="https://www.googletagmanager.com/gtag/js?id=G-R2H3DBGJZJ"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-R2H3DBGJZJ');
</script>"""

SOURCES = {
    "hackernews": os.path.expanduser("~/Projects/hackernews_top/hackernews"),
    "reddit": os.path.expanduser("~/Projects/reddit_top_light/reddit"),
    "lobsters": "/Volumes/Samsung-4TB-APFS/Projects/lobsters_top/lobsters",
}

SITES = [
    {
        "key": "hackernews",
        "label": "Hacker News",
        "subtitle": "top hacker news posts",
        "description": "Top posts from Hacker News, organized by week, month, and year",
        "icon_svg": (
            '<svg class="site-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'
            '<rect width="32" height="32" rx="6" fill="#ff6600"/>'
            '<text x="16" y="23" text-anchor="middle" '
            'font-family="Arial,Helvetica,sans-serif" '
            'font-size="20" font-weight="700" fill="white">hn</text>'
            "</svg>"
        ),
    },
    {
        "key": "reddit",
        "label": "Reddit",
        "subtitle": "top reddit posts",
        "description": "Top posts from subreddits, organized by week, month, and year",
        "icon_svg": (
            '<svg class="site-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'
            '<rect width="32" height="32" rx="6" fill="#ff6600"/>'
            '<text x="16" y="24" text-anchor="middle" '
            'font-family="-apple-system,BlinkMacSystemFont,sans-serif" '
            'font-size="24" font-weight="700" fill="#fff">r</text>'
            "</svg>"
        ),
    },
    {
        "key": "lobsters",
        "label": "Lobsters",
        "subtitle": "top lobsters posts",
        "description": "Top posts from Lobsters, organized by week, month, and year",
        "icon_svg": (
            '<svg class="site-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'
            '<rect width="32" height="32" rx="6" fill="#520000"/>'
            '<text x="16" y="23" text-anchor="middle" '
            'font-family="Arial,Helvetica,sans-serif" '
            'font-size="22" font-weight="700" fill="white">L</text>'
            "</svg>"
        ),
    },
]

# --- Sync ---


def sync_sources():
    """Rsync each source folder into the site directory."""
    for key, src in SOURCES.items():
        dst = os.path.join(SITE_DIR, key)
        if not os.path.isdir(src):
            print(f"  SKIP {key}: source not found at {src}")
            continue
        # Ensure trailing slashes for rsync directory sync
        cmd = [
            "rsync", "-a", "--delete",
            "--exclude", ".DS_Store",
            src.rstrip("/") + "/",
            dst.rstrip("/") + "/",
        ]
        print(f"  rsync {key} ...")
        subprocess.run(cmd, check=True)
    print()


# --- HTML Patching ---


# CSS injected into reddit HTML <head> so the subtitle link inherits
# hover color from .title-subtitle:hover (source CSS sets color on the
# span, but a nested <a> with its own color rule won't inherit without this).
REDDIT_TITLE_CSS = """\
<style>.site-header .title-subtitle a, .site-header .title-subtitle a:visited { color: inherit; text-decoration: none; } .site-header .title-subtitle:hover { color: var(--color-text); } .site-header .title-subtitle a:hover { color: var(--color-accent); }</style>"""


def patch_reddit_html():
    """Patch reddit HTML files: make subtitle text a link to ./"""
    reddit_dir = os.path.join(SITE_DIR, "reddit")
    html_files = [f for f in os.listdir(reddit_dir) if f.endswith(".html")]

    # Pattern: <span class="title-subtitle">top reddit posts</span>
    # Only wrap text in link; source CSS handles hover via .title-subtitle:hover
    pattern = r'(<span class="title-subtitle">)(top reddit posts)(</span>)'
    replacement = r'\1<a href="./">\2</a>\3'

    for fname in html_files:
        path = os.path.join(reddit_dir, fname)
        text = open(path, "r").read()
        new_text = re.sub(pattern, replacement, text)
        if new_text != text:
            # Inject CSS if not already present
            if ".title-subtitle a" not in new_text:
                new_text = new_text.replace("</head>", REDDIT_TITLE_CSS + "\n</head>")
        # Inject Google Analytics if not already present
        if "G-R2H3DBGJZJ" not in new_text:
            new_text = new_text.replace("</head>", GOOGLE_ANALYTICS + "\n</head>")
        if new_text != text:
            open(path, "w").write(new_text)
            print(f"  patched {fname}")
        else:
            print(f"  skip {fname} (already patched or no match)")


HN_TITLE_CSS = """\
<style>
.title-subtitle a { color: inherit; text-decoration: none; }
.title-subtitle a:hover { color: var(--accent); }
</style>"""


def patch_hackernews_html():
    """Patch hackernews HTML files: fix home link href and wrap subtitle in link."""
    hn_dir = os.path.join(SITE_DIR, "hackernews")
    patches = {
        "index.html": {
            "h1_old": '<h1><a href="index.html" class="home-link">topindex</a> <span class="title-sep">|</span> <span class="title-subtitle">top hacker news posts</span></h1>',
            "h1_new": '<h1><a href="/" class="home-link">topindex</a> <span class="title-sep">|</span> <span class="title-subtitle"><a href="./">top hacker news posts</a></span></h1>',
        },
        "today.html": {
            "h1_old": '<h1><a href="today.html" class="home-link">topindex</a> <span class="title-sep">|</span> <span class="title-subtitle">top hacker news posts — today</span></h1>',
            "h1_old_alt": '<h1><a href="today.html" class="home-link">topindex</a> <span class="title-sep">|</span> <span class="title-subtitle">top hacker news posts &mdash; today</span></h1>',
            "h1_new": '<h1><a href="/" class="home-link">topindex</a> <span class="title-sep">|</span> <span class="title-subtitle"><a href="./">top hacker news posts</a> — today</span></h1>',
        },
    }

    for fname, cfg in patches.items():
        path = os.path.join(hn_dir, fname)
        if not os.path.exists(path):
            print(f"  skip {fname} (not found)")
            continue

        text = open(path, "r").read()

        # Inject CSS block after </title> if not already present
        if ".title-subtitle a" not in text:
            text = text.replace("</title>", "</title>\n" + HN_TITLE_CSS)

        # Inject Google Analytics if not already present
        if "G-R2H3DBGJZJ" not in text:
            text = text.replace("</head>", GOOGLE_ANALYTICS + "\n</head>")

        # Replace h1
        old = cfg["h1_old"]
        new = cfg["h1_new"]
        if old in text:
            text = text.replace(old, new)
        elif "h1_old_alt" in cfg and cfg["h1_old_alt"] in text:
            text = text.replace(cfg["h1_old_alt"], new)
        elif new in text:
            print(f"  skip {fname} (already patched)")
            continue
        else:
            print(f"  WARNING: could not find h1 pattern in {fname}")
            continue

        open(path, "w").write(text)
        print(f"  patched {fname}")


LOBSTERS_TITLE_CSS = """\
<style>
.title-subtitle a { color: inherit; text-decoration: none; }
.title-subtitle a:hover { color: var(--accent); }
</style>"""


def patch_lobsters_html():
    """Patch lobsters HTML files: fix home link href and wrap subtitle in link."""
    lob_dir = os.path.join(SITE_DIR, "lobsters")
    patches = {
        "index.html": {
            "h1_old": '<h1><a href="index.html" class="home-link">topindex</a> <span class="title-sep">|</span> <span class="title-subtitle">top lobsters posts</span></h1>',
            "h1_new": '<h1><a href="/" class="home-link">topindex</a> <span class="title-sep">|</span> <span class="title-subtitle"><a href="./">top lobsters posts</a></span></h1>',
        },
        "today.html": {
            "h1_old": '<h1><a href="today.html" class="home-link">topindex</a> <span class="title-sep">|</span> <span class="title-subtitle">top lobsters posts — today</span></h1>',
            "h1_old_alt": '<h1><a href="today.html" class="home-link">topindex</a> <span class="title-sep">|</span> <span class="title-subtitle">top lobsters posts &mdash; today</span></h1>',
            "h1_new": '<h1><a href="/" class="home-link">topindex</a> <span class="title-sep">|</span> <span class="title-subtitle"><a href="./">top lobsters posts</a> — today</span></h1>',
        },
    }

    for fname, cfg in patches.items():
        path = os.path.join(lob_dir, fname)
        if not os.path.exists(path):
            print(f"  skip {fname} (not found)")
            continue

        text = open(path, "r").read()

        # Inject CSS block after </title> if not already present
        if ".title-subtitle a" not in text:
            text = text.replace("</title>", "</title>\n" + LOBSTERS_TITLE_CSS)

        # Inject Google Analytics if not already present
        if "G-R2H3DBGJZJ" not in text:
            text = text.replace("</head>", GOOGLE_ANALYTICS + "\n</head>")

        # Replace h1
        old = cfg["h1_old"]
        new = cfg["h1_new"]
        if old in text:
            text = text.replace(old, new)
        elif "h1_old_alt" in cfg and cfg["h1_old_alt"] in text:
            text = text.replace(cfg["h1_old_alt"], new)
        elif new in text:
            print(f"  skip {fname} (already patched)")
            continue
        else:
            print(f"  WARNING: could not find h1 pattern in {fname}")
            continue

        open(path, "w").write(text)
        print(f"  patched {fname}")


# --- Root Index Generation ---

ROOT_FAVICON = """\
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="6" fill="#ff6600"/>
  <text x="10" y="23" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="20" font-weight="700" fill="#fff">t</text>
  <text x="20" y="23" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="20" font-weight="700" fill="#fff">i</text>
</svg>"""


def generate_index():
    """Generate the root index.html and favicon.svg."""
    # Build site cards HTML
    cards = ""
    for site in SITES:
        cards += f"""
        <a href="{site['key']}/" class="site-card">
            {site['icon_svg']}
            <h3>{site['label']}</h3>
            <p>{site['description']}</p>
        </a>
"""

    index_html = f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script>!function(){{var e=localStorage.getItem('ti_theme');e||(e=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',e)}}()</script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<title>topindex</title>
{GOOGLE_ANALYTICS}
<style>
:root {{
    --bg: #fafafa;
    --bg-card: #ffffff;
    --bg-card-hover: #fff8f0;
    --bg-header: #ffffff;
    --text: #333;
    --text-heading: #2c3e50;
    --text-secondary: #666;
    --text-muted: #888;
    --accent: #ff6600;
    --accent-hover: #e85d00;
    --border: #e0e0e0;
    --border-header: #e0e0e0;
    --bg-btn: #e0e0e0;
    --bg-btn-hover: #d0d0d0;
    --shadow: rgba(0,0,0,0.08);
    --shadow-hover: rgba(0,0,0,0.14);
}}
[data-theme="dark"] {{
    --bg: #1a1a1b;
    --bg-card: #272729;
    --bg-card-hover: #2d2520;
    --bg-header: #272729;
    --text: #d7dadc;
    --text-heading: #f0f0f0;
    --text-secondary: #aaa;
    --text-muted: #818384;
    --accent: #ff7a1a;
    --accent-hover: #ff8833;
    --border: #3a3a3c;
    --border-header: #3a3a3c;
    --bg-btn: #3a3a3a;
    --bg-btn-hover: #4a4a4a;
    --shadow: rgba(0,0,0,0.2);
    --shadow-hover: rgba(0,0,0,0.3);
}}

* {{ margin: 0; padding: 0; box-sizing: border-box; }}

body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--text);
    background: var(--bg);
    line-height: 1.5;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
}}

.site-header {{
    background: var(--bg-header);
    border-bottom: 1px solid var(--border-header);
    padding: 8px 16px;
}}
.site-header-inner {{
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
}}
.site-header h1 {{
    margin: 0;
    font-size: 18px;
    font-weight: 700;
}}
.site-header h1 a {{
    color: var(--text);
    text-decoration: none;
}}
.site-header h1 a:hover {{
    color: var(--accent);
}}
.theme-toggle {{
    background: var(--bg-btn);
    border: none;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    cursor: pointer;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    color: var(--text);
}}
.theme-toggle:hover {{
    background: var(--bg-btn-hover);
    transform: scale(1.1);
}}
.icon-sun, .icon-moon {{ width: 18px; height: 18px; }}
[data-theme="light"] .icon-moon,
[data-theme="dark"] .icon-sun {{ display: none; }}
[data-theme="light"] .icon-sun,
[data-theme="dark"] .icon-moon {{ display: block; }}

main {{
    flex: 1;
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
    padding: 48px 16px;
}}

.hero {{
    text-align: center;
    margin-bottom: 48px;
}}
.hero h2 {{
    font-size: 28px;
    font-weight: 700;
    color: var(--text-heading);
    margin-bottom: 8px;
}}
.hero p {{
    font-size: 15px;
    color: var(--text-secondary);
}}

.sites {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
    max-width: 700px;
    margin: 0 auto;
}}

.site-card {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 32px 24px;
    text-decoration: none;
    color: var(--text);
    transition: all 0.15s ease;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    box-shadow: 0 1px 3px var(--shadow);
}}
.site-card:hover {{
    border-color: var(--accent);
    box-shadow: 0 4px 12px var(--shadow-hover);
    background: var(--bg-card-hover);
    transform: translateY(-2px);
}}
.site-card:visited {{
    color: var(--text);
}}

.site-icon {{
    width: 48px;
    height: 48px;
}}

.site-card h3 {{
    font-size: 18px;
    font-weight: 600;
    color: var(--text-heading);
    margin: 0;
}}
.site-card:hover h3 {{
    color: var(--accent);
}}

.site-card p {{
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
    margin: 0;
}}

.site-footer {{
    text-align: center;
    padding: 16px;
    font-size: 12px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
}}
.site-footer a {{
    color: var(--text-muted);
    text-decoration: none;
}}
.site-footer a:hover {{
    color: var(--accent);
    text-decoration: underline;
}}

@media (max-width: 600px) {{
    .sites {{
        grid-template-columns: 1fr;
        gap: 16px;
    }}
    .hero h2 {{
        font-size: 22px;
    }}
    main {{
        padding: 32px 16px;
    }}
}}
</style>
</head>
<body>

<header class="site-header">
    <div class="site-header-inner">
        <h1><a href="/">topindex</a></h1>
        <button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle dark mode">
            <svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            <svg class="icon-moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
    </div>
</header>

<main>
    <div class="hero">
        <h2>topindex</h2>
        <p>Browse the top posts from your favorite communities</p>
    </div>

    <div class="sites">
{cards}    </div>
</main>

<footer class="site-footer">
    Data from <a href="https://news.ycombinator.com" target="_blank" rel="noopener">Hacker News</a>,
    <a href="https://subranking.com" target="_blank" rel="noopener">subranking.com</a>,
    <a href="https://lobste.rs" target="_blank" rel="noopener">Lobsters</a> &amp;
    <a href="https://pullpush.io" target="_blank" rel="noopener">PullPush API</a>
</footer>

<script>
function toggleTheme() {{
    var t = document.documentElement;
    var c = t.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    t.setAttribute('data-theme', c);
    localStorage.setItem('ti_theme', c);
    // Sync with sub-site themes
    localStorage.setItem('theme', c);
    localStorage.setItem('hn_theme', c);
    localStorage.setItem('lob_theme', c);
}}
</script>
</body>
</html>"""

    # Write index.html
    path = os.path.join(SITE_DIR, "index.html")
    open(path, "w").write(index_html)
    print(f"  wrote index.html")

    # Write favicon.svg
    path = os.path.join(SITE_DIR, "favicon.svg")
    open(path, "w").write(ROOT_FAVICON)
    print(f"  wrote favicon.svg")


# --- Main ---


def main():
    print("=== topindex build ===\n")

    print("[1/5] Syncing sources...")
    sync_sources()

    print("[2/5] Patching reddit HTML...")
    patch_reddit_html()
    print()

    print("[3/5] Patching hackernews HTML...")
    patch_hackernews_html()
    print()

    print("[4/5] Patching lobsters HTML...")
    patch_lobsters_html()
    print()

    print("[5/5] Generating root index...")
    generate_index()
    print()

    print("Done!")


if __name__ == "__main__":
    main()
