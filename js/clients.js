function renderDirectoryTable() {
    const dirTable = document.getElementById('directory-table');
    if (!dirTable) return;
    dirTable.innerHTML = '';

    const cur = getCurrency();
    const searchInput = document.getElementById('client-search-input');
    const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let shownDirectoryCount = 0;

    [...dataStore.clients].sort((a,b) => a.name.localeCompare(b.name)).forEach(client => {
        if (!client.status) client.status = 'Active';
        if (currentDirectoryFilter !== 'All' && currentDirectoryFilter !== client.status) return;

        const searchMatch = !searchQuery ||
            client.name.toLowerCase().includes(searchQuery) ||
            (client.phone && String(client.phone).toLowerCase().includes(searchQuery));

        if (!searchMatch) return;

        shownDirectoryCount++;
        
        let clientOutstanding = 0;
        const safeRate = Number(client.rate) || 0;
        if (client.sessions) {
            client.sessions.forEach(s => {
                if (s.isPaid === false || s.isPaid === "false") {
                    clientOutstanding += safeRate;
                }
            });
        }
        
        const arrearsDisplay = clientOutstanding > 0 
            ? `<span style="color: var(--danger); font-weight: 600;">${cur}${clientOutstanding.toFixed(2)}</span>` 
            : `<span style="color: var(--text-muted);">-</span>`;

        const dRow = document.createElement('tr');
        dRow.className = 'clickable'; dRow.onclick = () => navigate('profile', client.id);
        dRow.innerHTML = `<td data-label="Client Name"><strong>${escapeHTML(client.name)}</strong></td><td data-label="Start Date">${formatDateToUK(client.startDate)}</td><td data-label="Hourly Rate">${cur}${client.rate.toFixed(2)}</td><td data-label="Phone">${escapeHTML(client.phone)}</td><td data-label="Arrears">${arrearsDisplay}</td><td data-label="Status"><span class="badge ${client.status === 'Active' ? 'badge-active' : 'badge-closed'}">${escapeHTML(client.status)}</span></td>`;
        dirTable.appendChild(dRow);
    });

    const dirEmptyState = document.getElementById('dir-empty-state');
    const dirDataTable = document.getElementById('dir-data-table');
    if (dirEmptyState) dirEmptyState.style.display = shownDirectoryCount === 0 ? 'block' : 'none';
    if (dirDataTable) dirDataTable.style.display = shownDirectoryCount === 0 ? 'none' : 'table';
}

function handleClientSearchInput() {
    clearTimeout(clientSearchDebounceTimer);
    renderDirectoryTable();
}

function openNoteModal(clientId, sessionIndex) {
    const client = dataStore.clients.find(c => c.id === clientId);
    if (!client || !client.sessions[sessionIndex]) return;
    
    currentViewedNoteText = client.sessions[sessionIndex].notes;
    document.getElementById('view-note-content').innerText = currentViewedNoteText;
    
    const summaryBox = document.getElementById('view-note-summary');
    if (summaryBox) { summaryBox.style.display = 'none'; summaryBox.innerHTML = ''; }
    
    const btn = document.getElementById('btn-ai-summarize');
    if (btn) { btn.style.display = 'inline-flex'; btn.disabled = false; }

    document.getElementById('view-note-modal').classList.add('active');
}

function closeNoteModal() { document.getElementById('view-note-modal').classList.remove('active'); }

