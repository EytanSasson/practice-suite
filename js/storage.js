// --- INDEXED DB & LOCAL STORAGE ---
function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 3);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_CONTRACTS)) db.createObjectStore(STORE_CONTRACTS, { keyPath: 'clientId' });
            if (!db.objectStoreNames.contains(STORE_RECEIPTS)) db.createObjectStore(STORE_RECEIPTS, { keyPath: 'expenseId' });
            if (!db.objectStoreNames.contains('security')) db.createObjectStore('security', { keyPath: 'id' });
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function persist() {
    dataStore.lastModified = Date.now();
    localStorage.setItem('sasson_practice_secure_store', JSON.stringify(dataStore));
    setSyncIndicator('Last synced to cloud at..', 'var(--text-muted)');
    if (typeof window.persistToCloud === 'function') {
        window.persistToCloud();
    }
    calculateAndRender();
}
window.persistToCloud = function() { scheduleAutoDriveSync(); };

async function storeDocBlob(storeName, key, file) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const record = { fileName: file.name, fileType: file.type, fileBlob: file, uploadedAt: toLocalISODateString(new Date()) };
        if (storeName === STORE_CONTRACTS) record.clientId = key; else record.expenseId = key;
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getDocBlob(storeName, key) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function deleteDocBlob(storeName, key) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

// --- CLOUD SYNC LOGIC ---
function updateGoogleStatus(connected, userEmail = null) {
    const el = document.getElementById('google-status');
    const emailEl = document.getElementById('google-user-email');
    const connectBtn = document.getElementById('google-connect-btn');
    if (!el) return;
    if (connected && googleAccessToken) {
        el.textContent = '✅ Connected';
        el.style.color = 'var(--success)';
        if (userEmail) {
            emailEl.textContent = `Associated Account: ${userEmail}`;
            emailEl.style.display = 'block';
            localStorage.setItem('practice_suite_google_email', userEmail);
        } else {
            const savedEmail = localStorage.getItem('practice_suite_google_email');
            if (savedEmail) {
                emailEl.textContent = `Associated Account: ${savedEmail}`;
                emailEl.style.display = 'block';
            } else { emailEl.style.display = 'none'; }
        }
        if (connectBtn) connectBtn.style.display = 'none';
    } else {
        el.textContent = '⚪ Not connected';
        el.style.color = 'var(--text-muted)';
        if (emailEl && !localStorage.getItem('practice_suite_google_email')) emailEl.style.display = 'none';
        if (connectBtn) {
            connectBtn.style.display = 'inline-flex';
            connectBtn.innerText = 'Connect Google Account';
        }
    }
}

function setSyncIndicator(text, color) {
    const el = document.getElementById('google-sync-indicator');
    const globalEl = document.getElementById('global-sync-status');
    if (el) { el.textContent = text; el.style.color = color || 'var(--text-muted)'; }
    if (globalEl) {
        let textHtml = text;
        if (!googleAccessToken && localStorage.getItem('practice_suite_session_id')) {
            textHtml = `${text} &bull; <a href="#" onclick="gateGoogleSignIn(); return false;" style="color: var(--warning); text-decoration: underline; font-weight: 600;">Reconnect</a>`;
        }
        globalEl.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"></path></svg> <span>${textHtml}</span>`;
        globalEl.style.color = color || 'var(--text-muted)';
    }
}

function gateGoogleSignIn() { window.location.href = BACKEND_URL + "/login"; }

