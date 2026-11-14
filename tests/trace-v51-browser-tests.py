"""Non-mutating headless smoke test for TRACE's deterministic glyph engine.
Uses local assets in-memory, with no account, proof creation, network, or paid API.
"""
from pathlib import Path
import json
import os
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    installed_chromium = '/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None
    browser = p.chromium.launch(
        headless=True,
        executable_path=os.environ.get('CHROMIUM_BIN') or installed_chromium,
        args=['--no-sandbox'],
    )
    try:
        page = browser.new_page(viewport={"width":1100,"height":850})
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        markup = (ROOT / 'tests' / 'glyph-harness.html').read_text()
        scripts = re.findall(r'<script\b[^>]*>([\s\S]*?)</script>', markup)
        html_only = re.sub(r'<script\b[^>]*>.*?</script>', '', markup, flags=re.DOTALL)
        page.set_content(html_only, wait_until='load')
        page.add_script_tag(content=(ROOT / 'trace-glyph-v1.js').read_text())
        for script in scripts:
            if script.strip(): page.add_script_tag(content=script)
        for count in (1,3):
            page.evaluate('(n) => window.makeGlyphs(n)', count)
            result = page.evaluate('() => window.measureFrames(1200)')
            print(f'{count} glyphs: {json.dumps(result)}')
            assert result['frames'] >= 20, f'Animation not advancing for {count} glyphs'
            assert result['p95'] < 80, f'Excessive frame time: {result}'
            assert page.locator('svg').count() == count
        assert not errors, f'Glyph JavaScript exceptions: {errors[:8]}'
    finally:
        browser.close()
