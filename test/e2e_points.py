"""Points mode (tap-to-set points, bingo bonus, fast bounties) and Rush mode, end to end in demo mode."""
import sys, time, re
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8787/'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else 'shots'
FIX = 'test/fixture.webm'
errors = []

def player(ctx, name, extra=''):
    p = ctx.new_page()
    p.on('pageerror', lambda e: errors.append(f'[{name}] PAGEERROR {e}'))
    p.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and errors.append(f'[{name}] {m.text}'))
    p.goto(f'{BASE}?mock&fastbounty&profile={name.lower()}{extra}')
    return p

def create(p, name):
    p.get_by_label('Your name').fill(name)
    p.get_by_role('button', name='Create a game').click()
    p.locator('.code-big').wait_for()
    return p.locator('.code-big').inner_text().strip()

def join(p, name, code):
    p.get_by_label('Your name').fill(name)
    p.get_by_placeholder('CODE').fill(code)
    p.get_by_role('button', name='Join', exact=True).click()
    p.locator('.lobby-head').wait_for(timeout=8000)

def claim(p, i):
    p.locator('.sq').nth(i).click()
    with p.expect_file_chooser() as fc:
        p.get_by_role('button', name='Upload a video').click()
    fc.value.set_files(FIX)
    btn = p.get_by_role('button', name=re.compile('Lock it in'))
    btn.wait_for(timeout=8000)
    label = btn.inner_text()
    btn.click()
    p.locator('.sheet').wait_for(state='detached', timeout=8000)
    return label

def scores(p):
    return [int(x) for x in p.locator('.score-num').all_inner_texts()]

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)

    # ---------- A: Points + bingo bonus + bounties ----------
    a = player(ctx, 'Alice')
    a.evaluate('localStorage.clear()'); a.reload()
    code = create(a, 'Alice')
    bob = player(ctx, 'Bob'); join(bob, 'Bob', code)
    a.get_by_role('button', name='Join Red').click()
    bob.get_by_role('button', name='Join Blue').click()
    a.get_by_role('radio', name='3×3').click()
    a.get_by_role('radio', name='Points').click()
    a.get_by_role('radio', name='+3').click()
    a.get_by_role('switch', name='Bounties').click()
    a.get_by_role('radio', name='10m').click()
    a.get_by_role('button', name='+ Add a pack').click()
    a.locator('.pack', has_text='Quick test').get_by_role('button', name='Add').click()
    time.sleep(0.8)
    a.get_by_role('radio', name='Set points').click()
    rows = a.locator('.pts-row')
    rows.nth(0).click(); rows.nth(0).click()       # → 3
    rows.nth(1).click()                            # → 2
    for _ in range(4): rows.nth(2).click()         # → 5
    time.sleep(0.8)
    expect(rows.nth(0).locator('.pchip')).to_have_text('3')
    expect(rows.nth(2).locator('.pchip')).to_have_text('5')
    a.locator('.field', has_text='Game mode').scroll_into_view_if_needed()
    a.screenshot(path=f'{SHOTS}/p1-lobby-settings.png')
    a.locator('.pts-list').scroll_into_view_if_needed()
    a.screenshot(path=f'{SHOTS}/p2-lobby-points.png')
    expect(bob.locator('.facts')).to_contain_text('Points')
    expect(bob.locator('.facts')).to_contain_text('Every 10 min')
    bob.screenshot(path=f'{SHOTS}/p3-player-rules.png', full_page=True)

    a.get_by_role('button', name='Start game').click()
    for p in (a, bob): p.locator('.board').wait_for(timeout=8000)
    time.sleep(0.5)
    a.screenshot(path=f'{SHOTS}/p4-points-board.png')

    # first claim: base value
    txt0 = a.locator('.sq').nth(4).locator('.sq-txt').inner_text()
    pts0 = int(a.locator('.sq').nth(4).locator('.sq-pts').inner_text())
    lbl = claim(a, 4)
    print('Alice claim label:', lbl)
    time.sleep(0.8)
    assert scores(bob)[0] == pts0, (scores(bob), pts0)

    # wait for the first bounty (10 fast "minutes" = 10s after start)
    bob.locator('.banner.bounty').wait_for(timeout=20000)
    time.sleep(0.5)
    bob.screenshot(path=f'{SHOTS}/p5-bounty.png')
    bsq = bob.locator('.sq.bounty')
    expect(bsq).to_have_count(1)
    idx = bob.locator('.sq').evaluate_all("els => els.findIndex(e => e.classList.contains('bounty'))")
    base = int(re.search(r'\d+', bob.locator('.sq').nth(idx).locator('.sq-pts').inner_text()).group()) // 2
    before = scores(a)
    lbl = claim(bob, idx)
    print('Bob bounty claim label:', lbl, 'base', base)
    time.sleep(1)
    after = scores(a)
    assert after[1] - before[1] == base * 2, (before, after, base)
    expect(a.locator('.banner.bounty')).to_have_count(0)
    print('bounty doubled ok:', before, '->', after)
    a.get_by_role('button', name='Feed').click(); time.sleep(0.5)
    a.screenshot(path=f'{SHOTS}/p6-feed-points.png')
    a.get_by_role('button', name='Board').click()

    # host ends → recap with points
    a.get_by_role('button', name='Menu').click()
    a.once('dialog', lambda d: d.accept())
    a.get_by_role('button', name='End game now').click()
    a.locator('.recap-hero').wait_for(timeout=8000)
    time.sleep(1.5)
    a.screenshot(path=f'{SHOTS}/p7-recap-points.png', full_page=True)
    print('recap:', a.locator('.recap-hero').inner_text().replace('\n', ' | '))

    # ---------- B: Rush ----------
    c = player(ctx, 'Carol')
    code2 = create(c, 'Carol')
    dan = player(ctx, 'Dan'); join(dan, 'Dan', code2)
    c.get_by_role('button', name='Join Red').click()
    dan.get_by_role('button', name='Join Blue').click()
    c.get_by_role('radio', name='3×3').click()
    c.get_by_role('radio', name='Rush').click()
    c.get_by_role('button', name='+ Add a pack').click()
    c.locator('.pack', has_text='Quick test').get_by_role('button', name='Add').click()
    time.sleep(0.8)
    c.get_by_role('button', name='Start game').click()
    for p in (c, dan): p.locator('.board').wait_for(timeout=8000)
    claim(dan, 0)
    time.sleep(0.8)
    # Carol can still do square 0 (Rush); Dan got first = 2×
    lbl = claim(c, 0)
    print('Carol second claim label:', lbl)
    time.sleep(1)
    s_ = scores(c)
    print('rush scores (red, blue):', s_)
    assert s_ == [1, 2], s_
    # Dan can't claim square 0 again
    dan.locator('.sq').nth(0).click()
    expect(dan.get_by_role('button', name='Upload a video')).to_have_count(0)
    expect(dan.locator('.claim-block')).to_have_count(2)
    dan.screenshot(path=f'{SHOTS}/p8-rush-sheet.png')
    dan.keyboard.press('Escape')
    claim(c, 4)
    time.sleep(0.8)
    c.screenshot(path=f'{SHOTS}/p9-rush-board.png')
    b.close()

print('ERRORS:', len(errors))
for e in errors[:20]: print(e)