async function attemptSilentReconnect() {
    if (document.getElementById('passkey-lock-overlay').style.display === 'flex') return;
    if (window.location.hash.includes('session_id=')) {
        const hashParts = window.location.hash.replace('#', '').split('&');
        for (let part of hashParts) {
            if (part.startsWith('session_id=')) localStorage.setItem('practice_suite_session_id', part.split('=')[1]);
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const sessionId = localStorage.getItem('practice_suite_session_id');
    if (!sessionId) return showLoginGate();

    try {
        const res = await fetch(BACKEND_URL + `/get-token?session_id=${sessionId}`);
        if (res.ok) {
            const data = await res.json();
            if (data.access_token) {
                googleAccessToken = data.access_token;
                proceedPastLogin();
            } else {
                googleAccessToken = null;
                updateGoogleStatus(false);
                setSyncIndicator('⚠ Google Disconnected', 'var(--warning)');
                if (practiceSettings) checkPostLoginPasskeySetup(); else showLoginGate();
            }
        } else if (res.status === 401) {
            localStorage.removeItem('practice_suite_session_id');
            googleAccessToken = null;
            updateGoogleStatus(false);
            showLoginGate('Session expired. Please sign in with Google again.');
        } else {
            setSyncIndicator('⚠ Server Error (Sync Paused)', 'var(--warning)');
            if (practiceSettings) showApp(); else showLoginGate();
        }
    } catch (err) {
        console.warn("Offline or network error", err);
        googleAccessToken = null;
        updateGoogleStatus(false);
        setSyncIndicator('Operating Offline', 'var(--warning)');
        if (practiceSettings) checkPostLoginPasskeySetup(); else showLoginGate();
    }
}

async function refreshAndGetToken() {
    const sessionId = localStorage.getItem('practice_suite_session_id');
    if (!sessionId) return null;
    try {
        const res = await fetch(BACKEND_URL + `/get-token?session_id=${sessionId}`);
        if (res.ok) {
            const data = await res.json();
            return data.access_token || null;
        }
    } catch (e) {}
    return null;
}

async function fetchGoogleUserInfo(token) {
    try {
        const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { 'Authorization': 'Bearer ' + token } });
        if (res.ok) {
            const info = await res.json();
            return info.user ? info.user.emailAddress : null;
        }
    } catch (e) {}
    return null;
}

async function proceedPastLogin() {
    const userEmail = await fetchGoogleUserInfo(googleAccessToken);
    updateGoogleStatus(true, userEmail);
    
    const btn = document.getElementById('manual-sync-btn');
    if (btn) btn.classList.add('spinning');

    await findExistingDriveFile();
    if (driveFileId) {
        try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, { headers: { 'Authorization': 'Bearer ' + googleAccessToken } });
            const parsed = await res.json();
            
            const cloudModified = (parsed.dataStore && parsed.dataStore.lastModified) ? parsed.dataStore.lastModified : 0;
            const localModified = (dataStore && dataStore.lastModified) ? dataStore.lastModified : 0;

            if (!dataStore.clients || dataStore.clients.length === 0 || cloudModified > localModified) {
                await loadDriveDataIntoApp(parsed);
                calculateAndRender();
                const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                setSyncIndicator(`Last synced to cloud at ${timeStr}`, 'var(--success)');
            } else if (localModified > cloudModified) {
                scheduleAutoDriveSync();
            } else {
                const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                setSyncIndicator(`Last synced to cloud at ${timeStr}`, 'var(--success)');
            }
            if (practiceSettings) checkPostLoginPasskeySetup(); else showCreateProfileForm();
        } catch (err) {
            if (practiceSettings) checkPostLoginPasskeySetup(); else showCreateProfileForm();
        }
    } else {
        if (practiceSettings) {
            scheduleAutoDriveSync();
            checkPostLoginPasskeySetup();
        } else showCreateProfileForm();
    }
    if (btn) btn.classList.remove('spinning');
}

