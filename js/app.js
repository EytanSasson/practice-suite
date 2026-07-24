// --- GLOBAL VARIABLES & STATE ---
let practiceSettings = JSON.parse(localStorage.getItem('sasson_practice_settings'));
let dataStore = JSON.parse(localStorage.getItem('sasson_practice_secure_store')) || { clients: [], expenses: [], categories: [], appointments: [] };

if (!dataStore.categories) dataStore.categories = [];
if (!dataStore.expenses) dataStore.expenses = [];
if (!dataStore.appointments) dataStore.appointments = [];

let fpInstances = [];
let globalEffectiveTaxRate = 0;

let activeProfileId = null;
let currentDashboardFilter = 'Active';
let currentDirectoryFilter = 'Active';
let selectedDashboardYear = new Date().getFullYear();
let cachedSessionTime = null;

let editingSessionClientId = null;
let editingSessionIndex = null;

let clientSearchDebounceTimer = null;
let currentViewedNoteText = "";

let currentCalendarViewDate = new Date();
let calendarSelectedDate = toLocalISODateString(new Date());
let cancellingAptId = null;

// Storage & Gateway Globals
const DB_NAME = 'SassonPracticeCRM_Docs';
const STORE_CONTRACTS = 'contracts';
const STORE_RECEIPTS = 'receipts';
const BACKEND_URL = 'https://api.sessionvault.co.uk';
let driveFileId = null;
let driveAutoSyncTimer = null;
let googleAccessToken = null;
const DRIVE_FILE_NAME = 'sasson_practice_suite_backup.json';

// Security Globals
let lastActivityTime = Date.now();
let idleCheckInterval = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const WARNING_TIME_MS = 60 * 1000;

let alertCallback = null;
let confirmCallback = null;
let promptCallback = null;
let deferredPrompt;
let isSyncing = false;

// --- FORMATTING & HELPERS ---
function capitalizeNameInput(input) {
    const cursorStart = input.selectionStart;
    const cursorEnd = input.selectionEnd;
    input.value = input.value.replace(/(^\w|\s\w|-\w|'\w)/g, letter => letter.toUpperCase());
    input.setSelectionRange(cursorStart, cursorEnd);
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g,
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])
    );
}

