const puppeteer = require('puppeteer');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const TARGET_URL = 'https://en.wikipedia.org/wiki/Internet';

(async () => {
  console.log(`Launch Puppeteer with Extension: ${EXTENSION_PATH}`);
  const browser = await puppeteer.launch({
    headless: false, // Extensions only work in headful mode
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });

  // 1. Find the Extension ID (with retry)
  let extensionId = '';
  for (let i = 0; i < 10; i++) {
      const targets = await browser.targets();
      for (const t of targets) {
        if (t.type() === 'service_worker' || t.type() === 'background_page') {
            const url = t.url();
            if (url.startsWith('chrome-extension://')) {
                extensionId = url.split('/')[2];
                break;
            }
        }
      }
      if (extensionId) break;
      await new Promise(r => setTimeout(r, 500));
  }
  console.log(`Extension ID detected: ${extensionId}`);

  // 2. Open Options Page to start visualization/listeners
  const optionsPage = await browser.newPage();
  // If we didn't find ID, we might need to guess or fail, but usually we find it.
  // Note: Manifest V3 uses service worker, so we might not see a background page target immediately.
  // We can try to open chrome://extensions to find it if needed, but let's assume we got it.
  
  if (!extensionId) {
      console.error("Could not detect extension ID. Exiting.");
      await browser.close();
      return;
  }

  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  console.log(`Opening Options Page: ${optionsUrl}`);
  await optionsPage.goto(optionsUrl);

  // Switch to Solar 4D tab
  await optionsPage.evaluate(() => {
      const btn = document.querySelector('button[data-tab="solar"]');
      if (btn) btn.click();
  });
  console.log("Switched to Solar 4D tab.");

  // 3. Open Target Website in a new tab to generate traffic
  const targetPage = await browser.newPage();
  console.log(`Navigating to ${TARGET_URL}...`);
  await targetPage.goto(TARGET_URL, { waitUntil: 'networkidle2' });
  
  console.log("Target page loaded. Waiting 5 seconds for traffic aggregation...");
  await new Promise(r => setTimeout(r, 5000));

  // 4. Scroll down to trigger more requests (lazy loading)
  await targetPage.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
  });
  await new Promise(r => setTimeout(r, 2000));

  // 5. Extract Universe State from Options Page
  const metrics = await optionsPage.evaluate(async () => {
      return new Promise((resolve) => {
          chrome.storage.local.get('universeState', (result) => {
              const state = result.universeState;
              if (!state) {
                  resolve({ error: "No Universe State found" });
                  return;
              }
              
              const planetCount = state.domains.length;
              let satelliteCount = 0;
              state.domains.forEach(d => {
                  if (d.children) satelliteCount += d.children.length;
              });

              // Check framerate/performance if possible (hacky via requestAnimationFrame loop)
              // For now just return data counts
              resolve({
                  planetCount,
                  satelliteCount,
                  rawState: state
              });
          });
      });
  });

  console.log("--- BASELINE RESULTS ---");
  console.log(`Planets (Tabs/Domains): ${metrics.planetCount}`);
  console.log(`Satellites (Resources): ${metrics.satelliteCount}`);
  
  if (metrics.planetCount > 0) {
      console.log("SUCCESS: Traffic captured and aggregated.");
  } else {
      console.error("FAILURE: No traffic captured.");
  }

  await browser.close();
})();
