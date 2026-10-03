/**********************************************************************
 * StaffFlow — WebApp.gs
 * Serves the status page and the calls it makes.
 **********************************************************************/

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.initialRecord = (e && e.parameter && e.parameter.record) ? e.parameter.record : '';
  return t.evaluate()
    .setTitle('Staff workflow — Roy-Hart')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Strict mode limits closing a step to the owning lane. Leave it off
 * until every lane on the Roles tab has real addresses.
 */
function canAct_(ownerRole) {
  if (prop_('STRICT_PERMISSIONS', 'false') !== 'true') return true;
  return rolesForUser_(currentUser_()).indexOf(ownerRole) > -1;
}

function assertCanAct_(ownerRole, label) {
  if (!canAct_(ownerRole)) {
    throw new Error('"' + label + '" belongs to another office. They can close it from their own view.');
  }
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

function getBootstrap() {
  const me = currentUser_();
  const myRoles = rolesForUser_(me);
  const roles = getRoles_();
  const allTasks = readSheet_(SHEETS.TASKS);
  const records = readSheet_(SHEETS.RECORDS);

  const byRecord = {};
  allTasks.forEach(function (t) {
    if (!byRecord[t.recordId]) byRecord[t.recordId] = [];
    byRecord[t.recordId].push(t);
  });

  const recSummaries = records.map(function (r) {
    const tasks = byRecord[r.recordId] || [];
    return {
      recordId: r.recordId,
      name: displayName_(r),
      requestType: r.requestType,
      status: r.status,
      positionTitle: r.positionTitle,
      buildings: r.buildings,
      effectiveDate: fmtDate_(r.effectiveDate),
      effectiveRaw: r.effectiveDate ? new Date(r.effectiveDate).getTime() : 0,
      progress: progressOf_(tasks),
      openCount: tasks.filter(function (t) { return t.status !== 'Done' && t.status !== 'N/A'; }).length,
      lanes: laneSummary_(tasks).map(function (l) {
        return { label: l.label, done: l.done, total: l.total, complete: l.complete };
      }),
      myOpen: tasks.filter(function (t) {
        if (t.status !== 'Open') return false;
        if (t.assignedTo) return String(t.assignedTo).toLowerCase() === me.toLowerCase();
        return myRoles.indexOf(t.ownerRole) > -1;
      }).length
    };
  }).sort(function (a, b) { return (a.effectiveRaw || 9e15) - (b.effectiveRaw || 9e15); });

  return {
    me: me,
    isAdmin: isAdmin_(),
    myRoleKeys: myRoles,
    myRoles: myRoles.map(function (k) { return roles[k] ? roles[k].roleLabel : k; }),
    roleList: roleOrder_().map(function (k) {
      return { key: k, label: roles[k].roleLabel, configured: !!String(roles[k].emails || '').trim() };
    }),
    profiles: getProfiles_().map(function (p) {
      return { key: p.profileKey, label: p.profileLabel, type: p.profileType };
    }),
    people: getPeople_().map(function (p) {
      return { email: p.email, name: p.name, roleKeys: p.roleKeys };
    }),
    records: recSummaries
  };
}

function taskDto_(t, rec) {
  const c = getCatalog_()[t.taskKey] || {};
  const roles = getRoles_();
  return {
    taskId: t.taskId,
    recordId: t.recordId,
    taskKey: t.taskKey,
    label: t.label,
    ownerRole: t.ownerRole,
    ownerLabel: roles[t.ownerRole] ? roles[t.ownerRole].roleLabel : t.ownerRole,
    assignedTo: t.assignedTo || '',
    assignedName: t.assignedTo ? personName_(t.assignedTo) : '',
    status: t.status,
    dependsOn: t.dependsOn,
    outputField: t.outputField,
    outputValue: t.outputValue,
    notes: t.notes,
    instructions: c.instructions || '',
    completedBy: t.completedBy ? String(t.completedBy).split('@')[0] : '',
    completedAt: fmtDateTime_(t.completedAt),
    canAct: canAct_(t.ownerRole),
    personName: rec ? displayName_(rec) : ''
  };
}

function getRecord(recordId) {
  const rec = findRecord_(recordId);
  if (!rec) throw new Error('Record not found.');
  const tasks = readSheet_(SHEETS.TASKS)
    .filter(function (t) { return t.recordId === recordId; })
    .sort(function (a, b) { return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0); })
    .map(function (t) { return taskDto_(t, rec); });

  const detail = {};
  RECORD_HEADERS.forEach(function (h) {
    detail[h] = (h === 'effectiveDate') ? fmtDate_(rec[h])
              : (h === 'createdAt' || h === 'lastDigestAt') ? fmtDateTime_(rec[h])
              : rec[h];
  });
  detail.displayName = displayName_(rec);
  detail.progress = progressOf_(tasks);

  const raw = readSheet_(SHEETS.TASKS).filter(function (t) { return t.recordId === recordId; });
  const cutoff = rec.lastDigestAt ? new Date(rec.lastDigestAt).getTime() : 0;
  detail.unsentCount = raw.filter(function (t) {
    return t.completedAt && new Date(t.completedAt).getTime() > cutoff;
  }).length;
  detail.recipientCount = recipientsFor_(recordId).length;

  return { record: detail, tasks: tasks, lanes: laneSummary_(raw) };
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

function apiCompleteTask(taskId, outputValue, noteText) {
  const t = findTask_(taskId);
  if (!t) throw new Error('Task not found.');
  assertCanAct_(t.ownerRole, t.label);
  completeTask(taskId, outputValue, noteText);
  return getRecord(t.recordId);
}

function apiSkipTask(taskId, reason) {
  const t = findTask_(taskId);
  if (!t) throw new Error('Task not found.');
  assertCanAct_(t.ownerRole, t.label);
  skipTask(taskId, reason);
  return getRecord(t.recordId);
}

function apiNote(taskId, noteText) {
  const t = findTask_(taskId);
  if (!t) throw new Error('Task not found.');
  addTaskNote(taskId, noteText);
  return getRecord(t.recordId);
}

function apiSendWelcome(taskId, tempPassword) {
  const t = findTask_(taskId);
  if (!t) throw new Error('Task not found.');
  assertCanAct_(t.ownerRole, t.label);
  sendWelcomeEmail(taskId, tempPassword);
  return getRecord(t.recordId);
}

function apiAddTask(recordId, label, ownerRole, assignedTo) {
  if (!label) throw new Error('Give the step a name.');
  addCustomTask(recordId, label, ownerRole, assignedTo);
  return getRecord(recordId);
}

function apiAssignTask(taskId, email) {
  const t = findTask_(taskId);
  if (!t) throw new Error('Task not found.');
  assignTask(taskId, email);
  return getRecord(t.recordId);
}

function apiCreateRecord(payload) {
  return getRecord(createRecord(payload));
}

function apiUpdateField(recordId, field, value) {
  if (RECORD_HEADERS.indexOf(field) === -1) throw new Error('Unknown field: ' + field);
  const rec = findRecord_(recordId);
  if (!rec) throw new Error('Record not found.');
  writeCell_(SHEETS.RECORDS, rec._row, field, value);
  log_(recordId, 'FIELD_EDIT', field + ' → ' + value);
  return getRecord(recordId);
}

function apiSendUpdateNow(recordId) {
  const result = sendUpdateNow(recordId);
  const detail = getRecord(recordId);
  detail.flash = 'Update sent to ' + result.recipients +
    (result.recipients === 1 ? ' person' : ' people') + '.';
  return detail;
}

function apiCancelRecord(recordId, reason) {
  const rec = findRecord_(recordId);
  if (!rec) throw new Error('Record not found.');
  writeCell_(SHEETS.RECORDS, rec._row, 'status', 'Cancelled');
  writeCell_(SHEETS.RECORDS, rec._row, 'notes',
    String(rec.notes || '') + ' | Cancelled: ' + (reason || ''));
  log_(recordId, 'RECORD_CANCELLED', reason || '');
  return getRecord(recordId);
}