async function summarizeCurrentNote() {
    if (!currentViewedNoteText) return;
    const summaryBox = document.getElementById('view-note-summary');
    const btn = document.getElementById('btn-ai-summarize');
    let api = ('Summarizer' in self) ? self.Summarizer : (self.ai ? self.ai.summarizer : null);
    
    if (!api) {
        summaryBox.style.display = 'block';
        summaryBox.innerHTML = '<span style="color: var(--warning); font-weight: 600;">On-Device AI is not currently supported on this browser or device. Try Chrome Desktop.</span>';
        return;
    }

    summaryBox.style.display = 'block';
    summaryBox.innerHTML = '<span style="color: #6d28d9;"><em>Securely analyzing notes on-device...</em></span>';
    btn.disabled = true;

    try {
        const options = { type: 'key-points', format: 'plain-text', length: 'medium' };
        let isAvailable = true;
        if (api.availability) {
            const avail = await api.availability(options);
            if (avail === 'no' || avail === 'unavailable') isAvailable = false;
        } else if (api.capabilities) {
            const cap = await api.capabilities();
            if (cap && cap.available === 'no') isAvailable = false;
        }

        if (!isAvailable) throw new Error("The built-in AI model is currently unavailable on this device.");

        const summarizer = await api.create(options);
        const summary = await summarizer.summarize(currentViewedNoteText);
        const formattedSummary = summary.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/^\* (.*)/gm, '<li style="margin-left: 20px;">$1</li>');
        const finalHtml = formattedSummary.includes('<li>') ? `<ul>${formattedSummary}</ul>` : formattedSummary.replace(/\n/g, '<br>');

        summaryBox.innerHTML = `<strong style="color: #5b21b6; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.5px;">On-Device AI Summary:</strong><br><br>${finalHtml}`;
        if (summarizer.destroy) summarizer.destroy();
    } catch (err) {
        summaryBox.innerHTML = `<span style="color: var(--danger); font-weight: 600;">Error: ${err.message}</span>`;
    } finally { btn.disabled = false; }
}

function openEditClientModal() {
    const client = dataStore.clients.find(c => c.id === activeProfileId);
    if (!client) return;
    document.getElementById('edit-name').value = client.name;
    document.getElementById('edit-phone').value = client.phone !== 'Not Provided' ? client.phone : '';
    document.getElementById('edit-email').value = client.email !== 'Not Provided' ? client.email : '';
    setInputVal('edit-dob', client.dob !== 'Not Provided' ? client.dob : '');
    document.getElementById('edit-occupation').value = client.occupation !== 'Not Provided' ? client.occupation : '';
    document.getElementById('edit-rate').value = client.rate;
    setInputVal('edit-start', client.startDate);
    document.getElementById('edit-client-modal').classList.add('active');
}

function closeEditClientModal() { document.getElementById('edit-client-modal').classList.remove('active'); }

function saveClientEdit() {
    const client = dataStore.clients.find(c => c.id === activeProfileId);
    if (!client) return;
    const name = document.getElementById('edit-name').value.trim();
    const phone = document.getElementById('edit-phone').value.trim();
    if (!name) return showAlert('Error', 'Client name is required.');
    if (!phone) return showAlert('Error', 'Phone number is required.');

    const isDuplicate = dataStore.clients.some(c => c.id !== activeProfileId && c.name.toLowerCase() === name.toLowerCase());
    if (isDuplicate) return showAlert('Duplicate Record', 'Another client with this exact name already exists. Please use a unique name or initial.');

    client.name = escapeHTML(name);
    client.phone = escapeHTML(phone);
    client.email = escapeHTML(document.getElementById('edit-email').value.trim() || 'Not Provided');
    client.dob = document.getElementById('edit-dob').value || 'Not Provided';
    client.occupation = escapeHTML(document.getElementById('edit-occupation').value.trim() || 'Not Provided');
    client.rate = parseFloat(document.getElementById('edit-rate').value) || 0;
    client.startDate = document.getElementById('edit-start').value;

    persist(); renderClientProfile(); closeEditClientModal();
    showAlert('Success', 'Client profile updated successfully.');
}

function openEditSessionModal(clientId, index) {
    editingSessionClientId = clientId;
    editingSessionIndex = index;
    const client = dataStore.clients.find(c => c.id === clientId);
    const session = client.sessions[index];

    setInputVal('edit-session-date', session.date);
    setInputVal('edit-session-time', session.time || '');
    document.getElementById('edit-session-location').value = session.location;
    document.getElementById('edit-session-payment').value = session.paymentMethod || 'Bank Transfer';
    const isPaidEl = document.getElementById('edit-session-is-paid');
    if(isPaidEl) isPaidEl.checked = (session.isPaid !== false && session.isPaid !== "false"); 
    document.getElementById('edit-session-notes').value = session.notes;

    document.getElementById('edit-session-modal').classList.add('active');
}

function closeEditSessionModal() {
    document.getElementById('edit-session-modal').classList.remove('active');
    editingSessionClientId = null; editingSessionIndex = null;
}

