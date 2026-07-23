function getCurrency() {
    return (practiceSettings && practiceSettings.currency) ? practiceSettings.currency : '£';
}

function calculateUKTax(profit) {
    if (profit <= 0) return 0;
    let personalAllowance = 12570;
    if (profit > 100000) {
        personalAllowance -= (profit - 100000) / 2;
        if (personalAllowance < 0) personalAllowance = 0;
    }
    let taxableIncome = Math.max(0, profit - personalAllowance);
    let incomeTax = 0;
    if (taxableIncome > 0) {
        let basic = Math.min(taxableIncome, 37700);
        incomeTax += basic * 0.20;
        if (taxableIncome > 37700) {
            let higher = Math.min(taxableIncome - 37700, 125140 - 37700);
            incomeTax += higher * 0.40;
            if (taxableIncome > 125140) {
                incomeTax += (taxableIncome - 125140) * 0.45;
            }
        }
    }
    let niClass4 = 0;
    if (profit > 12570) {
        let niBasic = Math.min(profit - 12570, 50270 - 12570);
        niClass4 += niBasic * 0.06;
        if (profit > 50270) {
            niClass4 += (profit - 50270) * 0.02;
        }
    }
    return incomeTax + niClass4;
}

function triggerAddCategoryModal() {
    showPrompt("New Expense Category", "Enter a unique category name for tracking practice overheads (e.g. Rent, Supervision):", function(val) {
        if (!val) return;
        const normalized = val.trim();
        if (dataStore.categories.some(cat => cat.toLowerCase() === normalized.toLowerCase())) {
            return showAlert("Duplicate", `The category "${escapeHTML(normalized)}" already exists.`);
        }
        dataStore.categories.push(normalized);
        persist();
        populateCategoryDropdown(normalized);
    }, "E.g., Travel, Rent");
}

function populateCategoryDropdown(selectValue = "") {
    const dropdown = document.getElementById('exp-category');
    if (!dropdown) return;
    dropdown.innerHTML = '';
    if (dataStore.categories.length === 0) {
        dropdown.innerHTML = '<option value="" disabled selected>-- No Categories --</option>';
        return;
    }
    dataStore.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        if (cat === selectValue) opt.selected = true;
        dropdown.appendChild(opt);
    });
}

function toggleExpRepeatUntil() {
    const repeatVal = document.getElementById('exp-repeat').value;
    const group = document.getElementById('exp-repeat-until-group');
    if (group) group.style.display = repeatVal === 'none' ? 'none' : 'block';
}

function submitExpense() {
    const date = document.getElementById('exp-date').value;
    const desc = document.getElementById('exp-description').value.trim();
    const amount = parseFloat(document.getElementById('exp-amount').value) || 0;
    const category = document.getElementById('exp-category').value;
    const receiptFileInput = document.getElementById('exp-receipt-file');
    
    const repeat = document.getElementById('exp-repeat').value;
    const repeatUntil = document.getElementById('exp-repeat-until').value;

    if (!date || !desc || amount <= 0 || !category) return showAlert('Error', 'Please fill all required fields.');

    let [y, m, d] = date.split('-').map(Number);
    let currentDateObj = new Date(y, m - 1, d);
    let endDateObj = new Date(y, m - 1, d);

    if (repeat !== 'none' && repeatUntil) {
        let [ey, em, ed] = repeatUntil.split('-').map(Number);
        endDateObj = new Date(ey, em - 1, ed);
    }
    
    if (repeat !== 'none' && !repeatUntil) return showAlert('Missing End Date', 'Please provide a repeat until date.');
    if (endDateObj < currentDateObj) return showAlert('Invalid Date', 'End date must be after the start date.');

    let addedCount = 0;
    let firstExpenseId = null;

    while (currentDateObj <= endDateObj) {
        const dateString = toLocalISODateString(currentDateObj);
        const expenseId = 'exp_' + Date.now() + Math.random().toString().slice(2,6);
        if (addedCount === 0) firstExpenseId = expenseId;
        
        dataStore.expenses.push({ 
            id: expenseId, date: dateString, description: escapeHTML(desc), amount: amount, category: escapeHTML(category), hasReceipt: receiptFileInput.files.length > 0 && addedCount === 0 
        });
        addedCount++;
        
        if (repeat === 'weekly') { currentDateObj.setDate(currentDateObj.getDate() + 7); } 
        else if (repeat === 'monthly') {
            const currentDay = currentDateObj.getDate();
            currentDateObj.setMonth(currentDateObj.getMonth() + 1);
            if (currentDateObj.getDate() !== currentDay) { currentDateObj.setDate(0); }
        } else { break; }
    }

    if (receiptFileInput.files.length > 0 && firstExpenseId) {
        storeDocBlob(STORE_RECEIPTS, firstExpenseId, receiptFileInput.files[0]).finally(() => { persist(); clearExpenseForm(); });
    } else { persist(); clearExpenseForm(); }
}

