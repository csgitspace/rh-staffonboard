/**********************************************************************
 * StaffFlow — Code.gs
 * Data access, record creation, task generation, lane progress.
 * There are no cross-lane gates. A task is Open unless an earlier task
 * in its OWN lane is still outstanding.
 **********************************************************************/

function prop_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === '') ? (fallback || '') : v;
}

/**
 * The workbook this project uses. Works two ways:
 *   Bound   — the script lives inside a Sheet (Extensions > Apps Script).
 *   Standalone — the script is its own project and SPREADSHEET_ID points
 *                at a workbook that setupStaffFlow created.
 */
function getSpreadsheet_() {
  const active = SpreadsheetApp.getActive();
  if (active) return active;

  const id = prop_('SPREADSHEET_ID', '');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('SPREADSHEET_ID is set to ' + id + ' but that workbook could not be opened. ' +
        'Check that it still exists and that this script has access to it.');
    }
  }
  throw new Error('No workbook yet. Run setupStaffFlow() once — it will create one and ' +
    'save its ID for you.');
}

/** True when the script is bound to a Sheet, so UI calls are safe. */
function isBound_() {
  return !!SpreadsheetApp.getActive();
}

function sh_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet: ' + name + '. Run setupStaffFlow() first.');
  return sh;
}

function readSheet_(name) {
  const sh = sh_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  const headers = values.shift();
  return values.map(function (row, i) {
    const obj = { _row: i + 2 };
    headers.forEach(function (h, c) { if (h) obj[h] = row[c]; });
    return obj;
  });
}

