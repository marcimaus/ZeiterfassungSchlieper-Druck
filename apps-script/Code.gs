// ═══════════════════════════════════════════════════════════════════
//  Zeiterfassung Schlieper-Druck GmbH – Automatischer E-Mail-Bericht
//  Einmalig einrichten unter: https://script.google.com
//  Konto: info@schlieper-druck.com
// ═══════════════════════════════════════════════════════════════════

var FIREBASE_PROJECT_ID = 'zeiterfassung-schlieper-druck';
var FIREBASE_API_KEY    = 'AIzaSyCPPy4HwoJ1zoNU6fensIk3Vkz2lCA3Hcs';

var WEEKDAYS = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
var MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni',
                   'Juli','August','September','Oktober','November','Dezember'];

// ── Hauptfunktion (stündlich ausführen) ──────────────────────────────
function checkAndSendDailyReport() {
  var now = new Date();

  // Konfiguration aus Firestore laden
  var config      = getFirestoreDocument('meta', 'config');
  var reportTime  = (config && config.reportTime)  ? config.reportTime  : '07:00';
  var reportEmail = (config && config.reportEmail) ? config.reportEmail : 'info@schlieper-druck.com';

  var configHour = parseInt(reportTime.split(':')[0], 10);

  // Nur zur konfigurierten Stunde ausführen
  if (now.getHours() !== configHour) return;

  // Nicht doppelt senden (einmal pro Tag)
  var todayKey = 'sent_' + now.getFullYear() + '_' + now.getMonth() + '_' + now.getDate();
  var props    = PropertiesService.getScriptProperties();
  if (props.getProperty(todayKey)) return;

  sendMonthlyReport(reportEmail, now);
  props.setProperty(todayKey, 'true');
}