async function findExistingDriveFile() {
    if (driveFileId) return; 
    googleAccessToken = await refreshAndGetToken() || googleAccessToken;
    if (!googleAccessToken) return;
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=name%3D'${DRIVE_FILE_NAME}'+and+trashed%3Dfalse&fields=files(id,name)`, { headers: { 'Authorization': 'Bearer ' + googleAccessToken } });
        const data = await res.json();
        if (data.files && data.files.length > 0) driveFileId = data.files[0].id;
    } catch (err) {}
}

async function loadDriveDataIntoApp(parsed) {
    dataStore = parsed.dataStore || parsed;
    if (parsed.practiceSettings) {
        practiceSettings = parsed.practiceSettings;
        localStorage.setItem('sasson_practice_settings', JSON.stringify(practiceSettings));
    } else {
        practiceSettings = null;
        localStorage.removeItem('sasson_practice_settings');
    }
    localStorage.setItem('sasson_practice_secure_store', JSON.stringify(dataStore));
}

function scheduleAutoDriveSync() {
    if (!localStorage.getItem('practice_suite_session_id')) return;
    setSyncIndicator('Auto-syncing to cloud...', 'var(--accent)');
    clearTimeout(driveAutoSyncTimer);
    driveAutoSyncTimer = setTimeout(() => saveToGoogleDriveSilently(), 1500);
}

async function saveToGoogleDriveSilently() {
    const token = await refreshAndGetToken();
    if (token) googleAccessToken = token;
    if (!googleAccessToken) return setSyncIndicator('⚠ Sync paused (Not connected to Google)', 'var(--warning)');

    updateGoogleStatus(true);
    const fileContent = JSON.stringify({ dataStore: dataStore, practiceSettings: practiceSettings }, null, 2);
    try {
        if (!driveFileId) await findExistingDriveFile();
        if (driveFileId) {
            const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
                method: 'PATCH',
                headers: { 'Authorization': 'Bearer ' + googleAccessToken, 'Content-Type': 'application/json' },
                body: fileContent
            });
            if (!res.ok) {
                if (res.status === 401) {
                    googleAccessToken = null;
                    return setSyncIndicator('⚠ Sync paused (Token Expired)', 'var(--warning)');
                }
                throw new Error('Update failed with status ' + res.status);
            }
        } else {
            const boundary = 'sasson_boundary_' + Date.now();
            const metadata = { name: DRIVE_FILE_NAME, mimeType: 'application/json' };
            const multipartBody = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${fileContent}\r\n--${boundary}--`;
            const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + googleAccessToken, 'Content-Type': `multipart/related; boundary=${boundary}` },
                body: multipartBody
            });
            const result = await res.json();
            driveFileId = result.id;
        }
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setSyncIndicator(`Last synced to cloud at ${timeStr}`, 'var(--success)');
    } catch (err) { setSyncIndicator('⚠ Auto-sync failed (Offline?)', 'var(--warning)'); }
}

async function manualSyncAndReload() {
    if (isSyncing) return;
    if (document.getElementById('passkey-lock-overlay').style.display === 'flex') return;
    isSyncing = true;
    
    const btn = document.getElementById('manual-sync-btn');
    if (btn) btn.classList.add('spinning');
    let dataChanged = false;

    if (googleAccessToken && driveFileId) {
        try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, { headers: { 'Authorization': 'Bearer ' + googleAccessToken } });
            if (res.ok) {
                const parsed = await res.json();
                const cloudModified = (parsed.dataStore && parsed.dataStore.lastModified) ? parsed.dataStore.lastModified : 0;
                const localModified = (dataStore && dataStore.lastModified) ? dataStore.lastModified : 0;
                
                if (cloudModified > localModified) {
                    await loadDriveDataIntoApp(parsed);
                    dataChanged = true;
                } else if (localModified > cloudModified) {
                    await saveToGoogleDriveSilently();
                } else {
                    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    setSyncIndicator(`Last synced to cloud at ${timeStr}`, 'var(--success)');
                }
            }
        } catch(e) {}
    } else if (localStorage.getItem('practice_suite_session_id')) {
        await attemptSilentReconnect();
        if (googleAccessToken && driveFileId) {
            if (btn) btn.classList.remove('spinning');
            isSyncing = false;
            return manualSyncAndReload();
        }
    }

    if (btn) btn.classList.remove('spinning');
    isSyncing = false;
    if (dataChanged) window.location.reload();
}

async function signOutGoogle(silent) {
    const sessionId = localStorage.getItem('practice_suite_session_id');
    if (sessionId) {
        try { await fetch(BACKEND_URL + `/logout`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + sessionId } }); } catch(e) {}
    }
    googleAccessToken = null; driveFileId = null;
    localStorage.removeItem('practice_suite_session_id'); localStorage.removeItem('practice_suite_google_email'); sessionStorage.removeItem('sessionvault_unlocked');
    clearInterval(idleCheckInterval); idleCheckInterval = null;
    updateGoogleStatus(false); setSyncIndicator('');
    if (!silent) { sessionStorage.setItem('just_logged_out', 'true'); window.location.reload(); }
}