function clearExpenseForm() {
    setInputVal('exp-date', toLocalISODateString(new Date()));
    document.getElementById('exp-description').value = '';
    document.getElementById('exp-amount').value = '';
    setInputVal('exp-repeat-until', '');
    document.getElementById('exp-repeat').value = 'none';
    toggleExpRepeatUntil();
    const fileInput = document.getElementById('exp-receipt-file');
    if (fileInput) fileInput.value = '';
    renderExpenses();
}

function clearExpenseFilters() {
    setInputVal('exp-filter-start', '');
    setInputVal('exp-filter-end', '');
    renderExpenses();
}

function getFilteredExpenses() {
    const start = document.getElementById('exp-filter-start').value;
    const end = document.getElementById('exp-filter-end').value;
    return dataStore.expenses.filter(e => (!start || e.date >= start) && (!end || e.date <= end));
}

async function renderExpenses() {
    const list = document.getElementById('expense-table-body');
    const emptyState = document.getElementById('expense-empty-state');
    const cur = getCurrency();
    if (!list) return;
    list.innerHTML = '';
    const filtered = getFilteredExpenses();
    
    if (filtered.length === 0) { emptyState.style.display = 'block'; return; } else emptyState.style.display = 'none';

    [...filtered].sort((a,b) => b.date.localeCompare(a.date)).forEach(exp => {
        const tr = document.createElement('tr');
        const receiptUi = exp.hasReceipt ? `<button class="btn btn-secondary btn-sm" onclick="viewDoc('${STORE_RECEIPTS}', '${exp.id}')">View</button>` : 'None';
        tr.innerHTML = `
            <td data-label="Date"><strong>${formatDateToUK(exp.date)}</strong></td>
            <td data-label="Description">${escapeHTML(exp.description)}</td>
            <td data-label="Category"><span class="badge badge-closed">${escapeHTML(exp.category)}</span></td>
            <td data-label="Amount" style="color: var(--danger); font-weight: 600;">-${cur}${exp.amount.toFixed(2)}</td>
            <td data-label="Receipt">${receiptUi}</td>
            <td data-label="Action"><button class="btn btn-danger btn-sm" onclick="deleteExpense('${exp.id}')">Del</button></td>
        `;
        list.appendChild(tr);
    });
}

function deleteExpense(id) {
    showConfirm("Delete", "Delete this expense permanently?", () => {
        dataStore.expenses = dataStore.expenses.filter(e => e.id !== id);
        deleteDocBlob(STORE_RECEIPTS, id).finally(persist);
    }, true);
}

function printExpenseReport() { window.print(); }

