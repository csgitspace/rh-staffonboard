/**********************************************************************
 * StaffFlow — Admin.gs
 * Editing the task catalog, the position templates and the lanes from
 * the web app instead of the Sheet. Plus the printable overview.
 **********************************************************************/

/**
 * Admin access. Set ADMIN_EMAILS to a comma-separated list once you are
 * past rollout; while it is blank anyone in the domain can edit, which
 * is what you want in week one.
 */
function isAdmin_() {
  const list = String(prop_('ADMIN_EMAILS', '')).toLowerCase().split(/[,;\s]+/).filter(Boolean);
  if (!list.length) return true;
  return list.indexOf(currentUser_().toLowerCase()) > -1;
}

function assertAdmin_() {
  if (!isAdmin_()) throw new Error('Editing the workflow is limited to the addresses in ADMIN_EMAILS.');
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

function getAdminData() {
  assertAdmin_();
  const roles = readSheet_(SHEETS.ROLES)
    .sort(function (a, b) { return (Number(a.sortOrder) || 99) - (Number(b.sortOrder) || 99); });
  const profiles = readSheet_(SHEETS.PROFILES);
  const template = getTemplateMap_();
  const allTasks = readSheet_(SHEETS.TASKS);

  const usage = {};
  allTasks.forEach(function (t) {
    if (!usage[t.taskKey]) usage[t.taskKey] = { total: 0, open: 0 };
    usage[t.taskKey].total++;
    if (t.status !== 'Done' && t.status !== 'N/A') usage[t.taskKey].open++;
  });

  const inProfiles = {};
  Object.keys(template).forEach(function (pk) {
    template[pk].forEach(function (tk) {
      if (!inProfiles[tk]) inProfiles[tk] = [];
      inProfiles[tk].push(pk);
    });
  });

  const catalog = readSheet_(SHEETS.CATALOG)
    .sort(function (a, b) { return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0); })
    .map(function (c) {
      return {
        taskKey: c.taskKey,
        label: c.label,
        ownerRole: c.ownerRole,
        sortOrder: Number(c.sortOrder) || 0,
        dependsOn: c.dependsOn || '',
        outputField: c.outputField || '',
        instructions: c.instructions || '',
        assignedTo: c.assignedTo || '',
        assignedName: c.assignedTo ? personName_(c.assignedTo) : '',
        active: c.active !== false,
        usedOn: usage[c.taskKey] ? usage[c.taskKey].total : 0,
        openOn: usage[c.taskKey] ? usage[c.taskKey].open : 0,
        profiles: inProfiles[c.taskKey] || []
      };
    });

  const people = readSheet_(SHEETS.PEOPLE).filter(function (p) { return p.email; });
  const assignedCount = {};
  allTasks.forEach(function (t) {
    if (!t.assignedTo || t.status === 'Done' || t.status === 'N/A') return;
    const k = String(t.assignedTo).toLowerCase();
    assignedCount[k] = (assignedCount[k] || 0) + 1;
  });

  return {
    isAdmin: true,
    roles: roles.map(function (r) {
      return {
        key: r.roleKey, label: r.roleLabel, emails: r.emails || '',
        memberCount: peopleForRole_(r.roleKey).length
      };
    }),
    people: people.map(function (p) {
      return {
        email: String(p.email).trim(),
        name: p.name || String(p.email).split('@')[0],
        title: p.title || '',
        roleKeys: String(p.roleKeys || '').split(/[,;\s]+/).filter(Boolean),
        active: p.active !== false,
        openTasks: assignedCount[String(p.email).toLowerCase().trim()] || 0
      };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
    profiles: profiles.map(function (p) {
      return {
        key: p.profileKey, label: p.profileLabel, type: p.profileType,
        active: p.active !== false, taskCount: (template[p.profileKey] || []).length
      };
    }),
    catalog: catalog,
    recordFields: RECORD_HEADERS.filter(function (h) {
      return ['employeeId', 'districtEmail', 'phoneExtension', 'roomNumber', 'deviceAssetTag'].indexOf(h) > -1;
    })
  };
}

/* ------------------------------------------------------------------ */
/* Task catalog                                                        */
/* ------------------------------------------------------------------ */

function slugKey_(label, ownerRole) {
  const prefix = String(ownerRole || 'X').split('_')[0].slice(0, 4).toUpperCase();
  const body = String(label).toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '').split('_').slice(0, 3).join('_');
  let key = prefix + '_' + body;
  const existing = getCatalog_();
  let n = 2;
  while (existing[key]) key = prefix + '_' + body + '_' + (n++);
  return key.slice(0, 40);
}

/**
 * Creates or updates one catalog row. Pass taskKey to update, omit it to
 * create. A dependency pointing at another lane is rejected here rather
 * than silently dropped later.
 */
function adminSaveTask(t) {
  assertAdmin_();
  if (!t.label || !String(t.label).trim()) throw new Error('The step needs a name.');
  if (!t.ownerRole) throw new Error('Choose which office owns the step.');
  if (!getRoles_()[t.ownerRole]) throw new Error('Unknown office: ' + t.ownerRole);

  const catalog = getCatalog_();
  const deps = String(t.dependsOn || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  deps.forEach(function (d) {
    if (!catalog[d]) throw new Error('No step called ' + d + '.');
    if (catalog[d].ownerRole !== t.ownerRole) {
      throw new Error('"' + catalog[d].label + '" belongs to a different office. ' +
        'Steps can only wait on other steps in their own office — that is what keeps the lanes parallel.');
    }
  });
  if (deps.indexOf(t.taskKey) > -1) throw new Error('A step cannot wait on itself.');

  const sheet = sh_(SHEETS.CATALOG);
  const rows = readSheet_(SHEETS.CATALOG);
  const existing = t.taskKey ? rows.filter(function (r) { return r.taskKey === t.taskKey; })[0] : null;

  const key = existing ? existing.taskKey : slugKey_(t.label, t.ownerRole);
  const sortOrder = t.sortOrder !== undefined && t.sortOrder !== ''
    ? Number(t.sortOrder)
    : nextSortOrderFor_(t.ownerRole);

  let assignedTo = String(t.assignedTo || '').trim();
  if (assignedTo) {
    const hit = getPeople_().filter(function (p) {
      return p.email.toLowerCase() === assignedTo.toLowerCase(); })[0];
    if (!hit) throw new Error('No one on the People tab has that address.');
    if (hit.roleKeys.indexOf(t.ownerRole) === -1) {
      throw new Error(hit.name + ' is not in that office, so they cannot be its default owner.');
    }
    assignedTo = hit.email;
  }

  const values = [key, t.label, t.ownerRole, assignedTo, sortOrder, deps.join(','),
                  t.outputField || '', t.instructions || '',
                  t.active === undefined ? true : !!t.active];

  if (existing) {
    sheet.getRange(existing._row, 1, 1, CATALOG_HEADERS.length).setValues([values]);
    log_('', 'CATALOG_EDIT', key + ' — ' + t.label);
  } else {
    sheet.appendRow(values);
    addTemplateRow_(key);
    log_('', 'CATALOG_ADD', key + ' — ' + t.label);
  }
  _catalogCache = null;
  return getAdminData();
}

/** Puts a new step at the end of its own lane's block. */
function nextSortOrderFor_(ownerRole) {
  let max = 0;
  readSheet_(SHEETS.CATALOG).forEach(function (c) {
    if (c.ownerRole === ownerRole) max = Math.max(max, Number(c.sortOrder) || 0);
  });
  return max ? max + 1 : 95;
}

/**
 * Retires a step that is in use anywhere; hard-deletes one that has never
 * been used. Retiring keeps history intact on the records that already
 * carry it and stops it appearing on new ones.
 */
function adminDeleteTask(taskKey) {
  assertAdmin_();
  const rows = readSheet_(SHEETS.CATALOG);
  const row = rows.filter(function (r) { return r.taskKey === taskKey; })[0];
  if (!row) throw new Error('Step not found.');

  const dependents = rows.filter(function (r) {
    return String(r.dependsOn || '').split(',').map(function (s) { return s.trim(); }).indexOf(taskKey) > -1;
  });
  if (dependents.length) {
    throw new Error('"' + dependents[0].label + '" is waiting on this step. ' +
      'Clear that dependency first.');
  }

  const used = readSheet_(SHEETS.TASKS).some(function (t) { return t.taskKey === taskKey; });
  if (used) {
    writeCell_(SHEETS.CATALOG, row._row, 'active', false);
    clearTemplateRow_(taskKey);
    log_('', 'CATALOG_RETIRE', taskKey);
    _catalogCache = null;
    const d = getAdminData();
    d.flash = '"' + row.label + '" is on records already, so it has been retired rather than deleted. ' +
      'It will not appear on anything new, and the history stays intact.';
    return d;
  }

  sh_(SHEETS.CATALOG).deleteRow(row._row);
  deleteTemplateRow_(taskKey);
  log_('', 'CATALOG_DELETE', taskKey);
  _catalogCache = null;
  const d = getAdminData();
  d.flash = '"' + row.label + '" deleted. It had never been used on a record.';
  return d;
}

function adminRestoreTask(taskKey) {
  assertAdmin_();
  const row = readSheet_(SHEETS.CATALOG).filter(function (r) { return r.taskKey === taskKey; })[0];
  if (!row) throw new Error('Step not found.');
  writeCell_(SHEETS.CATALOG, row._row, 'active', true);
  log_('', 'CATALOG_RESTORE', taskKey);
  _catalogCache = null;
  return getAdminData();
}

/** Swaps sortOrder with the neighbouring step in the same lane. */
function adminMoveTask(taskKey, direction) {
  assertAdmin_();
  const rows = readSheet_(SHEETS.CATALOG)
    .sort(function (a, b) { return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0); });
  const me = rows.filter(function (r) { return r.taskKey === taskKey; })[0];
  if (!me) throw new Error('Step not found.');

  const lane = rows.filter(function (r) { return r.ownerRole === me.ownerRole; });
  const i = lane.map(function (r) { return r.taskKey; }).indexOf(taskKey);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= lane.length) return getAdminData();

  const other = lane[j];
  const a = Number(me.sortOrder) || 0, b = Number(other.sortOrder) || 0;
  writeCell_(SHEETS.CATALOG, me._row, 'sortOrder', b);
  writeCell_(SHEETS.CATALOG, other._row, 'sortOrder', a);
  _catalogCache = null;
  return getAdminData();
}

