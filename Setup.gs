/**********************************************************************
 * StaffFlow — Roy-Hart Staff Onboarding & Change Workflow
 * Setup.gs — run ONCE from the editor: setupStaffFlow()
 *
 * Model: the district secretary files what she knows. Every lane then
 * works in parallel — no lane waits on another. One shared status page.
 * One end-of-day email to everyone, and only if something moved.
 *
 * Deployment:
 *   Deploy > New deployment > Web app
 *   Execute as: Me        Who has access: Anyone at royhart.org
 *   Paste the /exec URL into the WEBAPP_URL script property.
 **********************************************************************/

const SHEETS = {
  RECORDS:   'Records',
  TASKS:     'Tasks',
  CATALOG:   'TaskCatalog',
  PROFILES:  'Profiles',
  TEMPLATES: 'Templates',
  ROLES:     'Roles',
  PEOPLE:    'People',
  LOG:       'Log'
};

const RECORD_HEADERS = [
  'recordId', 'requestType', 'status', 'createdAt', 'createdBy', 'effectiveDate',
  'legalFirst', 'legalLast', 'preferredName', 'formerName',
  'personalEmail', 'personalPhone', 'address1', 'city', 'state', 'zip',
  'positionTitle', 'profileKeys', 'buildings', 'fte', 'employmentType',
  'supervisorEmail', 'replacingWhom', 'priorEmployee',
  'employeeId', 'districtEmail', 'phoneExtension', 'roomNumber', 'deviceAssetTag',
  'changeSummary', 'notes', 'lastDigestAt'
];

const TASK_HEADERS = [
  'taskId', 'recordId', 'taskKey', 'label', 'ownerRole', 'assignedTo', 'sortOrder',
  'dependsOn', 'outputField', 'status', 'completedBy', 'completedAt', 'outputValue', 'notes'
];

const CATALOG_HEADERS = [
  'taskKey', 'label', 'ownerRole', 'assignedTo', 'sortOrder', 'dependsOn',
  'outputField', 'instructions', 'active'
];

const PROFILE_HEADERS = ['profileKey', 'profileLabel', 'profileType', 'active'];
/* Roles.emails is for shared mailboxes only (helpdesk@, districtoffice@).
 * Named individuals live on the People tab. */
const ROLE_HEADERS    = ['roleKey', 'roleLabel', 'emails', 'sortOrder'];
const PEOPLE_HEADERS  = ['email', 'name', 'title', 'roleKeys', 'active'];
const LOG_HEADERS     = ['timestamp', 'actor', 'recordId', 'action', 'detail'];

/* ------------------------------------------------------------------ */
/* The five lanes                                                      */
/* ------------------------------------------------------------------ */

const SEED_ROLES = [
  ['SECRETARY',      'District Secretary',    '', 1],
  ['REGISTRAR',      'District Registrar',    '', 2],
  ['TECH',           'Technology Department', '', 3],
  ['BUILDING_ADMIN', 'Building Admin',        '', 4],
  ['DEPT_ADMIN',     'Department Admin',      '', 5]
];

/* taskKey, label, ownerRole, sortOrder, dependsOn, instructions, outputField?
 * dependsOn is only ever used WITHIN one lane. No lane waits on another. */
