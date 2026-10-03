/**********************************************************************
 * StaffFlow — Notify.gs
 *
 * Three kinds of mail, and no others:
 *   1. Intake  — once, when a request is filed. Goes to every lane.
 *   2. Digest  — end of day, ONLY if something moved. Goes to every lane.
 *   3. Welcome — once, to the employee's personal address.
 * Anyone can also push the digest early from the status page.
 *
 * Table layouts, fully inline styles, no <style> blocks — Gmail and
 * Outlook both render these correctly.
 **********************************************************************/

const PURPLE = '#63419A';
const DARK   = '#4A2F78';
const TINT   = '#F3F0F8';
const GREY   = '#636263';
const OKGRN  = '#2e7d54';

function h_(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildEmail_(heading, subheading, bodyHtml, ctaLabel, ctaUrl) {
  const logo = prop_('LOGO_URL');
  const district = prop_('DISTRICT_NAME', 'Royalton-Hartland CSD');
  heading = h_(heading);
  subheading = h_(subheading);

  const cta = (ctaLabel && ctaUrl)
    ? '<tr><td style="padding:4px 28px 28px 28px;">' +
      '<a href="' + ctaUrl + '" style="display:inline-block;background-color:' + PURPLE + ';color:#ffffff;' +
      'font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;' +
      'padding:11px 22px;border-radius:22px;">' + ctaLabel + '</a></td></tr>'
    : '';

  return '' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f7;padding:24px 0;">' +
    '<tr><td align="center">' +
      '<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:620px;max-width:620px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e1ef;">' +
        '<tr><td style="background-color:' + PURPLE + ';padding:20px 28px;">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
            (logo ? '<td width="44" style="width:44px;"><img src="' + logo + '" width="36" height="36" alt="" style="display:block;border:0;"></td>' : '') +
            '<td style="font-family:Helvetica,Arial,sans-serif;color:#ffffff;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;">Staff workflow</td>' +
          '</tr></table>' +
        '</td></tr>' +
        '<tr><td style="padding:26px 28px 6px 28px;">' +
          '<div style="font-family:Helvetica,Arial,sans-serif;font-size:20px;line-height:26px;color:#1f1b26;font-weight:bold;">' + heading + '</div>' +
          (subheading ? '<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:' + GREY + ';padding-top:6px;">' + subheading + '</div>' : '') +
        '</td></tr>' +
        '<tr><td style="padding:14px 28px 8px 28px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:#2c2833;">' +
          bodyHtml +
        '</td></tr>' +
        cta +
        '<tr><td style="background-color:' + TINT + ';padding:16px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:17px;color:' + GREY + ';">' +
          h_(district) + ' — one message a day per person, sent only when something changed. No reply needed.' +
        '</td></tr>' +
      '</table>' +
    '</td></tr>' +
  '</table>';
}

function factTable_(pairs) {
  const rows = pairs.filter(function (p) { return p[1] !== '' && p[1] !== null && p[1] !== undefined; })
    .map(function (p) {
      return '<tr>' +
        '<td style="padding:6px 14px 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:' + GREY + ';white-space:nowrap;vertical-align:top;">' + h_(p[0]) + '</td>' +
        '<td style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#2c2833;font-weight:bold;vertical-align:top;">' + h_(p[1]) + '</td>' +
      '</tr>';
    }).join('');
  if (!rows) return '';
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:' + TINT + ';border-radius:10px;margin:6px 0 16px 0;">' +
    '<tr><td style="padding:12px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0">' + rows + '</table></td></tr></table>';
}

function sectionLabel_(text) {
  return '<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1.4px;' +
    'text-transform:uppercase;font-weight:bold;color:' + GREY + ';margin:18px 0 8px 0;">' + h_(text) + '</div>';
}

function knownValues_(rec) {
  return factTable_([
    ['Employee ID',     rec.employeeId],
    ['District email',  rec.districtEmail],
    ['Extension',       rec.phoneExtension],
    ['Room',            rec.roomNumber],
    ['Device',          rec.deviceAssetTag]
  ]);
}

function personLine_(rec) {
  const bits = [rec.positionTitle, rec.buildings].filter(Boolean).join(' · ');
  const when = rec.effectiveDate ? 'starts ' + fmtDate_(rec.effectiveDate) : 'date TBD';
  return (bits ? bits + ' · ' : '') + when;
}

/** Every lane, how far along it is, and what it still owes. */
function laneTable_(tasks) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">' +
    laneSummary_(tasks).map(function (l) {
      const badge = l.complete
        ? '<span style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;color:' + OKGRN + ';">COMPLETE</span>'
        : '<span style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;color:' + DARK + ';">' + l.done + ' of ' + l.total + '</span>';
      return '<tr><td style="padding:9px 0;border-bottom:1px solid #ece8f3;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
          '<td style="font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;color:#1f1b26;">' + h_(l.label) + '</td>' +
          '<td align="right">' + badge + '</td>' +
        '</tr></table>' +
        (l.open.length
          ? '<div style="font-family:Helvetica,Arial,sans-serif;font-size:12.5px;line-height:18px;color:' + GREY + ';padding-top:4px;">Still open: ' +
            l.open.map(function (o) {
              return h_(o.label) + (o.assignedName ? ' <span style="color:' + DARK + ';">(' + h_(o.assignedName) + ')</span>' : '');
            }).join('; ') + '</div>'
          : '') +
      '</td></tr>';
    }).join('') + '</table>';
}

