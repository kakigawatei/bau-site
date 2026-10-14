// 空中戦メーター: タップの受け渡し口
//   mode=local : BroadcastChannel（同じPCの別タブ同士・リハーサル用）
//   既定(cloud): Firestore kuuchuusen/{room}/phones/{端末ID} = { n: その端末の累計タップ数, t: サーバー時刻 }
//                スマホは 0.7 秒ごとに「増えていたら」1回だけ書く（連打しても書き込みは少ない）
//                スクリーンは各端末の n の増え分を足してタップ数にする
//   room=xxx   : 講演会ごとの部屋名（英小文字・数字・ハイフン 4〜40字）
(function () {
  var q = new URLSearchParams(location.search);
  var room = (q.get('room') || 'test').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  if (room.length < 4) room = 'test-room';
  var mode = q.get('mode') || 'cloud';
  var CFG = {
    apiKey: 'AIzaSyDtDZIEQtBzjujnpTDcXt1QeEU2r-wbg74',
    authDomain: 'kakigawatei-franchise.firebaseapp.com',
    projectId: 'kakigawatei-franchise'
  };
  var V = '10.14.1', B = 'https://www.gstatic.com/firebasejs/' + V + '/';
  var listeners = [], sendQ = 0, ready = null, status = 'connecting';

  function setStatus(s) { status = s; if (window.KTransport.onStatus) window.KTransport.onStatus(s); }

  window.KTransport = {
    room: room, mode: mode, onStatus: null,
    status: function () { return status; },
    send: function (n) { sendQ += (n || 1); },
    onTaps: function (cb) { listeners.push(cb); }
  };
  function emit(n) { for (var i = 0; i < listeners.length; i++) listeners[i](n); }

  if (mode === 'local') {
    var ch = ('BroadcastChannel' in window) ? new BroadcastChannel('kuuchuusen-' + room) : null;
    if (ch) ch.onmessage = function (e) { if (e.data && e.data.t === 'tap') emit(e.data.n || 1); };
    setInterval(function () { if (sendQ > 0 && ch) { ch.postMessage({ t: 'tap', n: sendQ }); sendQ = 0; } }, 100);
    setStatus('local');
    return;
  }

  // 端末ID（この端末の印。ページを開き直しても同じ）
  var cid = '';
  try { cid = localStorage.getItem('kuuchuusen_cid') || ''; } catch (e) {}
  if (!/^[a-z0-9]{12,32}$/.test(cid)) {
    cid = ''; var c = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < 20; i++) cid += c[Math.floor(Math.random() * c.length)];
    try { localStorage.setItem('kuuchuusen_cid', cid); } catch (e) {}
  }

  ready = Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-firestore.js')]).then(function (m) {
    var app = m[0].initializeApp(CFG, 'kuuchuusen');
    var F = m[1], db = F.getFirestore(app);
    setStatus('ok');
    return { F: F, db: db };
  }).catch(function (e) { setStatus('error'); console.error(e); });

  // スマホ側: 累計 n をまとめて書く
  var total = 0, written = -1, busy = false;
  try { total = parseInt(sessionStorage.getItem('kuuchuusen_n_' + room) || '0', 10) || 0; } catch (e) {}
  setInterval(function () {
    if (sendQ > 0) { total += sendQ; sendQ = 0; try { sessionStorage.setItem('kuuchuusen_n_' + room, String(total)); } catch (e) {} }
    if (busy || total === written || !ready) return;
    busy = true; var want = total;
    ready.then(function (x) {
      if (!x) return;
      return x.F.setDoc(x.F.doc(x.db, 'kuuchuusen', room, 'phones', cid), { n: want, t: x.F.serverTimestamp() })
        .then(function () { written = want; setStatus('ok'); });
    }).catch(function (e) { setStatus('error'); console.error(e); }).then(function () { busy = false; });
  }, 700);

  // スクリーン側: 各端末の n の増え分を足す
  var started = false;
  window.KTransport.onTaps = function (cb) {
    listeners.push(cb);
    if (started) return; started = true;
    var last = {}, first = true;
    ready.then(function (x) {
      if (!x) return;
      x.F.onSnapshot(x.F.collection(x.db, 'kuuchuusen', room, 'phones'), function (snap) {
        snap.docChanges().forEach(function (d) {
          var n = (d.doc.data() || {}).n || 0, id = d.doc.id;
          if (!first && d.type !== 'removed') { var dn = n - (last[id] || 0); if (dn > 0 && dn < 500) emit(dn); }
          last[id] = n;
        });
        first = false; setStatus('ok');
      }, function (e) { setStatus('error'); console.error(e); });
    });
  };
})();
