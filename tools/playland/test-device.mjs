// test-device.mjs — ทดสอบคุยกับเครื่องอ่านใบหน้า ACS F606 จากคอม (ยังไม่ต่อ Supabase)
// ต้องมี Node.js 20+   วิธีใช้: node test-device.mjs <คำสั่ง>

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';

// ====== แก้ 2 ตรงนี้ ======
const DEVICE_IP = process.env.IP || '192.168.1.10';   // IP เครื่องสแกน (เปลี่ยนเครื่องด้วย: set IP=192.168.1.xx)
const PASSWORD  = '123456';         // รหัสเข้าเครื่อง
// ============================
const BASE = `http://${DEVICE_IP}:8091`;

async function call(path, body = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD, ...body }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

const show = (label, r) =>
  console.log(r.result === 0 ? `✅ ${label}` : `❌ ${label}`, JSON.stringify(r));

const today = () => new Date().toLocaleDateString('sv-SE');
const plusDays = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('sv-SE');

function myLanIp() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list) if (a.family === 'IPv4' && !a.internal) return a.address;
}

const [cmd, a1, a2, a3] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'login':
      show('login', await call('deviceLogin'));
      break;

    case 'version':
      show('เวอร์ชัน/SN เครื่อง', await call('getDeviceVersion'));
      break;

    case 'setip': { // node test-device.mjs setip 192.168.1.11
      if (!a1) throw new Error('ใช้: node test-device.mjs setip <ip ใหม่> [gateway] [mask]');
      const gateway = a2 || '192.168.1.1';
      const mask = a3 || '255.255.255.0';
      show(`ตั้ง IP ใหม่เป็น ${a1}`, await call('setDeviceNetwork', {
        data: { isDhcp: false, ip: a1, gateway, mask, dns: '8.8.8.8' },
      }));
      break;
    }

    case 'add': { // node test-device.mjs add T0001 face.jpg "ชื่อ"
      if (!a1 || !a2) throw new Error('ใช้: node test-device.mjs add <รหัส> <ไฟล์รูป.jpg> [ชื่อ]');
      const register_base64 = fs.readFileSync(a2).toString('base64');
      const check = await call('checkFacePicture', { data: { register_base64 } });
      show('ตรวจรูป (ต้องผ่านก่อน)', check);
      if (check.result !== 0) break;
      show(`เพิ่ม ${a1}`, await call('addDeviceWhiteList', {
        totalnum: 1, currentnum: 1,
        data: {
          usertype: 'white', employee_number: a1, name: a3 || a1,
          peoplestartdate: today(), peopleenddate: plusDays(1),
          passAlgo: false, TimeGroupId: 0, register_base64,
        },
      }));
      break;
    }

    case 'delete': // node test-device.mjs delete T0001
      show(`ลบ ${a1}`, await call('deleteDeviceWhiteList', {
        data: { employee_number: a1, usertype: 'white' },
      }));
      break;

    case 'list':
      show('รายชื่อในเครื่อง', await call('getAllDeviceIdWhiteList'));
      break;

    case 'open':
      show('สั่งเปิดประตู', await call('setDeviceRemoteOpen'));
      break;

    case 'getparam': { // node test-device.mjs getparam  → ดูว่าเครื่องนี้ตั้งเป็น "ขาเข้า" หรือ "ขาออก"
      const r = await call('getDeviceParameter');
      show('พารามิเตอร์เครื่อง', r);
      const inout = r?.data?.inout ?? r?.inout;
      if (inout !== undefined) console.log(`\n👉 เครื่องนี้ (${DEVICE_IP}) ตั้งเป็น: ${inout === 0 ? 'ขาออก (OUT)' : inout === 1 ? 'ขาเข้า (IN)' : `ค่าไม่รู้จัก (${inout})`}`);
      break;
    }

    case 'setparam': { // node test-device.mjs setparam inout 0   (0=ขาออก, 1=ขาเข้า)
      if (!a1 || a2 === undefined) throw new Error('ใช้: node test-device.mjs setparam inout <0=ออก|1=เข้า>');
      const value = Number(a2);
      show(`ตั้ง ${a1}=${value}`, await call('setDeviceParameter', { data: { [a1]: value } }));
      console.log('เช็คซ้ำด้วย: node test-device.mjs getparam');
      break;
    }

    case 'listen': { // รับ log สแกน เข้าคอมโดยตรง
      const ip = a1 || myLanIp();
      const url = `http://${ip}:8080/record`;
      http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const r = JSON.parse(body);
            console.log(`📸 ${r.time}  รหัส=${r.employee_number}  ชื่อ=${r.name ?? ''}  ` +
              `${r.inout === 0 ? 'OUT' : 'IN'}  ${r.resultStatus === 1 ? 'ผ่าน' : 'ไม่ผ่าน'}`);
          } catch { console.log('เข้าข้อมูล:', body.slice(0, 200)); }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"result":0,"message":"OK"}'); // ต้องตอบ เครื่องจะได้ไม่ส่งซ้ำ
        });
      }).listen(8080);
      show(`ตั้งให้เครื่องส่ง log มาที่ ${url}`,
        await call('setIdentifyCallBck', { platformEnable: 1, platformIp: url }));
      console.log('👂 รอฟังสแกน... (กด Ctrl+C เพื่อหยุด)');
      break;
    }

    default:
      console.log(`
วิธีใช้:
  node test-device.mjs login                         ทดสอบต่อเครื่องได้ไหม
  node test-device.mjs version                        ดูรุ่น/SN เครื่อง
  node test-device.mjs setip 192.168.1.11             เปลี่ยน IP เครื่อง (แก้ปัญหา IP ชนกัน)
  node test-device.mjs add T0001 face.jpg "สมชาย"      เพิ่มหน้า
  node test-device.mjs list                           ดูรายชื่อในเครื่อง
  node test-device.mjs delete T0001                    ลบหน้า
  node test-device.mjs open                            สั่งเปิดประตูจากคอม
  node test-device.mjs listen                          ดู log สแกนแบบ real-time
  node test-device.mjs getparam                        เช็คว่าเครื่องนี้ตั้งเป็น ขาเข้า/ขาออก
  node test-device.mjs setparam inout 0                ตั้งเครื่องนี้เป็นขาออก (1=ขาเข้า)
`);
  }
} catch (e) {
  console.log('❌ ต่อไม่ได้:', e.cause?.code || e.message);
  console.log('   เช็ค: IP ถูกไหม / คอมอยู่ router เดียวกับเครื่องไหม / ping ได้ไหม');
}
