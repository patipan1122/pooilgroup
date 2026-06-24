/* ClawFleet prototype — shared data + logic (window.CF) · v2 scaled */
(function () {
  const COIN_RATE = 10;

  // ---------- BASE BRANCHES (10) — machineCount sums to 100 ----------
  const BASE_BRANCHES = [
    { id:'PTT-CKR', name:'ปตท. จักราช',        area:'นครราชสีมา', code:'PTT-001', tone:'mustard', avatar:'จ', machineCount:12 },
    { id:'PTT-PKC', name:'ปตท. ปักธงชัย',       area:'นครราชสีมา', code:'PTT-002', tone:'blue',    avatar:'ป', machineCount:10 },
    { id:'PTT-SKW', name:'ปตท. สีคิ้ว',          area:'นครราชสีมา', code:'PTT-003', tone:'green',   avatar:'ส', machineCount:8  },
    { id:'PTT-DKT', name:'ปตท. ด่านขุนทด',      area:'นครราชสีมา', code:'PTT-004', tone:'red',     avatar:'ด', machineCount:10 },
    { id:'PTT-NSG', name:'ปตท. โนนสูง',          area:'นครราชสีมา', code:'PTT-005', tone:'violet',  avatar:'น', machineCount:9  },
    { id:'BYI-MKT', name:'ตลาดบางใหญ่',         area:'นนทบุรี',    code:'BR-006',  tone:'mustard', avatar:'บ', machineCount:14 },
    { id:'KKM-MAL', name:'ขอนแก่น มอลล์',       area:'ขอนแก่น',    code:'BR-007',  tone:'blue',    avatar:'ข', machineCount:11 },
    { id:'CTP-PKL', name:'เซ็นทรัล ปิ่นเกล้า',   area:'กรุงเทพฯ',   code:'BR-008',  tone:'green',   avatar:'ป', machineCount:9  },
    { id:'CRP-PSL', name:'CR. พิษณุโลก',         area:'พิษณุโลก',   code:'BR-009',  tone:'red',     avatar:'พ', machineCount:8  },
    { id:'PTT-CYP', name:'ปตท. เฉลิมพระเกียรติ', area:'นครราชสีมา', code:'PTT-006', tone:'violet',  avatar:'ฉ', machineCount:9  },
  ];

  const SKUS = [
    { code:'SKU-001', name:'หมีน้ำตาล M', cost:35 },
    { code:'SKU-002', name:'หมีขาว L', cost:48 },
    { code:'SKU-003', name:'แมวขาว S', cost:22 },
    { code:'SKU-004', name:'กระต่าย M', cost:30 },
    { code:'SKU-005', name:'เพนกวิน S', cost:25 },
    { code:'SKU-006', name:'หมาชิวาวา', cost:38 },
  ];

  // ---------- CRUD persistence: branches + machines + day status ----------
  const BKEY='cf_branches_v2', MKEY='cf_machines_v2';
  function loadCustom(k){ try{return JSON.parse(localStorage.getItem(k))||null;}catch{return null;} }

  // branches = base + custom (custom can add new)
  function getBranches(){
    const custom = loadCustom(BKEY) || [];
    return [...BASE_BRANCHES, ...custom];
  }
  function addBranch(b){
    const custom = loadCustom(BKEY) || [];
    custom.push(b); localStorage.setItem(BKEY, JSON.stringify(custom));
  }

  // machines: generated default per branch, overridable/extendable in localStorage
  function genMachines(b){
    const seed=(b.code.charCodeAt(b.code.length-1)||5);
    const zones=['ทางเข้า','ข้างกาแฟ','มุมห้องน้ำ','ทางออก','ใกล้ ATM','มุมเด็ก','โซนอาหาร','ทางขึ้น','ลานจอด','หน้าร้าน','โซน VIP','มุมพักผ่อน','ใกล้ลิฟต์','ชั้น 2'];
    return Array.from({length:b.machineCount},(_,i)=>({
      code:`${b.id}-${String(i+1).padStart(2,'0')}`,
      name:`ตู้ ${String(i+1).padStart(2,'0')} · ${zones[i%zones.length]}`,
      coinMeterPrev: 14600 - i*230 + seed*13,
      prizeMeterPrev: 980 - i*40 + seed*3,
      prizePrev: 24 - (i%4)*2,
      capacity: 32,
      sku: SKUS[i%SKUS.length].code,
      bid: b.id,
    }));
  }
  function getMachines(bid){
    const b=branchById(bid); if(!b) return [];
    const custom=loadCustom(MKEY)||{};
    const base=genMachines(b);
    const extra=(custom[bid]||[]);
    return [...base, ...extra];
  }
  function addMachine(bid,m){
    const custom=loadCustom(MKEY)||{};
    custom[bid]=custom[bid]||[];
    custom[bid].push(m); localStorage.setItem(MKEY,JSON.stringify(custom));
  }
  // back-compat alias
  function machinesFor(bid){ return getMachines(bid); }

  // ---------- PER-BRANCH DAILY STATUS (the fleet board) ----------
  // collected: 'done' | 'partial' | 'none'  · plus problems
  const DAY_STATUS = {
    'PTT-CKR':{ collected:'done', revenue:12140, anomaly:1, stockLow:1, broken:1, configIssue:false },
    'PTT-PKC':{ collected:'partial', done:3, revenue:7280, anomaly:1, stockLow:1, broken:0, configIssue:false },
    'PTT-SKW':{ collected:'done', revenue:7400, anomaly:0, stockLow:0, broken:0, configIssue:false },
    'PTT-DKT':{ collected:'none', revenue:0, anomaly:0, stockLow:2, broken:0, configIssue:true },
    'PTT-NSG':{ collected:'done', revenue:8660, anomaly:0, stockLow:0, broken:0, configIssue:false },
    'BYI-MKT':{ collected:'partial', done:1, revenue:5860, anomaly:1, stockLow:3, broken:1, configIssue:false },
    'KKM-MAL':{ collected:'done', revenue:9420, anomaly:1, stockLow:1, broken:0, configIssue:false },
    'CTP-PKL':{ collected:'none', revenue:0, anomaly:0, stockLow:1, broken:0, configIssue:false },
    'CRP-PSL':{ collected:'done', revenue:5910, anomaly:0, stockLow:0, broken:1, configIssue:false },
    'PTT-CYP':{ collected:'none', revenue:0, anomaly:0, stockLow:0, broken:0, configIssue:true },
  };
  function dayStatus(bid){ return DAY_STATUS[bid] || { collected:'none', revenue:0, anomaly:0, stockLow:0, broken:0, configIssue:false }; }

  // ---------- TWO-TIER STOCK: DC กลาง + store แต่ละสาขา ----------
  // DC central warehouse (บางนา)
  const DC_STOCK = { 'SKU-001':1240, 'SKU-002':320, 'SKU-003':980, 'SKU-004':150, 'SKU-005':640, 'SKU-006':80 };
  // per-branch store (นอกตู้) — generated-ish with a few lows
  function branchStore(bid){
    const seed=bid.charCodeAt(4)||5;
    const o={};
    SKUS.forEach((s,i)=>{ o[s.code]= Math.max(0, (i*7+seed*3)%30 - (i===5?12:0)); });
    return o;
  }
  const STORE = {};
  // pre-seed deterministic stores
  BASE_BRANCHES.forEach(b=>{ STORE[b.id]=branchStore(b.id); });
  STORE['PTT-CKR']={ 'SKU-001':18,'SKU-002':3,'SKU-003':24,'SKU-004':8,'SKU-005':14,'SKU-006':0 };
  STORE['BYI-MKT']={ 'SKU-001':30,'SKU-002':2,'SKU-003':5,'SKU-004':4,'SKU-005':9,'SKU-006':1 };
  function storeOf(bid){ return STORE[bid] || branchStore(bid); }
  // back-compat: STOCK used by mobile = branch store
  const STOCK = STORE;

  // transfers DC -> branch (persisted demo)
  const TKEY='cf_transfers_v1';
  function getTransfers(){ try{return JSON.parse(localStorage.getItem(TKEY))||[];}catch{return [];} }
  function addTransfer(t){ const a=getTransfers(); a.unshift(t); localStorage.setItem(TKEY,JSON.stringify(a)); }
  const DEFAULT_TRANSFERS=[
    { id:'DLV-014', bid:'PTT-CKR', items:6, units:240, eta:'พรุ่งนี้ 09:00', status:'in_transit' },
    { id:'DLV-013', bid:'BYI-MKT', items:4, units:120, eta:'วันนี้ 22:00', status:'in_transit' },
    { id:'DLV-012', bid:'PTT-DKT', items:3, units:90,  eta:'29 พ.ค. 11:00', status:'scheduled' },
  ];

  // ---------- cross-check math ----------
  function computeMachine(m, e) {
    e=e||{};
    const coinDelta = Math.max(0, (e.coinMeterNow||0) - m.coinMeterPrev);
    const expectedCash = coinDelta * COIN_RATE;
    const cashGap = (e.cashIn||0) - expectedCash;
    const cashPct = expectedCash ? Math.abs(cashGap)/expectedCash*100 : 0;
    const prizeMeterDelta = Math.max(0, (e.prizeMeterNow||0) - m.prizeMeterPrev);
    const refillTotal = Object.values(e.refills||{}).reduce((s,n)=>s+(+n||0),0);
    const physicalOut = Math.max(0, m.prizePrev - (e.prizeCountNow!=null ? e.prizeCountNow : m.prizePrev));
    const prizeGap = prizeMeterDelta - physicalOut;
    return { coinDelta, expectedCash, cashGap, cashPct, prizeMeterDelta, refillTotal, physicalOut, prizeGap,
      afterCount:(e.prizeCountNow!=null?e.prizeCountNow:m.prizePrev)+refillTotal };
  }
  function machineStatus(c){ return (c.cashPct>5 || Math.abs(c.prizeGap)>1) ? 'flag':'ok'; }

  // ---------- session persistence ----------
  const KEY='cf_sessions_v1';
  function loadSessions(){ try{return JSON.parse(localStorage.getItem(KEY))||{};}catch{return {};} }
  function getSession(bid){ return loadSessions()[bid]||null; }
  function setSession(bid,s){ const a=loadSessions(); a[bid]=s; localStorage.setItem(KEY,JSON.stringify(a)); }
  function clearSession(bid){ const a=loadSessions(); delete a[bid]; localStorage.setItem(KEY,JSON.stringify(a)); }

  // ---------- staff ----------
  const STAFF = [
    { id:'s1', name:'น้องเอ', pin:'1111', avatar:'อ', tone:'mustard', branches:['PTT-CKR','PTT-PKC','PTT-SKW'], rounds:142, errRate:2 },
    { id:'s2', name:'น้องบี', pin:'2222', avatar:'บ', tone:'blue', branches:['PTT-DKT','PTT-NSG'], rounds:98, errRate:3 },
    { id:'s3', name:'พี่สอง', pin:'3333', avatar:'ส', tone:'red', branches:['BYI-MKT','CTP-PKL'], rounds:210, errRate:1 },
    { id:'s4', name:'พี่สาม', pin:'4444', avatar:'ม', tone:'violet', branches:['KKM-MAL','CRP-PSL','PTT-CYP'], rounds:176, errRate:2 },
  ];

  const LIVE_SESSIONS = [
    { id:'CFS-000028', bid:'BYI-MKT', staff:'พี่สอง', done:1, total:14, elapsed:'3 ชม. 16 น.', startedAt:'18:20', stale:true },
    { id:'CFS-000014', bid:'PTT-PKC', staff:'น้องบี', done:3, total:10, elapsed:'1 ชม. 16 น.', startedAt:'20:20', stale:false },
    { id:'CFS-000021', bid:'KKM-MAL', staff:'พี่สาม', done:8, total:11, elapsed:'38 น.', startedAt:'20:58', stale:false },
    { id:'CFS-000007', bid:'PTT-SKW', staff:'น้องเอ', done:8, total:8, elapsed:'52 น.', startedAt:'20:44', stale:false, review:true },
  ];

  const INSIGHTS = [
    { time:'27 พ.ค. 13:20', id:'CFS-000018', bid:'PTT-CKR', staff:'น้องเอ', expected:8400, actual:5860, prizeOut:30, status:'review' },
    { time:'27 พ.ค. 14:05', id:'CFS-000025', bid:'BYI-MKT', staff:'พี่สอง', expected:5000, actual:5000, prizeOut:35, status:'review' },
    { time:'27 พ.ค. 18:42', id:'CFS-000020', bid:'PTT-SKW', staff:'น้องเอ', expected:7400, actual:7400, prizeOut:28, status:'ok' },
    { time:'27 พ.ค. 19:10', id:'CFS-000031', bid:'PTT-NSG', staff:'น้องบี', expected:8660, actual:8660, prizeOut:26, status:'ok' },
    { time:'26 พ.ค. 16:20', id:'CFS-000019', bid:'KKM-MAL', staff:'พี่สาม', expected:9420, actual:9420, prizeOut:32, status:'ok' },
    { time:'25 พ.ค. 15:42', id:'CFS-000004', bid:'PTT-PKC', staff:'น้องบี', expected:9800, actual:7280, prizeOut:35, status:'review' },
    { time:'25 พ.ค. 11:15', id:'CFS-000011', bid:'CRP-PSL', staff:'พี่สาม', expected:5910, actual:5910, prizeOut:22, status:'ok' },
    { time:'24 พ.ค. 20:30', id:'CFS-000010', bid:'CTP-PKL', staff:'พี่สอง', expected:8200, actual:8200, prizeOut:26, status:'ok' },
  ];

  const AUDIT = [
    { time:'27 พ.ค. 21:30', who:'patipan', what:'อนุมัติ Anomaly · ปตท. จักราช', tag:'อนุมัติ', tone:'green' },
    { time:'27 พ.ค. 21:12', who:'patipan', what:'ส่งตรวจซ้ำ · ปตท. ปักธงชัย', tag:'ตรวจซ้ำ', tone:'mustard' },
    { time:'27 พ.ค. 18:42', who:'พี่สอง', what:'ปิดรอบ · ตลาดบางใหญ่', tag:'ปิดรอบ', tone:'blue' },
    { time:'27 พ.ค. 14:05', who:'พี่สอง', what:'แจ้งตู้เสีย · ตู้ 06 มุมเด็ก', tag:'แจ้งเสีย', tone:'red' },
    { time:'27 พ.ค. 09:02', who:'patipan', what:'เพิ่มสาขา · ปตท. เฉลิมพระเกียรติ', tag:'เพิ่มสาขา', tone:'violet' },
  ];

  const SKEY='cf_settings_v1';
  const DEFAULT_SETTINGS={ threshold:5, coinRate:10, requirePhotos:4, autoApprove:false };
  function getSettings(){ try{return {...DEFAULT_SETTINGS,...(JSON.parse(localStorage.getItem(SKEY))||{})};}catch{return {...DEFAULT_SETTINGS};} }
  function setSettings(s){ localStorage.setItem(SKEY,JSON.stringify(s)); }

  const BRKEY='cf_broken_v1';
  function getBroken(){ try{return JSON.parse(localStorage.getItem(BRKEY))||[];}catch{return [];} }
  function addBroken(r){ const a=getBroken(); a.unshift(r); localStorage.setItem(BRKEY,JSON.stringify(a)); }

  const TODAY={ revenue:67100, change:14, prizesOut:284, staffActive:4, staffTotal:4 };

  function branchById(id){ return getBranches().find(b=>b.id===id) || {name:id,area:'',avatar:'?',tone:'mustard',machineCount:0}; }
  function skuByCode(c){ return SKUS.find(s=>s.code===c)||{name:c}; }
  function fmt(n){ return '฿'+(n||0).toLocaleString('th-TH'); }
  function totalMachines(){ return getBranches().reduce((s,b)=>s+b.machineCount,0); }

  window.CF = {
    COIN_RATE, SKUS, STOCK, STORE, DC_STOCK, TODAY, STAFF, LIVE_SESSIONS, INSIGHTS, AUDIT,
    DEFAULT_TRANSFERS,
    get BRANCHES(){ return getBranches(); },
    getBranches, addBranch, getMachines, addMachine, machinesFor,
    dayStatus, storeOf, getTransfers, addTransfer, totalMachines,
    computeMachine, machineStatus,
    getSession, setSession, clearSession,
    getSettings, setSettings, getBroken, addBroken,
    branchById, skuByCode, fmt,
  };
})();