async function switchAccount() {
    showConfirm("Switch Account", "Signing in with a different account will clear the local data on this device to make room for the new account's data. Ensure your current data is synced to the cloud.", async () => {
        const sessionId = localStorage.getItem('practice_suite_session_id');
        if (sessionId) { try { await fetch(BACKEND_URL + `/logout`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + sessionId } }); } catch(e) {} }
        localStorage.clear(); sessionStorage.clear();
        const dbReq = indexedDB.deleteDatabase(DB_NAME);
        const goToLogin = () => { gateGoogleSignIn(); };
        dbReq.onsuccess = dbReq.onerror = dbReq.onblocked = goToLogin;
        setTimeout(goToLogin, 1000);
    }, true);
}

// --- BIOMETRICS ---
function isWebAuthnSupported() { return window.PublicKeyCredential !== undefined; }

async function getLocalPasskeyConfig() {
    try {
        const db = await getDB();
        return new Promise((resolve) => {
            const tx = db.transaction('security', 'readonly');
            const store = tx.objectStore('security');
            const req = store.get('passkey_config');
            req.onsuccess = (e) => resolve(e.target.result || { enabled: false, credentialId: null });
            req.onerror = () => resolve({ enabled: false, credentialId: null });
        });
    } catch (e) { return { enabled: false, credentialId: null }; }
}

async function setLocalPasskeyConfig(enabled, credentialId) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('security', 'readwrite');
            const store = tx.objectStore('security');
            const req = store.put({ id: 'passkey_config', enabled, credentialId });
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {}
}

async function registerPasskey(isMandatoryPrompt = false) {
    if (!isWebAuthnSupported()) {
        if (!isMandatoryPrompt) showAlert("Not Supported", "Your browser or device does not support WebAuthn Passkeys.");
        return false;
    }
    try {
        const challenge = new Uint8Array(32); window.crypto.getRandomValues(challenge);
        const publicKeyCredentialCreationOptions = {
            challenge: challenge, rp: { name: "SessionVault", id: window.location.hostname },
            user: { id: window.crypto.getRandomValues(new Uint8Array(16)), name: "eyt.sasn@gmail.com", displayName: "SessionVault Admin" },
            pubKeyCredParams: [ { alg: -7, type: "public-key" }, { alg: -257, type: "public-key" } ],
            authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
            timeout: 60000, attestation: "none"
        };
        const credential = await window.navigator.credentials.create({ publicKey: publicKeyCredentialCreationOptions });
        if (!credential) throw new Error("Credential creation returned empty.");
        const credIdB64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
        await setLocalPasskeyConfig(true, credIdB64);
        updatePasskeyStatusUI();
        if (isMandatoryPrompt) { document.getElementById('passkey-lock-overlay').style.display = 'none'; showApp(); } 
        else { showAlert("Success", "Hardware passkey registered successfully! This device is now secured."); }
        return true;
    } catch (err) {
        if (!isMandatoryPrompt) {
            if (err.name === 'NotAllowedError') showAlert("Cancelled", "Biometric registration was canceled or blocked by the environment.");
            else showAlert("Registration Failed", err.message || "Passkey creation failed due to an extension or browser block.");
        } else {
            await setLocalPasskeyConfig(false, null); document.getElementById('passkey-lock-overlay').style.display = 'none'; showApp();
        }
        return false;
    }
}