function headers_(name) {
  const sh = sh_(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function writeCell_(sheetName, row, field, value) {
  const col = headers_(sheetName).indexOf(field) + 1;
  if (col < 1) throw new Error('No column "' + field + '" on ' + sheetName);
  sh_(sheetName).getRange(row, col).setValue(value);
}

function appendRow_(sheetName, obj) {
  const hdrs = headers_(sheetName);
  sh_(sheetName).appendRow(hdrs.map(function (h) {
    return obj[h] !== undefined ? obj[h] : '';
  }));
  return sh_(sheetName).getLastRow();
}

function log_(recordId, action, detail) {
  try {
    appendRow_(SHEETS.LOG, {
      timestamp: new Date(), actor: currentUser_(),
      recordId: recordId || '', action: action, detail: detail || ''
    });
  } catch (e) { /* logging never breaks the workflow */ }
}

function currentUser_() {
  return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'unknown';
}

function fmtDate_(d) {
  if (!d) return '';
  if (Object.prototype.toString.call(d) !== '[object Date]') return String(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, yyyy');
}

function fmtDateTime_(d) {
  if (!d) return '';
  if (Object.prototype.toString.call(d) !== '[object Date]') return String(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d \'at\' h:mm a');
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

let _catalogCache = null;
function getCatalog_() {
  if (_catalogCache) return _catalogCache;
  const map = {};
  readSheet_(SHEETS.CATALOG).forEach(function (r) {
    if (r.active === false) return;
    map[r.taskKey] = r;
  });
  _catalogCache = map;
  return map;
}

let _rolesCache = null;
function getRoles_() {
  if (_rolesCache) return _rolesCache;
  const map = {};
  readSheet_(SHEETS.ROLES).forEach(function (r) { map[r.roleKey] = r; });
  _rolesCache = map;
  return map;
}

/** Roles in lane order, for the status page and the digest. */
function roleOrder_() {
  return readSheet_(SHEETS.ROLES)
    .sort(function (a, b) { return (Number(a.sortOrder) || 99) - (Number(b.sortOrder) || 99); })
    .map(function (r) { return r.roleKey; });
}

function getProfiles_() {
  return readSheet_(SHEETS.PROFILES).filter(function (p) { return p.active !== false; });
}

function getTemplateMap_() {
  const sh = sh_(SHEETS.TEMPLATES);
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const header = values.shift();
  const map = {};
  for (let c = 1; c < header.length; c++) if (header[c]) map[header[c]] = [];
  values.forEach(function (row) {
    if (!row[0]) return;
    for (let c = 1; c < header.length; c++) {
      if (header[c] && String(row[c]).trim().toUpperCase() === 'X') map[header[c]].push(row[0]);
    }
  });
  return map;
}

let _peopleCache = null;
function getPeople_() {
  if (_peopleCache) return _peopleCache;
  _peopleCache = readSheet_(SHEETS.PEOPLE).filter(function (p) {
    return p.email && p.active !== false;
  }).map(function (p) {
    return {
      email: String(p.email).trim(),
      name: p.name || String(p.email).split('@')[0],
      title: p.title || '',
      roleKeys: String(p.roleKeys || '').split(/[,;\s]+/).filter(Boolean),
      _row: p._row
    };
  });
  return _peopleCache;
}

function peopleForRole_(roleKey) {
  return getPeople_().filter(function (p) { return p.roleKeys.indexOf(roleKey) > -1; });
}

/** Display name for an address, falling back to the local part. */
function personName_(email) {
  if (!email) return '';
  const target = String(email).toLowerCase().trim();
  const hit = getPeople_().filter(function (p) { return p.email.toLowerCase() === target; })[0];
  return hit ? hit.name : String(email).split('@')[0];
}

/** Which lanes this address belongs to — named people plus shared mailboxes. */
function rolesForUser_(email) {
  const target = String(email || '').toLowerCase().trim();
  if (!target) return [];
  const out = [];
  getPeople_().forEach(function (p) {
    if (p.email.toLowerCase() !== target) return;
    p.roleKeys.forEach(function (k) { if (out.indexOf(k) === -1) out.push(k); });
  });
  readSheet_(SHEETS.ROLES).forEach(function (r) {
    const list = String(r.emails || '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
    if (list.indexOf(target) > -1 && out.indexOf(r.roleKey) === -1) out.push(r.roleKey);
  });
  return out;
}

/** Everyone who should hear about this lane: its people, then its shared mailboxes. */
function emailsForRole_(roleKey) {
  const out = peopleForRole_(roleKey).map(function (p) { return p.email; });
  const r = getRoles_()[roleKey];
  String(r ? r.emails || '' : '').split(/[,;\s]+/).filter(Boolean).forEach(function (e) {
    if (out.indexOf(e) === -1) out.push(e);
  });
  return out;
}

/**
 * Everyone who should hear about this record: every lane that owns at
 * least one task on it, plus the named supervisor.
 */
function recipientsFor_(recordId) {
  const rec = findRecord_(recordId);
  const lanes = {};
  readSheet_(SHEETS.TASKS).forEach(function (t) {
    if (t.recordId === recordId) lanes[t.ownerRole] = true;
  });
  const out = [];
  Object.keys(lanes).forEach(function (roleKey) {
    emailsForRole_(roleKey).forEach(function (e) {
      if (out.indexOf(e) === -1) out.push(e);
    });
  });
  readSheet_(SHEETS.TASKS).forEach(function (t) {
    if (t.recordId === recordId && t.assignedTo && out.indexOf(t.assignedTo) === -1) {
      out.push(t.assignedTo);
    }
  });
  if (rec && rec.supervisorEmail && out.indexOf(rec.supervisorEmail) === -1) {
    out.push(rec.supervisorEmail);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Record creation                                                     */
/* ------------------------------------------------------------------ */

function nextRecordId_() {
  const year = new Date().getFullYear();
  let n = 0;
  readSheet_(SHEETS.RECORDS).forEach(function (r) {
    const m = String(r.recordId || '').match(/^RH-(\d{4})-(\d+)$/);
    if (m && Number(m[1]) === year) n = Math.max(n, Number(m[2]));
  });
  return 'RH-' + year + '-' + Utilities.formatString('%04d', n + 1);
}

function createRecord(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const profileKeys = [].concat(payload.profileKeys || []).filter(Boolean);
    if (!profileKeys.length) throw new Error('Choose at least one position or change type.');
    if (!payload.legalFirst || !payload.legalLast) throw new Error('First and last name are required.');

    const recordId = nextRecordId_();
    const rec = {};
    RECORD_HEADERS.forEach(function (h) { rec[h] = payload[h] !== undefined ? payload[h] : ''; });
    rec.recordId    = recordId;
    rec.profileKeys = profileKeys.join(',');
    rec.status      = 'Active';
    rec.createdAt   = new Date();
    rec.createdBy   = currentUser_();
    rec.requestType = payload.requestType || 'New Hire';
    rec.lastDigestAt = new Date();
    if (rec.effectiveDate) rec.effectiveDate = new Date(rec.effectiveDate);

    appendRow_(SHEETS.RECORDS, rec);
    generateTasks_(recordId, profileKeys);
    log_(recordId, 'RECORD_CREATED', rec.requestType + ' — ' + rec.legalFirst + ' ' + rec.legalLast);
    sendIntakeEmail_(recordId);
    return recordId;
  } finally {
    lock.releaseLock();
  }
}

/**
 * All lanes open at once. Only same-lane dependencies are honoured; any
 * dependency naming a task in a different lane is dropped.
 */
function generateTasks_(recordId, profileKeys) {
  const catalog  = getCatalog_();
  const template = getTemplateMap_();

  const wanted = [];
  profileKeys.forEach(function (pk) {
    (template[pk] || []).forEach(function (tk) {
      if (wanted.indexOf(tk) === -1 && catalog[tk]) wanted.push(tk);
    });
  });

  const ordered = Object.keys(catalog)
    .filter(function (tk) { return wanted.indexOf(tk) > -1; })
    .sort(function (a, b) {
      return (Number(catalog[a].sortOrder) || 0) - (Number(catalog[b].sortOrder) || 0);
    });

  const rows = ordered.map(function (tk, i) {
    const c = catalog[tk];
    const deps = String(c.dependsOn || '').split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (d) {
        if (!d || ordered.indexOf(d) === -1) return false;
        return catalog[d].ownerRole === c.ownerRole;   // same lane only
      });
    return TASK_HEADERS.map(function (h) {
      switch (h) {
        case 'taskId':      return recordId + '-' + Utilities.formatString('%02d', i + 1);
        case 'recordId':    return recordId;
        case 'taskKey':     return tk;
        case 'label':       return c.label;
        case 'ownerRole':   return c.ownerRole;
        case 'assignedTo':  return defaultAssignee_(c);
        case 'sortOrder':   return c.sortOrder;
        case 'dependsOn':   return deps.join(',');
        case 'outputField': return c.outputField || '';
        case 'status':      return deps.length ? 'Waiting' : 'Open';
        default:            return '';
      }
    });
  });

  if (rows.length) {
    const sh = sh_(SHEETS.TASKS);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, TASK_HEADERS.length).setValues(rows);
  }
  return rows.length;
}

/**
 * A step's default owner, but only if that person is still active and
 * still in the step's lane. Otherwise the step belongs to the lane at large.
 */
function defaultAssignee_(c) {
  if (!c.assignedTo) return '';
  const target = String(c.assignedTo).toLowerCase().trim();
  const hit = getPeople_().filter(function (p) { return p.email.toLowerCase() === target; })[0];
  return (hit && hit.roleKeys.indexOf(c.ownerRole) > -1) ? hit.email : '';
}

/** Waiting → Open once the earlier steps in the same lane are closed. */
function evaluateGates_(recordId) {
  const tasks = readSheet_(SHEETS.TASKS).filter(function (t) { return t.recordId === recordId; });
  const byKey = {};
  tasks.forEach(function (t) { byKey[t.taskKey] = t; });

  tasks.forEach(function (t) {
    if (t.status !== 'Waiting') return;
    const clear = String(t.dependsOn || '').split(',').map(function (s) { return s.trim(); })
      .filter(Boolean).every(function (d) {
        const dep = byKey[d];
        return !dep || dep.status === 'Done' || dep.status === 'N/A';
      });
    if (clear) {
      writeCell_(SHEETS.TASKS, t._row, 'status', 'Open');
      t.status = 'Open';
    }
  });
}

/* ------------------------------------------------------------------ */
/* Task actions                                                        */
/* ------------------------------------------------------------------ */

function completeTask(taskId, outputValue, noteText) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const task = findTask_(taskId);
    if (!task) throw new Error('Task not found: ' + taskId);
    if (task.status === 'Done') return { ok: true };

    if (task.outputField && !String(outputValue || '').trim()) {
      throw new Error('This step produces "' + task.outputField +
        '". Enter the value before marking it done — it is what the other offices are waiting to see.');
    }

    writeCell_(SHEETS.TASKS, task._row, 'status', 'Done');
    writeCell_(SHEETS.TASKS, task._row, 'completedBy', currentUser_());
    writeCell_(SHEETS.TASKS, task._row, 'completedAt', new Date());
    if (outputValue) writeCell_(SHEETS.TASKS, task._row, 'outputValue', outputValue);
    if (noteText)    writeCell_(SHEETS.TASKS, task._row, 'notes', noteText);

    if (task.outputField && outputValue) {
      const rec = findRecord_(task.recordId);
      if (rec) writeCell_(SHEETS.RECORDS, rec._row, task.outputField, outputValue);
    }

    log_(task.recordId, 'TASK_DONE', task.label + (outputValue ? ' → ' + outputValue : ''));
    evaluateGates_(task.recordId);
    maybeCloseRecord_(task.recordId);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function skipTask(taskId, reason) {
  const task = findTask_(taskId);
  if (!task) throw new Error('Task not found: ' + taskId);
  writeCell_(SHEETS.TASKS, task._row, 'status', 'N/A');
  writeCell_(SHEETS.TASKS, task._row, 'completedBy', currentUser_());
  writeCell_(SHEETS.TASKS, task._row, 'completedAt', new Date());
  writeCell_(SHEETS.TASKS, task._row, 'notes', reason || 'Not applicable');
  log_(task.recordId, 'TASK_SKIPPED', task.label + ' — ' + (reason || ''));
  evaluateGates_(task.recordId);
  maybeCloseRecord_(task.recordId);
  return { ok: true };
}

function addTaskNote(taskId, noteText) {
  const task = findTask_(taskId);
  if (!task) throw new Error('Task not found: ' + taskId);
  writeCell_(SHEETS.TASKS, task._row, 'notes', noteText || '');
  log_(task.recordId, 'TASK_NOTE', task.label + ': ' + noteText);
  return { ok: true };
}

function addCustomTask(recordId, label, ownerRole, assignedTo) {
  const existing = readSheet_(SHEETS.TASKS).filter(function (t) { return t.recordId === recordId; });
  const row = TASK_HEADERS.map(function (h) {
    switch (h) {
      case 'taskId':    return recordId + '-C' + Utilities.formatString('%02d', existing.length + 1);
      case 'recordId':  return recordId;
      case 'taskKey':   return 'CUSTOM';
      case 'label':     return label;
      case 'ownerRole': return ownerRole;
      case 'assignedTo': return assignedTo || '';
      case 'sortOrder': return 95;
      case 'status':    return 'Open';
      default:          return '';
    }
  });
  const sh = sh_(SHEETS.TASKS);
  sh.getRange(sh.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([row]);
  log_(recordId, 'TASK_ADDED', label);
  return { ok: true };
}

/** Points one step at one person, or clears it back to the whole lane. */
function assignTask(taskId, email) {
  const task = findTask_(taskId);
  if (!task) throw new Error('Task not found.');
  const value = String(email || '').trim();
  if (value) {
    const hit = getPeople_().filter(function (p) {
      return p.email.toLowerCase() === value.toLowerCase(); })[0];
    if (!hit) throw new Error('No one on the People tab has that address.');
    if (hit.roleKeys.indexOf(task.ownerRole) === -1) {
      throw new Error(hit.name + ' is not in the office that owns this step. ' +
        'Add them to that office on the admin tab first.');
    }
  }
  writeCell_(SHEETS.TASKS, task._row, 'assignedTo', value);
  log_(task.recordId, value ? 'TASK_ASSIGNED' : 'TASK_UNASSIGNED',
    task.label + (value ? ' → ' + value : ''));
  return { ok: true };
}

function findTask_(taskId) {
  const all = readSheet_(SHEETS.TASKS);
  for (let i = 0; i < all.length; i++) if (all[i].taskId === taskId) return all[i];
  return null;
}

function findRecord_(recordId) {
  const all = readSheet_(SHEETS.RECORDS);
  for (let i = 0; i < all.length; i++) if (all[i].recordId === recordId) return all[i];
  return null;
}

function maybeCloseRecord_(recordId) {
  const tasks = readSheet_(SHEETS.TASKS).filter(function (t) { return t.recordId === recordId; });
  if (tasks.some(function (t) { return t.status !== 'Done' && t.status !== 'N/A'; })) return;
  const rec = findRecord_(recordId);
  if (rec && rec.status !== 'Complete') {
    writeCell_(SHEETS.RECORDS, rec._row, 'status', 'Complete');
    log_(recordId, 'RECORD_COMPLETE', '');
  }
}

function displayName_(rec) {
  const preferred = String(rec.preferredName || '').trim();
  return (preferred || rec.legalFirst) + ' ' + rec.legalLast;
}

function progressOf_(tasks) {
  if (!tasks.length) return 0;
  const done = tasks.filter(function (t) { return t.status === 'Done' || t.status === 'N/A'; }).length;
  return Math.round((done / tasks.length) * 100);
}

/** Per-lane progress — the shape the status page and the digest both need. */
function laneSummary_(tasks) {
  const roles = getRoles_();
  const out = [];
  roleOrder_().forEach(function (roleKey) {
    const g = tasks.filter(function (t) { return t.ownerRole === roleKey; });
    if (!g.length) return;
    const done = g.filter(function (t) { return t.status === 'Done' || t.status === 'N/A'; }).length;
    out.push({
      roleKey: roleKey,
      label: roles[roleKey] ? roles[roleKey].roleLabel : roleKey,
      done: done,
      total: g.length,
      complete: done === g.length,
      people: peopleForRole_(roleKey).map(function (p) { return p.name; }),
      open: g.filter(function (t) { return t.status !== 'Done' && t.status !== 'N/A'; })
             .map(function (t) {
               return { label: t.label, assignedName: t.assignedTo ? personName_(t.assignedTo) : '' };
             }),
      openLabels: g.filter(function (t) { return t.status !== 'Done' && t.status !== 'N/A'; })
                   .map(function (t) { return t.label; })
    });
  });
  return out;
}
