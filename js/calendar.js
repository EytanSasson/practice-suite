function renderAppointmentsPage() {
    populateAppointmentClientDropdown();
    setInputVal('apt-date', calendarSelectedDate);
    setInputVal('apt-time', '09:00');
    document.getElementById('apt-repeat').value = 'none';
    toggleRepeatUntil();
    renderCalendar();
    renderAgendaForDate(calendarSelectedDate);
    renderUpcomingAppointments();
}

function populateAppointmentClientDropdown() {
    const select = document.getElementById('apt-client');
    if (!select) return;
    select.innerHTML = '';
    const activeClients = (dataStore.clients || []).filter(c => c.status !== 'Closed').sort((a,b) => a.name.localeCompare(b.name));
    if (activeClients.length === 0) {
        select.innerHTML = '<option value="" disabled selected>-- No Active Clients --</option>';
        return;
    }
    activeClients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.innerText = c.name;
        select.appendChild(opt);
    });
}

function toggleRepeatUntil() {
    const repeatVal = document.getElementById('apt-repeat').value;
    const group = document.getElementById('repeat-until-group');
    if (group) group.style.display = repeatVal === 'none' ? 'none' : 'block';
}

function submitAppointment() {
    const clientId = document.getElementById('apt-client').value;
    const date = document.getElementById('apt-date').value;
    const time = document.getElementById('apt-time').value;
    const repeat = document.getElementById('apt-repeat').value;
    const repeatUntil = document.getElementById('apt-repeat-until').value;
    const location = document.getElementById('apt-location').value;

    const client = dataStore.clients.find(c => c.id === clientId);
    if (!client) return showAlert('Missing Selection', 'Please select an active client.');
    if (!date || !time) return showAlert('Incomplete Entry', 'Date and start time are required.');

    let [y, m, d] = date.split('-').map(Number);
    let currDate = new Date(y, m - 1, d);
    let endDate = new Date(y, m - 1, d);

    if (repeat !== 'none' && repeatUntil) {
        let [ey, em, ed] = repeatUntil.split('-').map(Number);
        endDate = new Date(ey, em - 1, ed);
    }

    if (repeat !== 'none' && !repeatUntil) return showAlert('Missing End Date', 'Please select a repeat until date.');
    if (endDate < currDate) return showAlert('Invalid Date', 'Repeat end date must be after start date.');

    if (!dataStore.appointments) dataStore.appointments = [];
    
    let firstApt = null;
    const seriesId = repeat !== 'none' ? 'series_' + Date.now() + Math.random().toString().slice(2,6) : null;

    while (currDate <= endDate) {
        const dateStr = toLocalISODateString(currDate);
        const aptObj = {
            id: 'apt_' + Date.now() + Math.random().toString().slice(2,6),
            seriesId: seriesId,
            clientId: client.id,
            clientName: client.name,
            date: dateStr,
            time: time,
            location: location,
            status: 'Scheduled'
        };
        
        dataStore.appointments.push(aptObj);
        if (!firstApt) firstApt = aptObj;

        if (repeat === 'weekly') {
            currDate.setDate(currDate.getDate() + 7);
        } else if (repeat === 'monthly') {
            currDate.setMonth(currDate.getMonth() + 1);
        } else {
            break;
        }
    }

    persist();
    renderAppointmentsPage();
    
    if (firstApt) {
        const gCalLink = generateGoogleCalendarLink(firstApt);
        showConfirm('Appointment Booked', 'Appointment successfully scheduled. Would you like to add this session to your Google Calendar?', () => {
            window.open(gCalLink, '_blank');
        });
    }
}

function changeCalendarMonth(delta) {
    currentCalendarViewDate.setMonth(currentCalendarViewDate.getMonth() + delta);
    renderCalendar();
}

function setCalendarToToday() {
    currentCalendarViewDate = new Date();
    calendarSelectedDate = toLocalISODateString(new Date());
    setInputVal('apt-date', calendarSelectedDate);
    renderCalendar();
    renderAgendaForDate(calendarSelectedDate);
}

function selectCalendarDay(dateStr) {
    calendarSelectedDate = dateStr;
    setInputVal('apt-date', dateStr);
    renderCalendar();
    renderAgendaForDate(dateStr);
}

