// content-script.js - Part of "The Devourer"

const MSG_CAPTURE_PAYLOAD = 'CAPTURE_PAYLOAD';

function captureContent() {
    // "Weak Learner" v2: Structure Analysis
    if (!document.body) return;

    const textContent = document.body.innerText;
    
    // Calculate "Bloat Score" (Structure Density)
    const scriptCount = document.getElementsByTagName('script').length;
    const iframeCount = document.getElementsByTagName('iframe').length;
    const divCount = document.getElementsByTagName('div').length;
    
    // Heuristic: Yahoo has tons of iframes/scripts vs content
    const bloatScore = (scriptCount * 2 + iframeCount * 5 + divCount * 0.1);

    if (textContent.length > 0) {
        try {
            chrome.runtime.sendMessage({
                type: MSG_CAPTURE_PAYLOAD,
                payload: textContent.substring(0, 5000), // Cap payload
                meta: {
                    bloatScore: bloatScore,
                    isClean: bloatScore < 50 // Threshold for "Google-like" vs "Yahoo-like"
                }
            });
        } catch (e) {
            // Extension context invalidated (updated/reloaded). 
            // Silent fail is expected behavior here.
        }
    }
}

// Observe for significant changes (SPA navigation, dynamic loading)
// For now, we just capture on load and then debounce subsequent checks
window.addEventListener('load', () => {
    captureContent();
    
    // Simple observer for dynamic content
    let timeout;
    const observer = new MutationObserver(() => {
        clearTimeout(timeout);
        timeout = setTimeout(captureContent, 2000);
    });
    
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }
});

console.log("Network Mirror Observer Active.");