/* ------------------------------------------------------------------ */
/* Templates matrix                                                    */
/* ------------------------------------------------------------------ */

function templateSheet_() { return sh_(SHEETS.TEMPLATES); }

function templateHeader_() {
  const sh = templateSheet_();
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function templateRowFor_(taskKey) {
  const sh = templateSheet_();
  const keys = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let i = 1; i < keys.length; i++) if (keys[i][0] === taskKey) return i + 1;
  return 0;
}

function addTemplateRow_(taskKey) {
  if (templateRowFor_(taskKey)) return;
  const sh = templateSheet_();
  const width = sh.getLastColumn();
  const row = new Array(width).fill('');
  row[0] = taskKey;
  sh.getRange(sh.getLastRow() + 1, 1, 1, width).setValues([row]);
}

function clearTemplateRow_(taskKey) {
  const r = templateRowFor_(taskKey);
  if (!r) return;
  const sh = templateSheet_();
  const width = sh.getLastColumn();
  if (width > 1) sh.getRange(r, 2, 1, width - 1).clearContent();
}

function deleteTemplateRow_(taskKey) {
  const r = templateRowFor_(taskKey);
  if (r) templateSheet_().deleteRow(r);
}

/** Ticks or clears one cell of the grid. */
function adminSetTemplate(taskKey, profileKey, on) {
  assertAdmin_();
  const sh = templateSheet_();
  const col = templateHeader_().indexOf(profileKey) + 1;
  if (col < 1) throw new Error('Unknown profile: ' + profileKey);
  let row = templateRowFor_(taskKey);
  if (!row) { addTemplateRow_(taskKey); row = templateRowFor_(taskKey); }
  sh.getRange(row, col).setValue(on ? 'X' : '');
  log_('', 'TEMPLATE_EDIT', profileKey + (on ? ' + ' : ' - ') + taskKey);
  return getAdminData();
}