async function triggerPasskeyAuth() {
    if (!isWebAuthnSupported()) return;
    try {
        const config = await getLocalPasskeyConfig();
        const challenge = new Uint8Array(32); window.crypto.getRandomValues(challenge);
        const publicKeyCredentialRequestOptions = { challenge: challenge, timeout: 60000, userVerification: "required" };
        if (config && config.credentialId) {
            const binary = atob(config.credentialId);
            const rawId = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) rawId[i] = binary.charCodeAt(i);
            publicKeyCredentialRequestOptions.allowCredentials = [{ id: rawId, type: 'public-key' }];
        }
        const assertion = await window.navigator.credentials.get({ publicKey: publicKeyCredentialRequestOptions });
        if (assertion) {
            sessionStorage.setItem('sessionvault_unlocked', 'true');
            document.getElementById('passkey-lock-overlay').style.display = 'none';
            resetIdleLogoutTimer();
            if (!localStorage.getItem('practice_suite_session_id')) {
                if (practiceSettings) showApp(); else showCreateProfileForm();
            } else if (!googleAccessToken) { attemptSilentReconnect(); } 
            else { if (document.getElementById('app-root').style.display === 'none') showApp(); }
        }
    } catch (err) { showAlert("Authentication Failed", "Biometric verification failed or was canceled. Please try again."); }
}

async function handlePasskeyModalAction() {
    const mode = document.getElementById('passkey-lock-overlay').dataset.mode;
    if (mode === 'register') await registerPasskey(true); else await triggerPasskeyAuth();
}

async function togglePasskeySetting(checkbox) {
    if (checkbox.checked) {
        const success = await registerPasskey(false);
        if (!success) { checkbox.checked = false; await setLocalPasskeyConfig(false, null); }
    } else { await setLocalPasskeyConfig(false, null); }
    updatePasskeyStatusUI();
}

async function updatePasskeyStatusUI() {
    const statusEl = document.getElementById('passkey-status-text');
    const checkboxEl = document.getElementById('passkey-toggle-checkbox');
    const config = await getLocalPasskeyConfig();
    if (checkboxEl) checkboxEl.checked = config.enabled;
    if (statusEl) {
        if (config.enabled && config.credentialId) { statusEl.textContent = "✅ Active and securing this browser"; statusEl.style.color = "var(--success)"; }
        else if (config.enabled && !config.credentialId) { statusEl.textContent = "⚠️ Enabled, awaiting biometric registration..."; statusEl.style.color = "var(--warning)"; }
        else { statusEl.textContent = "⚪ Passkey security disabled"; statusEl.style.color = "var(--text-muted)"; }
    }
}

async function checkPostLoginPasskeySetup() {
    const config = await getLocalPasskeyConfig();
    if (config.enabled && config.credentialId) {
        const isUnlocked = sessionStorage.getItem('sessionvault_unlocked') === 'true';
        if (isUnlocked) {
            document.getElementById('onboarding-overlay').style.display = 'none';
            showApp(); return;
        }
        document.getElementById('onboarding-overlay').style.display = 'none'; document.getElementById('app-root').style.display = 'none';
        const overlay = document.getElementById('passkey-lock-overlay');
        overlay.dataset.mode = 'auth';
        document.getElementById('passkey-modal-title').innerText = "Biometric Authentication Required";
        document.getElementById('passkey-modal-desc').innerText = "Verify your identity with Touch ID, Face ID, or your security key to unlock SessionVault.";
        document.getElementById('passkey-modal-action-btn').innerText = "Unlock with Passkey";
        document.getElementById('btn-skip-passkey').style.display = 'none';
        document.getElementById('btn-switch-account').style.display = 'block';
        overlay.style.display = 'flex';
        updatePasskeyStatusUI(); return;
    }
    document.getElementById('onboarding-overlay').style.display = 'none';
    if (!isWebAuthnSupported()) { showApp(); return; }
    const overlay = document.getElementById('passkey-lock-overlay');
    overlay.dataset.mode = 'register';
    document.getElementById('passkey-modal-title').innerText = "Enable Passkey Security?";
    document.getElementById('passkey-modal-desc').innerText = "Protect your patient workspace with your device's biometric scanner (Touch ID, Face ID, or Windows Hello).";
    document.getElementById('passkey-modal-action-btn').innerText = "Enable & Register Passkey";
    document.getElementById('btn-skip-passkey').style.display = 'block';
    document.getElementById('btn-switch-account').style.display = 'none';
    document.getElementById('passkey-lock-overlay').style.display = 'flex';
}

async function skipPasskeyRegistration() {
    document.getElementById('passkey-lock-overlay').style.display = 'none';
    await setLocalPasskeyConfig(false, null);
    updatePasskeyStatusUI(); showApp();
}