function renderCalendar() {
    const monthYearEl = document.getElementById('calendar-month-year');
    const gridBody = document.getElementById('calendar-grid-body');
    if (!monthYearEl || !gridBody) return;

    const year = currentCalendarViewDate.getFullYear();
    const month = currentCalendarViewDate.getMonth();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    monthYearEl.innerText = `${monthNames[month]} ${year}`;
    gridBody.innerHTML = '';

    const firstDay = new Date(year, month, 1);
    let startingDay = firstDay.getDay() - 1; 
    if (startingDay === -1) startingDay = 6; 

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const todayStr = toLocalISODateString(new Date());

    for (let i = startingDay - 1; i >= 0; i--) {
        const pDay = prevMonthDays - i;
        const pDate = new Date(year, month - 1, pDay);
        const pDateStr = toLocalISODateString(pDate);
        gridBody.appendChild(createCalendarCell(pDay, pDateStr, true));
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cDate = new Date(year, month, day);
        const cDateStr = toLocalISODateString(cDate);
        gridBody.appendChild(createCalendarCell(day, cDateStr, false, cDateStr === todayStr, cDateStr === calendarSelectedDate));
    }

    const totalCells = startingDay + daysInMonth;
    const nextPadding = (7 - (totalCells % 7)) % 7;
    for (let n = 1; n <= nextPadding; n++) {
        const nDate = new Date(year, month + 1, n);
        const nDateStr = toLocalISODateString(nDate);
        gridBody.appendChild(createCalendarCell(n, nDateStr, true));
    }
}

function createCalendarCell(dayNum, dateStr, isInactive, isToday = false, isSelected = false) {
    const cell = document.createElement('div');
    let cellClass = 'calendar-cell';
    if (isInactive) cellClass += ' inactive';
    if (isToday) cellClass += ' today';
    if (isSelected) cellClass += ' selected';
    cell.className = cellClass;

    cell.onclick = () => selectCalendarDay(dateStr);

    const header = document.createElement('div');
    header.className = 'calendar-cell-header';
    header.innerHTML = `<span class="calendar-day-num">${dayNum}</span>`;
    cell.appendChild(header);

    const todayStr = toLocalISODateString(new Date());
    const dayApts = (dataStore.appointments || []).filter(a => a.date === dateStr && a.status !== 'Cancelled');
    
    dayApts.forEach(apt => {
        const label = document.createElement('div');
        let labelClass = 'calendar-apt-label ';
        
        if (dateStr < todayStr) {
            if (apt.status === 'Completed') labelClass += 'apt-label-completed';
            else labelClass += 'apt-label-missed';
        } else {
            if (apt.status === 'Completed') labelClass += 'apt-label-completed';
            else labelClass += apt.location === 'Office' ? 'apt-label-office' : 'apt-label-online';
        }
        
        label.className = labelClass;
        label.innerText = `${formatTimeBySetting(apt.time)} ${apt.clientName}`;
        cell.appendChild(label);
    });

    return cell;
}

function renderAgendaForDate(dateStr) {
    const titleEl = document.getElementById('agenda-date-title');
    const container = document.getElementById('daily-agenda-container');
    if (!container) return;

    if (titleEl) titleEl.innerText = `Agenda for ${formatDateToUK(dateStr)}`;
    container.innerHTML = '';

    const dayApts = (dataStore.appointments || [])
        .filter(a => a.date === dateStr && a.status !== 'Cancelled') 
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    if (dayApts.length === 0) {
        container.innerHTML = `<p style="font-size: 0.9rem; color: var(--text-muted); font-style: italic;">No active appointments scheduled for this date.</p>`;
        return;
    }

    dayApts.forEach(apt => {
        const strip = document.createElement('div');
        let statusClass = '';
        if (apt.status === 'Completed') statusClass = 'completed';
        if (apt.status === 'Cancelled') statusClass = 'cancelled';
        strip.className = `appointment-strip ${statusClass}`;

        const gCalLink = generateGoogleCalendarLink(apt);

        strip.innerHTML = `
            <div class="appointment-strip-details">
                <strong>${escapeHTML(apt.clientName)}</strong> &bull; <span style="color: var(--accent); font-weight: 600;">${formatTimeBySetting(apt.time)}</span><br>
                <span style="font-size: 0.85rem; color: var(--text-muted);">${escapeHTML(apt.location)} (${escapeHTML(apt.status)})</span>
            </div>
            <div class="appointment-strip-actions">
                ${apt.status === 'Scheduled' ? `
                    <a href="${gCalLink}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration:none;" title="Add to Google Calendar">📅 GCal</a>
                    <button class="btn btn-secondary btn-sm" onclick="completeAppointmentFromCalendar('${apt.id}')">Log Session</button>
                    <button class="btn btn-danger btn-sm" onclick="cancelAppointment('${apt.id}')">Cancel</button>
                ` : ''}
            </div>
        `;
        container.appendChild(strip);
    });
}