/**
 * Template edits do not reach records that are already open. This adds
 * any newly-templated steps to every active record using that profile.
 */
function adminBackfillProfile(profileKey) {
  assertAdmin_();
  const template = getTemplateMap_();
  const wanted = template[profileKey] || [];
  const catalog = getCatalog_();
  const allTasks = readSheet_(SHEETS.TASKS);
  const sh = sh_(SHEETS.TASKS);
  let added = 0, touched = 0;

  readSheet_(SHEETS.RECORDS).forEach(function (rec) {
    if (rec.status !== 'Active') return;
    if (String(rec.profileKeys || '').split(',').indexOf(profileKey) === -1) return;

    const have = allTasks.filter(function (t) { return t.recordId === rec.recordId; })
      .map(function (t) { return t.taskKey; });
    const missing = wanted.filter(function (tk) { return catalog[tk] && have.indexOf(tk) === -1; });
    if (!missing.length) return;
    touched++;

    missing.forEach(function (tk, i) {
      const c = catalog[tk];
      sh.getRange(sh.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([
        TASK_HEADERS.map(function (h) {
          switch (h) {
            case 'taskId':      return rec.recordId + '-B' + Utilities.formatString('%02d', have.length + i + 1);
            case 'recordId':    return rec.recordId;
            case 'taskKey':     return tk;
            case 'label':       return c.label;
            case 'ownerRole':   return c.ownerRole;
            case 'sortOrder':   return c.sortOrder;
            case 'dependsOn':   return '';
            case 'outputField': return c.outputField || '';
            case 'status':      return 'Open';
            default:            return '';
          }
        })
      ]);
      added++;
    });
    log_(rec.recordId, 'BACKFILL', missing.join(','));
  });

  const d = getAdminData();
  d.flash = added
    ? 'Added ' + added + ' ' + (added === 1 ? 'step' : 'steps') + ' across ' + touched +
      ' open ' + (touched === 1 ? 'record' : 'records') + '. They will show in tonight\u2019s update.'
    : 'Every open record using this profile already has all of its steps.';
  return d;
}

/* ------------------------------------------------------------------ */
/* Profiles and lanes                                                  */
/* ------------------------------------------------------------------ */

function adminSaveProfile(p) {
  assertAdmin_();
  if (!p.label || !String(p.label).trim()) throw new Error('The profile needs a name.');
  const sheet = sh_(SHEETS.PROFILES);
  const rows = readSheet_(SHEETS.PROFILES);
  const existing = p.key ? rows.filter(function (r) { return r.profileKey === p.key; })[0] : null;

  if (existing) {
    sheet.getRange(existing._row, 1, 1, PROFILE_HEADERS.length)
      .setValues([[existing.profileKey, p.label, p.type || existing.profileType,
                   p.active === undefined ? true : !!p.active]]);
    log_('', 'PROFILE_EDIT', existing.profileKey);
  } else {
    let key = String(p.label).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    const taken = rows.map(function (r) { return r.profileKey; });
    let n = 2; const base = key;
    while (taken.indexOf(key) > -1) key = base + '_' + (n++);
    sheet.appendRow([key, p.label, p.type || 'POSITION', true]);
    addTemplateColumn_(key);
    log_('', 'PROFILE_ADD', key);
  }
  return getAdminData();
}

function addTemplateColumn_(profileKey) {
  const sh = templateSheet_();
  const col = sh.getLastColumn() + 1;
  sh.getRange(1, col).setValue(profileKey);
}

function adminDeleteProfile(profileKey) {
  assertAdmin_();
  const row = readSheet_(SHEETS.PROFILES).filter(function (r) { return r.profileKey === profileKey; })[0];
  if (!row) throw new Error('Profile not found.');
  const used = readSheet_(SHEETS.RECORDS).some(function (r) {
    return String(r.profileKeys || '').split(',').indexOf(profileKey) > -1;
  });
  if (used) {
    writeCell_(SHEETS.PROFILES, row._row, 'active', false);
    log_('', 'PROFILE_RETIRE', profileKey);
    const d = getAdminData();
    d.flash = '"' + row.profileLabel + '" is on existing records, so it has been hidden from the ' +
      'new-request form rather than deleted.';
    return d;
  }
  sh_(SHEETS.PROFILES).deleteRow(row._row);
  const sh = templateSheet_();
  const col = templateHeader_().indexOf(profileKey) + 1;
  if (col > 1) sh.deleteColumn(col);
  log_('', 'PROFILE_DELETE', profileKey);
  const d = getAdminData();
  d.flash = '"' + row.profileLabel + '" deleted.';
  return d;
}

function adminSaveRoleEmails(roleKey, emails) {
  assertAdmin_();
  const row = readSheet_(SHEETS.ROLES).filter(function (r) { return r.roleKey === roleKey; })[0];
  if (!row) throw new Error('Office not found.');
  writeCell_(SHEETS.ROLES, row._row, 'emails', String(emails || '').trim());
  log_('', 'ROLE_EDIT', roleKey);
  _rolesCache = null;
  return getAdminData();
}

/* ------------------------------------------------------------------ */
/* Printable employee overview                                         */
/* ------------------------------------------------------------------ */

/** Everything captured about one person, in the shape the print view wants. */
function getOverview(recordId) {
  const rec = findRecord_(recordId);
  if (!rec) throw new Error('Record not found.');
  const roles = getRoles_();
  const raw = readSheet_(SHEETS.TASKS).filter(function (t) { return t.recordId === recordId; });
  const tasks = raw.sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  });

  const lanes = laneSummary_(raw).map(function (l) {
    return {
      label: l.label,
      done: l.done,
      total: l.total,
      complete: l.complete,
      people: l.people,
      tasks: tasks.filter(function (t) { return t.ownerRole === l.roleKey; }).map(function (t) {
        return {
          label: t.label,
          status: t.status,
          assignedName: t.assignedTo ? personName_(t.assignedTo) : '',
          completedBy: t.completedBy ? personName_(t.completedBy) : '',
          completedAt: fmtDate_(t.completedAt),
          outputField: t.outputField,
          outputValue: t.outputValue,
          notes: t.notes
        };
      })
    };
  });

  return {
    recordId: rec.recordId,
    displayName: displayName_(rec),
    legalName: rec.legalFirst + ' ' + rec.legalLast,
    formerName: rec.formerName,
    requestType: rec.requestType,
    status: rec.status,
    progress: progressOf_(raw),
    openCount: raw.filter(function (t) { return t.status !== 'Done' && t.status !== 'N/A'; }).length,
    createdBy: String(rec.createdBy || '').split('@')[0],
    createdAt: fmtDateTime_(rec.createdAt),
    printedAt: fmtDateTime_(new Date()),
    printedBy: String(currentUser_()).split('@')[0],
    identity: [
      ['Legal name',        rec.legalFirst + ' ' + rec.legalLast],
      ['Preferred name',    rec.preferredName],
      ['Former name',       rec.formerName],
      ['Personal email',    rec.personalEmail],
      ['Personal phone',    rec.personalPhone],
      ['Address',           [rec.address1, rec.city, rec.state, rec.zip].filter(Boolean).join(', ')],
      ['Worked here before', rec.priorEmployee]
    ].filter(function (p) { return p[1]; }),
    assignment: [
      ['Position',        rec.positionTitle],
      ['Building(s)',     rec.buildings],
      ['Effective date',  fmtDate_(rec.effectiveDate)],
      ['FTE',             rec.fte],
      ['Employment type', rec.employmentType],
      ['Supervisor',      rec.supervisorEmail],
      ['Replacing',       rec.replacingWhom]
    ].filter(function (p) { return p[1]; }),
    issued: [
      ['Employee ID',    rec.employeeId],
      ['District email', rec.districtEmail],
      ['Phone extension', rec.phoneExtension],
      ['Room',           rec.roomNumber],
      ['Device asset tag', rec.deviceAssetTag]
    ],
    changeSummary: rec.changeSummary,
    notes: rec.notes,
    lanes: lanes
  };
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