function movedTable_(moved) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">' +
    moved.map(function (t) {
      const who = t.completedBy ? personName_(t.completedBy) : '';
      return '<tr><td style="padding:8px 0;border-bottom:1px solid #ece8f3;">' +
        '<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1f1b26;font-weight:bold;">' +
          h_(t.label) + (t.status === 'N/A' ? ' <span style="font-weight:normal;color:' + GREY + ';">(not applicable)</span>' : '') + '</div>' +
        '<div style="font-family:Helvetica,Arial,sans-serif;font-size:12.5px;color:' + GREY + ';padding-top:3px;">' +
          h_(who) + (t.outputValue ? ' · ' + h_(t.outputField) + ': <b style="color:' + DARK + ';">' + h_(t.outputValue) + '</b>' : '') +
          (t.notes ? ' · ' + h_(t.notes) : '') +
        '</div></td></tr>';
    }).join('') + '</table>';
}

function boardUrl_(recordId) {
  const base = prop_('WEBAPP_URL');
  if (!base) return '';
  return recordId ? base + '?record=' + encodeURIComponent(recordId) : base;
}

/* ------------------------------------------------------------------ */
/* 1. Intake                                                           */
/* ------------------------------------------------------------------ */

function sendIntakeEmail_(recordId) {
  const rec = findRecord_(recordId);
  const to = recipientsFor_(recordId);
  if (!rec || !to.length) return;
  const tasks = readSheet_(SHEETS.TASKS).filter(function (t) { return t.recordId === recordId; });

  const body =
    '<p style="margin:0 0 4px 0;">' + h_(String(rec.createdBy).split('@')[0]) +
    ' opened this ' + h_(String(rec.requestType).toLowerCase()) +
    '. Every office can start now — nothing is waiting on anyone else.</p>' +
    factTable_([
      ['Position',       rec.positionTitle],
      ['Building',       rec.buildings],
      ['Effective',      fmtDate_(rec.effectiveDate)],
      ['Employment type', rec.employmentType],
      ['Supervisor',     rec.supervisorEmail],
      ['Replacing',      rec.replacingWhom],
      ['Worked here before', rec.priorEmployee]
    ]) +
    (rec.changeSummary ? '<p style="margin:0 0 14px 0;"><b>What is changing:</b> ' + h_(rec.changeSummary) + '</p>' : '') +
    sectionLabel_('Who owes what') +
    laneTable_(tasks) +
    (rec.notes ? '<p style="margin:16px 0 0 0;font-size:13px;color:' + GREY + ';"><b>Note from intake:</b> ' + h_(rec.notes) + '</p>' : '') +
    '<p style="margin:16px 0 0 0;font-size:13px;color:' + GREY + ';">From here you will get one summary at the end of any day something changes. ' +
    'The status page is always current if you need it sooner.</p>';

  sendMail_(to.join(','),
    '[' + rec.recordId + '] New: ' + displayName_(rec),
    buildEmail_(displayName_(rec), personLine_(rec), body, 'Open the status page', boardUrl_(recordId)));

  log_(recordId, 'INTAKE_EMAIL', to.length + ' recipients');
}

/* ------------------------------------------------------------------ */
/* 2. End-of-day digest                                                */
/* ------------------------------------------------------------------ */

/** Returns the email body, or null when nothing moved. */
function digestFor_(rec, tasks, since, manual) {
  const cutoff = since ? new Date(since).getTime() : 0;
  const moved = tasks.filter(function (t) {
    return t.completedAt && new Date(t.completedAt).getTime() > cutoff;
  }).sort(function (a, b) { return new Date(a.completedAt) - new Date(b.completedAt); });
  if (!moved.length) return null;

  const openCount = tasks.filter(function (t) {
    return t.status !== 'Done' && t.status !== 'N/A';
  }).length;

  const lead = manual
    ? h_(String(currentUser_()).split('@')[0]) + ' sent this update early.'
    : (moved.length === 1 ? 'One step closed today.' : moved.length + ' steps closed today.');

  const body =
    '<p style="margin:0 0 4px 0;">' + lead + ' ' +
    (openCount ? openCount + (openCount === 1 ? ' step is' : ' steps are') + ' still open.'
               : 'Everything on this checklist is now closed.') + '</p>' +
    knownValues_(rec) +
    sectionLabel_(manual ? 'Recently closed' : 'Closed today') +
    movedTable_(moved) +
    sectionLabel_('Where every office stands') +
    laneTable_(tasks);

  return {
    body: body,
    count: moved.length,
    subject: '[' + rec.recordId + '] ' + displayName_(rec) + ' — ' + moved.length +
             (moved.length === 1 ? ' update' : ' updates')
  };
}