function printInvoice(clientId, sessionIndex) {
    const client = dataStore.clients.find(c => c.id === clientId);
    const session = client.sessions[sessionIndex];
    const cur = getCurrency();
    const originalTitle = document.title;
    const sanitizedName = client.name.replace(/[^a-zA-Z0-9\s-_]/g, '').trim().replace(/\s+/g, '_');
    document.title = `${sanitizedName}_INV-${session.invoiceId}`;

    let paymentLine = session.paymentMethod ? `<p style="margin: 4px 0 0 0; font-size: 0.85rem; color: #475569;">Payment Method: ${escapeHTML(session.paymentMethod)}</p>` : '';

    const printContainer = document.getElementById('print-isolated-target');
    printContainer.innerHTML = `
        <div style="font-family: 'Inter', sans-serif; padding: 24px; color: #000; background: #fff; max-width: 680px; margin: 0 auto; box-sizing: border-box; page-break-inside: avoid;">
            <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px;">
                <div><h1 style="margin: 0; font-size: 1.6rem; font-weight:700; color: #0f172a;">SessionVault</h1><p style="color: #475569; font-size: 0.9rem; margin-top: 4px;">Professional Therapy Services</p></div>
                <div style="text-align: right;"><h3 style="margin: 0; font-size: 1.05rem; color: #0f172a;">INVOICE: #INV-${session.invoiceId}</h3><p style="margin: 4px 0 0 0; font-size: 0.85rem; color: #475569;">Date: ${formatDateToUK(session.date)}</p>${paymentLine}</div>
            </div>
            <div style="margin-bottom: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div>
                    <h4 style="margin: 0 0 4px 0; font-size: 0.75rem; text-transform: uppercase; color: #64748b; font-weight: 600;">Billed To:</h4>
                    <p style="font-size: 1rem; font-weight: 600; margin: 0; color: #0f172a;">${escapeHTML(client.name)}</p>
                    ${client.email && client.email !== 'Not Provided' ? `<p style="margin: 4px 0 0 0; font-size: 0.85rem; color: #475569;">${escapeHTML(client.email)}</p>` : ''}
                </div>
                <div style="text-align: right;">
                    <h4 style="margin: 0 0 4px 0; font-size: 0.75rem; text-transform: uppercase; color: #64748b; font-weight: 600;">Status:</h4>
                    ${(session.isPaid === false || session.isPaid === "false") ? 
                        '<span style="background-color: #fef2f2; color: #991b1b; padding: 4px 10px; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; display: inline-block; text-transform: uppercase;">Unpaid</span>' : 
                        '<span style="background-color: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; display: inline-block; text-transform: uppercase;">Paid in Full</span>'
                    }
                </div>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                <thead><tr><th style="border-bottom: 2px solid #cbd5e1; padding: 12px 0; text-align: left; color: #0f172a; font-weight:700; font-size: 0.85rem;">Description of Service</th><th style="border-bottom: 2px solid #cbd5e1; padding: 12px 0; text-align: right; color: #0f172a; font-weight:700; font-size: 0.85rem;">Amount</th></tr></thead>
                <tbody><tr><td style="padding: 14px 0; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 0.9rem;">Professional Therapeutic Consultation</td><td style="padding: 14px 0; border-bottom: 1px solid #e2e8f0; text-align: right; color: #0f172a; font-weight: 600; font-size: 0.9rem;">${cur}${client.rate.toFixed(2)}</td></tr></tbody>
            </table>
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <div style="width: 260px; border-top: 2px solid #0f172a; padding-top: 12px;">
                    <div style="display: flex; justify-content: space-between; font-size: 1.15rem; font-weight: 700; color: #0f172a;"><span>Total Paid:</span><span>${cur}${client.rate.toFixed(2)}</span></div>
                </div>
            </div>
        </div>
    `;
    window.print();
    setTimeout(() => { printContainer.innerHTML = ''; document.title = originalTitle; }, 500);
}

