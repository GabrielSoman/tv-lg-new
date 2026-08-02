/* =========================================================
   Lista M3U: extracao de credenciais e leitura do arquivo.

   A maioria dos provedores entrega um link no formato
     http://servidor:porta/get.php?username=USER&password=SENHA&type=m3u_plus
   Desse link da para deduzir as credenciais e falar com a API
   Xtream, que devolve um catalogo muito mais organizado
   (categorias, capas, sinopses, temporadas) do que o .m3u cru.
   Se a deducao falhar, o app cai para a leitura do arquivo.
   ========================================================= */
(function (w) {
  'use strict';

  w.M3U = {

    /* Tenta descobrir servidor + usuario + senha a partir da URL. */
    credentialsFrom: function (url) {
      if (!url) return null;
      var clean = String(url).trim();
      var m = clean.match(/^(https?:\/\/[^\/?#]+)(\/[^?#]*)?(?:\?([^#]*))?/i);
      if (!m) return null;

      var origin = m[1];
      var path   = m[2] || '';
      var query  = m[3] || '';

      /* Formato 1: parametros na query (get.php?username=..&password=..) */
      var user = null, pass = null;
      query.split('&').forEach(function (pair) {
        var kv = pair.split('=');
        var k = decodeURIComponent(kv[0] || '').toLowerCase();
        var v = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
        if (k === 'username' || k === 'user') user = v;
        if (k === 'password' || k === 'pass') pass = v;
      });

      /* Formato 2: credenciais no caminho (/live/USER/SENHA/... ou /USER/SENHA/) */
      if (!user || !pass) {
        var seg = path.split('/').filter(Boolean);
        if (seg.length >= 2 && ['live', 'movie', 'series'].indexOf(seg[0]) >= 0) {
          user = seg[1]; pass = seg[2];
        } else if (seg.length >= 2 && seg[0].indexOf('.') < 0 && seg[1].indexOf('.') < 0) {
          user = seg[0]; pass = seg[1];
        }
      }

      if (!user || !pass) return null;
      return { origin: origin, username: user, password: pass };
    },

    /* Le e interpreta um arquivo .m3u / .m3u8 de lista. */
    parse: function (text) {
      var lines = String(text || '').split(/\r?\n/);
      var items = [], pending = null, seq = 0;

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        if (line.indexOf('#EXTINF') === 0) {
          pending = parseExtinf(line);
          continue;
        }
        if (line.charAt(0) === '#') continue;   // outras diretivas

        if (pending) {
          pending.url = line;
          pending.id = 'm3u:' + (seq++);
          pending.kind = classify(line, pending.group);
          items.push(pending);
          pending = null;
        }
      }
      return items;
    },

    /* Agrupa os itens por group-title, preservando a ordem de aparicao. */
    groupsOf: function (items) {
      var order = [], byName = {};
      items.forEach(function (it) {
        var g = it.group || 'Sem categoria';
        if (!byName[g]) { byName[g] = []; order.push(g); }
        byName[g].push(it);
      });
      return order.map(function (name) {
        return { id: name, name: name, count: byName[name].length, items: byName[name] };
      });
    }
  };

  function attr(line, name) {
    var re = new RegExp(name + '="([^"]*)"', 'i');
    var m = line.match(re);
    return m ? m[1] : '';
  }

  function parseExtinf(line) {
    var comma = line.indexOf(',');
    var title = comma >= 0 ? line.slice(comma + 1).trim() : '';
    var tvgName = attr(line, 'tvg-name');
    return {
      title: title || tvgName || 'Sem nome',
      tvgId: attr(line, 'tvg-id'),
      poster: attr(line, 'tvg-logo'),
      group: attr(line, 'group-title') || '',
      url: ''
    };
  }

  function classify(url, group) {
    var u = url.toLowerCase();
    var g = (group || '').toLowerCase();
    if (u.indexOf('/series/') >= 0) return 'episode';
    if (u.indexOf('/movie/') >= 0)  return 'movie';
    if (u.indexOf('/live/') >= 0)   return 'live';
    if (/s\d{1,2}\s*e\d{1,2}/i.test(url)) return 'episode';
    if (/(filme|movie|vod|cinema)/.test(g)) return 'movie';
    if (/(serie|série|season|temporada)/.test(g)) return 'episode';
    /* Sem pista melhor: extensao de arquivo costuma indicar conteudo gravado. */
    if (/\.(mp4|mkv|avi|mov)(\?|$)/.test(u)) return 'movie';
    return 'live';
  }

})(window);