// --- EXPORT & IMPORT ---
function exportDatabase() {
    try {
        const dataStr = JSON.stringify(dataStore, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.href = url; dlAnchorElem.download = `practice_backup_${toLocalISODateString(new Date())}.json`;
        document.body.appendChild(dlAnchorElem); dlAnchorElem.click(); document.body.removeChild(dlAnchorElem);
        URL.revokeObjectURL(url);
        showAlert("Success", "CRM Database Backup downloaded successfully.");
    } catch(e) { showAlert("Error", "Failed to download backup: " + e.message); }
}

function importDatabase(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            if (parsed && Array.isArray(parsed.clients)) {
                dataStore = parsed; persist(); 
                showAlert('Import Completed', 'Database loaded successfully.'); navigate('dashboard');
            } else if (parsed && parsed.dataStore && Array.isArray(parsed.dataStore.clients)) {
                dataStore = parsed.dataStore;
                if (parsed.practiceSettings) {
                    practiceSettings = parsed.practiceSettings;
                    localStorage.setItem('sasson_practice_settings', JSON.stringify(practiceSettings));
                }
                persist(); showAlert('Import Completed', 'Database and settings loaded successfully.'); navigate('dashboard');
            } else { showAlert('Error', 'Invalid file format. Could not find client data.'); }
        } catch(err) { showAlert('Error', 'Invalid JSON file.'); }
        event.target.value = ''; 
    };
    reader.readAsText(file);
}

async function exportAllAsZip() {
    try {
        if (typeof JSZip === 'undefined') throw new Error("ZIP library not loaded");
        const zip = new JSZip();
        zip.file("practice_database.json", JSON.stringify(dataStore, null, 2));
        if (practiceSettings) zip.file("practice_settings.json", JSON.stringify(practiceSettings, null, 2));

        const db = await getDB();
        const contractsFolder = zip.folder("Contracts");
        const contractsTx = db.transaction(STORE_CONTRACTS, 'readonly');
        const contractsStore = contractsTx.objectStore(STORE_CONTRACTS);
        const allContracts = await new Promise((resolve) => { const req = contractsStore.getAll(); req.onsuccess = () => resolve(req.result); });
        allContracts.forEach(contract => {
            const client = dataStore.clients.find(c => c.id === contract.clientId);
            const clientName = client ? client.name.replace(/[^a-zA-Z0-9\s-_]/g, '').trim().replace(/\s+/g, '_') : 'UnknownClient';
            contractsFolder.file(`${clientName}_${contract.fileName}`, contract.fileBlob);
        });

        const receiptsFolder = zip.folder("Receipts");
        const receiptsTx = db.transaction(STORE_RECEIPTS, 'readonly');
        const receiptsStore = receiptsTx.objectStore(STORE_RECEIPTS);
        const allReceipts = await new Promise((resolve) => { const req = receiptsStore.getAll(); req.onsuccess = () => resolve(req.result); });
        allReceipts.forEach(receipt => {
            const exp = dataStore.expenses.find(e => e.id === receipt.expenseId);
            const expDate = exp ? exp.date : 'UnknownDate';
            receiptsFolder.file(`${expDate}_${receipt.fileName}`, receipt.fileBlob);
        });

        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const dlAnchorElem = document.createElement('a'); dlAnchorElem.href = url; dlAnchorElem.download = `SessionVault_FullArchive_${toLocalISODateString(new Date())}.zip`;
        document.body.appendChild(dlAnchorElem); dlAnchorElem.click(); document.body.removeChild(dlAnchorElem); URL.revokeObjectURL(url);
    } catch (err) { showAlert("Export Failed", "Could not generate ZIP archive: " + err.message); }
}