function drawYearlyGraph(monthlyRevenue) {
    const container = document.getElementById('yearly-chart-box');
    if (!container) return; 
    const cur = getCurrency();
    container.innerHTML = '';
    
    const maxVal = Math.max(...monthlyRevenue, 100); 
    const minVal = Math.min(...monthlyRevenue, 0); 
    const range = maxVal - minVal;
    
    let svgContent = `<svg viewBox="0 0 800 240" class="chart-container" style="display: block;">`;
    
    for (let i = 0; i <= 4; i++) {
        const value = maxVal - (i * (range / 4));
        const y = 30 + ((maxVal - value) / range) * 160;
        svgContent += `<line x1="50" y1="${y}" x2="780" y2="${y}" stroke="var(--border)" stroke-dasharray="4,4" /><text x="10" y="${y + 4}" font-size="11" fill="var(--text-muted)">${cur}${value.toFixed(0)}</text>`;
    }
    
    const zeroY = 30 + ((maxVal - 0) / range) * 160;
    if (minVal < 0) svgContent += `<line x1="50" y1="${zeroY}" x2="780" y2="${zeroY}" stroke="var(--charcoal)" stroke-width="1.5" />`;

    const reportingStartMonth = practiceSettings ? (parseInt(practiceSettings.reportingPeriodStartMonth) || 4) : 4;
    const allMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    monthlyRevenue.forEach((revenue, idx) => {
        const x = 65 + idx * 60; 
        if (revenue >= 0) {
            const barHeight = (revenue / range) * 160;
            const y = zeroY - barHeight;
            svgContent += `<rect class="chart-bar" x="${x}" y="${y}" width="40" height="${Math.max(barHeight, 2)}" fill="var(--accent)" rx="2" />`;
        } else {
            const barHeight = (Math.abs(revenue) / range) * 160;
            const y = zeroY;
            svgContent += `<rect class="chart-bar" x="${x}" y="${y}" width="40" height="${barHeight}" fill="var(--danger)" rx="2" />`;
        }
        const monthIndex = (reportingStartMonth - 1 + idx) % 12;
        svgContent += `<text x="${x + 8}" y="215" font-size="11" fill="var(--text-muted)">${allMonths[monthIndex]}</text>`;
    });
    
    svgContent += `</svg>`;
    container.innerHTML = svgContent;
}

function populateYearSelector() {
    const select = document.getElementById('dash-year-select');
    const monthYearSelect = document.getElementById('dash-month-year-val');
    const years = new Set(); years.add(new Date().getFullYear());
    dataStore.clients.forEach(c => {
        if (c.startDate) years.add(new Date(c.startDate).getFullYear());
        c.sessions.forEach(s => { if (s.date) years.add(new Date(s.date).getFullYear()); });
    });
    if (dataStore.expenses) dataStore.expenses.forEach(e => { if (e.date) years.add(new Date(e.date).getFullYear()); });
    
    const sortedYears = Array.from(years).sort((a, b) => b - a);
    
    if (select) {
        select.innerHTML = '';
        sortedYears.forEach(yr => {
            const opt = document.createElement('option'); opt.value = yr; opt.innerText = yr;
            if (yr === selectedDashboardYear) opt.selected = true;
            select.appendChild(opt);
        });
    }
    if (monthYearSelect) {
        const currentVal = parseInt(monthYearSelect.value) || new Date().getFullYear();
        monthYearSelect.innerHTML = '';
        sortedYears.forEach(yr => {
            const opt = document.createElement('option'); opt.value = yr; opt.innerText = yr;
            if (yr === currentVal) opt.selected = true;
            monthYearSelect.appendChild(opt);
        });
    }
    const taxSelect = document.getElementById('tax-year-select');
    if (taxSelect) {
        taxSelect.innerHTML = '';
        sortedYears.forEach(yr => {
            const period = getReportingPeriodDates(yr);
            const opt = document.createElement('option'); opt.value = yr; opt.innerText = `Year starting ${formatDateToUK(period.start)}`;
            taxSelect.appendChild(opt);
        });
    }
}