function renderUpcomingAppointments() {
    const container = document.getElementById('upcoming-appointments-list');
    if (!container) return;
    container.innerHTML = '';

    const todayStr = toLocalISODateString(new Date());
    const upcoming = (dataStore.appointments || [])
        .filter(a => a.status === 'Scheduled' && a.date >= todayStr)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

    if (upcoming.length === 0) {
        container.innerHTML = `<p style="font-size:0.9rem; color:var(--text-muted); font-style:italic;">No upcoming appointments.</p>`;
        return;
    }

    upcoming.forEach(apt => {
        const strip = document.createElement('div');
        strip.className = 'appointment-strip';
        const gCalLink = generateGoogleCalendarLink(apt);

        strip.innerHTML = `
            <div class="appointment-strip-details">
                <strong>${escapeHTML(apt.clientName)}</strong><br>
                <span style="color: var(--accent); font-weight: 600;">${formatDateToUK(apt.date)} @ ${formatTimeBySetting(apt.time)}</span>
            </div>
            <div class="appointment-strip-actions">
                <a href="${gCalLink}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration:none;">📅 GCal</a>
                <button class="btn btn-secondary btn-sm" onclick="completeAppointmentFromCalendar('${apt.id}')">Log</button>
                <button class="btn btn-danger btn-sm" onclick="cancelAppointment('${apt.id}')">Cancel</button>
            </div>
        `;
        container.appendChild(strip);
    });
}

function updateDashboardNextAppointment() {
    const container = document.getElementById('dash-next-apt-container');
    const details = document.getElementById('dash-next-apt-details');
    if (!container || !details) return;

    const todayStr = toLocalISODateString(new Date());
    const futureApts = (dataStore.appointments || [])
        .filter(a => a.status === 'Scheduled' && a.date >= todayStr)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

    if (futureApts.length > 0) {
        const next = futureApts[0];
        details.innerHTML = `<strong>${escapeHTML(next.clientName)}</strong> &bull; ${formatDateToUK(next.date)} @ ${formatTimeBySetting(next.time)}`;
        container.style.display = 'flex';
    } else {
        container.style.display = 'none';
    }
}

function completeAppointmentFromCalendar(aptId) {
    const apt = (dataStore.appointments || []).find(a => a.id === aptId);
    if (!apt) return;
    apt.status = 'Completed';
    cachedSessionTime = apt.time;
    persist();
    navigate('profile', apt.clientId);
}

function cancelAppointment(aptId) {
    const apt = (dataStore.appointments || []).find(a => a.id === aptId);
    if (!apt) return;
    cancellingAptId = aptId;
    if (apt.seriesId) {
        document.getElementById('cancel-series-modal').classList.add('active');
    } else {
        showConfirm("Cancel Appointment", "Are you sure you want to cancel this scheduled appointment?", () => { executeCancel('single'); }, true);
    }
}

function executeCancel(mode) {
    document.getElementById('cancel-series-modal').classList.remove('active');
    if (mode === 'abort') { cancellingAptId = null; return; }
    
    const apt = (dataStore.appointments || []).find(a => a.id === cancellingAptId);
    if (!apt) return;

    if (mode === 'single') {
        apt.status = 'Cancelled';
    } else if (mode === 'all') {
        dataStore.appointments.forEach(a => {
            if (a.seriesId === apt.seriesId && a.status === 'Scheduled' && a.date >= apt.date) a.status = 'Cancelled';
        });
    }
    
    cancellingAptId = null;
    persist();
    
    const activeView = document.querySelector('.section-view.active-view');
    if (activeView && activeView.id === 'view-appointments') renderAppointmentsPage();
    else if (activeView && activeView.id === 'view-profile') renderClientProfile();
    else { renderAppointmentsPage(); if (activeProfileId) renderClientProfile(); }
}

function generateGoogleCalendarLink(apt) {
    const datePart = apt.date.replace(/-/g, '');
    const timePart = apt.time.replace(/:/g, '') + '00';
    const startStr = `${datePart}T${timePart}`;
    
    const d = new Date(`${apt.date}T${apt.time}`);
    d.setHours(d.getHours() + 1);
    const endDPart = d.toISOString().split('T')[0].replace(/-/g, '');
    const endTPart = d.toTimeString().split(' ')[0].replace(/:/g, '');
    const endStr = `${endDPart}T${endTPart}`;
    
    const text = encodeURIComponent(`Therapy Session - ${apt.clientName}`);
    const details = encodeURIComponent(`Format/Location: ${apt.location}`);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${startStr}/${endStr}&details=${details}`;
}