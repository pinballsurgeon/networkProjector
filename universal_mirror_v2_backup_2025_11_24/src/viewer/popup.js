document.getElementById('openBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'src/viewer/viewer.html' });
});