function calculateMonthly() {
    const monthEl = document.getElementById('dash-month-val');
    const yearEl = document.getElementById('dash-month-year-val');
    const cur = getCurrency();
    if (!monthEl || !yearEl) return;

    const targetMonth = parseInt(monthEl.value);
    const targetYear = parseInt(yearEl.value) || new Date().getFullYear();

    let monthlyGross = 0; let monthlyRoomCost = 0; let monthlySessionsCount = 0;

    dataStore.clients.forEach(client => {
        client.sessions.forEach(s => {
            if (!s.date) return;
            const d = new Date(s.date);
            if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
                monthlyGross += client.rate;
                monthlySessionsCount++;
                const sessionRoomCost = s.location === 'Office' ? (s.roomCost !== undefined ? s.roomCost : (practiceSettings ? practiceSettings.defaultOfficeCost : 10)) : 0;
                monthlyRoomCost += sessionRoomCost;
            }
        });
    });

    let monthlyGeneralExpenses = 0;
    dataStore.expenses.forEach(e => {
        if (!e.date) return;
        const d = new Date(e.date);
        if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
            monthlyGeneralExpenses += e.amount;
        }
    });

    const monthlyTotalOverhead = monthlyGeneralExpenses; 
    const monthlyNet = monthlyGross - monthlyTotalOverhead;
    const monthlyTaxProvision = monthlyNet > 0 ? (monthlyNet * globalEffectiveTaxRate) : 0;

    const dashGrossEl = document.getElementById('dash-monthly-gross');
    const dashNetEl = document.getElementById('dash-monthly-net');
    const dashTaxEl = document.getElementById('dash-monthly-tax');
    const dashSessionsEl = document.getElementById('dash-monthly-sessions');
    if (dashGrossEl) dashGrossEl.innerText = `${cur}${monthlyGross.toFixed(2)}`;
    if (dashNetEl) dashNetEl.innerText = `${cur}${monthlyNet.toFixed(2)}`;
    if (dashTaxEl) dashTaxEl.innerText = `${cur}${monthlyTaxProvision.toFixed(2)}`;
    if (dashSessionsEl) dashSessionsEl.innerText = monthlySessionsCount;
}

function changeDashboardYear(year) {
    selectedDashboardYear = parseInt(year) || new Date().getFullYear();
    applySettingsBranding(); calculateAndRender();
}

