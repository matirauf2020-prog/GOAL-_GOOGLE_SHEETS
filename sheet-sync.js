/* GoalOS Google Sheets — direct browser OAuth, no Drive/Mail/Apps Script. */
(function () {
  'use strict';
  const CONFIG_KEY = 'goalos.sheet.connection.v1';
  const SESSION_KEY = 'goalos.google.access.session.v1';
  const SHEET_LINK_KEY = 'goalos-sheet';
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  const API = 'https://sheets.googleapis.com/v4/spreadsheets';
  const STORE = 'GoalOS_State';
  const VIEWS = ['Transactions', 'Goals', 'Loans', 'Settings', 'Workbook_Archive'];
  const SIZE = 18000; // Unicode-safe codepoint chunks; each cell < 36k UTF-16 chars.
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const previous = (() => { try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch (_) { return {}; } })();
  let sheetId = previous.sheetId || '';
  let syncedRevision = previous.syncedRevision || '';
  let syncedHash = previous.syncedHash || '';
  let syncedAt = previous.syncedAt || '';
  let pending = Boolean(previous.pending);
  let manuallyDisconnected = Boolean(previous.manuallyDisconnected);
  let status = manuallyDisconnected ? 'Disconnected by you. Cloud data remains safe in Google Sheets.' : 'Your Sheet is remembered. Resume Google access to synchronize.';
  let error = '';
  let conflict = false;
  let busy = false;
  // Short-lived Google access tokens are scoped to this browser tab's session,
  // NEVER localStorage or GitHub files. sessionStorage survives a normal refresh.
  const restoredSession = (() => {
    if (manuallyDisconnected) return {};
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); } catch (_) { return {}; }
  })();
  let token = typeof restoredSession.token === 'string' && restoredSession.token.length > 10 ? restoredSession.token : '';
  let expiresAt = Number(restoredSession.expiresAt) || 0;
  if (Date.now() + 45000 >= expiresAt) { token = ''; expiresAt = 0; }

  let tokenClient = null;
  let timer = null;
  let helpers = null;

  function connected() { return !manuallyDisconnected && !!token && Date.now() + 45000 < expiresAt; }
  function persistSession() {
    try {
      if (connected()) sessionStorage.setItem(SESSION_KEY, JSON.stringify({token,expiresAt}));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (_) { /* private browsing may block storage; connect again next refresh */ }
  }
  function persistConnection() {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify({sheetId,syncedRevision,syncedHash,syncedAt,pending,manuallyDisconnected})); }
    catch (_) { /* browser cache may be unavailable */ }
  }
  // Send this URL to another device you own. The Sheet itself remains access-controlled by Google.
  function shareUrl() {
    if (!sheetId || typeof location === 'undefined') return '';
    return location.origin + location.pathname + '#' + SHEET_LINK_KEY + '=' + encodeURIComponent(sheetId);
  }
  function extractId(value) {
    const text=String(value||'').trim();
    const m=text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    const id=m?m[1]:text;
    return /^[A-Za-z0-9_-]{20,}$/.test(id)?id:'';
  }
  function readSheetHash() {
    try { return extractId(new URLSearchParams(location.hash.replace(/^#/, '')).get(SHEET_LINK_KEY) || ''); }
    catch (_) { return ''; }
  }
  // A private, shareable bookmark lets a NEW device pre-select the Sheet, not bypass Google sign-in.
  const fromHash = readSheetHash();
  if (fromHash && !sheetId && !manuallyDisconnected) { sheetId=fromHash;persistConnection(); }

  function alertUser(message) { if (helpers && helpers.toast) helpers.toast(message); }
  function renderStatus() {
    const chip = document.getElementById('cloudChip');
    if (chip) {
      const warning = !connected() || pending || conflict || !!error;
      chip.textContent = conflict ? 'Sync conflict' : error ? 'Sync error' : manuallyDisconnected ? 'Disconnected by you' : !connected() ? (sheetId ? 'Sheet remembered · Reauthorize' : 'Connect Google Sheets') : !sheetId ? 'Choose a Sheet' : busy ? 'Saving…' : pending ? 'Unsaved changes' : 'Saved to Sheets';
      chip.className = 'cloud-chip ' + (conflict || error ? 'error' : warning ? 'waiting' : 'saved');
      chip.title = status;
    }
    if (helpers && helpers.renderSettings) helpers.renderSettings();
  }
  function shortDate(value) { return value ? new Date(value).toLocaleString() : 'Never'; }
  function hashString(text) {
    let h = 0x811c9dc5;
    for (let i=0;i<text.length;i++) { h ^= text.charCodeAt(i); h = Math.imul(h,0x01000193); }
    return (h >>> 0).toString(16).padStart(8,'0');
  }
  function jsonData() { const d = helpers?.getData?.(); return d ? JSON.stringify(d) : ''; }
  function chunks(text) { const units = Array.from(text); const result = []; for(let i=0;i<units.length;i+=SIZE)result.push(units.slice(i,i+SIZE).join('')); return result; }
  function a1(title,cell) { return "'" + title.replace(/'/g,"''") + "'!" + cell; }
  function payloadRows(data, fields) {
    return [fields, ...data.map(row=>fields.map(k=>{
      const v = row[k];
      if (v === undefined || v === null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return typeof v === 'boolean' ? String(v) : v;
    }))];
  }
  function viewData(d) {
    const transactions = payloadRows(d.transactions || [], ['id','date','type','category','description','account','fromAccount','amount','notes']);
    const goals = payloadRows(d.tasks || [], ['id','title','category','priority','dueDate','status','blocker','remarks','history']);
    const loans = payloadRows(d.loans || [], ['id','person','type','issueDate','dueDate','principal','paid','status']);
    const settings = [['Setting','Value'], ...Object.entries(d.settings || {}).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):v])];
    const archive = [['Original sheet','Rows stored','Columns stored'], ...(d.sheets || []).map(s=>[String(s.name||''), Number(s.rows?.length||0),Number(s.columns?.length||s.columns||0) || 0])];
    return {Transactions:transactions, Goals:goals, Loans:loans, Settings:settings, Workbook_Archive:archive};
  }
  async function request(method, path, body) {
    if (!connected()) throw Error('Google authorization expired. Click Connect Google again.');
    const response = await fetch(API + path, {
      method,
      headers: {'Authorization':'Bearer '+ token, ...(body === undefined ? {} : {'Content-Type':'application/json; charset=UTF-8'})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})
    });
    const content = await response.text();
    let data = {};
    try { data = content ? JSON.parse(content) : {}; } catch (_) { data = {message:content}; }
    if (!response.ok) {
      if (response.status === 401) { token=''; expiresAt=0; persistSession(); status='Google authorization expired. Resume access to your remembered Sheet.'; }
      let reason = data?.error?.message || data?.message || ('Google Sheets returned '+response.status);
      throw Error(reason);
    }
    return data;
  }
  function sheetPath(path='') { if(!sheetId)throw Error('No Google Sheet selected.');return '/' + encodeURIComponent(sheetId) + path; }
  async function getRange(range) {
    return request('GET',sheetPath('/values/' + encodeURIComponent(range) + '?valueRenderOption=UNFORMATTED_VALUE'));
  }
  async function getHeader() {
    const values = (await getRange(a1(STORE,'A1:D3'))).values || [];
    if(values[0]?.[0] && values[0][0] !== 'GOALOS_STATE_V1')throw Error('This spreadsheet contains an unknown GoalOS data format.');
    return {active:String(values[0]?.[1] || ''), revision:String(values[0]?.[2] || ''), hash:String(values[0]?.[3] || ''),countA:Number(values[1]?.[0]||0),countB:Number(values[1]?.[1]||0),hashA:String(values[2]?.[0]||''),hashB:String(values[2]?.[1]||'')};
  }
  async function loadRemote(header) {
    const h = header || await getHeader();
    if(!['A','B'].includes(h.active))return null;
    const count = h.active==='A'?h.countA:h.countB;
    if (!Number.isSafeInteger(count) || count<1 || count>2500) throw Error('Saved data has an invalid chunk count.');
    const values = (await getRange(a1(STORE,`${h.active}5:${h.active}${4+count}`))).values || [];
    if (values.length<count) throw Error('The Sheet data is incomplete; your last valid saved version may be in the other slot.');
    const raw = values.slice(0,count).map(r=>String(r?.[0] ?? '')).join('');
    const expected = h.active==='A'?h.hashA:h.hashB;
    if(!expected || hashString(raw)!==expected || (h.hash && expected !== h.hash))throw Error('Sheet data checksum mismatch. No local data was overwritten.');
    const parsed=JSON.parse(raw);
    if(!parsed || !Array.isArray(parsed.transactions) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.loans))throw Error('Invalid GoalOS Sheet data format.');
    return {data:parsed,hash:expected,revision:h.revision};
  }
  async function ensureSheets() {
    const current = await request('GET',sheetPath('?fields=' + encodeURIComponent('sheets(properties(title)),spreadsheetUrl,properties(title)')));
    const names=new Set((current.sheets||[]).map(s=>s.properties.title));
    const missing=[STORE,...VIEWS].filter(n=>!names.has(n));
    if (missing.length) {
      await request('POST',sheetPath(':batchUpdate'),{requests:missing.map(name=>({addSheet:{properties:{title:name, ...(name===STORE?{hidden:true}:{})}}}))});
    }
    return current;
  }
  function linked(newId) {
    if(newId!==sheetId){sheetId=newId;syncedRevision='';syncedHash='';syncedAt='';pending=Boolean(jsonData());}
    manuallyDisconnected=false;
    conflict=false;error='';persistConnection();renderStatus();
  }
  async function checkConnectedSheet() {
    if(!sheetId) {status='Connected. Create a new private Sheet or paste an existing GoalOS Sheet URL.';renderStatus();return;}
    status='Checking your Google Sheet…';renderStatus();
    await ensureSheets();
    const header=await getHeader();
    const local=jsonData();
    const localHash=local?hashString(local):'';
    if(!header.active){
      conflict=false;
      status='The Sheet is ready.';
      renderStatus();
      if(local){await saveNow();}
      return;
    }
    if(!local){ await loadNow(false); return; }
    if(syncedRevision===header.revision && syncedHash===localHash){
      pending=false;error='';conflict=false;status='All changes are saved to Google Sheets.';
      persistConnection();renderStatus();return;
    }
    if(syncedRevision===header.revision && (pending || syncedHash!==localHash)){
      pending=true;status='Uploading edits made on this device…';renderStatus();await saveNow();return;
    }
    if(syncedRevision && syncedHash===localHash){await loadNow(false);return;}
    const remote=await loadRemote(header);
    if(remote.hash===localHash){syncedRevision=remote.revision;syncedHash=remote.hash;pending=false;conflict=false;error='';syncedAt=remote.revision.slice(0,24)||new Date().toISOString();status='Your browser and Google Sheet match.';persistConnection();renderStatus();return;}
    conflict=true;pending=true;status='Both this browser and the Google Sheet contain data. Choose Load from Sheet or Save this browser manually. Nothing has been overwritten.';
    renderStatus();
  }
  async function saveNow(force=false) {
    if(busy) { pending=true;persistConnection();return; }
    if(!connected()) {status='Reconnect Google; your changes are saved only in this browser.';renderStatus();return;}
    if(!sheetId) {status='Create or attach a private Google Sheet first.';renderStatus();return;}
    const raw=jsonData();
    if(!raw) {alertUser('Import or create your GoalOS workspace before saving.');return;}
    if(conflict && !force){status='Resolve the sync conflict before saving.';renderStatus();return;}
    busy=true;error='';status='Saving all records to Google Sheets…';renderStatus();
    try {
      await ensureSheets();
      const header=await getHeader();
      if(header.revision && header.revision!==syncedRevision){
        if(!force){conflict=true;pending=true;throw Error('The Google Sheet changed in another device. Choose Load from Sheet or force Save local after reviewing the conflict.');}
        if(!window.confirm('REPLACE the existing Google Sheet data with this browser’s current data? This will overwrite the other device’s changes.')){conflict=true;pending=true;status='Overwrite cancelled; choose which copy to keep.';return;}
      }
      const target=header.active==='A'?'B':'A';
      const parts=chunks(raw);
      if(parts.length>2500)throw Error('This workspace is too large for the configured Sheets storage. Export JSON first.');
      const digest=hashString(raw);
      const revision=new Date().toISOString()+'-'+Math.random().toString(36).slice(2,9);
      await request('POST',sheetPath('/values:batchUpdate'),{valueInputOption:'RAW',data:[
        {range:a1(STORE,'A1'),values:[['GOALOS_STATE_V1']]},
        {range:a1(STORE,target+'2'),values:[[parts.length]]},
        {range:a1(STORE,target+'3'),values:[[digest]]},
        {range:a1(STORE,`${target}5:${target}${parts.length+4}`),values:parts.map(c=>[c])}
      ]});
      // Readable tabs are mirrors. The hidden state remains the authoritative complete dataset.
      const views=viewData(JSON.parse(raw));
      await request('POST',sheetPath('/values:batchClear'),{ranges:VIEWS.map(v=>a1(v,'A1:S'))});
      await request('POST',sheetPath('/values:batchUpdate'),{valueInputOption:'RAW',data:Object.entries(views).map(([name,values])=>({range:a1(name,'A1'),values}))});
      // Commit pointer LAST. The previously saved slot survives a partially failed write.
      await request('POST',sheetPath('/values:batchUpdate'),{valueInputOption:'RAW',data:[{range:a1(STORE,'B1:D1'),values:[[target,revision,digest]]}]});
      syncedRevision=revision;syncedHash=digest;syncedAt=new Date().toISOString();
      const current=jsonData();
      pending=current!==raw;
      conflict=false;error='';status=pending?'Saved one version; uploading newer changes…':'All changes saved to your private Google Sheet.';
      persistConnection();
      if(!pending)alertUser('Saved successfully to Google Sheets.');
    } catch(e) {
      error=e.message;pending=true;status='Save failed: '+e.message;
      persistConnection();alertUser(status);
    } finally {
      busy=false;renderStatus();
      if(pending && !conflict && !error && connected())scheduleSave();
    }
  }
  async function loadNow(confirmOverwrite=true) {
    if(busy){alertUser('Wait until the current save finishes.');return;}
    if(!connected() || !sheetId){alertUser('Connect Google and select a Sheet first.');return;}
    busy=true;error='';status='Loading your complete workspace from Google Sheets…';renderStatus();
    try {
      await ensureSheets();
      const remote=await loadRemote();
      if(!remote)throw Error('No GoalOS data found in this Sheet. Import your JSON, then click Save to Sheets.');
      if(confirmOverwrite && jsonData() && hashString(jsonData())!==remote.hash && !window.confirm('Replace this browser’s goals, transactions, loans and settings with the Google Sheet copy? Export local JSON first if needed.'))return;
      helpers.restoreData(remote.data); // This bypasses cloud autosave to prevent replacing the just-loaded data.
      syncedRevision=remote.revision;syncedHash=remote.hash;syncedAt=remote.revision.slice(0,24)||new Date().toISOString();
      pending=false;conflict=false;error='';status='Loaded from Sheets. All your data is available.';
      persistConnection();alertUser('Full workspace loaded from Google Sheets.');
    } catch(e){error=e.message;status='Load failed: '+e.message;alertUser(status);}
    finally {busy=false;renderStatus();}
  }
  function scheduleSave(){clearTimeout(timer);timer=setTimeout(()=>{ if(connected()&&sheetId&&!conflict)saveNow(); },1300);}
  function changed(){
    pending=true;error='';persistConnection();
    status=connected() ? (sheetId?'Unsaved edits; syncing shortly…':'Create or attach a Sheet to save your edits.'):'Saved in browser only — connect Google to save to Sheet.';
    renderStatus();
    if(connected() && sheetId && !conflict)scheduleSave();
  }
  function connect() {
    const id=String(window.GOALOS_GOOGLE_CLIENT_ID||'').trim();
    if(!id || !/\.apps\.googleusercontent\.com$/.test(id)) {alertUser('OAuth Client ID is not loaded. Re-deploy index.html and site-config.js, then hard-refresh the LIVE GitHub Pages URL. Check your Pages branch/folder.');return;}
    if(!window.google?.accounts?.oauth2){alertUser('Google authorization script is unavailable. Open the GitHub Pages website over HTTPS and allow popups.');return;}
    if(!tokenClient){
      tokenClient=google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPE,callback:async result=>{
        if(!result?.access_token || result.error){alertUser('Google did not authorize the Sheets connection.');return;}
        if(!String(result.scope||'').split(' ').includes(SCOPE)){alertUser('Sheets permission was not granted.');return;}
        token=result.access_token;expiresAt=Date.now()+(Math.max(60,Number(result.expires_in)||3600)*1000);
        manuallyDisconnected=false;
        persistSession();persistConnection();
        status='Google access resumed. Syncing your remembered Sheet…';error='';renderStatus();
        try{await checkConnectedSheet();}catch(e){error=e.message;status='Cannot access Sheet: '+e.message;renderStatus();alertUser(status);}
      },error_callback:()=>alertUser('Google popup was blocked or closed. Please try again.')});
    }
    tokenClient.requestAccessToken({prompt:''}); // Consent is shown by Google only when needed.
  }
  async function createNew(){
    if(!connected()){alertUser('Connect Google first.');return;}
    if(sheetId && !window.confirm('Create a NEW Google spreadsheet and link GoalOS to it? The old sheet will remain in your account.'))return;
    busy=true;error='';status='Creating your private Google Sheet…';renderStatus();
    try{
      const created=await request('POST','',{properties:{title:'GoalOS — Personal Data (Private)'},sheets:[
        {properties:{title:STORE,hidden:true}},...VIEWS.map(title=>({properties:{title}}))
      ]});
      if(!created.spreadsheetId)throw Error('Google did not return a new spreadsheet ID.');
      linked(created.spreadsheetId);
      status='Private Sheet created: '+created.spreadsheetId;
      alertUser('Google Sheet created successfully.');
    }catch(e){error=e.message;status='Sheet creation failed: '+e.message;alertUser(status);}
    finally{busy=false;renderStatus();}
    if(sheetId && connected() && jsonData())await saveNow();
  }
  async function useExisting(){
    if(!connected()){alertUser('Connect Google first.');return;}
    const newId=extractId(document.getElementById('sheetUrlInput')?.value || '');
    if(!newId){alertUser('Paste a valid Google Sheets URL or spreadsheet ID.');return;}
    if(sheetId && sheetId!==newId && !window.confirm('Switch GoalOS to this different Google Sheet? Unsaved local data will not be deleted.'))return;
    linked(newId);
    try{await checkConnectedSheet();}catch(e){error=e.message;status='Cannot open that Google Sheet: '+e.message;renderStatus();alertUser(status);}
  }
  async function handle(action){
    if(action==='connect-sheets')return connect();
    if(action==='create-sheet')return createNew();
    if(action==='link-sheet')return useExisting();
    if(action==='save-sheet')return saveNow(true);
    if(action==='load-sheet')return loadNow(true);
    if(action==='disconnect-sheets'){
      clearTimeout(timer);
      token='';expiresAt=0;error='';conflict=false;
      manuallyDisconnected=true;persistSession();persistConnection();
      status='Disconnected by you. Your Google Sheet and data were not deleted. Auto-resume is off until you connect again.';
      renderStatus();alertUser('Disconnected on this device. Your private Google Sheet is unchanged.');
    }
    if(action==='copy-device-link'){
      const link=shareUrl();
      if(!link){alertUser('Create or attach a Sheet first.');return;}
      try { await navigator.clipboard.writeText(link); alertUser('Copied your private Sheet workspace link. Open it on your other device, then authorize Google once.'); }
      catch (_) { window.prompt('Copy this link to your other device:',link); }
    }
  }
  function html(){
    const isOn=connected();
    const link=sheetId?'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(sheetId)+'/edit':'';
    const authLabel = isOn ? 'Renew Google access' : manuallyDisconnected ? 'Connect Google again' : sheetId ? 'Resume Google Sheets' : 'Connect Google';
    const sheetNote = manuallyDisconnected ? 'Disconnected by you. Auto-resume is disabled.' : isOn ? 'Authorized for this browser session.' : sheetId ? 'Your Sheet is remembered; Google authorization is needed to sync.' : 'Connect to Google and choose your Sheet.';
    return `<div class="sheet-controls">
      <div class="google-status"><span class="google-indicator ${isOn?'online':'offline'}"></span><strong>${esc(isOn?'Google connected':sheetId&&!manuallyDisconnected?'Google Sheet remembered':manuallyDisconnected?'Disconnected by you':'Not connected to Google')}</strong></div>
      <p class="field-help">${esc(sheetNote)} Refreshing this page will retain a still-valid access token in this tab. Once Google authorization expires or you open another device, click Resume/Connect again.</p>
      <p class="field-help sheets-help">${esc(status)}<br>Last successful cloud save: <strong>${esc(shortDate(syncedAt))}</strong>. ${pending?'<strong>Some local edits are not yet confirmed in Sheets.</strong>':' '}</p>
      <div class="settings-actions google-buttons">
        <button class="btn btn-primary" type="button" data-action="connect-sheets">${esc(authLabel)}</button>
        <button class="btn btn-neutral" type="button" data-action="create-sheet" ${!isOn?'disabled':''}>Create private Sheet</button>
        ${(isOn||sheetId||manuallyDisconnected)?'<button class="btn btn-neutral" type="button" data-action="disconnect-sheets">Disconnect this device</button>':''}
      </div>
      <div class="sheet-url-row"><div class="form-field"><label for="sheetUrlInput">Existing GoalOS Google Sheet link or ID</label><input id="sheetUrlInput" type="text" placeholder="https://docs.google.com/spreadsheets/d/.../edit" autocomplete="off" /></div><button class="btn btn-neutral" type="button" data-action="link-sheet" ${!isOn?'disabled':''}>Use this Sheet</button></div>
      ${link?`<p class="field-help">Your linked spreadsheet: <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open my private Google Sheet ↗</a></p><div class="settings-actions google-buttons"><button class="btn btn-neutral" type="button" data-action="copy-device-link">Copy link for another device</button></div><p class="field-help">Open that link on your other device and authorize Google with the account that can access this Sheet. Do not post this link publicly.</p>`:''}
      <div class="settings-actions google-buttons">
        <button class="btn btn-primary" type="button" data-action="save-sheet" ${!isOn||!sheetId?'disabled':''}>Save all data to Sheet</button>
        <button class="btn btn-neutral" type="button" data-action="load-sheet" ${!isOn||!sheetId?'disabled':''}>Load data from Sheet</button>
      </div>
      ${conflict?'<div class="notice unsafe"><strong>Sync conflict:</strong> Cloud and browser both have different records. Use Load data from Sheet to keep the cloud copy, or Save all data to Sheet to overwrite it after confirmation.</div>':''}
      <div class="notice private"><strong>How it works:</strong> Your complete data is stored in the private Sheet (two protected snapshot slots) and readable Transactions, Goals, Loans, Settings and Workbook_Archive tabs. Edits save automatically about one second after changes while Google is connected. If disconnected, edits remain locally and upload after reconnect, unless a conflict requires your choice. No Gmail or Drive API access is used.</div>
      <p class="field-help"><strong>Important:</strong> A page refresh in the same tab preserves unexpired access. Google still requires fresh authorization when a token expires or on another device; a public GitHub Pages app cannot bypass this. Do not edit GoalOS in two devices at the same time. A Google Sheet is long-term storage, not a guarantee against deletion or account loss. <a href="SETUP_SHEETS.md" target="_blank" rel="noopener noreferrer">Open setup guide ↗</a></p>
    </div>`;
  }
  window.GoalOSSheets={init(api){
    helpers=api;
    persistSession();renderStatus();
    // A normal reload can resume automatically while its SESSION token remains valid.
    // No new OAuth popups are opened without the user's click.
    if(connected() && sheetId)checkConnectedSheet().catch(e=>{
      error=e.message;status='Cannot resume Sheet sync: '+e.message;renderStatus();
    });
  },changed,handle,html,getStatus:()=>({sheetId,connected:connected(),pending,conflict,error,syncedRevision,syncedAt,manuallyDisconnected,shareUrl:shareUrl()}),_testing:{hashString,chunks,viewData,extractId}};
})();