const SEED_CATALOG = [
  // --- District secretary ---
  ['SEC_PACKET',      'Payroll and benefits packet complete',   'SECRETARY', 10, '', 'W-4, IT-2104, direct deposit, retirement election.'],
  ['SEC_CLEARANCE',   'Fingerprint / TEACH clearance verified', 'SECRETARY', 11, '', 'Confirm the clearance is on file before the start date.'],
  ['SEC_BOARD',       'Board approval confirmed',               'SECRETARY', 12, '', 'Put the approval date in the note.'],
  ['SEC_FRONTLINE',   'Frontline absence management profile',   'SECRETARY', 13, '', ''],
  ['SEC_READY',       'Confirm ready for day one',              'SECRETARY', 90, '', 'Final sign-off. Close this once the status page is green.'],

  // --- Registrar ---
  ['REG_ENTER',       'Enter employee in eSchoolData',          'REGISTRAR', 20, '', 'Enter demographics, address and phone, then record the Employee ID below.', 'employeeId'],
  ['REG_SECURITY',    'Assign eSchoolData security profile',    'REGISTRAR', 21, 'REG_ENTER', 'Match the profile to the position and student-data needs.'],

  // --- Technology ---
  ['TECH_PRIOR',      'Check for a dormant prior account',      'TECH', 30, '', 'Returning staff, subs and retirees often have an account to reactivate rather than recreate.'],
  ['TECH_ACCOUNT',    'Create Google Workspace account',        'TECH', 31, '', 'District naming convention. Never record the temporary password in this sheet.', 'districtEmail'],
  ['TECH_LICENSE',    'Apply Microsoft 365 license',            'TECH', 32, 'TECH_ACCOUNT', ''],
  ['TECH_GROUPS',     'Add to Google Groups (Admin console)',   'TECH', 33, 'TECH_ACCOUNT', 'Only groups that are NOT populated by the AD sync.'],
  ['TECH_GROUPS_AD',  'Add to AD-synced groups',                'TECH', 34, 'TECH_ACCOUNT', 'These sync from Active Directory. Edit membership in AD, not the Google Admin console.'],
  ['TECH_DEVICE',     'Assign device and record asset tag',     'TECH', 35, '', 'Log the serial in the tech inventory, then record the asset tag below.', 'deviceAssetTag'],
  ['TECH_PHONE',      'Program phone extension',                'TECH', 36, '', 'Record the extension below so the building and the website have it.', 'phoneExtension'],
  ['TECH_SMARTPASS',  'SmartPass account and role',             'TECH', 37, 'TECH_ACCOUNT', ''],
  ['TECH_PARENTSQ',   'ParentSquare staff account',             'TECH', 38, 'TECH_ACCOUNT', ''],
  ['TECH_SECURLY',    'Securly / Securly Classroom access',     'TECH', 39, 'TECH_ACCOUNT', 'Check whether the roster sync already covers this person.'],
  ['TECH_RAPTOR',     'Raptor account and raptor_* role group', 'TECH', 40, 'TECH_ACCOUNT', 'The raptor_* role groups are vendor-required. Do not remove them.'],
  ['TECH_DIRECTORY',  'Add to website staff directory',         'TECH', 41, 'TECH_ACCOUNT', ''],
  ['TECH_WELCOME',    'Send welcome email and credentials',     'TECH', 42, 'TECH_ACCOUNT,TECH_DEVICE', 'Goes to the personal email on file. The password composes the message and is never stored.'],
  ['TECH_ORIENT',     'Schedule technology orientation',        'TECH', 43, '', ''],

  // --- Building admin ---
  ['BLDG_ROOM',       'Assign room or workspace',               'BUILDING_ADMIN', 50, '', '', 'roomNumber'],
  ['BLDG_KEYS',       'Issue keys or fob',                      'BUILDING_ADMIN', 51, 'BLDG_ROOM', ''],
  ['BLDG_MAILBOX',    'Mailbox and nameplate',                  'BUILDING_ADMIN', 52, 'BLDG_ROOM', ''],
  ['BLDG_BADGE',      'ID badge photo and printing',            'BUILDING_ADMIN', 53, '', ''],
  ['BLDG_PARKING',    'Parking and lot access',                 'BUILDING_ADMIN', 54, '', ''],

  // --- Department admin ---
  ['DEPT_PLAN',       'First-day plan, schedule and duties',    'DEPT_ADMIN', 60, '', ''],
  ['DEPT_MENTOR',     'Assign mentor or buddy',                 'DEPT_ADMIN', 61, '', ''],

  // --- Staff change ---
  ['UPD_REG_NAME',    'Update legal name in eSchoolData',       'REGISTRAR', 70, '', 'Documentation must be on file with the district secretary first.'],
  ['UPD_REG_DEMO',    'Update address and phone in eSchoolData', 'REGISTRAR', 71, '', ''],
  ['UPD_REG_ASSIGN',  'Update building or position in eSchoolData', 'REGISTRAR', 72, '', ''],
  ['UPD_SEC_PAYROLL', 'Update payroll and benefits records',    'SECRETARY', 73, '', ''],
  ['UPD_TECH_AD',     'Update name in Active Directory',        'TECH', 74, '', 'AD is the source of truth for synced groups, so it changes before Google.'],
  ['UPD_TECH_GOOGLE', 'Rename Google account, keep old alias',  'TECH', 75, 'UPD_TECH_AD', 'Keep the former address as an alias so mail keeps arriving.', 'districtEmail'],
  ['UPD_TECH_APPS',   'Update name in SmartPass, ParentSquare, Securly, Raptor', 'TECH', 76, 'UPD_TECH_GOOGLE', ''],
  ['UPD_TECH_GROUPS', 'Move mailing groups to new role or building', 'TECH', 77, '', 'Check whether each group is AD-synced before editing.'],
  ['UPD_TECH_DEVICE', 'Update device assignment or location',   'TECH', 78, '', '', 'deviceAssetTag'],

  // --- Departure ---
  ['OFF_LAST_DAY',    'Confirm last working day',               'SECRETARY', 80, '', ''],
  ['OFF_REG_TERM',    'Terminate record in eSchoolData',        'REGISTRAR', 81, '', ''],
  ['OFF_TECH_SUSPEND','Suspend account and reset password',     'TECH', 82, '', 'Suspend, do not delete. Not before the confirmed last working day.'],
  ['OFF_TECH_GROUPS', 'Remove from mailing groups (Google and AD)', 'TECH', 83, 'OFF_TECH_SUSPEND', ''],
  ['OFF_TECH_APPS',   'Deactivate app accounts',                'TECH', 84, 'OFF_TECH_SUSPEND', 'SmartPass, ParentSquare, Securly, Raptor, Frontline.'],
  ['OFF_TECH_FWD',    'Set mail forwarding or delegate access', 'TECH', 85, 'OFF_TECH_SUSPEND', 'Supervisor-approved and time-limited.'],
  ['OFF_TECH_DIR',    'Remove from website staff directory',    'TECH', 86, '', ''],
  ['OFF_BLDG_RETURN', 'Collect device, keys, fob and badge',    'BUILDING_ADMIN', 87, '', '']
];