function saveSessionEdit() {
    const date = document.getElementById('edit-session-date').value;
    const time = document.getElementById('edit-session-time').value;
    const loc = document.getElementById('edit-session-location').value;
    const payment = document.getElementById('edit-session-payment').value;
    const isPaidEl = document.getElementById('edit-session-is-paid');
    const isPaid = isPaidEl ? isPaidEl.checked : false;
    const notes = document.getElementById('edit-session-notes').value.trim();

    if (!notes) return showAlert('Missing Entry', 'Session details cannot be empty.');

    const client = dataStore.clients.find(c => c.id === editingSessionClientId);
    if (client && client.sessions[editingSessionIndex]) {
        const s = client.sessions[editingSessionIndex];
        const oldLoc = s.location;
        const oldDate = s.date;
        const expectedDesc = `Room Hire - ${client.name}`;

        s.date = date;
        s.time = time || null;
        s.location = loc;
        s.paymentMethod = payment;
        s.isPaid = isPaid;
        s.notes = escapeHTML(notes);
        s.roomCost = loc === 'Office' ? (practiceSettings ? Number(practiceSettings.defaultOfficeCost) : 10) : 0;
        
        if (oldLoc === 'Office' && loc === 'Online') {
            const expIndex = dataStore.expenses.findIndex(e => e.category === 'Room Hire' && e.description === expectedDesc && e.date === oldDate);
            if (expIndex !== -1) dataStore.expenses.splice(expIndex, 1);
        } else if (oldLoc === 'Online' && loc === 'Office') {
            if (!dataStore.categories.some(c => c.toLowerCase() === 'room hire')) {
                dataStore.categories.push('Room Hire');
                populateCategoryDropdown();
            }
            dataStore.expenses.push({ id: 'exp_' + Date.now() + Math.random().toString().slice(2,6), date: date, description: expectedDesc, amount: s.roomCost, category: 'Room Hire', hasReceipt: false });
        } else if (oldLoc === 'Office' && loc === 'Office' && oldDate !== date) {
            const exp = dataStore.expenses.find(e => e.category === 'Room Hire' && e.description === expectedDesc && e.date === oldDate);
            if (exp) exp.date = date;
        }

        persist(); renderClientProfile(); closeEditSessionModal();
    }
}

function openOnboarding() {
    try {
        setInputVal('new-start', toLocalISODateString(new Date()));
        const nameEl = document.getElementById('new-name'); if(nameEl) nameEl.value = '';
        const phoneEl = document.getElementById('new-phone'); if(phoneEl) phoneEl.value = '';
        const emailEl = document.getElementById('new-email'); if(emailEl) emailEl.value = '';
        setInputVal('new-dob', '');
        const occEl = document.getElementById('new-occupation'); if(occEl) occEl.value = '';
        const rateEl = document.getElementById('new-rate'); 
        if(rateEl) rateEl.value = (practiceSettings && practiceSettings.defaultRate) ? practiceSettings.defaultRate : 60;
    } catch(e) {}
    navigate('onboard');
}

function saveClientProfile() {
    const name = document.getElementById('new-name').value.trim();
    const phone = document.getElementById('new-phone').value.trim();
    if (!name || !phone) return showAlert('Incomplete', 'Name and Phone number are required.');

    const isDuplicate = dataStore.clients.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (isDuplicate) return showAlert('Duplicate Record', 'A client with this exact name already exists. Please use a unique name or initial.');

    const clientRecord = {
        id: 'c_' + Date.now(), name: escapeHTML(name), phone: escapeHTML(phone), email: escapeHTML(document.getElementById('new-email').value.trim() || 'Not Provided'),
        dob: document.getElementById('new-dob').value || 'Not Provided', occupation: escapeHTML(document.getElementById('new-occupation').value.trim() || 'Not Provided'),
        rate: parseFloat(document.getElementById('new-rate').value) || 60, startDate: document.getElementById('new-start').value,
        status: 'Active', closedReason: '', sessions: []
    };

    dataStore.clients.push(clientRecord); persist(); navigate('profile', clientRecord.id);
}