/** Creates or updates one person. The email address is the key. */
function adminSavePerson(p) {
  assertAdmin_();
  const email = String(p.email || '').trim();
  if (!email || email.indexOf('@') === -1) throw new Error('A valid email address is required.');
  if (!p.name || !String(p.name).trim()) throw new Error('The person needs a name.');

  const roleKeys = [].concat(p.roleKeys || []).filter(Boolean);
  const roles = getRoles_();
  roleKeys.forEach(function (k) { if (!roles[k]) throw new Error('Unknown office: ' + k); });

  const sheet = sh_(SHEETS.PEOPLE);
  const rows = readSheet_(SHEETS.PEOPLE);
  const existing = rows.filter(function (r) {
    return String(r.email).toLowerCase().trim() === email.toLowerCase();
  })[0];

  const values = [email, String(p.name).trim(), p.title || '', roleKeys.join(','),
                  p.active === undefined ? true : !!p.active];

  if (existing) {
    sheet.getRange(existing._row, 1, 1, PEOPLE_HEADERS.length).setValues([values]);
    log_('', 'PERSON_EDIT', email + ' — ' + roleKeys.join(','));
  } else {
    sheet.appendRow(values);
    log_('', 'PERSON_ADD', email + ' — ' + roleKeys.join(','));
  }
  _peopleCache = null;

  const d = getAdminData();
  const orphaned = clearInvalidAssignments_();
  if (orphaned) {
    d.flash = orphaned + ' open ' + (orphaned === 1 ? 'step' : 'steps') +
      ' pointed at someone no longer in that office, so ' +
      (orphaned === 1 ? 'it is' : 'they are') + ' back with the office as a whole.';
    return getAdminData();
  }
  return d;
}