/** Runs on the daily trigger. One email per person, only when something moved. */
function dailyDigest() {
  const allTasks = readSheet_(SHEETS.TASKS);
  const now = new Date();
  let sent = 0;

  readSheet_(SHEETS.RECORDS).forEach(function (rec) {
    if (rec.status === 'Cancelled') return;
    const tasks = allTasks.filter(function (t) { return t.recordId === rec.recordId; });
    const d = digestFor_(rec, tasks, rec.lastDigestAt, false);
    if (!d) return;

    const to = recipientsFor_(rec.recordId);
    if (to.length) {
      sendMail_(to.join(','), d.subject,
        buildEmail_(displayName_(rec), personLine_(rec), d.body,
          'Open the status page', boardUrl_(rec.recordId)));
      sent++;
    }
    writeCell_(SHEETS.RECORDS, rec._row, 'lastDigestAt', now);
    log_(rec.recordId, 'DIGEST_SENT', d.count + ' updates');
  });

  return sent;
}

/** The "send an update now" button on the status page. */
function sendUpdateNow(recordId) {
  const rec = findRecord_(recordId);
  if (!rec) throw new Error('Record not found.');
  const tasks = readSheet_(SHEETS.TASKS).filter(function (t) { return t.recordId === recordId; });
  const d = digestFor_(rec, tasks, rec.lastDigestAt, true);
  if (!d) throw new Error('Nothing has changed since the last update went out, so there is nothing to send.');

  const to = recipientsFor_(recordId);
  if (!to.length) throw new Error('No addresses are configured on the Roles tab for this record.');

  sendMail_(to.join(','), d.subject,
    buildEmail_(displayName_(rec), personLine_(rec), d.body,
      'Open the status page', boardUrl_(recordId)));
  writeCell_(SHEETS.RECORDS, rec._row, 'lastDigestAt', new Date());
  log_(recordId, 'DIGEST_MANUAL', d.count + ' updates to ' + to.length + ' recipients');
  return { ok: true, count: d.count, recipients: to.length };
}

/* ------------------------------------------------------------------ */
/* 3. Welcome email                                                    */
/* ------------------------------------------------------------------ */

/**
 * Goes to the employee's personal address and closes the task.
 * The password composes the message and is never written anywhere.
 */
function sendWelcomeEmail(taskId, tempPassword) {
  const task = findTask_(taskId);
  if (!task) throw new Error('Task not found.');
  const rec = findRecord_(task.recordId);
  if (!rec) throw new Error('Record not found.');
  if (!rec.personalEmail) throw new Error('No personal email on file for this record.');
  if (!rec.districtEmail) throw new Error('The district account has not been created yet.');
  if (!tempPassword) throw new Error('Enter the temporary password to send the welcome message.');

  const body =
    '<p style="margin:0 0 12px 0;">Welcome to ' + h_(prop_('DISTRICT_NAME', 'Roy-Hart')) +
    '. Your district technology account is ready. Sign in at <a href="https://accounts.google.com" style="color:' + PURPLE + ';">accounts.google.com</a> and you will be asked to set your own password right away.</p>' +
    factTable_([
      ['District email',      rec.districtEmail],
      ['Temporary password',  tempPassword],
      ['Employee ID',         rec.employeeId],
      ['Building',            rec.buildings],
      ['Room',                rec.roomNumber],
      ['Extension',           rec.phoneExtension],
      ['Start date',          fmtDate_(rec.effectiveDate)]
    ]) +
    '<ul style="margin:0 0 12px 18px;padding:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:#2c2833;">' +
      '<li style="margin-bottom:5px;">Change your password on first sign-in, then set up two-step verification.</li>' +
      '<li style="margin-bottom:5px;">Your district email is the login for nearly every other system you will use.</li>' +
      '<li style="margin-bottom:5px;">Your device will be waiting in your building on your first day.</li>' +
      '<li>Questions before you start? Reply here and the tech office will help.</li>' +
    '</ul>' +
    '<p style="margin:0;color:' + GREY + ';font-size:13px;">Please delete this message once you have signed in and set your own password.</p>';

  sendMail_(rec.personalEmail, 'Your Roy-Hart account is ready',
    buildEmail_('Welcome, ' + (rec.preferredName || rec.legalFirst),
      'Your district account and first-day details', body));

  log_(rec.recordId, 'WELCOME_SENT', 'to ' + rec.personalEmail);
  return completeTask(taskId, '', 'Welcome email sent to personal address');
}

function sendMail_(to, subject, htmlBody) {
  MailApp.sendEmail({
    to: to, subject: subject, htmlBody: htmlBody,
    name: prop_('FROM_NAME', 'Roy-Hart Staff Workflow')
  });
}