function toLocalISODateString(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateToUK(dateStr) {
    if (!dateStr || dateStr === 'Not Provided' || dateStr.includes('No sessions')) return dateStr;
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dateStr;
}

function formatTimeBySetting(timeStr) {
    if (!timeStr) return '';
    const is12h = practiceSettings && practiceSettings.timeFormat === '12h';
    if (!is12h) return timeStr;
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    let hours = parseInt(parts[0], 10);
    const minutes = parts[1];
    if (isNaN(hours)) return timeStr;
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
}

function setInputVal(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    try { if (el._flatpickr) el._flatpickr.setDate(val, false); } catch (e) { }
    el.value = val;
}

function initPickers() {
    if (fpInstances.length > 0) {
        fpInstances.forEach(fp => fp.destroy());
        fpInstances = [];
    }
    const is24h = !practiceSettings || practiceSettings.timeFormat !== '12h';
    const dateInputs = document.querySelectorAll('input[type="date"]');
    dateInputs.forEach(el => {
        const fp = flatpickr(el, { altInput: true, altFormat: "d/m/Y", dateFormat: "Y-m-d", disableMobile: true });
        fpInstances.push(fp);
    });
    const timeInputs = document.querySelectorAll('input[type="time"]');
    timeInputs.forEach(el => {
        const fp = flatpickr(el, { enableTime: true, noCalendar: true, altInput: true, altFormat: is24h ? "H:i" : "h:i K", dateFormat: "H:i", time_24hr: is24h, disableMobile: true });
        fpInstances.push(fp);
    });
}

function getReportingPeriodDates(year) {
    const startMonth = practiceSettings ? (parseInt(practiceSettings.reportingPeriodStartMonth) || 4) : 4;
    const startDay = practiceSettings ? (parseInt(practiceSettings.reportingPeriodStartDay) || 6) : 6;
    const pad = n => String(n).padStart(2, '0');
    const startDateStr = `${year}-${pad(startMonth)}-${pad(startDay)}`;

    const startDateObj = new Date(year, startMonth - 1, startDay);
    const endDateObj = new Date(startDateObj);
    endDateObj.setFullYear(startDateObj.getFullYear() + 1);
    endDateObj.setDate(startDateObj.getDate() - 1);

    const endDateStr = `${endDateObj.getFullYear()}-${pad(endDateObj.getMonth() + 1)}-${pad(endDateObj.getDate())}`;
    return { start: startDateStr, end: endDateStr };
}

// --- MODALS & ALERTS ---
function showAlert(title, message, onOk = null) {
    document.getElementById('alert-title').innerText = title;
    document.getElementById('alert-message').innerText = message;
    alertCallback = onOk;
    document.getElementById('custom-alert-modal').classList.add('active');
}
function closeAlert() {
    document.getElementById('custom-alert-modal').classList.remove('active');
    const callback = alertCallback;
    alertCallback = null;
    if (callback) callback();
}

function showConfirm(title, message, onConfirm = null, isDestructive = false) {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-message').innerText = message;
    confirmCallback = onConfirm;
    const btn = document.getElementById('confirm-action-btn');
    if (isDestructive) {
        btn.className = 'btn btn-danger';
        btn.innerText = 'Confirm Action';
    } else {
        btn.className = 'btn';
        btn.innerText = 'Confirm';
    }
    document.getElementById('custom-confirm-modal').classList.add('active');
}
function closeConfirm(confirmed) {
    document.getElementById('custom-confirm-modal').classList.remove('active');
    const callback = confirmCallback;
    confirmCallback = null;
    if (confirmed && callback) callback();
}

function showPrompt(title, message, onPrompt, placeholder = "Input") {
    document.getElementById('prompt-title').innerText = title;
    document.getElementById('prompt-message').innerText = message;
    const input = document.getElementById('prompt-input');
    input.value = '';
    input.placeholder = placeholder;
    promptCallback = onPrompt;
    document.getElementById('custom-prompt-modal').classList.add('active');
    setTimeout(() => input.focus(), 150);
}
function closePrompt(confirmed) {
    document.getElementById('custom-prompt-modal').classList.remove('active');
    const value = document.getElementById('prompt-input').value.trim();
    const callback = promptCallback;
    promptCallback = null;
    if (confirmed && callback) callback(value);
}

// --- NAVIGATION & ONBOARDING ---
function toggleMobileNav() {
    const nav = document.getElementById('nav-container');
    if (nav) nav.classList.toggle('nav-open');
}
function closeMobileNav() {
    const nav = document.getElementById('nav-container');
    if (nav) nav.classList.remove('nav-open');
}

function navigate(viewId, targetClientId = null) {
    document.querySelectorAll('.section-view').forEach(v => v.classList.remove('active-view'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const activeSection = document.getElementById(`view-${viewId}`);
    if (activeSection) activeSection.classList.add('active-view');
    const link = document.getElementById(`link-${viewId}`);
    if (link) link.classList.add('active');
    closeMobileNav();

    const titles = { 'dashboard': 'Dashboard', 'clients': 'Clients', 'expenses': 'Expenses', 'appointments': 'Calendar & Booking', 'config': 'Configuration & Data', 'account': 'Account', 'profile': 'Case File Workspace', 'onboard': 'Client Intake' };
    const titleEl = document.getElementById('view-title');
    if (titleEl) titleEl.innerText = titles[viewId] || 'Workspace';

    if (viewId === 'clients') {
        const searchInput = document.getElementById('client-search-input');
        if (searchInput) searchInput.value = '';
        switchDirectoryTab('Active');
    }
    if (viewId === 'profile' && targetClientId) {
        activeProfileId = targetClientId;
        renderClientProfile();
    }
    if (viewId === 'appointments') renderAppointmentsPage();
}

function switchDashboardTab(status) {
    currentDashboardFilter = status;
    document.getElementById('dash-tab-active').classList.toggle('active', status === 'Active');
    document.getElementById('dash-tab-closed').classList.toggle('active', status === 'Closed');
    calculateAndRender();
}

function switchDirectoryTab(filter) {
    currentDirectoryFilter = filter;
    document.getElementById('dir-tab-all').classList.remove('active');
    document.getElementById('dir-tab-active').classList.remove('active');
    document.getElementById('dir-tab-closed').classList.remove('active');
    if (filter === 'All') document.getElementById('dir-tab-all').classList.add('active');
    else if (filter === 'Active') document.getElementById('dir-tab-active').classList.add('active');
    else if (filter === 'Closed') document.getElementById('dir-tab-closed').classList.add('active');
    calculateAndRender();
}

function showLoginGate(message) {
    document.getElementById('app-root').style.display = 'none';
    document.getElementById('onboarding-overlay').style.display = 'none';
    document.getElementById('passkey-lock-overlay').style.display = 'none';
    const gate = document.getElementById('login-gate-overlay');
    gate.style.display = 'flex';
    const msgEl = document.getElementById('login-gate-message');
    if (msgEl && message) msgEl.textContent = message;
}

function showApp() {
    document.getElementById('login-gate-overlay').style.display = 'none';
    document.getElementById('onboarding-overlay').style.display = 'none';
    document.getElementById('passkey-lock-overlay').style.display = 'none';
    document.getElementById('app-root').style.display = 'flex';
    applySettingsBranding();
    initPickers();
    calculateAndRender();
    resetIdleLogoutTimer();
}

function showCreateProfileForm() {
    document.getElementById('login-gate-overlay').style.display = 'none';
    document.getElementById('app-root').style.display = 'none';
    document.getElementById('passkey-lock-overlay').style.display = 'none';
    document.getElementById('onboarding-overlay').style.display = 'flex';
    const obCountryEl = document.getElementById('ob-country');
    if (obCountryEl) {
        obCountryEl.value = guessCountryByTimezone();
        autoFillLocaleSettings('ob');
    }
}

function completeOnboarding() {
    const country = document.getElementById('ob-country').value || 'UK';
    const name = document.getElementById('ob-practice-name').value.trim();
    const rate = parseFloat(document.getElementById('ob-default-rate').value) || 60;
    const roomCost = parseFloat(document.getElementById('ob-default-office-cost').value) || 10;
    const timeFormat = document.getElementById('ob-time-format').value || '24h';
    const currency = document.getElementById('ob-currency').value || '£';
    const reportingMonth = parseInt(document.getElementById('ob-reporting-month').value) || 4;
    const reportingDay = parseInt(document.getElementById('ob-reporting-day').value) || 6;

    if (!name) return showAlert('Configuration Needed', 'Practice Name is required.');

    practiceSettings = { country: country, practiceName: name, defaultRate: rate, defaultOfficeCost: roomCost, timeFormat: timeFormat, currency: currency, reportingPeriodStartMonth: reportingMonth, reportingPeriodStartDay: reportingDay };
    localStorage.setItem('sasson_practice_settings', JSON.stringify(practiceSettings));

    if (!dataStore.categories || dataStore.categories.length === 0) {
        dataStore.categories = ['Rent', 'Supervision', 'Training & CPD', 'Travel', 'Insurance', 'Membership Fees', 'Other'];
    }
    dataStore.lastModified = Date.now();
    localStorage.setItem('sasson_practice_secure_store', JSON.stringify(dataStore));
    populateCategoryDropdown();

    if (localStorage.getItem('practice_suite_session_id')) saveToGoogleDriveSilently();
    checkPostLoginPasskeySetup();
}

function applySettingsBranding() {
    if (practiceSettings) {
        document.title = practiceSettings.practiceName || "SessionVault";
        const titleEl = document.getElementById('sidebar-practice-title');
        if (titleEl) titleEl.innerText = practiceSettings.practiceName;

        const fields = {
            'set-country': practiceSettings.country || 'UK',
            'set-time-format': practiceSettings.timeFormat || '24h',
            'set-practice-name': practiceSettings.practiceName,
            'set-default-rate': practiceSettings.defaultRate,
            'set-default-office-cost': practiceSettings.defaultOfficeCost,
            'set-currency': practiceSettings.currency || '£',
            'set-reporting-month': practiceSettings.reportingPeriodStartMonth || 4,
            'set-reporting-day': practiceSettings.reportingPeriodStartDay || 6
        };
        for (let id in fields) {
            const el = document.getElementById(id);
            if (el && el !== document.activeElement) el.value = fields[id];
        }
        const graphTitle = document.getElementById('yearly-graph-title');
        if (graphTitle) {
            const dates = getReportingPeriodDates(selectedDashboardYear);
            graphTitle.innerText = `Revenue Breakdown (${dates.start} to ${dates.end})`;
        }
    }
    updatePasskeyStatusUI();
}

async function savePracticeSettings() {
    const name = document.getElementById('set-practice-name').value.trim();
    if (!name) return;

    practiceSettings = {
        country: document.getElementById('set-country').value || 'UK',
        practiceName: name,
        defaultRate: parseFloat(document.getElementById('set-default-rate').value) || 60,
        defaultOfficeCost: parseFloat(document.getElementById('set-default-office-cost').value) || 10,
        timeFormat: document.getElementById('set-time-format').value || '24h',
        currency: document.getElementById('set-currency').value || '£',
        reportingPeriodStartMonth: parseInt(document.getElementById('set-reporting-month').value) || 4,
        reportingPeriodStartDay: parseInt(document.getElementById('set-reporting-day').value) || 6
    };

    localStorage.setItem('sasson_practice_settings', JSON.stringify(practiceSettings));
    dataStore.lastModified = Date.now();
    localStorage.setItem('sasson_practice_secure_store', JSON.stringify(dataStore));

    applySettingsBranding();
    initPickers();
    calculateAndRender();
    setSyncIndicator('Last synced to cloud at..', 'var(--text-muted)');
    if (typeof window.persistToCloud === 'function') window.persistToCloud();
}

function autoFillLocaleSettings(prefix) {
    const country = document.getElementById(`${prefix}-country`).value;
    const timeFormatEl = document.getElementById(`${prefix}-time-format`);
    const currencyEl = document.getElementById(`${prefix}-currency`);

    const localeMap = { 'UK': { time: '24h', curr: '£' }, 'US': { time: '12h', curr: '$' }, 'CA': { time: '12h', curr: 'C$' }, 'AU': { time: '12h', curr: 'A$' }, 'IL': { time: '24h', curr: '₪' }, 'EU': { time: '24h', curr: '€' } };

    if (localeMap[country]) {
        if (timeFormatEl) timeFormatEl.value = localeMap[country].time;
        if (currencyEl) currencyEl.value = localeMap[country].curr;
        if (prefix === 'set') savePracticeSettings();
    }
}

function guessCountryByTimezone() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        if (tz.includes('Toronto') || tz.includes('Vancouver') || tz.includes('Edmonton') || tz.includes('Winnipeg') || tz.includes('Halifax') || tz.includes('Regina')) return 'CA';
        if (tz.startsWith('America/')) return 'US';
        if (tz.startsWith('Australia/')) return 'AU';
        if (tz.includes('Jerusalem') || tz.includes('Tel_Aviv')) return 'IL';
        if (tz.includes('London') || tz.includes('Belfast')) return 'UK';
        if (tz.startsWith('Europe/')) return 'EU';
    } catch (e) { }
    return 'UK';
}

// --- IDLE TIMEOUT ---
function resetIdleLogoutTimer() {
    lastActivityTime = Date.now();
    document.getElementById('timeout-modal').classList.remove('active');
    if (!idleCheckInterval && localStorage.getItem('practice_suite_session_id')) {
        idleCheckInterval = setInterval(checkIdleTime, 1000);
    }
}

async function checkIdleTime() {
    if (!localStorage.getItem('practice_suite_session_id')) return;
    if (document.getElementById('passkey-lock-overlay').style.display === 'flex') return;

    const now = Date.now();
    const idleTime = now - lastActivityTime;

    if (idleTime >= IDLE_TIMEOUT_MS) {
        lockWorkspaceForInactivity();
    } else if (idleTime >= (IDLE_TIMEOUT_MS - WARNING_TIME_MS)) {
        const timeRemaining = Math.ceil((IDLE_TIMEOUT_MS - idleTime) / 1000);
        const modal = document.getElementById('timeout-modal');
        if (!modal.classList.contains('active')) modal.classList.add('active');
        document.getElementById('timeout-countdown').innerText = timeRemaining;
    } else {
        document.getElementById('timeout-modal').classList.remove('active');
    }
}

async function lockWorkspaceForInactivity() {
    document.getElementById('timeout-modal').classList.remove('active');
    lastActivityTime = Date.now();
    sessionStorage.removeItem('sessionvault_unlocked');

    const config = await getLocalPasskeyConfig();
    if (config.enabled && config.credentialId) {
        const overlay = document.getElementById('passkey-lock-overlay');
        if (overlay.style.display === 'flex') return;

        document.getElementById('app-root').style.display = 'none';
        overlay.dataset.mode = 'auth';
        document.getElementById('passkey-modal-title').innerText = "Workspace Locked";
        document.getElementById('passkey-modal-desc').innerText = "Locked for your security. Verify your identity with Touch ID, Face ID, or Windows Hello to continue.";
        document.getElementById('passkey-modal-action-btn').innerText = "Unlock with Passkey";
        document.getElementById('btn-skip-passkey').style.display = 'none';
        document.getElementById('btn-switch-account').style.display = 'block';
        overlay.style.display = 'flex';
    } else {
        clearInterval(idleCheckInterval);
        idleCheckInterval = null;
        await signOutGoogle(false);
    }
}

function stayLoggedIn() { resetIdleLogoutTimer(); }

['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(evt => {
    document.addEventListener(evt, () => {
        if (document.getElementById('passkey-lock-overlay').style.display !== 'flex') resetIdleLogoutTimer();
    }, { passive: true });
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (document.getElementById('passkey-lock-overlay').style.display !== 'flex') {
            checkIdleTime();
            if (document.getElementById('passkey-lock-overlay').style.display !== 'flex') resetIdleLogoutTimer();
        }
        manualSyncAndReload();
    }
});

