import asyncio, json
from playwright.async_api import async_playwright
JS = r"""
async () => {
  const db = await import('/src/core/db.js');
  const mig = await import('/src/core/migrate.js');
  const bk = await import('/src/core/backup.js');
  const fx = await import('/tests/fixtures.js');
  indexedDB.deleteDatabase('smoke');
  const d = await db.openDB({ name: 'smoke' });
  localStorage.setItem('nutriProAI_v3', JSON.stringify(fx.nutriFixture()));
  localStorage.setItem('gymProAI_v12_fixed', JSON.stringify(fx.gymFixture()));
  const r1 = await mig.runMigrationOnce(localStorage, d);
  const r2 = await mig.runMigrationOnce(localStorage, d);
  const { data, issues } = await db.loadData(d);
  await db.setSecret(d, 'anthropicKey', 'sk-ant-api03-BROWSERSECRET1234');
  const key = await db.getSecret(d, 'anthropicKey');
  const backup = bk.serializeBackup((await db.loadData(d)).data);
  const imp = await bk.importBackupToDB(d, backup);
  const after = await db.loadData(d);
  let atomic = 'n/a';
  try { await d.batch([{store:'foods',type:'clear'},{store:'foods',type:'put',value:{noId:1}}]); atomic='no-throw'; }
  catch (e) { atomic = e.code + ':' + (await d.count('foods')); }
  return { r1: r1.status, r2: r2.status, sessions: data.sessions.length, days: Object.keys(data.foodLog).length,
    weights: data.bodyweight.length, issues, keyOk: key.endsWith('1234'), backupHasKey: backup.includes('BROWSERSECRET'),
    importOk: imp.ok, dupSessions: after.data.sessions.length, snapshots: await d.count('snapshots'),
    legacyKept: !!localStorage.getItem('nutriProAI_v3'), atomic, kind: d.kind, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(timezone_id='Asia/Dubai')
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto('http://127.0.0.1:5179/index.html')
        await pg.wait_for_timeout(800)
        stub = await pg.evaluate("document.getElementById('app').dataset.migration")
        print(json.dumps({'stub_boot': stub, **(await pg.evaluate(JS)), 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