function toggleCaseStatus() {
    const client = dataStore.clients.find(c => c.id === activeProfileId);
    if (!client) return;
    if (!client.status) client.status = 'Active';

    if (client.status === 'Active') {
        showPrompt("Archive File", `Provide a reason for closing ${escapeHTML(client.name)}'s file:`, function(reason) {
            client.status = 'Closed'; client.closedReason = escapeHTML(reason.trim()) || 'No reason provided';
            const todayStr = toLocalISODateString(new Date());
            const futureApts = (dataStore.appointments || []).filter(a => a.clientId === client.id && a.status === 'Scheduled' && a.date >= todayStr);
            if (futureApts.length > 0) {
                setTimeout(() => {
                    showConfirm("Cancel Future Bookings?", `This client has ${futureApts.length} upcoming scheduled appointment(s). Do you want to cancel them?`, () => {
                        futureApts.forEach(a => a.status = 'Cancelled'); persist(); renderClientProfile();
                    }, true);
                }, 300); 
            } else { persist(); renderClientProfile(); }
        }, "Reason...", "Close File");
    } else {
        client.status = 'Active'; client.closedReason = ''; persist(); renderClientProfile();
    }
}

async function renderContractSection(clientId) {
    const container = document.getElementById('contract-status-container');
    if (!container) return;
    container.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">Loading files...</p>';
    try {
        const contract = await getDocBlob(STORE_CONTRACTS, clientId);
        if (contract) {
            container.innerHTML = `
                <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
                    <span style="font-size: 0.85rem; font-weight: 500; word-break: break-all;">${escapeHTML(contract.fileName)}</span>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="viewDoc('${STORE_CONTRACTS}', '${clientId}')">View</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteDoc('${STORE_CONTRACTS}', '${clientId}')">Delete</button>
                    </div>
                </div>`;
        } else {
            container.innerHTML = `
                <label class="btn btn-secondary btn-sm" style="cursor: pointer; justify-content: center; text-align: center; border-style: dashed;">
                    <input type="file" accept="application/pdf" style="display: none;" onchange="handleDocUpload(event, '${STORE_CONTRACTS}', '${clientId}')">
                    + Upload Signed PDF
                </label>`;
        }
    } catch (err) { container.innerHTML = `<p style="color: var(--danger);">Failed to load.</p>`; }
}

async function handleDocUpload(event, storeName, key) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        await storeDocBlob(storeName, key, file);
        if (storeName === STORE_CONTRACTS) renderContractSection(key); else renderExpenses();
        persist();
    } catch (err) { showAlert('Database Error', 'Could not save document locally: ' + err.message); }
}

async function viewDoc(storeName, key) {
    try {
        const doc = await getDocBlob(storeName, key);
        if (doc && doc.fileBlob) {
            const newWindow = window.open(URL.createObjectURL(doc.fileBlob));
            if (!newWindow) showAlert('Pop-ups Blocked', 'Please permit pop-ups.');
        } else showAlert('Missing', 'File not found in database.');
    } catch (err) { showAlert('Error', err.message); }
}

async function deleteDoc(storeName, key) {
    showConfirm("Delete", "Permanently delete this file?", async function() {
        try {
            await deleteDocBlob(storeName, key);
            if (storeName === STORE_CONTRACTS) renderContractSection(key); else renderExpenses();
            persist();
        } catch (err) { showAlert('Error', err.message); }
    }, true);
}

