const puppeteer = require('puppeteer');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const TARGET_URL = 'https://www.cnn.com'; // Heavier site

(async () => {
  console.log(`Launch Puppeteer with Extension: ${EXTENSION_PATH}`);
  const browser = await puppeteer.launch({
    headless: false, 
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

  if (!extensionId) {
      console.error("Could not detect extension ID. Exiting.");
      await browser.close();
      return;
  }

  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  console.log(`Opening Options Page: ${optionsUrl}`);
  const optionsPage = await browser.newPage();
  await optionsPage.goto(optionsUrl);

  // 2. Switch to Radar tab
  await optionsPage.evaluate(() => {
      const btn = document.querySelector('button[data-tab="radar"]');
      if (btn) btn.click();
  });
  console.log("Switched to Radar tab.");

  // 3. Open Target Website
  const targetPage = await browser.newPage();
  console.log(`Navigating to ${TARGET_URL}...`);
  await targetPage.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  console.log("Target page loaded. Waiting 5 seconds...");
  await new Promise(r => setTimeout(r, 5000));

  // 4. Check for DOM Elements in Radar
  const result = await optionsPage.evaluate(() => {
      const planets = document.querySelectorAll('.radar-planet');
      const satellites = document.querySelectorAll('.radar-satellite');
      const canvas = document.querySelector('#radar-container canvas');
      
      return {
          planetCount: planets.length,
          satelliteCount: satellites.length,
          hasCanvas: !!canvas,
          canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null
      };
  });

  console.log("--- RADAR RESULTS ---");
  console.log(`Planets (DOM): ${result.planetCount}`);
  console.log(`Satellites (DOM): ${result.satelliteCount}`);
  console.log(`Canvas Present: ${result.hasCanvas}`);
  
  if (result.planetCount > 0) {
      console.log("SUCCESS: Radar rendering elements.");
  } else {
      console.error("FAILURE: No Radar elements found.");
  }

  await browser.close();
})();