/**
 * Removing someone leaves their finished work attributed to them; only
 * their OPEN assignments are handed back to the office.
 */
function adminDeletePerson(email) {
  assertAdmin_();
  const target = String(email || '').toLowerCase().trim();
  const row = readSheet_(SHEETS.PEOPLE).filter(function (r) {
    return String(r.email).toLowerCase().trim() === target;
  })[0];
  if (!row) throw new Error('Person not found.');

  let handed = 0;
  readSheet_(SHEETS.TASKS).forEach(function (t) {
    if (String(t.assignedTo || '').toLowerCase().trim() !== target) return;
    if (t.status === 'Done' || t.status === 'N/A') return;
    writeCell_(SHEETS.TASKS, t._row, 'assignedTo', '');
    handed++;
  });

  readSheet_(SHEETS.CATALOG).forEach(function (c) {
    if (String(c.assignedTo || '').toLowerCase().trim() === target) {
      writeCell_(SHEETS.CATALOG, c._row, 'assignedTo', '');
    }
  });

  sh_(SHEETS.PEOPLE).deleteRow(row._row);
  log_('', 'PERSON_DELETE', email + ' — ' + handed + ' reassigned to office');
  _peopleCache = null; _catalogCache = null;

  const d = getAdminData();
  d.flash = row.name + ' removed. ' + (handed
    ? handed + ' open ' + (handed === 1 ? 'step is' : 'steps are') + ' back with the office as a whole. '
    : '') + 'Work they already closed still shows their name.';
  return d;
}

