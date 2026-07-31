const { io } = require('socket.io-client');
const SERVER = 'http://localhost:3000';
const delay = ms => new Promise(r => setTimeout(r, ms));

async function makePair(n) {
  const a = io(SERVER, { transports: ['websocket'] });
  const b = io(SERVER, { transports: ['websocket'] });
  await Promise.all([new Promise(r => a.on('connect', r)), new Promise(r => b.on('connect', r))]);
  a.emit('register', { age: '25', gender: 'Male', username: 'P' + n + 'a' });
  b.emit('register', { age: '25', gender: 'Female', username: 'P' + n + 'b' });
  await delay(200);
  a.emit('find-stranger');
  await delay(150);
  const m = await new Promise(res => { b.on('matched', res); b.emit('find-stranger'); setTimeout(()=>res('timeout'),1500); });
  return { a, b, matched: m !== 'timeout' };
}

async function main() {
  // Probe A: chat-message with non-string message
  let { a, b, matched } = await makePair(1);
  if (matched) {
    try { a.emit('chat-message', { message: 123 }); } catch (e) { console.log('A threw client-side:', e.message); }
    await delay(300);
  }
  a.disconnect(); b.disconnect();
  console.log('Probe A (chat-message message=123) done');

  // Probe B: file-message with non-string fileType
  ({ a, b, matched } = await makePair(2));
  if (matched) {
    try { a.emit('file-message', { fileName: 'x.mp4', fileType: 123, fileSize: 100, fileData: 'data:video/mp4;base64,xxxx' }); } catch (e) { console.log('B threw client-side:', e.message); }
    await delay(300);
  }
  a.disconnect(); b.disconnect();
  console.log('Probe B (file-message fileType=123) done');

  // Probe C: chat-message with object message
  ({ a, b, matched } = await makePair(3));
  if (matched) {
    try { a.emit('chat-message', { message: { hello: 'world' } }); } catch (e) { console.log('C threw client-side:', e.message); }
    await delay(300);
  }
  a.disconnect(); b.disconnect();
  console.log('Probe C (chat-message message=object) done');
  console.log('ALL PROBES EMITTED');
}
main();