async function exportTaxYearArchive() {
    const yearStr = document.getElementById('tax-year-select').value;
    if (!yearStr) return showAlert("Error", "Please select a target reporting period.");
    const year = parseInt(yearStr);
    const period = getReportingPeriodDates(year);
    try {
        if (typeof JSZip === 'undefined') throw new Error("ZIP library not loaded");
        const zip = new JSZip(); const cur = getCurrency();
        let incomeCsv = "Date,Client,Payment Method,Gross Amount\n"; let totalIncome = 0;
        dataStore.clients.forEach(client => {
            client.sessions.forEach(s => {
                if (s.date >= period.start && s.date <= period.end) {
                    incomeCsv += `${s.date},"${client.name}",${s.paymentMethod},${client.rate.toFixed(2)}\n`; totalIncome += client.rate;
                }
            });
        });
        let expenseCsv = "Date,Category,Description,Amount\n"; let totalExpenses = 0;
        dataStore.expenses.forEach(e => {
            if (e.date >= period.start && e.date <= period.end) {
                expenseCsv += `${e.date},"${e.category}","${e.description}",${e.amount.toFixed(2)}\n`; totalExpenses += e.amount;
            }
        });
        const netProfit = totalIncome - totalExpenses;
        let summaryTxt = `TAX YEAR SUMMARY: ${period.start} to ${period.end}\n-------------------------------------------------\nGross Income:     ${cur}${totalIncome.toFixed(2)}\nTotal Expenses:   ${cur}${totalExpenses.toFixed(2)}\nNet Profit:       ${cur}${netProfit.toFixed(2)}\n\nEstimated UK Tax/NI Liability: ${cur}${calculateUKTax(netProfit).toFixed(2)}\n`;
        
        zip.file(`Income_Report_${year}.csv`, incomeCsv); zip.file(`Expenses_Report_${year}.csv`, expenseCsv); zip.file(`Tax_Summary_${year}.txt`, summaryTxt);
        
        const db = await getDB();
        const receiptsTx = db.transaction(STORE_RECEIPTS, 'readonly');
        const receiptsStore = receiptsTx.objectStore(STORE_RECEIPTS);
        const allReceipts = await new Promise((resolve) => { const req = receiptsStore.getAll(); req.onsuccess = () => resolve(req.result); });
        const receiptsFolder = zip.folder("Tax_Year_Receipts");
        allReceipts.forEach(receipt => {
            const exp = dataStore.expenses.find(e => e.id === receipt.expenseId);
            if (exp && exp.date >= period.start && exp.date <= period.end) receiptsFolder.file(`${exp.date}_${receipt.fileName}`, receipt.fileBlob);
        });

        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const dlAnchorElem = document.createElement('a'); dlAnchorElem.href = url; dlAnchorElem.download = `HMRC_TaxArchive_${year}_[${period.start}_to_${period.end}].zip`;
        document.body.appendChild(dlAnchorElem); dlAnchorElem.click(); document.body.removeChild(dlAnchorElem); URL.revokeObjectURL(url);
    } catch (err) { showAlert("Error", "Failed to generate Tax Archive: " + err.message); }
}

function wipeAllData() {
    showConfirm("DANGER: Clear All User Data", "Are you absolutely sure you want to clear all data? This will permanently wipe all local clients, appointments, expenses, documents, and settings. If connected to Google Drive, your cloud backup will also be wiped clean. This cannot be undone!", async () => {
        const btn = document.getElementById('confirm-action-btn');
        if(btn) btn.innerText = "Wiping...";
        if (googleAccessToken && driveFileId) {
            try {
                const emptyContent = JSON.stringify({ dataStore: { clients: [], expenses: [], categories: [], appointments: [] }, practiceSettings: null }, null, 2);
                await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, { method: 'PATCH', headers: { 'Authorization': 'Bearer ' + googleAccessToken, 'Content-Type': 'application/json' }, body: emptyContent });
            } catch (e) {}
        }
        const sessionId = localStorage.getItem('practice_suite_session_id');
        if (sessionId) { try { await fetch(BACKEND_URL + `/logout`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + sessionId } }); } catch(e) {} }
        localStorage.clear(); sessionStorage.clear();
        const dbReq = indexedDB.deleteDatabase(DB_NAME);
        const finishWipe = () => { window.location.href = window.location.pathname; };
        dbReq.onsuccess = finishWipe; dbReq.onerror = finishWipe; dbReq.onblocked = finishWipe;
        setTimeout(finishWipe, 1500);
    }, true );
}