/** Adds or removes one person from one office. */
function adminSetPersonRole(email, roleKey, on) {
  assertAdmin_();
  const target = String(email || '').toLowerCase().trim();
  const row = readSheet_(SHEETS.PEOPLE).filter(function (r) {
    return String(r.email).toLowerCase().trim() === target;
  })[0];
  if (!row) throw new Error('Person not found.');
  if (!getRoles_()[roleKey]) throw new Error('Unknown office: ' + roleKey);

  const keys = String(row.roleKeys || '').split(/[,;\s]+/).filter(Boolean);
  const i = keys.indexOf(roleKey);
  if (on && i === -1) keys.push(roleKey);
  if (!on && i > -1) keys.splice(i, 1);

  writeCell_(SHEETS.PEOPLE, row._row, 'roleKeys', keys.join(','));
  log_('', 'PERSON_ROLE', email + (on ? ' + ' : ' - ') + roleKey);
  _peopleCache = null;

  const handed = clearInvalidAssignments_();
  const d = getAdminData();
  if (handed) {
    d.flash = handed + ' open ' + (handed === 1 ? 'step' : 'steps') +
      ' assigned to someone no longer in that office ' +
      (handed === 1 ? 'is' : 'are') + ' back with the office as a whole.';
  }
  return d;
}

/**
 * Any open step pointed at someone who has left that office goes back to
 * the office. Nothing silently keeps a stale owner.
 */
function clearInvalidAssignments_() {
  const people = {};
  getPeople_().forEach(function (p) { people[p.email.toLowerCase()] = p; });
  let cleared = 0;
  readSheet_(SHEETS.TASKS).forEach(function (t) {
    if (!t.assignedTo || t.status === 'Done' || t.status === 'N/A') return;
    const p = people[String(t.assignedTo).toLowerCase().trim()];
    if (!p || p.roleKeys.indexOf(t.ownerRole) === -1) {
      writeCell_(SHEETS.TASKS, t._row, 'assignedTo', '');
      cleared++;
    }
  });
  readSheet_(SHEETS.CATALOG).forEach(function (c) {
    if (!c.assignedTo) return;
    const p = people[String(c.assignedTo).toLowerCase().trim()];
    if (!p || p.roleKeys.indexOf(c.ownerRole) === -1) {
      writeCell_(SHEETS.CATALOG, c._row, 'assignedTo', '');
      _catalogCache = null;
    }
  });
  return cleared;
}