const SEED_PROFILES = [
  ['HS_TEACHER',        'High School Teacher',        'POSITION'],
  ['MS_TEACHER',        'Middle School Teacher',      'POSITION'],
  ['ELEM_TEACHER',      'Elementary Teacher',         'POSITION'],
  ['ADMINISTRATOR',     'Administrator',              'POSITION'],
  ['TEACHING_ASSISTANT','Teaching Assistant / Aide',  'POSITION'],
  ['CLERICAL',          'Clerical / Secretarial',     'POSITION'],
  ['NURSE',             'School Nurse / Health',      'POSITION'],
  ['CUSTODIAL',         'Custodial / Maintenance',    'POSITION'],
  ['FOOD_SERVICE',      'Food Service',               'POSITION'],
  ['TRANSPORTATION',    'Transportation',             'POSITION'],
  ['COACH_ADVISOR',     'Coach / Club Advisor',       'POSITION'],
  ['LONG_TERM_SUB',     'Long-Term Substitute',       'POSITION'],
  ['SUBSTITUTE',        'Day-to-Day Substitute',      'POSITION'],
  ['CHG_NAME',          'Name change',                'CHANGE'],
  ['CHG_ADDRESS',       'Address or phone change',    'CHANGE'],
  ['CHG_BUILDING',      'Building or room change',    'CHANGE'],
  ['CHG_POSITION',      'Position or assignment change', 'CHANGE'],
  ['CHG_DEPARTURE',     'Departure / offboarding',    'CHANGE']
];