function renderClientProfile() {
    const client = dataStore.clients.find(c => c.id === activeProfileId);
    if (!client) return;
    const cur = getCurrency();
    if (!client.status) client.status = 'Active';

    document.getElementById('profile-client-name').innerText = client.name;
    document.getElementById('profile-rate').innerText = `${cur}${client.rate.toFixed(2)} / hr`;
    document.getElementById('profile-start').innerText = formatDateToUK(client.startDate);
    document.getElementById('profile-phone').innerText = client.phone || 'Not Provided';
    document.getElementById('profile-email').innerText = client.email || 'Not Provided';
    
    let dobDisplay = formatDateToUK(client.dob);
    if (client.dob && client.dob !== 'Not Provided') {
        const dobDate = new Date(client.dob); const today = new Date();
        let age = today.getFullYear() - dobDate.getFullYear();
        const m = today.getMonth() - dobDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dobDate.getDate())) age--;
        dobDisplay += ` (Age: ${age})`;
    }
    document.getElementById('profile-dob').innerText = dobDisplay;
    document.getElementById('profile-occupation').innerText = client.occupation || 'Not Provided';

    setInputVal('session-date', toLocalISODateString(new Date()));
    document.getElementById('session-notes').value = '';
    document.getElementById('session-payment').value = 'Bank Transfer';
    
    if (cachedSessionTime) { setInputVal('session-time', cachedSessionTime); cachedSessionTime = null; } 
    else { setInputVal('session-time', ''); }

    const badgeContainer = document.getElementById('profile-status-badge-container');
    const actionContainer = document.getElementById('profile-case-action-container');
    
    if (client.status === 'Active') {
        badgeContainer.innerHTML = `<span class="badge badge-active">Active</span>`;
        actionContainer.innerHTML = `<button class="btn btn-danger" style="width:100%; margin-top:8px;" onclick="toggleCaseStatus()">Close Case File</button>`;
        document.getElementById('session-logger-panel').style.display = 'block';
        document.getElementById('closed-case-notice').style.display = 'none';
    } else {
        badgeContainer.innerHTML = `<span class="badge badge-closed">Closed</span>`;
        actionContainer.innerHTML = `<button class="btn btn-charcoal" style="width:100%; margin-top:8px;" onclick="toggleCaseStatus()">Reopen Case File</button>`;
        document.getElementById('session-logger-panel').style.display = 'none';
        document.getElementById('closed-case-notice').style.display = 'block';
        document.getElementById('closed-case-reason-text').innerText = client.closedReason || 'No reason provided';
    }

    let totalGross = 0; let totalDeductions = 0; let clientOutstanding = 0;
    client.sessions.forEach(s => {
        const sessionRate = Number(client.rate) || 0;
        totalGross += sessionRate;
        if (s.isPaid === false || s.isPaid === "false") clientOutstanding += sessionRate;
        if (s.location === 'Office') totalDeductions += (s.roomCost !== undefined ? Number(s.roomCost) : (practiceSettings ? Number(practiceSettings.defaultOfficeCost) : 10));
    });
    
    const sessionCountEl = document.getElementById('profile-session-count');
    if (sessionCountEl) sessionCountEl.innerText = client.sessions.length;
    document.getElementById('profile-net-profit').innerText = `${cur}${(totalGross - totalDeductions).toFixed(2)}`;
    
    const arrearsEl = document.getElementById('profile-outstanding-balance');
    if (arrearsEl) {
        arrearsEl.innerText = `${cur}${clientOutstanding.toFixed(2)}`;
        arrearsEl.style.color = clientOutstanding > 0 ? 'var(--danger)' : 'var(--text-muted)';
    }

    renderContractSection(client.id);

    const upcomingContainer = document.getElementById('client-upcoming-list');
    upcomingContainer.innerHTML = '';
    const todayStr = toLocalISODateString(new Date());
    const clientUpcomingApts = (dataStore.appointments || [])
        .filter(a => a.clientId === client.id && a.date >= todayStr && a.status === 'Scheduled')
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

    if (clientUpcomingApts.length === 0) {
        upcomingContainer.innerHTML = `<p style="font-size:0.9rem; color:var(--text-muted); font-style:italic;">No upcoming scheduled session.</p>`;
    } else {
        const apt = clientUpcomingApts[0];
        const strip = document.createElement('div');
        strip.className = 'appointment-strip';
        strip.innerHTML = `
            <div class="appointment-strip-details">
                <strong style="color: var(--accent);">${formatDateToUK(apt.date)} @ ${formatTimeBySetting(apt.time)}</strong><br>
                <span style="font-size:0.85rem; color: var(--text-muted);">${escapeHTML(apt.location)}</span>
            </div>
            <div class="appointment-strip-actions">
                <button class="btn btn-secondary btn-sm" onclick="completeAppointmentFromCalendar('${apt.id}')">Log</button>
                <button class="btn btn-danger btn-sm" onclick="cancelAppointment('${apt.id}')">Cancel</button>
            </div>
        `;
        upcomingContainer.appendChild(strip);
    }

    const container = document.getElementById('timeline-container');
    container.innerHTML = '';
    if (client.sessions.length === 0) {
        container.innerHTML = `<p style="font-size:0.9rem; color:var(--text-muted); font-style:italic;">No history.</p>`; return;
    }

    const sortedSessions = client.sessions.map((session, index) => ({ session, index }))
        .sort((a, b) => {
            const timeA = a.session.time ? (a.session.time.length === 5 ? a.session.time + ':00' : a.session.time) : '00:00:00';
            const timeB = b.session.time ? (b.session.time.length === 5 ? b.session.time + ':00' : b.session.time) : '00:00:00';
            const dtA = new Date(`${a.session.date}T${timeA}`).getTime();
            const dtB = new Date(`${b.session.date}T${timeB}`).getTime();
            return dtB - dtA; 
        });

    sortedSessions.forEach(item => {
        const session = item.session;
        const actualIndex = item.index;
        const card = document.createElement('div');
        card.className = 'timeline-card';
        const badgeClass = session.location === 'Office' ? 'badge-office' : 'badge-online';
        
        let timeHtml = session.time ? `<span style="font-weight: 600; color: var(--text-main); margin-left: 8px;">@ ${formatTimeBySetting(session.time)}</span>` : '';
        let paymentHtml = session.paymentMethod ? `<span style="font-size: 0.8rem; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">Paid via: ${escapeHTML(session.paymentMethod)}</span>` : '';

        if (session.isPaid === false || session.isPaid === "false") {
            paymentHtml = `<span style="font-size: 0.8rem; background: #fef2f2; color: #991b1b; padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-weight: 600;">UNPAID</span>`;
        }

        let markPaidBtn = (session.isPaid === false || session.isPaid === "false") ? `<button class="btn btn-sm" style="background-color: var(--success); color: white;" onclick="markSessionPaid('${client.id}', ${actualIndex})">Mark Paid</button>` : '';

        card.innerHTML = `
            <div class="timeline-meta">
                <div style="display:flex; align-items:center;">
                    <span style="font-weight:700; color:var(--text-main);">${formatDateToUK(session.date)}</span>
                    ${timeHtml} ${paymentHtml}
                </div>
                <div style="display:flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <span class="badge ${badgeClass}">${escapeHTML(session.location)}</span>
                    ${markPaidBtn}
                    <button class="btn btn-secondary btn-sm" onclick="openEditSessionModal('${client.id}', ${actualIndex})">Edit</button>
                    <button class="btn btn-secondary btn-sm" onclick="printInvoice('${client.id}', ${actualIndex})">Print Invoice</button>
                </div>
            </div>
            <div style="margin-top: 12px;">
                <button class="btn btn-secondary btn-sm" onclick="openNoteModal('${client.id}', ${actualIndex})">Show Session Notes</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function markSessionPaid(clientId, index) {
    const client = dataStore.clients.find(c => c.id === clientId);
    if (client && client.sessions[index]) {
        client.sessions[index].isPaid = true;
        persist(); renderClientProfile();
    }
}

function submitSession() {
    const date = document.getElementById('session-date').value;
    let time = document.getElementById('session-time').value; 
    const location = document.getElementById('session-location').value;
    const paymentMethod = document.getElementById('session-payment').value;
    const isPaidEl = document.getElementById('session-is-paid');
    const isPaid = isPaidEl ? isPaidEl.checked : true;
    const notes = document.getElementById('session-notes').value.trim();

    if (!notes) return showAlert('Missing Entry', 'Session details cannot be empty.');

    const client = dataStore.clients.find(c => c.id === activeProfileId);
    if (client) {
        if (client.status === 'Closed') return showAlert('Archived', 'Cannot add sessions to a closed file.');

        const matchingApt = (dataStore.appointments || []).find(a => a.clientId === activeProfileId && a.date === date && a.status === 'Scheduled');
        if (matchingApt) {
            matchingApt.status = 'Completed';
            if (!time && matchingApt.time) time = matchingApt.time;
        }

        client.sessions.push({ 
            date: date, time: time || null, location: location, paymentMethod: paymentMethod, isPaid: isPaid, notes: escapeHTML(notes),
            invoiceId: Date.now().toString().slice(-6), roomCost: location === 'Office' ? (practiceSettings ? practiceSettings.defaultOfficeCost : 10) : 0
        });
        
        if (location === 'Office') {
            const roomCost = practiceSettings ? practiceSettings.defaultOfficeCost : 10;
            if (!dataStore.categories.some(c => c.toLowerCase() === 'room hire')) {
                dataStore.categories.push('Room Hire'); populateCategoryDropdown();
            }
            dataStore.expenses.push({ id: 'exp_' + Date.now() + Math.random().toString().slice(2,6), date: date, description: `Room Hire - ${client.name}`, amount: roomCost, category: 'Room Hire', hasReceipt: false });
        }
        
        cachedSessionTime = null; persist(); renderClientProfile();
    }
}