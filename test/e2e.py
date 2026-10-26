"""End-to-end: 4 players on one browser (mock backend), full game with a contest and a win."""
import sys, time, os, re
from playwright.sync_api import sync_playwright, expect

BASE = 'http://localhost:8787/'
SHOTS = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(SHOTS, exist_ok=True)
errors = []

def shot(page, name):
    page.screenshot(path=f'{SHOTS}/{name}.png')

def open_player(ctx, name):
    p = ctx.new_page()
    p.on('console', lambda m: m.type == 'error' and errors.append(f'[{name}] {m.text}'))
    p.on('pageerror', lambda e: errors.append(f'[{name}] PAGEERROR {e}'))
    p.goto(f'{BASE}?mock&profile={name.lower()}')
    return p

def record_clip(page, secs=1.6):
    page.get_by_role('button', name='Record proof').click()
    page.get_by_role('button', name='Start recording').click()
    time.sleep(secs)
    page.get_by_role('button', name='Stop recording').click()
    page.get_by_role('button', name='Lock it in').wait_for()

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, permissions=['camera', 'microphone'], has_touch=True)
    ctx.add_init_script("localStorage.getItem('lockout-mock-db')||0")

    alice = open_player(ctx, 'Alice')
    alice.evaluate("localStorage.clear()")
    alice.reload()
    shot(alice, '01-home')
    alice.get_by_label('Your name').fill('Alice')
    alice.get_by_role('button', name='Create a game').click()
    alice.locator('.code-big').wait_for()
    code = alice.locator('.code-big').inner_text().strip()
    print('code', code)

    others = {}
    for n in ['Bob', 'Carol', 'Dan']:
        p = open_player(ctx, n)
        p.get_by_label('Your name').fill(n)
        p.get_by_placeholder('CODE').fill(code)
        p.get_by_role('button', name='Join', exact=True).click()
        p.locator('.lobby-head').wait_for(timeout=8000)
        others[n] = p
    bob, carol, dan = others['Bob'], others['Carol'], others['Dan']

    # teams: Alice+Bob red, Carol+Dan blue
    for p in (alice, bob):
        p.get_by_role('button', name='Join Red').click()
    for p in (carol, dan):
        p.get_by_role('button', name='Join Blue').click()
    time.sleep(0.6)

    # host config: 3x3, 15s review, quick pack
    alice.get_by_role('radio', name='3×3').click()
    alice.get_by_role('radio', name='15s').click()
    alice.get_by_role('button', name='+ Add a pack').click()
    alice.locator('.pack', has_text='Quick test').get_by_role('button', name='Add').click()
    time.sleep(0.9)
    shot(alice, '02-lobby-host')
    alice.screenshot(path=f'{SHOTS}/02b-lobby-host-full.png', full_page=True)
    shot(bob, '03-lobby-player')
    expect(bob.locator('.facts')).to_contain_text('3×3')

    alice.get_by_role('button', name='Start game').click()
    for p in (alice, bob, carol, dan):
        p.locator('.board').wait_for(timeout=8000)
    shot(alice, '04-board-start')

    # Bob claims square 0 with the in-app recorder
    bob.locator('.sq').nth(0).click()
    shot(bob, '05-square-sheet')
    bob.get_by_role('button', name='Record proof').click()
    bob.get_by_role('button', name='Start recording').click()
    time.sleep(1.2)
    shot(bob, '06-recording')
    time.sleep(0.5)
    bob.get_by_role('button', name='Stop recording').click()
    bob.get_by_role('button', name='Lock it in').wait_for()
    shot(bob, '07-review-clip')
    bob.get_by_role('button', name='Lock it in').click()
    expect(carol.locator('.sq').nth(0)).to_have_class(re.compile('claimed'), timeout=8000)
    time.sleep(1.5)
    shot(carol, '08-carol-sees-claim')

    # Carol contests, Dan votes not legit -> thrown out
    carol.locator('.sq').nth(0).click()
    carol.locator('video.video').wait_for(timeout=8000)
    carol.get_by_role('button', name=re.compile('^Contest')).click()
    carol.get_by_label("What’s wrong with it? (optional)").fill('That was a leaf, not a red thing')
    carol.get_by_role('button', name='Open contest').click()
    carol.locator('.contest-box').wait_for(timeout=6000)
    shot(carol, '09-contest-open')
    carol.keyboard.press('Escape')
    dan.locator('.banner.contest').first.wait_for(timeout=8000)
    shot(dan, '10-dan-vote-banner')
    dan.locator('.banner.contest').first.click()
    dan.get_by_role('button', name='Not legit').click()
    expect(alice.locator('.sq').nth(0)).not_to_have_class(re.compile('claimed'), timeout=10000)
    print('contest resolved: square reopened')
    shot(bob, '11-bob-after-reject')

    # Alice claims the top row (0,1,2): recorder for one, upload for the others
    for i in (0, 1, 2):
        alice.locator('.sq').nth(i).click()
        if i == 0:
            record_clip(alice)
        else:
            with alice.expect_file_chooser() as fc:
                alice.get_by_role('button', name='Upload a video').click()
            fc.value.set_files('test/fixture.webm')
            alice.get_by_role('button', name='Lock it in').wait_for(timeout=8000)
        alice.get_by_role('button', name='Lock it in').click()
        expect(alice.locator('.sq').nth(i)).to_have_class(re.compile('claimed'), timeout=8000)
        time.sleep(0.4)

    carol.locator('.banner.review').wait_for(timeout=10000)
    shot(carol, '12-review-window')
    shot(alice, '13-alice-review')
    carol.get_by_role('button', name='Feed').click()
    time.sleep(0.8)
    shot(carol, '14-feed')
    carol.get_by_role('button', name='Board').click()

    # wait out the 15s review window → recap
    for p in (alice, carol):
        p.locator('.recap-hero').wait_for(timeout=30000)
    time.sleep(1.2)
    expect(carol.locator('.recap-hero')).to_contain_text('Red wins')
    shot(carol, '15-recap')
    carol.screenshot(path=f'{SHOTS}/15b-recap-full.png', full_page=True)
    carol.locator('.clip-card .thumb').first.click()
    carol.locator('.viewer').wait_for()
    time.sleep(1)
    shot(carol, '16-viewer')
    carol.keyboard.press('Escape')

    # rematch
    alice.get_by_role('button', name=re.compile('Rematch')).click()
    alice.locator('.lobby-head').wait_for(timeout=8000)
    bob.locator('.banner.rematch').wait_for(timeout=8000)
    bob.locator('.banner.rematch').click()
    bob.locator('.lobby-head').wait_for(timeout=8000)
    expect(bob.locator('.team-card.mine')).to_contain_text('Bob')
    shot(bob, '17-rematch-lobby')
    print('rematch ok')

    # dark mode glance
    dark = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme='dark')
    dp = dark.new_page()
    dp.goto(f'{BASE}?mock&profile=zed')
    shot(dp, '18-home-dark')
    browser.close()

print('ERRORS:', len(errors))
for e in errors[:30]:
    print(e)