const BASE = [
  'SEC_PACKET', 'SEC_CLEARANCE', 'SEC_BOARD', 'SEC_FRONTLINE', 'SEC_READY',
  'REG_ENTER', 'REG_SECURITY',
  'TECH_PRIOR', 'TECH_ACCOUNT', 'TECH_LICENSE', 'TECH_GROUPS', 'TECH_GROUPS_AD',
  'TECH_RAPTOR', 'TECH_WELCOME',
  'BLDG_BADGE', 'BLDG_MAILBOX'
];
const CLASSROOM = [
  'TECH_DEVICE', 'TECH_PHONE', 'TECH_SMARTPASS', 'TECH_PARENTSQ', 'TECH_SECURLY',
  'TECH_DIRECTORY', 'TECH_ORIENT', 'BLDG_ROOM', 'BLDG_KEYS', 'DEPT_PLAN', 'DEPT_MENTOR'
];
const OFFICE = [
  'TECH_DEVICE', 'TECH_PHONE', 'TECH_PARENTSQ', 'TECH_DIRECTORY', 'TECH_ORIENT',
  'BLDG_ROOM', 'BLDG_KEYS', 'DEPT_PLAN'
];

const PROFILE_TASKS = {
  HS_TEACHER:         BASE.concat(CLASSROOM),
  MS_TEACHER:         BASE.concat(CLASSROOM),
  ELEM_TEACHER:       BASE.concat(CLASSROOM),
  ADMINISTRATOR:      BASE.concat(OFFICE, ['TECH_SMARTPASS', 'TECH_SECURLY', 'BLDG_PARKING']),
  TEACHING_ASSISTANT: BASE.concat(['TECH_DEVICE', 'TECH_SECURLY', 'TECH_SMARTPASS', 'TECH_ORIENT',
                                   'BLDG_ROOM', 'BLDG_KEYS', 'DEPT_PLAN', 'DEPT_MENTOR']),
  CLERICAL:           BASE.concat(OFFICE),
  NURSE:              BASE.concat(OFFICE, ['TECH_SMARTPASS']),
  CUSTODIAL:          BASE.concat(['BLDG_KEYS', 'BLDG_PARKING', 'DEPT_PLAN']),
  FOOD_SERVICE:       BASE.concat(['BLDG_KEYS', 'DEPT_PLAN']),
  TRANSPORTATION:     BASE.concat(['BLDG_KEYS', 'BLDG_PARKING', 'DEPT_PLAN']),
  COACH_ADVISOR:      ['SEC_CLEARANCE', 'SEC_BOARD', 'SEC_READY', 'REG_ENTER', 'TECH_PRIOR',
                       'TECH_ACCOUNT', 'TECH_GROUPS', 'TECH_GROUPS_AD', 'TECH_RAPTOR',
                       'TECH_WELCOME', 'BLDG_KEYS', 'DEPT_PLAN'],
  LONG_TERM_SUB:      BASE.concat(CLASSROOM),
  SUBSTITUTE:         ['SEC_PACKET', 'SEC_CLEARANCE', 'SEC_FRONTLINE', 'SEC_READY', 'REG_ENTER',
                       'TECH_PRIOR', 'TECH_ACCOUNT', 'TECH_GROUPS', 'TECH_RAPTOR',
                       'TECH_WELCOME', 'BLDG_BADGE'],

  CHG_NAME:      ['UPD_REG_NAME', 'UPD_SEC_PAYROLL', 'UPD_TECH_AD', 'UPD_TECH_GOOGLE',
                  'UPD_TECH_APPS', 'TECH_DIRECTORY', 'BLDG_MAILBOX', 'BLDG_BADGE'],
  CHG_ADDRESS:   ['UPD_REG_DEMO', 'UPD_SEC_PAYROLL'],
  CHG_BUILDING:  ['UPD_REG_ASSIGN', 'UPD_TECH_GROUPS', 'UPD_TECH_DEVICE', 'TECH_PHONE',
                  'TECH_DIRECTORY', 'BLDG_ROOM', 'BLDG_KEYS', 'BLDG_MAILBOX', 'DEPT_PLAN'],
  CHG_POSITION:  ['UPD_REG_ASSIGN', 'REG_SECURITY', 'UPD_TECH_GROUPS', 'UPD_SEC_PAYROLL',
                  'TECH_LICENSE', 'TECH_DIRECTORY', 'DEPT_PLAN'],
  CHG_DEPARTURE: ['OFF_LAST_DAY', 'OFF_REG_TERM', 'OFF_TECH_SUSPEND', 'OFF_TECH_GROUPS',
                  'OFF_TECH_APPS', 'OFF_TECH_FWD', 'OFF_TECH_DIR', 'OFF_BLDG_RETURN']
};

