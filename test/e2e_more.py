"""5x5 campus board on a small phone, late joiner, and a smoke test of the Supabase code path."""
import sys, time, os, re
from playwright.sync_api import sync_playwright, expect

BASE = 'http://localhost:8787/'
SHOTS = sys.argv[1]
errors = []

def page(ctx, name, q='mock'):
    p = ctx.new_page()
    p.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and errors.append(f'[{name}] {m.text}'))
    p.on('pageerror', lambda e: errors.append(f'[{name}] PAGEERROR {e}'))
    p.goto(f'{BASE}?{q}&profile={name.lower()}')
    return p

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    ctx = b.new_context(viewport={'width': 375, 'height': 667}, device_scale_factor=2, permissions=['camera', 'microphone'])
    h = page(ctx, 'Host')
    h.evaluate('localStorage.clear()'); h.reload()
    h.get_by_label('Your name').fill('Tyson')
    h.get_by_role('button', name='Create a game').click()
    h.locator('.code-big').wait_for()
    code = h.locator('.code-big').inner_text().strip()
    h.get_by_role('radio', name='5×5').click()
    h.get_by_role('radio', name='1h').click()
    h.get_by_role('button', name='+ Add a pack').click()
    h.locator('.pack', has_text='Campus classic').get_by_role('button', name='Add').click()
    time.sleep(0.9)
    h.get_by_role('button', name='Start game').click()
    h.locator('.board').wait_for()
    time.sleep(0.5)
    h.screenshot(path=f'{SHOTS}/m1-5x5-small-phone.png')

    late = ctx.new_page()
    late.on('pageerror', lambda e: errors.append(f'[late] PAGEERROR {e}'))
    late.goto(f'{BASE}?mock&profile=late#/g/{code}')
    late.get_by_label('Your name').fill('Jordan')
    late.get_by_role('button', name='Join game').click()
    late.locator('.banner.pick').wait_for(timeout=8000)
    late.screenshot(path=f'{SHOTS}/m2-late-joiner.png')
    late.locator('.banner.pick').get_by_role('button', name='Blue').click()
    expect(late.locator('.my-team')).to_have_text('Blue', timeout=6000)
    late.locator('.sq').nth(7).click()
    late.screenshot(path=f'{SHOTS}/m3-square-5x5.png')
    print('late join + team pick ok')

    # host ends game early
    h.get_by_role('button', name='Menu').click()
    h.once('dialog', lambda d: d.accept())
    h.get_by_role('button', name='End game now').click()
    h.locator('.recap-hero').wait_for(timeout=8000)
    expect(h.locator('.recap-hero')).to_contain_text('tie')
    print('host end ok (tie with no squares)')

    # Supabase path smoke test: unreachable project must fail gracefully, not crash
    sctx = b.new_context(viewport={'width': 375, 'height': 667})
    sctx.add_init_script("window.__cfg=1")
    sp = sctx.new_page()
    sp.on('pageerror', lambda e: errors.append(f'[supa] PAGEERROR {e}'))
    sp.route('**/config.js*', lambda r: r.fulfill(content_type='text/javascript', body="window.LOCKOUT_CONFIG={supabaseUrl:'https://abcdefgh.supabase.co',supabaseKey:'sb_publishable_test'}"))
    sp.goto(BASE)
    sp.get_by_label('Your name').fill('Tyson')
    sp.get_by_role('button', name='Create a game').click()
    sp.locator('.toast').wait_for(timeout=15000)
    print('supabase path toast:', sp.locator('.toast').inner_text())
    b.close()

print('ERRORS:', len(errors))
for e in errors[:20]: print(e)