window.addEventListener('focus', () => { manualSyncAndReload(); });

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) installBtn.style.display = 'flex';
});

function installPWA() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            document.getElementById('install-app-btn').style.display = 'none';
        }
        deferredPrompt = null;
    });
}

// --- AUTO-UPDATE VERSION FROM PACKAGE.JSON ---
async function fetchAndApplyVersion() {
    try {
        const response = await fetch('package.json');
        const data = await response.json();
        const versionEl = document.getElementById('version-label');
        if (versionEl && data.version) {
            versionEl.textContent = `v${data.version}`;
        }
    } catch (error) {
        console.warn('Could not load version from package.json:', error);
    }
}

window.onload = async function () {
    // Call the version fetcher here
    fetchAndApplyVersion();

    if (sessionStorage.getItem('just_logged_out')) {
        sessionStorage.removeItem('just_logged_out');
        showLoginGate('You have securely logged out of your session. Your data remains safe on this device and in Google Drive.');
        return;
    }
    populateCategoryDropdown();
    selectedDashboardYear = new Date().getFullYear();
    const monthEl = document.getElementById('dash-month-val');
    if (monthEl) monthEl.value = new Date().getMonth();

    const sessionId = localStorage.getItem('practice_suite_session_id');
    const savedEmail = localStorage.getItem('practice_suite_google_email');
    if (sessionId) updateGoogleStatus(true, savedEmail); else updateGoogleStatus(false);

    const config = await getLocalPasskeyConfig();
    const isUnlocked = sessionStorage.getItem('sessionvault_unlocked') === 'true';

    if (config.enabled && config.credentialId && !isUnlocked) {
        document.getElementById('app-root').style.display = 'none';
        const overlay = document.getElementById('passkey-lock-overlay');
        overlay.dataset.mode = 'auth';
        document.getElementById('passkey-modal-title').innerText = "Biometric Authentication Required";
        document.getElementById('passkey-modal-desc').innerText = "Verify your identity with Touch ID, Face ID, or your security key to unlock SessionVault.";
        document.getElementById('passkey-modal-action-btn').innerText = "Unlock with Passkey";
        document.getElementById('btn-skip-passkey').style.display = 'none';
        document.getElementById('btn-switch-account').style.display = 'block';
        overlay.style.display = 'flex';
        updatePasskeyStatusUI();
        return;
    }
    attemptSilentReconnect();
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('PWA Service Worker Active'))
        .catch(err => console.error('SW Registration Failed:', err));
}