/* ------------------------------------------------------------------ */

/**
 * Run once. Creates the workbook if this is a standalone project, then
 * builds every tab. Safe to re-run: existing data is never overwritten,
 * and any column added by a later version is appended.
 */
function setupStaffFlow() {
  const ss = resolveOrCreateWorkbook_();

  ensureSheet_(ss, SHEETS.RECORDS, RECORD_HEADERS);
  ensureSheet_(ss, SHEETS.TASKS,   TASK_HEADERS);
  ensureSheet_(ss, SHEETS.PEOPLE,  PEOPLE_HEADERS);
  ensureSheet_(ss, SHEETS.LOG,     LOG_HEADERS);

  const catalog = ensureSheet_(ss, SHEETS.CATALOG, CATALOG_HEADERS);
  if (catalog.getLastRow() < 2) {
    const rows = SEED_CATALOG.map(function (r) {
      return [r[0], r[1], r[2], '', r[3], r[4] || '', r[6] || '', r[5] || '', true];
    });
    catalog.getRange(2, 1, rows.length, CATALOG_HEADERS.length).setValues(rows);
  }

  const profiles = ensureSheet_(ss, SHEETS.PROFILES, PROFILE_HEADERS);
  if (profiles.getLastRow() < 2) {
    profiles.getRange(2, 1, SEED_PROFILES.length, PROFILE_HEADERS.length)
      .setValues(SEED_PROFILES.map(function (p) { return [p[0], p[1], p[2], true]; }));
  }

  const roles = ensureSheet_(ss, SHEETS.ROLES, ROLE_HEADERS);
  if (roles.getLastRow() < 2) {
    roles.getRange(2, 1, SEED_ROLES.length, ROLE_HEADERS.length).setValues(SEED_ROLES);
  }

  buildTemplateMatrix_(ss);
  installTriggers();
  formatSheets_(ss);
  removeDefaultSheet_(ss);

  const url = ss.getUrl();
  const msg = 'StaffFlow is set up.\n\nWorkbook: ' + url +
    '\n\nNext: deploy as a web app, paste the /exec URL into the WEBAPP_URL ' +
    'script property, then add your people on the admin tab.';
  Logger.log(msg);
  if (isBound_()) ss.toast('Setup complete. Deploy the web app next.', 'StaffFlow', 8);
  return msg;
}

/**
 * Bound project → the containing Sheet.
 * Standalone with SPREADSHEET_ID → that workbook.
 * Standalone with nothing → creates one and records its ID.
 */
function resolveOrCreateWorkbook_() {
  seedScriptProperties_();
  const props = PropertiesService.getScriptProperties();

  const active = SpreadsheetApp.getActive();
  if (active) {
    props.setProperty('SPREADSHEET_ID', active.getId());
    return active;
  }

  const id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* fall through and make a new one */ }
  }

  const ss = SpreadsheetApp.create('Staff Workflow — ' + prop_('DISTRICT_NAME', 'Roy-Hart'));
  props.setProperty('SPREADSHEET_ID', ss.getId());
  Logger.log('Created a new workbook: ' + ss.getUrl());
  return ss;
}