// ── Bericht erstellen und senden ─────────────────────────────────────
function sendMonthlyReport(recipientEmail, date) {
  var year  = date.getFullYear();
  var month = date.getMonth(); // 0-basiert

  // Letzter Tag des Monats?
  var lastDay   = new Date(year, month + 1, 0).getDate();
  var isLastDay = (date.getDate() === lastDay);

  // Betreff
  var subject = 'Arbeitszeiten ' + MONTH_NAMES[month] + ' ' + year;
  if (isLastDay) subject += ' – Endabrechnung';

  // Konfiguration
  var config = getFirestoreDocument('meta', 'config');

  // Daten aus Firestore laden
  var users = getFirestoreCollection('users').filter(function(u) { return u.isActive; });
  var from  = new Date(year, month, 1).getTime();
  var to    = new Date(year, month + 1, 1).getTime();
  var allSessions = getFirestoreCollection('sessions').filter(function(s) {
    return s.startTime >= from && s.startTime < to && s.endTime;
  });

  // Sessions pro User gruppieren
  var sessionsByUser = {};
  users.forEach(function(u) { sessionsByUser[u.id] = []; });
  allSessions.forEach(function(s) {
    if (sessionsByUser[s.userId]) sessionsByUser[s.userId].push(s);
  });

  // Alle Kalendertage des Monats
  var allDays = [];
  for (var d = 1; d <= lastDay; d++) {
    var dd = d < 10 ? '0' + d : '' + d;
    var mm = (month + 1) < 10 ? '0' + (month + 1) : '' + (month + 1);
    allDays.push(year + '-' + mm + '-' + dd);
  }

  // Prüfen ob irgendwer Stundenlohn hat
  var showEarnings = users.some(function(u) {
    var rate = u.useMinimumWage ? (config && config.minimumWage) : u.hourlyRate;
    return rate != null && rate > 0;
  });

  // Temporäre Tabelle erstellen
  var ss = SpreadsheetApp.create('Arbeitszeiten_' + year + '_' + (month + 1));

  // ── Übersichts-Tabellenblatt ──────────────────────────────────────
  var overviewSheet = ss.getActiveSheet();
  overviewSheet.setName('Übersicht');

  overviewSheet.setColumnWidth(1, 200); // Mitarbeiter
  overviewSheet.setColumnWidth(2, 160); // Arbeitszeit
  overviewSheet.setColumnWidth(3, 160); // Gesamtverdienst

  var monthLabel = MONTH_NAMES[month] + ' ' + year;

  // Überschrift
  var titleCell = overviewSheet.getRange(1, 1);
  titleCell.setValue('Monatsübersicht – ' + monthLabel);
  titleCell.setFontWeight('bold');
  titleCell.setFontSize(14);

  // Spaltenüberschriften
  var ovHeaders = ['Mitarbeiter', 'Arbeitszeit'];
  if (showEarnings) ovHeaders.push('Gesamtverdienst (€)');

  var ovHeaderRange = overviewSheet.getRange(3, 1, 1, ovHeaders.length);
  ovHeaderRange.setValues([ovHeaders]);
  ovHeaderRange.setFontWeight('bold');

  var overviewRow = 4;
  var grandTotalMinutes = 0;
  var grandTotalEarnings = 0;

  users.forEach(function(user) {
    var effectiveRate = user.useMinimumWage
      ? (config && config.minimumWage ? config.minimumWage : 0)
      : (user.hourlyRate || 0);
    var hasRate = effectiveRate > 0;

    // Arbeitszeit berechnen
    var userSessions = (sessionsByUser[user.id] || []).sort(function(a, b) { return a.startTime - b.startTime; });
    var byDay = {};
    userSessions.forEach(function(s) {
      var key = localDateKey(s.startTime);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(s);
    });

    var userMinutes = 0;
    var userEarnings = 0;
    Object.keys(byDay).forEach(function(dayKey) {
      var daySessions = byDay[dayKey].sort(function(a, b) { return a.startTime - b.startTime; });
      var firstStart = daySessions[0].startTime;
      var lastEnd = Math.max.apply(null, daySessions.map(function(s) { return s.endTime; }));
      var pauseMinutes = daySessions.reduce(function(sum, s) { return sum + (s.totalBreakMinutes || 0); }, 0);
      for (var i = 1; i < daySessions.length; i++) {
        var gap = Math.floor((daySessions[i].startTime - daySessions[i-1].endTime) / 60000);
        if (gap > 0) pauseMinutes += gap;
      }
      var net = Math.max(0, Math.floor((lastEnd - firstStart) / 60000) - pauseMinutes);
      userMinutes += net;
      if (hasRate) userEarnings += (net / 60) * effectiveRate;
    });

    grandTotalMinutes  += userMinutes;
    grandTotalEarnings += userEarnings;

    var rowData = [user.name, formatDuration(userMinutes)];
    if (showEarnings) rowData.push(hasRate ? parseFloat(userEarnings.toFixed(2)) : '');

    overviewSheet.getRange(overviewRow, 1, 1, rowData.length).setValues([rowData]);
    overviewRow++;
  });

  // Gesamtzeile
  overviewRow++;
  var totalRowData = ['Gesamt', formatDuration(grandTotalMinutes)];
  if (showEarnings) totalRowData.push(parseFloat(grandTotalEarnings.toFixed(2)));
  var totalRange = overviewSheet.getRange(overviewRow, 1, 1, totalRowData.length);
  totalRange.setValues([totalRowData]);
  totalRange.setFontWeight('bold');

  // ── Detail-Tabellenblatt ──────────────────────────────────────────
  var sheet = ss.insertSheet('Monatsdetails');

  sheet.setColumnWidth(1, 105); // Datum
  sheet.setColumnWidth(2, 100); // Wochentag
  sheet.setColumnWidth(3, 110); // Arbeitsbeginn
  sheet.setColumnWidth(4, 110); // Arbeitsende
  sheet.setColumnWidth(5, 105); // Pause
  sheet.setColumnWidth(6, 150); // Arbeitszeit gesamt
  sheet.setColumnWidth(7, 120); // Zeit in Dezimal
  sheet.setColumnWidth(8, 160); // Gesamtverdienst
  sheet.setColumnWidth(9, 300); // Notiz

  var currentRow = 1;
  var firstUser  = true;

  users.forEach(function(user) {
    if (!firstUser) currentRow++;
    firstUser = false;

    var effectiveRate = user.useMinimumWage
      ? (config && config.minimumWage ? config.minimumWage : 0)
      : (user.hourlyRate || 0);
    var hasRate = effectiveRate > 0;

    // ── Mitarbeiter-Namenszeile ──────────────────────────────────────
    var nameCell = sheet.getRange(currentRow, 1);
    nameCell.setValue('Mitarbeiter: ' + user.name);
    nameCell.setFontWeight('bold');
    nameCell.setFontSize(13);
    currentRow++;

    // ── Spalten-Kopfzeile ────────────────────────────────────────────
    var headers = ['Datum','Wochentag','Arbeitsbeginn','Arbeitsende','Pause',
                   'Arbeitszeit gesamt','Zeit in Dezimal'];
    if (hasRate) headers.push('Gesamtverdienst (€)');
    headers.push('Notiz');
    var colCount = headers.length;
    var headerRange = sheet.getRange(currentRow, 1, 1, colCount);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setFontStyle('italic');
    currentRow++;

    // Sessions nach Datum gruppieren
    var userSessions = (sessionsByUser[user.id] || []).sort(function(a, b) { return a.startTime - b.startTime; });
    var byDay = {};
    userSessions.forEach(function(s) {
      var key = localDateKey(s.startTime);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(s);
    });

    var monthlyTotalMinutes = 0;
    var monthlyEarnings     = 0;

    allDays.forEach(function(dayKey) {
      var dateParts = dayKey.split('-');
      var dateObj   = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]), 12, 0, 0);
      var dateStr   = pad(dateObj.getDate()) + '.' + pad(dateObj.getMonth() + 1) + '.' + dateObj.getFullYear();
      var weekday   = WEEKDAYS[dateObj.getDay()];
      var daySessions = byDay[dayKey];

      if (!daySessions || daySessions.length === 0) {
        var emptyRow = [dateStr, weekday, '', '', '', '', ''];
        if (hasRate) emptyRow.push('');
        emptyRow.push('');
        sheet.getRange(currentRow, 1, 1, emptyRow.length).setValues([emptyRow]);
        currentRow++;
        return;
      }

      daySessions.sort(function(a, b) { return a.startTime - b.startTime; });
      var firstStart = daySessions[0].startTime;
      var lastEnd    = Math.max.apply(null, daySessions.map(function(s) { return s.endTime; }));

      var pauseMinutes = daySessions.reduce(function(sum, s) { return sum + (s.totalBreakMinutes || 0); }, 0);
      for (var i = 1; i < daySessions.length; i++) {
        var gap = Math.floor((daySessions[i].startTime - daySessions[i - 1].endTime) / 60000);
        if (gap > 0) pauseMinutes += gap;
      }

      var netMinutes   = Math.max(0, Math.floor((lastEnd - firstStart) / 60000) - pauseMinutes);
      monthlyTotalMinutes += netMinutes;
      var decimalHours = parseFloat((netMinutes / 60).toFixed(2));
      var notiz        = getEditNotes(daySessions);

      var dayEarnings = 0;
      if (hasRate) {
        dayEarnings = parseFloat((decimalHours * effectiveRate).toFixed(2));
        monthlyEarnings += dayEarnings;
      }

      var rowData = [
        dateStr, weekday,
        formatTimestamp(firstStart), formatTimestamp(lastEnd),
        pauseMinutes > 0 ? formatDuration(pauseMinutes) : '-',
        formatDuration(netMinutes), decimalHours
      ];
      if (hasRate) rowData.push(dayEarnings);
      rowData.push(notiz);
      sheet.getRange(currentRow, 1, 1, rowData.length).setValues([rowData]);
      currentRow++;
    });

    // ── Monatssumme ──────────────────────────────────────────────────
    var monthlyDecimal = parseFloat((monthlyTotalMinutes / 60).toFixed(2));

    var totalRowData = ['', '', '', '', 'Monatssumme:',
                        formatDuration(monthlyTotalMinutes), monthlyDecimal];
    if (hasRate) totalRowData.push(parseFloat(monthlyEarnings.toFixed(2)));
    totalRowData.push('');
    var totalRange2 = sheet.getRange(currentRow, 1, 1, totalRowData.length);
    totalRange2.setValues([totalRowData]);
    totalRange2.setFontWeight('bold');
    currentRow++;
  });

  // Alle ausstehenden Schreiboperationen ausführen BEVOR exportiert wird
  SpreadsheetApp.flush();

  // Als xlsx exportieren und per Mail senden
  var ssId     = ss.getId();
  var token    = ScriptApp.getOAuthToken();
  var xlsxResp = UrlFetchApp.fetch(
    'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=xlsx',
    { headers: { Authorization: 'Bearer ' + token } }
  );
  var mm_str   = (month + 1) < 10 ? '0' + (month + 1) : '' + (month + 1);
  var fileName = 'Arbeitszeiten_' + year + '_' + mm_str + '.xlsx';
  var xlsxBlob = xlsxResp.getBlob().setName(fileName);

  var bodyText = 'Anbei die Arbeitszeiten für ' + MONTH_NAMES[month] + ' ' + year + '.\n\n'
               + 'Diese E-Mail wurde automatisch von der Zeiterfassungs-App gesendet.';
  var bodyHtml = '<p>Anbei die Arbeitszeiten für <strong>' + MONTH_NAMES[month] + ' ' + year + '</strong>.</p>'
               + (isLastDay ? '<p><strong>Dies ist die Endabrechnung für diesen Monat.</strong></p>' : '')
               + '<p style="color:#888;font-size:12px">Diese E-Mail wurde automatisch von der Zeiterfassungs-App gesendet.</p>';

  GmailApp.sendEmail(recipientEmail, subject, bodyText, {
    attachments: [xlsxBlob],
    htmlBody:    bodyHtml,
    name:        'Zeiterfassung Schlieper-Druck GmbH'
  });

  // Temporäre Tabelle löschen
  DriveApp.getFileById(ssId).setTrashed(true);

  Logger.log('Bericht gesendet an: ' + recipientEmail + ' | ' + subject);
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** Timestamp → "dd.MM.yyyy"-Key in lokaler Zeitzone */
function localDateKey(ts) {
  var d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** Timestamp → "HH:MM" */
function formatTimestamp(ts) {
  var d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** Minuten → "Xh Ym" oder "Ym" */
function formatDuration(minutes) {
  if (minutes <= 0) return '0 Min';
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  if (h === 0) return m + ' Min';
  if (m === 0) return h + 'h';
  return h + 'h ' + m + 'min';
}

/** Korrekturnotizen aus correctionLog zusammenführen */
function getEditNotes(sessions) {
  var EDIT_FIELDS = ['startTime','endTime','break_add','break_edit','break_remove'];
  var notes = [];
  sessions.forEach(function(s) {
    var log = s.correctionLog || [];
    log.forEach(function(entry) {
      if (EDIT_FIELDS.indexOf(entry.field) !== -1 && entry.note && notes.indexOf(entry.note) === -1) {
        notes.push(entry.note);
      }
    });
  });
  return notes.join(' | ');
}

// ── Firestore Hilfsfunktionen ─────────────────────────────────────────

function getFirestoreDocument(collection, docId) {
  var url  = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID
           + '/databases/(default)/documents/' + collection + '/' + docId
           + '?key=' + FIREBASE_API_KEY;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return null;
  var data = JSON.parse(resp.getContentText());
  return parseFirestoreFields(data.fields || {});
}

function getFirestoreCollection(collection) {
  var results   = [];
  var pageToken = null;
  do {
    var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID
            + '/databases/(default)/documents/' + collection
            + '?key=' + FIREBASE_API_KEY + '&pageSize=300'
            + (pageToken ? '&pageToken=' + pageToken : '');
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) break;
    var data = JSON.parse(resp.getContentText());
    (data.documents || []).forEach(function(doc) {
      var item = parseFirestoreFields(doc.fields || {});
      item.id  = doc.name.split('/').pop();
      results.push(item);
    });
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return results;
}

function parseFirestoreValue(val) {
  if (val.stringValue  !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
  if (val.doubleValue  !== undefined) return val.doubleValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.nullValue    !== undefined) return null;
  if (val.mapValue     !== undefined) return parseFirestoreFields(val.mapValue.fields || {});
  if (val.arrayValue   !== undefined) {
    return (val.arrayValue.values || []).map(function(v) { return parseFirestoreValue(v); });
  }
  return null;
}

function parseFirestoreFields(fields) {
  var result = {};
  Object.keys(fields).forEach(function(key) {
    result[key] = parseFirestoreValue(fields[key]);
  });
  return result;
}

// ── Testfunktion (manuell ausführen zum Testen) ───────────────────────
function sendTestReport() {
  var config = getFirestoreDocument('meta', 'config');
  var email  = (config && config.reportEmail) ? config.reportEmail : 'info@schlieper-druck.com';
  sendMonthlyReport(email, new Date());
  Logger.log('Testbericht gesendet an: ' + email);
}
