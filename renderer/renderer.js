// ── AI Browser — Renderer ────────────────────────────────
const api = window.browser || {
    onTabsUpdated: () => {},
    onNavigated: () => {},
    onLoading: () => {},
    onFaviconUpdated: () => {},
    openPdfDialog: () => {},
    newTab: () => {},
    closeTab: () => {},
    switchTab: () => {},
    navigate: () => {},
    goBack: () => {},
    goForward: () => {},
    reload: () => {}
};

// ── State ────────────────────────────────────────────
let tabs = [];
let activeTabId = null;

// ── DOM References ───────────────────────────────────
const tabsContainer = document.getElementById('tabs-container');
const btnNewTab = document.getElementById('btn-new-tab');
const urlInput = document.getElementById('url-input');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const loadingIndicator = document.getElementById('loading-indicator');

// ── Home Page References ─────────────────────────────
const homePage = document.getElementById('home-page');
const clockEl = document.getElementById('clock');
const greetingEl = document.getElementById('greeting');
const homeUrlInput = document.getElementById('home-url-input');
const homeGoBtn = document.getElementById('home-go-btn');
const backdrop = document.getElementById('backdrop');

// ── Initialization ─────────────────────────────────────
function initHomePage() {
    // Dynamic background
    const randomSeed = Math.floor(Math.random() * 1000);
    backdrop.style.backgroundImage = `url('https://picsum.photos/seed/${randomSeed}/1920/1080?blur=2')`;

    // Clock
    function updateClock() {
        const now = new Date();
        let hours = now.getHours();
        let minutes = now.getMinutes();

        let greeting = 'Good evening';
        if (hours >= 5 && hours < 12) greeting = 'Good morning';
        else if (hours >= 12 && hours < 17) greeting = 'Good afternoon';

        greetingEl.textContent = greeting;

        hours = hours.toString().padStart(2, '0');
        minutes = minutes.toString().padStart(2, '0');
        clockEl.textContent = `${hours}:${minutes}`;
    }

    setInterval(updateClock, 1000);
    updateClock();

    // Search logic
    async function handleHomeSearch() {
        let url = homeUrlInput.value.trim();
        if (!url) return;
        
        homeGoBtn.textContent = '...'; // loading state

        if (!/^https?:\/\//i.test(url)) {
            if (url.includes('.') && !url.includes(' ')) {
                url = 'https://' + url;
            } else {
                const intent = await api.aiSmartNavigate(url);
                if (intent && intent.query) {
                    url = intent.query;
                } else {
                    url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
                }
            }
        }
        
        homeGoBtn.textContent = '→';
        api.navigate(url);
    }

    homeGoBtn.addEventListener('click', handleHomeSearch);
    homeUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleHomeSearch();
    });

    document.querySelectorAll('.shortcut').forEach(card => {
        card.addEventListener('click', () => {
            api.navigate(card.dataset.url);
        });
    });
}
initHomePage();


// ── Tab Management ───────────────────────────────────

function renderTabs(tabList) {
    tabs = tabList;
    // Remove only tab elements, leave #btn-new-tab in place
    tabsContainer.querySelectorAll('.tab').forEach(el => el.remove());

    tabs.forEach((tab) => {
        const el = document.createElement('div');
        el.className = `tab${tab.id === activeTabId ? ' active' : ''}`;
        el.dataset.id = tab.id;

        const logo = document.createElement('img');
        logo.className = 'tab-logo';
        logo.src = 'assets/logo.png';
        logo.alt = '';
        el.appendChild(logo);

        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title || 'New Tab';
        el.appendChild(title);

        const close = document.createElement('button');
        close.className = 'tab-close';
        close.textContent = '✕';
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            api.closeTab(tab.id);
        });
        el.appendChild(close);

        el.addEventListener('click', () => {
            api.switchTab(tab.id);
        });

        tabsContainer.insertBefore(el, btnNewTab);
    });
}

// ── Navigation ───────────────────────────────────────

urlInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        let url = urlInput.value.trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) {
            if (url.includes('.') && !url.includes(' ')) {
                url = 'https://' + url;
            } else {
                loadingIndicator.classList.add('loading');
                const intent = await api.aiSmartNavigate(url);
                if (intent && intent.query) {
                    url = intent.query;
                } else {
                    url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
                }
                loadingIndicator.classList.remove('loading');
            }
        }
        api.navigate(url);
        urlInput.blur();
    }
});

btnBack.addEventListener('click', () => api.goBack());
btnForward.addEventListener('click', () => api.goForward());
btnReload.addEventListener('click', () => api.reload());
btnNewTab.addEventListener('click', () => api.newTab());
document.getElementById('btn-open-pdf').addEventListener('click', () => api.openPdf());

// ── IPC Listeners ────────────────────────────────────

api.onTabsChanged((data) => {
    activeTabId = data.activeTabId;
    renderTabs(data.tabs);
});

api.onNavigated((data) => {
    if (data.url === 'app://newtab' || data.url === '') {
        urlInput.value = '';
        homePage.classList.remove('hidden');
        homeUrlInput.value = '';
        setTimeout(() => homeUrlInput.focus(), 50);
    } else {
        urlInput.value = data.url || '';
        homePage.classList.add('hidden');
    }
});

api.onLoadingStateChanged((data) => {
    if (data.loading) {
        loadingIndicator.classList.add('loading');
    } else {
        loadingIndicator.classList.remove('loading');
        loadingIndicator.style.width = '0';
    }
});

// ── PDF Drag & Drop ──────────────────────────────────
document.addEventListener('dragover', (e) => {
    const files = Array.from(e.dataTransfer.items || []);
    if (files.some(f => f.kind === 'file' && f.type === 'application/pdf')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }
});

document.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    const pdf = files.find(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdf) {
        e.preventDefault();
        api.openPdfFromFile(pdf);
    }
});