/** A freshly created spreadsheet arrives with an empty "Sheet1". */
function removeDefaultSheet_(ss) {
  const junk = ss.getSheetByName('Sheet1');
  if (!junk) return;
  if (ss.getSheets().length <= 1) return;
  if (junk.getLastRow() === 0 && junk.getLastColumn() === 0) ss.deleteSheet(junk);
}

/**
 * Creates the sheet if missing, and appends any header this version adds
 * that an older sheet does not have yet. Existing data is left alone.
 */
function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const have = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const missing = headers.filter(function (h) { return have.indexOf(h) === -1; });
    if (missing.length) {
      sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    }
  }
  sh.setFrozenRows(1);
  return sh;
}

function buildTemplateMatrix_(ss) {
  let sh = ss.getSheetByName(SHEETS.TEMPLATES);
  if (sh && sh.getLastRow() > 1) return;
  if (!sh) sh = ss.insertSheet(SHEETS.TEMPLATES);

  const profileKeys = SEED_PROFILES.map(function (p) { return p[0]; });
  const taskKeys    = SEED_CATALOG.map(function (t) { return t[0]; });
  const header = ['taskKey'].concat(profileKeys);
  const rows = taskKeys.map(function (tk) {
    return [tk].concat(profileKeys.map(function (pk) {
      return (PROFILE_TASKS[pk] || []).indexOf(tk) > -1 ? 'X' : '';
    }));
  });

  sh.clear();
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
}

function seedScriptProperties_() {
  const props = PropertiesService.getScriptProperties();
  const defaults = {
    SPREADSHEET_ID:     '',
    DISTRICT_NAME:      'Royalton-Hartland Central School District',
    FROM_NAME:          'Roy-Hart Staff Workflow',
    WEBAPP_URL:         '',
    DIGEST_HOUR:        '16',
    ADMIN_EMAILS:       '',
    STRICT_PERMISSIONS: 'false',
    LOGO_URL:           'https://files.smartsites.parentsquare.com/4898/img_pd_102121_mxvilf.png'
  };
  Object.keys(defaults).forEach(function (k) {
    if (!props.getProperty(k)) props.setProperty(k, defaults[k]);
  });
}

function formatSheets_(ss) {
  Object.keys(SHEETS).forEach(function (k) {
    const sh = ss.getSheetByName(SHEETS[k]);
    if (!sh) return;
    sh.getRange(1, 1, 1, sh.getMaxColumns())
      .setBackground('#63419A').setFontColor('#FFFFFF').setFontWeight('bold');
  });
}

/** One trigger, one job: the end-of-day digest. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyDigest').timeBased()
    .atHour(Number(prop_('DIGEST_HOUR', '16'))).everyDays(1).create();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('StaffFlow')
    .addItem('Open status page', 'openBoard_')
    .addSeparator()
    .addItem('Run setup (first time only)', 'setupStaffFlow')
    .addItem('Rebuild position templates', 'rebuildTemplates_')
    .addItem('Send today\u2019s digest now', 'dailyDigest')
    .addToUi();
}

function openBoard_() {
  const url = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL');
  if (!url) {
    SpreadsheetApp.getUi().alert('Add your deployed web app URL to the WEBAPP_URL script property first.');
    return;
  }
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput('<p style="font-family:system-ui;font-size:14px">' +
      '<a href="' + url + '" target="_blank" rel="noopener">Open the status page</a></p>')
      .setWidth(320).setHeight(90), 'StaffFlow');
}

function rebuildTemplates_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(SHEETS.TEMPLATES);
  if (sh) ss.deleteSheet(sh);
  buildTemplateMatrix_(ss);
  if (isBound_()) ss.toast('Templates rebuilt.', 'StaffFlow', 5);
}