function calculateAndRender() {
    const dashTable = document.getElementById('dashboard-table');
    const cur = getCurrency();
    if (dashTable) dashTable.innerHTML = '';

    let grandTotalGross = 0; let activeCount = 0; let grandTotalOutstanding = 0;
    const reportPeriod = getReportingPeriodDates(selectedDashboardYear);
    
    const periodDisplay = document.getElementById('dash-period-display');
    if (periodDisplay) periodDisplay.innerText = `${formatDateToUK(reportPeriod.start)} to ${formatDateToUK(reportPeriod.end)}`;

    const isWithinRange = (ds) => ds >= reportPeriod.start && ds <= reportPeriod.end;
    const monthlyBuckets = Array(12).fill(0);
    const sObj = new Date(reportPeriod.start);
    const baseYear = sObj.getFullYear(); const baseMonth = sObj.getMonth();

    let paymentBreakdown = {}; 

    const getBucketIndex = (ds) => {
        const d = new Date(ds);
        const totalMonths = (d.getFullYear() - baseYear) * 12 + (d.getMonth() - baseMonth);
        return (totalMonths >= 0 && totalMonths < 12) ? totalMonths : -1;
    };

    let shownDashboardCount = 0;

    [...dataStore.clients].sort((a,b) => a.name.localeCompare(b.name)).forEach(client => {
        if (!client.status) client.status = 'Active';
        const yearSessions = client.sessions.filter(s => isWithinRange(s.date));
        let gross = yearSessions.length * client.rate;
        let clientRoomCost = 0;
        let clientOutstanding = 0;
        const safeRate = Number(client.rate) || 0;
        
        client.sessions.forEach(s => {
            // Fortified check
            if (s.isPaid === false || s.isPaid === "false") clientOutstanding += safeRate;

            if (isWithinRange(s.date)) {
                const sessionRoomCost = s.location === 'Office' ? (s.roomCost !== undefined ? Number(s.roomCost) : (practiceSettings ? Number(practiceSettings.defaultOfficeCost) : 10)) : 0;
                clientRoomCost += sessionRoomCost;
                const bucketIdx = getBucketIndex(s.date);
                if (bucketIdx !== -1) monthlyBuckets[bucketIdx] += (client.rate - sessionRoomCost);
                
                // Exclude unpaid sessions from breakdown
                if (s.isPaid !== false && s.isPaid !== "false") {
                    let pm = s.paymentMethod || 'Bank Transfer';
                    paymentBreakdown[pm] = (paymentBreakdown[pm] || 0) + client.rate;
                }
            }
        });

        grandTotalOutstanding += clientOutstanding;
        grandTotalGross += gross;
        if (client.status === 'Active') activeCount++;
        let lastSessionDate = client.sessions.length > 0 ? client.sessions[client.sessions.length - 1].date : 'No sessions';

        if (client.status === currentDashboardFilter && dashTable) {
            shownDashboardCount++;
            const row = document.createElement('tr');
            row.className = 'clickable'; row.onclick = () => navigate('profile', client.id);
            row.innerHTML = `<td data-label="Client Name"><strong>${escapeHTML(client.name)}</strong></td><td data-label="Start Date">${formatDateToUK(client.startDate)}</td><td data-label="Rate / Hr">${cur}${client.rate.toFixed(2)}</td><td data-label="Last Session">${formatDateToUK(lastSessionDate)}</td><td data-label="Arrears" style="color:${clientOutstanding > 0 ? 'var(--danger)' : 'var(--text-muted)'}; font-weight:600;">${clientOutstanding > 0 ? cur + clientOutstanding.toFixed(2) : '-'}</td><td data-label="Net Yield" style="color:var(--success); font-weight:600;">${cur}${(gross - clientRoomCost).toFixed(2)}</td>`;
            dashTable.appendChild(row);
        }
    });

    if (document.getElementById('dash-empty-state')) document.getElementById('dash-empty-state').style.display = shownDashboardCount === 0 ? 'block' : 'none';
    if (document.getElementById('dash-data-table')) document.getElementById('dash-data-table').style.display = shownDashboardCount === 0 ? 'none' : 'table';

    renderDirectoryTable();

    const totalExpenses = (dataStore.expenses || []).filter(e => isWithinRange(e.date)).reduce((s, e) => s + e.amount, 0);

    dataStore.expenses.forEach(e => {
        if (isWithinRange(e.date)) {
            const bucketIdx = getBucketIndex(e.date);
            if (bucketIdx !== -1) monthlyBuckets[bucketIdx] -= e.amount;
        }
    });

    const totalNet = grandTotalGross - totalExpenses;
    const estimatedTax = calculateUKTax(totalNet);
    globalEffectiveTaxRate = totalNet > 0 ? (estimatedTax / totalNet) : 0;
    const effectiveRateDisplay = (globalEffectiveTaxRate * 100).toFixed(1);

    if (document.getElementById('dash-total-outstanding')) document.getElementById('dash-total-outstanding').innerText = `${cur}${grandTotalOutstanding.toFixed(2)}`;
    if (document.getElementById('dash-active-count')) document.getElementById('dash-active-count').innerText = activeCount;
    if (document.getElementById('dash-total-gross')) document.getElementById('dash-total-gross').innerText = `${cur}${grandTotalGross.toFixed(2)}`;
    if (document.getElementById('dash-total-overhead')) document.getElementById('dash-total-overhead').innerText = `${cur}${totalExpenses.toFixed(2)}`;
    if (document.getElementById('dash-total-tax')) document.getElementById('dash-total-tax').innerText = `${cur}${estimatedTax.toFixed(2)}`;
    if (document.getElementById('dash-tax-rate')) document.getElementById('dash-tax-rate').innerText = `${effectiveRateDisplay}% effective rate`;
    if (document.getElementById('dash-total-net')) document.getElementById('dash-total-net').innerText = `${cur}${(totalNet - estimatedTax).toFixed(2)}`;

    const pmContainer = document.getElementById('payment-method-breakdown');
    if (pmContainer) {
        pmContainer.innerHTML = '';
        const sortedMethods = Object.entries(paymentBreakdown).sort((a,b) => b[1] - a[1]);
        if (sortedMethods.length === 0) {
            pmContainer.innerHTML = `<p style="font-size: 0.9rem; color: var(--text-muted); font-style: italic; padding: 12px 0;">No income recorded in this period.</p>`;
        } else {
            sortedMethods.forEach(([method, amount]) => {
                pmContainer.innerHTML += `<div class="panel metric-card" style="padding: 16px; margin-bottom: 0;"><h4>${escapeHTML(method)}</h4><p style="font-size: 1.4rem; color: var(--text-main);">${cur}${amount.toFixed(2)}</p></div>`;
            });
        }
    }

    drawYearlyGraph(monthlyBuckets);
    populateYearSelector();
    calculateMonthly(); 
    renderExpenses();
    updateDashboardNextAppointment();
}